# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
