# Local dev launcher — ensures Cargo can find CMake for whisper.cpp.
$cmakeExe = "C:\Program Files\CMake\bin\cmake.exe"
if (-not (Test-Path $cmakeExe)) {
    Write-Error "CMake not found. Install with: winget install Kitware.CMake"
    exit 1
}

$env:CMAKE = $cmakeExe
$cmakeBin = "C:\Program Files\CMake\bin"
if ($env:Path -notlike "*$cmakeBin*") {
    $env:Path = "$env:Path;$cmakeBin"
}

& $cmakeExe --version
npm run tauri dev
