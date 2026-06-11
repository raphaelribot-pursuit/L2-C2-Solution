# Patches ggml-vulkan for Windows GPU builds:
# 1. Inherit parent Visual Studio generator for nested vulkan-shaders-gen
# 2. Build ExternalProject under a space-free path (MSBuild breaks on spaced OneDrive paths)

$marker = "WIN32_NATIVE_MSVC_COMPILER_PATCH_V3"

$epSetupBlock = @"

    # $marker — inherit parent VS generator; use space-free ExternalProject prefix on Windows
    set(_GGML_VULKAN_EP_GENERATOR "")
    set(_GGML_VULKAN_EP_PLATFORM "")
    set(_GGML_VULKAN_EP_TOOLSET "")
    set(_GGML_VULKAN_EP_PREFIX "")
    if (WIN32 AND NOT CMAKE_CROSSCOMPILING)
        set(_GGML_VULKAN_EP_GENERATOR "`${CMAKE_GENERATOR}")
        if (CMAKE_GENERATOR_PLATFORM)
            set(_GGML_VULKAN_EP_PLATFORM "`${CMAKE_GENERATOR_PLATFORM}")
        endif()
        if (CMAKE_GENERATOR_TOOLSET)
            set(_GGML_VULKAN_EP_TOOLSET "`${CMAKE_GENERATOR_TOOLSET}")
        endif()
        set(_GGML_VULKAN_EP_ROOT "`$ENV{WISPER_EP_BUILD_ROOT}")
        if (NOT _GGML_VULKAN_EP_ROOT)
            set(_GGML_VULKAN_EP_ROOT "C:/wisper-build")
        endif()
        string(REPLACE "\\" "/" _GGML_VULKAN_EP_ROOT "`${_GGML_VULKAN_EP_ROOT}")
        file(MAKE_DIRECTORY "`${_GGML_VULKAN_EP_ROOT}")
        # Unique per whisper-rs-sys out dir — shared prefix breaks when cargo rebuilds with a new fingerprint (CI: wisper-core then wisper).
        string(REPLACE "\\" "/" _GGML_VULKAN_EP_SRC "`${CMAKE_CURRENT_LIST_DIR}")
        if (_GGML_VULKAN_EP_SRC MATCHES "whisper-rs-sys-([a-f0-9]+)")
            set(_GGML_VULKAN_EP_ID "`${CMAKE_MATCH_1}")
        else()
            string(MD5 "`${_GGML_VULKAN_EP_SRC}" _GGML_VULKAN_EP_ID)
        endif()
        string(SUBSTRING "`${_GGML_VULKAN_EP_ID}" 0 16 _GGML_VULKAN_EP_ID)
        set(_GGML_VULKAN_EP_PREFIX "`${_GGML_VULKAN_EP_ROOT}/`${_GGML_VULKAN_EP_ID}/vulkan-shaders-gen-prefix")
    endif()
"@

