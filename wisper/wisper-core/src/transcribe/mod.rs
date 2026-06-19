use std::ffi::c_void;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use whisper_rs::{FullParams, SamplingStrategy, WhisperContext};

use crate::audio;
use crate::compute::{compiled_gpu_backend, ComputeBackend};
use crate::engine::WhisperEngine;
use crate::error::WisperError;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TranscriptWord {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TranscriptSegment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub words: Option<Vec<TranscriptWord>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TranscriptionProgress {
    pub percent: i32,
    pub elapsed_ms: u64,
    pub duration_ms: u64,
}

/// Emitted when GPU inference fails and Wisper retries on CPU.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GpuFallbackNotice {
    pub requested_backend: ComputeBackend,
    pub from_gpu: String,
    pub reason: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TranscriptionResult {
    pub segments: Vec<TranscriptSegment>,
    pub requested_backend: ComputeBackend,
    pub actual_backend: ComputeBackend,
    pub used_cpu_fallback: bool,
}

pub type GpuFallbackCallback = Arc<dyn Fn(GpuFallbackNotice) + Send + Sync>;

#[derive(Debug, Clone)]
pub struct TranscribeOptions {
    pub language: Option<String>,
    pub verbose_logging: bool,
}

impl Default for TranscribeOptions {
    fn default() -> Self {
        Self {
            language: None,
            verbose_logging: false,
        }
    }
}

/// whisper-rs `set_abort_callback_safe` uses the wrong trampoline type (`F` instead of
/// `Box<dyn FnMut() -> bool>`), which can corrupt memory during GPU inference.
struct AbortGuard(*const AtomicBool);

impl Drop for AbortGuard {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                drop(Arc::from_raw(self.0));
            }
        }
    }
}

unsafe extern "C" fn abort_trampoline(user_data: *mut c_void) -> bool {
    if user_data.is_null() {
        return false;
    }
    let cancel = &*(user_data as *const AtomicBool);
    cancel.load(Ordering::Relaxed)
}

fn pcm_duration_ms(pcm: &[f32]) -> u64 {
    (pcm.len() as u64 * 1000) / 16_000
}

fn ms_to_timestamp(ms: i64) -> String {
    let total_sec = ms.max(0) / 1000;
    format!("{}:{:02}", total_sec / 60, total_sec % 60)
}

/// Log decoded vs container duration so truncation is visible before inference.
fn log_audio_decode_diagnostics(path: &Path, loaded: &audio::LoadedAudio) {
    eprintln!(
        "wisper: decode — file={} decoded={} ({:.1}s, {} samples)",
        path.display(),
        ms_to_timestamp(loaded.decoded_duration_ms as i64),
        loaded.decoded_duration_ms as f64 / 1000.0,
        loaded.pcm.len(),
    );
    if let Some(container_ms) = loaded.container_duration_ms {
        eprintln!(
            "wisper: decode — container metadata={} ({:.1}s)",
            ms_to_timestamp(container_ms as i64),
            container_ms as f64 / 1000.0,
        );
        let missing_ms = container_ms as i64 - loaded.decoded_duration_ms as i64;
        if missing_ms > 10_000 {
            eprintln!(
                "wisper: warning — decoded audio is {:.1}s SHORTER than container metadata. \
                 Wisper will only transcribe the decoded portion.",
                missing_ms as f64 / 1000.0
            );
        }
    }
}

/// Per-chunk inference stats (logged before merge so empty chunks vs merge drops are distinguishable).
fn log_chunk_diagnostics(
    chunk_index: usize,
    chunk_count: usize,
    offset_ms: i32,
    duration_ms: i32,
    segments: &[TranscriptSegment],
) {
    if segments.is_empty() {
        eprintln!(
            "wisper: chunk {}/{} offset={}ms dur={}ms — NO SEGMENTS (whisper returned nothing)",
            chunk_index + 1,
            chunk_count,
            offset_ms,
            duration_ms,
        );
        return;
    }

    let min_start = segments.iter().map(|s| s.start_ms).min().unwrap_or(0);
    let max_end = segments.iter().map(|s| s.end_ms).max().unwrap_or(0);
    eprintln!(
        "wisper: chunk {}/{} offset={}ms dur={}ms — {} segments, timestamps {}..{} (window {}..{})",
        chunk_index + 1,
        chunk_count,
        offset_ms,
        duration_ms,
        segments.len(),
        ms_to_timestamp(min_start),
        ms_to_timestamp(max_end),
        ms_to_timestamp(i64::from(offset_ms)),
        ms_to_timestamp(i64::from(offset_ms) + i64::from(duration_ms)),
    );
}

