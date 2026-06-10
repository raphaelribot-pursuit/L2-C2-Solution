use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::Manager;
use wisper_core::{
    compute_info, resolve_model_path, transcribe_file, ComputeBackend, ComputeInfo, RecordingSummary,
    Storage, TranscriptSegment,
};

struct AppState {
    storage: Mutex<Storage>,
}

fn app_data_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn models_dir(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app).join("models")
}

fn db_path(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app).join("wisper.db")
}

fn model_path(app: &tauri::AppHandle) -> PathBuf {
    resolve_model_path(&models_dir(app))
}

fn file_stem(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Untitled".into())
}

#[derive(Debug, serde::Serialize)]
struct TranscribeResult {
    recording_id: String,
    segments: Vec<TranscriptSegment>,
}

#[tauri::command]
fn get_model_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(model_path(&app).to_string_lossy().into_owned())
}

#[tauri::command]
fn get_compute_info() -> ComputeInfo {
    compute_info()
}

#[tauri::command]
fn list_recordings(state: tauri::State<'_, AppState>) -> Result<Vec<RecordingSummary>, String> {
    state
        .storage
        .lock()
        .map_err(|e| e.to_string())?
        .list_recordings()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_transcript(
    state: tauri::State<'_, AppState>,
    recording_id: String,
) -> Result<Vec<TranscriptSegment>, String> {
    state
        .storage
        .lock()
        .map_err(|e| e.to_string())?
        .get_segments(&recording_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn update_segment(
    state: tauri::State<'_, AppState>,
    recording_id: String,
    index: usize,
    text: String,
) -> Result<(), String> {
    state
        .storage
        .lock()
        .map_err(|e| e.to_string())?
        .update_segment_text(&recording_id, index, &text)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn transcribe_audio(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    audio_path: String,
    use_gpu: bool,
) -> Result<TranscribeResult, String> {
    let backend = if use_gpu {
        ComputeBackend::Gpu
    } else {
        ComputeBackend::Cpu
    };
    let model = model_path(&app);
    let path = PathBuf::from(&audio_path);
    let segments = transcribe_file(&model, path.as_path(), backend).map_err(|e| e.to_string())?;

    let model_id = model
        .file_name()
        .map(|n| n.to_string_lossy().into_owned());

    let recording_id = state
        .storage
        .lock()
        .map_err(|e| e.to_string())?
        .save_import_transcript(
            &file_stem(&audio_path),
            path.as_path(),
            Some("en"),
            model_id.as_deref(),
            &segments,
        )
        .map_err(|e| e.to_string())?;

    Ok(TranscribeResult {
        recording_id,
        segments,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            std::fs::create_dir_all(models_dir(app.handle())).ok();
            let storage = Storage::open(&db_path(app.handle())).map_err(|e| e.to_string())?;
            app.manage(AppState {
                storage: Mutex::new(storage),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_model_path,
            get_compute_info,
            list_recordings,
            get_transcript,
            update_segment,
            transcribe_audio
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
