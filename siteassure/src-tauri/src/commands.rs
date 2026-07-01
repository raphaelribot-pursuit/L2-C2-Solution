//! Tauri command surface — the seam between the React/MUI front end and the Rust core.
//! Mirrors src/lib/api.ts. JSON contract is camelCase (serde rename_all).
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::Manager;
use wisper_core::{compiled_gpu_backend, ensure_model_available, transcribe_file, ComputeBackend};

use crate::mic::{MicRecorder, MicRecordingStatus};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub text: String,
    pub segments: Vec<TranscriptSegment>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewRecord {
    pub kind: String,
    pub site: Option<String>,
    pub trade_naics: Option<String>,
    pub transcript: String,
    pub narrative: String,
    pub fields_json: String,
    pub flags_json: String,
    pub audio_path: Option<String>, // retained source WAV (hashed into the chain on save)
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordWithHistory {
    pub id: String,
    pub kind: String,
    pub created_at: String,
    pub created_by: String,
    pub current_version: i64,
    pub versions: Vec<serde_json::Value>,
    pub audit_verified: bool,
    // Soft-delete: voided records stay in the audit chain but are hidden from Home/Dashboard.
    pub voided: bool,
    pub voided_at: Option<String>,
    pub voided_by: Option<String>,
    pub voided_reason: Option<String>,
}

/// Audit tab: chain-verified flag + head anchor summary (src-tauri/src/audit.rs audit_head).
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditStatus {
    pub verified: bool,
    pub count: i64,
    pub last_hash: String,
    pub updated_at: String,
}

/// Models live under the app data dir (staged per machine — see README; gitignored).
fn models_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("models"))
}

/// 02 Voice capture: whisper.cpp fully on-device (offline). GPU-first → CPU fallback comes from
/// wisper-core's `transcribe_with_engine`. Sync command so the blocking inference runs off the UI thread.
#[tauri::command]
pub fn transcribe(app: tauri::AppHandle, audio_path: String) -> Result<Transcript, String> {
    // SEC-003: validate the path before it reaches decode/whisper.
    let path = Path::new(&audio_path);
    if !path.is_file() {
        return Err(format!("audio file not found: {audio_path}"));
    }

    let model = ensure_model_available(&models_dir(&app)?, None, |_| {})
        .map_err(|e| e.to_string())?;
    // Request GPU when a GPU backend is compiled in; transcribe_with_engine falls back to CPU on error.
    let backend = if compiled_gpu_backend().is_some() {
        ComputeBackend::Gpu
    } else {
        ComputeBackend::Cpu
    };

    let segments = transcribe_file(&model, path, backend).map_err(|e| e.to_string())?;

    let text = segments
        .iter()
        .map(|s| s.text.trim())
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    Ok(Transcript {
        text,
        segments: segments
            .into_iter()
            .map(|s| TranscriptSegment {
                start_ms: s.start_ms.max(0) as u64,
                end_ms: s.end_ms.max(0) as u64,
                text: s.text,
            })
            .collect(),
    })
}

/// 02 Start mic capture (cpal). Held in app state until stopped.
#[tauri::command]
pub fn start_recording(state: tauri::State<'_, crate::AppState>) -> Result<(), String> {
    let mut slot = state.recorder.lock().map_err(|e| e.to_string())?;
    if slot.is_some() {
        return Err("already recording".into());
    }
    *slot = Some(MicRecorder::start()?);
    Ok(())
}

/// 02 Live capture status (peak / duration / device) for the waveform + timer.
#[tauri::command]
pub fn recording_status(
    state: tauri::State<'_, crate::AppState>,
) -> Result<Option<MicRecordingStatus>, String> {
    Ok(state
        .recorder
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .map(|r| r.status()))
}

/// 02 Stop capture, write the WAV under app data /audio, return its path.
/// The WAV is the retained tamper-proof backup (Phase 3b: hash it into the audit chain).
#[tauri::command]
pub fn stop_recording(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<String, String> {
    let recorder = state
        .recorder
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or_else(|| "not recording".to_string())?;

    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("audio");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let out = dir.join(format!("{}.wav", uuid::Uuid::new_v4()));

    let result = recorder.stop(&out)?;
    Ok(result.path.to_string_lossy().into_owned())
}

// ── Records + audit (Phase 2). amend_record lands in Phase 5. ───────────────────────────────

/// 03 Confirm & save: persist a new record (version 1) + write the 'create' audit entry.
#[tauri::command]
pub fn save_record(db: tauri::State<'_, crate::db::Db>, rec: NewRecord) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    crate::db::save_record(&conn, &db.key, &rec, &now)
}

/// 05 Amend: new version (prior preserved) + 'amend' audit entry. Reason required.
#[tauri::command]
pub fn amend_record(
    db: tauri::State<'_, crate::db::Db>,
    id: String,
    changes: serde_json::Value,
    reason: String,
) -> Result<i64, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    crate::db::amend_record(&conn, &db.key, &id, &changes, &reason, &now)
}

/// 05 Record view: full record + version history + audit-verify result.
#[tauri::command]
pub fn get_record(db: tauri::State<'_, crate::db::Db>, id: String) -> Result<RecordWithHistory, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    crate::db::get_record(&conn, &db.key, &id)
}

/// 05 Delete (soft): void a record. Nothing is ever hard-deleted — the record and its full
/// version history stay in the database and the audit chain; list_records/get_record just
/// flag it as `voided` so the frontend can hide it from Home/Dashboard. Reason required.
#[tauri::command]
pub fn void_record(db: tauri::State<'_, crate::db::Db>, id: String, reason: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    crate::db::void_record(&conn, &id, &reason, &now)
}

/// 01 Home / Records list.
#[tauri::command]
pub fn list_records(db: tauri::State<'_, crate::db::Db>) -> Result<Vec<serde_json::Value>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    crate::db::list_records(&conn)
}

/// 04 Safety flags: deterministic, offline scan over the narrative + OSHA trade context.
#[tauri::command]
pub fn scan_flags(narrative: String, trade_naics: Option<String>) -> Vec<crate::flags::Flag> {
    crate::flags::scan(&narrative, trade_naics.as_deref())
}

/// Audit tab: chain-verified status + head anchor summary (count/lastHash/updatedAt).
#[tauri::command]
pub fn audit_status(db: tauri::State<'_, crate::db::Db>) -> Result<AuditStatus, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    crate::db::audit_status(&conn)
}

/// Audit tab: recent chain entries, newest first. `limit` defaults to 50 if not supplied.
#[tauri::command]
pub fn list_audit_log(
    db: tauri::State<'_, crate::db::Db>,
    limit: Option<i64>,
) -> Result<Vec<crate::audit::AuditEntry>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    crate::db::list_audit_log(&conn, limit.unwrap_or(50))
}