fn log_merge_diagnostics(
    chunk_index: usize,
    before_count: usize,
    merged_len_before: usize,
    merged_len_after: usize,
) {
    let added = merged_len_after.saturating_sub(merged_len_before);
    if chunk_index > 0 && before_count > 0 && added == 0 {
        eprintln!(
            "wisper: warning — chunk {} produced {} segments but merge added 0 \
             (overlap filter may have dropped them all)",
            chunk_index + 1,
            before_count,
        );
    } else if chunk_index > 0 {
        eprintln!(
            "wisper: chunk {} merge — kept {}/{} segments",
            chunk_index + 1,
            added,
            before_count,
        );
    }
}

fn log_transcription_summary(
    duration_ms: u64,
    chunk_count: usize,
    segments: &[TranscriptSegment],
) {
    eprintln!(
        "wisper: transcribe — {} chunk(s), audio {:.1}s",
        chunk_count,
        duration_ms as f64 / 1000.0,
    );
    if segments.is_empty() {
        eprintln!("wisper: transcribe — finished with NO segments");
        return;
    }
    let last_end = segments.iter().map(|s| s.end_ms).max().unwrap_or(0);
    eprintln!(
        "wisper: transcribe — {} segments total, last timestamp {}",
        segments.len(),
        ms_to_timestamp(last_end),
    );
    let expected_ms = duration_ms as i64;
    if last_end + 60_000 < expected_ms {
        eprintln!(
            "wisper: warning — transcript ends at {} ({:.1}s) but audio is ~{:.1}s",
            ms_to_timestamp(last_end),
            last_end as f64 / 1000.0,
            expected_ms as f64 / 1000.0,
        );
    }
}

/// whisper.cpp can loop on one long `full()` pass (~15–20+ min). Split into windows instead.
/// See: https://github.com/ggml-org/whisper.cpp/issues/2606
const CHUNK_DURATION_MS: i64 = 180_000;
const CHUNK_OVERLAP_MS: i64 = 2_000;
const CHUNK_THRESHOLD_MS: u64 = CHUNK_DURATION_MS as u64;

/// One transcribe window over the full PCM buffer (offset + duration in ms).
struct TranscribeWindow {
    offset_ms: i32,
    duration_ms: i32,
}

fn transcribe_windows(pcm: &[f32]) -> Vec<TranscribeWindow> {
    chunk_windows(pcm_duration_ms(pcm))
        .into_iter()
        .map(|(offset_ms, duration_ms)| TranscribeWindow {
            offset_ms,
            duration_ms,
        })
        .collect()
}
/// `(offset_ms, duration_ms)` windows covering `[0, total_ms)`.
fn chunk_windows(total_ms: u64) -> Vec<(i32, i32)> {
    if total_ms <= CHUNK_THRESHOLD_MS {
        return vec![(0, total_ms as i32)];
    }

    let total = total_ms as i32;
    let chunk = CHUNK_DURATION_MS as i32;
    let overlap = CHUNK_OVERLAP_MS as i32;
    let step = chunk - overlap;
    let mut windows = Vec::new();
    let mut offset = 0i32;

    while offset < total {
        let dur = (total - offset).min(chunk);
        windows.push((offset, dur));
        if offset + dur >= total {
            break;
        }
        offset += step;
    }

    windows
}

type ProgressCallback = Arc<Mutex<Box<dyn FnMut(TranscriptionProgress) + Send>>>;

fn is_special_token(piece: &str) -> bool {
    piece.starts_with('[') && piece.ends_with(']')
}

fn collect_words(segment: &whisper_rs::WhisperSegment<'_>) -> Vec<TranscriptWord> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut word_start: Option<i64> = None;
    let mut word_end = 0i64;

    for token_idx in 0..segment.n_tokens() {
        let Some(token) = segment.get_token(token_idx) else {
            continue;
        };
        let piece = match token.to_str_lossy() {
            Ok(piece) => piece.into_owned(),
            Err(_) => continue,
        };
        if piece.is_empty() || is_special_token(&piece) {
            continue;
        }

        let data = token.token_data();
        let t0 = data.t0 * 10;
        let t1 = data.t1 * 10;
        let starts_word = piece.starts_with(' ') || current.is_empty();

        if starts_word && !current.is_empty() {
            let text = current.trim().to_string();
            if !text.is_empty() {
                words.push(TranscriptWord {
                    start_ms: word_start.unwrap_or(0),
                    end_ms: word_end,
                    text,
                });
            }
            current.clear();
            word_start = None;
        }

        if word_start.is_none() {
            word_start = Some(t0);
        }
        word_end = t1;
        current.push_str(piece.trim_start());
    }

    let text = current.trim().to_string();
    if !text.is_empty() {
        words.push(TranscriptWord {
            start_ms: word_start.unwrap_or(0),
            end_ms: word_end,
            text,
        });
    }

    words
}

