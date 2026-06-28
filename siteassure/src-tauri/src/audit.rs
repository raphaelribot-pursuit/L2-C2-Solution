//! Append-only, hash-chained audit log. The tamper-evidence guarantee lives here.
//! Keep this the ONLY writer of audit_log. TODO(build): wire to db.rs (rusqlite).
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Serialize, Deserialize, Clone)]
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

/// Compute the hashes for a new entry. TODO(build): persist via db.rs and return the stored row.
pub fn next_hashes(prev_entry_hash: &str, payload: &[u8]) -> (String, String) {
    let payload_hash = sha256_hex(payload);
    let entry_hash = chain_hash(prev_entry_hash, &payload_hash);
    (payload_hash, entry_hash)
}

/// Re-walk the chain and confirm nothing was altered or removed.
/// Powers the "Audit verified — no tampering detected" badge on screen 05.
pub fn verify(entries: &[AuditEntry]) -> bool {
    let mut prev = String::new();
    for e in entries {
        if chain_hash(&prev, &e.payload_hash) != e.entry_hash {
            return false;
        }
        prev = e.entry_hash.clone();
    }
    true
}
