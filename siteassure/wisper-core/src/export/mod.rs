use crate::transcribe::{TranscriptSegment, TranscriptWord};

mod bundle;
mod docx;
mod pdf;

pub use bundle::{build_library_bundle, build_transcript_bundle, TranscriptExportSet};
pub use docx::format_transcript_docx;
pub use pdf::format_transcript_pdf;

fn subtitle_text(seg: &TranscriptSegment) -> String {
    let text = seg.text.trim();
    if let Some(speaker) = seg.speaker.as_deref() {
        format!("{speaker}: {text}")
    } else {
        text.to_string()
    }
}

fn format_timestamp_hms(ms: i64) -> (u64, u64, u64, u64) {
    let ms = ms.max(0) as u64;
    let hours = ms / 3_600_000;
    let minutes = (ms % 3_600_000) / 60_000;
    let seconds = (ms % 60_000) / 1000;
    let millis = ms % 1000;
    (hours, minutes, seconds, millis)
}

fn format_srt_timestamp(ms: i64) -> String {
    let (hours, minutes, seconds, millis) = format_timestamp_hms(ms);
    format!("{hours:02}:{minutes:02}:{seconds:02},{millis:03}")
}

fn format_vtt_timestamp(ms: i64) -> String {
    let (hours, minutes, seconds, millis) = format_timestamp_hms(ms);
    format!("{hours:02}:{minutes:02}:{seconds:02}.{millis:03}")
}

fn format_timestamp(ms: i64) -> String {
    let total_seconds = ms.max(0) / 1000;
    let minutes = total_seconds / 60;
    let seconds = total_seconds % 60;
    format!("{minutes}:{seconds:02}")
}

