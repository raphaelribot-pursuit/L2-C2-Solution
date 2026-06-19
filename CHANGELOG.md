# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0-beta.28] - 2026-06-08

### Added

- **Word-level timing** — per-word timestamps from whisper tokens; word-level SRT/CSV export; hover timings in the transcript list.
- **Speaker turns** — experimental tinydiarize labels (`Speaker 1`, `Speaker 2`, …) on new transcriptions; shown in exports and the transcript UI.
- **Burn-in subtitles** — render segment subtitles into a new MP4 for imported video when ffmpeg is installed.

**Tag `v0.2.0-beta.28`** — subtitles++. See [docs/SLICE-K-SCOPE.md](./docs/SLICE-K-SCOPE.md).

## [0.2.0-beta.27] - 2026-06-08

### Added

- **Batch import queue** — select or drop multiple audio/video files; Wisper transcribes them sequentially and saves each to the library. Cancel clears the queue. A failed file shows an error and the queue continues.

**Tag `v0.2.0-beta.27`** — batch import. See [docs/SLICE-J-SCOPE.md](./docs/SLICE-J-SCOPE.md) for in/out of scope.

## [0.2.0-beta.26] - 2026-06-08

### Added

- **JSON and CSV export** — structured transcript export alongside TXT, SRT, and VTT.
- **Word and PDF export** — local document generation with no cloud upload.
- **ZIP bundle** — one download with every format for a single transcript.
- **Library batch ZIP** — export all recordings shown in the library (respects search) into one archive.

**Tag `v0.2.0-beta.26`** — Export++. See [docs/SLICE-I-SCOPE.md](./docs/SLICE-I-SCOPE.md) for in/out of scope.

## [0.2.0-beta.25] - 2026-06-08

### Added

- **Auto-update managed yt-dlp and ffmpeg** — on launch, Wisper quietly re-downloads copies you installed through the app when they are older than seven days. Bundled installer binaries and PATH installs are untouched; missing tools are not auto-installed.

**Tag `v0.2.0-beta.25`** — managed tool refresh on launch. See [docs/SLICE-H-SCOPE.md](./docs/SLICE-H-SCOPE.md) for in/out of scope.

## [0.2.0-beta.24] - 2026-06-08

### Added

- **Install ffmpeg from the app** — one-click download of BtbN static builds into app data (`…/bin/ffmpeg` and `ffprobe`), with progress UI on the welcome guide and Advanced options. PATH-installed ffmpeg still works; decode now prefers bundled/app-data binaries for truncated MP3 retry.
- **yt-dlp bundled in release installers** — CI downloads the official binary into app resources before packaging so URL import works out of the box on fresh installs.

**Tag `v0.2.0-beta.24`** — ffmpeg installer + bundled yt-dlp. See [docs/SLICE-G-SCOPE.md](./docs/SLICE-G-SCOPE.md) for in/out of scope.

## [0.2.0-beta.23] - 2026-06-19

### Added

- **Install yt-dlp from the app** — one-click download of the official release binary into app data (`…/bin/yt-dlp`), with progress UI on the welcome guide and URL import panel. PATH-installed yt-dlp still works.

**Tag `v0.2.0-beta.23`** — URL import without winget/Homebrew. See [docs/SLICE-E-F-SCOPE.md](./docs/SLICE-E-F-SCOPE.md) for in/out of scope.

## [0.2.0-beta.22] - 2026-06-19

### Added

- **Export SRT and WebVTT** — from the transcript panel, save standard subtitle files using edited segment text and Whisper segment timestamps (local save dialog, same as TXT).

**Tag `v0.2.0-beta.22`** — caption/subtitle export for video editors and players. See [docs/SLICE-E-F-SCOPE.md](./docs/SLICE-E-F-SCOPE.md) for in/out of scope.

## [0.2.0-beta.18](https://github.com/aislingld-pursuit/L2-Clone-Prodject/releases/tag/v0.2.0-beta.18) - 2026-06-08

### Fixed

- **About → Updates** — “You're on the latest release” now shows your installed version when you're on a build newer than GitHub's published latest (no more stale beta.16 text while running beta.17).
- **Desktop CI** — platform-specific update-check unit tests only run on the matching OS so Linux and macOS jobs pass.

**Tag `v0.2.0-beta.18`** — follow-up to beta.17 with correct up-to-date messaging and green Desktop CI.

## [0.2.0-beta.17](https://github.com/aislingld-pursuit/L2-Clone-Prodject/releases/tag/v0.2.0-beta.17) - 2026-06-08

