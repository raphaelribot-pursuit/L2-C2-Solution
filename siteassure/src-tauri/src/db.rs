//! SQLite store. Applies db/schema.sql on first run. Every record write goes through here,
//! and every create/amend appends exactly one audit_log entry via audit::append (the sole writer).
use std::path::Path;

use rusqlite::{params, Connection};
use serde_json::{json, Value};

use crate::audit;
use crate::commands::{NewRecord, RecordWithHistory};

pub const SCHEMA: &str = include_str!("../../db/schema.sql");

/// Managed Tauri state: the single SQLite connection, serialized behind a Mutex.
pub struct Db(pub std::sync::Mutex<Connection>);

const ACTOR: &str = "local"; // single user in v1

/// Open (or create) the store and apply the schema.
pub fn open(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    Ok(conn)
}

/// 03 Save: insert the record + version 1, then append the 'create' audit entry. Returns the new id.
pub fn save_record(conn: &Connection, rec: &NewRecord, now: &str) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO records (id, kind, created_at, created_by, current_ver, site, trade_naics)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)",
        params![id, rec.kind, now, ACTOR, rec.site, rec.trade_naics],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO record_versions
           (record_id, version, created_at, author, reason, transcript, narrative, fields_json, flags_json, status)
         VALUES (?1, 1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, 'final')",
        params![id, now, ACTOR, rec.transcript, rec.narrative, rec.fields_json, rec.flags_json],
    )
    .map_err(|e| e.to_string())?;

    let payload = json!({
        "record_id": id,
        "version": 1,
        "kind": rec.kind,
        "transcript": rec.transcript,
        "narrative": rec.narrative,
        "fields": rec.fields_json,
        "flags": rec.flags_json,
    })
    .to_string();
    audit::append(
        conn,
        now,
        ACTOR,
        Some("author"),
        "create",
        Some(id.as_str()),
        Some(1),
        payload.as_bytes(),
    )?;

    Ok(id)
}

/// 01 Records list (newest first).
pub fn list_records(conn: &Connection) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, kind, created_at, current_ver, site, trade_naics
             FROM records ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "kind": r.get::<_, String>(1)?,
                "createdAt": r.get::<_, String>(2)?,
                "currentVersion": r.get::<_, i64>(3)?,
                "site": r.get::<_, Option<String>>(4)?,
                "tradeNaics": r.get::<_, Option<String>>(5)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<Value>>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// 05 Record + version history + audit-verify result.
pub fn get_record(conn: &Connection, id: &str) -> Result<RecordWithHistory, String> {
    let mut stmt = conn
        .prepare(
            "SELECT version, created_at, author, reason, transcript, narrative, fields_json, flags_json, status
             FROM record_versions WHERE record_id = ?1 ORDER BY version ASC",
        )
        .map_err(|e| e.to_string())?;
    let versions = stmt
        .query_map(params![id], |r| {
            Ok(json!({
                "version": r.get::<_, i64>(0)?,
                "createdAt": r.get::<_, String>(1)?,
                "author": r.get::<_, String>(2)?,
                "reason": r.get::<_, Option<String>>(3)?,
                "transcript": r.get::<_, Option<String>>(4)?,
                "narrative": r.get::<_, Option<String>>(5)?,
                "fieldsJson": r.get::<_, Option<String>>(6)?,
                "flagsJson": r.get::<_, Option<String>>(7)?,
                "status": r.get::<_, String>(8)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<Value>>>()
        .map_err(|e| e.to_string())?;

    if versions.is_empty() {
        return Err(format!("record not found: {id}"));
    }
    let audit_verified = audit::verify_db(conn)?;
    Ok(RecordWithHistory {
        id: id.to_string(),
        versions,
        audit_verified,
    })
}
