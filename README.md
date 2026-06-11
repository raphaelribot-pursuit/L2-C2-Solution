# L2 Clone Prodject

Privacy-first, local-only clone of **Whisper Notes** — record, import files, or paste a **YouTube URL**, then transcribe entirely on-device with Whisper Large V3 Turbo. No cloud STT. No accounts required.

**Repository:** https://github.com/aislingld-pursuit/L2-Clone-Prodject  
**Collaborators:** [Jimmy Ong](https://github.com/jimmyronin) · [Personal mirror](https://github.com/nessaisling-lab/L2-Clone-Prodject)

## Documents

| File | Description |
|------|-------------|
| [TECHNICAL_ARCHITECTURE.md](./TECHNICAL_ARCHITECTURE.md) | Local-first stack (Tauri, whisper.cpp, yt-dlp, SQLite) |
| [ROADMAP.md](./ROADMAP.md) | Phased delivery plan with AI-agent time estimates |
| [GPU_BACKENDS.md](./GPU_BACKENDS.md) | **GPU build matrix, features, dev scripts, CI plan** |
| [CHANGELOG.md](./CHANGELOG.md) | Release and unreleased change history |
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

**Phase 0 complete · Phase 0.5 (GPU foundation) in progress** — Tauri 2 desktop app with `wisper-core`, SQLite library, background transcription, and multi-backend GPU scaffolding (Vulkan verified on Windows AMD; Metal on macOS; CUDA/SYCL build paths added). See [ROADMAP.md](./ROADMAP.md) and [CHANGELOG.md](./CHANGELOG.md).

## Development (Phase 0)

### Prerequisites

- [Rust](https://rustup.rs/) (1.70+)
- [Node.js](https://nodejs.org/) 20+
- **CMake** (required to build whisper.cpp)
- Visual Studio Build Tools (MSVC) on Windows — required for GPU builds
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

Full GPU details: [GPU_BACKENDS.md](./GPU_BACKENDS.md).

### Whisper model (one-time)

Download a GGML model (e.g. `ggml-large-v3-turbo.bin` or `ggml-base.en.bin` for faster testing) from [Hugging Face — whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp) and place it at the path shown in the app under **Whisper model** (typically `%APPDATA%\com.aislingldpursuit.wisper\models\` on Windows).

Transcription is fully offline once the model is installed.
