use std::fs::File;
use std::io::{copy, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use crate::error::WisperError;
use crate::fetch::DownloadProgress;

#[derive(Debug, Clone, serde::Serialize)]
pub struct FfmpegStatus {
    pub available: bool,
    pub path: Option<String>,
    pub hint: String,
}

static FFMPEG_CANDIDATES: OnceLock<Vec<PathBuf>> = OnceLock::new();

pub fn set_ffmpeg_candidates(candidates: Vec<PathBuf>) {
    let _ = FFMPEG_CANDIDATES.set(candidates);
}

fn configured_candidates() -> Vec<PathBuf> {
    FFMPEG_CANDIDATES.get().cloned().unwrap_or_default()
}

fn merge_candidates(extra_candidates: &[PathBuf]) -> Vec<PathBuf> {
    let mut all = extra_candidates.to_vec();
    for candidate in configured_candidates() {
        if !all.iter().any(|existing| existing == &candidate) {
            all.push(candidate);
        }
    }
    all
}

pub fn ffmpeg_install_filename() -> &'static str {
    if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    }
}

fn ffprobe_install_filename() -> &'static str {
    if cfg!(windows) {
        "ffprobe.exe"
    } else {
        "ffprobe"
    }
}

fn ffmpeg_archive_url() -> &'static str {
    if cfg!(windows) {
        "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-macosarm64-gpl.zip"
        } else {
            "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-macos64-gpl.zip"
        }
    } else {
        "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz"
    }
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

fn binary_runnable(path: &Path) -> bool {
    Command::new(path)
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn resolve_ffmpeg_from(candidates: &[PathBuf]) -> Result<PathBuf, WisperError> {
    for candidate in candidates {
        if candidate.is_file() && binary_runnable(candidate) {
            return Ok(candidate.clone());
        }
    }

    if let Some(path) = find_in_path(ffmpeg_install_filename()) {
        if binary_runnable(&path) {
            return Ok(path);
        }
    }

    Err(WisperError::Fetch(
        "ffmpeg not found. Install it from Advanced options in Wisper, or add ffmpeg to your PATH."
            .into(),
    ))
}

/// Resolve ffmpeg from configured candidates, then PATH.
pub fn resolve_ffmpeg() -> Result<PathBuf, WisperError> {
    resolve_ffmpeg_from(&configured_candidates())
}

pub fn resolve_ffprobe() -> Option<PathBuf> {
    if let Ok(ffmpeg) = resolve_ffmpeg() {
        if let Some(parent) = ffmpeg.parent() {
            let probe = parent.join(ffprobe_install_filename());
            if probe.is_file() && binary_runnable(&probe) {
                return Some(probe);
            }
        }
    }

    find_in_path(ffprobe_install_filename()).filter(|p| binary_runnable(p))
}

pub fn ffmpeg_status(extra_candidates: &[PathBuf]) -> FfmpegStatus {
    match resolve_ffmpeg_from(&merge_candidates(extra_candidates)) {
        Ok(path) => FfmpegStatus {
            available: true,
            path: Some(path.to_string_lossy().into_owned()),
            hint: "ffmpeg is ready for full-length MP3 and video decode.".into(),
        },
        Err(_) => FfmpegStatus {
            available: false,
            path: None,
            hint: "Install ffmpeg from Advanced options for reliable MP3/video import, or add ffmpeg to your PATH.".into(),
        },
    }
}

fn archive_is_zip() -> bool {
    cfg!(windows) || cfg!(target_os = "macos")
}

fn entry_is_ffmpeg_path(normalized: &str) -> bool {
    normalized.ends_with("/bin/ffmpeg")
        || normalized.ends_with("/bin/ffmpeg.exe")
        || normalized == "bin/ffmpeg"
        || normalized == "bin/ffmpeg.exe"
}

fn entry_is_ffprobe_path(normalized: &str) -> bool {
    normalized.ends_with("/bin/ffprobe")
        || normalized.ends_with("/bin/ffprobe.exe")
        || normalized == "bin/ffprobe"
        || normalized == "bin/ffprobe.exe"
}

fn write_zip_entry(
    entry: &mut zip::read::ZipFile<'_>,
    dest: &Path,
) -> Result<(), WisperError> {
    let mut out = File::create(dest).map_err(|e| WisperError::Fetch(e.to_string()))?;
    copy(entry, &mut out).map_err(|e| WisperError::Fetch(e.to_string()))?;
    out.flush().map_err(|e| WisperError::Fetch(e.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = out
            .metadata()
            .map_err(|e| WisperError::Fetch(e.to_string()))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(dest, perms).map_err(|e| WisperError::Fetch(e.to_string()))?;
    }
    Ok(())
}

fn extract_ffmpeg_zip(archive_path: &Path, bin_dir: &Path) -> Result<(), WisperError> {
    let file = File::open(archive_path).map_err(|e| WisperError::Fetch(e.to_string()))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| WisperError::Fetch(e.to_string()))?;
    let mut got_ffmpeg = false;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| WisperError::Fetch(e.to_string()))?;
        let normalized = entry.name().replace('\\', "/");
        if entry_is_ffmpeg_path(&normalized) {
            write_zip_entry(&mut entry, &bin_dir.join(ffmpeg_install_filename()))?;
            got_ffmpeg = true;
        } else if entry_is_ffprobe_path(&normalized) {
            write_zip_entry(&mut entry, &bin_dir.join(ffprobe_install_filename()))?;
        }
    }
    if !got_ffmpeg {
        return Err(WisperError::Fetch(
            "ffmpeg binary not found inside downloaded archive".into(),
        ));
    }
    Ok(())
}

