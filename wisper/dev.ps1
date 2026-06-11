param(
    [switch]$BuildOnly,
    [ValidateSet("auto", "vulkan", "cuda", "sycl", "cpu")]
    [string]$GpuBackend = "auto"
)

# Local dev launcher — CMake + MSVC + optional GPU backend (Vulkan / CUDA / Intel SYCL).
# macOS: use dev-macos.sh (Metal is enabled automatically on Apple Silicon and Intel Macs).

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
        Write-Warning "Visual Studio Build Tools not found. GPU builds need cl.exe."
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

function Resolve-CudaToolkit {
    foreach ($var in @("CUDA_PATH", "CUDA_HOME")) {
        $value = (Get-Item -Path "env:$var" -ErrorAction SilentlyContinue).Value
        if ($value -and (Test-Path $value)) {
            if (-not $env:CUDA_PATH) {
                $env:CUDA_PATH = $value
            }
            return $env:CUDA_PATH
        }
    }

    $default = "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.0"
    if (Test-Path $default) {
        $env:CUDA_PATH = $default
        return $default
    }

    $cudaRoot = "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA"
    if (Test-Path $cudaRoot) {
        $latest = Get-ChildItem $cudaRoot -Directory | Sort-Object Name -Descending | Select-Object -First 1
        if ($latest) {
            $env:CUDA_PATH = $latest.FullName
            return $latest.FullName
        }
    }

    return $null
}

function Resolve-OneApiRoot {
    if ($env:ONEAPI_ROOT -and (Test-Path $env:ONEAPI_ROOT)) {
        return $env:ONEAPI_ROOT
    }

    $default = "C:\Program Files (x86)\Intel\oneAPI"
    if (Test-Path $default) {
        $env:ONEAPI_ROOT = $default
        return $default
    }

    return $null
}

function Initialize-OneApiEnvironment {
    $root = Resolve-OneApiRoot
    if (-not $root) {
        return $false
    }

    $setvars = Join-Path $root "setvars.bat"
    if (-not (Test-Path $setvars)) {
        Write-Warning "oneAPI found at $root but setvars.bat is missing."
        return $false
    }

    cmd /c "`"$setvars`" intel64 >nul && set" | ForEach-Object {
        if ($_ -match '^(?<key>[^=]+)=(?<val>.*)$') {
            Set-Item -Path "env:$($matches.key)" -Value $matches.val
        }
    }

    Write-Host "Intel oneAPI: $root"
    return $true
}

function Test-NvidiaGpuPresent {
    $nvidiaSmi = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
    if (-not $nvidiaSmi) {
        return $false
    }
    cmd /c "nvidia-smi.exe -L >nul 2>&1" | Out-Null
    return $LASTEXITCODE -eq 0
}

function Resolve-GpuBackend {
    param([string]$Requested)

    if ($Requested -eq "cpu") {
        return @{ Mode = "cpu"; Feature = $null; Label = "CPU-only" }
    }

    if ($Requested -eq "cuda") {
        return @{ Mode = "cuda"; Feature = "gpu-cuda"; Label = "CUDA (NVIDIA)" }
    }

    if ($Requested -eq "vulkan") {
        return @{ Mode = "vulkan"; Feature = "gpu-vulkan"; Label = "Vulkan (AMD / Intel / NVIDIA)" }
    }

    if ($Requested -eq "sycl") {
        return @{ Mode = "sycl"; Feature = "gpu-sycl"; Label = "Intel SYCL (oneAPI)" }
    }

    # auto: CUDA only when an NVIDIA GPU is present, then Vulkan, then Intel SYCL
    if ((Test-NvidiaGpuPresent) -and (Resolve-CudaToolkit)) {
        return @{ Mode = "cuda"; Feature = "gpu-cuda"; Label = "CUDA (auto-detected NVIDIA GPU)" }
    }
    if (Resolve-VulkanSdk) {
        return @{ Mode = "vulkan"; Feature = "gpu-vulkan"; Label = "Vulkan (auto-detected)" }
    }
    if (Resolve-OneApiRoot) {
        return @{ Mode = "sycl"; Feature = "gpu-sycl"; Label = "Intel SYCL (auto-detected)" }
    }

    return @{ Mode = "cpu"; Feature = $null; Label = "CPU-only (no GPU SDK found)" }
}

function Initialize-GpuBuildRoot {
    if (-not $env:WISPER_EP_BUILD_ROOT) {
        $env:WISPER_EP_BUILD_ROOT = "C:\wisper-build"
    }
    New-Item -ItemType Directory -Force -Path $env:WISPER_EP_BUILD_ROOT | Out-Null
    Write-Host "ExternalProject build root (no spaces): $($env:WISPER_EP_BUILD_ROOT)"
}

function Invoke-CargoGpuBuild {
    param(
        [Parameter(Mandatory = $true)][string]$Feature,
        [Parameter(Mandatory = $true)][string]$Label
    )

    Initialize-GpuBuildRoot
    Write-Host "Cleaning whisper-rs-sys cache so CMake picks up backend/toolchain changes..."
    cargo clean -p whisper-rs-sys
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
    Get-ChildItem (Join-Path $PSScriptRoot "target\debug\build\whisper-rs-sys-*\out\build") -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Building with GPU ($Label) — first compile may take several minutes..."
    cargo build -p wisper --features $Feature
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
        if ($env:CUDA_PATH) {
            $cudaBin = Join-Path $env:CUDA_PATH "bin"
            $extraEnv += "set `"CUDA_PATH=$($env:CUDA_PATH)`""
            if (Test-Path $cudaBin) {
                $extraEnv += "set `"PATH=$cudaBin;%PATH%`""
            }
        }
        $envChain = ($extraEnv -join " && ")
        cmd /c "`"$($script:VsDevCmdPath)`" -no_logo -arch=amd64 && $envChain && $npmLine"
        exit $LASTEXITCODE
    }

    & npm @NpmArgs
    exit $LASTEXITCODE
}

