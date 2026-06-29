// Deterministic, OFFLINE transcript cleanup. No LLM, no network.
// Produces the "Cleaned" view shown ALONGSIDE the raw transcript (PRD J1 P1 / kickoff non-negotiable:
// "AI never overwrites truth — the raw transcript is immutable"). This is the offline Option (b)
// chosen in P0 Final: capitalization, punctuation, conservative filler removal, gap-based paragraphs.
import type { TranscriptSegment } from "./types";

// Conservative disfluencies only — never construction units. (No "mm"/"cm"/"m": those are measurements.)
const FILLERS = ["um", "uh", "umm", "uhh", "erm", "hmm", "you know", "i mean"];

const FILLER_RE = new RegExp(
  `\\b(?:${FILLERS.map((f) => f.replace(/ /g, "\\s+")).join("|")})\\b,?`,
  "gi"
);

/** Collapse stutters: "the the the crew" -> "the crew". */
function dedupeStutters(s: string): string {
  return s.replace(/\b(\w+)(?:\s+\1\b)+/gi, "$1");
}

/** Capitalize the first letter of the string and of each sentence after . ! ? */
function capitalizeSentences(s: string): string {
  return s.replace(/(^\s*|[.!?]\s+)([a-z])/g, (_m, lead, ch) => lead + ch.toUpperCase());
}

/** Standalone "i" -> "I" (also covers contractions like "i'm" via the word boundary). */
function fixI(s: string): string {
  return s.replace(/\bi\b/g, "I");
}

/** Clean one block of transcript text. Deterministic + offline. Empty in -> empty out. */
export function cleanText(raw: string): string {
  let s = raw.normalize("NFC");
  s = s.replace(FILLER_RE, " "); // strip fillers
  s = dedupeStutters(s);
  s = s.replace(/\s+([,.!?;:])/g, "$1"); // no space before punctuation
  s = s.replace(/\s{2,}/g, " ").trim(); // collapse whitespace
  if (!s) return "";
  s = fixI(s);
  s = capitalizeSentences(s);
  if (!/[.!?]$/.test(s)) s += "."; // ensure terminal punctuation
  return s;
}

/**
 * Segment-aware cleanup: per-segment cleaning plus a paragraph break wherever there is a speech
 * gap longer than `gapMs` (uses whisper segment timing — still fully offline).
 */
export function cleanSegments(segments: TranscriptSegment[], gapMs = 1500): string {
  const paras: string[] = [];
  let cur: string[] = [];
  let prevEnd: number | null = null;
  for (const seg of segments) {
    if (prevEnd !== null && seg.startMs - prevEnd > gapMs && cur.length) {
      paras.push(cur.join(" "));
      cur = [];
    }
    cur.push(seg.text.trim());
    prevEnd = seg.endMs;
  }
  if (cur.length) paras.push(cur.join(" "));
  return paras.map(cleanText).filter(Boolean).join("\n\n");
}
