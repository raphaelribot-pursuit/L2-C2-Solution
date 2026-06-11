use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum WisperError {
    #[error("model not found at {path} — download a GGML Whisper model to this path")]
    ModelNotFound { path: PathBuf },

    #[error("audio file not found: {0}")]
    AudioNotFound(String),

    #[error("failed to decode audio: {0}")]
    AudioDecode(String),

    #[error("transcription failed: {0}")]
    Transcription(String),

    #[error("whisper init failed: {0}")]
    WhisperInit(String),

    #[error("storage error: {0}")]
    Storage(String),

    #[error("transcription cancelled")]
    Cancelled,
}
