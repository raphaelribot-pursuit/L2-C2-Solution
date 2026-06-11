use serde::{Deserialize, Serialize};

/// Compile-time guard: whisper.cpp links exactly one GPU backend per binary.
#[cfg(all(feature = "gpu-vulkan", feature = "gpu-cuda"))]
compile_error!("Enable only one GPU feature: gpu-vulkan OR gpu-cuda OR gpu-sycl");

#[cfg(all(feature = "gpu-vulkan", feature = "gpu-sycl"))]
compile_error!("Enable only one GPU feature: gpu-vulkan OR gpu-cuda OR gpu-sycl");

#[cfg(all(feature = "gpu-cuda", feature = "gpu-sycl"))]
compile_error!("Enable only one GPU feature: gpu-vulkan OR gpu-cuda OR gpu-sycl");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ComputeBackend {
    Cpu,
    Gpu,
}

/// Which GPU stack was compiled into this binary (if any).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GpuBackendKind {
    Metal,
    Cuda,
    Vulkan,
    IntelSycl,
}

impl GpuBackendKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Metal => "Metal",
            Self::Cuda => "CUDA",
            Self::Vulkan => "Vulkan",
            Self::IntelSycl => "Intel SYCL",
        }
    }

    pub fn hint(self) -> &'static str {
        match self {
            Self::Metal => "Apple Metal (Apple Silicon and Intel Macs). Enabled automatically on macOS builds.",
            Self::Cuda => "NVIDIA CUDA. Rebuild with --features gpu-cuda and the CUDA Toolkit installed.",
            Self::Vulkan => {
                "Vulkan (NVIDIA, AMD, Intel iGPU on Windows/Linux). Rebuild with --features gpu-vulkan."
            }
            Self::IntelSycl => {
                "Intel oneAPI SYCL. Rebuild with --features gpu-sycl and Intel oneAPI setvars loaded."
            }
        }
    }
}

/// Host CPU architecture label for the UI (ggml-cpu runs on Intel, AMD, and ARM).
pub fn cpu_architecture_label() -> &'static str {
    match () {
        _ if cfg!(all(target_arch = "aarch64", target_os = "macos")) => {
            "Apple Silicon (ARM64)"
        }
        _ if cfg!(target_arch = "aarch64") => "ARM64 (aarch64)",
        _ if cfg!(target_arch = "x86_64") => "x86_64 (Intel / AMD)",
        _ if cfg!(target_arch = "x86") => "x86 (32-bit)",
        _ => "Unknown",
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComputeInfo {
    pub gpu_available: bool,
    /// Human-readable backend name when GPU is compiled in (e.g. "Metal", "Vulkan").
    pub gpu_backend: Option<String>,
    pub gpu_backend_kind: Option<GpuBackendKind>,
    /// GPU when this build includes a GPU backend; CPU-only builds default to CPU.
    pub default_backend: ComputeBackend,
    /// Host CPU architecture (Intel, AMD, Apple Silicon, and other ARM64 are supported).
    pub cpu_architecture: String,
    /// GPU builds always retry on CPU if inference fails.
    pub supports_cpu_fallback: bool,
}

pub fn compute_info() -> ComputeInfo {
    let kind = compiled_gpu_backend();
    let gpu_backend = kind.map(GpuBackendKind::label).map(str::to_string);
    let gpu_available = gpu_backend.is_some();
    ComputeInfo {
        gpu_available,
        gpu_backend,
        gpu_backend_kind: kind,
        default_backend: if gpu_available {
            ComputeBackend::Gpu
        } else {
            ComputeBackend::Cpu
        },
        cpu_architecture: cpu_architecture_label().to_string(),
        supports_cpu_fallback: gpu_available,
    }
}

/// Returns the GPU backend compiled into this binary, if any.
pub fn compiled_gpu_backend() -> Option<GpuBackendKind> {
    if cfg!(target_os = "macos") {
        return Some(GpuBackendKind::Metal);
    }

    if cfg!(feature = "gpu-cuda") {
        return Some(GpuBackendKind::Cuda);
    }

    if cfg!(feature = "gpu-sycl") {
        return Some(GpuBackendKind::IntelSycl);
    }

    if cfg!(feature = "gpu-vulkan") {
        return Some(GpuBackendKind::Vulkan);
    }

    None
}

pub fn validate_backend(backend: ComputeBackend) -> Result<(), crate::WisperError> {
    if backend == ComputeBackend::Gpu && compiled_gpu_backend().is_none() {
        return Err(crate::WisperError::Transcription(
            "GPU is not available in this build. Rebuild with a GPU feature: \
             gpu-vulkan (Vulkan / Intel iGPU), gpu-cuda (NVIDIA), gpu-sycl (Intel oneAPI), \
             or use a macOS build for Metal."
                .into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpu_build_has_no_gpu() {
        if compiled_gpu_backend().is_none() {
            let info = compute_info();
            assert!(!info.gpu_available);
            assert!(info.gpu_backend.is_none());
            assert_eq!(info.default_backend, ComputeBackend::Cpu);
            assert!(!info.supports_cpu_fallback);
        }
    }

    #[test]
    fn gpu_build_prefers_gpu_default() {
        if compiled_gpu_backend().is_some() {
            let info = compute_info();
            assert!(info.gpu_available);
            assert_eq!(info.default_backend, ComputeBackend::Gpu);
            assert!(info.supports_cpu_fallback);
        }
    }

    #[test]
    fn cpu_architecture_label_is_non_empty() {
        assert!(!cpu_architecture_label().is_empty());
        assert!(!compute_info().cpu_architecture.is_empty());
    }
}