/// Plain-text export: one block per segment with `[start – end]` prefix.
pub fn format_transcript_txt(segments: &[TranscriptSegment]) -> String {
    segments
        .iter()
        .filter_map(|seg| {
            let text = subtitle_text(seg);
            if text.trim().is_empty() {
                return None;
            }
            Some(format!(
                "[{} – {}] {}",
                format_timestamp(seg.start_ms),
                format_timestamp(seg.end_ms),
                text
            ))
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// SubRip (.srt): numbered cues with `HH:MM:SS,mmm` timestamps.
pub fn format_transcript_srt(segments: &[TranscriptSegment]) -> String {
    let mut index = 1usize;
    let mut blocks = Vec::new();
    for seg in segments {
        let text = subtitle_text(seg);
        if text.trim().is_empty() {
            continue;
        }
        blocks.push(format!(
            "{index}\n{} --> {}\n{text}",
            format_srt_timestamp(seg.start_ms),
            format_srt_timestamp(seg.end_ms),
        ));
        index += 1;
    }
    blocks.join("\n\n")
}

/// Word-level SubRip (.srt): one cue per timed word when word data is available.
pub fn format_transcript_srt_words(segments: &[TranscriptSegment]) -> String {
    let mut index = 1usize;
    let mut blocks = Vec::new();

    for seg in segments {
        let Some(words) = seg.words.as_ref() else {
            let text = subtitle_text(seg);
            if text.trim().is_empty() {
                continue;
            }
            blocks.push(format!(
                "{index}\n{} --> {}\n{text}",
                format_srt_timestamp(seg.start_ms),
                format_srt_timestamp(seg.end_ms),
            ));
            index += 1;
            continue;
        };

        for word in words {
            let text = word.text.trim();
            if text.is_empty() {
                continue;
            }
            let label = seg
                .speaker
                .as_deref()
                .map(|speaker| format!("{speaker}: {text}"))
                .unwrap_or_else(|| text.to_string());
            blocks.push(format!(
                "{index}\n{} --> {}\n{label}",
                format_srt_timestamp(word.start_ms),
                format_srt_timestamp(word.end_ms.max(word.start_ms + 1)),
            ));
            index += 1;
        }
    }

    blocks.join("\n\n")
}

/// WebVTT (.vtt): header plus `HH:MM:SS.mmm` cues.
pub fn format_transcript_vtt(segments: &[TranscriptSegment]) -> String {
    let mut cues: Vec<String> = Vec::new();
    for seg in segments {
        let text = subtitle_text(seg);
        if text.trim().is_empty() {
            continue;
        }
        cues.push(format!(
            "{} --> {}\n{text}",
            format_vtt_timestamp(seg.start_ms),
            format_vtt_timestamp(seg.end_ms),
        ));
    }
    if cues.is_empty() {
        return String::new();
    }
    let mut lines = vec!["WEBVTT".to_string(), String::new()];
    for cue in cues {
        lines.push(cue);
        lines.push(String::new());
    }
    while lines.last().is_some_and(|line| line.is_empty()) {
        lines.pop();
    }
    lines.join("\n")
}

#[derive(serde::Serialize)]
struct TranscriptJsonExport<'a> {
    title: &'a str,
    segments: &'a [TranscriptSegment],
}

/// JSON export: title plus segment array with millisecond timestamps.
pub fn format_transcript_json(title: &str, segments: &[TranscriptSegment]) -> String {
    let payload = TranscriptJsonExport { title, segments };
    serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".into())
}

fn csv_cell(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r')
    {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

/// CSV export: `start_ms,end_ms,speaker,text` header plus one row per non-empty segment.
pub fn format_transcript_csv(segments: &[TranscriptSegment]) -> String {
    let mut lines = vec!["start_ms,end_ms,speaker,text".to_string()];
    for seg in segments {
        let text = seg.text.trim();
        if text.is_empty() {
            continue;
        }
        lines.push(format!(
            "{},{},{},{}",
            seg.start_ms,
            seg.end_ms,
            csv_cell(seg.speaker.as_deref().unwrap_or("")),
            csv_cell(text)
        ));
    }
    lines.join("\n")
}

/// CSV export with one row per timed word when available.
pub fn format_transcript_csv_words(segments: &[TranscriptSegment]) -> String {
    let mut lines = vec!["start_ms,end_ms,speaker,word".to_string()];
    for seg in segments {
        if let Some(words) = seg.words.as_ref() {
            for word in words {
                let text = word.text.trim();
                if text.is_empty() {
                    continue;
                }
                lines.push(format!(
                    "{},{},{},{}",
                    word.start_ms,
                    word.end_ms,
                    csv_cell(seg.speaker.as_deref().unwrap_or("")),
                    csv_cell(text)
                ));
            }
        } else {
            let text = seg.text.trim();
            if text.is_empty() {
                continue;
            }
            lines.push(format!(
                "{},{},{},{}",
                seg.start_ms,
                seg.end_ms,
                csv_cell(seg.speaker.as_deref().unwrap_or("")),
                csv_cell(text)
            ));
        }
    }
    lines.join("\n")
}

/// Safe folder name inside a ZIP export (no path separators or reserved characters).
pub fn sanitize_export_folder_name(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim();
    let truncated: String = trimmed.chars().take(60).collect();
    let collapsed = truncated.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed_underscores = collapsed.trim_matches('_');
    if trimmed_underscores.is_empty() {
        "transcript".to_string()
    } else {
        trimmed_underscores.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_segment() -> TranscriptSegment {
        TranscriptSegment {
            start_ms: 0,
            end_ms: 1500,
            text: "Hello".into(),
            speaker: Some("Speaker 1".into()),
            words: Some(vec![TranscriptWord {
                start_ms: 0,
                end_ms: 700,
                text: "Hello".into(),
            }]),
        }
    }

    #[test]
    fn format_transcript_txt_includes_timestamps() {
        let text = format_transcript_txt(&[sample_segment()]);
        assert!(text.contains("[0:00 – 0:01] Speaker 1: Hello"));
    }

    #[test]
    fn format_transcript_srt_standard_cue() {
        let text = format_transcript_srt(&[sample_segment()]);
        assert!(text.starts_with("1\n"));
        assert!(text.contains("00:00:00,000 --> 00:00:01,500"));
        assert!(text.contains("Hello"));
    }

    #[test]
    fn format_transcript_vtt_includes_header() {
        let text = format_transcript_vtt(&[sample_segment()]);
        assert!(text.starts_with("WEBVTT\n"));
        assert!(text.contains("00:00:00.000 --> 00:00:01.500"));
        assert!(text.contains("Hello"));
    }

    #[test]
    fn export_skips_empty_segment_text() {
        let empty = TranscriptSegment {
            start_ms: 2000,
            end_ms: 3000,
            text: "   ".into(),
            speaker: None,
            words: None,
        };
        assert!(format_transcript_srt(&[empty.clone()]).is_empty());
        assert!(format_transcript_vtt(&[empty]).is_empty());
    }

    #[test]
    fn srt_supports_hour_long_timestamps() {
        let seg = TranscriptSegment {
            start_ms: 3_661_500,
            end_ms: 3_662_000,
            text: "Late".into(),
            speaker: None,
            words: None,
        };
        let text = format_transcript_srt(&[seg]);
        assert!(text.contains("01:01:01,500 --> 01:01:02,000"));
    }

    #[test]
    fn json_includes_title_and_segments() {
        let seg = sample_segment();
        let json = format_transcript_json("Demo", &[seg]);
        assert!(json.contains("\"title\": \"Demo\""));
        assert!(json.contains("\"start_ms\": 0"));
        assert!(json.contains("Hello"));
    }

    #[test]
    fn srt_includes_speaker_prefix() {
        let text = format_transcript_srt(&[sample_segment()]);
        assert!(text.contains("Speaker 1: Hello"));
    }

    #[test]
    fn word_level_srt_emits_per_word_cues() {
        let text = format_transcript_srt_words(&[sample_segment()]);
        assert!(text.contains("00:00:00,000 --> 00:00:00,700"));
        assert!(text.contains("Speaker 1: Hello"));
    }

    #[test]
    fn csv_has_speaker_column() {
        let csv = format_transcript_csv(&[sample_segment()]);
        assert!(csv.starts_with("start_ms,end_ms,speaker,text"));
        assert!(csv.contains("Speaker 1"));
    }

    #[test]
    fn sanitize_export_folder_name_strips_bad_chars() {
        assert_eq!(sanitize_export_folder_name("  My:File?  "), "My_File");
    }
}
