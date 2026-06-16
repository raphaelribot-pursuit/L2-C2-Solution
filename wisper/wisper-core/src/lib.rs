pub mod audio;
pub mod compute;
pub mod engine;
pub mod error;
pub mod export;
pub mod fetch;
pub mod model;
pub mod storage;
pub mod transcribe;

pub use compute::{
    app_about, compiled_gpu_backend, compute_info, cpu_architecture_label, platform_os_label,
    release_artifact_label, validate_backend, AppAbout, ComputeBackend, ComputeInfo,
    GpuBackendKind,
};
pub use engine::WhisperEngine;
pub use error::WisperError;
pub use export::format_transcript_txt;
pub use model::{
    download_starter_model, import_model_file, model_status, resolve_model_path, ModelStatus,
    StarterModel,
};
pub use audio::save_mic_wav;
pub use fetch::{download_url, normalize_url, resolve_yt_dlp, yt_dlp_status, DownloadProgress, UrlDownloadResult, YtDlpStatus};
pub use storage::{RecordingSource, RecordingSummary, Storage};
pub use transcribe::{
    transcribe_file, transcribe_with_engine, GpuFallbackNotice, TranscribeOptions,
    TranscriptSegment, TranscriptionProgress, TranscriptionResult,
};

/// Default model filename (user downloads to app data dir on first run).
pub const DEFAULT_MODEL_FILENAME: &str = "ggml-large-v3-turbo.bin";
