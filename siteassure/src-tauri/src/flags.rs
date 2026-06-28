//! 04 Safety flags — rules first (offline-safe), with OSHA trade context attached.
//! The "Roofing - 57.8% cited" context comes from data/osha_trade_stats.json.
//! TODO(build): expand the rule set; add an optional on-device LLM pass as a second stage.

pub struct Flag {
    pub code: String,
    pub title: String,
    pub rationale: String,
    pub osha_context: Option<String>,
}

/// Deterministic, offline starter scan over the structured narrative.
pub fn scan(_narrative: &str, _trade_naics: &str) -> Vec<Flag> {
    // TODO(build): keyword/pattern rules for fall protection, PPE, scaffolding/guardrail, etc.
    // For each hit, attach OSHA context from osha_trade_stats.json -> trades[naics].cited_rate.
    vec![]
}
