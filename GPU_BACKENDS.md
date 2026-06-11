# GPU backends — Wisper

Wisper targets **all desktop platforms**: **Windows**, **macOS**, and **Linux**. Each platform uses the same `wisper-core` crate and the same Cargo GPU features; only the dev launcher and system packages differ.

Each **release binary** links **exactly one** GPU backend (or CPU-only). Users toggle **CPU vs GPU at runtime**; they do **not** switch CUDA vs Vulkan at runtime.
## Release matrix (target)

| Artifact | Platform | Backend | Hardware |
|----------|----------|---------|----------|
| `wisper-windows-vulkan` | Windows | Vulkan | AMD, **Intel iGPU**, NVIDIA |
| `wisper-windows-cuda` | Windows | CUDA | NVIDIA |
| `wisper-macos-universal` | macOS | Metal | Apple Silicon + Intel Mac |
| `wisper-linux-vulkan` | Linux | Vulkan | AMD, Intel iGPU, NVIDIA |
| `wisper-linux-cuda` | Linux | CUDA | NVIDIA |
| `wisper-*-cpu` | Any | — | Fallback / CI smoke |

**Intel GPU on Windows/Linux:** use the **Vulkan** build. Intel oneAPI SYCL (`gpu-sycl`) remains in the codebase for advanced builds but is **not** a primary shipping target.

**Apple Core ML** (encoder acceleration, separate from Metal ggml) is planned immediately after this GPU foundation phase — see [ROADMAP.md](./ROADMAP.md) Phase 0.6.

---

## Cargo features

Defined in `wisper/wisper-core/Cargo.toml` and forwarded from `wisper/src-tauri/Cargo.toml`:

| Feature | whisper-rs | Use |
|---------|------------|-----|
| *(macOS default)* | `metal` | Automatic on `target_os = "macos"` |
| `gpu-vulkan` | `vulkan` | Windows / Linux — AMD, Intel, NVIDIA |
| `gpu-cuda` | `cuda` | Windows / Linux — NVIDIA |
| `gpu-sycl` | `intel-sycl` | Optional; not primary for Intel |

**Rule:** enable **at most one** of `gpu-vulkan`, `gpu-cuda`, `gpu-sycl` per build. Enabling more than one fails at compile time.

---

## Runtime behavior

1. **`get_compute_info`** returns which backend was compiled in (`gpu_backend`, `gpu_backend_kind`), host **`cpu_architecture`**, and whether **`supports_cpu_fallback`** is enabled (true for all GPU builds).
2. **Default compute choice is GPU** when this build includes a GPU backend; CPU-only builds default to CPU.
3. User can override **CPU** or **GPU** in the Compute panel.
4. `WhisperContextParameters.use_gpu = true` when GPU is selected.
5. On GPU failure, Wisper **emits `transcription-fallback`**, **invalidates the GPU context**, and **retries on CPU** once (ggml-cpu — Intel, AMD, and ARM64).
6. On completion, **`transcription-complete`** includes `used_cpu_fallback` and `actual_backend`; the UI shows a banner during fallback and a summary if CPU was used.

## CPU compatibility (Intel, AMD, ARM)

Every GPU artifact also ships **ggml-cpu** in the same binary. CPU fallback and CPU-only mode work on:

| Architecture | Typical hardware | Notes |
|--------------|------------------|--------|
| `x86_64` | Intel and AMD desktops/laptops | Same binary; no vendor-specific Cargo feature |
| `aarch64` (macOS) | Apple Silicon | Metal GPU + ARM64 CPU fallback |
| `aarch64` (Linux) | AWS Graviton, Raspberry Pi 64-bit, etc. | Vulkan build optional; CPU always available |

`cpu_architecture` in `ComputeInfo` is surfaced in the Compute panel.

---

## Building locally

### Windows

```powershell
cd wisper
npm install

# Auto-detect: NVIDIA+CUDA → CUDA, else Vulkan SDK → Vulkan, else CPU
.\dev.ps1

# Explicit backends
.\dev.ps1 -GpuBackend vulkan   # AMD / Intel iGPU (recommended on mixed hardware)
.\dev-cuda.ps1                 # NVIDIA CUDA
.\dev.ps1 -GpuBackend cpu      # CPU-only

# Build only (no Tauri dev server)
.\build-gpu.ps1 -Backend vulkan
.\build-gpu.ps1 -Backend cuda
```

