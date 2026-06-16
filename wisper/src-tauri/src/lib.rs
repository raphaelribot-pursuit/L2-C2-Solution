mod mic;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use mic::{MicRecorder, MicRecordingStatus};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;
use wisper_core::{
    app_about, compute_info, download_starter_model, download_url, format_transcript_txt,
    import_model_file, model_status, resolve_model_path, resolve_yt_dlp, transcribe_with_engine,
    yt_dlp_status, AppAbout, ComputeBackend, ComputeInfo, DownloadProgress, ModelStatus,
    StarterModel, GpuFallbackNotice, RecordingSource, RecordingSummary, Storage, TranscribeOptions,
    TranscriptSegment, TranscriptionProgress, WhisperEngine, WisperError, YtDlpStatus,
};

struct AppState {
    storage: Mutex<Storage>,
    engine: Mutex<WhisperEngine>,
    cancel: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    recorder: Mutex<Option<MicRecorder>>,
    recording_active: Arc<AtomicBool>,
}

fn app_data_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn models_dir(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app).join("models")
}

fn audio_dir(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app).join("audio")
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

fn yt_dlp_candidates(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let exe_name = if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" };
    let mut candidates = Vec::new();
    if let Ok(resource) = app.path().resource_dir() {
        candidates.push(resource.join("bin").join(exe_name));
        candidates.push(resource.join(exe_name));
    }
    candidates.push(app_data_dir(app).join("bin").join(exe_name));
    candidates
}

fn transcribe_options_from_language(language: Option<String>) -> TranscribeOptions {
    let whisper_lang = language.and_then(|l| {
        let trimmed = l.trim().to_lowercase();
        if trimmed.is_empty() || trimmed == "auto" {
            None
        } else {
            Some(trimmed)
        }
    });
    TranscribeOptions {
        language: whisper_lang,
        verbose_logging: false,
    }
}

