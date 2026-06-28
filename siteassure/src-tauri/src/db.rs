//! SQLite store. Applies db/schema.sql on first run.
//! TODO(build): open a rusqlite connection under the app data dir, run execute_batch(SCHEMA),
//! and expose helpers used by commands.rs (insert_record, insert_version, list, get_with_history).
pub const SCHEMA: &str = include_str!("../../db/schema.sql");
