//! SQLite store. Applies db/schema.sql on first run. Every record write goes through here,
//! and every create/amend appends exactly one audit_log entry via audit::append (the sole writer).
//! Sensitive content columns (transcript / narrative / fields_json) are encrypted at rest
//! (AES-256-GCM, see crypto.rs); the audit chain hashes the PLAINTEXT so integrity is over real content.
use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use crate::commands::{NewRecord, RecordWithHistory};
use crate::{audit, crypto};

pub const SCHEMA: &str = include_str!("../../db/schema.sql");

/// Managed Tauri state: the SQLite connection (serialized) + the at-rest content key.
pub struct Db {
    pub conn: std::sync::Mutex<Connection>,
    pub key: [u8; 32],
}

const ACTOR: &str = "local"; // single user in v1

/// Open (or create) the store, apply the schema, then run idempotent migrations that add
/// columns the shipped schema.sql doesn't yet have (avoids needing a hand-authored migration
/// framework for a single-user, single-file SQLite store).
pub fn open(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    migrate(&conn)?;
    Ok(conn)
}

/// Adds the `voided*` columns to `records` if they're not already there. Safe to run on every
/// startup — checks PRAGMA table_info first rather than relying on `ADD COLUMN IF NOT EXISTS`,
/// which needs a newer SQLite than we want to assume is bundled everywhere.
fn migrate(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(records)")
        .map_err(|e| e.to_string())?;
    let cols: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<String>>>()
        .map_err(|e| e.to_string())?;

    if !cols.iter().any(|c| c == "voided") {
        conn.execute_batch(
            "ALTER TABLE records ADD COLUMN voided INTEGER NOT NULL DEFAULT 0;
             ALTER TABLE records ADD COLUMN voided_at TEXT;
             ALTER TABLE records ADD COLUMN voided_by TEXT;
             ALTER TABLE records ADD COLUMN voided_reason TEXT;",
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn enc(key: &[u8; 32], s: &str) -> Result<String, String> {
    crypto::encrypt(key, s)
}
fn dec_opt(key: &[u8; 32], s: Option<String>) -> Result<Option<String>, String> {
    match s {
        Some(v) => Ok(Some(crypto::decrypt(key, &v)?)),
        None => Ok(None),
    }
}

/// 03 Save: insert the record + version 1 (content encrypted), then append the 'create' audit entry
/// (over plaintext) and a 'capture' entry binding the retained-audio hash. Returns the new id.
pub fn save_record(conn: &Connection, key: &[u8; 32], rec: &NewRecord, now: &str) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();

    // Hash the retained source audio (the tamper-proof backup), if one was captured.
    let audio_sha256 = match rec.audio_path.as_deref() {
        Some(p) if !p.is_empty() => {
            let bytes = std::fs::read(p).map_err(|e| format!("read audio {p}: {e}"))?;
            Some(audit::sha256_hex(&bytes))
        }
        _ => None,
    };

    conn.execute(
        "INSERT INTO records (id, kind, created_at, created_by, current_ver, site, trade_naics)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)",
        params![id, rec.kind, now, ACTOR, rec.site, rec.trade_naics],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO record_versions
           (record_id, version, created_at, author, reason, transcript, narrative, fields_json, flags_json, audio_path, audio_sha256, status)
         VALUES (?1, 1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, ?8, ?9, 'final')",
        params![
            id, now, ACTOR,
            enc(key, &rec.transcript)?,
            enc(key, &rec.narrative)?,
            enc(key, &rec.fields_json)?,
            rec.flags_json,            // safety codes, not PII — stored plain
            rec.audio_path, audio_sha256
        ],
    )
    .map_err(|e| e.to_string())?;

    // 'create' audit entry — hashes the PLAINTEXT content.
    let payload = json!({
        "record_id": id, "version": 1, "kind": rec.kind,
        "transcript": rec.transcript, "narrative": rec.narrative,
        "fields": rec.fields_json, "flags": rec.flags_json,
    })
    .to_string();
    audit::append(conn, now, ACTOR, Some("author"), "create", Some(id.as_str()), Some(1), payload.as_bytes())?;

    // 'capture' audit entry — binds the retained audio's hash into the SAME chain.
    if let Some(ref h) = audio_sha256 {
        let cap = json!({ "record_id": id, "version": 1, "audio_sha256": h }).to_string();
        audit::append(conn, now, ACTOR, Some("author"), "capture", Some(id.as_str()), Some(1), cap.as_bytes())?;
    }

    Ok(id)
}

/// 01 Records list (newest first). Reads only non-secret columns (id/kind/time/site/trade),
/// plus `voided` so callers can filter deleted records out of normal views.
pub fn list_records(conn: &Connection) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, kind, created_at, current_ver, site, trade_naics, voided
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
                "voided": r.get::<_, i64>(6)? != 0,
            }))
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<Value>>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// 05 Record + decrypted version history + audit-verify result. Also returns the top-level
/// record metadata (kind/createdAt/createdBy/currentVersion/voided*) from the `records` row —
/// previously this only returned id/versions/auditVerified, which left the frontend guessing
/// `kind` out of versions[0] as a workaround.
pub fn get_record(conn: &Connection, key: &[u8; 32], id: &str) -> Result<RecordWithHistory, String> {
    type HeadRow = (String, String, String, i64, i64, Option<String>, Option<String>, Option<String>);
    let (kind, created_at_head, created_by, current_ver, voided, voided_at, voided_by, voided_reason): HeadRow = conn
        .query_row(
            "SELECT kind, created_at, created_by, current_ver, voided, voided_at, voided_by, voided_reason
             FROM records WHERE id = ?1",
            params![id],
            |r| {
                Ok((
                    r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?,
                    r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("record not found: {id}"))?;

    let mut stmt = conn
        .prepare(
            "SELECT version, created_at, author, reason, transcript, narrative, fields_json, flags_json, status
             FROM record_versions WHERE record_id = ?1 ORDER BY version ASC",
        )
        .map_err(|e| e.to_string())?;
    type Row = (i64, String, String, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, String);
    let raw: Vec<Row> = stmt
        .query_map(params![id], |r| {
            Ok((
                r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?,
                r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<Row>>>()
        .map_err(|e| e.to_string())?;

    if raw.is_empty() {
        return Err(format!("record not found: {id}"));
    }

    let mut versions = Vec::with_capacity(raw.len());
    for (version, created_at, author, reason, transcript, narrative, fields_json, flags_json, status) in raw {
        versions.push(json!({
            "version": version,
            "createdAt": created_at,
            "author": author,
            "reason": reason,
            "transcript": dec_opt(key, transcript)?,
            "narrative": dec_opt(key, narrative)?,
            "fieldsJson": dec_opt(key, fields_json)?,
            "flagsJson": flags_json, // plain
            "status": status,
        }));
    }

    let audit_verified = audit::verify_db(conn)?;
    Ok(RecordWithHistory {
        id: id.to_string(),
        kind,
        created_at: created_at_head,
        created_by,
        current_version: current_ver,
        versions,
        audit_verified,
        voided: voided != 0,
        voided_at,
        voided_by,
        voided_reason,
    })
}

/// Soft-delete: marks a record voided (never removes rows, versions, or audit entries — the
/// record stays fully readable via get_record). A reason is required, and the deletion itself
/// is appended to the SAME hash chain as create/amend, so it's just as tamper-evident.
pub fn void_record(conn: &Connection, id: &str, reason: &str, now: &str) -> Result<(), String> {
    if reason.trim().is_empty() {
        return Err("a reason is required to delete a record".into());
    }

    let already_voided: i64 = conn
        .query_row("SELECT voided FROM records WHERE id = ?1", params![id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("record not found: {id}"))?;
    if already_voided != 0 {
        return Err("record is already deleted".into());
    }

    conn.execute(
        "UPDATE records SET voided = 1, voided_at = ?1, voided_by = ?2, voided_reason = ?3 WHERE id = ?4",
        params![now, ACTOR, reason, id],
    )
    .map_err(|e| e.to_string())?;

    let payload = json!({ "record_id": id, "reason": reason }).to_string();
    audit::append(conn, now, ACTOR, Some("author"), "void", Some(id), None, payload.as_bytes())?;

    Ok(())
}

/// 05 Amend: write a NEW version (prior preserved, raw transcript immutable), bump current_ver,
/// and append the 'amend' audit entry (over plaintext). A reason is required. `changes` may carry
/// camelCase keys `narrative` / `fieldsJson` / `flagsJson`; omitted keys carry forward.
pub fn amend_record(
    conn: &Connection,
    key: &[u8; 32],
    id: &str,
    changes: &Value,
    reason: &str,
    now: &str,
) -> Result<i64, String> {
    if reason.trim().is_empty() {
        return Err("an amendment reason is required".into());
    }

    let (cur_ver, enc_transcript, enc_narrative, enc_fields, flags_json): (
        i64,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = conn
        .query_row(
            "SELECT version, transcript, narrative, fields_json, flags_json
             FROM record_versions WHERE record_id = ?1 ORDER BY version DESC LIMIT 1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("record not found: {id}"))?;

    // Decrypt the prior content, then apply only the supplied keys (raw transcript never changes).
    let prior_transcript = dec_opt(key, enc_transcript)?;
    let prior_narrative = dec_opt(key, enc_narrative)?;
    let prior_fields = dec_opt(key, enc_fields)?;

    let apply = |k: &str, prior: Option<String>| -> Option<String> {
        changes.get(k).and_then(|v| v.as_str()).map(|s| s.to_string()).or(prior)
    };
    let new_narrative = apply("narrative", prior_narrative);
    let new_fields = apply("fieldsJson", prior_fields);
    let new_flags = apply("flagsJson", flags_json);
    let new_ver = cur_ver + 1;

    // Re-encrypt content for storage (transcript carries forward unchanged).
    let enc_t = match &prior_transcript {
        Some(s) => Some(enc(key, s)?),
        None => None,
    };
    let enc_n = match &new_narrative {
        Some(s) => Some(enc(key, s)?),
        None => None,
    };
    let enc_f = match &new_fields {
        Some(s) => Some(enc(key, s)?),
        None => None,
    };

    conn.execute(
        "INSERT INTO record_versions
           (record_id, version, created_at, author, reason, transcript, narrative, fields_json, flags_json, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'final')",
        params![id, new_ver, now, ACTOR, reason, enc_t, enc_n, enc_f, new_flags],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE records SET current_ver = ?1 WHERE id = ?2",
        params![new_ver, id],
    )
    .map_err(|e| e.to_string())?;

    let payload = json!({
        "record_id": id, "version": new_ver, "reason": reason,
        "narrative": new_narrative, "fields": new_fields, "flags": new_flags,
    })
    .to_string();
    audit::append(conn, now, ACTOR, Some("author"), "amend", Some(id), Some(new_ver), payload.as_bytes())?;

    Ok(new_ver)
}

/// Audit tab: recent chain entries, newest first, capped at `limit`. Read-only — audit_log
/// itself is only ever written by audit::append (see audit.rs doc comment).
pub fn list_audit_log(conn: &Connection, limit: i64) -> Result<Vec<audit::AuditEntry>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT seq, ts, actor, action, record_id, version, payload_hash, prev_hash, entry_hash
             FROM audit_log ORDER BY seq DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![limit], |r| {
            Ok(audit::AuditEntry {
                seq: r.get(0)?,
                ts: r.get(1)?,
                actor: r.get(2)?,
                action: r.get(3)?,
                record_id: r.get(4)?,
                version: r.get(5)?,
                payload_hash: r.get(6)?,
                prev_hash: r.get(7)?,
                entry_hash: r.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Audit tab: re-verifies the whole chain (audit::verify_db) and reports the head anchor
/// (count/last_hash/updated_at) so the UI can show "verified" plus a summary readout.
pub fn audit_status(conn: &Connection) -> Result<crate::commands::AuditStatus, String> {
    let verified = audit::verify_db(conn)?;
    let (count, last_hash, updated_at): (i64, String, String) = conn
        .query_row(
            "SELECT count, last_hash, updated_at FROM audit_head WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or((0, String::new(), String::new()));
    Ok(crate::commands::AuditStatus { verified, count, last_hash, updated_at })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::NewRecord;

    const KEY: [u8; 32] = [42u8; 32];

    fn mem() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(SCHEMA).unwrap();
        c
    }

    fn sample() -> NewRecord {
        NewRecord {
            kind: "daily_log".into(),
            site: Some("Site A".into()),
            trade_naics: Some("238160".into()),
            transcript: "raw spoken words".into(),
            narrative: "clean narrative".into(),
            fields_json: "{}".into(),
            flags_json: "[]".into(),
            audio_path: None,
        }
    }

    #[test]
    fn save_then_amend_preserves_prior_and_verifies() {
        let c = mem();
        let id = save_record(&c, &KEY, &sample(), "2026-01-01T00:00:00Z").unwrap();
        let v2 = amend_record(&c, &KEY, &id, &json!({ "narrative": "corrected narrative" }), "fix a typo", "2026-01-02T00:00:00Z").unwrap();
        assert_eq!(v2, 2);

        let rwh = get_record(&c, &KEY, &id).unwrap();
        assert_eq!(rwh.versions.len(), 2);
        // Raw transcript is immutable across versions (decrypts to the same plaintext).
        assert_eq!(rwh.versions[0]["transcript"], "raw spoken words");
        assert_eq!(rwh.versions[1]["transcript"], "raw spoken words");
        assert_eq!(rwh.versions[1]["narrative"], "corrected narrative");
        assert!(rwh.audit_verified);
    }

    #[test]
    fn content_is_encrypted_at_rest() {
        let c = mem();
        let id = save_record(&c, &KEY, &sample(), "t").unwrap();
        let stored: String = c
            .query_row("SELECT transcript FROM record_versions WHERE record_id = ?1", params![id], |r| r.get(0))
            .unwrap();
        assert_ne!(stored, "raw spoken words"); // ciphertext on disk
        assert_eq!(crypto::decrypt(&KEY, &stored).unwrap(), "raw spoken words");
    }

    #[test]
    fn amend_requires_a_reason() {
        let c = mem();
        let id = save_record(&c, &KEY, &sample(), "t").unwrap();
        assert!(amend_record(&c, &KEY, &id, &json!({}), "   ", "t").is_err());
    }

    #[test]
    fn tampering_a_stored_row_breaks_verify() {
        let c = mem();
        let id = save_record(&c, &KEY, &sample(), "t").unwrap();
        c.execute("UPDATE audit_log SET payload_hash = 'deadbeef' WHERE record_id = ?1", params![id]).unwrap();
        assert!(!audit::verify_db(&c).unwrap());
    }

    #[test]
    fn save_with_audio_hashes_it_into_the_chain() {
        let c = mem();
        // nosemgrep: rust.lang.security.temp-dir.temp-dir -- test-only fixture, unique uuid filename
        let path = std::env::temp_dir().join(format!("siteassure_test_{}.wav", uuid::Uuid::new_v4()));
        std::fs::write(&path, b"FAKE WAV BYTES").unwrap();

        let mut rec = sample();
        rec.audio_path = Some(path.to_string_lossy().into_owned());
        let id = save_record(&c, &KEY, &rec, "t").unwrap();

        let stored: String = c
            .query_row("SELECT audio_sha256 FROM record_versions WHERE record_id = ?1", params![id], |r| r.get(0))
            .unwrap();
        assert_eq!(stored, audit::sha256_hex(b"FAKE WAV BYTES"));
        let captures: i64 = c
            .query_row("SELECT COUNT(*) FROM audit_log WHERE action = 'capture' AND record_id = ?1", params![id], |r| r.get(0))
            .unwrap();
        assert_eq!(captures, 1);
        assert!(audit::verify_db(&c).unwrap());

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn void_record_soft_deletes_and_preserves_audit_chain() {
        let c = mem();
        let id = save_record(&c, &KEY, &sample(), "2026-01-01T00:00:00Z").unwrap();
        void_record(&c, &id, "duplicate entry", "2026-01-02T00:00:00Z").unwrap();

        // Nothing was removed — the record and its versions are still fully readable.
        let rwh = get_record(&c, &KEY, &id).unwrap();
        assert!(rwh.voided);
        assert_eq!(rwh.voided_reason.as_deref(), Some("duplicate entry"));
        assert_eq!(rwh.versions.len(), 1);
        assert!(audit::verify_db(&c).unwrap());

        // The 'void' action landed in the same hash chain as 'create'.
        let voided_actions: i64 = c
            .query_row("SELECT COUNT(*) FROM audit_log WHERE action = 'void' AND record_id = ?1", params![id], |r| r.get(0))
            .unwrap();
        assert_eq!(voided_actions, 1);
    }

    #[test]
    fn void_record_requires_a_reason() {
        let c = mem();
        let id = save_record(&c, &KEY, &sample(), "t").unwrap();
        assert!(void_record(&c, &id, "   ", "t").is_err());
    }

    #[test]
    fn void_record_cannot_be_applied_twice() {
        let c = mem();
        let id = save_record(&c, &KEY, &sample(), "t").unwrap();
        void_record(&c, &id, "test", "t").unwrap();
        assert!(void_record(&c, &id, "test again", "t2").is_err());
    }

    #[test]
    fn list_records_reports_voided_flag() {
        let c = mem();
        let id = save_record(&c, &KEY, &sample(), "t").unwrap();
        let before = list_records(&c).unwrap();
        assert_eq!(before[0]["voided"], false);

        void_record(&c, &id, "test", "t2").unwrap();
        let after = list_records(&c).unwrap();
        assert_eq!(after[0]["voided"], true);
    }
}