**Prerequisites (Windows GPU):**

- [CMake](https://cmake.org/) (winget: `Kitware.CMake`)
- Visual Studio Build Tools — **Desktop development with C++**
- **Vulkan:** [Vulkan SDK](https://vulkan.lunarg.com/) → `VULKAN_SDK`
- **CUDA:** [NVIDIA CUDA Toolkit](https://developer.nvidia.com/cuda-downloads) → `CUDA_PATH`

OneDrive paths with spaces break nested Vulkan shader builds; `dev.ps1` sets `WISPER_EP_BUILD_ROOT=C:\wisper-build` by default.

### macOS

```bash
cd wisper
npm install
chmod +x dev-macos.sh
./dev-macos.sh
```

Metal is enabled automatically. Works on **Apple Silicon and Intel Macs** with a Metal-capable GPU.

### Linux

```bash
cd wisper
npm install
chmod +x dev-linux.sh build-linux.sh
./dev-linux.sh                      # auto: NVIDIA+CUDA → CUDA, else Vulkan, else CPU
./dev-linux.sh --gpu-backend vulkan   # AMD / Intel iGPU / NVIDIA
./dev-linux.sh --gpu-backend cuda     # NVIDIA CUDA
./dev-linux.sh --gpu-backend cpu      # CPU-only
./build-linux.sh vulkan               # build only
```

**Prerequisites (Linux):**

- [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) — `webkit2gtk-4.1`, `build-essential`, etc.
- **CMake** — `sudo apt install cmake` (Debian/Ubuntu) or distro equivalent
- **Vulkan:** `libvulkan-dev`, `vulkan-tools`, and optionally [Vulkan SDK](https://vulkan.lunarg.com/) → `VULKAN_SDK`
- **CUDA:** [NVIDIA CUDA Toolkit](https://developer.nvidia.com/cuda-downloads) → `CUDA_PATH` or `/usr/local/cuda`

`dev-linux.sh` checks for `webkit2gtk-4.1` and common build tools before starting.
---

## CI

GitHub Actions workflow: [`.github/workflows/desktop.yml`](./.github/workflows/desktop.yml)

| Job | Runner | Feature | Purpose |
|-----|--------|---------|---------|
| `test-cpu` | ubuntu-latest | none | CPU smoke + `wisper-core` tests |
| `build-linux-vulkan` | ubuntu-latest | `gpu-vulkan` | Linux x86_64 Vulkan compile |
| `build-linux-arm64-cpu` | ubuntu-24.04-arm | none | ARM64 CPU compatibility |
| `build-linux-arm64-vulkan` | ubuntu-24.04-arm | `gpu-vulkan` | ARM64 Vulkan compile (`jakoch/install-vulkan-sdk-action` — LunarG SDK is x86_64-only) |
| `build-macos-metal` | macos-latest | *(macOS default)* | Metal binary |
| `build-windows-vulkan` | windows-latest | `gpu-vulkan` | Windows Vulkan compile |

CUDA compile jobs (Windows/Linux) can be added when CUDA toolkit caching is set up; GPU integration tests may use self-hosted NVIDIA runners.
---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| GPU button disabled | CPU-only build | Rebuild with `--features gpu-vulkan` (or use `dev.ps1`) |
| `failed to encode` / `-6` on GPU | Stale whisper-rs-sys cache or wrong backend binary | `cargo clean -p whisper-rs-sys`, rebuild; match backend to hardware |
| Vulkan build fails at `vulkan-shaders-gen` | Missing MSVC or path with spaces | Run `.\dev.ps1`; ensure `WISPER_EP_BUILD_ROOT` has no spaces |
| CUDA build can't find toolkit | `CUDA_PATH` unset | Install CUDA Toolkit; set `CUDA_PATH` |
| Vulkan build fails on Linux | Missing dev packages | Install `libvulkan-dev vulkan-tools`; see Tauri Linux prerequisites |
| Auto picked CUDA on AMD/Intel machine | NVIDIA driver present without suitable GPU build | Use `-GpuBackend vulkan` (Windows) or `--gpu-backend vulkan` (Linux) |

---

## Architecture reference

See [TECHNICAL_ARCHITECTURE.md](./TECHNICAL_ARCHITECTURE.md) §4 (Model strategy) and [ROADMAP.md](./ROADMAP.md) Phase 0.5–0.6.
