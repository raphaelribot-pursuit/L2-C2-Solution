// Frontend mirror of the Rust entitlements (licensing.rs). Source of truth for
// UI gating only — see README on why real enforcement is server-side.
export interface Entitlements {
  tier: "free" | "pro";
  max_minutes_per_file: number; // 0 = unlimited
  allowed_models: string[];
  llm_grammar: boolean;
  translation: boolean;
  export_formats: string[];
}

export const FEATURE_MATRIX = [
  { label: "Live dictation", free: true, pro: true },
  { label: "File transcription", free: true, pro: true },
  { label: "Models", free: "tiny · base", pro: "up to large-v3" },
  { label: "File length", free: "10 min", pro: "unlimited" },
  { label: "Grammar review", free: "local rules", pro: "AI, context-aware" },
  { label: "Translation", free: false, pro: true },
  { label: "Export", free: "txt", pro: "txt · srt · vtt · docx" },
];
