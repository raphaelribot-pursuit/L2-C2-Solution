# Slice I — Locked scope (beta.26)

**Status:** In progress  
**Ship order:** after beta.25 (Slice H)  
**Rule:** One slice → smoke test → commit → tag → Release CI

---

## Slice I — Export++ (`beta.26`)

### In scope

- **JSON** and **CSV** export for the active library transcript (edited segment text + timestamps)
- **DOCX** and **PDF** export (local generation, no cloud)
- **ZIP bundle** for one transcript: txt, srt, vtt, json, csv, docx, pdf in a single archive
- **Library batch ZIP**: export all recordings currently shown in the library list (respects search filter) — one folder per recording inside the archive
- Save dialogs for each format; same local-first behavior as TXT/SRT/VTT

### Out of scope (not promised in beta.26)

- Batch **import** (multi-file queue) — deferred
- Burn-in subtitles on video
- Speaker labels / diarization
- Word-level timing
- Cloud upload
- Resona visual redesign (parallel track)

---

## User-facing summary

**beta.26:** Export transcripts as **JSON, CSV, Word, PDF**, or download a **ZIP** with every format — for one transcript or your whole library at once.
