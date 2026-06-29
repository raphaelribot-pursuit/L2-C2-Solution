use std::path::Path;
use std::time::Instant;

use serde::{Deserialize, Serialize};

use crate::compute::{compute_info, ComputeBackend, ComputeInfo};
use crate::model::StarterModel;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemProfile {
    pub total_ram_mb: u64,
    pub cpu_architecture: String,
    pub physical_cores: usize,
    pub gpu_available: bool,
    pub gpu_backend: Option<String>,
    pub models_dir_free_mb: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchmarkResult {
    pub ran: bool,
    pub skipped_reason: Option<String>,
    pub elapsed_ms: u64,
    /// Higher values mean slower relative throughput (synthetic score).
    pub relative_score: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelRecommendation {
    pub model_key: String,
    pub model_label: String,
    pub model_size: String,
    pub backend: ComputeBackend,
    pub reason: String,
}

pub fn get_system_profile(models_dir: &Path) -> SystemProfile {
    let compute = compute_info();
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();

    let total_ram_mb = sys.total_memory() / 1024;
    let physical_cores = sys.physical_core_count().unwrap_or(1);

    let models_dir_free_mb = std::fs::metadata(models_dir)
        .ok()
        .and_then(|_| {
            sysinfo::Disks::new_with_refreshed_list()
                .iter()
                .find(|disk| models_dir.starts_with(disk.mount_point()))
                .map(|disk| disk.available_space() / 1024 / 1024)
        });

    SystemProfile {
        total_ram_mb,
        cpu_architecture: compute.cpu_architecture.clone(),
        physical_cores,
        gpu_available: compute.gpu_available,
        gpu_backend: compute.gpu_backend.clone(),
        models_dir_free_mb,
    }
}

/// Lightweight CPU timing benchmark (no model required).
pub fn run_compute_benchmark() -> BenchmarkResult {
    let start = Instant::now();
    let mut acc: u64 = 0;
    for i in 0..2_000_000u64 {
        acc = acc.wrapping_add(i.wrapping_mul(17) ^ (i >> 3));
    }
    let elapsed_ms = start.elapsed().as_millis() as u64;
    let _ = acc;
    let relative_score = Some(elapsed_ms as f64 / 1000.0);

    BenchmarkResult {
        ran: true,
        skipped_reason: None,
        elapsed_ms,
        relative_score,
    }
}

pub fn recommend_model(
    profile: &SystemProfile,
    compute: &ComputeInfo,
    benchmark: Option<&BenchmarkResult>,
) -> ModelRecommendation {
    let backend = if compute.gpu_available {
        ComputeBackend::Gpu
    } else {
        ComputeBackend::Cpu
    };

    let slow_cpu = benchmark
        .and_then(|b| b.relative_score)
        .is_some_and(|score| score > 0.35);

    let model = if profile.total_ram_mb < 8_000 || profile.physical_cores < 4 || slow_cpu {
        StarterModel::Tiny
    } else if profile.total_ram_mb < 16_000 {
        StarterModel::Base
    } else {
        StarterModel::LargeTurbo
    };

    let backend_label = compute.gpu_backend.as_deref().unwrap_or("CPU");
    let reason = if profile.total_ram_mb < 8_000 {
        format!(
            "{} GB RAM — Small model keeps transcription responsive.",
            profile.total_ram_mb / 1024
        )
    } else if slow_cpu {
        "Quick test suggests limited CPU headroom — Small is safest.".into()
    } else if model == StarterModel::LargeTurbo && compute.gpu_available {
        format!("{backend_label} + {} GB RAM — Large gives best quality.", profile.total_ram_mb / 1024)
    } else if model == StarterModel::Base {
        "Balanced choice for most laptops and desktops.".into()
    } else {
        format!("Recommended for this {backend_label} system.")
    };

    ModelRecommendation {
        model_key: model.download_key().to_string(),
        model_label: model.tier_label().to_string(),
        model_size: model.size_label().to_string(),
        backend,
        reason,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recommend_small_on_low_ram() {
        let profile = SystemProfile {
            total_ram_mb: 6_000,
            cpu_architecture: "x86_64".into(),
            physical_cores: 4,
            gpu_available: false,
            gpu_backend: None,
            models_dir_free_mb: Some(10_000),
        };
        let rec = recommend_model(&profile, &compute_info(), None);
        assert_eq!(rec.model_key, "tiny");
    }

    #[test]
    fn recommend_large_on_strong_machine() {
        let profile = SystemProfile {
            total_ram_mb: 32_000,
            cpu_architecture: "ARM64".into(),
            physical_cores: 8,
            gpu_available: true,
            gpu_backend: Some("Metal".into()),
            models_dir_free_mb: Some(50_000),
        };
        let rec = recommend_model(&profile, &compute_info(), None);
        assert_eq!(rec.model_key, "large-turbo");
    }

    #[test]
    fn benchmark_runs_quickly() {
        let result = run_compute_benchmark();
        assert!(result.ran);
        assert!(result.elapsed_ms < 5_000);
    }
}
