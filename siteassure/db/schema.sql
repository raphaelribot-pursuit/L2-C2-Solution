-- SiteAssure local store (SQLite). Single-device v1.
-- Append-only audit: records are versioned; nothing is overwritten or hard-deleted.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- One row per logical record (a daily log / JHA / inspection / incident).
CREATE TABLE IF NOT EXISTS records (
  id           TEXT PRIMARY KEY,        -- uuid
  kind         TEXT NOT NULL,           -- 'daily_log' | 'jha' | 'inspection' | 'incident'
  created_at   TEXT NOT NULL,           -- ISO-8601
  created_by   TEXT NOT NULL,           -- author id (single user in v1)
  current_ver  INTEGER NOT NULL DEFAULT 1,
  site         TEXT,
  trade_naics  TEXT                     -- e.g. '238160' -> drives OSHA flag context
);

-- Immutable snapshot of a record's content at each version. Never updated in place.
CREATE TABLE IF NOT EXISTS record_versions (
  record_id    TEXT NOT NULL REFERENCES records(id),
  version      INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  author       TEXT NOT NULL,
  reason       TEXT,                     -- why this amendment (required for version > 1)
  transcript   TEXT,                     -- raw on-device transcript (never rewritten)
  narrative    TEXT,                     -- cleaned / structured narrative
  fields_json  TEXT,                     -- structured fields (date/site/crew/trade/...)
  flags_json   TEXT,                     -- accepted / dismissed safety flags
  audio_path   TEXT,                     -- retained source audio (tamper-proof backup; never re-encoded in place)
  audio_sha256 TEXT,                     -- sha256 of the retained audio; also written to audit_log as a 'capture' entry
  status       TEXT NOT NULL DEFAULT 'final',  -- v2 hook: 'proposed' | 'approved' | 'rejected' | 'final' (single-user v1 = always 'final')
  PRIMARY KEY (record_id, version)
);

-- Append-only, hash-chained audit log. entry_hash = sha256(prev_hash + payload_hash),
-- so any edit/removal breaks the chain. Integrity is written & verified in Rust (audit.rs).
CREATE TABLE IF NOT EXISTS audit_log (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL,
  actor        TEXT NOT NULL,
  action       TEXT NOT NULL,            -- 'create' | 'amend' | 'flag_accept' | 'flag_dismiss' | 'capture' | 'export'
  role         TEXT,                     -- v2 hook: actor role 'author' | 'reviewer' | 'auditor' (single-user v1 = NULL / 'author')
  record_id    TEXT,
  version      INTEGER,
  payload_hash TEXT NOT NULL,            -- sha256 of this entry's canonical payload
  prev_hash    TEXT NOT NULL,            -- entry_hash of seq-1 ('' for the first entry)
  entry_hash   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_versions_record ON record_versions(record_id);
CREATE INDEX IF NOT EXISTS idx_audit_record    ON audit_log(record_id);
