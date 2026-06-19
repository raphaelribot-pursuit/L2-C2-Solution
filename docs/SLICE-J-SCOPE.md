# Slice J — Locked scope (beta.27)

**Status:** In progress  
**Ship order:** after beta.26 (Slice I)  
**Rule:** One slice → smoke test → commit → tag → Release CI

---

## Slice J — Batch import queue (`beta.27`)

### In scope

- **Multi-select file picker** — choose several audio/video files at once
- **Multi-file drag-and-drop** — drop multiple supported files on the import panel
- **Sequential queue** — transcribe one file at a time with current language, model tier, and CPU/GPU choice
- **Progress** — show “file 2 of 5” and current filename in status
- **Cancel** — stops the active job and clears the remaining queue
- **On failure** — show error for that file, then continue with the next queued file

### Out of scope (not promised in beta.27)

- Parallel / multi-worker transcription
- ZIP or folder import (pick files only)
- Playlist or channel URL bulk import
- Queue persistence across app restarts
- Resona visual redesign (parallel track)

---

## User-facing summary

**beta.27:** Drop or select **multiple** audio/video files — Wisper transcribes them **one after another** and saves each to your library.