fn language_for_storage(language: Option<&str>) -> Option<&str> {
    language.and_then(|l| {
        let trimmed = l.trim();
        if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("auto") {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn run_transcription_job(
    app_handle: &tauri::AppHandle,
    path: &Path,
    backend: ComputeBackend,
    options: TranscribeOptions,
    recording_source: RecordingSource,
    title: String,
    source_url: Option<String>,
    language_label: Option<String>,
    cancel: Arc<AtomicBool>,
) -> Result<TranscribeResult, WisperError> {
    let app_state = app_handle.state::<AppState>();
    let model = model_path(app_handle);
    let source_label = recording_source.as_str().to_string();

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
            path,
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
        .save_transcript(
            recording_source,
            &title,
            path,
            source_url.as_deref(),
            language_for_storage(language_label.as_deref()),
            model_id.as_deref(),
            &segments,
        )?;

    Ok(TranscribeResult {
        recording_id,
        segments,
        requested_backend,
        actual_backend,
        used_cpu_fallback,
        source: source_label,
    })
}

#[derive(Debug, serde::Serialize, Clone)]
struct TranscribeResult {
    recording_id: String,
    segments: Vec<TranscriptSegment>,
    requested_backend: String,
    actual_backend: String,
    used_cpu_fallback: bool,
    source: String,
}

#[derive(Debug, serde::Serialize, Clone)]
struct TranscriptionErrorPayload {
    message: String,
    cancelled: bool,
    /// `"download"` while fetching URL audio; `"transcribe"` during Whisper decode.
    phase: String,
}

fn url_job_error_phase(err: &WisperError, download_finished: bool) -> &'static str {
    match err {
        WisperError::Fetch(_) => "download",
        WisperError::Cancelled if !download_finished => "download",
        _ => "transcribe",
    }
}

fn emit_transcription_error(
    app: &tauri::AppHandle,
    message: impl Into<String>,
    cancelled: bool,
    phase: &str,
) {
    let _ = app.emit(
        "transcription-error",
        TranscriptionErrorPayload {
            message: message.into(),
            cancelled,
            phase: phase.into(),
        },
    );
}

#[derive(Debug, serde::Serialize, Clone)]
struct DownloadCompletePayload {
    audio_path: String,
    title: String,
    source_url: String,
}

#[derive(Debug, serde::Serialize, Clone)]
struct StopRecordingResult {
    audio_path: String,
    duration_ms: u64,
}

#[tauri::command]
fn get_model_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(model_path(&app).to_string_lossy().into_owned())
}

#[tauri::command]
fn get_model_status(app: tauri::AppHandle) -> ModelStatus {
    model_status(&models_dir(&app))
}

#[tauri::command]
fn open_models_folder(app: tauri::AppHandle) -> Result<(), String> {
    let dir = models_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(
            dir.to_string_lossy().into_owned(),
            None::<&str>,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn import_model_from_path(app: tauri::AppHandle, source_path: String) -> Result<String, String> {
    let dest = import_model_file(Path::new(&source_path), &models_dir(&app))
        .map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
fn start_model_download(app: tauri::AppHandle, model: String) -> Result<(), String> {
    let starter = StarterModel::from_key(&model).ok_or_else(|| "Unknown model".to_string())?;
    let dir = models_dir(&app);
    let handle = app.clone();
    thread::spawn(move || {
        let result = download_starter_model(&dir, starter, |progress| {
            let _ = handle.emit("model-download-progress", progress);
        });
        match result {
            Ok(path) => {
                let _ = handle.emit("model-download-complete", path.to_string_lossy().to_string());
            }
            Err(err) => {
                let _ = handle.emit("model-download-error", err.to_string());
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn get_compute_info() -> ComputeInfo {
    compute_info()
}

#[tauri::command]
fn get_app_about(app: tauri::AppHandle) -> AppAbout {
    app_about(app.package_info().version.to_string())
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
fn search_library(
    state: tauri::State<'_, AppState>,
    query: String,
) -> Result<Vec<RecordingSummary>, String> {
    state
        .storage
        .lock()
        .map_err(|e| e.to_string())?
        .search_recordings(&query)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_recording(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    recording_id: String,
) -> Result<(), String> {
    state
        .storage
        .lock()
        .map_err(|e| e.to_string())?
        .delete_recording(&recording_id, Some(&audio_dir(&app)))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn export_transcript_txt(
    state: tauri::State<'_, AppState>,
    recording_id: String,
) -> Result<String, String> {
    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    let segments = storage
        .get_segments(&recording_id)
        .map_err(|e| e.to_string())?;
    Ok(format_transcript_txt(&segments))
}

#[tauri::command]
async fn save_transcript_txt_file(
    app: tauri::AppHandle,
    contents: String,
    default_filename: String,
) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Export transcript")
        .set_file_name(default_filename)
        .add_filter("Text", &["txt"])
        .blocking_save_file();

    let Some(picked) = picked else {
        return Ok(None);
    };

    let path = picked
        .into_path()
        .map_err(|e| format!("invalid save path: {e}"))?;
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
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
fn start_recording(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<MicRecordingStatus, String> {
    if state.running.load(Ordering::SeqCst) {
        return Err("Stop transcription before recording".into());
    }

    let mut slot = state.recorder.lock().map_err(|e| e.to_string())?;
    if slot.is_some() {
        return Err("Already recording".into());
    }

    let recorder = MicRecorder::start().map_err(|e| e.to_string())?;
    let status = recorder.status();
    *slot = Some(recorder);

    state.recording_active.store(true, Ordering::SeqCst);

    let app_handle = app.clone();
    let active = Arc::clone(&state.recording_active);
    thread::spawn(move || {
        while active.load(Ordering::SeqCst) {
            if let Some(rec) = app_handle.try_state::<AppState>() {
                if let Ok(guard) = rec.recorder.lock() {
                    if let Some(ref recorder) = *guard {
                        let status = recorder.status();
                        let _ = app_handle.emit("recording-status", &status);
                    }
                }
            }
            thread::sleep(Duration::from_millis(150));
        }
    });

    Ok(status)
}

#[tauri::command]
fn stop_recording(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<StopRecordingResult, String> {
    state.recording_active.store(false, Ordering::SeqCst);

    let recorder = state
        .recorder
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or_else(|| "Not recording".to_string())?;

    std::fs::create_dir_all(audio_dir(&app)).map_err(|e| e.to_string())?;
    let filename = format!("{}.wav", Uuid::new_v4());
    let output = audio_dir(&app).join(filename);

    let result = recorder.stop(&output).map_err(|e| e.to_string())?;

    Ok(StopRecordingResult {
        audio_path: result.path.to_string_lossy().into_owned(),
        duration_ms: result.duration_ms,
    })
}

#[tauri::command]
fn get_recording_status(
    state: tauri::State<'_, AppState>,
) -> Result<Option<MicRecordingStatus>, String> {
    let guard = state.recorder.lock().map_err(|e| e.to_string())?;
    Ok(guard.as_ref().map(MicRecorder::status))
}

#[tauri::command]
fn get_yt_dlp_status(app: tauri::AppHandle) -> YtDlpStatus {
    yt_dlp_status(&yt_dlp_candidates(&app))
}

#[tauri::command]
fn start_transcription(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    audio_path: String,
    use_gpu: bool,
    source: Option<String>,
    title: Option<String>,
    language: Option<String>,
    source_url: Option<String>,
) -> Result<(), String> {
    if state.recorder.lock().map_err(|e| e.to_string())?.is_some() {
        return Err("Stop recording before transcribing".into());
    }

    if state.running.swap(true, Ordering::SeqCst) {
        return Err("Transcription already in progress".into());
    }

    state.cancel.store(false, Ordering::SeqCst);

    let recording_source = source
        .as_deref()
        .and_then(RecordingSource::parse)
        .unwrap_or(RecordingSource::Import);

    let backend = if use_gpu {
        ComputeBackend::Gpu
    } else {
        ComputeBackend::Cpu
    };
    let path = PathBuf::from(&audio_path);
    let title = title.unwrap_or_else(|| match recording_source {
        RecordingSource::Mic => "Voice memo".into(),
        _ => file_stem(&audio_path),
    });

    let options = transcribe_options_from_language(language.clone());
    let language_label = language;

    let app_handle = app.clone();
    let cancel = Arc::clone(&state.cancel);
    let running = Arc::clone(&state.running);

    thread::spawn(move || {
        let result = run_transcription_job(
            &app_handle,
            &path,
            backend,
            options,
            recording_source,
            title,
            source_url,
            language_label,
            cancel,
        );

        running.store(false, Ordering::SeqCst);

        match result {
            Ok(payload) => {
                let _ = app_handle.emit("transcription-complete", &payload);
            }
            Err(WisperError::Cancelled) => {
                emit_transcription_error(
                    &app_handle,
                    "Transcription cancelled.",
                    true,
                    "transcribe",
                );
            }
            Err(err) => {
                emit_transcription_error(&app_handle, err.to_string(), false, "transcribe");
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn start_url_import(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    url: String,
    use_gpu: bool,
    language: Option<String>,
) -> Result<(), String> {
    if state.recorder.lock().map_err(|e| e.to_string())?.is_some() {
        return Err("Stop recording before importing a URL".into());
    }

    if state.running.swap(true, Ordering::SeqCst) {
        return Err("A download or transcription is already in progress".into());
    }

    state.cancel.store(false, Ordering::SeqCst);

    let backend = if use_gpu {
        ComputeBackend::Gpu
    } else {
        ComputeBackend::Cpu
    };
    let options = transcribe_options_from_language(language.clone());
    let language_label = language;

    let yt_dlp = resolve_yt_dlp(&yt_dlp_candidates(&app)).map_err(|e| {
        state.running.store(false, Ordering::SeqCst);
        e.to_string()
    })?;

    let output_dir = audio_dir(&app);
    let app_handle = app.clone();
    let cancel = Arc::clone(&state.cancel);
    let running = Arc::clone(&state.running);

    thread::spawn(move || {
        let mut download_finished = false;
        let result: Result<TranscribeResult, WisperError> = (|| {
            let download = download_url(
                &yt_dlp,
                &url,
                &output_dir,
                &cancel,
                |progress: DownloadProgress| {
                    let _ = app_handle.emit("download-progress", &progress);
                },
            )?;
            download_finished = true;

            let _ = app_handle.emit(
                "download-complete",
                DownloadCompletePayload {
                    audio_path: download.audio_path.to_string_lossy().into_owned(),
                    title: download.title.clone(),
                    source_url: download.source_url.clone(),
                },
            );

            run_transcription_job(
                &app_handle,
                &download.audio_path,
                backend,
                options,
                RecordingSource::Url,
                download.title,
                Some(download.source_url),
                language_label,
                cancel,
            )
        })();

        running.store(false, Ordering::SeqCst);

        match result {
            Ok(payload) => {
                let _ = app_handle.emit("transcription-complete", &payload);
            }
            Err(WisperError::Cancelled) => {
                let phase = url_job_error_phase(&WisperError::Cancelled, download_finished);
                let message = if download_finished {
                    "Transcription cancelled."
                } else {
                    "Import cancelled."
                };
                emit_transcription_error(&app_handle, message, true, phase);
            }
            Err(err) => {
                let phase = url_job_error_phase(&err, download_finished);
                emit_transcription_error(&app_handle, err.to_string(), false, phase);
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
            std::fs::create_dir_all(audio_dir(app.handle())).ok();
            let storage = Storage::open(&db_path(app.handle())).map_err(|e| e.to_string())?;
            app.manage(AppState {
                storage: Mutex::new(storage),
                engine: Mutex::new(WhisperEngine::new()),
                cancel: Arc::new(AtomicBool::new(false)),
                running: Arc::new(AtomicBool::new(false)),
                recorder: Mutex::new(None),
                recording_active: Arc::new(AtomicBool::new(false)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_model_path,
            get_model_status,
            open_models_folder,
            import_model_from_path,
            start_model_download,
            get_compute_info,
            get_app_about,
            list_recordings,
            get_transcript,
            update_segment,
            search_library,
            delete_recording,
            export_transcript_txt,
            save_transcript_txt_file,
            start_recording,
            stop_recording,
            get_recording_status,
            get_yt_dlp_status,
            start_transcription,
            start_url_import,
            cancel_transcription
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
