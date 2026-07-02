//! SiteAssure — Tauri + Rust shell (transcription pipeline vendored from wisper). Single-device, offline v1.
use std::sync::Mutex;
use tauri::Manager;

mod audit;
mod commands;
mod crypto;
mod db;
mod flags;
mod mic;
mod setup;

/// Shared app state: the active mic recorder (None when idle).
pub struct AppState {
    pub recorder: Mutex<Option<mic::MicRecorder>>,
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            recorder: Mutex::new(None),
        })
        .setup(|app| {
            // First-run: ensure the app-data dir + staged-model + retained-audio dirs exist.
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data).ok();
            std::fs::create_dir_all(data.join("models")).ok();
            std::fs::create_dir_all(data.join("audio")).ok();
            // Open SQLite + apply schema; manage the connection for the record/audit commands.
            let conn = db::open(&data.join("siteassure.db")).map_err(std::io::Error::other)?;
            let key = crypto::load_or_create_key().map_err(std::io::Error::other)?;
            app.manage(db::Db { conn: std::sync::Mutex::new(conn), key });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::transcribe,
            commands::start_recording,
            commands::recording_status,
            commands::stop_recording,
            commands::save_record,
            commands::amend_record,
            commands::get_record,
            commands::void_record,
            commands::resolve_flag,
            commands::list_records,
            commands::open_flags_by_site,
            commands::scan_flags,
            commands::audit_status,
            commands::list_audit_log,
            setup::setup_status,
            setup::download_model,
            setup::download_ffmpeg_bin,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SiteAssure");
}
