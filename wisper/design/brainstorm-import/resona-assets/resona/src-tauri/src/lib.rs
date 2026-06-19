//! Resona desktop — Tauri 2 entry point, app state, and commands.
mod audio;
mod licensing;
mod streaming;
mod vad;
mod whisper;

use licensing::{entitlements_for, validate_license, Entitlements, Tier};
use parking_lot::Mutex;
use std::sync::Arc;
use streaming::StreamHandle;
use tauri::{AppHandle, Manager, State};
use whisper::WhisperEngine;

#[derive(Default)]
struct AppState {
    engine: Mutex<Option<Arc<WhisperEngine>>>,
    stream: Mutex<Option<StreamHandle>>,
    tier: Mutex<Option<Tier>>,
}

const SAMPLE_RATE: usize = 16_000;

fn current_tier(state: &State<AppState>) -> Tier {
    (*state.tier.lock()).unwrap_or(Tier::Free)
}

/// Load a whisper model file from disk. `model_id` is the short name
/// (tiny/base/small/...) used for tier gating; `path` is the ggml file.
#[tauri::command]
fn load_model(state: State<AppState>, model_id: String, path: String) -> Result<(), String> {
    let ent = entitlements_for(current_tier(&state));
    if !ent.allowed_models.contains(&model_id) {
        return Err(format!(
            "The {model_id} model is a Pro feature. Upgrade to unlock larger, more accurate models."
        ));
    }
    let engine = WhisperEngine::load(&path).map_err(|e| e.to_string())?;
    *state.engine.lock() = Some(Arc::new(engine));
    Ok(())
}

#[tauri::command]
fn get_entitlements(state: State<AppState>) -> Entitlements {
    entitlements_for(current_tier(&state))
}

/// DEMO licensing. See licensing.rs — real validation happens server-side.
#[tauri::command]
fn set_license(state: State<AppState>, key: String) -> Entitlements {
    let tier = validate_license(&key);
    *state.tier.lock() = Some(tier);
    entitlements_for(tier)
}

/// Transcribe a buffer of 16kHz mono f32 samples (decoded in the frontend
/// from an uploaded file via the Web Audio API).
#[tauri::command]
fn transcribe_samples(
    state: State<AppState>,
    samples: Vec<f32>,
    language: Option<String>,
    translate: bool,
) -> Result<String, String> {
    let ent = entitlements_for(current_tier(&state));
    let minutes = samples.len() as f32 / SAMPLE_RATE as f32 / 60.0;
    if ent.max_minutes_per_file != 0 && minutes > ent.max_minutes_per_file as f32 {
        return Err(format!(
            "Free tier is limited to {} minutes per file (this one is {:.1}). Upgrade for unlimited length.",
            ent.max_minutes_per_file, minutes
        ));
    }
    if translate && !ent.translation {
        return Err("Translation is a Pro feature.".into());
    }
    let engine = {
        let guard = state.engine.lock();
        guard.clone().ok_or("Load a model first.")?
    };
    engine
        .transcribe(&samples, language.as_deref(), translate, false)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn start_dictation(
    app: AppHandle,
    state: State<AppState>,
    language: Option<String>,
    translate: bool,
) -> Result<(), String> {
    let ent = entitlements_for(current_tier(&state));
    if translate && !ent.translation {
        return Err("Translation is a Pro feature.".into());
    }
    let engine = {
        let guard = state.engine.lock();
        guard.clone().ok_or("Load a model first.")?
    };
    // Stop any existing session before starting a new one.
    if let Some(h) = state.stream.lock().take() {
        h.stop();
    }
    let handle = streaming::start(app, engine, language, translate);
    *state.stream.lock() = Some(handle);
    Ok(())
}

#[tauri::command]
fn stop_dictation(state: State<AppState>) {
    if let Some(h) = state.stream.lock().take() {
        h.stop();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(AppState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_model,
            get_entitlements,
            set_license,
            transcribe_samples,
            start_dictation,
            stop_dictation
        ])
        .run(tauri::generate_context!())
        .expect("error while running Resona");
}
