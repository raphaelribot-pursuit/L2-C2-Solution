use std::io::{BufRead, BufReader};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;

use url::Url;
use uuid::Uuid;

use crate::error::WisperError;
use crate::managed_binary::{command_for_binary, http_get, replace_verified_binary, yt_dlp_runnable};

const BLOCKED_HOSTNAMES: &[&str] = &[
    "localhost",
    "localhost.localdomain",
    "metadata.google.internal",
];

fn is_private_or_local_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
        }
        IpAddr::V6(v6) => {
            if v6.is_loopback() || v6.is_unspecified() {
                return true;
            }
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_private_or_local_ip(IpAddr::V4(v4));
            }
            let segments = v6.segments();
            (segments[0] & 0xfe00) == 0xfc00 || (segments[0] & 0xffc0) == 0xfe80
        }
    }
}

fn is_blocked_hostname(host: &str) -> bool {
    let lower = host.trim_end_matches('.').to_ascii_lowercase();
    BLOCKED_HOSTNAMES.iter().any(|blocked| {
        lower == *blocked || lower.ends_with(&format!(".{blocked}"))
    })
}

fn validate_public_fetch_target(url: &Url) -> Result<(), WisperError> {
    if !url.username().is_empty() || url.password().is_some() {
        return Err(WisperError::Fetch(
            "URL must not include embedded credentials".into(),
        ));
    }

    let host = url
        .host_str()
        .ok_or_else(|| WisperError::Fetch("URL must include a host".into()))?;

    if is_blocked_hostname(host) {
        return Err(WisperError::Fetch(
            "URL host is not allowed for import".into(),
        ));
    }

    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_private_or_local_ip(ip) {
            return Err(WisperError::Fetch(
                "URL must not target private or local network addresses".into(),
            ));
        }
    }

    Ok(())
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub percent: Option<i32>,
    pub status: String,
    /// True when triggered by launch auto-update (not a manual install button).
    #[serde(default)]
    pub automatic: bool,
}

impl DownloadProgress {
    pub fn with_status(percent: Option<i32>, status: impl Into<String>) -> Self {
        Self {
            percent,
            status: status.into(),
            automatic: false,
        }
    }
}

#[derive(Debug, Clone)]
pub struct UrlDownloadResult {
    pub audio_path: PathBuf,
    pub title: String,
    pub source_url: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct YtDlpStatus {
    pub available: bool,
    pub path: Option<String>,
    pub hint: String,
}

/// Trim and validate an http(s) URL for yt-dlp.
pub fn normalize_url(url: &str) -> Result<String, WisperError> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(WisperError::Fetch("URL is empty".into()));
    }

    let parsed = Url::parse(trimmed).map_err(|e| WisperError::Fetch(format!("invalid URL: {e}")))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(WisperError::Fetch(
            "URL must start with http:// or https://".into(),
        ));
    }

    validate_public_fetch_target(&parsed)?;
    Ok(parsed.to_string())
}

fn find_in_path(name: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&paths) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Resolve yt-dlp from bundled/extra paths, then PATH.
pub fn resolve_yt_dlp(extra_candidates: &[PathBuf]) -> Result<PathBuf, WisperError> {
    for candidate in extra_candidates {
        if candidate.is_file() && yt_dlp_runnable(candidate) {
            return Ok(candidate.clone());
        }
    }

    #[cfg(windows)]
    {
        if let Some(path) = find_in_path("yt-dlp.exe") {
            if yt_dlp_runnable(&path) {
                return Ok(path);
            }
        }
    }

    if let Some(path) = find_in_path("yt-dlp") {
        if yt_dlp_runnable(&path) {
            return Ok(path);
        }
    }

    Err(WisperError::Fetch(
        "yt-dlp not found. Install it from Advanced options in Wisper, or add yt-dlp to your PATH.".into(),
    ))
}

pub fn yt_dlp_install_filename() -> &'static str {
    if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    }
}

pub fn yt_dlp_release_download_url() -> &'static str {
    if cfg!(windows) {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    } else if cfg!(target_os = "macos") {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
    } else {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
    }
}

