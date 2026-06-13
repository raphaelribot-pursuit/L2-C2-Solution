# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Week 2 Improvement PRD** — guided first screen + progressive disclosure (local `Aisling Improvement Week 2 PRD - Filled.docx`; regenerate via `generate_improvement_prd.py`).
- **Local planning docs** — `ROADMAP.md`, `TODO.md`, `QA-CHECKLIST.md` (QA-ordered tasks; not committed — see `.gitignore`).
- **Security audit doc** — `Wisper-Security-Audit.docx` (local; regenerate via `generate_security_audit.py`).
- **Phase 1 import flows** — microphone recording (cpal), file picker + drag-and-drop (audio/video), YouTube/URL import via yt-dlp, language select, two-step download → transcribe progress, library source labels (“Downloaded from URL” vs “Fully offline”).
- **`wisper/scripts/download-model.ps1`** — download GGML models into app data (tiny / base / large-turbo).
- **Download guide** — README and [GPU_BACKENDS.md](./GPU_BACKENDS.md) “Which installer?” table (NVIDIA → CUDA, AMD/Intel → Vulkan, Mac → Metal, fallback → CPU).
- **Phase 1 UI polish** — two-step progress (Download → Transcribe) and library labels.
- **`wisper/scripts/smoke-test.ps1`** / **`smoke-test.sh`** — local CI-parity smoke (cargo test, cargo check, npm build).
- **Truncation unit test** — `looks_truncated` threshold logic in `wisper-core`.

### Changed

- **Docs in git** — only `README.md` and `CHANGELOG.md` are committed; `TECHNICAL_ARCHITECTURE.md`, `ROADMAP.md`, `GPU_BACKENDS.md`, and office docs stay local (`.gitignore`).
- **Intel SYCL demoted to advanced-only** — removed from `dev.ps1` auto-detect; use `dev-sycl.ps1` explicitly. Intel iGPU users should use Vulkan builds.
- PRD `.docx` files stay local (`.gitignore`); README no longer links committed PRD paths.

### Fixed

- **SEC-001 (High)** — removed arbitrary `write_text_file` IPC; export uses Rust-side `save_transcript_txt_file` with native save dialog only.
- **SEC-002 (High)** — SSRF hardening in `normalize_url` (blocks private/local IPs, blocked hostnames, embedded credentials) + unit tests in `wisper-core`.
- **Long MP3 decode truncation** — symphonia can stop at ~50% on some VBR MP3s; Wisper now retries via ffmpeg when decoded duration is >10s shorter than container metadata (verified on 12-min and 59-min files).
- **Release CI (partial)** — macOS `MACOSX_DEPLOYMENT_TARGET=10.15`; workspace bundle upload paths fixed; Windows uses manual CUDA network installer script (`install-cuda-windows-ci.ps1`) after Jimver action failures on runners.
- **Desktop smoke CI** — CPU smoke job now runs `npm run build` (TypeScript + Vite) after `cargo test`.

### Fixed (prior)

- Platform-aware yt-dlp binary names in Tauri; CUDA registry version sort in `dev.ps1`; drag-drop listener cleanup on unmount; transcript duration from max segment `end_ms`; SYCL release artifact labels in About.
- **Tier 1 ship blockers** — mic cpal stream errors surfaced at start/stop instead of silent empty recordings; URL import errors tagged `download` vs `transcribe` in UI status; partial yt-dlp downloads cleaned up on cancel/failure.
- **Phase 2 library** — FTS5 transcript search, delete recording (DB + audio file under app data), export transcript as TXT, copy to clipboard.
- **First-run onboarding** — setup banner when Whisper model or yt-dlp is missing; `get_model_status` blocks transcription until a model is installed.
- **`wisper/scripts/build-release.ps1`** — local Windows release bundle (CUDA / Vulkan / CPU).
- **GitHub Release workflow** — [`.github/workflows/release.yml`](./.github/workflows/release.yml) builds platform installers on `v*` tags.
- **`download-model.ps1`** — exit non-zero when `Invoke-WebRequest` fails.
- **Linux CI** — `libasound2-dev` for mic/cpal builds (CPU smoke, Linux Vulkan, ARM64 CPU).

### Deploy readiness (in progress)

Target: **beta deployable** (installable build for trusted testers), then **Phase 4** public release matrix.

| Track | Status |
|-------|--------|
| Phase 1 exit QA (manual) | Automated preflight passed — manual checklist pending (`phase1-exit-qa.ps1`) |
| Long MP3 decode (ffmpeg fallback) | Done — verified 12-min + 59-min MP3 on CUDA |
| Release CI (tag builds) | **Blocked** — see beta.3 notes below |
| Desktop smoke (frontend build in CI) | Done — `npm run build` in CPU smoke job |
| Tier 1 bug fixes (mic, URL errors, orphan downloads) | Done |
| Security SEC-001 / SEC-002 | Done — save dialog export + URL SSRF hardening |
| Security SEC-003+ (CSP, capabilities) | Pending — before wider beta |
| Video import verify (MP4/MOV) | Automated symphonia test + manual drag-drop |
| Phase 2 minimum (export, search, delete) | Done — TXT export, clipboard, FTS search, delete |
| Release pipeline (GitHub Releases) | Workflow exists; **no release published yet** |
| First-run onboarding (model + yt-dlp) | Done — setup banner + model guard |
| Week 2 UX (progressive disclosure) | PRD done — implementation pending |
| Version sync (UI vs tags) | **0.2.0-beta.5** — aligned with next tag |

