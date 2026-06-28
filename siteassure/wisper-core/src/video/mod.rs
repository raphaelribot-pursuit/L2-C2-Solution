use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::Stdio;

use crate::error::WisperError;
use crate::export::format_transcript_srt;
use crate::ffmpeg_tools::resolve_ffmpeg;
use crate::managed_binary::command_for_binary;
use crate::transcribe::TranscriptSegment;

const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mov", "mkv", "webm", "m4v"];

pub fn is_video_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .is_some_and(|ext| VIDEO_EXTENSIONS.iter().any(|candidate| *candidate == ext))
}

fn escape_subtitles_filter_path(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    normalized.replace(':', "\\:")
}

/// Burn segment subtitles into a video file using ffmpeg's subtitles filter.
pub fn burn_in_subtitles(
    video_path: &Path,
    segments: &[TranscriptSegment],
    output_path: &Path,
) -> Result<(), WisperError> {
    if !video_path.is_file() {
        return Err(WisperError::Export(format!(
            "video file not found: {}",
            video_path.display()
        )));
    }
    if !is_video_path(video_path) {
        return Err(WisperError::Export(
            "burn-in subtitles requires a video file (mp4, mov, mkv, webm, m4v)".into(),
        ));
    }

    let ffmpeg = resolve_ffmpeg().map_err(|_| {
        WisperError::Export(
            "ffmpeg is required for burn-in subtitles — install it from Advanced options".into(),
        )
    })?;

    let srt = format_transcript_srt(segments);
    if srt.trim().is_empty() {
        return Err(WisperError::Export(
            "no subtitle cues to burn in — transcript is empty".into(),
        ));
    }

    let temp_dir = std::env::temp_dir().join(format!(
        "wisper-burnin-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&temp_dir).map_err(|e| WisperError::Export(e.to_string()))?;
    let srt_path = temp_dir.join("subs.srt");
    {
        let mut file = fs::File::create(&srt_path).map_err(|e| WisperError::Export(e.to_string()))?;
        file.write_all(srt.as_bytes())
            .map_err(|e| WisperError::Export(e.to_string()))?;
    }

    let filter_path = escape_subtitles_filter_path(&srt_path);
    let vf = format!("subtitles='{filter_path}':force_style='FontSize=24,PrimaryColour=&HFFFFFF&'");

    let status = command_for_binary(&ffmpeg)
        .arg("-y")
        .arg("-i")
        .arg(video_path)
        .arg("-vf")
        .arg(vf)
        .arg("-c:a")
        .arg("copy")
        .arg(output_path)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .status()
        .map_err(|e| WisperError::Export(e.to_string()))?;

    let _ = fs::remove_dir_all(&temp_dir);

    if !status.success() {
        return Err(WisperError::Export(
            "ffmpeg failed to burn in subtitles — check that the source video is valid".into(),
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcribe::TranscriptSegment;
    use std::process::Command;

    #[test]
    fn detects_video_extensions() {
        assert!(is_video_path(Path::new("clip.mp4")));
        assert!(is_video_path(Path::new("clip.MOV")));
        assert!(!is_video_path(Path::new("clip.wav")));
    }

    #[test]
    fn burn_in_creates_output_video() {
        let ffmpeg = match crate::ffmpeg_tools::resolve_ffmpeg() {
            Ok(path) => path,
            Err(_) => {
                eprintln!("skip burn-in test: ffmpeg not available");
                return;
            }
        };

        let dir = std::env::temp_dir().join(format!("wisper-burnin-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let input = dir.join("input.mp4");
        let output = dir.join("output.mp4");

        let status = Command::new(&ffmpeg)
            .args([
                "-nostdin",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=640x360:d=3",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=3",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "64k",
                "-shortest",
                input.to_str().expect("utf-8 path"),
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("ffmpeg spawn");
        assert!(status.success(), "ffmpeg failed to create sample video");

        let segments = vec![
            TranscriptSegment {
                start_ms: 0,
                end_ms: 1_500,
                text: "Hello burn-in".into(),
                speaker: Some("Speaker 1".into()),
                words: None,
            },
            TranscriptSegment {
                start_ms: 1_500,
                end_ms: 3_000,
                text: "Second cue".into(),
                speaker: Some("Speaker 2".into()),
                words: None,
            },
        ];

        burn_in_subtitles(&input, &segments, &output).expect("burn-in should succeed");
        assert!(output.is_file(), "output mp4 missing");
        let size = std::fs::metadata(&output).expect("metadata").len();
        assert!(size > 1_000, "output too small ({size} bytes)");

        let probe_bin = crate::ffmpeg_tools::resolve_ffprobe().unwrap_or(ffmpeg.clone());
        let probe = Command::new(&probe_bin)
            .args([
                "-hide_banner",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=codec_type",
                "-of",
                "csv=p=0",
                output.to_str().expect("utf-8 path"),
            ])
            .output()
            .expect("ffprobe spawn");
        assert!(
            probe.status.success(),
            "ffprobe failed: {}",
            String::from_utf8_lossy(&probe.stderr)
        );
        assert_eq!(
            String::from_utf8_lossy(&probe.stdout).trim(),
            "video",
            "expected video stream in output"
        );

        eprintln!("burn-in manual artifact: {}", output.display());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
