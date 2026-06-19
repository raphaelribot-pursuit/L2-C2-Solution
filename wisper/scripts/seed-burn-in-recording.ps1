# Seeds a video recording + transcript for burn-in UI testing (app must be closed).
param(
    [string]$Title = "Burn-in UI test"
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$srcVideo = Join-Path $root "test-artifacts\burn-in-input.mp4"
if (-not (Test-Path $srcVideo)) {
    throw "Missing test video: $srcVideo"
}

$appData = Join-Path $env:APPDATA "com.aislingldpursuit.wisper"
$audioDir = Join-Path $appData "audio"
$dbPath = Join-Path $appData "wisper.db"
New-Item -ItemType Directory -Force -Path $audioDir | Out-Null

$recordingId = [guid]::NewGuid().ToString()
$destVideo = Join-Path $audioDir "$recordingId.mp4"
Copy-Item -Path $srcVideo -Destination $destVideo -Force

$createdAt = [int][double]::Parse((Get-Date -UFormat %s))
$escapedTitle = $Title.Replace("'", "''")
$escapedPath = $destVideo.Replace("'", "''")

$sql = @"
INSERT INTO recordings (id, title, created_at, duration_ms, source, source_url, audio_path, language, model_id)
VALUES ('$recordingId', '$escapedTitle', $createdAt, 3000, 'import', NULL, '$escapedPath', 'en', 'ui-test');

INSERT INTO transcript_segments (recording_id, start_ms, end_ms, text, speaker, words_json)
VALUES ('$recordingId', 0, 2500, 'Hello burn-in', 'Speaker 1', NULL);
"@

$sql | sqlite3 $dbPath
if ($LASTEXITCODE -ne 0) {
    throw "sqlite3 insert failed"
}

Write-Output "Seeded recording $recordingId"
Write-Output "Title: $Title"
Write-Output "Video: $destVideo"
