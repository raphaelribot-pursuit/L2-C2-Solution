use std::path::Path;

use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::error::WisperError;
use crate::transcribe::TranscriptSegment;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS recordings (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  duration_ms   INTEGER,
  source        TEXT NOT NULL,
  source_url    TEXT,
  audio_path    TEXT,
  language      TEXT,
  model_id      TEXT
);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id            INTEGER PRIMARY KEY,
  recording_id  TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  start_ms      INTEGER NOT NULL,
  end_ms        INTEGER NOT NULL,
  text          TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts USING fts5(
  recording_id UNINDEXED,
  text,
  content='transcript_segments',
  content_rowid='id'
);

CREATE TABLE IF NOT EXISTS tags (
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  tag          TEXT NOT NULL,
  PRIMARY KEY (recording_id, tag)
);
"#;

const FTS_TRIGGERS: &str = r#"
CREATE TRIGGER IF NOT EXISTS transcript_segments_ai AFTER INSERT ON transcript_segments BEGIN
  INSERT INTO transcripts_fts(rowid, recording_id, text)
  VALUES (new.id, new.recording_id, new.text);
END;

CREATE TRIGGER IF NOT EXISTS transcript_segments_ad AFTER DELETE ON transcript_segments BEGIN
  INSERT INTO transcripts_fts(transcripts_fts, rowid, recording_id, text)
  VALUES ('delete', old.id, old.recording_id, old.text);
END;

CREATE TRIGGER IF NOT EXISTS transcript_segments_au AFTER UPDATE ON transcript_segments BEGIN
  INSERT INTO transcripts_fts(transcripts_fts, rowid, recording_id, text)
  VALUES ('delete', old.id, old.recording_id, old.text);
  INSERT INTO transcripts_fts(rowid, recording_id, text)
  VALUES (new.id, new.recording_id, new.text);
END;
"#;

const SCHEMA_VERSION: i32 = 3;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RecordingSummary {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub duration_ms: Option<i64>,
    pub source: String,
    pub source_url: Option<String>,
    pub media_path: Option<String>,
    pub is_video: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordingSource {
    Mic,
    Import,
    Url,
}

impl RecordingSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mic => "mic",
            Self::Import => "import",
            Self::Url => "url",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "mic" => Some(Self::Mic),
            "import" => Some(Self::Import),
            "url" => Some(Self::Url),
            _ => None,
        }
    }
}

pub struct Storage {
    conn: Connection,
}

