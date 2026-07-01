// The data contract shared with the Rust core (src-tauri/src/commands.rs). camelCase both sides
// (Rust uses #[serde(rename_all = "camelCase")]). Keep the two in sync.
export type RecordKind = "daily_log" | "jha" | "inspection" | "incident";

export interface TranscriptSegment { startMs: number; endMs: number; text: string; }
export interface Transcript { text: string; segments: TranscriptSegment[]; }

// Live mic capture status (src-tauri/src/mic.rs MicRecordingStatus).
export interface MicStatus { peak: number; durationMs: number; deviceName: string; }

// 04 flag-engine output (src-tauri/src/flags.rs Flag). The UI wraps each as a SafetyFlag (adds status/note).
export interface FlagHit { code: string; title: string; rationale: string; oshaContext?: string; }

// Payload for save_record (src-tauri NewRecord, camelCase). transcript = the raw transcript (immutable).
export interface NewRecordInput {
  kind: RecordKind;
  site?: string;
  tradeNaics?: string;
  transcript: string;
  narrative: string;
  fieldsJson: string;
  flagsJson: string;
  audioPath?: string;            // retained WAV path from stopRecording() — hashed into the audit chain
}

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
  // Soft-delete: voided records stay in the audit chain (nothing is ever hard-deleted)
  // but are excluded from Home/Dashboard views. Set by void_record.
  voided?: boolean; voidedAt?: string; voidedBy?: string; voidedReason?: string;
}

// Audit chain (src-tauri/src/audit.rs AuditEntry / audit::verify_db). Backs the new Audit tab.
// NOTE: audit_status / list_audit_log Tauri commands do not exist yet — see api.ts comment.
export interface AuditEntry {
  seq: number;
  ts: string;
  actor: string;
  action: string; // 'create' | 'amend' | 'void' | 'flag_accept' | 'flag_dismiss' | 'capture' | 'export'
  recordId?: string;
  version?: number;
  payloadHash: string;
  prevHash: string;
  entryHash: string;
}

export interface AuditStatus {
  verified: boolean;
  count: number;
  lastHash: string;
  updatedAt: string;
}

// In-flight capture draft shared across the capture → confirm → flags screens (src/App.tsx).
export interface DraftFields { date?: string; site?: string; crew?: string; tradeNaics?: string; }
export interface Draft {
  kind: RecordKind;
  audioPath?: string;
  transcript: string;            // raw, immutable
  segments: TranscriptSegment[];
  narrative: string;             // cleaned / edited
  fields: DraftFields;
  flags: SafetyFlag[];
}