### Added

- **Check for updates** — on launch and in **About**, Wisper checks GitHub Releases for a newer beta; shows a banner with **View release** (opens the right installer for your platform) or **Not now** (dismisses until the next version).

**Tag `v0.2.0-beta.17`** — first build with in-app update notifications for beta testers.

## [0.2.0-beta.16](https://github.com/aislingld-pursuit/L2-Clone-Prodject/releases/tag/v0.2.0-beta.16) - 2026-06-17

### Fixed

- **macOS Release CI** — flaky `bundle_dmg.sh` failures on GitHub Actions: pin `macos-15`, set `TAURI_BUNDLER_DMG_IGNORE_CI=false`, detach stale DMG mounts, retry DMG bundling up to 3 times with cleanup between attempts.

**Tag `v0.2.0-beta.16`** — re-ships beta.15 welcome-guide build with reliable macOS `_x64.dmg` / `_aarch64.dmg` artifacts.

## [0.2.0-beta.15](https://github.com/aislingld-pursuit/L2-Clone-Prodject/releases/tag/v0.2.0-beta.15) - 2026-06-16

### Added

- **Welcome guide** — first-run setup wizard with plain-language steps (welcome → download model → how to transcribe).
- **One-click model download** — in-app `base` speech model download (~150 MB) via `start_model_download`; no scripts or terminal.
- **Model import** — pick an existing `.bin` file or open the models folder from Advanced settings.
- **Get started** header button — reopens the guide anytime.

### Changed

- **Simpler main UI** — Record / Choose file / Transcribe up front; language, GPU, URL import, and model details under **Advanced settings** (hidden by default).
- **Friendlier onboarding** — replaced developer setup banner (Hugging Face paths, `download-model.ps1`) with “Open setup guide”.
- **Transcription guard** — missing model opens the guide instead of technical error text.

### Fixed

- **`open_models_folder`** — convert `PathBuf` to `String` for `tauri-plugin-opener` on Windows/macOS builds.

**Tag `v0.2.0-beta.15`** — partner-friendly onboarding for Intel and Apple Silicon Mac testers (`_x64.dmg` / `_aarch64.dmg`).

## [0.2.0-beta.19](https://github.com/aislingld-pursuit/L2-Clone-Prodject/compare/v0.2.0-beta.18...v0.2.0-beta.19) - 2026-06-17

### Added

- **Model tier selector** — Small / Medium / Large in welcome guide and Advanced options; downloads `tiny`, `base`, or `large-turbo` (~1.6 GB).
- **Hardware advisor** — “Check your system” step reads RAM, CPU, and GPU, runs a quick test, and recommends a model tier.
- **Privacy subtitle** on the transcribe panel — local-only reassurance copy.
- **Model-missing banner** — inline prompt to open Get started when no speech model is installed.
- **Remember-open Advanced** — checkbox persists Advanced options across launches (`wisper-keep-advanced-open`).

### Changed

- **Advanced settings** renamed to **Advanced options**.
- Advanced panel collapses automatically while recording.
- Disabled primary buttons use clearer styling with visible hints (no tooltip-only affordances).
- GPU fallback copy clarifies CPU restart from the beginning.

## [0.2.0-beta.20](https://github.com/aislingld-pursuit/L2-Clone-Prodject/compare/v0.2.0-beta.19...v0.2.0-beta.20) - 2026-06-18

### Added

- **Video format hint** — inline warning when a video file (MP4, MKV, etc.) is selected; proceed allowed, no size cap.

### Changed

- **Advanced panel a11y** — toggle exposes `aria-expanded` and `aria-controls`; panel has `id="advanced-panel"`.
- **Escape** closes Advanced options; confirms before discarding a non-empty URL import field.
- **phase1-exit-qa.ps1** — manual checklist extended for Week 2 HEART UX (beta.19 features).

## [0.2.0-beta.21](https://github.com/aislingld-pursuit/L2-Clone-Prodject/compare/v0.2.0-beta.20...v0.2.0-beta.21) - 2026-06-18

### Added

- **All three model tiers** — Small (`tiny`), Medium (`base`), and Large (`large-turbo`) can be installed side by side; transcription uses the tier selected in Advanced options.
- **Download all models** — in-app and `download-model.ps1 -All` fetch every tier; release builds run `-All` by default (`-SkipModels` to opt out).
- **Model size validation** — truncated or wrong `.bin` files are detected and re-downloaded (fixes mis-sized Large files).

### Changed

