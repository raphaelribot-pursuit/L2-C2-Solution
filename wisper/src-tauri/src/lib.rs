use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use tauri::{Emitter, Manager};
use wisper_core::{
    compute_info, resolve_model_path, transcribe_with_engine, ComputeBackend, ComputeInfo,
    GpuFallbackNotice, RecordingSummary, Storage, TranscribeOptions, TranscriptSegment,
    TranscriptionProgress, WhisperEngine, WisperError,
};

struct AppState {
    storage: Mutex<Storage>,
    engine: Mutex<WhisperEngine>,
    cancel: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
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

fn backend_label(backend: ComputeBackend) -> &'static str {
    match backend {
        ComputeBackend::Cpu => "cpu",
        ComputeBackend::Gpu => "gpu",
    }
}

fn file_stem(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Untitled".into())
}

#[derive(Debug, serde::Serialize, Clone)]
struct TranscribeResult {
    recording_id: String,
    segments: Vec<TranscriptSegment>,
    requested_backend: String,
    actual_backend: String,
    used_cpu_fallback: bool,
}

#[derive(Debug, serde::Serialize, Clone)]
struct TranscriptionErrorPayload {
    message: String,
    cancelled: bool,
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
fn cancel_transcription(state: tauri::State<'_, AppState>) -> Result<(), String> {
    if !state.running.load(Ordering::SeqCst) {
        return Ok(());
    }
    state.cancel.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
fn start_transcription(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    audio_path: String,
    use_gpu: bool,
) -> Result<(), String> {
    if state.running.swap(true, Ordering::SeqCst) {
        return Err("Transcription already in progress".into());
    }

    state.cancel.store(false, Ordering::SeqCst);

    let backend = if use_gpu {
        ComputeBackend::Gpu
    } else {
        ComputeBackend::Cpu
    };
    let model = model_path(&app);
    let path = PathBuf::from(&audio_path);
    let title = file_stem(&audio_path);

    let app_handle = app.clone();
    let cancel = Arc::clone(&state.cancel);
    let running = Arc::clone(&state.running);

    thread::spawn(move || {
        let result: Result<TranscribeResult, WisperError> = (|| {
            let app_state = app_handle.state::<AppState>();
            let options = TranscribeOptions::default();

            let transcription = {
                let mut engine = app_state
                    .engine
                    .lock()
                    .map_err(|e| WisperError::Storage(e.to_string()))?;

                let progress_app = app_handle.clone();
                let fallback_app = app_handle.clone();
                transcribe_with_engine(
                    &mut engine,
                    &model,
                    &path,
                    backend,
                    &options,
                    cancel,
                    move |progress: TranscriptionProgress| {
                        let _ = progress_app.emit("transcription-progress", &progress);
                    },
                    Some(Arc::new(move |notice: GpuFallbackNotice| {
                        let _ = fallback_app.emit("transcription-fallback", &notice);
                    })),
                )?
            };

            let segments = transcription.segments;
            let requested_backend = backend_label(transcription.requested_backend).to_string();
            let actual_backend = backend_label(transcription.actual_backend).to_string();
            let used_cpu_fallback = transcription.used_cpu_fallback;

            let model_id = model
                .file_name()
                .map(|n| n.to_string_lossy().into_owned());

            let recording_id = app_state
                .storage
                .lock()
                .map_err(|e| WisperError::Storage(e.to_string()))?
                .save_import_transcript(
                    &title,
                    path.as_path(),
                    Some("en"),
                    model_id.as_deref(),
                    &segments,
                )?;

            Ok(TranscribeResult {
                recording_id,
                segments,
                requested_backend,
                actual_backend,
                used_cpu_fallback,
            })
        })();

        running.store(false, Ordering::SeqCst);

        match result {
            Ok(payload) => {
                let _ = app_handle.emit("transcription-complete", &payload);
            }
            Err(WisperError::Cancelled) => {
                let _ = app_handle.emit(
                    "transcription-error",
                    TranscriptionErrorPayload {
                        message: "Transcription cancelled.".into(),
                        cancelled: true,
                    },
                );
            }
            Err(err) => {
                let _ = app_handle.emit(
                    "transcription-error",
                    TranscriptionErrorPayload {
                        message: err.to_string(),
                        cancelled: false,
                    },
                );
            }
        }
    });

    Ok(())
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
                engine: Mutex::new(WhisperEngine::new()),
                cancel: Arc::new(AtomicBool::new(false)),
                running: Arc::new(AtomicBool::new(false)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_model_path,
            get_compute_info,
            list_recordings,
            get_transcript,
            update_segment,
            start_transcription,
            cancel_transcription
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
