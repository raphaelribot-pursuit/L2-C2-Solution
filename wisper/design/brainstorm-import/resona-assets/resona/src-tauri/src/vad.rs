//! Dependency-free energy (RMS) voice-activity detection.
//! For production, consider whisper-rs's built-in VAD (WhisperVadContext) or
//! the `webrtc-vad` / Silero models for far better silence handling.

/// Root-mean-square energy of a frame.
pub fn rms(frame: &[f32]) -> f32 {
    if frame.is_empty() {
        return 0.0;
    }
    let sum: f32 = frame.iter().map(|s| s * s).sum();
    (sum / frame.len() as f32).sqrt()
}

/// True if the frame's energy clears the speech threshold.
/// Typical threshold for a normal mic: ~0.01–0.02. Tune per device.
pub fn is_speech(frame: &[f32], threshold: f32) -> bool {
    rms(frame) > threshold
}
