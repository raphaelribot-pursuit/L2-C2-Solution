param(
    [switch]$BuildOnly
)

# Local dev launcher — ensures Cargo can find CMake for whisper.cpp.
$cmakeExe = "C:\Program Files\CMake\bin\cmake.exe"
if (-not (Test-Path $cmakeExe)) {
    Write-Error "CMake not found. Install with: winget install Kitware.CMake"
    exit 1
}

function Find-VsDevCmd {
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
        if ($installPath) {
            $devCmd = Join-Path $installPath "Common7\Tools\VsDevCmd.bat"
            if (Test-Path $devCmd) {
                return $devCmd
            }
        }
    }

    # Prefer newer VS installs (18 before 2022) when vswhere is unavailable.
    $candidates = @(
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\18\BuildTools\Common7\Tools\VsDevCmd.bat",
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat",
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat",
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat",
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\Professional\Common7\Tools\VsDevCmd.bat"
    )

    foreach ($path in $candidates) {
        if (Test-Path $path) {
            return $path
        }
    }

    return $null
}

function Get-VsDevCmdForCl {
    param([Parameter(Mandatory = $true)][string]$ClPath)

    if ($ClPath -match '^(?<root>.*)\\VC\\Tools\\MSVC\\') {
        $devCmd = Join-Path $Matches.root "Common7\Tools\VsDevCmd.bat"
        if (Test-Path $devCmd) {
            return $devCmd
        }
    }

    return $null
}

function Test-ClCompilerAvailable {
    $cl = Get-Command cl.exe -ErrorAction SilentlyContinue
    if (-not $cl) {
        return $false
    }

    cmd /c "cl.exe /? >nul 2>&1" | Out-Null
    return $LASTEXITCODE -eq 0
}

function Find-ClCompilerPath {
    if (Test-ClCompilerAvailable) {
        return (Get-Command cl.exe).Source
    }

    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (-not (Test-Path $vswhere)) {
        return $null
    }

    $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if (-not $installPath) {
        return $null
    }

    $cl = Get-ChildItem (Join-Path $installPath "VC\Tools\MSVC\*\bin\Hostx64\x64\cl.exe") -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending |
        Select-Object -First 1

    if ($cl) {
        return $cl.FullName
    }

    return $null
}

function Set-CMakeCompilerEnv {
    param([Parameter(Mandatory = $true)][string]$ClPath)

    # Parent cmake gets -DCMAKE_C_COMPILER from whisper-rs-sys (reads these env vars).
    # Nested vulkan-shaders-gen needs the patch script to forward them via CMAKE_ARGS.
    $env:CMAKE_C_COMPILER = $ClPath
    $env:CMAKE_CXX_COMPILER = $ClPath
}

