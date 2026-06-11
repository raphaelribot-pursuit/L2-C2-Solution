use std::ffi::c_void;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use whisper_rs::{FullParams, SamplingStrategy, WhisperContext};

use crate::audio;
use crate::compute::{compiled_gpu_backend, ComputeBackend};
use crate::engine::WhisperEngine;
use crate::error::WisperError;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TranscriptSegment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TranscriptionProgress {
    pub percent: i32,
    pub elapsed_ms: u64,
    pub duration_ms: u64,
}

/// Emitted when GPU inference fails and Wisper retries on CPU.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GpuFallbackNotice {
    pub requested_backend: ComputeBackend,
    pub from_gpu: String,
    pub reason: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TranscriptionResult {
    pub segments: Vec<TranscriptSegment>,
    pub requested_backend: ComputeBackend,
    pub actual_backend: ComputeBackend,
    pub used_cpu_fallback: bool,
}

pub type GpuFallbackCallback = Arc<dyn Fn(GpuFallbackNotice) + Send + Sync>;

#[derive(Debug, Clone)]
pub struct TranscribeOptions {
    pub language: Option<String>,
    pub verbose_logging: bool,
}

impl Default for TranscribeOptions {
    fn default() -> Self {
        Self {
            language: Some("en".to_string()),
            verbose_logging: false,
        }
    }
}

/// whisper-rs `set_abort_callback_safe` uses the wrong trampoline type (`F` instead of
/// `Box<dyn FnMut() -> bool>`), which can corrupt memory during GPU inference.
struct AbortGuard(*const AtomicBool);

impl Drop for AbortGuard {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                drop(Arc::from_raw(self.0));
            }
        }
    }
}

unsafe extern "C" fn abort_trampoline(user_data: *mut c_void) -> bool {
    if user_data.is_null() {
        return false;
    }
    let cancel = &*(user_data as *const AtomicBool);
    cancel.load(Ordering::Relaxed)
}

fn pcm_duration_ms(pcm: &[f32]) -> u64 {
    (pcm.len() as u64 * 1000) / 16_000
}

type ProgressCallback = Arc<Mutex<Box<dyn FnMut(TranscriptionProgress) + Send>>>;

fn collect_segments(state: &whisper_rs::WhisperState) -> Result<Vec<TranscriptSegment>, WisperError> {
    let n = state.full_n_segments();
    let mut segments = Vec::with_capacity(n as usize);

    for i in 0..n {
        let segment = state
            .get_segment(i)
            .ok_or_else(|| WisperError::Transcription(format!("missing segment {i}")))?;

        let text = segment
            .to_str_lossy()
            .map_err(|e| WisperError::Transcription(e.to_string()))?
            .trim()
            .to_string();

        if text.is_empty() {
            continue;
        }

        segments.push(TranscriptSegment {
            start_ms: segment.start_timestamp() * 10,
            end_ms: segment.end_timestamp() * 10,
            text,
        });
    }

    Ok(segments)
}

/// Transcribe mono PCM already loaded at 16 kHz.
pub fn transcribe_pcm(
    ctx: &WhisperContext,
    pcm: &[f32],
    options: &TranscribeOptions,
    cancel: Arc<AtomicBool>,
    on_progress: ProgressCallback,
) -> Result<Vec<TranscriptSegment>, WisperError> {
    let duration_ms = pcm_duration_ms(pcm);
    let started = Instant::now();

    let mut state = ctx
        .create_state()
        .map_err(|e| WisperError::Transcription(e.to_string()))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_translate(false);
    if let Some(lang) = options.language.as_deref() {
        params.set_language(Some(lang));
    }
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    // Match the pre-async settings that worked reliably on CPU and Vulkan GPU.
    params.set_print_timestamps(true);
    params.set_token_timestamps(true);

    let progress_cb = Arc::clone(&on_progress);
    params.set_progress_callback_safe(move |percent| {
        if let Ok(mut cb) = progress_cb.lock() {
            cb(TranscriptionProgress {
                percent,
                elapsed_ms: started.elapsed().as_millis() as u64,
                duration_ms,
            });
        }
    });

    // whisper-rs `set_abort_callback_safe` uses the wrong trampoline type (`F` instead of
    // `Box<dyn FnMut() -> bool>`), which can corrupt memory during GPU inference.
    let cancel_for_abort = Arc::clone(&cancel);
    let cancel_ptr = Arc::into_raw(cancel_for_abort) as *mut c_void;
    let _abort_guard = AbortGuard(cancel_ptr as *const AtomicBool);
    unsafe {
        params.set_abort_callback(Some(abort_trampoline));
        params.set_abort_callback_user_data(cancel_ptr);
    }

    state
        .full(params, pcm)
        .map_err(|e| WisperError::Transcription(e.to_string()))?;

    if cancel.load(Ordering::Relaxed) {
        return Err(WisperError::Cancelled);
    }

    collect_segments(&state)
}

