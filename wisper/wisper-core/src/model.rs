use std::path::{Path, PathBuf};

use crate::DEFAULT_MODEL_FILENAME;

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
