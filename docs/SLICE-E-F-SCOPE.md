# Slice E & F — Locked scope (beta.22 / beta.23)

**Status:** Approved — Aisling standing decision (2026-06-19)  
**Ship order:** **beta.22** (Slice E) → **beta.23** (Slice F)  
**Rule:** One slice → smoke test → commit → tag → Release CI

---

## Slice E — SRT / WebVTT (`beta.22`)

### In scope

- Export from the transcript panel (next to Export TXT)
- Uses **edited** segment text and Whisper **segment** timestamps
- Standard `.srt` and `.vtt` save dialogs
- Same local-first behavior as TXT

### Out of scope (not promised in beta.22)

- Batch export / zip of whole library
- Word, PDF, JSON, CSV
- Burn-in subtitles on video (needs ffmpeg + video pipeline)
- Speaker names / diarization
- Word-level timing (only segment-level)
- Auto line-wrapping for broadcast specs
- Cloud upload

---

## Slice F — yt-dlp installer (`beta.23`)

### In scope

- **Install yt-dlp** button → downloads official binary to app data (`…/bin/yt-dlp`)
- Welcome guide + banner on URL import when missing
- Progress UI (like model download)
- Windows x64, Mac, Linux x64
- Existing PATH yt-dlp still works

### Out of scope (not promised in beta.23)

- yt-dlp bundled inside the `.exe`/`.dmg` (on-demand download only)
- Auto-update yt-dlp every launch
- ffmpeg installer (still separate; README)
- Login/cookies for paywalled sites
- Playlist / channel bulk import
- Video quality picker
- Proxy / corporate SSL UI

---

## Still deferred (unchanged)

- File size limits
- PostHog / analytics suite
- Pin Advanced (Option C)

### Resona polish layer (Slice H — post visual redesign)

Tracked in [RESONA-VISUAL-REDESIGN.md](./RESONA-VISUAL-REDESIGN.md) and [ROADMAP.md](../ROADMAP.md):

- Live streaming dictation + partial transcripts
- Grammar review / filler removal / writing score

Source: `L2 project 1 Resona/resona/` — **not** in Slice UX scope.

### Visual redesign (Slice UX — pending OK)

- EmptyStateHero + Resona rebrand — see [RESONA-VISUAL-REDESIGN.md](./RESONA-VISUAL-REDESIGN.md)
- Mockups: `wisper/design/mockups/direction-ab-hybrid.html`

---

## User-facing summary

**beta.22:** Export transcripts as **SRT** and **WebVTT**.  
**beta.23:** **Install yt-dlp from the app** for URL import.

Implementation checklist: `TODO.md` (Slice E / Slice F).
