//! SiteAssure — Tauri + Rust shell (transcription pipeline vendored from wisper). Single-device, offline v1.
// ponytail: audit/db/flags are scaffolded ahead of use — wired in Phase 2/4. Drop this allow then.
#![allow(dead_code)]
use std::sync::Mutex;
use tauri::Manager;

mod audit;
mod commands;
mod db;
mod flags;
mod mic;

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
            app.manage(db::Db(std::sync::Mutex::new(conn)));
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
            commands::list_records,
            commands::scan_flags,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SiteAssure");
}
