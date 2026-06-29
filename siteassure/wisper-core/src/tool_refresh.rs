//! Background refresh for yt-dlp/ffmpeg copies installed under app data `bin/`.

use std::path::Path;
use std::time::Duration;

use crate::error::WisperError;
use crate::ffmpeg_tools::{download_ffmpeg, ffmpeg_install_filename};
use crate::fetch::{download_yt_dlp, yt_dlp_install_filename, DownloadProgress};

/// Re-download managed tools when their on-disk copy is older than this.
pub const MANAGED_TOOL_REFRESH_SECS: u64 = 7 * 24 * 60 * 60;

/// True when `path` exists and was last modified more than [`MANAGED_TOOL_REFRESH_SECS`] ago.
pub fn managed_tool_is_stale(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    let Ok(modified) = meta.modified() else {
        return false;
    };
    modified
        .elapsed()
        .map(|age| age > Duration::from_secs(MANAGED_TOOL_REFRESH_SECS))
        .unwrap_or(false)
}

/// Re-download stale managed yt-dlp/ffmpeg binaries in `bin_dir` (app data only).
pub fn refresh_stale_managed_tools(
    bin_dir: &Path,
    mut on_yt_dlp: impl FnMut(DownloadProgress),
    mut on_ffmpeg: impl FnMut(DownloadProgress),
) -> Result<(), WisperError> {
    let yt_dest = bin_dir.join(yt_dlp_install_filename());
    if managed_tool_is_stale(&yt_dest) {
        download_yt_dlp(bin_dir, true, |progress| on_yt_dlp(progress))?;
    }

    let ffmpeg_dest = bin_dir.join(ffmpeg_install_filename());
    if managed_tool_is_stale(&ffmpeg_dest) {
        download_ffmpeg(bin_dir, true, |progress| on_ffmpeg(progress))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::SystemTime;

    #[test]
    fn missing_tool_is_not_stale() {
        let dir = std::env::temp_dir().join(format!("wisper-stale-{}", uuid::Uuid::new_v4()));
        let path = dir.join("missing.bin");
        assert!(!managed_tool_is_stale(&path));
    }

    #[test]
    fn fresh_tool_is_not_stale() {
        let dir = std::env::temp_dir().join(format!("wisper-stale-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("tool.bin");
        fs::write(&path, b"ok").unwrap();
        assert!(!managed_tool_is_stale(&path));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn old_tool_is_stale() {
        use std::fs::OpenOptions;

        let dir = std::env::temp_dir().join(format!("wisper-stale-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("tool.bin");
        fs::write(&path, b"ok").unwrap();
        let old = SystemTime::now() - Duration::from_secs(MANAGED_TOOL_REFRESH_SECS + 3600);
        OpenOptions::new()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(old)
            .unwrap();
        assert!(managed_tool_is_stale(&path));
        let _ = fs::remove_dir_all(dir);
    }
}