**Tag `v0.2.0-beta.3`** ([run 27474963688](https://github.com/aislingld-pursuit/L2-Clone-Prodject/actions/runs/27474963688)) — **failed**

- macOS / Linux: Tauri **build succeeded** but artifact **upload failed** (glob mismatch — no `.dmg`/`.app`/`.deb`/`.AppImage` found at workflow paths).
- Windows CUDA: **CUDA 12.6.3 installer failed** on runner (exit code `3772776473`).
- Publish GitHub Release: skipped.

**Next:** tag `v0.2.0-beta.5` → verify release publish → implement Week 2 guided first screen.

See local [ROADMAP.md](./ROADMAP.md), [TODO.md](./TODO.md), [QA-CHECKLIST.md](./QA-CHECKLIST.md).

### Added (Phase 1 — prior)

- **About dialog** — version, platform, release artifact name (`wisper-windows-cuda`, etc.), compiled GPU backend, CPU architecture, fallback status (`get_app_about` / About button in header).
- **`wisper/scripts/verify-cuda.ps1`** — NVIDIA preflight + optional `gpu-cuda` build for Phase 0.5 CUDA verification (build verified RTX 5080 + CUDA 13.3).
- **`TranscriptionResult`** and **`GpuFallbackNotice`** — structured GPU → CPU fallback metadata from `wisper-core`.
- Tauri events: **`transcription-fallback`** (during retry) and extended **`transcription-complete`** (`used_cpu_fallback`, `actual_backend`).
- UI fallback banner and completion notice when GPU fails and CPU completes the job.
- **`cpu_architecture`** and **`supports_cpu_fallback`** in `ComputeInfo` (Intel / AMD x86_64, ARM64, Apple Silicon).
- GitHub Actions [`.github/workflows/desktop.yml`](./.github/workflows/desktop.yml): CPU smoke, Linux/Windows Vulkan, macOS Metal, Linux ARM64 jobs.

### Changed

- **GPU-first default**: `compute_info().default_backend` is `Gpu` when a GPU backend is compiled in.
- Compute panel shows host CPU architecture and automatic fallback messaging.

### Added (GPU foundation — prior)

- Multi-GPU backend Cargo features: `gpu-vulkan`, `gpu-cuda`, `gpu-sycl` (compile-time; one backend per binary).
- Apple **Metal** on macOS (Apple Silicon and Intel Macs) via target-specific `whisper-rs` dependency.
- `GpuBackendKind` and richer `ComputeInfo` exposed to the UI (Metal / Vulkan / CUDA / Intel SYCL).
- Windows dev scripts: `dev.ps1 -GpuBackend`, `dev-cuda.ps1`, `dev-sycl.ps1`, `build-gpu.ps1 -Backend`.
- macOS dev script: `wisper/dev-macos.sh`.
- Linux dev script: `wisper/dev-linux.sh` (Vulkan / CUDA parity with Windows).
- Cross-desktop release matrix documented in [GPU_BACKENDS.md](./GPU_BACKENDS.md).
- Compile-time guard preventing multiple GPU features in one build.

### Changed

- `dev.ps1` auto-detection: NVIDIA GPU + CUDA toolkit → CUDA; else Vulkan SDK → Vulkan; else oneAPI → SYCL.
- Compute panel hints in the UI reflect the compiled backend instead of hard-coded platform text.

### Planned (Phase 0.5 — GPU foundation)

- Release artifact matrix (Vulkan / CUDA / Metal installers).
- CUDA CI jobs (Windows/Linux) with toolkit caching.
- Core ML encoder path on Apple (after GPU foundation stabilizes).

---

## [0.1.0] - 2026-06-08

### Added

- **Tauri 2 + React** desktop shell under `wisper/`.
- **`wisper-core`** Rust crate: audio decode (symphonia), 16 kHz PCM pipeline, whisper.cpp via whisper-rs 0.16.
- **SQLite library**: recordings, transcript segments, persistence across restarts.
- **Transcript UI**: timestamped segments with inline editing and save.
- **Background transcription** with progress events, elapsed time, and cancel support.
- **WhisperEngine** context cache (separate CPU and GPU slots).
- **GPU transcription on Windows** via Vulkan (`gpu-vulkan` feature); verified on AMD Radeon 890M.
- **GPU → CPU fallback** on transcription failure (invalidate GPU context, retry on CPU).
- **Abort callback fix** for whisper-rs GPU stability (manual C trampoline + `AbortGuard`).
- **`dev.ps1`**: MSVC + CMake + Vulkan SDK wiring; space-free ExternalProject root for OneDrive paths.
- **`scripts/patch-vulkan-cmake.ps1`**: nested `vulkan-shaders-gen` build fix on Windows.

### Fixed

- Progress callback `'static` lifetime errors in Tauri background thread.
- `WhisperContextParameters` / `FullParams` lifetime compile errors.
- GPU encode/decode failures (whisper error codes -6 / -8) from incorrect abort callback typing.

---

[Unreleased]: https://github.com/aislingld-pursuit/L2-Clone-Prodject/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aislingld-pursuit/L2-Clone-Prodject/releases/tag/v0.1.0
