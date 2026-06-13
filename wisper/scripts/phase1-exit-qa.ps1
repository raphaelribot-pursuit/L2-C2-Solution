# Phase 1 exit QA — automated preflight + manual checklist.
# Usage:
#   .\scripts\phase1-exit-qa.ps1              # preflight only
#   .\scripts\phase1-exit-qa.ps1 -Launch      # preflight then start dev-cuda.ps1

param(
    [switch]$Launch
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$core = Join-Path $root "wisper-core"

function Write-Step($msg) {
    Write-Host "`n==> $msg" -ForegroundColor Cyan
}

function Pass($msg) {
    Write-Host "OK: $msg" -ForegroundColor Green
}

function Warn($msg) {
    Write-Host "WARN: $msg" -ForegroundColor Yellow
}

function Fail($msg) {
    Write-Host "FAIL: $msg" -ForegroundColor Red
    exit 1
}

Write-Step "wisper-core unit tests"
Push-Location $core
try {
    cargo test --quiet
    if ($LASTEXITCODE -ne 0) { Fail "cargo test failed (exit $LASTEXITCODE)" }
    Pass "all wisper-core tests passed"
} finally {
    Pop-Location
}

Write-Step "yt-dlp (URL import)"
$yt = Get-Command yt-dlp -ErrorAction SilentlyContinue
if (-not $yt) {
    $yt = Get-Command yt-dlp.exe -ErrorAction SilentlyContinue
}
if ($yt) {
    Pass "yt-dlp at $($yt.Source)"
} else {
    Warn "yt-dlp not in PATH — install with: winget install yt-dlp"
}

Write-Step "ffmpeg (video decode smoke test in cargo test)"
$ff = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($ff) {
    Pass "ffmpeg at $($ff.Source) — mp4 symphonia test will run in cargo test"
} else {
    Warn "ffmpeg not in PATH — mp4 decode unit test skips; drag-drop MP4 still needs manual QA"
}

Write-Step "Whisper model (local dev)"
$modelsHint = @(
    "$env:APPDATA\com.aislingld-pursuit.wisper\models",
    "$env:LOCALAPPDATA\com.aislingld-pursuit.wisper\models"
)
$foundModel = $false
foreach ($dir in $modelsHint) {
    if (-not (Test-Path $dir)) { continue }
    $bins = Get-ChildItem $dir -Filter "*.bin" -ErrorAction SilentlyContinue
    if ($bins) {
        Pass "model(s) in $dir : $($bins.Name -join ', ')"
        $foundModel = $true
        break
    }
}
if (-not $foundModel) {
    Warn "no .bin model in app data — run .\scripts\download-model.ps1 or copy ggml-*.bin into models folder"
}

Write-Host "`n========================================" -ForegroundColor Magenta
Write-Host " Phase 1 exit QA — manual steps in the app" -ForegroundColor Magenta
Write-Host " Full matrix: repo root QA-CHECKLIST.md (sections 5–6)" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host @"

Launch: cd wisper; .\dev-cuda.ps1  (or use -Launch on this script)

1. Mic (~2 min)
   - Start recording, confirm peak meter moves
   - Stop, transcribe, expect timestamped segments

2. File import (~30 min MP3 if available, or any long audio)
   - Drag-drop or file picker
   - Progress bar completes; library entry appears

3. YouTube / URL
   - Paste a short public URL
   - Download progress, then transcribe; label shows URL source
   - Cancel mid-download: status should say Download cancelled (not Transcription)
   - Bad URL: status should say Download failed
   - SSRF: http://127.0.0.1 and http://169.254.169.254 should be rejected (SEC-002)

4. Edit persistence
   - Edit a segment text, quit app fully, reopen — edits remain

5. Firewall / offline transcribe
   - After download completes, block network (or airplane mode)
   - Transcription should still finish (local whisper only)

6. Video (MP4/MOV)
   - Drag a short clip; should extract audio and transcribe like audio files

7. Mic error surfacing (regression)
   - If mic denied/unplugged: explicit error, not silent empty recording

8. Library + export (Phase 2 minimum)
   - Search, delete, export TXT (native save dialog only — SEC-001), copy clipboard

9. GPU fallback (if testable)
   - Amber banner + CPU completion if GPU path fails

"@ -ForegroundColor White

if ($Launch) {
    Write-Step "Starting dev-cuda.ps1"
    Push-Location $root
    try {
        & (Join-Path $root "dev-cuda.ps1")
    } finally {
        Pop-Location
    }
}
