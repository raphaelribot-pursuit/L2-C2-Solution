# Slice G — Locked scope (beta.24)

**Status:** Ready to ship (beta.24)
**Ship order:** after beta.23 (Slice F)

---

## Slice G — Installers (`beta.24`)

### In scope

- **Install ffmpeg** button → downloads official BtbN static build into app data (`…/bin/ffmpeg`, plus `ffprobe`)
- Welcome guide + Advanced options banner when ffmpeg missing (same pattern as yt-dlp)
- Progress UI (like model / yt-dlp download)
- Windows x64, Mac (Intel + ARM), Linux x64
- Existing PATH ffmpeg still works
- **Bundled yt-dlp** in release installers (downloaded at CI build time into app resources `bin/`)

### Out of scope (not promised in beta.24)

- ffmpeg bundled inside the installer without download (on-demand only, like pre-beta.23 yt-dlp)
- Auto-update ffmpeg on every launch
- ffplay / full ffmpeg suite UI
- Burn-in subtitles (Phase J)

---

## User-facing summary

**beta.24:** Install **ffmpeg from the app** for reliable MP3/video decode; **yt-dlp ships inside** new installers.
