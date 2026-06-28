//! Post-download prep for managed yt-dlp/ffmpeg binaries (permissions, macOS signing).

use std::path::Path;
use std::process::{Command, Stdio};

use crate::error::WisperError;

const HTTP_USER_AGENT: &str = concat!(env!("CARGO_PKG_NAME"), "/", env!("CARGO_PKG_VERSION"));

/// User-Agent required for reliable GitHub release downloads.
pub fn http_user_agent() -> &'static str {
    HTTP_USER_AGENT
}

pub fn http_get(url: &str) -> Result<ureq::Response, ureq::Error> {
    ureq::get(url).set("User-Agent", HTTP_USER_AGENT).call()
}

/// Spawn a helper binary without flashing a console window on Windows.
pub fn command_for_binary(path: &Path) -> Command {
    let mut cmd = Command::new(path);
    hide_console_window(&mut cmd);
    cmd
}

#[cfg(windows)]
fn hide_console_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console_window(_cmd: &mut Command) {}

/// Mark a downloaded helper binary executable and macOS-runnable.
pub fn prepare_managed_binary(path: &Path) -> Result<(), WisperError> {
    #[cfg(unix)]
    set_unix_executable(path)?;

    #[cfg(target_os = "macos")]
    macos_adhoc_sign(path)?;

    #[cfg(not(any(unix, target_os = "macos")))]
    let _ = path;

    Ok(())
}

#[cfg(unix)]
fn set_unix_executable(path: &Path) -> Result<(), WisperError> {
    use std::os::unix::fs::PermissionsExt;

    let mut perms = std::fs::metadata(path)
        .map_err(|e| WisperError::Fetch(e.to_string()))?
        .permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(path, perms).map_err(|e| WisperError::Fetch(e.to_string()))?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn macos_adhoc_sign(path: &Path) -> Result<(), WisperError> {
    let _ = Command::new("xattr")
        .args(["-cr", path.to_string_lossy().as_ref()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    let status = Command::new("codesign")
        .args(["--force", "--sign", "-", path.to_string_lossy().as_ref()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| WisperError::Fetch(format!("codesign failed: {e}")))?;

    if !status.success() {
        return Err(WisperError::Fetch(
            "macOS could not sign the downloaded tool — try Install again or add the tool to PATH"
                .into(),
        ));
    }
    Ok(())
}

/// Verify `staging`, then replace `dest` without leaving `dest` missing on failure.
pub fn replace_verified_binary(
    staging: &Path,
    dest: &Path,
    verify: impl Fn(&Path) -> bool,
) -> Result<(), WisperError> {
    prepare_managed_binary(staging)?;
    if !verify(staging) {
        let _ = std::fs::remove_file(staging);
        let label = dest
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "binary".into());
        return Err(WisperError::Fetch(format!(
            "{label} install failed verification — downloaded binary did not run on this system"
        )));
    }

    if dest.is_file() {
        let backup = dest.with_extension("bak");
        let _ = std::fs::remove_file(&backup);
        if std::fs::rename(dest, &backup).is_ok() {
            if std::fs::rename(staging, dest).is_err() {
                let _ = std::fs::rename(&backup, dest);
                return Err(WisperError::Fetch(
                    "could not replace managed tool binary".into(),
                ));
            }
            let _ = std::fs::remove_file(&backup);
        } else {
            std::fs::remove_file(dest).map_err(|e| WisperError::Fetch(e.to_string()))?;
            std::fs::rename(staging, dest).map_err(|e| WisperError::Fetch(e.to_string()))?;
        }
    } else {
        std::fs::rename(staging, dest).map_err(|e| WisperError::Fetch(e.to_string()))?;
    }

    Ok(())
}

pub fn binary_runnable(path: &Path, version_flag: &str) -> bool {
    command_for_binary(path)
        .arg(version_flag)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

pub fn yt_dlp_runnable(path: &Path) -> bool {
    binary_runnable(path, "--version")
}

pub fn ffmpeg_runnable(path: &Path) -> bool {
    binary_runnable(path, "-version")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_user_agent_is_set() {
        assert!(!http_user_agent().is_empty());
    }
}
