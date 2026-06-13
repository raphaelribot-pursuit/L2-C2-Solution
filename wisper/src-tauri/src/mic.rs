use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

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
    thread: JoinHandle<()>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MicRecordingStatus {
    pub peak: f32,
    pub duration_ms: u64,
    pub device_name: String,
}

pub struct MicRecorder(SharedCapture);

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

        let samples_cb = Arc::clone(&samples);
        let peak_cb = Arc::clone(&peak);
        let stop_cb = Arc::clone(&stop);

        let thread = thread::spawn(move || {
            let stream = match sample_format {
                SampleFormat::F32 => device.build_input_stream(
                    &stream_config,
                    move |data: &[f32], _| append_input(data, channels, &samples_cb, &peak_cb),
                    |err| eprintln!("microphone stream error: {err}"),
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
                    |err| eprintln!("microphone stream error: {err}"),
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
                    |err| eprintln!("microphone stream error: {err}"),
                    None,
                ),
                other => {
                    eprintln!("unsupported microphone sample format: {other:?}");
                    return;
                }
            };

            let stream = match stream {
                Ok(s) => s,
                Err(err) => {
                    eprintln!("failed to open microphone stream: {err}");
                    return;
                }
            };

            if let Err(err) = stream.play() {
                eprintln!("failed to start microphone stream: {err}");
                return;
            }

            while !stop_cb.load(Ordering::SeqCst) {
                thread::sleep(std::time::Duration::from_millis(50));
            }

            drop(stream);
        });

        Ok(Self(SharedCapture {
            samples,
            peak,
            sample_rate,
            device_name,
            stop,
            thread,
        }))
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
