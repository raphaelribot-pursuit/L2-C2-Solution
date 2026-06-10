pub mod audio;
pub mod compute;
pub mod error;
pub mod model;
pub mod storage;
pub mod transcribe;

pub use compute::{compute_info, validate_backend, ComputeBackend, ComputeInfo};
pub use error::WisperError;
pub use model::resolve_model_path;
pub use storage::{RecordingSummary, Storage};
pub use transcribe::{transcribe_file, TranscriptSegment};

/// Default model filename (user downloads to app data dir on first run).
pub const DEFAULT_MODEL_FILENAME: &str = "ggml-large-v3-turbo.bin";
