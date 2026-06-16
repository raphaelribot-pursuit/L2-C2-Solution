use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::fetch::DownloadProgress;
use crate::DEFAULT_MODEL_FILENAME;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StarterModel {
    Tiny,
    Base,
}

impl StarterModel {
    pub fn from_key(key: &str) -> Option<Self> {
        match key.trim().to_lowercase().as_str() {
            "tiny" => Some(Self::Tiny),
            "base" => Some(Self::Base),
            _ => None,
        }
    }

    pub fn file_name(self) -> &'static str {
        match self {
            Self::Tiny => "ggml-tiny.en.bin",
            Self::Base => "ggml-base.en.bin",
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
        }
    }

    pub fn size_label(self) -> &'static str {
        match self {
            Self::Tiny => "~75 MB",
            Self::Base => "~150 MB",
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ModelStatus {
    pub path: String,
    pub models_dir: String,
    pub ready: bool,
    pub hint: String,
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

/// Report whether a usable GGML model file exists under `models_dir`.
pub fn model_status(models_dir: &Path) -> ModelStatus {
    let path = resolve_model_path(models_dir);
    let ready = path.is_file();
    let hint = if ready {
        "Speech model is ready.".into()
    } else {
        "No speech model yet — open Get started to download one.".into()
    };

    ModelStatus {
        path: path.to_string_lossy().into_owned(),
        models_dir: models_dir.to_string_lossy().into_owned(),
        ready,
        hint,
    }
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
    if dest.is_file() {
        on_progress(DownloadProgress {
            percent: Some(100),
            status: "Speech model already downloaded.".into(),
        });
        return Ok(dest);
    }

    let partial = dest.with_extension("part");
    if partial.exists() {
        let _ = std::fs::remove_file(&partial);
    }

    on_progress(DownloadProgress {
        percent: Some(0),
        status: "Connecting…".into(),
    });

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
        on_progress(DownloadProgress {
            percent,
            status: format!("Downloading speech model… {mb} MB"),
        });
    }

    file.flush()
        .map_err(|e| WisperError::Fetch(e.to_string()))?;
    drop(file);

    std::fs::rename(&partial, &dest).map_err(|e| WisperError::Fetch(e.to_string()))?;
    on_progress(DownloadProgress {
        percent: Some(100),
        status: "Download complete.".into(),
    });
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn model_status_ready_when_bin_exists() {
        let dir = std::env::temp_dir().join(format!("wisper-model-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let bin = dir.join("ggml-base.en.bin");
        fs::write(&bin, b"fake").unwrap();

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
