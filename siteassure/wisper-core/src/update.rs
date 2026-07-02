use serde::{Deserialize, Serialize};

pub const GITHUB_REPO: &str = "raphaelribot-pursuit/L2-C2-Solution";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpdateCheckResult {
    pub available: bool,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub release_url: Option<String>,
    pub download_url: Option<String>,
    pub notes: Option<String>,
    pub check_error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GhRelease {
    tag_name: String,
    html_url: String,
    body: Option<String>,
    assets: Vec<GhAsset>,
}

#[derive(Debug, Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}

/// Check GitHub Releases for a version newer than `current_version`.
pub fn check_for_update(current_version: &str) -> UpdateCheckResult {
    let base = UpdateCheckResult {
        available: false,
        current_version: current_version.to_string(),
        latest_version: None,
        release_url: None,
        download_url: None,
        notes: None,
        check_error: None,
    };

    let url = format!("https://api.github.com/repos/{GITHUB_REPO}/releases/latest");
    let response = match ureq::get(&url)
        .set("User-Agent", "Wisper-Desktop")
        .set("Accept", "application/vnd.github+json")
        .call()
    {
        Ok(response) => response,
        Err(err) => {
            return UpdateCheckResult {
                check_error: Some(format!("Could not reach GitHub: {err}")),
                ..base
            };
        }
    };

    if !(200..300).contains(&response.status()) {
        return UpdateCheckResult {
            check_error: Some(format!(
                "GitHub returned HTTP {} while checking for updates.",
                response.status()
            )),
            ..base
        };
    }

    let body = match response.into_string() {
        Ok(body) => body,
        Err(err) => {
            return UpdateCheckResult {
                check_error: Some(format!("Could not read release info: {err}")),
                ..base
            };
        }
    };

    let release: GhRelease = match serde_json::from_str(&body) {
        Ok(release) => release,
        Err(err) => {
            return UpdateCheckResult {
                check_error: Some(format!("Could not parse release info: {err}")),
                ..base
            };
        }
    };

    let latest_version = normalize_tag(&release.tag_name).to_string();
    if !is_newer_version(&latest_version, current_version) {
        let up_to_date_version = if is_newer_version(current_version, &latest_version) {
            current_version.to_string()
        } else {
            latest_version
        };
        return UpdateCheckResult {
            latest_version: Some(up_to_date_version),
            ..base
        };
    }

    let download_url = pick_release_asset(&release.assets)
        .map(|asset| asset.browser_download_url.clone());
    let notes = release
        .body
        .as_deref()
        .map(trim_release_notes)
        .filter(|body| !body.is_empty());

    UpdateCheckResult {
        available: true,
        latest_version: Some(latest_version),
        release_url: Some(release.html_url),
        download_url,
        notes,
        ..base
    }
}

fn normalize_tag(tag: &str) -> &str {
    tag.strip_prefix('v').unwrap_or(tag)
}

fn is_newer_version(latest: &str, current: &str) -> bool {
    match (semver::Version::parse(latest), semver::Version::parse(current)) {
        (Ok(latest_ver), Ok(current_ver)) => latest_ver > current_ver,
        _ => false,
    }
}

fn trim_release_notes(body: &str) -> String {
    body.trim().to_string()
}

fn pick_release_asset<'a>(assets: &'a [GhAsset]) -> Option<&'a GhAsset> {
    let patterns = preferred_asset_patterns();
    for pattern in patterns {
        if let Some(asset) = assets.iter().find(|asset| asset.name.ends_with(pattern)) {
            return Some(asset);
        }
    }
    None
}

fn preferred_asset_patterns() -> &'static [&'static str] {
    if cfg!(target_os = "windows") {
        &["-setup.exe"]
    } else if cfg!(target_os = "linux") {
        &[".AppImage"]
    } else if cfg!(target_os = "macos") {
        if std::env::consts::ARCH == "aarch64" {
            &["_aarch64.dmg"]
        } else {
            &["_x64.dmg"]
        }
    } else {
        &[]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn beta_versions_compare_correctly() {
        assert!(is_newer_version("0.2.0-beta.17", "0.2.0-beta.16"));
        assert!(!is_newer_version("0.2.0-beta.16", "0.2.0-beta.16"));
        assert!(!is_newer_version("0.2.0-beta.15", "0.2.0-beta.16"));
    }

    #[test]
    fn normalize_tag_strips_v_prefix() {
        assert_eq!(normalize_tag("v0.2.0-beta.16"), "0.2.0-beta.16");
        assert_eq!(normalize_tag("0.2.0-beta.16"), "0.2.0-beta.16");
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn picks_windows_installer() {
        let assets = vec![GhAsset {
            name: "Wisper_0.2.0-beta.16_x64-setup.exe".into(),
            browser_download_url: "https://example.com/setup.exe".into(),
        }];
        assert_eq!(
            pick_release_asset(&assets).map(|asset| asset.name.as_str()),
            Some("Wisper_0.2.0-beta.16_x64-setup.exe")
        );
    }

    #[test]
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    fn picks_intel_mac_dmg_not_windows_exe() {
        let assets = vec![
            GhAsset {
                name: "Wisper_0.2.0-beta.16_x64-setup.exe".into(),
                browser_download_url: "https://example.com/setup.exe".into(),
            },
            GhAsset {
                name: "Wisper_0.2.0-beta.16_x64.dmg".into(),
                browser_download_url: "https://example.com/intel.dmg".into(),
            },
        ];
        assert_eq!(
            pick_release_asset(&assets).map(|asset| asset.name.as_str()),
            Some("Wisper_0.2.0-beta.16_x64.dmg")
        );
    }
}
