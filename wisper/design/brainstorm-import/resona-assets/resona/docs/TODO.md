# Resona — To-Do

Owner tags: [A] Aisling · [J] Jimmy · [A+J] shared. Top item is the current next action.

## Now — design lock
- [x] [J] Choose a mockup direction — **Deep Current** (mockup-2).
- [x] [J] Lock final color tokens (light + dark) in DESIGN.md.
- [x] [J] Deliver logo set: wordmark (dark+light), app mark, favicon, hero (gold assets replaced). TODO: export 1024px app-icon PNG + iOS icon sizes.
- [ ] [A] Confirm free-tier limit model (30 min/month vs per-file) and align licensing.rs.

## Build — P0 (MVP core) [A]
- [ ] Green build: cargo build + npm run tauri build; fix whisper-rs/cpal/Tauri drift.
- [ ] File transcription end-to-end (decode → 16kHz mono → whisper-rs).
- [ ] Live dictation (cpal → VAD → streaming partials/finals).
- [ ] Local grammar review wired to results; apply-fixes + export txt/md.
- [ ] Apply chosen design system + logo in the UI.

## Build — P1 (refine) [A]
- [ ] Smooth live partials (reuse WhisperState; overlapping-window; built-in VAD).
- [ ] Filler-word removal + writing-score scaffold (local first).
- [ ] Model + language pickers (incl. Japanese); docx export.

## Pro / backend — P2 [A+J]
- [ ] Server-side entitlement check + Stripe/Paddle webhook + signed (Ed25519) license token.
- [ ] Cloud or local-LLM rewrite/tone/suggestions (key server-side only).

## Docs & brand [A+J]
- [ ] After mockup pick: update PRD §2, regenerate Resona_PRD.docx, rebuild hero.
- [ ] Keep DECISIONS.md current as choices are made.

## Pre-launch audit [A+J]
- [ ] Accessibility pass: contrast, VoiceOver labels, Dynamic Type, Reduce Motion, 44pt targets.
- [ ] Apple HIG review: safe areas, standard nav, light/dark, app icon spec, haptics.
- [ ] Trademark + domain verification (NAMING.md checklist).
- [ ] Verify "no account needed / on-device" claims are literally true in the build.
