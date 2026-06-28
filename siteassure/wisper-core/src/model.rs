use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::fetch::DownloadProgress;
use crate::DEFAULT_MODEL_FILENAME;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StarterModel {
    Tiny,
    Base,
    LargeTurbo,
}

impl StarterModel {
    pub const ALL: [Self; 3] = [Self::Tiny, Self::Base, Self::LargeTurbo];

    pub fn from_key(key: &str) -> Option<Self> {
        match key.trim().to_lowercase().as_str() {
            "tiny" | "small" => Some(Self::Tiny),
            "base" | "medium" => Some(Self::Base),
            "large-turbo" | "large" => Some(Self::LargeTurbo),
            _ => None,
        }
    }

    pub fn download_key(self) -> &'static str {
        match self {
            Self::Tiny => "tiny",
            Self::Base => "base",
            Self::LargeTurbo => "large-turbo",
        }
    }

    pub fn file_name(self) -> &'static str {
        match self {
            Self::Tiny => "ggml-tiny.en.bin",
            Self::Base => "ggml-base.en.bin",
            Self::LargeTurbo => "ggml-large-v3-turbo.bin",
        }
    }

    pub fn url(self) -> &'static str {
        match self {
            Self::Tiny => {
                "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin"
            }
            Self::Base => {
                "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
            }
            Self::LargeTurbo => {
                "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"
            }
        }
    }

    pub fn size_label(self) -> &'static str {
        match self {
            Self::Tiny => "~75 MB",
            Self::Base => "~150 MB",
            Self::LargeTurbo => "~1.6 GB",
        }
    }

    pub fn tier_label(self) -> &'static str {
        match self {
            Self::Tiny => "Small",
            Self::Base => "Medium",
            Self::LargeTurbo => "Large",
        }
    }

    /// Minimum on-disk size for a valid GGML file (guards truncated/wrong downloads).
    pub fn min_size_bytes(self) -> u64 {
        match self {
            Self::Tiny => 50_000_000,
            Self::Base => 100_000_000,
            Self::LargeTurbo => 500_000_000,
        }
    }
}

/// True when `path` exists and meets the minimum size for `model`.
pub fn is_model_file_valid(path: &Path, model: StarterModel) -> bool {
    model_file_valid(path, model)
}

fn model_file_valid(path: &Path, model: StarterModel) -> bool {
    path.is_file()
        && std::fs::metadata(path)
            .map(|meta| meta.len() >= model.min_size_bytes())
            .unwrap_or(false)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ModelStatus {
    pub path: String,
    pub models_dir: String,
    pub ready: bool,
    pub hint: String,
    /// Download keys for tiers with a `.bin` present (`tiny`, `base`, `large-turbo`).
    pub installed: Vec<String>,
}

/// Path for the requested tier, or legacy resolution when `tier_key` is absent.
pub fn resolve_model_path_for_tier(models_dir: &Path, tier_key: Option<&str>) -> PathBuf {
    if let Some(model) = tier_key.and_then(StarterModel::from_key) {
        return models_dir.join(model.file_name());
    }
    resolve_model_path(models_dir)
}

/// Resolve the whisper model file under `models_dir`.
/// Prefers `DEFAULT_MODEL_FILENAME`, otherwise uses the only `.bin` present.
pub fn resolve_model_path(models_dir: &Path) -> PathBuf {
    let preferred = models_dir.join(DEFAULT_MODEL_FILENAME);
    if preferred.is_file() {
        return preferred;
    }

    let mut bins: Vec<PathBuf> = std::fs::read_dir(models_dir)
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && path.extension().is_some_and(|ext| ext == "bin"))
        .collect();

    bins.sort();

    if bins.len() == 1 {
        return bins.remove(0);
    }

    preferred
}

pub fn installed_model_keys(models_dir: &Path) -> Vec<String> {
    StarterModel::ALL
        .iter()
        .filter(|model| model_file_valid(&models_dir.join(model.file_name()), **model))
        .map(|model| model.download_key().to_string())
        .collect()
}

/// Report whether the requested tier's GGML model exists under `models_dir`.
pub fn model_status_for_tier(models_dir: &Path, tier_key: Option<&str>) -> ModelStatus {
    let tier = tier_key
        .and_then(StarterModel::from_key)
        .unwrap_or(StarterModel::Base);
    let path = models_dir.join(tier.file_name());
    let ready = path.is_file();
    let installed = installed_model_keys(models_dir);
    let hint = if ready {
        format!("{} model is ready.", tier.tier_label())
    } else if installed.is_empty() {
        "No speech model yet — open Get started to download one.".into()
    } else {
        format!(
            "{} model not installed — download it or choose an installed size.",
            tier.tier_label()
        )
    };

    ModelStatus {
        path: path.to_string_lossy().into_owned(),
        models_dir: models_dir.to_string_lossy().into_owned(),
        ready,
        hint,
        installed,
    }
}

/// Report whether a usable GGML model file exists under `models_dir` (legacy: any single bin).
pub fn model_status(models_dir: &Path) -> ModelStatus {
    model_status_for_tier(models_dir, None)
}

