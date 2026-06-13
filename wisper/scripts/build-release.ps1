# Build a release installer locally (Windows).
# Usage:
#   .\scripts\build-release.ps1              # CUDA (NVIDIA)
#   .\scripts\build-release.ps1 -Backend vulkan
#   .\scripts\build-release.ps1 -Backend cpu

param(
    [ValidateSet("cuda", "vulkan", "cpu")]
    [string]$Backend = "cuda"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

$feature = switch ($Backend) {
    "cuda"   { "gpu-cuda" }
    "vulkan" { "gpu-vulkan" }
    default  { $null }
}

if (-not $env:CARGO_TARGET_DIR) {
    $env:CARGO_TARGET_DIR = "C:\wisper-build\cargo-target"
}

Write-Host "Building Wisper release ($Backend)…" -ForegroundColor Cyan
Write-Host "  CARGO_TARGET_DIR=$($env:CARGO_TARGET_DIR)"

npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$tauriArgs = @("build")
if ($feature) {
    $tauriArgs += @("--", "--features", $feature)
}

npm run tauri -- @tauriArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$bundleCandidates = @(
    (Join-Path $Root "target\release\bundle"),
    (Join-Path $Root "src-tauri\target\release\bundle")
)
$bundleRoot = $bundleCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $bundleRoot) {
    $bundleRoot = $bundleCandidates[0]
}
Write-Host ""
Write-Host "Bundle output:" -ForegroundColor Green
Get-ChildItem -Recurse $bundleRoot -Include *.msi, *.exe, *.dmg, *.deb, *.AppImage -ErrorAction SilentlyContinue |
    ForEach-Object { Write-Host "  $($_.FullName)" }

Write-Host ""
Write-Host "Models are not bundled — run scripts/download-model.ps1 on the target machine." -ForegroundColor Yellow