$script:VsDevCmdPath = $null
$script:MsvcReady = Initialize-MsvcDevEnvironment

$env:CMAKE = $cmakeExe
$cmakeBin = "C:\Program Files\CMake\bin"
if ($env:Path -notlike "*$cmakeBin*") {
    $env:Path = "$env:Path;$cmakeBin"
}

& $cmakeExe --version

$selection = Resolve-GpuBackend -Requested $GpuBackend
Write-Host "GPU backend selection: $($selection.Label) (requested: $GpuBackend)"

if ($selection.Mode -eq "cpu") {
    Write-Host "Running CPU-only build."
    if ($BuildOnly) {
        cargo build -p wisper
        exit $LASTEXITCODE
    }
    Invoke-DevCommand @("run", "tauri", "--", "dev")
}

if (-not $script:MsvcReady) {
    Write-Warning "GPU build needs MSVC (Desktop development with C++). Falling back to CPU-only."
    if ($BuildOnly) {
        cargo build -p wisper
        exit $LASTEXITCODE
    }
    Invoke-DevCommand @("run", "tauri", "--", "dev")
}

Initialize-GpuBuildRoot

switch ($selection.Mode) {
    "vulkan" {
        $vulkanSdk = Resolve-VulkanSdk
        if (-not $vulkanSdk) {
            Write-Error "Vulkan SDK not found. Install from https://vulkan.lunarg.com/ or set VULKAN_SDK."
            exit 1
        }
        $vulkanBin = Join-Path $vulkanSdk "Bin"
        if ((Test-Path $vulkanBin) -and ($env:Path -notlike "*$vulkanBin*")) {
            $env:Path = "$vulkanBin;$env:Path"
        }
        Write-Host "Vulkan SDK: $vulkanSdk"
        & "$PSScriptRoot\scripts\patch-vulkan-cmake.ps1"
        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }
        if ($BuildOnly) {
            Invoke-CargoGpuBuild -Feature $selection.Feature -Label $selection.Label
        } else {
            Invoke-DevCommand @("run", "tauri", "--", "dev", "--features", $selection.Feature)
        }
    }
    "cuda" {
        $cudaPath = Resolve-CudaToolkit
        if (-not $cudaPath) {
            Write-Error "CUDA Toolkit not found. Install from NVIDIA and set CUDA_PATH, or pass -GpuBackend vulkan for Intel/AMD GPUs."
            exit 1
        }
        Write-Host "CUDA Toolkit: $cudaPath"
        if ($BuildOnly) {
            Invoke-CargoGpuBuild -Feature $selection.Feature -Label $selection.Label
        } else {
            Invoke-DevCommand @("run", "tauri", "--", "dev", "--features", $selection.Feature)
        }
    }
    "sycl" {
        if (-not (Initialize-OneApiEnvironment)) {
            Write-Error "Intel oneAPI not found. Install oneAPI Base Toolkit and set ONEAPI_ROOT, or use -GpuBackend vulkan for Intel iGPU via Vulkan."
            exit 1
        }
        if ($BuildOnly) {
            Invoke-CargoGpuBuild -Feature $selection.Feature -Label $selection.Label
        } else {
            Invoke-DevCommand @("run", "tauri", "--", "dev", "--features", $selection.Feature)
        }
    }
    default {
        Write-Error "Unknown GPU mode: $($selection.Mode)"
        exit 1
    }
}
