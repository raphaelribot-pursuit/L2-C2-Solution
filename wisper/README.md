# Wisper — desktop app

Tauri 2 + React frontend, Rust `wisper-core` backend (whisper.cpp via whisper-rs).

## Quick start

**Windows**

```powershell
npm install
.\dev.ps1
```

**macOS**

```bash
npm install
chmod +x dev-macos.sh && ./dev-macos.sh
```

**Linux**

```bash
npm install
chmod +x dev-linux.sh && ./dev-linux.sh
./dev-linux.sh --gpu-backend vulkan   # explicit
./build-linux.sh cuda                 # build only
```

## GPU builds

Cross-desktop: Windows, macOS, and Linux share the same Cargo features. See the repo root README — **Which build should I use?**

**macOS releases (beta.12+):** GitHub Release DMG is **universal** (Intel + Apple Silicon). Older beta.11 DMG was Apple Silicon only.

| Script | Platform | Backend |
|--------|----------|---------|
| `dev.ps1` | Windows | Auto (NVIDIA→CUDA, else Vulkan, else CPU) |
| `dev.ps1 -GpuBackend vulkan` | Windows | Vulkan — AMD, Intel iGPU, NVIDIA |
| `dev-cuda.ps1` | Windows | NVIDIA CUDA |
| `dev-macos.sh` | macOS | Apple Metal (automatic) |
| `dev-linux.sh` | Linux | Auto (same logic as Windows) |
| `dev-linux.sh --gpu-backend vulkan` | Linux | Vulkan |
| `build-gpu.ps1 -Backend vulkan` | Windows | Build only |
| `build-linux.sh vulkan` | Linux | Build only |

## Whisper model

Place a GGML model (e.g. `ggml-large-v3-turbo.bin`) in the app models folder — path shown in the UI, typically:

`%APPDATA%\com.aislingldpursuit.wisper\models\` on Windows.

Download from [Hugging Face — whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp).

## Project layout

```
wisper/
  src/              React UI
  src-tauri/        Tauri shell + commands
  wisper-core/      Audio pipeline, transcription, SQLite, compute backends
  dev.ps1           Windows dev launcher
  dev-macos.sh      macOS dev launcher (Metal)
  dev-linux.sh      Linux dev launcher (Vulkan / CUDA)
  dev-cuda.ps1      Windows CUDA shortcut
  build-gpu.ps1     Windows GPU build-only
  build-linux.sh    Linux GPU build-only
```

## npm scripts

| Command | Description |
|---------|-------------|
| `npm run tauri:dev` | Windows: runs `dev.ps1` |
| `npm run tauri -- dev` | Direct Tauri dev (CPU-only unless you pass `--features`) |

## QA scripts

| Script | Purpose |
|--------|---------|
| `.\scripts\smoke-test.ps1` | Tier 0 — cargo test, check, npm build (run before every PR) |
| `.\scripts\phase1-exit-qa.ps1` | Tier 3 preflight + manual Phase 1 checklist |
| `.\scripts\build-release.ps1` | Local Windows release bundle (verify paths before fixing CI) |

Full QA order: repo root `QA-CHECKLIST.md` and `TODO.md` (local). Release status: `ROADMAP.md`.