impl Storage {
    pub fn open(db_path: &Path) -> Result<Self, WisperError> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| WisperError::Storage(e.to_string()))?;
        }
        let conn = Connection::open(db_path).map_err(|e| WisperError::Storage(e.to_string()))?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|e| WisperError::Storage(e.to_string()))?;
        conn.execute_batch(SCHEMA)
            .map_err(|e| WisperError::Storage(e.to_string()))?;
        let storage = Self { conn };
        storage.migrate()?;
        Ok(storage)
    }

    fn migrate(&self) -> Result<(), WisperError> {
        let version: i32 = self
            .conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap_or(0);

        if version < 2 {
            self.conn
                .execute_batch(FTS_TRIGGERS)
                .map_err(|e| WisperError::Storage(e.to_string()))?;
            self.conn
                .execute("INSERT INTO transcripts_fts(transcripts_fts) VALUES('rebuild')", [])
                .map_err(|e| WisperError::Storage(e.to_string()))?;
        }

        if version < 3 {
            let _ = self.conn.execute(
                "ALTER TABLE transcript_segments ADD COLUMN speaker TEXT",
                [],
            );
            let _ = self.conn.execute(
                "ALTER TABLE transcript_segments ADD COLUMN words_json TEXT",
                [],
            );
        }

        if version < SCHEMA_VERSION {
            self.conn
                .execute(&format!("PRAGMA user_version = {SCHEMA_VERSION}"), [])
                .map_err(|e| WisperError::Storage(e.to_string()))?;
        }

        Ok(())
    }

    fn is_video_path(path: &str) -> bool {
        let ext = Path::new(path)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase());
        matches!(
            ext.as_deref(),
            Some("mp4") | Some("mov") | Some("mkv") | Some("webm") | Some("m4v")
        )
    }

    fn summary_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RecordingSummary> {
        let media_path: Option<String> = row.get(6)?;
        let is_video = media_path
            .as_deref()
            .is_some_and(Self::is_video_path);
        Ok(RecordingSummary {
            id: row.get(0)?,
            title: row.get(1)?,
            created_at: row.get(2)?,
            duration_ms: row.get(3)?,
            source: row.get(4)?,
            source_url: row.get(5)?,
            media_path,
            is_video,
        })
    }

    pub fn save_transcript(
        &self,
        source: RecordingSource,
        title: &str,
        audio_path: &Path,
        source_url: Option<&str>,
        language: Option<&str>,
        model_id: Option<&str>,
        segments: &[TranscriptSegment],
    ) -> Result<String, WisperError> {
        let id = Uuid::new_v4().to_string();
        let created_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let duration_ms = segments.iter().map(|s| s.end_ms).max();

        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|e| WisperError::Storage(e.to_string()))?;

        tx.execute(
            "INSERT INTO recordings (id, title, created_at, duration_ms, source, source_url, audio_path, language, model_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id,
                title,
                created_at,
                duration_ms,
                source.as_str(),
                source_url,
                audio_path.to_string_lossy(),
                language,
                model_id,
            ],
        )
        .map_err(|e| WisperError::Storage(e.to_string()))?;

        for seg in segments {
            let words_json = seg
                .words
                .as_ref()
                .and_then(|words| serde_json::to_string(words).ok());
            tx.execute(
                "INSERT INTO transcript_segments (recording_id, start_ms, end_ms, text, speaker, words_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![id, seg.start_ms, seg.end_ms, seg.text, seg.speaker, words_json],
            )
            .map_err(|e| WisperError::Storage(e.to_string()))?;
        }

        tx.commit()
            .map_err(|e| WisperError::Storage(e.to_string()))?;

        Ok(id)
    }

    pub fn save_import_transcript(
        &self,
        title: &str,
        audio_path: &Path,
        language: Option<&str>,
        model_id: Option<&str>,
        segments: &[TranscriptSegment],
    ) -> Result<String, WisperError> {
        self.save_transcript(
            RecordingSource::Import,
            title,
            audio_path,
            None,
            language,
            model_id,
            segments,
        )
    }

    pub fn list_recordings(&self) -> Result<Vec<RecordingSummary>, WisperError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, title, created_at, duration_ms, source, source_url, audio_path
                 FROM recordings
                 ORDER BY created_at DESC",
            )
            .map_err(|e| WisperError::Storage(e.to_string()))?;

        let rows = stmt
            .query_map([], Self::summary_from_row)
            .map_err(|e| WisperError::Storage(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| WisperError::Storage(e.to_string()))
    }

    pub fn get_media_path(&self, recording_id: &str) -> Result<Option<String>, WisperError> {
        self.conn
            .query_row(
                "SELECT audio_path FROM recordings WHERE id = ?1",
                params![recording_id],
                |row| row.get(0),
            )
            .map_err(|e| WisperError::Storage(e.to_string()))
    }

    pub fn get_segments(&self, recording_id: &str) -> Result<Vec<TranscriptSegment>, WisperError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT start_ms, end_ms, text, speaker, words_json
                 FROM transcript_segments
                 WHERE recording_id = ?1
                 ORDER BY start_ms ASC, id ASC",
            )
            .map_err(|e| WisperError::Storage(e.to_string()))?;

        let rows = stmt
            .query_map(params![recording_id], |row| {
                let words_json: Option<String> = row.get(4)?;
                let words = words_json
                    .as_deref()
                    .and_then(|json| serde_json::from_str(json).ok());
                Ok(TranscriptSegment {
                    start_ms: row.get(0)?,
                    end_ms: row.get(1)?,
                    text: row.get(2)?,
                    speaker: row.get(3)?,
                    words,
                })
            })
            .map_err(|e| WisperError::Storage(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| WisperError::Storage(e.to_string()))
    }

    pub fn update_segment_text(&self, recording_id: &str, index: usize, text: &str) -> Result<(), WisperError> {
        let segment_id: i64 = self
            .conn
            .query_row(
                "SELECT id FROM transcript_segments
                 WHERE recording_id = ?1
                 ORDER BY start_ms ASC, id ASC
                 LIMIT 1 OFFSET ?2",
                params![recording_id, index as i64],
                |row| row.get(0),
            )
            .map_err(|e| WisperError::Storage(e.to_string()))?;

        self.conn
            .execute(
                "UPDATE transcript_segments SET text = ?1, words_json = NULL WHERE id = ?2 AND recording_id = ?3",
                params![text, segment_id, recording_id],
            )
            .map_err(|e| WisperError::Storage(e.to_string()))?;

        Ok(())
    }

    pub fn search_recordings(&self, query: &str) -> Result<Vec<RecordingSummary>, WisperError> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return self.list_recordings();
        }

        let escaped = trimmed.replace('"', "\"\"");
        let match_expr = format!("\"{escaped}\"*");

        let mut stmt = self
            .conn
            .prepare(
                "SELECT DISTINCT r.id, r.title, r.created_at, r.duration_ms, r.source, r.source_url, r.audio_path
                 FROM transcripts_fts
                 JOIN recordings r ON r.id = transcripts_fts.recording_id
                 WHERE transcripts_fts MATCH ?1
                 ORDER BY r.created_at DESC",
            )
            .map_err(|e| WisperError::Storage(e.to_string()))?;

        let rows = stmt
            .query_map(params![match_expr], Self::summary_from_row)
            .map_err(|e| WisperError::Storage(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| WisperError::Storage(e.to_string()))
    }

    pub fn delete_recording(
        &self,
        recording_id: &str,
        audio_root: Option<&Path>,
    ) -> Result<(), WisperError> {
        let audio_path: Option<String> = self
            .conn
            .query_row(
                "SELECT audio_path FROM recordings WHERE id = ?1",
                params![recording_id],
                |row| row.get(0),
            )
            .ok();

        let changed = self
            .conn
            .execute("DELETE FROM recordings WHERE id = ?1", params![recording_id])
            .map_err(|e| WisperError::Storage(e.to_string()))?;

        if changed == 0 {
            return Err(WisperError::Storage(format!(
                "recording not found: {recording_id}"
            )));
        }

        if let (Some(root), Some(path_str)) = (audio_root, audio_path) {
            let path = std::path::PathBuf::from(path_str);
            if path.starts_with(root) {
                let _ = std::fs::remove_file(path);
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcribe::TranscriptSegment;
    use uuid::Uuid;

    fn temp_storage() -> (Storage, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("wisper-storage-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let db = dir.join("test.db");
        let storage = Storage::open(&db).expect("open storage");
        (storage, dir)
    }

    #[test]
    fn search_finds_matching_segment_text() {
        let (storage, dir) = temp_storage();
        let id = storage
            .save_transcript(
                RecordingSource::Mic,
                "Meeting notes",
                std::path::Path::new("audio/test.wav"),
                None,
                None,
                None,
                &[TranscriptSegment {
                    start_ms: 0,
                    end_ms: 1000,
                    text: "quarterly revenue increased".into(),
                    speaker: None,
                    words: None,
                }],
            )
            .expect("save");

        let hits = storage
            .search_recordings("revenue")
            .expect("search should succeed");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, id);

        let miss = storage.search_recordings("nonexistent").expect("search");
        assert!(miss.is_empty());

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn delete_recording_removes_row_and_segments() {
        let (storage, dir) = temp_storage();
        let audio_dir = dir.join("audio");
        std::fs::create_dir_all(&audio_dir).expect("audio dir");
        let audio_file = audio_dir.join("clip.wav");
        std::fs::write(&audio_file, b"fake").expect("audio file");

        let id = storage
            .save_transcript(
                RecordingSource::Import,
                "Clip",
                &audio_file,
                None,
                None,
                None,
                &[TranscriptSegment {
                    start_ms: 0,
                    end_ms: 500,
                    text: "hello".into(),
                    speaker: None,
                    words: None,
                }],
            )
            .expect("save");

        storage
            .delete_recording(&id, Some(&audio_dir))
            .expect("delete");

        assert!(storage.list_recordings().unwrap().is_empty());
        assert!(storage.get_segments(&id).unwrap().is_empty());
        assert!(!audio_file.exists());

        let _ = std::fs::remove_dir_all(dir);
    }
}
