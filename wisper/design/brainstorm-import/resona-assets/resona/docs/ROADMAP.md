# Resona — Roadmap

Phased, owner-tagged. [A] Aisling (build), [J] Jimmy (visual/design), [A+J] shared.
Not hard dates — sequence for a small team. Detail in PRD.md §14 and DESIGN.md.

## Phase 0 — Design lock ✓ [J + A]
Done: **Deep Current** chosen; tokens locked in DESIGN.md; logo/app-icon/hero assets
produced in /brand; PRD + docx updated. The build now consumes a locked design system.

## Phase 1 — MVP core, local & private [A]
Green build (Tauri/Rust); file transcription; live dictation (VAD + streaming);
local grammar correction + filler-word removal; export txt/md; brand applied in-app.
Gate: app runs end-to-end on-device with the chosen design.

## Phase 2 — Refine & polish [A], design QA [J]
Smooth live partials; model + language pickers (incl. Japanese); writing-score scaffold;
docx export; design polish pass against DESIGN.md.

## Phase 3 — Pro / cloud backend [A+J]
Server-side entitlement check + Stripe/Paddle webhook + signed license token;
optional cloud (or local small-LLM) rewrite/tone. Privacy promise preserved.

## Phase 4 — Beta hardening [A+J]
Accessibility + Apple HIG audit (see TODO.md); performance pass on real devices;
marketing site with the new hero; trademark/domain verification (see NAMING.md).

## Phase 5 — Launch & beyond [A+J]
Public release. Then: mobile (iOS/Android via Tauri), browser extension, templates,
integrations, meeting assistant, team workspace (see PRD.md §16).
