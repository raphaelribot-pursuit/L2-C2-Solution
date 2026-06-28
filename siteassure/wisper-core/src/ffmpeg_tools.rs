use std::fs::File;
use std::io::{copy, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use crate::error::WisperError;
use crate::fetch::DownloadProgress;
use crate::managed_binary::{ffmpeg_runnable, http_get, prepare_managed_binary, replace_verified_binary};

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
    } else if cfg!(target_os = "linux") {
        "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz"
    } else {
        // macOS uses split archives — see `macos_ffmpeg_sources`.
        ""
    }
}

#[cfg(target_os = "macos")]
fn macos_ffmpeg_sources() -> &'static [(&'static str, &'static str)] {
    if cfg!(target_arch = "aarch64") {
        &[(
            "https://www.osxexperts.net/ffmpeg80arm.zip",
            "https://www.osxexperts.net/ffprobe80arm.zip",
        )]
    } else {
        &[
            (
                "https://evermeet.cx/ffmpeg/getrelease/zip",
                "https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip",
            ),
            (
                "https://www.osxexperts.net/ffmpeg80intel.zip",
                "https://www.osxexperts.net/ffprobe80intel.zip",
            ),
        ]
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
    ffmpeg_runnable(path)
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
    entry_is_tool_path(normalized, "ffmpeg")
}

fn entry_is_ffprobe_path(normalized: &str) -> bool {
    entry_is_tool_path(normalized, "ffprobe")
}

fn entry_is_tool_path(normalized: &str, tool: &str) -> bool {
    normalized.ends_with(&format!("/bin/{tool}"))
        || normalized.ends_with(&format!("/bin/{tool}.exe"))
        || normalized == format!("bin/{tool}")
        || normalized == format!("bin/{tool}.exe")
        || normalized.ends_with(&format!("/{tool}"))
        || normalized.ends_with(&format!("/{tool}.exe"))
        || normalized == tool
        || normalized == format!("{tool}.exe")
}

fn write_zip_entry(
    entry: &mut zip::read::ZipFile<'_>,
    dest: &Path,
) -> Result<(), WisperError> {
    let mut out = File::create(dest).map_err(|e| WisperError::Fetch(e.to_string()))?;
    copy(entry, &mut out).map_err(|e| WisperError::Fetch(e.to_string()))?;
    out.flush().map_err(|e| WisperError::Fetch(e.to_string()))?;
    drop(out);
    prepare_managed_binary(dest)?;
    Ok(())
}

fn extract_tool_zip(
    archive_path: &Path,
    bin_dir: &Path,
    tool: &str,
    dest_name: &str,
) -> Result<(), WisperError> {
    let file = File::open(archive_path).map_err(|e| WisperError::Fetch(e.to_string()))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| WisperError::Fetch(e.to_string()))?;
    let dest = bin_dir.join(dest_name);
    let mut found = false;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| WisperError::Fetch(e.to_string()))?;
        if entry.is_dir() {
            continue;
        }
        let normalized = entry.name().replace('\\', "/");
        if entry_is_tool_path(&normalized, tool) {
            write_zip_entry(&mut entry, &dest)?;
            found = true;
            break;
        }
    }
    if !found {
        return Err(WisperError::Fetch(format!(
            "{tool} binary not found inside downloaded archive"
        )));
    }
    Ok(())
}

