//! Microphone capture via cpal, normalized to 16kHz mono f32 for whisper.
use anyhow::{anyhow, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;

const TARGET_RATE: u32 = 16_000;

/// Build the input stream, run it until `running` flips false, then drop it.
/// Must run on its own thread because a cpal Stream is not Send on all platforms.
pub fn run_capture(tx: Sender<Vec<f32>>, running: Arc<AtomicBool>) -> Result<()> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| anyhow!("no default input device"))?;
    let config = device.default_input_config()?;
    let in_rate = config.sample_rate().0;
    let channels = config.channels() as usize;
    let err_fn = |e| eprintln!("audio stream error: {e}");

    // Each callback: downmix to mono, then linearly resample to 16kHz.
    let make_f32 = move |data: &[f32]| {
        let mono = downmix(data, channels);
        resample_linear(&mono, in_rate, TARGET_RATE)
    };

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let tx = tx.clone();
            let f = make_f32.clone();
            device.build_input_stream(
                &config.into(),
                move |data: &[f32], _| {
                    let _ = tx.send(f(data));
                },
                err_fn,
                None,
            )?
        }
        cpal::SampleFormat::I16 => {
            let tx = tx.clone();
            let f = make_f32.clone();
            device.build_input_stream(
                &config.into(),
                move |data: &[i16], _| {
                    let floats: Vec<f32> = data.iter().map(|&s| s as f32 / 32768.0).collect();
                    let _ = tx.send(f(&floats));
                },
                err_fn,
                None,
            )?
        }
        other => return Err(anyhow!("unsupported sample format: {other:?}")),
    };

    stream.play()?;
    while running.load(Ordering::Relaxed) {
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    drop(stream);
    Ok(())
}

fn downmix(data: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return data.to_vec();
    }
    data.chunks(channels)
        .map(|f| f.iter().copied().sum::<f32>() / channels as f32)
        .collect()
}

/// Simple linear resampler. Good enough for VAD + whisper; swap in `rubato`
/// for production-grade quality if you hear artifacts.
fn resample_linear(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    let ratio = to as f32 / from as f32;
    let out_len = (input.len() as f32 * ratio) as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src = i as f32 / ratio;
        let idx = src.floor() as usize;
        let frac = src - idx as f32;
        let a = input.get(idx).copied().unwrap_or(0.0);
        let b = input.get(idx + 1).copied().unwrap_or(a);
        out.push(a + (b - a) * frac);
    }
    out
}
