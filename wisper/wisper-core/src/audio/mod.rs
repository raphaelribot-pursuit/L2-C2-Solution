use std::path::Path;

use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use crate::error::WisperError;

pub(crate) const TARGET_SAMPLE_RATE: u32 = 16_000;

/// Load any supported audio file and return mono f32 PCM at 16 kHz (Whisper input).
pub fn load_audio_pcm(path: &Path) -> Result<Vec<f32>, WisperError> {
    if path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("wav")) {
        return load_wav(path);
    }

    decode_with_symphonia(path)
}

fn load_wav(path: &Path) -> Result<Vec<f32>, WisperError> {
    let reader = hound::WavReader::open(path).map_err(|e| WisperError::AudioDecode(e.to_string()))?;
    let spec = reader.spec();

    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader
            .into_samples::<f32>()
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| WisperError::AudioDecode(e.to_string()))?,
        hound::SampleFormat::Int => int_samples_to_f32(reader, spec.bits_per_sample)?,
    };

    let mono = downmix_to_mono(&samples, spec.channels as usize);
    Ok(resample_linear(&mono, spec.sample_rate, TARGET_SAMPLE_RATE))
}

fn decode_with_symphonia(path: &Path) -> Result<Vec<f32>, WisperError> {
    let src = std::fs::File::open(path).map_err(|_| WisperError::AudioNotFound(path.display().to_string()))?;
    let mss = MediaSourceStream::new(Box::new(src), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| WisperError::AudioDecode(e.to_string()))?;

    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| WisperError::AudioDecode("no default audio track".into()))?;

    let track_id = track.id;
    let codec = track.codec_params.codec;
    let sample_rate = track
        .codec_params
        .sample_rate
        .unwrap_or(TARGET_SAMPLE_RATE);
    let channels = track.codec_params.channels.map(|c| c.count()).unwrap_or(1);

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| WisperError::AudioDecode(e.to_string()))?;

    let mut pcm = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::ResetRequired) => continue,
            Err(SymphoniaError::IoError(_)) if pcm.is_empty() => {
                return Err(WisperError::AudioDecode("empty audio file".into()));
            }
            Err(SymphoniaError::IoError(_)) => break,
            Err(e) => return Err(WisperError::AudioDecode(e.to_string())),
        };

        if packet.track_id() != track_id {
            continue;
        }

        if codec != CODEC_TYPE_NULL {
            match decoder.decode(&packet) {
                Ok(decoded) => append_decoded(&mut pcm, decoded),
                Err(SymphoniaError::IoError(_)) => break,
                Err(SymphoniaError::DecodeError(_)) => continue,
                Err(e) => return Err(WisperError::AudioDecode(e.to_string())),
            }
        }
    }

    if pcm.is_empty() {
        return Err(WisperError::AudioDecode("no audio samples decoded".into()));
    }

    let mono = downmix_to_mono(&pcm, channels);
    Ok(resample_linear(&mono, sample_rate, TARGET_SAMPLE_RATE))
}

fn append_decoded(pcm: &mut Vec<f32>, decoded: AudioBufferRef<'_>) {
    match decoded {
        AudioBufferRef::F32(buf) => {
            let channels = buf.spec().channels.count();
            for frame in 0..buf.frames() {
                let mut sum = 0.0f32;
                for ch in 0..channels {
                    sum += buf.chan(ch)[frame];
                }
                pcm.push(sum / channels as f32);
            }
        }
        AudioBufferRef::S16(buf) => {
            let channels = buf.spec().channels.count();
            for frame in 0..buf.frames() {
                let mut sum = 0.0f32;
                for ch in 0..channels {
                    sum += buf.chan(ch)[frame] as f32 / i16::MAX as f32;
                }
                pcm.push(sum / channels as f32);
            }
        }
        AudioBufferRef::S32(buf) => {
            let channels = buf.spec().channels.count();
            for frame in 0..buf.frames() {
                let mut sum = 0.0f32;
                for ch in 0..channels {
                    sum += buf.chan(ch)[frame] as f32 / i32::MAX as f32;
                }
                pcm.push(sum / channels as f32);
            }
        }
        _ => {}
    }
}

