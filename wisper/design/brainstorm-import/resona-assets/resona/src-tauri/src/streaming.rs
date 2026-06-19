//! Live dictation loop: capture -> VAD -> incremental whisper -> Tauri events.
//!
//! Emits two events the frontend listens for:
//!   "transcript://partial"  { text }   -> in-progress utterance, replaces the live line
//!   "transcript://final"    { text }   -> finalized on silence, append + start a new line
use crate::vad;
use crate::whisper::WhisperEngine;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const SAMPLE_RATE: usize = 16_000;
const FRAME: usize = 480; // 30ms @ 16kHz
const SILENCE_MS: u128 = 800; // silence that ends an utterance
const PARTIAL_MS: u128 = 700; // how often to emit a partial while speaking
const SPEECH_THRESHOLD: f32 = 0.015;

#[derive(Clone, Serialize)]
struct Payload {
    text: String,
}

pub struct StreamHandle {
    pub running: Arc<AtomicBool>,
}

impl StreamHandle {
    pub fn stop(&self) {
        self.running.store(false, Ordering::Relaxed);
    }
}

pub fn start(
    app: AppHandle,
    engine: Arc<WhisperEngine>,
    language: Option<String>,
    translate: bool,
) -> StreamHandle {
    let running = Arc::new(AtomicBool::new(true));

    // Capture thread (owns the non-Send cpal stream).
    let (tx, rx) = mpsc::channel::<Vec<f32>>();
    {
        let running = running.clone();
        std::thread::spawn(move || {
            if let Err(e) = crate::audio::run_capture(tx, running) {
                eprintln!("capture ended: {e}");
            }
        });
    }

    // Consumer thread: VAD segmentation + incremental transcription.
    {
        let running = running.clone();
        std::thread::spawn(move || {
            let lang = language.as_deref();
            let mut utterance: Vec<f32> = Vec::new();
            let mut had_speech = false;
            let mut last_voice = Instant::now();
            let mut last_partial = Instant::now();

            while running.load(Ordering::Relaxed) {
                // Pull whatever audio is available without busy-spinning.
                match rx.recv_timeout(Duration::from_millis(60)) {
                    Ok(chunk) => utterance.extend_from_slice(&chunk),
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }

                // VAD on the most recent frame.
                let speaking = utterance
                    .len()
                    .checked_sub(FRAME)
                    .map(|s| vad::is_speech(&utterance[s..], SPEECH_THRESHOLD))
                    .unwrap_or(false);
                if speaking {
                    had_speech = true;
                    last_voice = Instant::now();
                }

                // Emit a partial while the user is still talking.
                if had_speech
                    && !utterance.is_empty()
                    && last_partial.elapsed().as_millis() > PARTIAL_MS
                {
                    if let Ok(text) = engine.transcribe(&utterance, lang, translate, true) {
                        if !text.is_empty() {
                            let _ = app.emit("transcript://partial", Payload { text });
                        }
                    }
                    last_partial = Instant::now();
                }

                // Finalize the utterance once the user goes quiet.
                if had_speech && last_voice.elapsed().as_millis() > SILENCE_MS {
                    if let Ok(text) = engine.transcribe(&utterance, lang, translate, false) {
                        if !text.is_empty() {
                            let _ = app.emit("transcript://final", Payload { text });
                        }
                    }
                    utterance.clear();
                    had_speech = false;
                    last_partial = Instant::now();
                } else if utterance.len() > SAMPLE_RATE * 30 {
                    // Safety valve: never let a single buffer grow past 30s.
                    if let Ok(text) = engine.transcribe(&utterance, lang, translate, false) {
                        if !text.is_empty() {
                            let _ = app.emit("transcript://final", Payload { text });
                        }
                    }
                    utterance.clear();
                    had_speech = false;
                }
            }
        });
    }

    StreamHandle { running }
}