- `get_model_status`, transcription, and URL import accept an optional `model` tier key.
- Advanced options show installed tiers and per-tier download actions.

## [Unreleased](https://github.com/aislingld-pursuit/L2-Clone-Prodject/compare/v0.2.0-beta.21...HEAD)

### Removed from scope

- 1 GB file upload cap (local app — no size limits on upload, URL, recording, or models).

---

## Historical unreleased notes (pre-beta.19 docs commit)
- **Phase 1 import flows** — microphone recording (cpal), file picker + drag-and-drop (audio/video), YouTube/URL import via yt-dlp, language select, two-step download → transcribe progress, library source labels (“Downloaded from URL” vs “Fully offline”).
- `**wisper/scripts/download-model.ps1`** — download GGML models into app data (tiny / base / large-turbo).
- **Download guide** — README and [GPU_BACKENDS.md](./GPU_BACKENDS.md) “Which installer?” table (NVIDIA → CUDA, AMD/Intel → Vulkan, Mac → Metal, fallback → CPU).
- **Phase 1 UI polish** — two-step progress (Download → Transcribe) and library labels.
- `**wisper/scripts/smoke-test.ps1`** / `**smoke-test.sh**` — local CI-parity smoke (cargo test, cargo check, npm build).
- **Truncation unit test** — `looks_truncated` threshold logic in `wisper-core`.

### Changed

- **macOS release** — CI builds separate **Intel (`x86_64`)** and **Apple Silicon (`aarch64`)** DMGs (beta.13+). beta.12 failed: invalid `universal-apple-darwin` target; beta.13 failed: bundler path mismatch when forcing native `--target` on Apple Silicon runners.
- **Docs in git** — only `README.md` and `CHANGELOG.md` are committed; `TECHNICAL_ARCHITECTURE.md`, `ROADMAP.md`, `GPU_BACKENDS.md`, and office docs stay local (`.gitignore`).
- **Intel SYCL demoted to advanced-only** — removed from `dev.ps1` auto-detect; use `dev-sycl.ps1` explicitly. Intel iGPU users should use Vulkan builds.
- PRD `.docx` files stay local (`.gitignore`); README no longer links committed PRD paths.

### Fixed

- **SEC-001 (High)** — removed arbitrary `write_text_file` IPC; export uses Rust-side `save_transcript_txt_file` with native save dialog only.
- **SEC-002 (High)** — SSRF hardening in `normalize_url` (blocks private/local IPs, blocked hostnames, embedded credentials) + unit tests in `wisper-core`.
- **Long MP3 decode truncation** — symphonia can stop at ~50% on some VBR MP3s; Wisper now retries via ffmpeg when decoded duration is >10s shorter than container metadata (verified on 12-min and 59-min files).
- **Release CI (partial)** — macOS `MACOSX_DEPLOYMENT_TARGET=10.15`; workspace bundle upload paths fixed (`wisper/target/release/bundle/`); Windows CUDA uses Jimver network install with minimal sub-packages only (`nvcc`, `cudart`, `cublas`) to avoid VS/Nsight hangs on `windows-2022`.
- **Desktop smoke CI** — CPU smoke job now runs `npm run build` (TypeScript + Vite) after `cargo test`.

### Fixed (prior)

- Platform-aware yt-dlp binary names in Tauri; CUDA registry version sort in `dev.ps1`; drag-drop listener cleanup on unmount; transcript duration from max segment `end_ms`; SYCL release artifact labels in About.
- **Tier 1 ship blockers** — mic cpal stream errors surfaced at start/stop instead of silent empty recordings; URL import errors tagged `download` vs `transcribe` in UI status; partial yt-dlp downloads cleaned up on cancel/failure.
- **Phase 2 library** — FTS5 transcript search, delete recording (DB + audio file under app data), export transcript as TXT, copy to clipboard.
- **First-run onboarding** — setup banner when Whisper model or yt-dlp is missing; `get_model_status` blocks transcription until a model is installed.
- `**wisper/scripts/build-release.ps1`** — local Windows release bundle (CUDA / Vulkan / CPU).
- **GitHub Release workflow** — `[.github/workflows/release.yml](./.github/workflows/release.yml)` builds platform installers on `v*` tags.
- `**download-model.ps1`** — exit non-zero when `Invoke-WebRequest` fails.
- **Linux CI** — `libasound2-dev` for mic/cpal builds (CPU smoke, Linux Vulkan, ARM64 CPU).

### Deploy readiness (in progress)