fn collect_segments(state: &whisper_rs::WhisperState) -> Result<Vec<TranscriptSegment>, WisperError> {
    let n = state.full_n_segments();
    let mut segments = Vec::with_capacity(n as usize);
    let mut speaker_idx = 1usize;

    for i in 0..n {
        let segment = state
            .get_segment(i)
            .ok_or_else(|| WisperError::Transcription(format!("missing segment {i}")))?;

        let text = segment
            .to_str_lossy()
            .map_err(|e| WisperError::Transcription(e.to_string()))?
            .trim()
            .to_string();

        if text.is_empty() {
            continue;
        }

        let words = collect_words(&segment);
        let speaker = Some(format!("Speaker {speaker_idx}"));

        segments.push(TranscriptSegment {
            // whisper.cpp applies offset_ms to segment t0/t1 when using the full PCM buffer.
            start_ms: segment.start_timestamp() * 10,
            end_ms: segment.end_timestamp() * 10,
            text,
            speaker,
            words: if words.is_empty() { None } else { Some(words) },
        });

        if segment.next_segment_speaker_turn() {
            speaker_idx += 1;
        }
    }

    Ok(segments)
}

fn merge_chunk_segments(
    merged: &mut Vec<TranscriptSegment>,
    chunk_index: usize,
    chunk_offset_ms: i32,
    _chunk_duration_ms: i32,
    is_last_chunk: bool,
    mut chunk_segments: Vec<TranscriptSegment>,
) {
    if chunk_index > 0 {
        let overlap_cutoff = i64::from(chunk_offset_ms) + CHUNK_OVERLAP_MS;
        let retained: Vec<_> = chunk_segments
            .iter()
            .filter(|s| s.start_ms >= overlap_cutoff)
            .cloned()
            .collect();
        if !retained.is_empty() {
            chunk_segments = retained;
        } else if is_last_chunk {
            // Last sliver can fall entirely inside overlap — keep it rather than drop all.
        } else {
            chunk_segments.retain(|s| s.start_ms >= overlap_cutoff);
        }
    }

    for seg in chunk_segments {
        if merged
            .last()
            .is_some_and(|prev| prev.text == seg.text)
        {
            continue;
        }
        merged.push(seg);
    }
}

fn apply_chunk_window(
    params: &mut FullParams<'_, '_>,
    offset_ms: i32,
    duration_ms: i32,
    chunked: bool,
) {
    params.set_offset_ms(offset_ms);
    params.set_duration_ms(duration_ms);
    if chunked {
        // Avoid cross-chunk prompt conditioning that reinforces repetition loops.
        params.set_no_context(true);
        params.set_n_max_text_ctx(0);
    }
}

fn attach_progress(
    params: &mut FullParams<'_, '_>,
    on_progress: &ProgressCallback,
    started: Instant,
    duration_ms: u64,
    chunk_index: usize,
    chunk_count: usize,
) {
    let progress_cb = Arc::clone(on_progress);
    params.set_progress_callback_safe(move |percent| {
        if let Ok(mut cb) = progress_cb.lock() {
            let overall = if chunk_count <= 1 {
                percent
            } else {
                ((chunk_index as i32 * 100) + percent) / chunk_count as i32
            };
            cb(TranscriptionProgress {
                percent: overall,
                elapsed_ms: started.elapsed().as_millis() as u64,
                duration_ms,
            });
        }
    });
}

fn attach_abort(params: &mut FullParams<'_, '_>, cancel: &Arc<AtomicBool>) -> AbortGuard {
    let cancel_for_abort = Arc::clone(cancel);
    let cancel_ptr = Arc::into_raw(cancel_for_abort) as *mut c_void;
    let guard = AbortGuard(cancel_ptr as *const AtomicBool);
    unsafe {
        params.set_abort_callback(Some(abort_trampoline));
        params.set_abort_callback_user_data(cancel_ptr);
    }
    guard
}

