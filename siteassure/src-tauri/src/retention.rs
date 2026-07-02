//! Data-minimization for the retained source WAV. A voice recording is PII, but its integrity
//! hash (audio_sha256) is written into the audit chain at save time and kept forever — so the
//! recording itself doesn't need to linger. After a retention window we purge the audio files.
//! "Prove it" still holds: the hash proves what was captured, and any audio produced later must
//! match it.
//! ponytail: encrypting the WAV at rest is the heavier alternative — it needs a decrypt-to-temp
//! step in the transcribe path (wisper reads the file directly). Deferred; retention-limiting is
//! the low-risk minimization we take now. Bump RETENTION_DAYS or make it a setting if needed.
use std::path::Path;
use std::time::{Duration, SystemTime};

/// How long a captured WAV is kept on disk before it's purged. The audit-chain hash is permanent.
pub const RETENTION_DAYS: u64 = 30;

/// A file is expired when it is older than `max_age` relative to `now`. Pure → unit-testable.
/// A clock skew that puts `modified` in the future reads as "not expired" (keep it).
pub fn is_expired(modified: SystemTime, now: SystemTime, max_age: Duration) -> bool {
    now.duration_since(modified).map(|age| age > max_age).unwrap_or(false)
}

/// Delete `*.wav` files in `dir` older than `max_age`. Best-effort (ignores unreadable entries and
/// failed deletes); returns how many were removed. Never touches the audit DB — the stored
/// audio_sha256 is the permanent record of what was captured.
pub fn purge_old_audio(dir: &Path, max_age: Duration, now: SystemTime) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    let mut removed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("wav") {
            continue;
        }
        let Ok(modified) = entry.metadata().and_then(|m| m.modified()) else { continue };
        if is_expired(modified, now, max_age) && std::fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expired_only_past_the_window() {
        let day = Duration::from_secs(86_400);
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(100 * 86_400);
        assert!(!is_expired(now - 5 * day, now, 30 * day)); // fresh — keep
        assert!(is_expired(now - 40 * day, now, 30 * day)); // stale — purge
    }

    #[test]
    fn purge_removes_only_old_wavs() {
        // nosemgrep: rust.lang.security.temp-dir.temp-dir -- test-only fixture, unique uuid dir
        let dir = std::env::temp_dir().join(format!("siteassure_ret_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.wav"), b"x").unwrap();
        std::fs::write(dir.join("b.wav"), b"y").unwrap();
        std::fs::write(dir.join("keep.txt"), b"z").unwrap();

        // Treat "now" as 100 days ahead, so the just-written wavs are well past a 30-day window.
        let future = SystemTime::now() + Duration::from_secs(100 * 86_400);
        let removed = purge_old_audio(&dir, Duration::from_secs(30 * 86_400), future);

        assert_eq!(removed, 2); // both wavs purged
        assert!(dir.join("keep.txt").exists()); // non-wav untouched
        assert!(!dir.join("a.wav").exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn missing_dir_is_noop() {
        assert_eq!(purge_old_audio(Path::new("/no/such/siteassure/dir"), Duration::from_secs(1), SystemTime::now()), 0);
    }
}