fn stream_http_to_file(
    url: &str,
    archive_path: &Path,
    status_label: &str,
    force_refresh: bool,
    mut on_progress: impl FnMut(DownloadProgress),
) -> Result<(), WisperError> {
    on_progress(DownloadProgress {
        percent: Some(0),
        status: format!("Connecting for {status_label}…"),
        automatic: force_refresh,
    });

    let response = http_get(url).map_err(|e| WisperError::Fetch(e.to_string()))?;
    let total = response
        .header("Content-Length")
        .and_then(|value| value.parse::<u64>().ok());

    let mut reader = response.into_reader();
    let mut file =
        File::create(archive_path).map_err(|e| WisperError::Fetch(e.to_string()))?;
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
            status: format!("Downloading {status_label}… {mb} MB"),
            automatic: force_refresh,
        });
    }

    file.flush()
        .map_err(|e| WisperError::Fetch(e.to_string()))?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn download_ffmpeg_macos(
    bin_dir: &Path,
    dest: &Path,
    force_refresh: bool,
    mut on_progress: impl FnMut(DownloadProgress),
) -> Result<(), WisperError> {
    let mut last_err = WisperError::Fetch("no macOS ffmpeg source succeeded".into());
    for (ffmpeg_url, ffprobe_url) in macos_ffmpeg_sources() {
        let ffmpeg_archive = bin_dir.join("ffmpeg-download.zip");
        let ffprobe_archive = bin_dir.join("ffprobe-download.zip");
        let _ = std::fs::remove_file(&ffmpeg_archive);
        let _ = std::fs::remove_file(&ffprobe_archive);

        let staging_ffmpeg = bin_dir.join(format!("{}.new", ffmpeg_install_filename()));
        let staging_probe = bin_dir.join(format!("{}.new", ffprobe_install_filename()));
        let _ = std::fs::remove_file(&staging_ffmpeg);
        let _ = std::fs::remove_file(&staging_probe);

        let attempt = (|| {
            stream_http_to_file(
                ffmpeg_url,
                &ffmpeg_archive,
                "ffmpeg",
                force_refresh,
                |progress| on_progress(progress),
            )?;
            on_progress(DownloadProgress {
                percent: None,
                status: "Extracting ffmpeg…".into(),
                automatic: force_refresh,
            });
            extract_tool_zip(
                &ffmpeg_archive,
                bin_dir,
                "ffmpeg",
                &format!("{}.new", ffmpeg_install_filename()),
            )?;

            stream_http_to_file(
                ffprobe_url,
                &ffprobe_archive,
                "ffprobe",
                force_refresh,
                |progress| on_progress(progress),
            )?;
            on_progress(DownloadProgress {
                percent: None,
                status: "Extracting ffprobe…".into(),
                automatic: force_refresh,
            });
            extract_tool_zip(
                &ffprobe_archive,
                bin_dir,
                "ffprobe",
                &format!("{}.new", ffprobe_install_filename()),
            )?;

            replace_verified_binary(&staging_ffmpeg, dest, ffmpeg_runnable)?;
            replace_verified_binary(
                &staging_probe,
                &bin_dir.join(ffprobe_install_filename()),
                ffmpeg_runnable,
            )?;

            if !ffmpeg_already_installed(dest) {
                return Err(WisperError::Fetch(
                    "ffmpeg install failed verification".into(),
                ));
            }
            Ok(())
        })();

        let _ = std::fs::remove_file(&ffmpeg_archive);
        let _ = std::fs::remove_file(&ffprobe_archive);

        match attempt {
            Ok(()) => return Ok(()),
            Err(err) => last_err = err,
        }
    }

    Err(last_err)
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
    drop(out);
    prepare_managed_binary(dest)?;
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
    force_refresh: bool,
    mut on_progress: impl FnMut(DownloadProgress),
) -> Result<PathBuf, WisperError> {
    std::fs::create_dir_all(bin_dir).map_err(|e| WisperError::Fetch(e.to_string()))?;
    let dest = bin_dir.join(ffmpeg_install_filename());
    if !force_refresh && ffmpeg_already_installed(&dest) {
        on_progress(DownloadProgress {
            percent: Some(100),
            status: "ffmpeg already installed.".into(),
            automatic: false,
        });
        return Ok(dest);
    }

    #[cfg(target_os = "macos")]
    {
        download_ffmpeg_macos(&bin_dir, &dest, force_refresh, |progress| {
            on_progress(progress);
        })?;
        on_progress(DownloadProgress {
            percent: Some(100),
            status: if force_refresh {
                "ffmpeg update complete.".into()
            } else {
                "ffmpeg install complete.".into()
            },
            automatic: force_refresh,
        });
        return Ok(dest);
    }

    let archive_ext = if archive_is_zip() { "zip" } else { "tar.xz" };
    let archive_path = bin_dir.join(format!("ffmpeg-download.{archive_ext}"));
    if archive_path.exists() {
        let _ = std::fs::remove_file(&archive_path);
    }

    on_progress(DownloadProgress {
        percent: Some(0),
        status: "Connecting to GitHub…".into(),
        automatic: force_refresh,
    });

    stream_http_to_file(
        ffmpeg_archive_url(),
        &archive_path,
        "ffmpeg",
        force_refresh,
        |progress| on_progress(progress),
    )?;

    on_progress(DownloadProgress {
        percent: None,
        status: "Extracting ffmpeg…".into(),
        automatic: force_refresh,
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
        status: if force_refresh {
            "ffmpeg update complete.".into()
        } else {
            "ffmpeg install complete.".into()
        },
        automatic: force_refresh,
    });
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ffmpeg_archive_url_is_https() {
        let url = ffmpeg_archive_url();
        if cfg!(target_os = "macos") {
            assert!(url.is_empty());
        } else {
            assert!(url.starts_with("https://github.com/BtbN/FFmpeg-Builds/"));
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_ffmpeg_sources_are_https() {
        for (ffmpeg, ffprobe) in macos_ffmpeg_sources() {
            assert!(ffmpeg.starts_with("https://"));
            assert!(ffprobe.starts_with("https://"));
        }
    }

    #[test]
    fn entry_matchers_find_bin_paths() {
        assert!(entry_is_ffmpeg_path("ffmpeg-master/bin/ffmpeg"));
        assert!(entry_is_ffmpeg_path("ffmpeg-master/bin/ffmpeg.exe"));
        assert!(entry_is_ffmpeg_path("ffmpeg"));
        assert!(entry_is_ffprobe_path("ffmpeg-master/bin/ffprobe.exe"));
        assert!(entry_is_ffprobe_path("ffprobe"));
    }
}
