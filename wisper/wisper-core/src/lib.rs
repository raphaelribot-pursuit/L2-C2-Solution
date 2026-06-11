pub mod audio;
pub mod compute;
pub mod engine;
pub mod error;
pub mod model;
pub mod storage;
pub mod transcribe;

pub use compute::{
    compiled_gpu_backend, compute_info, cpu_architecture_label, validate_backend,
    ComputeBackend, ComputeInfo, GpuBackendKind,
};
pub use engine::WhisperEngine;
pub use error::WisperError;
pub use model::resolve_model_path;
pub use storage::{RecordingSummary, Storage};
pub use transcribe::{
    transcribe_file, transcribe_with_engine, GpuFallbackNotice, TranscribeOptions,
    TranscriptSegment, TranscriptionProgress, TranscriptionResult,
};

/// Default model filename (user downloads to app data dir on first run).
pub const DEFAULT_MODEL_FILENAME: &str = "ggml-large-v3-turbo.bin";
