# Download yt-dlp into Tauri bundle resources for release installers.
$ErrorActionPreference = "Stop"

$destDir = Join-Path $PSScriptRoot "..\src-tauri\resources\bin"
New-Item -ItemType Directory -Force -Path $destDir | Out-Null

$url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
$dest = Join-Path $destDir "yt-dlp.exe"
Write-Host "Downloading $url -> $dest"
Invoke-WebRequest -Uri $url -OutFile $dest

if (-not (Test-Path $dest)) {
    throw "yt-dlp bundle download failed"
}

Write-Host "Bundled yt-dlp ($( (Get-Item $dest).Length ) bytes)"
