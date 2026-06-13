# CI-parity smoke test — run before opening a PR.
# Usage: .\scripts\smoke-test.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

Write-Host "`n==> wisper-core unit tests" -ForegroundColor Cyan
Push-Location wisper-core
try {
    cargo test --quiet
    if ($LASTEXITCODE -ne 0) { throw "cargo test failed (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}

Write-Host "`n==> wisper app check (CPU)" -ForegroundColor Cyan
cargo check -p wisper --quiet
if ($LASTEXITCODE -ne 0) { throw "cargo check failed (exit $LASTEXITCODE)" }

Write-Host "`n==> frontend typecheck + build" -ForegroundColor Cyan
npm ci --silent
if ($LASTEXITCODE -ne 0) { throw "npm ci failed (exit $LASTEXITCODE)" }
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed (exit $LASTEXITCODE)" }

Write-Host "`nSmoke test passed." -ForegroundColor Green
