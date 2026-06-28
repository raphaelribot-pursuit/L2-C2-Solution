//! Microphone capture (cpal), vendored from wisper. Captures mono f32 PCM and writes a WAV
//! via wisper_core::save_mic_wav. The recorder is held in Tauri app state while active.
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use wisper_core::{save_mic_wav, WisperError};

pub struct MicRecordingResult {
    pub path: PathBuf,
    pub duration_ms: u64,
}

struct SharedCapture {
    samples: Arc<Mutex<Vec<f32>>>,
    peak: Arc<Mutex<f32>>,
    sample_rate: u32,
    device_name: String,
    stop: Arc<AtomicBool>,
    stream_error: Arc<Mutex<Option<String>>>,
    thread: JoinHandle<()>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicRecordingStatus {
    pub peak: f32,
    pub duration_ms: u64,
    pub device_name: String,
}

pub struct MicRecorder(SharedCapture);

const STARTUP_POLL_MS: u64 = 25;
const STARTUP_TIMEOUT_MS: u64 = 500;

impl MicRecorder {
    pub fn start() -> Result<Self, String> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| "no microphone input device found".to_string())?;

        let device_name = device
            .name()
            .unwrap_or_else(|_| "Default microphone".into());

        let supported = device
            .default_input_config()
            .map_err(|e| e.to_string())?;

        let sample_format = supported.sample_format();
        let sample_rate = supported.sample_rate().0;
        let channels = supported.channels() as usize;
        let stream_config: StreamConfig = supported.into();

        let samples: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
        let peak: Arc<Mutex<f32>> = Arc::new(Mutex::new(0.0));
        let stop = Arc::new(AtomicBool::new(false));
        let stream_ready = Arc::new(AtomicBool::new(false));
        let stream_error: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

        let samples_cb = Arc::clone(&samples);
        let peak_cb = Arc::clone(&peak);
        let stop_cb = Arc::clone(&stop);
        let stream_ready_cb = Arc::clone(&stream_ready);
        let stream_error_cb = Arc::clone(&stream_error);

        let thread = thread::spawn(move || {
            let stream = match sample_format {
                SampleFormat::F32 => device.build_input_stream(
                    &stream_config,
                    move |data: &[f32], _| append_input(data, channels, &samples_cb, &peak_cb),
                    {
                        let stream_error_cb = Arc::clone(&stream_error_cb);
                        move |err| {
                            record_stream_error(
                                &stream_error_cb,
                                format!("microphone stream error: {err}"),
                            );
                        }
                    },
                    None,
                ),
                SampleFormat::I16 => device.build_input_stream(
                    &stream_config,
                    move |data: &[i16], _| {
                        let floats: Vec<f32> = data
                            .iter()
                            .map(|&s| s as f32 / i16::MAX as f32)
                            .collect();
                        append_input(&floats, channels, &samples_cb, &peak_cb);
                    },
                    {
                        let stream_error_cb = Arc::clone(&stream_error_cb);
                        move |err| {
                            record_stream_error(
                                &stream_error_cb,
                                format!("microphone stream error: {err}"),
                            );
                        }
                    },
                    None,
                ),
                SampleFormat::U16 => device.build_input_stream(
                    &stream_config,
                    move |data: &[u16], _| {
                        let floats: Vec<f32> = data
                            .iter()
                            .map(|&s| {
                                (s as f32 - u16::MAX as f32 / 2.0) / (u16::MAX as f32 / 2.0)
                            })
                            .collect();
                        append_input(&floats, channels, &samples_cb, &peak_cb);
                    },
                    {
                        let stream_error_cb = Arc::clone(&stream_error_cb);
                        move |err| {
                            record_stream_error(
                                &stream_error_cb,
                                format!("microphone stream error: {err}"),
                            );
                        }
                    },
                    None,
                ),
                other => {
                    record_stream_error(
                        &stream_error_cb,
                        format!("unsupported microphone sample format: {other:?}"),
                    );
                    return;
                }
            };

            let stream = match stream {
                Ok(s) => s,
                Err(err) => {
                    record_stream_error(
                        &stream_error_cb,
                        format!("failed to open microphone stream: {err}"),
                    );
                    return;
                }
            };

            if let Err(err) = stream.play() {
                record_stream_error(
                    &stream_error_cb,
                    format!("failed to start microphone stream: {err}"),
                );
                return;
            }

            stream_ready_cb.store(true, Ordering::SeqCst);

            while !stop_cb.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_millis(50));
            }

            drop(stream);
        });

        let polls = STARTUP_TIMEOUT_MS / STARTUP_POLL_MS;
        for _ in 0..polls {
            if stream_ready.load(Ordering::SeqCst) {
                return Ok(Self(SharedCapture {
                    samples,
                    peak,
                    sample_rate,
                    device_name,
                    stop,
                    stream_error,
                    thread,
                }));
            }
            if let Ok(guard) = stream_error.lock() {
                if let Some(message) = guard.clone() {
                    stop.store(true, Ordering::SeqCst);
                    thread.join().ok();
                    return Err(message);
                }
            }
            thread::sleep(Duration::from_millis(STARTUP_POLL_MS));
        }

        stop.store(true, Ordering::SeqCst);
        thread.join().ok();

        if let Ok(guard) = stream_error.lock() {
            if let Some(message) = guard.clone() {
                return Err(message);
            }
        }

        Err(
            "failed to start microphone — check permissions and that an input device is available"
                .into(),
        )
    }

    pub fn status(&self) -> MicRecordingStatus {
        let peak = self.0.peak.lock().map(|p| *p).unwrap_or(0.0);
        let sample_count = self.0.samples.lock().map(|s| s.len()).unwrap_or(0);
        let duration_ms = if self.0.sample_rate == 0 {
            0
        } else {
            (sample_count as u64 * 1000) / self.0.sample_rate as u64
        };

        MicRecordingStatus {
            peak,
            duration_ms,
            device_name: self.0.device_name.clone(),
        }
    }

    pub fn stop(self, output_path: &Path) -> Result<MicRecordingResult, String> {
        self.0.stop.store(true, Ordering::SeqCst);
        self.0
            .thread
            .join()
            .map_err(|_| "recording thread panicked".to_string())?;

        if let Ok(guard) = self.0.stream_error.lock() {
            if let Some(message) = guard.clone() {
                return Err(message);
            }
        }

        let raw = self
            .0
            .samples
            .lock()
            .map_err(|e| e.to_string())?
            .clone();

        if raw.is_empty() {
            return Err(
                "recording is empty — speak into the microphone and try again".into(),
            );
        }

        let duration_ms = save_mic_wav(output_path, &raw, self.0.sample_rate)
            .map_err(|e: WisperError| e.to_string())?;

        Ok(MicRecordingResult {
            path: output_path.to_path_buf(),
            duration_ms,
        })
    }
}

fn record_stream_error(stream_error: &Arc<Mutex<Option<String>>>, message: impl Into<String>) {
    if let Ok(mut slot) = stream_error.lock() {
        if slot.is_none() {
            *slot = Some(message.into());
        }
    }
}

fn append_input(data: &[f32], channels: usize, samples: &Mutex<Vec<f32>>, peak: &Mutex<f32>) {
    let ch = channels.max(1);
    let mut buf = samples.lock().unwrap_or_else(|e| e.into_inner());
    let mut peak_val = peak.lock().unwrap_or_else(|e| e.into_inner());

    for frame in data.chunks(ch) {
        let mono = frame.iter().sum::<f32>() / ch as f32;
        buf.push(mono);
        *peak_val = peak_val.max(mono.abs());
    }
}
