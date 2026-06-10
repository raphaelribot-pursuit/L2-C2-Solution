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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RecordingSummary {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub duration_ms: Option<i64>,
    pub source: String,
    pub source_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordingSource {
    Mic,
    Import,
    Url,
}

impl RecordingSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Mic => "mic",
            Self::Import => "import",
            Self::Url => "url",
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
        Ok(Self { conn })
    }

    pub fn save_import_transcript(
        &self,
        title: &str,
        audio_path: &Path,
        language: Option<&str>,
        model_id: Option<&str>,
        segments: &[TranscriptSegment],
    ) -> Result<String, WisperError> {
        let id = Uuid::new_v4().to_string();
        let created_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let duration_ms = segments.last().map(|s| s.end_ms);

        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|e| WisperError::Storage(e.to_string()))?;

        tx.execute(
            "INSERT INTO recordings (id, title, created_at, duration_ms, source, source_url, audio_path, language, model_id)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8)",
            params![
                id,
                title,
                created_at,
                duration_ms,
                RecordingSource::Import.as_str(),
                audio_path.to_string_lossy(),
                language,
                model_id,
            ],
        )
        .map_err(|e| WisperError::Storage(e.to_string()))?;

        for seg in segments {
            tx.execute(
                "INSERT INTO transcript_segments (recording_id, start_ms, end_ms, text)
                 VALUES (?1, ?2, ?3, ?4)",
                params![id, seg.start_ms, seg.end_ms, seg.text],
            )
            .map_err(|e| WisperError::Storage(e.to_string()))?;
        }

        tx.commit()
            .map_err(|e| WisperError::Storage(e.to_string()))?;

        Ok(id)
    }

    pub fn list_recordings(&self) -> Result<Vec<RecordingSummary>, WisperError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, title, created_at, duration_ms, source, source_url
                 FROM recordings
                 ORDER BY created_at DESC",
            )
            .map_err(|e| WisperError::Storage(e.to_string()))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(RecordingSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                    duration_ms: row.get(3)?,
                    source: row.get(4)?,
                    source_url: row.get(5)?,
                })
            })
            .map_err(|e| WisperError::Storage(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| WisperError::Storage(e.to_string()))
    }

    pub fn get_segments(&self, recording_id: &str) -> Result<Vec<TranscriptSegment>, WisperError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT start_ms, end_ms, text
                 FROM transcript_segments
                 WHERE recording_id = ?1
                 ORDER BY start_ms ASC, id ASC",
            )
            .map_err(|e| WisperError::Storage(e.to_string()))?;

        let rows = stmt
            .query_map(params![recording_id], |row| {
                Ok(TranscriptSegment {
                    start_ms: row.get(0)?,
                    end_ms: row.get(1)?,
                    text: row.get(2)?,
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
                "UPDATE transcript_segments SET text = ?1 WHERE id = ?2 AND recording_id = ?3",
                params![text, segment_id, recording_id],
            )
            .map_err(|e| WisperError::Storage(e.to_string()))?;

        Ok(())
    }
}