/// Download the official yt-dlp release binary into `bin_dir` (e.g. app data `bin/`).
pub fn download_yt_dlp(
    bin_dir: &Path,
    force_refresh: bool,
    mut on_progress: impl FnMut(DownloadProgress),
) -> Result<PathBuf, WisperError> {
    use std::io::{Read, Write};

    std::fs::create_dir_all(bin_dir).map_err(|e| WisperError::Fetch(e.to_string()))?;
    let dest = bin_dir.join(yt_dlp_install_filename());
    if !force_refresh && dest.is_file() {
        if yt_dlp_runnable(&dest) {
            on_progress(DownloadProgress {
                percent: Some(100),
                status: "yt-dlp already installed.".into(),
                automatic: false,
            });
            return Ok(dest);
        }
        let _ = std::fs::remove_file(&dest);
    }

    let staging = dest.with_extension("part");

    on_progress(DownloadProgress {
        percent: Some(0),
        status: "Connecting to GitHub…".into(),
        automatic: force_refresh,
    });

    let response = http_get(yt_dlp_release_download_url())
        .map_err(|e| WisperError::Fetch(e.to_string()))?;

    let total = response
        .header("Content-Length")
        .and_then(|value| value.parse::<u64>().ok());

    let mut reader = response.into_reader();
    let mut file =
        std::fs::File::create(&staging).map_err(|e| WisperError::Fetch(e.to_string()))?;
    let mut downloaded: u64 = 0;
    let mut buffer = [0u8; 64 * 1024];

    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|e| WisperError::Fetch(e.to_string()))?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read])
            .map_err(|e| WisperError::Fetch(e.to_string()))?;
        downloaded += read as u64;
        let percent = total.map(|size| ((downloaded.saturating_mul(100)) / size.max(1)) as i32);
        let mb = downloaded / 1_000_000;
        on_progress(DownloadProgress {
            percent,
            status: format!("Downloading yt-dlp… {mb} MB"),
            automatic: force_refresh,
        });
    }

    file.flush()
        .map_err(|e| WisperError::Fetch(e.to_string()))?;
    drop(file);

    replace_verified_binary(&staging, &dest, yt_dlp_runnable)?;

    on_progress(DownloadProgress {
        percent: Some(100),
        status: if force_refresh {
            "yt-dlp update complete.".into()
        } else {
            "yt-dlp install complete.".into()
        },
        automatic: force_refresh,
    });
    Ok(dest)
}

pub fn yt_dlp_status(extra_candidates: &[PathBuf]) -> YtDlpStatus {
    match resolve_yt_dlp(extra_candidates) {
        Ok(path) => YtDlpStatus {
            available: true,
            path: Some(path.to_string_lossy().into_owned()),
            hint: "yt-dlp is ready for URL imports.".into(),
        },
        Err(_) => YtDlpStatus {
            available: false,
            path: None,
            hint: "Install yt-dlp from Advanced options (one-time download), or add yt-dlp to your PATH."
                .into(),
        },
    }
}

struct PartialDownloadGuard<'a> {
    output_dir: &'a Path,
    file_id: String,
    committed: bool,
}

impl Drop for PartialDownloadGuard<'_> {
    fn drop(&mut self) {
        if !self.committed {
            cleanup_partial_download(self.output_dir, &self.file_id);
        }
    }
}