Target: **beta deployable** (installable build for trusted testers), then **Phase 4** public release matrix.


| Track                                                | Status                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| Phase 1 exit QA (manual)                             | Automated preflight passed — manual checklist pending (`phase1-exit-qa.ps1`) |
| Long MP3 decode (ffmpeg fallback)                    | Done — verified 12-min + 59-min MP3 on CUDA                                  |
| Release CI (tag builds)                              | **Done** — beta.16 macOS DMG retry + macos-15 runner                      |
| Desktop smoke (frontend build in CI)                 | Done — `npm run build` in CPU smoke job                                      |
| Tier 1 bug fixes (mic, URL errors, orphan downloads) | Done                                                                         |
| Security SEC-001 / SEC-002                           | Done — save dialog export + URL SSRF hardening                               |
| Security SEC-003+ (CSP, capabilities)                | Pending — before wider beta                                                  |
| Video import verify (MP4/MOV)                        | Automated symphonia test + manual drag-drop                                  |
| Phase 2 minimum (export, search, delete)             | Done — TXT export, clipboard, FTS search, delete                             |
| Release pipeline (GitHub Releases)                   | **Done** — [v0.2.0-beta.11](https://github.com/aislingld-pursuit/L2-Clone-Prodject/releases/tag/v0.2.0-beta.11); beta.15 adds welcome guide |
| First-run onboarding (model + yt-dlp)                | Done — welcome guide + one-click model download (beta.15)                    |
| Week 2 UX (progressive disclosure)                   | **Done** — welcome guide + advanced settings (beta.15)                       |
| Version sync (UI vs tags)                            | **0.2.0-beta.18**                                                            |


**Tag `v0.2.0-beta.16`** — welcome guide (beta.15) plus reliable macOS release CI.

See local [ROADMAP.md](./ROADMAP.md), [TODO.md](./TODO.md), [QA-CHECKLIST.md](./QA-CHECKLIST.md).

### Added (Phase 1 — prior)

- **About dialog** — version, platform, release artifact name (`wisper-windows-cuda`, etc.), compiled GPU backend, CPU architecture, fallback status (`get_app_about` / About button in header).
- `**wisper/scripts/verify-cuda.ps1`** — NVIDIA preflight + optional `gpu-cuda` build for Phase 0.5 CUDA verification (build verified RTX 5080 + CUDA 13.3).
- `**TranscriptionResult**` and `**GpuFallbackNotice**` — structured GPU → CPU fallback metadata from `wisper-core`.
- Tauri events: `**transcription-fallback**` (during retry) and extended `**transcription-complete**` (`used_cpu_fallback`, `actual_backend`).
- UI fallback banner and completion notice when GPU fails and CPU completes the job.
- `**cpu_architecture**` and `**supports_cpu_fallback**` in `ComputeInfo` (Intel / AMD x86_64, ARM64, Apple Silicon).
- GitHub Actions `[.github/workflows/desktop.yml](./.github/workflows/desktop.yml)`: CPU smoke, Linux/Windows Vulkan, macOS Metal, Linux ARM64 jobs.

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

## [0.1.0](https://github.com/aislingld-pursuit/L2-Clone-Prodject/releases/tag/v0.1.0) - 2026-06-08

### Added

- **Tauri 2 + React** desktop shell under `wisper/`.
- `**wisper-core`** Rust crate: audio decode (symphonia), 16 kHz PCM pipeline, whisper.cpp via whisper-rs 0.16.
- **SQLite library**: recordings, transcript segments, persistence across restarts.
- **Transcript UI**: timestamped segments with inline editing and save.
- **Background transcription** with progress events, elapsed time, and cancel support.
- **WhisperEngine** context cache (separate CPU and GPU slots).
- **GPU transcription on Windows** via Vulkan (`gpu-vulkan` feature); verified on AMD Radeon 890M.
- **GPU → CPU fallback** on transcription failure (invalidate GPU context, retry on CPU).
- **Abort callback fix** for whisper-rs GPU stability (manual C trampoline + `AbortGuard`).
- `**dev.ps1`**: MSVC + CMake + Vulkan SDK wiring; space-free ExternalProject root for OneDrive paths.
- `**scripts/patch-vulkan-cmake.ps1**`: nested `vulkan-shaders-gen` build fix on Windows.

### Fixed

- Progress callback `'static` lifetime errors in Tauri background thread.
- `WhisperContextParameters` / `FullParams` lifetime compile errors.
- GPU encode/decode failures (whisper error codes -6 / -8) from incorrect abort callback typing.

---

