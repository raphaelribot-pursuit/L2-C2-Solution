use std::path::Path;
use std::process::Stdio;

use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use crate::error::WisperError;
use crate::ffmpeg_tools::{resolve_ffmpeg, resolve_ffprobe};
use crate::managed_binary::command_for_binary;

pub(crate) const TARGET_SAMPLE_RATE: u32 = 16_000;

#[derive(Debug, Clone)]
pub struct LoadedAudio {
    pub pcm: Vec<f32>,
    pub decoded_duration_ms: u64,
    /// From container metadata when available (may be absent on VBR MP3).
    pub container_duration_ms: Option<u64>,
}

fn duration_ms_from_samples(sample_count: usize, sample_rate: u32) -> u64 {
    (sample_count as u64 * 1000) / u64::from(sample_rate)
}

/// Symphonia can stop early on some MP3s (VBR, index gaps). Retry via ffmpeg when
/// decoded PCM is much shorter than container metadata.
const TRUNCATION_THRESHOLD_MS: u64 = 10_000;

fn ffmpeg_available() -> bool {
    resolve_ffmpeg().is_ok()
}

fn ffprobe_duration_ms(path: &Path) -> Option<u64> {
    let path_str = path.to_str()?;
    let ffprobe = resolve_ffprobe()?;
    let output = command_for_binary(&ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path_str,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let secs: f64 = String::from_utf8_lossy(&output.stdout).trim().parse().ok()?;
    Some((secs * 1000.0) as u64)
}

fn decode_with_ffmpeg(path: &Path) -> Result<Vec<f32>, WisperError> {
    let path_str = path
        .to_str()
        .ok_or_else(|| WisperError::AudioDecode("non-UTF-8 path".into()))?;
    let ffmpeg = resolve_ffmpeg()?;

    let output = command_for_binary(&ffmpeg)
        .args([
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            path_str,
            "-ac",
            "1",
            "-ar",
            &TARGET_SAMPLE_RATE.to_string(),
            "-f",
            "f32le",
            "-acodec",
            "pcm_f32le",
            "pipe:1",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| WisperError::AudioDecode(format!("ffmpeg not runnable: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(WisperError::AudioDecode(format!(
            "ffmpeg decode failed: {}",
            stderr.trim()
        )));
    }

    let bytes = output.stdout;
    if bytes.len() < 4 {
        return Err(WisperError::AudioDecode("ffmpeg returned no audio".into()));
    }
    if !bytes.len().is_multiple_of(4) {
        return Err(WisperError::AudioDecode(
            "ffmpeg returned malformed f32 PCM".into(),
        ));
    }

    let pcm: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect();

    if pcm.is_empty() {
        return Err(WisperError::AudioDecode("ffmpeg returned no audio".into()));
    }

    Ok(pcm)
}

fn looks_truncated(loaded: &LoadedAudio) -> bool {
    loaded
        .container_duration_ms
        .is_some_and(|container_ms| container_ms > loaded.decoded_duration_ms + TRUNCATION_THRESHOLD_MS)
}

fn maybe_redecode_with_ffmpeg(path: &Path, loaded: LoadedAudio) -> Result<LoadedAudio, WisperError> {
    if !looks_truncated(&loaded) {
        return Ok(loaded);
    }

    if !ffmpeg_available() {
        eprintln!(
            "wisper: decode — symphonia truncated but ffmpeg not available; \
             install ffmpeg from Advanced options for full-length MP3 decode"
        );
        return Ok(loaded);
    }

    eprintln!(
        "wisper: decode — symphonia got {:.1}s, retrying with ffmpeg",
        loaded.decoded_duration_ms as f64 / 1000.0
    );

    let pcm = decode_with_ffmpeg(path)?;
    let decoded_duration_ms = duration_ms_from_samples(pcm.len(), TARGET_SAMPLE_RATE);
    let container_duration_ms = ffprobe_duration_ms(path).or(loaded.container_duration_ms);

    eprintln!(
        "wisper: decode — ffmpeg got {:.1}s ({} samples)",
        decoded_duration_ms as f64 / 1000.0,
        pcm.len()
    );

    Ok(LoadedAudio {
        pcm,
        decoded_duration_ms,
        container_duration_ms,
    })
}

/// Load any supported audio file and return mono f32 PCM at 16 kHz (Whisper input).
pub fn load_audio_pcm(path: &Path) -> Result<Vec<f32>, WisperError> {
    Ok(load_audio(path)?.pcm)
}

/// Load audio with decode duration and optional container duration for truncation checks.
pub fn load_audio(path: &Path) -> Result<LoadedAudio, WisperError> {
    if path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("wav"))
    {
        let pcm = load_wav(path)?;
        let decoded_duration_ms = duration_ms_from_samples(pcm.len(), TARGET_SAMPLE_RATE);
        return Ok(LoadedAudio {
            pcm,
            decoded_duration_ms,
            container_duration_ms: None,
        });
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

fn decode_with_symphonia(path: &Path) -> Result<LoadedAudio, WisperError> {
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
    let container_duration_ms = track.codec_params.n_frames.and_then(|n_frames| {
        track
            .codec_params
            .sample_rate
            .map(|sr| duration_ms_from_samples(n_frames as usize, sr))
    });

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| WisperError::AudioDecode(e.to_string()))?;

    let mut pcm = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::ResetRequired) => continue,
            Err(SymphoniaError::IoError(err)) => {
                if pcm.is_empty() {
                    return Err(WisperError::AudioDecode("empty audio file".into()));
                }
                if err.kind() == std::io::ErrorKind::UnexpectedEof {
                    break;
                }
                return Err(WisperError::AudioDecode(err.to_string()));
            }
            Err(e) => return Err(WisperError::AudioDecode(e.to_string())),
        };

        if packet.track_id() != track_id {
            continue;
        }

        if codec != CODEC_TYPE_NULL {
            match decoder.decode(&packet) {
                Ok(decoded) => append_decoded(&mut pcm, decoded),
                Err(SymphoniaError::IoError(err))
                    if err.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    break;
                }
                Err(SymphoniaError::DecodeError(_)) => continue,
                Err(e) => return Err(WisperError::AudioDecode(e.to_string())),
            }
        }
    }

    if pcm.is_empty() {
        return Err(WisperError::AudioDecode("no audio samples decoded".into()));
    }

    let mono = downmix_to_mono(&pcm, channels);
    let resampled = resample_linear(&mono, sample_rate, TARGET_SAMPLE_RATE);
    let decoded_duration_ms = duration_ms_from_samples(resampled.len(), TARGET_SAMPLE_RATE);
    let loaded = LoadedAudio {
        pcm: resampled,
        decoded_duration_ms,
        container_duration_ms,
    };
    maybe_redecode_with_ffmpeg(path, loaded)
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
    fn looks_truncated_respects_threshold() {
        let truncated = LoadedAudio {
            pcm: vec![],
            decoded_duration_ms: 363_000,
            container_duration_ms: Some(726_000),
        };
        assert!(looks_truncated(&truncated));

        let within_tolerance = LoadedAudio {
            pcm: vec![],
            decoded_duration_ms: 360_000,
            container_duration_ms: Some(365_000),
        };
        assert!(!looks_truncated(&within_tolerance));

        let at_threshold = LoadedAudio {
            pcm: vec![],
            decoded_duration_ms: 360_000,
            container_duration_ms: Some(360_000 + TRUNCATION_THRESHOLD_MS),
        };
        assert!(!looks_truncated(&at_threshold));

        let no_container_metadata = LoadedAudio {
            pcm: vec![],
            decoded_duration_ms: 360_000,
            container_duration_ms: None,
        };
        assert!(!looks_truncated(&no_container_metadata));
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

    #[test]
    fn mp4_decodes_to_pcm_via_symphonia() {
        use std::process::Command;
        use uuid::Uuid;

        let ffmpeg_ok = resolve_ffmpeg().is_ok();
        if !ffmpeg_ok {
            eprintln!("skip mp4 decode test: ffmpeg not available");
            return;
        }
        let ffmpeg = resolve_ffmpeg().expect("checked above");

        let dir = std::env::temp_dir().join(format!("wisper-mp4-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let mp4 = dir.join("tone.mp4");

        let status = Command::new(&ffmpeg)
            .args([
                "-nostdin",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=2",
                "-c:a",
                "aac",
                "-b:a",
                "64k",
                mp4.to_str().expect("utf-8 path"),
            ])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .expect("ffmpeg spawn");

        assert!(status.success(), "ffmpeg failed to create test mp4");

        let pcm = load_audio_pcm(&mp4).expect("mp4 should decode via symphonia isomp4");
        assert!(
            pcm.len() > 16_000,
            "expected ~2s at 16kHz, got {} samples",
            pcm.len()
        );
        let peak = pcm.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        assert!(peak > 0.01, "PCM peak too quiet ({peak})");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
