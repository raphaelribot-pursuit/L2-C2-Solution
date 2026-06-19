# End-to-end burn-in test via live Tauri UI (WebView2 CDP + save-dialog helper).
param(
    [string]$OutputVideo = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
if (-not $OutputVideo) {
    $OutputVideo = Join-Path $root "test-artifacts\burn-in-ui-output.mp4"
}
$outDir = Split-Path $OutputVideo -Parent
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
if (Test-Path $OutputVideo) {
    Remove-Item $OutputVideo -Force
}

Write-Host "Stopping any running Wisper dev instances on port 1420…"
Get-NetTCPConnection -LocalPort 1420 -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

& (Join-Path $PSScriptRoot "seed-burn-in-recording.ps1")

$saveDialogJob = Start-Job -ScriptBlock {
    param($Path)
    Add-Type -AssemblyName System.Windows.Forms
    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
        $dialogs = Get-Process | Where-Object {
            $_.MainWindowTitle -like "*Save video*" -or $_.MainWindowTitle -like "*burned-in*"
        }
        if ($dialogs) {
            Start-Sleep -Milliseconds 800
            [System.Windows.Forms.SendKeys]::SendWait("^a")
            Start-Sleep -Milliseconds 100
            [System.Windows.Forms.SendKeys]::SendWait($Path)
            Start-Sleep -Milliseconds 200
            [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
            return "saved"
        }
        Start-Sleep -Milliseconds 400
    }
    return "timeout"
} -ArgumentList $OutputVideo

$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
Write-Host "Starting Tauri dev (WebView2 CDP on 9222)…"

$devProc = Start-Process -FilePath "powershell" -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", (Join-Path $root "dev.ps1"),
    "-GpuBackend", "cpu"
) -WorkingDirectory $root -PassThru -WindowStyle Minimized

function Wait-CdpReady {
    param([int]$Seconds = 180)
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-WebRequest -Uri "http://127.0.0.1:9222/json/version" -UseBasicParsing -TimeoutSec 2
            if ($resp.StatusCode -eq 200) { return $true }
        } catch {}
        if ($devProc.HasExited) {
            throw "Tauri dev exited early with code $($devProc.ExitCode)"
        }
        Start-Sleep -Seconds 2
    }
    return $false
}

if (-not (Wait-CdpReady)) {
    Stop-Process -Id $devProc.Id -Force -ErrorAction SilentlyContinue
    throw "CDP endpoint did not become ready on port 9222"
}
Write-Host "CDP ready."

Push-Location $root
try {
    npm exec --yes --package=playwright@1.51.0 -- node (Join-Path $PSScriptRoot "ui-burn-in-test.mjs")
    if ($LASTEXITCODE -ne 0) {
        throw "UI automation failed (exit $LASTEXITCODE)"
    }
} finally {
    Pop-Location
}

$dialogResult = Receive-Job $saveDialogJob -Wait -AutoRemoveJob
Write-Host "Save dialog helper: $dialogResult"

if (-not (Test-Path $OutputVideo)) {
    throw "Expected output video missing: $OutputVideo"
}

$size = (Get-Item $OutputVideo).Length
if ($size -lt 10_000) {
    throw "Output video too small ($size bytes) — burn-in may have failed"
}

Write-Host "Extracting verification frame…"
$framePath = Join-Path $outDir "burn-in-ui-frame.jpg"
ffmpeg -y -hide_banner -loglevel error -ss 0.75 -i $OutputVideo -frames:v 1 $framePath
if (-not (Test-Path $framePath)) {
    throw "Could not extract frame from output video"
}

Write-Host ""
Write-Host "=== UI burn-in test PASSED ==="
Write-Host "Output: $OutputVideo ($size bytes)"
Write-Host "Frame:  $framePath"
Write-Host "Stop dev server with: Stop-Process -Id $($devProc.Id)"