fn extract_tar_entry(
    entry: &mut tar::Entry<'_, impl Read>,
    dest: &Path,
) -> Result<(), WisperError> {
    let mut out = File::create(dest).map_err(|e| WisperError::Fetch(e.to_string()))?;
    copy(entry, &mut out).map_err(|e| WisperError::Fetch(e.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(dest)
            .map_err(|e| WisperError::Fetch(e.to_string()))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(dest, perms).map_err(|e| WisperError::Fetch(e.to_string()))?;
    }
    Ok(())
}

fn extract_ffmpeg_tar_xz(archive_path: &Path, bin_dir: &Path) -> Result<(), WisperError> {
    let file = File::open(archive_path).map_err(|e| WisperError::Fetch(e.to_string()))?;
    let decoder = xz2::read::XzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    let mut got_ffmpeg = false;
    for entry in archive.entries().map_err(|e| WisperError::Fetch(e.to_string()))? {
        let mut entry = entry.map_err(|e| WisperError::Fetch(e.to_string()))?;
        let path = entry.path().map_err(|e| WisperError::Fetch(e.to_string()))?;
        let normalized = path.to_string_lossy().replace('\\', "/");
        if entry_is_ffmpeg_path(&normalized) {
            extract_tar_entry(&mut entry, &bin_dir.join(ffmpeg_install_filename()))?;
            got_ffmpeg = true;
        } else if entry_is_ffprobe_path(&normalized) {
            extract_tar_entry(&mut entry, &bin_dir.join(ffprobe_install_filename()))?;
        }
    }
    if !got_ffmpeg {
        return Err(WisperError::Fetch(
            "ffmpeg binary not found inside downloaded archive".into(),
        ));
    }
    Ok(())
}

fn ffmpeg_already_installed(dest: &Path) -> bool {
    dest.is_file()
        && std::fs::metadata(dest)
            .map(|m| m.len() > 1_000_000)
            .unwrap_or(false)
        && binary_runnable(dest)
}

/// Download BtbN static ffmpeg build into `bin_dir`.
pub fn download_ffmpeg(
    bin_dir: &Path,
    mut on_progress: impl FnMut(DownloadProgress),
) -> Result<PathBuf, WisperError> {
    std::fs::create_dir_all(bin_dir).map_err(|e| WisperError::Fetch(e.to_string()))?;
    let dest = bin_dir.join(ffmpeg_install_filename());
    if ffmpeg_already_installed(&dest) {
        on_progress(DownloadProgress {
            percent: Some(100),
            status: "ffmpeg already installed.".into(),
        });
        return Ok(dest);
    }
    if dest.is_file() {
        let _ = std::fs::remove_file(&dest);
    }
    let probe_dest = bin_dir.join(ffprobe_install_filename());
    if probe_dest.is_file() {
        let _ = std::fs::remove_file(&probe_dest);
    }

    let archive_ext = if archive_is_zip() { "zip" } else { "tar.xz" };
    let archive_path = bin_dir.join(format!("ffmpeg-download.{archive_ext}"));
    if archive_path.exists() {
        let _ = std::fs::remove_file(&archive_path);
    }

    on_progress(DownloadProgress {
        percent: Some(0),
        status: "Connecting to GitHub…".into(),
    });

    let response = ureq::get(ffmpeg_archive_url())
        .call()
        .map_err(|e| WisperError::Fetch(e.to_string()))?;

    let total = response
        .header("Content-Length")
        .and_then(|value| value.parse::<u64>().ok());

    let mut reader = response.into_reader();
    let mut file =
        File::create(&archive_path).map_err(|e| WisperError::Fetch(e.to_string()))?;
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
            status: format!("Downloading ffmpeg… {mb} MB"),
        });
    }
    file.flush()
        .map_err(|e| WisperError::Fetch(e.to_string()))?;
    drop(file);

    on_progress(DownloadProgress {
        percent: None,
        status: "Extracting ffmpeg…".into(),
    });

    if archive_is_zip() {
        extract_ffmpeg_zip(&archive_path, bin_dir)?;
    } else {
        extract_ffmpeg_tar_xz(&archive_path, bin_dir)?;
    }
    let _ = std::fs::remove_file(&archive_path);

    if !ffmpeg_already_installed(&dest) {
        return Err(WisperError::Fetch(
            "ffmpeg install failed verification".into(),
        ));
    }

    on_progress(DownloadProgress {
        percent: Some(100),
        status: "ffmpeg install complete.".into(),
    });
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ffmpeg_archive_url_is_https() {
        assert!(ffmpeg_archive_url().starts_with("https://github.com/BtbN/FFmpeg-Builds/"));
    }

    #[test]
    fn entry_matchers_find_bin_paths() {
        assert!(entry_is_ffmpeg_path("ffmpeg-master/bin/ffmpeg"));
        assert!(entry_is_ffmpeg_path("ffmpeg-master/bin/ffmpeg.exe"));
        assert!(entry_is_ffprobe_path("ffmpeg-master/bin/ffprobe.exe"));
    }
}
