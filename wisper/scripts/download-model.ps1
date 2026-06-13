# Download a GGML Whisper model into the Wisper app data folder.
# Usage:
#   .\scripts\download-model.ps1                    # ggml-base.en.bin (~150 MB, good for smoke tests)
#   .\scripts\download-model.ps1 -Model large-turbo # ggml-large-v3-turbo.bin (~1.6 GB, default app model)
#   .\scripts\download-model.ps1 -Model tiny        # ggml-tiny.en.bin (~75 MB, fastest)

param(
    [ValidateSet("tiny", "base", "large-turbo")]
    [string]$Model = "base"
)

$ErrorActionPreference = "Stop"

$models = @{
    "tiny"        = @{ File = "ggml-tiny.en.bin";         Url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin" }
    "base"        = @{ File = "ggml-base.en.bin";         Url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin" }
    "large-turbo" = @{ File = "ggml-large-v3-turbo.bin"; Url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin" }
}

$entry = $models[$Model]
$modelsDir = Join-Path $env:APPDATA "com.aislingldpursuit.wisper\models"
$dest = Join-Path $modelsDir $entry.File

New-Item -ItemType Directory -Force -Path $modelsDir | Out-Null

if (Test-Path $dest) {
    $sizeMb = [math]::Round((Get-Item $dest).Length / 1MB, 1)
    Write-Host "Model already exists: $dest ($sizeMb MB)" -ForegroundColor Green
    exit 0
}

Write-Host "Downloading $($entry.File) to:" -ForegroundColor Cyan
Write-Host "  $dest"
Write-Host "This may take several minutes for large models." -ForegroundColor Yellow

try {
    Invoke-WebRequest -Uri $entry.Url -OutFile $dest -UseBasicParsing
} catch {
    Write-Error "Download failed from $($entry.Url): $_"
    exit 1
}

$sizeMb = [math]::Round((Get-Item $dest).Length / 1MB, 1)
Write-Host "Done — $sizeMb MB saved." -ForegroundColor Green
Write-Host "Restart or reload Wisper, then transcribe with GPU selected."