$epNeedle = @"
    ExternalProject_Add(
        vulkan-shaders-gen
        SOURCE_DIR `${CMAKE_CURRENT_SOURCE_DIR}/vulkan-shaders
        CMAKE_ARGS -DCMAKE_INSTALL_PREFIX=
"@

$epReplacement = @"
    ExternalProject_Add(
        vulkan-shaders-gen
        SOURCE_DIR `${CMAKE_CURRENT_SOURCE_DIR}/vulkan-shaders
        PREFIX "`${_GGML_VULKAN_EP_PREFIX}"
        CMAKE_GENERATOR "`${_GGML_VULKAN_EP_GENERATOR}"
        CMAKE_GENERATOR_PLATFORM "`${_GGML_VULKAN_EP_PLATFORM}"
        CMAKE_GENERATOR_TOOLSET "`${_GGML_VULKAN_EP_TOOLSET}"
        CMAKE_ARGS -DCMAKE_INSTALL_PREFIX=
"@

function Remove-ExistingPatchBlock {
    param([string]$Content)

    $patterns = @(
        '(?s)\r?\n    # WIN32_NATIVE_MSVC_COMPILER_PATCH_V3[^\r\n]*\r?\n.*?(?=\r?\n    ExternalProject_Add\(\r?\n)',
        '(?s)\r?\n    # WIN32_NATIVE_MSVC_COMPILER_PATCH_V2[^\r\n]*\r?\n.*?(?=\r?\n    ExternalProject_Add\(\r?\n)',
        '(?s)\r?\n    # WIN32_NATIVE_MSVC_COMPILER_PATCH[^\r\n]*\r?\n.*?(?=\r?\n    ExternalProject_Add\(\r?\n)'
    )
    foreach ($pattern in $patterns) {
        $Content = [regex]::Replace($Content, $pattern, "`n")
    }
    return $Content
}

function Remove-GeneratorInjectionFromExternalProject {
    param([string]$Content)

    $patterns = @(
        '(?s)\r?\n        PREFIX "\$\{_GGML_VULKAN_EP_PREFIX\}"\r?\n        CMAKE_GENERATOR "\$\{_GGML_VULKAN_EP_GENERATOR\}"\r?\n        CMAKE_GENERATOR_PLATFORM "\$\{_GGML_VULKAN_EP_PLATFORM\}"\r?\n        CMAKE_GENERATOR_TOOLSET "\$\{_GGML_VULKAN_EP_TOOLSET\}"\r?\n',
        '(?s)\r?\n        CMAKE_GENERATOR "\$\{_GGML_VULKAN_EP_GENERATOR\}"\r?\n        CMAKE_GENERATOR_PLATFORM "\$\{_GGML_VULKAN_EP_PLATFORM\}"\r?\n        CMAKE_GENERATOR_TOOLSET "\$\{_GGML_VULKAN_EP_TOOLSET\}"\r?\n'
    )
    foreach ($pattern in $patterns) {
        $Content = [regex]::Replace($Content, $pattern, "`n")
    }
    return $Content
}

function Test-AlreadyPatched {
    param([string]$Content)

    return (
        ($Content -match [regex]::Escape($marker)) -and
        ($Content -match 'CMAKE_MATCH_1') -and
        ($Content -match 'PREFIX "\$\{_GGML_VULKAN_EP_PREFIX\}"') -and
        ($Content -match 'CMAKE_GENERATOR "\$\{_GGML_VULKAN_EP_GENERATOR\}"')
    )
}

function Patch-GgmlVulkanCMake {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path $Path)) {
        return $false
    }

    $content = Get-Content -Path $Path -Raw
    if (Test-AlreadyPatched -Content $content) {
        Write-Host "Already patched: $Path"
        return $true
    }

    $content = Remove-ExistingPatchBlock -Content $content
    $content = Remove-GeneratorInjectionFromExternalProject -Content $content

    $externalProjectNeedleCrLf = "    ExternalProject_Add(`r`n        vulkan-shaders-gen"
    $externalProjectNeedleLf = "    ExternalProject_Add(`n        vulkan-shaders-gen"
    $setupCrLf = ($epSetupBlock -replace "`r`n", "`r`n") + "`r`n    ExternalProject_Add(`r`n        vulkan-shaders-gen"
    $setupLf = ($epSetupBlock -replace "`r`n", "`n") + "`n    ExternalProject_Add(`n        vulkan-shaders-gen"

    if ($content.Contains($externalProjectNeedleCrLf)) {
        if ($content -match [regex]::Escape($marker)) {
            $content = Remove-ExistingPatchBlock -Content $content
        }
        if ($content -notmatch [regex]::Escape($marker)) {
            $content = $content.Replace($externalProjectNeedleCrLf, $setupCrLf)
        }
    } elseif ($content.Contains($externalProjectNeedleLf)) {
        if ($content -match [regex]::Escape($marker)) {
            $content = Remove-ExistingPatchBlock -Content $content
        }
        if ($content -notmatch [regex]::Escape($marker)) {
            $content = $content.Replace($externalProjectNeedleLf, $setupLf)
        }
    } elseif ($content -notmatch [regex]::Escape($marker)) {
        Write-Warning "Could not insert generator setup block in $Path"
        return $false
    }

    $epNeedleCrLf = $epNeedle
    $epNeedleLf = $epNeedle -replace "`r`n", "`n"
    $epReplacementCrLf = $epReplacement
    $epReplacementLf = $epReplacement -replace "`r`n", "`n"

    if ($content.Contains($epNeedleCrLf)) {
        $content = $content.Replace($epNeedleCrLf, $epReplacementCrLf)
    } elseif ($content.Contains($epNeedleLf)) {
        $content = $content.Replace($epNeedleLf, $epReplacementLf)
    } else {
        Write-Warning "Could not inject ExternalProject settings in $Path"
        return $false
    }

    Set-Content -Path $Path -Value $content -NoNewline
    Write-Host "Patched: $Path"
    return $true
}

$wisperDir = Split-Path $PSScriptRoot -Parent

$registryRoots = Get-ChildItem "$env:USERPROFILE\.cargo\registry\src" -Directory -ErrorAction SilentlyContinue
$registryFiles = @()
foreach ($root in $registryRoots) {
    $registryFiles += Get-ChildItem (Join-Path $root.FullName "whisper-rs-sys-0.15.0\whisper.cpp\ggml\src\ggml-vulkan\CMakeLists.txt") -ErrorAction SilentlyContinue
}

$outFiles = Get-ChildItem (Join-Path $wisperDir "target\*\build\whisper-rs-sys-*\out\whisper.cpp\ggml\src\ggml-vulkan\CMakeLists.txt") -ErrorAction SilentlyContinue

$patched = 0
foreach ($file in ($registryFiles + $outFiles)) {
    if (Patch-GgmlVulkanCMake -Path $file.FullName) {
        $patched++
    }
}

if ($patched -eq 0) {
    Write-Warning "No ggml-vulkan CMakeLists.txt found to patch. Run cargo fetch first."
    exit 1
}

Write-Host "Vulkan CMake patch applied to $patched file(s)."
