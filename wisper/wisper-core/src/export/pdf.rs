use crate::error::WisperError;
use crate::transcribe::TranscriptSegment;

use super::format_timestamp;

fn pdf_escape(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('(', "\\(")
        .replace(')', "\\)")
}

/// Minimal PDF 1.4 with Helvetica — one page, wrapped lines.
pub fn format_transcript_pdf(
    segments: &[TranscriptSegment],
    title: &str,
) -> Result<Vec<u8>, WisperError> {
    let mut lines: Vec<String> = vec![title.to_string(), String::new()];
    for seg in segments {
        let text = seg.text.trim();
        if text.is_empty() {
            continue;
        }
        lines.push(format!(
            "[{} – {}] {}",
            format_timestamp(seg.start_ms),
            format_timestamp(seg.end_ms),
            text
        ));
    }

    let wrapped = wrap_lines(&lines, 90);
    let mut stream = String::from("BT /F1 11 Tf 14 TL 50 750 Td\n");
    for (i, line) in wrapped.iter().enumerate() {
        if i > 0 {
            stream.push_str("T*\n");
        }
        stream.push('(');
        stream.push_str(&pdf_escape(line));
        stream.push_str(") Tj\n");
    }
    stream.push_str("ET");

    let stream_bytes = stream.as_bytes();
    let stream_len = stream_bytes.len();

    let mut body = String::new();
    body.push_str("%PDF-1.4\n");
    let mut offsets: Vec<usize> = Vec::new();

    let add_obj = |n: u32, content: &str, pdf: &mut String, offs: &mut Vec<usize>| {
        offs.push(pdf.len());
        pdf.push_str(&format!("{n} 0 obj\n{content}\nendobj\n"));
    };

    add_obj(
        1,
        "<< /Type /Catalog /Pages 2 0 R >>",
        &mut body,
        &mut offsets,
    );
    add_obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", &mut body, &mut offsets);
    add_obj(
        3,
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        &mut body,
        &mut offsets,
    );
    add_obj(
        4,
        &format!("<< /Length {stream_len} >>\nstream\n{stream}\nendstream"),
        &mut body,
        &mut offsets,
    );
    add_obj(
        5,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        &mut body,
        &mut offsets,
    );

    let xref_start = body.len();
    body.push_str(&format!("xref\n0 {}\n", offsets.len() + 1));
    body.push_str("0000000000 65535 f \n");
    for off in &offsets {
        body.push_str(&format!("{off:010} 00000 n \n"));
    }
    body.push_str(&format!(
        "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_start}\n%%EOF\n",
        offsets.len() + 1
    ));

    Ok(body.into_bytes())
}

fn wrap_lines(lines: &[String], max_chars: usize) -> Vec<String> {
    let mut out = Vec::new();
    for line in lines {
        if line.is_empty() {
            out.push(String::new());
            continue;
        }
        let words: Vec<&str> = line.split_whitespace().collect();
        if words.is_empty() {
            out.push(String::new());
            continue;
        }
        let mut current = words[0].to_string();
        for word in words.iter().skip(1) {
            if current.len() + 1 + word.len() <= max_chars {
                current.push(' ');
                current.push_str(word);
            } else {
                out.push(current);
                current = (*word).to_string();
            }
        }
        out.push(current);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcribe::TranscriptSegment;

    #[test]
    fn pdf_starts_with_header_and_contains_text() {
        let segments = vec![TranscriptSegment {
            start_ms: 0,
            end_ms: 1000,
            text: "Hello".into(),
        }];
        let bytes = format_transcript_pdf(&segments, "Title").unwrap();
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.starts_with("%PDF-1.4"));
        assert!(text.contains("Hello"));
        assert!(text.contains("Title"));
    }
}
