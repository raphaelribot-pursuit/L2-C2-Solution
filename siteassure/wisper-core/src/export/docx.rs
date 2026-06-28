use std::io::Write;

use crate::error::WisperError;
use crate::transcribe::TranscriptSegment;

use super::format_timestamp;

fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn paragraph_xml(text: &str) -> String {
    format!(
        "<w:p><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
        xml_escape(text)
    )
}

fn document_body_xml(segments: &[TranscriptSegment], title: &str) -> String {
    let mut parts = vec![paragraph_xml(title), paragraph_xml("")];
    for seg in segments {
        let text = seg.text.trim();
        if text.is_empty() {
            continue;
        }
        parts.push(paragraph_xml(&format!(
            "[{} – {}] {}",
            format_timestamp(seg.start_ms),
            format_timestamp(seg.end_ms),
            text
        )));
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    {}
    <w:sectPr/>
  </w:body>
</w:document>"#,
        parts.join("\n    ")
    )
}

const CONTENT_TYPES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"#;

const ROOT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#;

const DOCUMENT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>"#;

/// Minimal Office Open XML document (`.docx`) as a zip archive.
pub fn format_transcript_docx(segments: &[TranscriptSegment], title: &str) -> Result<Vec<u8>, WisperError> {
    let body = document_body_xml(segments, title);
    let mut buffer = Vec::new();
    {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buffer));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        zip.start_file("[Content_Types].xml", options)
            .map_err(|e| WisperError::Export(e.to_string()))?;
        zip.write_all(CONTENT_TYPES.as_bytes())
            .map_err(|e| WisperError::Export(e.to_string()))?;

        zip.start_file("_rels/.rels", options)
            .map_err(|e| WisperError::Export(e.to_string()))?;
        zip.write_all(ROOT_RELS.as_bytes())
            .map_err(|e| WisperError::Export(e.to_string()))?;

        zip.start_file("word/_rels/document.xml.rels", options)
            .map_err(|e| WisperError::Export(e.to_string()))?;
        zip.write_all(DOCUMENT_RELS.as_bytes())
            .map_err(|e| WisperError::Export(e.to_string()))?;

        zip.start_file("word/document.xml", options)
            .map_err(|e| WisperError::Export(e.to_string()))?;
        zip.write_all(body.as_bytes())
            .map_err(|e| WisperError::Export(e.to_string()))?;

        zip.finish()
            .map_err(|e| WisperError::Export(e.to_string()))?;
    }
    Ok(buffer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcribe::TranscriptSegment;

    #[test]
    fn docx_is_valid_zip_with_document_xml() {
        let segments = vec![TranscriptSegment {
            start_ms: 0,
            end_ms: 1000,
            text: "Hello".into(),
            speaker: None,
            words: None,
        }];
        let bytes = format_transcript_docx(&segments, "Test").unwrap();
        let cursor = std::io::Cursor::new(bytes);
        let mut archive = zip::ZipArchive::new(cursor).unwrap();
        let mut doc = archive.by_name("word/document.xml").unwrap();
        let mut xml = String::new();
        std::io::Read::read_to_string(&mut doc, &mut xml).unwrap();
        assert!(xml.contains("Hello"));
        assert!(xml.contains("Test"));
    }
}