fn gpu_backend_label() -> String {
    compiled_gpu_backend()
        .map(|k| k.label().to_string())
        .unwrap_or_else(|| "GPU".into())
}

/// Transcribe using a cached engine (reloads model only when path or backend changes).
/// When GPU is requested and fails, drops the cached GPU context, notifies via
/// `on_gpu_fallback`, and retries once on CPU (Intel, AMD, and ARM via ggml-cpu).
pub fn transcribe_with_engine(
    engine: &mut WhisperEngine,
    model_path: &Path,
    audio_path: &Path,
    backend: ComputeBackend,
    options: &TranscribeOptions,
    cancel: Arc<AtomicBool>,
    on_progress: impl FnMut(TranscriptionProgress) + Send + 'static,
    on_gpu_fallback: Option<GpuFallbackCallback>,
) -> Result<TranscriptionResult, WisperError> {
    if !audio_path.exists() {
        return Err(WisperError::AudioNotFound(
            audio_path.display().to_string(),
        ));
    }

    let pcm = audio::load_audio_pcm(audio_path)?;
    let progress: ProgressCallback = Arc::new(Mutex::new(Box::new(on_progress)));

    let run = |engine: &mut WhisperEngine, backend: ComputeBackend| {
        engine.with_context(model_path, backend, |ctx| {
            transcribe_pcm(
                ctx,
                &pcm,
                options,
                Arc::clone(&cancel),
                Arc::clone(&progress),
            )
        })
    };

    match run(engine, backend) {
        Ok(segments) => Ok(TranscriptionResult {
            segments,
            requested_backend: backend,
            actual_backend: backend,
            used_cpu_fallback: false,
        }),
        Err(err) if backend == ComputeBackend::Gpu => {
            let from_gpu = gpu_backend_label();
            eprintln!("wisper: {from_gpu} transcription failed ({err}); retrying on CPU");
            if let Some(cb) = &on_gpu_fallback {
                cb(GpuFallbackNotice {
                    requested_backend: ComputeBackend::Gpu,
                    from_gpu: from_gpu.clone(),
                    reason: err.to_string(),
                });
            }
            engine.invalidate_backend(ComputeBackend::Gpu);
            let segments = run(engine, ComputeBackend::Cpu).map_err(|cpu_err| {
                WisperError::Transcription(format!(
                    "{from_gpu} transcription failed ({err}); CPU fallback also failed ({cpu_err})"
                ))
            })?;
            Ok(TranscriptionResult {
                segments,
                requested_backend: ComputeBackend::Gpu,
                actual_backend: ComputeBackend::Cpu,
                used_cpu_fallback: true,
            })
        }
        Err(err) => Err(err),
    }
}

/// Transcribe a local audio file using whisper.cpp (fully offline).
/// Loads the model on every call — prefer [`transcribe_with_engine`] when transcribing repeatedly.
pub fn transcribe_file(
    model_path: &Path,
    audio_path: &Path,
    backend: ComputeBackend,
) -> Result<Vec<TranscriptSegment>, WisperError> {
    let mut engine = WhisperEngine::new();
    transcribe_with_engine(
        &mut engine,
        model_path,
        audio_path,
        backend,
        &TranscribeOptions::default(),
        Arc::new(AtomicBool::new(false)),
        |_| {},
        None,
    )
    .map(|r| r.segments)
}