/// Transcribe mono PCM already loaded at 16 kHz.
pub fn transcribe_pcm(
    ctx: &WhisperContext,
    pcm: &[f32],
    options: &TranscribeOptions,
    cancel: Arc<AtomicBool>,
    on_progress: ProgressCallback,
) -> Result<Vec<TranscriptSegment>, WisperError> {
    let duration_ms = pcm_duration_ms(pcm);
    let started = Instant::now();
    let windows = transcribe_windows(pcm);
    let chunked = windows.len() > 1;
    let mut merged = Vec::new();
    let verbose = options.verbose_logging;

    eprintln!(
        "wisper: transcribe — starting {} window(s) over {:.1}s PCM",
        windows.len(),
        duration_ms as f64 / 1000.0,
    );

    for (chunk_index, window) in windows.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Err(WisperError::Cancelled);
        }

        let mut state = ctx
            .create_state()
            .map_err(|e| WisperError::Transcription(e.to_string()))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_translate(false);
        if let Some(lang) = options.language.as_deref() {
            params.set_language(Some(lang));
        }
        params.set_debug_mode(false);
        params.set_token_timestamps(true);
        params.set_tdrz_enable(true);
        apply_chunk_window(&mut params, window.offset_ms, window.duration_ms, chunked);
        params.set_print_special(verbose);
        params.set_print_progress(verbose);
        params.set_print_realtime(verbose);
        params.set_print_timestamps(verbose);
        attach_progress(
            &mut params,
            &on_progress,
            started,
            duration_ms,
            chunk_index,
            windows.len(),
        );
        let _abort_guard = attach_abort(&mut params, &cancel);

        state
            .full(params, pcm)
            .map_err(|e| WisperError::Transcription(e.to_string()))?;

        if cancel.load(Ordering::Relaxed) {
            return Err(WisperError::Cancelled);
        }

        let chunk_segments = collect_segments(&state)?;
        log_chunk_diagnostics(
            chunk_index,
            windows.len(),
            window.offset_ms,
            window.duration_ms,
            &chunk_segments,
        );
        let merged_len_before = merged.len();
        let before_count = chunk_segments.len();
        merge_chunk_segments(
            &mut merged,
            chunk_index,
            window.offset_ms,
            window.duration_ms,
            chunk_index + 1 == windows.len(),
            chunk_segments,
        );
        log_merge_diagnostics(chunk_index, before_count, merged_len_before, merged.len());
    }

    log_transcription_summary(duration_ms, windows.len(), &merged);

    Ok(merged)
}

fn gpu_backend_label() -> String {
    compiled_gpu_backend()
        .map(|k| k.label().to_string())
        .unwrap_or_else(|| "GPU".into())
}

/// Transcribe using a cached engine (reloads model only when path or backend changes).
/// When GPU is requested and fails, drops the cached GPU context, notifies via
/// `on_gpu_fallback`, and retries once on CPU (Intel, AMD, and ARM via ggml-cpu).
pub fn transcribe_with_engine(
    engine: &mut WhisperEngine,
    model_path: &Path,
    audio_path: &Path,
    backend: ComputeBackend,
    options: &TranscribeOptions,
    cancel: Arc<AtomicBool>,
    on_progress: impl FnMut(TranscriptionProgress) + Send + 'static,
    on_gpu_fallback: Option<GpuFallbackCallback>,
) -> Result<TranscriptionResult, WisperError> {
    if !audio_path.exists() {
        return Err(WisperError::AudioNotFound(
            audio_path.display().to_string(),
        ));
    }

    let loaded = audio::load_audio(audio_path)?;
    log_audio_decode_diagnostics(audio_path, &loaded);
    let pcm = loaded.pcm;
    let progress: ProgressCallback = Arc::new(Mutex::new(Box::new(on_progress)));

    let run = |engine: &mut WhisperEngine, backend: ComputeBackend| {
        engine.with_context(model_path, backend, |ctx| {
            transcribe_pcm(
                ctx,
                &pcm,
                options,
                Arc::clone(&cancel),
                Arc::clone(&progress),
            )
        })
    };

    match run(engine, backend) {
        Ok(segments) => Ok(TranscriptionResult {
            segments,
            requested_backend: backend,
            actual_backend: backend,
            used_cpu_fallback: false,
        }),
        Err(err) if backend == ComputeBackend::Gpu => {
            let from_gpu = gpu_backend_label();
            eprintln!("wisper: {from_gpu} transcription failed ({err}); retrying on CPU");
            if let Some(cb) = &on_gpu_fallback {
                cb(GpuFallbackNotice {
                    requested_backend: ComputeBackend::Gpu,
                    from_gpu: from_gpu.clone(),
                    reason: err.to_string(),
                });
            }
            engine.invalidate_backend(ComputeBackend::Gpu);
            let segments = run(engine, ComputeBackend::Cpu).map_err(|cpu_err| {
                WisperError::Transcription(format!(
                    "{from_gpu} transcription failed ({err}); CPU fallback also failed ({cpu_err})"
                ))
            })?;
            Ok(TranscriptionResult {
                segments,
                requested_backend: ComputeBackend::Gpu,
                actual_backend: ComputeBackend::Cpu,
                used_cpu_fallback: true,
            })
        }
        Err(err) => Err(err),
    }
}

