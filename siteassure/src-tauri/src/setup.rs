//! First-run setup — check + download the on-device dependencies (Whisper model + ffmpeg) with
//! visible progress, so a non-technical user never has to touch the terminal. Emits `setup-progress`
//! events ({ component, percent, status }) the UI listens to for progress bars.
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use wisper_core::{
    download_ffmpeg, download_starter_model, ffmpeg_install_filename, ffmpeg_status, model_status,
    StarterModel,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    pub model_ready: bool,
    pub ffmpeg_ready: bool,
    pub model_hint: String,
    pub ffmpeg_hint: String,
}

fn models_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("models"))
}
fn bin_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("bin"))
}

fn emit_progress(app: &AppHandle, component: &str, percent: Option<i32>, status: &str) {
    let _ = app.emit(
        "setup-progress",
        serde_json::json!({ "component": component, "percent": percent, "status": status }),
    );
}

/// Which on-device dependencies are present right now.
#[tauri::command]
pub fn setup_status(app: AppHandle) -> Result<SetupStatus, String> {
    let m = model_status(&models_dir(&app)?);
    let staged_ffmpeg = bin_dir(&app)?.join(ffmpeg_install_filename());
    let f = ffmpeg_status(&[staged_ffmpeg]);
    Ok(SetupStatus {
        model_ready: m.ready,
        ffmpeg_ready: f.available,
        model_hint: m.hint,
        ffmpeg_hint: f.hint,
    })
}

/// Download the on-device voice model (default: Large V3 Turbo). Blocking; progress via events.
#[tauri::command]
pub fn download_model(app: AppHandle, tier: Option<String>) -> Result<(), String> {
    let dir = models_dir(&app)?;
    let model = tier
        .as_deref()
        .and_then(StarterModel::from_key)
        .unwrap_or(StarterModel::LargeTurbo);
    let app2 = app.clone();
    download_starter_model(&dir, model, move |p| {
        emit_progress(&app2, "model", p.percent, &p.status);
    })
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Download the bundled ffmpeg binary (audio tooling). Blocking; progress via events.
#[tauri::command]
pub fn download_ffmpeg_bin(app: AppHandle) -> Result<(), String> {
    let dir = bin_dir(&app)?;
    let app2 = app.clone();
    download_ffmpeg(&dir, false, move |p| {
        emit_progress(&app2, "ffmpeg", p.percent, &p.status);
    })
    .map_err(|e| e.to_string())?;
    Ok(())
}
