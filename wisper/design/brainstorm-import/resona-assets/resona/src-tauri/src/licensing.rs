//! Freemium tiering + entitlements.
//!
//! IMPORTANT (read the README): client-side gating like this is for UX only.
//! A desktop app runs on the user's machine, so any local check can be patched
//! out. Anything that costs YOU money (cloud LLM grammar review, hosted
//! large-model inference) MUST be gated server-side behind an authenticated API
//! that verifies the entitlement on every request. Use this to shape the UI,
//! not to protect revenue.
use serde::Serialize;

#[derive(Clone, Copy, PartialEq)]
pub enum Tier {
    Free,
    Pro,
}

#[derive(Clone, Serialize)]
pub struct Entitlements {
    pub tier: String,
    pub max_minutes_per_file: u32, // 0 = unlimited
    pub allowed_models: Vec<String>,
    pub llm_grammar: bool,
    pub translation: bool,
    pub export_formats: Vec<String>,
}

pub fn entitlements_for(tier: Tier) -> Entitlements {
    match tier {
        Tier::Free => Entitlements {
            tier: "free".into(),
            max_minutes_per_file: 10,
            allowed_models: vec!["tiny".into(), "base".into()],
            llm_grammar: false,
            translation: false,
            export_formats: vec!["txt".into()],
        },
        Tier::Pro => Entitlements {
            tier: "pro".into(),
            max_minutes_per_file: 0,
            allowed_models: vec![
                "tiny".into(),
                "base".into(),
                "small".into(),
                "medium".into(),
                "large".into(),
            ],
            llm_grammar: true,
            translation: true,
            export_formats: vec!["txt".into(), "srt".into(), "vtt".into(), "docx".into()],
        },
    }
}

/// DEMO ONLY. Replace with real validation: verify a signed license token
/// (e.g. Ed25519) issued by your billing backend after Stripe/Paddle checkout,
/// or call your license server. Never ship the demo prefix check.
pub fn validate_license(key: &str) -> Tier {
    if key.trim().starts_with("PRO-") {
        Tier::Pro
    } else {
        Tier::Free
    }
}
