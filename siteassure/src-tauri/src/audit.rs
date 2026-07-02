//! Append-only, hash-chained audit log. The tamper-evidence guarantee lives here.
//! This is the ONLY writer of audit_log (and audit_head).
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub seq: i64,
    pub ts: String,
    pub actor: String,
    pub action: String,
    pub record_id: Option<String>,
    pub version: Option<i64>,
    pub payload_hash: String,
    pub prev_hash: String,
    pub entry_hash: String,
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    hex::encode(h.finalize())
}

/// entry_hash given the previous entry's entry_hash and this entry's payload hash.
pub fn chain_hash(prev_hash: &str, payload_hash: &str) -> String {
    sha256_hex(format!("{prev_hash}{payload_hash}").as_bytes())
}

/// Append one entry to the chain — the ONLY way to write the audit log. Reads the current head,
/// links the new entry (entry_hash = sha256(prev_hash + payload_hash)), persists it, and updates
/// the head anchor, all on the caller's connection.
#[allow(clippy::too_many_arguments)]
pub fn append(
    conn: &Connection,
    ts: &str,
    actor: &str,
    role: Option<&str>,
    action: &str,
    record_id: Option<&str>,
    version: Option<i64>,
    payload: &[u8],
) -> Result<AuditEntry, String> {
    let prev: String = conn
        .query_row(
            "SELECT entry_hash FROM audit_log ORDER BY seq DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or_default();

    let payload_hash = sha256_hex(payload);
    let entry_hash = chain_hash(&prev, &payload_hash);

    conn.execute(
        "INSERT INTO audit_log
           (ts, actor, action, role, record_id, version, payload_hash, prev_hash, entry_hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![ts, actor, action, role, record_id, version, payload_hash, prev, entry_hash],
    )
    .map_err(|e| e.to_string())?;
    let seq = conn.last_insert_rowid();

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO audit_head (id, count, last_hash, updated_at) VALUES (1, ?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET count = ?1, last_hash = ?2, updated_at = ?3",
        params![count, entry_hash, ts],
    )
    .map_err(|e| e.to_string())?;

    Ok(AuditEntry {
        seq,
        ts: ts.to_string(),
        actor: actor.to_string(),
        action: action.to_string(),
        record_id: record_id.map(|s| s.to_string()),
        version,
        payload_hash,
        prev_hash: prev,
        entry_hash,
    })
}

/// Re-walk the whole stored chain and confirm nothing was altered, reordered, or truncated.
/// Powers the "Audit verified — no tampering detected" badge on screen 05.
pub fn verify_db(conn: &Connection) -> Result<bool, String> {
    let mut stmt = conn
        .prepare("SELECT payload_hash, prev_hash, entry_hash FROM audit_log ORDER BY seq ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut prev = String::new();
    let mut count: i64 = 0;
    let mut last = String::new();
    for row in rows {
        let (payload_hash, prev_hash, entry_hash) = row.map_err(|e| e.to_string())?;
        if prev_hash != prev {
            return Ok(false); // stored prev_hash must match the running chain
        }
        if chain_hash(&prev, &payload_hash) != entry_hash {
            return Ok(false); // entry_hash recomputation must match
        }
        prev = entry_hash.clone();
        last = entry_hash;
        count += 1;
    }

    // Head anchor: count + last_hash must match, else rows were truncated from the end.
    if let Some((hc, hh)) = conn
        .query_row(
            "SELECT count, last_hash FROM audit_head WHERE id = 1",
            [],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?
    {
        if hc != count || hh != last {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Pure-data verify over an in-memory slice — test-only (production uses `verify_db`).
#[cfg(test)]
pub fn verify(entries: &[AuditEntry]) -> bool {
    let mut prev = String::new();
    for e in entries {
        if e.prev_hash != prev {
            return false;
        }
        if chain_hash(&prev, &e.payload_hash) != e.entry_hash {
            return false;
        }
        prev = e.entry_hash.clone();
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(prev: &str, payload: &str) -> AuditEntry {
        let payload_hash = sha256_hex(payload.as_bytes());
        let entry_hash = chain_hash(prev, &payload_hash);
        AuditEntry {
            seq: 0,
            ts: String::new(),
            actor: String::new(),
            action: String::new(),
            record_id: None,
            version: None,
            payload_hash,
            prev_hash: prev.to_string(),
            entry_hash,
        }
    }

    #[test]
    fn good_chain_verifies() {
        let e1 = entry("", "create v1");
        let e2 = entry(&e1.entry_hash, "amend v2");
        assert!(verify(&[e1, e2]));
    }

    #[test]
    fn tampered_payload_fails() {
        let e1 = entry("", "create v1");
        let mut e2 = entry(&e1.entry_hash, "amend v2");
        e2.payload_hash = sha256_hex(b"forged content"); // entry_hash is now stale
        assert!(!verify(&[e1, e2]));
    }

    #[test]
    fn removed_middle_entry_fails() {
        let e1 = entry("", "a");
        let e2 = entry(&e1.entry_hash, "b");
        let e3 = entry(&e2.entry_hash, "c");
        assert!(!verify(&[e1, e3])); // e3.prev_hash points to the dropped e2
    }
}
