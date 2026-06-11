use std::path::{Path, PathBuf};

use whisper_rs::{WhisperContext, WhisperContextParameters};

use crate::compute::{validate_backend, ComputeBackend};
use crate::error::WisperError;

struct LoadedModel {
    path: PathBuf,
    context: WhisperContext,
}

/// Cached whisper.cpp contexts — one slot per compute backend.
pub struct WhisperEngine {
    cpu: Option<LoadedModel>,
    gpu: Option<LoadedModel>,
}

impl WhisperEngine {
    pub fn new() -> Self {
        Self {
            cpu: None,
            gpu: None,
        }
    }

    pub fn with_context<F, R>(
        &mut self,
        model_path: &Path,
        backend: ComputeBackend,
        f: F,
    ) -> Result<R, WisperError>
    where
        F: FnOnce(&WhisperContext) -> Result<R, WisperError>,
    {
        validate_backend(backend)?;
        if !model_path.exists() {
            return Err(WisperError::ModelNotFound {
                path: model_path.to_path_buf(),
            });
        }

        let slot = match backend {
            ComputeBackend::Cpu => &mut self.cpu,
            ComputeBackend::Gpu => &mut self.gpu,
        };

        let needs_reload = slot
            .as_ref()
            .is_none_or(|loaded| loaded.path != model_path);

        if needs_reload {
            let mut ctx_params = WhisperContextParameters::default();
            ctx_params.use_gpu = backend == ComputeBackend::Gpu;

            let context = WhisperContext::new_with_params(
                model_path
                    .to_str()
                    .ok_or_else(|| WisperError::WhisperInit("invalid model path".into()))?,
                ctx_params,
            )
            .map_err(|e| WisperError::WhisperInit(e.to_string()))?;

            *slot = Some(LoadedModel {
                path: model_path.to_path_buf(),
                context,
            });
        }

        let ctx = &slot.as_ref().expect("model slot populated").context;
        f(ctx)
    }

    /// Drop a cached context so the next call reloads the model (e.g. after GPU errors).
    pub fn invalidate_backend(&mut self, backend: ComputeBackend) {
        match backend {
            ComputeBackend::Cpu => self.cpu = None,
            ComputeBackend::Gpu => self.gpu = None,
        }
    }
}

impl Default for WhisperEngine {
    fn default() -> Self {
        Self::new()
    }
}
