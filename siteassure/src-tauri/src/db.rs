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

/// Open (or create) the store and apply the schema.
pub fn open(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    Ok(conn)
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

/// 01 Records list (newest first). Reads only non-secret columns (id/kind/time/site/trade).
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

/// 05 Record + decrypted version history + audit-verify result.
pub fn get_record(conn: &Connection, key: &[u8; 32], id: &str) -> Result<RecordWithHistory, String> {
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
        versions,
        audit_verified,
    })
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
}