/// Transcribe a local audio file using whisper.cpp (fully offline).
/// Loads the model on every call — prefer [`transcribe_with_engine`] when transcribing repeatedly.
pub fn transcribe_file(
    model_path: &Path,
    audio_path: &Path,
    backend: ComputeBackend,
) -> Result<Vec<TranscriptSegment>, WisperError> {
    let mut engine = WhisperEngine::new();
    transcribe_with_engine(
        &mut engine,
        model_path,
        audio_path,
        backend,
        &TranscribeOptions::default(),
        Arc::new(AtomicBool::new(false)),
        |_| {},
        None,
    )
    .map(|r| r.segments)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_audio_uses_single_window() {
        assert_eq!(chunk_windows(60_000), vec![(0, 60_000)]);
        assert_eq!(chunk_windows(CHUNK_THRESHOLD_MS), vec![(0, CHUNK_THRESHOLD_MS as i32)]);
    }

    #[test]
    fn thirty_minute_audio_is_split_with_overlap() {
        let total_ms = 30 * 60 * 1000;
        let windows = chunk_windows(total_ms);
        assert!(windows.len() > 1);
        assert_eq!(windows.first().copied(), Some((0, CHUNK_DURATION_MS as i32)));
        assert_eq!(
            windows.last().map(|(o, d)| i64::from(*o) + i64::from(*d)),
            Some(total_ms as i64)
        );

        for w in windows.windows(2) {
            let (prev_off, prev_dur) = w[0];
            let (next_off, _) = w[1];
            assert_eq!(
                i64::from(next_off),
                i64::from(prev_off) + i64::from(prev_dur) - CHUNK_OVERLAP_MS
            );
        }
    }

    #[test]
    fn transcribe_windows_cover_thirty_minutes() {
        let total_ms = 30 * 60 * 1000;
        let pcm = vec![0.0_f32; (total_ms as usize * 16_000) / 1000];
        let windows = transcribe_windows(&pcm);

        assert!(windows.len() > 1);
        assert_eq!(windows[0].offset_ms, 0);
        assert_eq!(windows[0].duration_ms, CHUNK_DURATION_MS as i32);

        let last = windows.last().unwrap();
        assert_eq!(
            i64::from(last.offset_ms) + i64::from(last.duration_ms),
            total_ms as i64
        );
    }

    #[test]
    fn twelve_minute_audio_is_split_with_overlap() {
        let total_ms = 12 * 60 * 1000;
        let windows = chunk_windows(total_ms);
        assert!(windows.len() > 1);
        assert_eq!(
            windows.last().map(|(o, d)| i64::from(*o) + i64::from(*d)),
            Some(total_ms as i64)
        );
    }

    #[test]
    fn merge_skips_overlap_and_duplicate_text() {
        let mut merged = vec![TranscriptSegment {
            start_ms: 170_000,
            end_ms: 172_000,
            text: "end of chunk one".into(),
            speaker: None,
            words: None,
        }];

        merge_chunk_segments(
            &mut merged,
            1,
            178_000,
            180_000,
            false,
            vec![
                TranscriptSegment {
                    start_ms: 178_500,
                    end_ms: 179_000,
                    text: "inside overlap".into(),
                    speaker: None,
                    words: None,
                },
                TranscriptSegment {
                    start_ms: 180_000,
                    end_ms: 181_000,
                    text: "end of chunk one".into(),
                    speaker: None,
                    words: None,
                },
                TranscriptSegment {
                    start_ms: 181_000,
                    end_ms: 182_000,
                    text: "new content".into(),
                    speaker: None,
                    words: None,
                },
            ],
        );

        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].text, "end of chunk one");
        assert_eq!(merged[1].text, "new content");
    }
}
