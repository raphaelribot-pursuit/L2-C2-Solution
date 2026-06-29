pub mod audio;
pub mod compute;
pub mod engine;
pub mod error;
pub mod export;
pub mod ffmpeg_tools;
pub mod fetch;
pub mod hardware;
mod managed_binary;
pub mod model;
pub mod storage;
pub mod tool_refresh;
pub mod transcribe;
pub mod update;
pub mod video;

pub use compute::{
    app_about, compiled_gpu_backend, compute_info, cpu_architecture_label, platform_os_label,
    release_artifact_label, validate_backend, AppAbout, ComputeBackend, ComputeInfo,
    GpuBackendKind,
};
pub use engine::WhisperEngine;
pub use error::WisperError;
pub use export::{
    build_library_bundle, build_transcript_bundle, format_transcript_csv,
    format_transcript_csv_words, format_transcript_docx, format_transcript_json,
    format_transcript_pdf, format_transcript_srt, format_transcript_srt_words,
    format_transcript_txt, format_transcript_vtt, sanitize_export_folder_name,
    TranscriptExportSet,
};
pub use hardware::{
    get_system_profile, recommend_model, run_compute_benchmark, BenchmarkResult,
    ModelRecommendation, SystemProfile,
};
pub use model::{
    download_all_starter_models, download_starter_model, import_model_file, installed_model_keys,
    is_model_file_valid, model_status, model_status_for_tier, resolve_model_path,
    resolve_model_path_for_tier, ModelStatus, StarterModel,
};
pub use audio::save_mic_wav;
pub use ffmpeg_tools::{
    download_ffmpeg, ffmpeg_install_filename, ffmpeg_status, resolve_ffmpeg, resolve_ffprobe,
    set_ffmpeg_candidates, FfmpegStatus,
};
pub use fetch::{
    download_url, download_yt_dlp, normalize_url, resolve_yt_dlp, yt_dlp_install_filename,
    yt_dlp_release_download_url, yt_dlp_status, DownloadProgress, UrlDownloadResult, YtDlpStatus,
};
pub use tool_refresh::{managed_tool_is_stale, refresh_stale_managed_tools, MANAGED_TOOL_REFRESH_SECS};
pub use storage::{RecordingSource, RecordingSummary, Storage};
pub use transcribe::{
    transcribe_file, transcribe_with_engine, GpuFallbackNotice, TranscribeOptions,
    TranscriptSegment, TranscriptWord, TranscriptionProgress, TranscriptionResult,
};
pub use video::{burn_in_subtitles, is_video_path};
pub use managed_binary::{command_for_binary, ffmpeg_runnable, prepare_managed_binary, yt_dlp_runnable};
pub use update::{check_for_update, UpdateCheckResult, GITHUB_REPO};

/// Default model filename (user downloads to app data dir on first run).
pub const DEFAULT_MODEL_FILENAME: &str = "ggml-large-v3-turbo.bin";