fn cleanup_partial_download(output_dir: &Path, file_id: &str) {
    let Ok(entries) = std::fs::read_dir(output_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(file_id) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

fn parse_download_percent(line: &str) -> Option<i32> {
    let marker = "[download]";
    let rest = line.strip_prefix(marker)?.trim();
    if rest.starts_with("100") {
        return Some(100);
    }
    let pct = rest.split('%').next()?.trim();
    pct.parse::<f32>().ok().map(|v| v.round() as i32)
}

/// Download best available audio via yt-dlp into `output_dir`.
pub fn download_url(
    yt_dlp: &Path,
    url: &str,
    output_dir: &Path,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(DownloadProgress) + Send,
) -> Result<UrlDownloadResult, WisperError> {
    std::fs::create_dir_all(output_dir).map_err(|e| WisperError::Fetch(e.to_string()))?;

    let source_url = normalize_url(url)?;
    let file_id = Uuid::new_v4().to_string();
    let mut download_guard = PartialDownloadGuard {
        output_dir,
        file_id: file_id.clone(),
        committed: false,
    };
    let output_template = output_dir.join(format!("{file_id}.%(ext)s"));
    let output_arg = output_template.to_string_lossy().into_owned();

    on_progress(DownloadProgress::with_status(None, "Starting download…"));

    if !yt_dlp_runnable(yt_dlp) {
        return Err(WisperError::Fetch(
            "yt-dlp is not runnable on this system — use Advanced options to reinstall yt-dlp"
                .into(),
        ));
    }

    let mut child = command_for_binary(yt_dlp)
        .args([
            "--no-playlist",
            "--newline",
            "--progress",
            "--no-warnings",
            "-f",
            "ba/b",
            "-x",
            "--audio-format",
            "m4a",
            "-o",
            &output_arg,
            "--print",
            "%(title)s",
            "--print",
            "after_move:filepath",
            &source_url,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| WisperError::Fetch(format!("failed to run yt-dlp: {e}")))?;

    if cancel.load(Ordering::Relaxed) {
        let _ = child.kill();
        return Err(WisperError::Cancelled);
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| WisperError::Fetch("yt-dlp stdout unavailable".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| WisperError::Fetch("yt-dlp stderr unavailable".into()))?;

    let stdout_handle = thread::spawn(move || {
        BufReader::new(stdout)
            .lines()
            .collect::<Result<Vec<String>, _>>()
    });

    let reader = BufReader::new(stderr);

    for line in reader.lines() {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            return Err(WisperError::Cancelled);
        }
        let line = line.map_err(|e| WisperError::Fetch(e.to_string()))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(percent) = parse_download_percent(trimmed) {
            on_progress(DownloadProgress::with_status(Some(percent), trimmed));
        } else if trimmed.starts_with("[ExtractAudio]") || trimmed.starts_with("[Merger]") {
            on_progress(DownloadProgress::with_status(None, trimmed));
        }
    }

    let status = child
        .wait()
        .map_err(|e| WisperError::Fetch(format!("yt-dlp wait failed: {e}")))?;

    if cancel.load(Ordering::Relaxed) {
        return Err(WisperError::Cancelled);
    }

    if !status.success() {
        return Err(WisperError::Fetch(format!(
            "yt-dlp exited with status {status}"
        )));
    }

    let mut stdout_lines: Vec<String> = stdout_handle
        .join()
        .map_err(|_| WisperError::Fetch("yt-dlp stdout reader failed".into()))?
        .map_err(|e| WisperError::Fetch(e.to_string()))?
        .into_iter()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    let filepath = stdout_lines
        .pop()
        .ok_or_else(|| WisperError::Fetch("yt-dlp did not return output path".into()))?;
    let title = stdout_lines
        .pop()
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "Imported audio".into());

    let audio_path = PathBuf::from(&filepath);
    if !audio_path.is_file() {
        return Err(WisperError::Fetch(format!(
            "downloaded file missing: {filepath}"
        )));
    }

    on_progress(DownloadProgress::with_status(Some(100), "Download complete"));

    download_guard.committed = true;

    Ok(UrlDownloadResult {
        audio_path,
        title,
        source_url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    #[test]
    fn normalize_url_rejects_private_targets() {
        for url in [
            "http://127.0.0.1/video",
            "http://localhost/watch",
            "http://192.168.0.1/stream",
            "http://10.0.0.5/file",
            "http://169.254.169.254/latest/meta-data",
            "https://user:pass@example.com/video",
        ] {
            assert!(
                normalize_url(url).is_err(),
                "expected blocked URL: {url}"
            );
        }
    }

    #[test]
    fn normalize_url_accepts_public_http_urls() {
        let url = normalize_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ").expect("public url");
        assert!(url.starts_with("https://www.youtube.com/"));
    }

    #[test]
    fn yt_dlp_install_filename_matches_platform() {
        let name = yt_dlp_install_filename();
        #[cfg(windows)]
        assert_eq!(name, "yt-dlp.exe");
        #[cfg(not(windows))]
        assert_eq!(name, "yt-dlp");
    }

    #[test]
    fn yt_dlp_release_url_is_https_github() {
        let url = yt_dlp_release_download_url();
        assert!(url.starts_with("https://github.com/yt-dlp/yt-dlp/releases/latest/download/"));
    }

    #[test]
    fn yt_dlp_release_url_matches_platform() {
        let url = yt_dlp_release_download_url();
        #[cfg(windows)]
        assert!(url.ends_with("yt-dlp.exe"));
        #[cfg(target_os = "macos")]
        assert!(url.ends_with("yt-dlp_macos"));
        #[cfg(all(not(windows), not(target_os = "macos")))]
        assert!(url.ends_with("/yt-dlp"));
    }

    #[test]
    fn cleanup_partial_download_removes_matching_files() {
        let dir = std::env::temp_dir().join(format!(
            "wisper-fetch-cleanup-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let file_id = "abc-123-def";

        let partial = dir.join(format!("{file_id}.m4a.part"));
        let complete = dir.join(format!("{file_id}.m4a"));
        let other = dir.join("other-recording.m4a");

        File::create(&partial)
            .and_then(|mut f| f.write_all(b"x"))
            .expect("partial file");
        File::create(&complete)
            .and_then(|mut f| f.write_all(b"x"))
            .expect("complete file");
        File::create(&other)
            .and_then(|mut f| f.write_all(b"x"))
            .expect("other file");

        cleanup_partial_download(&dir, file_id);

        assert!(!partial.exists());
        assert!(!complete.exists());
        assert!(other.exists());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
