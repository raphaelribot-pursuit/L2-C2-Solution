param(
    [ValidateSet("auto", "vulkan", "cuda", "sycl")]
    [string]$Backend = "vulkan"
)

# Build wisper with a GPU backend (no Tauri dev server).
# Examples:
#   .\build-gpu.ps1                    # Vulkan (Intel iGPU / AMD / NVIDIA)
#   .\build-gpu.ps1 -Backend cuda      # NVIDIA CUDA
#   .\build-gpu.ps1 -Backend sycl      # Advanced: Intel oneAPI SYCL (not shipped by default)
. "$PSScriptRoot\dev.ps1" -BuildOnly -GpuBackend $Backend
