use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;

use uuid::Uuid;

use crate::error::WisperError;

#[derive(Debug, Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub percent: Option<i32>,
    pub status: String,
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
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err(WisperError::Fetch(
            "URL must start with http:// or https://".into(),
        ));
    }
    Ok(trimmed.to_string())
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
        if candidate.is_file() {
            return Ok(candidate.clone());
        }
    }

    #[cfg(windows)]
    {
        if let Some(path) = find_in_path("yt-dlp.exe") {
            return Ok(path);
        }
    }

    if let Some(path) = find_in_path("yt-dlp") {
        return Ok(path);
    }

    Err(WisperError::Fetch(
        "yt-dlp not found. Install it (e.g. winget install yt-dlp) and restart Wisper.".into(),
    ))
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
            hint: "Install yt-dlp to import from YouTube and other sites: winget install yt-dlp"
                .into(),
        },
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
    let output_template = output_dir.join(format!("{file_id}.%(ext)s"));
    let output_arg = output_template.to_string_lossy().into_owned();

    on_progress(DownloadProgress {
        percent: None,
        status: "Starting download…".into(),
    });

    let mut child = Command::new(yt_dlp)
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
            on_progress(DownloadProgress {
                percent: Some(percent),
                status: trimmed.to_string(),
            });
        } else if trimmed.starts_with("[ExtractAudio]") || trimmed.starts_with("[Merger]") {
            on_progress(DownloadProgress {
                percent: None,
                status: trimmed.to_string(),
            });
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

    on_progress(DownloadProgress {
        percent: Some(100),
        status: "Download complete".into(),
    });

    Ok(UrlDownloadResult {
        audio_path,
        title,
        source_url,
    })
}
