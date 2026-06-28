use std::io::Write;

use crate::error::WisperError;
use crate::transcribe::TranscriptSegment;

use super::{
    format_transcript_csv, format_transcript_docx, format_transcript_json,
    format_transcript_pdf, format_transcript_srt, format_transcript_txt,
    format_transcript_vtt, sanitize_export_folder_name,
};

pub struct TranscriptExportSet {
    pub folder_name: String,
    pub segments: Vec<TranscriptSegment>,
}

fn write_zip_entry(
    zip: &mut zip::ZipWriter<std::io::Cursor<&mut Vec<u8>>>,
    path: &str,
    data: &[u8],
) -> Result<(), WisperError> {
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    zip.start_file(path, options)
        .map_err(|e| WisperError::Export(e.to_string()))?;
    zip.write_all(data)
        .map_err(|e| WisperError::Export(e.to_string()))?;
    Ok(())
}

fn add_transcript_to_zip(
    zip: &mut zip::ZipWriter<std::io::Cursor<&mut Vec<u8>>>,
    folder: &str,
    title: &str,
    segments: &[TranscriptSegment],
) -> Result<(), WisperError> {
    let prefix = format!("{folder}/");
    write_zip_entry(
        zip,
        &format!("{prefix}transcript.txt"),
        format_transcript_txt(segments).as_bytes(),
    )?;
    write_zip_entry(
        zip,
        &format!("{prefix}transcript.srt"),
        format_transcript_srt(segments).as_bytes(),
    )?;
    write_zip_entry(
        zip,
        &format!("{prefix}transcript.vtt"),
        format_transcript_vtt(segments).as_bytes(),
    )?;
    write_zip_entry(
        zip,
        &format!("{prefix}transcript.json"),
        format_transcript_json(title, segments).as_bytes(),
    )?;
    write_zip_entry(
        zip,
        &format!("{prefix}transcript.csv"),
        format_transcript_csv(segments).as_bytes(),
    )?;
    write_zip_entry(
        zip,
        &format!("{prefix}transcript.docx"),
        &format_transcript_docx(segments, title)?,
    )?;
    write_zip_entry(
        zip,
        &format!("{prefix}transcript.pdf"),
        &format_transcript_pdf(segments, title)?,
    )?;
    Ok(())
}

/// ZIP archive with txt, srt, vtt, json, csv, docx, and pdf for one transcript.
pub fn build_transcript_bundle(
    title: &str,
    segments: &[TranscriptSegment],
) -> Result<Vec<u8>, WisperError> {
    let folder = sanitize_export_folder_name(title);
    let mut buffer = Vec::new();
    {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buffer));
        add_transcript_to_zip(&mut zip, &folder, title, segments)?;
        zip.finish()
            .map_err(|e| WisperError::Export(e.to_string()))?;
    }
    Ok(buffer)
}

/// ZIP archive with one subfolder per recording (all export formats each).
pub fn build_library_bundle(exports: &[TranscriptExportSet]) -> Result<Vec<u8>, WisperError> {
    if exports.is_empty() {
        return Err(WisperError::Export("no recordings to export".into()));
    }

    let mut used_names: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    let mut buffer = Vec::new();
    {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buffer));
        for export in exports {
            let base = sanitize_export_folder_name(&export.folder_name);
            let count = used_names.entry(base.clone()).or_insert(0);
            *count += 1;
            let folder = if *count == 1 {
                base
            } else {
                format!("{base}-{}", *count)
            };
            add_transcript_to_zip(&mut zip, &folder, &export.folder_name, &export.segments)?;
        }
        zip.finish()
            .map_err(|e| WisperError::Export(e.to_string()))?;
    }
    Ok(buffer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcribe::TranscriptSegment;

    fn sample() -> TranscriptSegment {
        TranscriptSegment {
            start_ms: 0,
            end_ms: 500,
            text: "Hi".into(),
            speaker: None,
            words: None,
        }
    }

    #[test]
    fn bundle_zip_contains_expected_files() {
        let bytes = build_transcript_bundle("Demo", &[sample()]).unwrap();
        let cursor = std::io::Cursor::new(bytes);
        let mut archive = zip::ZipArchive::new(cursor).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        assert!(names.iter().any(|n| n.ends_with("transcript.json")));
        assert!(names.iter().any(|n| n.ends_with("transcript.docx")));
        assert!(names.iter().any(|n| n.ends_with("transcript.pdf")));
    }
}
