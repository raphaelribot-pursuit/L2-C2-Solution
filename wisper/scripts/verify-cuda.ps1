# Verify NVIDIA CUDA build path on Windows (Phase 0.5 exit criteria).
# Usage:
#   .\scripts\verify-cuda.ps1           # checks only
#   .\scripts\verify-cuda.ps1 -Build   # checks + cargo build with gpu-cuda

param(
    [switch]$Build
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

function Write-Step($msg) {
    Write-Host "`n==> $msg" -ForegroundColor Cyan
}

function Fail($msg) {
    Write-Host "FAIL: $msg" -ForegroundColor Red
    exit 1
}

function Pass($msg) {
    Write-Host "OK: $msg" -ForegroundColor Green
}

Write-Step "NVIDIA GPU (nvidia-smi)"
$smi = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
if (-not $smi) {
    Fail "nvidia-smi not found. Install NVIDIA drivers."
}
$gpuLines = & nvidia-smi.exe -L 2>&1
if ($LASTEXITCODE -ne 0) {
    Fail "nvidia-smi failed (exit $LASTEXITCODE). Run PowerShell as Administrator if needed.`n$gpuLines"
}
Pass ($gpuLines -join "; ")

Write-Step "CUDA Toolkit (nvcc + CUDA_PATH)"
$cudaRoot = $env:CUDA_PATH
if (-not $cudaRoot -or -not (Test-Path $cudaRoot)) {
    $searchRoot = "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA"
    if (Test-Path $searchRoot) {
        $cudaRoot = (Get-ChildItem $searchRoot -Directory |
            Sort-Object { [version]($_.Name.TrimStart('v')) } -Descending |
            Select-Object -First 1).FullName
    }
}
if (-not $cudaRoot -or -not (Test-Path $cudaRoot)) {
    foreach ($keyRoot in @(
            "HKLM:\SOFTWARE\NVIDIA Corporation\GPU Computing Toolkit\CUDA",
            "HKLM:\SOFTWARE\WOW6432Node\NVIDIA Corporation\GPU Computing Toolkit\CUDA"
        )) {
        if (-not (Test-Path $keyRoot)) { continue }
        $ver = Get-ChildItem $keyRoot -ErrorAction SilentlyContinue |
            Sort-Object { [version]$_.PSChildName } -Descending |
            Select-Object -First 1
        if ($ver) {
            $installDir = (Get-ItemProperty -Path $ver.PSPath -Name InstallDir -ErrorAction SilentlyContinue).InstallDir
            if ($installDir -and (Test-Path $installDir)) {
                $cudaRoot = $installDir.TrimEnd('\')
                break
            }
        }
    }
}
if ($cudaRoot -and (Test-Path $cudaRoot)) {
    $env:CUDA_PATH = $cudaRoot
    $env:CUDA_HOME = $cudaRoot
    $env:CUDAToolkit_ROOT = $cudaRoot
    $env:CudaToolkitDir = "$cudaRoot\"
    $cudaBin = Join-Path $cudaRoot "bin"
    $cudaBinX64 = Join-Path $cudaBin "x64"
    foreach ($dir in @($cudaBinX64, $cudaBin)) {
        if ((Test-Path $dir) -and ($env:Path -notlike "*$dir*")) {
            $env:Path = "$dir;$env:Path"
        }
    }
}
if (-not $cudaRoot -or -not (Test-Path $cudaRoot)) {
    Write-Host @"

CUDA Toolkit is NOT installed. GPU drivers alone are not enough to compile whisper.cpp with CUDA.

Install (pick one):
  1. NVIDIA CUDA Toolkit: https://developer.nvidia.com/cuda-downloads
     (RTX 50-series / Blackwell: use the latest CUDA 12.x or 13.x Windows x86_64 installer)
  2. After install, reopen the terminal and confirm:
       `$env:CUDA_PATH
       nvcc --version

Then re-run:
  .\scripts\verify-cuda.ps1 -Build
  .\dev-cuda.ps1

"@ -ForegroundColor Yellow
    exit 2
}
Pass "CUDA_PATH=$cudaRoot"

$nvcc = Join-Path $cudaRoot "bin\nvcc.exe"
if (-not (Test-Path $nvcc)) {
    Fail "nvcc not found at $nvcc"
}
& $nvcc --version
Pass "nvcc available"

if (-not $Build) {
    Write-Host "`nChecks passed. Run with -Build to compile gpu-cuda, then .\dev-cuda.ps1 to transcribe a sample file on GPU." -ForegroundColor Yellow
    exit 0
}

Write-Step "CUDA build (gpu-cuda)"
Push-Location $root
try {
    & "$root\dev.ps1" -BuildOnly -GpuBackend cuda
    if ($LASTEXITCODE -ne 0) {
        Fail "CUDA build failed (exit $LASTEXITCODE)"
    }
    Pass "CUDA build succeeded"
} finally {
    Pop-Location
}

Write-Host @"

Next (manual smoke test):
  1. Download a model if missing:
       .\scripts\download-model.ps1              # ~150 MB, quick CUDA smoke test
       .\scripts\download-model.ps1 -Model large-turbo   # full quality (~1.6 GB)
  2. .\dev-cuda.ps1
  3. Open About — release artifact should show wisper-windows-cuda, backend CUDA
  4. Choose a short WAV, select GPU, Transcribe — status should say Done on CUDA (not CPU fallback)

"@ -ForegroundColor Green
