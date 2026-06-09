# L2 Clone Prodject

Privacy-first, local-only clone of **Whisper Notes** — record, import files, or paste a **YouTube URL**, then transcribe entirely on-device with Whisper Large V3 Turbo. No cloud STT. No accounts required.

**Repository:** https://github.com/aislingld-pursuit/L2-Clone-Prodject  
**Collaborators:** [Jimmy Ong](https://github.com/jimmyronin) · [Personal mirror](https://github.com/nessaisling-lab/L2-Clone-Prodject)

## Documents

| File | Description |
|------|-------------|
| [TECHNICAL_ARCHITECTURE.md](./TECHNICAL_ARCHITECTURE.md) | Local-first stack (Tauri, whisper.cpp, yt-dlp, SQLite) |
| [ROADMAP.md](./ROADMAP.md) | Phased delivery plan with AI-agent time estimates |
| [Jimmy and Aisling Copy of 20260515 PRD Template - FILLED.docx](./Jimmy%20and%20Aisling%20Copy%20of%2020260515%20PRD%20Template%20-%20FILLED.docx) | Product requirements (local-first, YouTube P0) |

## Regenerate PRD

```bash
pip install python-docx
python analyze_and_fill_prd.py
```

Requires `Aisling Copy of 20260515 PRD Template.docx` in this folder (close in Word if the script cannot copy it).

## Principles

- **Transcription:** 100% on-device via whisper.cpp — never sent to a cloud STT API
- **YouTube (P0):** yt-dlp downloads audio locally; transcription stays offline
- **Platforms:** Windows, macOS, Linux (desktop MVP); iOS & Android later

## Status

Planning and documentation — implementation starts with Phase 0 (Tauri + whisper.cpp spike). See [ROADMAP.md](./ROADMAP.md).
