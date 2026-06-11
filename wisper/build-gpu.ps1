param(
    [ValidateSet("auto", "vulkan", "cuda", "sycl")]
    [string]$Backend = "vulkan"
)

# Build wisper with a GPU backend (no Tauri dev server).
# Examples:
#   .\build-gpu.ps1                    # Vulkan (Intel iGPU / AMD / NVIDIA)
#   .\build-gpu.ps1 -Backend cuda      # NVIDIA CUDA
#   .\build-gpu.ps1 -Backend sycl      # Intel oneAPI SYCL
. "$PSScriptRoot\dev.ps1" -BuildOnly -GpuBackend $Backend
