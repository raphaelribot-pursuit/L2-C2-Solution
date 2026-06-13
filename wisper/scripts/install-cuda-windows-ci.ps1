# Install CUDA Toolkit on GitHub Actions Windows runners (network installer).
# Jimver/cuda-toolkit often fails with exit 3772776473 on current runners.
# Usage (from repo root): pwsh wisper/scripts/install-cuda-windows-ci.ps1

param(
    [string]$Version = "12.6.0",
    [string]$Short = "12.6"
)

$ErrorActionPreference = "Stop"

$url = "https://developer.download.nvidia.com/compute/cuda/$Version/network_installers/cuda_${Version}_windows_network.exe"
$installer = Join-Path $env:RUNNER_TEMP "cuda_${Version}_windows_network.exe"

Write-Host "Downloading CUDA $Version network installer..."
Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing

$packages = @(
    "nvcc_$Short",
    "cudart_$Short",
    "cudart_dev_$Short",
    "cublas_$Short",
    "cublas_dev_$Short",
    "cublasLt_$Short"
) -join " "

Write-Host "Installing CUDA sub-packages: $packages"
$proc = Start-Process -FilePath $installer -ArgumentList "-s $packages" -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) {
    throw "CUDA installer exited with code $($proc.ExitCode)"
}

$cudaPath = "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v$Short"
if (-not (Test-Path $cudaPath)) {
    throw "CUDA not found at $cudaPath after install"
}

Write-Host "CUDA installed at: $cudaPath"
$env:CUDA_PATH = $cudaPath
$bin = Join-Path $cudaPath "bin"
$env:PATH = "$bin;$env:PATH"

if ($env:GITHUB_ENV) {
    "CUDA_PATH=$cudaPath" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
}
if ($env:GITHUB_PATH) {
    $bin | Out-File -FilePath $env:GITHUB_PATH -Append -Encoding utf8
}

nvcc --version