/// Copy a user-selected `.bin` model into `models_dir`.
pub fn import_model_file(source: &Path, models_dir: &Path) -> Result<PathBuf, crate::WisperError> {
    if !source.is_file() {
        return Err(crate::WisperError::Fetch(format!(
            "file not found: {}",
            source.display()
        )));
    }
    if source.extension().and_then(|ext| ext.to_str()) != Some("bin") {
        return Err(crate::WisperError::Fetch(
            "choose a .bin speech model file".into(),
        ));
    }
    std::fs::create_dir_all(models_dir).map_err(|e| crate::WisperError::Fetch(e.to_string()))?;
    let file_name = source
        .file_name()
        .ok_or_else(|| crate::WisperError::Fetch("invalid file name".into()))?;
    let dest = models_dir.join(file_name);
    std::fs::copy(source, &dest).map_err(|e| crate::WisperError::Fetch(e.to_string()))?;
    Ok(dest)
}

/// Download a fixed starter model from Hugging Face (allowlisted URL only).
pub fn download_starter_model(
    models_dir: &Path,
    model: StarterModel,
    mut on_progress: impl FnMut(DownloadProgress),
) -> Result<PathBuf, crate::WisperError> {
    use crate::WisperError;

    std::fs::create_dir_all(models_dir).map_err(|e| WisperError::Fetch(e.to_string()))?;
    let dest = models_dir.join(model.file_name());
    if model_file_valid(&dest, model) {
        on_progress(DownloadProgress::with_status(
            Some(100),
            "Speech model already downloaded.",
        ));
        return Ok(dest);
    }
    if dest.is_file() {
        let _ = std::fs::remove_file(&dest);
        on_progress(DownloadProgress::with_status(
            None,
            "Replacing incomplete or invalid model file…",
        ));
    }

    let partial = dest.with_extension("part");
    if partial.exists() {
        let _ = std::fs::remove_file(&partial);
    }

    on_progress(DownloadProgress::with_status(Some(0), "Connecting…"));

    let response = ureq::get(model.url())
        .call()
        .map_err(|e| WisperError::Fetch(e.to_string()))?;

    let total = response
        .header("Content-Length")
        .and_then(|value| value.parse::<u64>().ok());

    let mut reader = response.into_reader();
    let mut file =
        std::fs::File::create(&partial).map_err(|e| WisperError::Fetch(e.to_string()))?;
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
        on_progress(DownloadProgress::with_status(
            percent,
            format!("Downloading speech model… {mb} MB"),
        ));
    }

    file.flush()
        .map_err(|e| WisperError::Fetch(e.to_string()))?;
    drop(file);

    std::fs::rename(&partial, &dest).map_err(|e| WisperError::Fetch(e.to_string()))?;
    on_progress(DownloadProgress::with_status(Some(100), "Download complete."));
    Ok(dest)
}

/// Download every starter tier that is not already present under `models_dir`.
pub fn download_all_starter_models(
    models_dir: &Path,
    mut on_progress: impl FnMut(DownloadProgress),
) -> Result<Vec<PathBuf>, crate::WisperError> {
    let mut downloaded = Vec::new();
    for model in StarterModel::ALL {
        let path = download_starter_model(models_dir, model, |progress| {
            on_progress(progress);
        })?;
        downloaded.push(path);
    }
    Ok(downloaded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn starter_model_from_key_aliases() {
        assert_eq!(StarterModel::from_key("small"), Some(StarterModel::Tiny));
        assert_eq!(StarterModel::from_key("medium"), Some(StarterModel::Base));
        assert_eq!(
            StarterModel::from_key("large"),
            Some(StarterModel::LargeTurbo)
        );
        assert_eq!(
            StarterModel::from_key("large-turbo"),
            Some(StarterModel::LargeTurbo)
        );
    }

    #[test]
    fn model_status_for_tier_checks_specific_file() {
        let dir = std::env::temp_dir().join(format!("wisper-model-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let bin = dir.join("ggml-base.en.bin");
        // Pad past min_size_bytes for Base (100 MB)
        let padding = vec![0u8; 100_000_001];
        fs::write(&bin, &padding).unwrap();

        let status = model_status_for_tier(&dir, Some("base"));
        assert!(status.ready);
        assert_eq!(status.installed, vec!["base"]);

        let large = model_status_for_tier(&dir, Some("large-turbo"));
        assert!(!large.ready);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn model_status_ready_when_bin_exists() {
        let dir = std::env::temp_dir().join(format!("wisper-model-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let bin = dir.join("ggml-base.en.bin");
        let padding = vec![0u8; 100_000_001];
        fs::write(&bin, &padding).unwrap();

        let status = model_status(&dir);
        assert!(status.ready);
        assert_eq!(status.path, bin.to_string_lossy());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn model_status_missing_when_no_bin() {
        let dir = std::env::temp_dir().join(format!("wisper-model-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();

        let status = model_status(&dir);
        assert!(!status.ready);

        let _ = fs::remove_dir_all(&dir);
    }
}