fn int_samples_to_f32(
    reader: hound::WavReader<std::io::BufReader<std::fs::File>>,
    bits_per_sample: u16,
) -> Result<Vec<f32>, WisperError> {
    let decode_err = |e: hound::Error| WisperError::AudioDecode(e.to_string());

    match bits_per_sample {
        8 => reader
            .into_samples::<i8>()
            .map(|s| s.map_err(decode_err).map(|s| (s as f32 - 128.0) / 128.0))
            .collect(),
        16 => reader
            .into_samples::<i16>()
            .map(|s| s.map_err(decode_err).map(|s| s as f32 / i16::MAX as f32))
            .collect(),
        24 | 32 => reader
            .into_samples::<i32>()
            .map(|s| s.map_err(decode_err).map(|s| s as f32 / i32::MAX as f32))
            .collect(),
        bits => Err(WisperError::AudioDecode(format!(
            "unsupported WAV bit depth: {bits}"
        ))),
    }
}

pub(crate) fn downmix_to_mono(samples: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return samples.to_vec();
    }

    samples
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect()
}

pub(crate) fn resample_linear(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate || samples.is_empty() {
        return samples.to_vec();
    }

    let ratio = from_rate as f64 / to_rate as f64;
    let out_len = ((samples.len() as f64) / ratio).ceil() as usize;
    let mut out = Vec::with_capacity(out_len);

    for i in 0..out_len {
        let src_pos = i as f64 * ratio;
        let idx = src_pos.floor() as usize;
        let frac = (src_pos - idx as f64) as f32;
        let a = samples.get(idx).copied().unwrap_or(0.0);
        let b = samples.get(idx + 1).copied().unwrap_or(a);
        out.push(a + (b - a) * frac);
    }

    out
}

/// Resample captured mono PCM and write 16 kHz WAV for Whisper.
pub fn save_mic_wav(path: &Path, raw_mono: &[f32], capture_rate: u32) -> Result<u64, WisperError> {
    let pcm = resample_linear(raw_mono, capture_rate, TARGET_SAMPLE_RATE);
    write_wav_i16(path, &pcm, TARGET_SAMPLE_RATE)?;
    Ok((pcm.len() as u64 * 1000) / TARGET_SAMPLE_RATE as u64)
}

/// Write mono f32 PCM (-1..1) as 16-bit WAV at the given sample rate.
pub fn write_wav_i16(path: &Path, samples: &[f32], sample_rate: u32) -> Result<(), WisperError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| WisperError::Recording(e.to_string()))?;
    }

    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let file = std::fs::File::create(path).map_err(|e| WisperError::Recording(e.to_string()))?;
    let mut writer = hound::WavWriter::new(std::io::BufWriter::new(file), spec)
        .map_err(|e| WisperError::Recording(e.to_string()))?;

    for sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let int_sample = (clamped * i16::MAX as f32) as i16;
        writer
            .write_sample(int_sample)
            .map_err(|e| WisperError::Recording(e.to_string()))?;
    }

    writer
        .finalize()
        .map_err(|e| WisperError::Recording(e.to_string()))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn sample_path(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("samples")
            .join(name)
    }

    #[test]
    fn load_16bit_wav_has_usable_amplitude() {
        let path = sample_path("jfk-sample.wav");
        if !path.exists() {
            return;
        }

        let pcm = load_audio_pcm(&path).expect("jfk sample should decode");
        let peak = pcm.iter().map(|s| s.abs()).fold(0.0f32, f32::max);

        assert!(pcm.len() > 160_000, "expected ~11s at 16kHz, got {}", pcm.len());
        assert!(peak > 0.05, "PCM peak too quiet ({peak}); check normalization");
    }
}
