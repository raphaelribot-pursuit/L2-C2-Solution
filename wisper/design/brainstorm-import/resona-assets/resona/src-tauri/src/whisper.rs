//! Thin wrapper over whisper-rs (bindings to whisper.cpp).
use anyhow::{anyhow, Result};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub struct WhisperEngine {
    ctx: WhisperContext,
}

impl WhisperEngine {
    /// Load a ggml/gguf model file (e.g. ggml-base.bin) from disk.
    pub fn load(model_path: &str) -> Result<Self> {
        let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default())
            .map_err(|e| anyhow!("failed to load model {model_path}: {e:?}"))?;
        Ok(Self { ctx })
    }

    /// Transcribe a buffer of 16kHz mono f32 samples.
    /// `single_segment` = true is used for low-latency streaming partials.
    pub fn transcribe(
        &self,
        audio: &[f32],
        language: Option<&str>,
        translate: bool,
        single_segment: bool,
    ) -> Result<String> {
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        // Quiet logging — we want the text, not whisper.cpp's stdout chatter.
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_suppress_blank(true);
        params.set_translate(translate);
        params.set_single_segment(single_segment);
        if let Some(lang) = language {
            params.set_language(Some(lang));
        }
        // Use available CPU threads; cap to a sane number.
        let threads = std::thread::available_parallelism()
            .map(|n| n.get() as i32)
            .unwrap_or(4)
            .min(8);
        params.set_n_threads(threads);

        let mut state = self
            .ctx
            .create_state()
            .map_err(|e| anyhow!("create_state failed: {e:?}"))?;
        state
            .full(params, audio)
            .map_err(|e| anyhow!("inference failed: {e:?}"))?;

        let n = state
            .full_n_segments()
            .map_err(|e| anyhow!("segment count failed: {e:?}"))?;
        let mut out = String::new();
        for i in 0..n {
            if let Ok(seg) = state.full_get_segment_text(i) {
                out.push_str(&seg);
            }
        }
        Ok(out.trim().to_string())
    }
}

// SAFETY: whisper.cpp's context is internally synchronized for our usage pattern
// (one inference at a time, guarded by an Arc + the streaming consumer thread).
unsafe impl Send for WhisperEngine {}
unsafe impl Sync for WhisperEngine {}