function Initialize-MsvcDevEnvironment {
    $clPath = Find-ClCompilerPath
    if ($clPath) {
        Set-CMakeCompilerEnv -ClPath $clPath
        Write-Host "MSVC ready: $clPath"
        $script:VsDevCmdPath = Get-VsDevCmdForCl -ClPath $clPath
        if (-not $script:VsDevCmdPath) {
            $script:VsDevCmdPath = Find-VsDevCmd
        }
        if ($script:VsDevCmdPath) {
            Write-Host "VsDevCmd: $($script:VsDevCmdPath)"
        }
        return $true
    }

    $vsDevCmd = Find-VsDevCmd
    if (-not $vsDevCmd) {
        Write-Warning "Visual Studio Build Tools not found. GPU builds fail at vulkan-shaders-gen without cl.exe."
        return $false
    }

    cmd /c "`"$vsDevCmd`" -no_logo -arch=amd64 >nul && set" | ForEach-Object {
        if ($_ -match '^(?<key>[^=]+)=(?<val>.*)$') {
            Set-Item -Path "env:$($matches.key)" -Value $matches.val
        }
    }

    $clPath = Find-ClCompilerPath
    if (-not $clPath) {
        Write-Warning "VsDevCmd ran but cl.exe is still unavailable."
        return $false
    }

    Set-CMakeCompilerEnv -ClPath $clPath
    $script:VsDevCmdPath = Get-VsDevCmdForCl -ClPath $clPath
    if (-not $script:VsDevCmdPath) {
        $script:VsDevCmdPath = $vsDevCmd
    }
    Write-Host "MSVC ready: $clPath"
    Write-Host "VsDevCmd: $($script:VsDevCmdPath)"
    return $true
}

$script:VsDevCmdPath = $null
$script:MsvcReady = Initialize-MsvcDevEnvironment

$env:CMAKE = $cmakeExe
$cmakeBin = "C:\Program Files\CMake\bin"
if ($env:Path -notlike "*$cmakeBin*") {
    $env:Path = "$env:Path;$cmakeBin"
}

& $cmakeExe --version

function Resolve-VulkanSdk {
    if ($env:VULKAN_SDK -and (Test-Path $env:VULKAN_SDK)) {
        return $env:VULKAN_SDK
    }

    $sdkRoot = "C:\VulkanSDK"
    if (-not (Test-Path $sdkRoot)) {
        return $null
    }

    $latest = Get-ChildItem $sdkRoot -Directory | Sort-Object Name -Descending | Select-Object -First 1
    if (-not $latest) {
        return $null
    }

    $env:VULKAN_SDK = $latest.FullName
    return $env:VULKAN_SDK
}

function Initialize-GpuBuildRoot {
    if (-not $env:WISPER_EP_BUILD_ROOT) {
        $env:WISPER_EP_BUILD_ROOT = "C:\wisper-build"
    }
    New-Item -ItemType Directory -Force -Path $env:WISPER_EP_BUILD_ROOT | Out-Null
    Write-Host "ExternalProject build root (no spaces): $($env:WISPER_EP_BUILD_ROOT)"
}

function Invoke-CargoGpuBuild {
    Initialize-GpuBuildRoot
    Write-Host "Cleaning whisper-rs-sys cache (wisper/target/ only) so CMake picks up the patch..."
    cargo clean -p whisper-rs-sys
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
    Get-ChildItem (Join-Path $PSScriptRoot "target\debug\build\whisper-rs-sys-*\out\build") -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Building with GPU (Vulkan) — shader compilation may take several minutes..."
    cargo build -p wisper --features gpu-vulkan
    exit $LASTEXITCODE
}

function Invoke-DevCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$NpmArgs
    )

    if ($script:VsDevCmdPath -and $script:MsvcReady) {
        $npmLine = "npm " + ($NpmArgs -join " ")
        $extraEnv = @(
            "set `"CMAKE=$cmakeExe`""
        )
        if ($env:WISPER_EP_BUILD_ROOT) {
            $extraEnv += "set `"WISPER_EP_BUILD_ROOT=$($env:WISPER_EP_BUILD_ROOT)`""
        }
        if ($env:CMAKE_C_COMPILER) {
            $extraEnv += "set `"CMAKE_C_COMPILER=$($env:CMAKE_C_COMPILER)`""
        }
        if ($env:CMAKE_CXX_COMPILER) {
            $extraEnv += "set `"CMAKE_CXX_COMPILER=$($env:CMAKE_CXX_COMPILER)`""
        }
        if ($env:VULKAN_SDK) {
            $vulkanBin = Join-Path $env:VULKAN_SDK "Bin"
            $extraEnv += "set `"VULKAN_SDK=$($env:VULKAN_SDK)`""
            if (Test-Path $vulkanBin) {
                $extraEnv += "set `"PATH=$vulkanBin;%PATH%`""
            }
        }
        $envChain = ($extraEnv -join " && ")
        cmd /c "`"$($script:VsDevCmdPath)`" -no_logo -arch=amd64 && $envChain && $npmLine"
        exit $LASTEXITCODE
    }

    & npm @NpmArgs
    exit $LASTEXITCODE
}

$vulkanSdk = Resolve-VulkanSdk
if ($vulkanSdk) {
    $vulkanBin = Join-Path $vulkanSdk "Bin"
    if ((Test-Path $vulkanBin) -and ($env:Path -notlike "*$vulkanBin*")) {
        $env:Path = "$vulkanBin;$env:Path"
    }
    Write-Host "Vulkan SDK: $vulkanSdk"
    if (-not $script:MsvcReady) {
        Write-Warning "GPU build needs MSVC (Desktop development with C++). Falling back to CPU-only."
        if ($BuildOnly) {
            cargo build -p wisper
            exit $LASTEXITCODE
        }
        Invoke-DevCommand @("run", "tauri", "--", "dev")
    } else {
        Initialize-GpuBuildRoot
        & "$PSScriptRoot\scripts\patch-vulkan-cmake.ps1"
        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }
        if ($BuildOnly) {
            Invoke-CargoGpuBuild
        } else {
            Write-Host "Building with GPU (Vulkan) support."
            Invoke-DevCommand @("run", "tauri", "--", "dev", "--features", "gpu-vulkan")
        }
    }
} else {
    Write-Host "No Vulkan SDK found — CPU-only build."
    Write-Host "Install from https://vulkan.lunarg.com/ or set VULKAN_SDK, then rerun."
    if ($BuildOnly) {
        cargo build -p wisper
        exit $LASTEXITCODE
    }
    Invoke-DevCommand @("run", "tauri", "--", "dev")
}
