# Slice K — Burn-in subtitles, word timing, diarization (beta.28)

**Status:** In progress on `feature/resona-ui`  
**Version target:** `0.2.0-beta.28`

## In scope

1. **Word-level timing** — collect whisper token timestamps per segment; export as word-level SRT and CSV; show speaker + word timings in the transcript UI (hover).
2. **Speaker turns (tinydiarize)** — enable whisper.cpp `tdrz` + `next_segment_speaker_turn()`; label segments `Speaker 1`, `Speaker 2`, …; persist in DB schema v3; prefix speaker in TXT/SRT/VTT/CSV exports.
3. **Burn-in subtitles** — for imported video recordings, render segment SRT into a new MP4 via ffmpeg `subtitles` filter; save dialog from the transcript toolbar when ffmpeg is available.

## Out of scope

- Full pyannote-style speaker identification or voice profiles
- Karaoke-style word highlight playback in the UI
- Re-transcribing old library items automatically (new transcriptions only get words/speakers)
- Burn-in styling editor / font picker
- Non-MP4 burn-in output formats (output is always `.mp4`)

## Technical notes

- `transcript_segments` gains `speaker` and `words_json` columns (schema v3 migration).
- `RecordingSummary` exposes `media_path` and `is_video` for burn-in eligibility.
- Editing a segment clears stored word timings (text is authoritative).
- Diarization quality depends on the whisper model and tinydiarize; treat labels as experimental.

## Smoke gate

```powershell
cd wisper
.\scripts\smoke-test.ps1
```
