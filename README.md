# L2 Clone Prodject

Privacy-first, local-only clone of **Whisper Notes** — record, import files, or paste a **YouTube URL**, then transcribe entirely on-device with Whisper Large V3 Turbo. No cloud STT. No accounts required.

**Repository:** https://github.com/aislingld-pursuit/L2-Clone-Prodject  
**Collaborators:** [Jimmy Ong](https://github.com/jimmyronin) · [Personal mirror](https://github.com/nessaisling-lab/L2-Clone-Prodject)

## Documents

| File | Description |
|------|-------------|
| [CHANGELOG.md](./CHANGELOG.md) | Release and unreleased change history (committed) |

Other project docs (`TECHNICAL_ARCHITECTURE.md`, `ROADMAP.md`, `GPU_BACKENDS.md`, PRD `.docx`) stay on each developer machine — not committed to git.

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

**Phase 0.5 complete · Phase 1 in progress** — mic, file/URL import, drag-and-drop, language select, CUDA verified (RTX 5080). Phase plan lives in local `ROADMAP.md`.

## Which build should I use?

Each installer links **one** GPU backend (or CPU-only). Pick by hardware:

| Your hardware | Download / build | About screen shows |
|---------------|------------------|-------------------|
| **NVIDIA GPU** (GeForce / RTX) | `wisper-windows-cuda` or `.\dev-cuda.ps1` | CUDA |
| **AMD or Intel GPU** on Windows/Linux | `wisper-*-vulkan` or `.\dev.ps1 -GpuBackend vulkan` | Vulkan |
| **Apple Mac** (M-series or Intel) | `wisper-macos-universal` or `./dev-macos.sh` | Metal |
| **No GPU / old PC / CI smoke** | `wisper-*-cpu` or `.\dev.ps1 -GpuBackend cpu` | CPU-only |

**Intel iGPU on Windows/Linux:** use the **Vulkan** build — not SYCL. SYCL remains an advanced developer-only path (`dev-sycl.ps1`).

**Daily driver (Windows + NVIDIA):** `cd wisper` then `.\dev-cuda.ps1`.

## Development

### Prerequisites

- [Rust](https://rustup.rs/) (1.70+)
- [Node.js](https://nodejs.org/) 20+
- **CMake** (required to build whisper.cpp)
- Visual Studio Build Tools (MSVC) on Windows — required for GPU builds
- **ffmpeg** (recommended) — full-length MP3 import when symphonia truncates early:
  - Windows: `winget install ffmpeg`
  - macOS: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg` (Debian/Ubuntu) or your distro package manager
- **GPU (optional):** [Vulkan SDK](https://vulkan.lunarg.com/) and/or [NVIDIA CUDA Toolkit](https://developer.nvidia.com/cuda-downloads) on Windows/Linux; Xcode on macOS for Metal

### Run the app

**Windows**

```powershell
cd wisper
npm install
.\dev.ps1                      # auto GPU backend or CPU fallback
.\dev.ps1 -GpuBackend vulkan   # Explicit Vulkan (AMD / Intel iGPU)
.\dev-cuda.ps1                 # NVIDIA CUDA
```

**macOS**

```bash
cd wisper && npm install && chmod +x dev-macos.sh && ./dev-macos.sh
```

**Linux**

```bash
cd wisper && npm install && chmod +x dev-linux.sh && ./dev-linux.sh
```

Full GPU script details: local `GPU_BACKENDS.md` or the table above.

### Whisper model (one-time)

Download a GGML model (e.g. `ggml-large-v3-turbo.bin` or `ggml-base.en.bin` for faster testing) from [Hugging Face — whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp) and place it at the path shown in the app under **Whisper model** (typically `%APPDATA%\com.aislingldpursuit.wisper\models\` on Windows).

Transcription is fully offline once the model is installed.

### Smoke test (before PR)

```powershell
cd wisper
.\scripts\smoke-test.ps1
```

Linux/macOS:

```bash
cd wisper
chmod +x scripts/smoke-test.sh && ./scripts/smoke-test.sh
```
