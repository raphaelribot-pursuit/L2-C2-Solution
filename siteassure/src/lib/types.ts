// The data contract shared with the Rust core (src-tauri/src/commands.rs). camelCase both sides
// (Rust uses #[serde(rename_all = "camelCase")]). Keep the two in sync.
export type RecordKind = "daily_log" | "jha" | "inspection" | "incident";

export interface TranscriptSegment { startMs: number; endMs: number; text: string; }
export interface Transcript { text: string; segments: TranscriptSegment[]; }

// Live mic capture status (src-tauri/src/mic.rs MicRecordingStatus).
export interface MicStatus { peak: number; durationMs: number; deviceName: string; }

export interface SafetyFlag {
  code: string;
  title: string;
  rationale: string;
  oshaContext?: string;                 // e.g. "Roofing · 57.8% cited for this"
  status: "open" | "accepted" | "dismissed";
  note?: string;
}

export interface RecordFields {
  date?: string; site?: string; crew?: string; tradeNaics?: string; [k: string]: unknown;
}

export interface RecordVersion {
  version: number; createdAt: string; author: string; reason?: string;
  transcript: string; narrative: string; fields: RecordFields; flags: SafetyFlag[];
}

export interface RecordWithHistory {
  id: string; kind: RecordKind; createdAt: string; createdBy: string;
  currentVersion: number; versions: RecordVersion[]; auditVerified: boolean;
}
