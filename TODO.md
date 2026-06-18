# Wisper — TODO (beta.20 feature gates)

Last updated: 2026-06-18  
**Branch:** `Jimmy-Contributions`  
**Rule:** After each feature → run smoke test → all green → commit → next feature.

Status: `[ ]` pending · `[~]` in progress · `[x]` done

---

## Tier 0 — Smoke gate (run after every feature)

```powershell
cd wisper
.\scripts\smoke-test.ps1
```

Must pass: `cargo test` (wisper-core), `cargo check`, `npm run build`.

---

## Slice A — Documentation

- [x] `docs/Aisling-corrections.md` — authoritative plan + HEART  
- [x] `docs/Week2-PRD-STATUS.md` — Jimmy PRD superseded map  
- [x] Update README, ROADMAP, CHANGELOG, `.gitignore`  
- [x] Branch `Jimmy-Contributions` + push  

---

## Slice B — beta.19 (one feature → smoke → commit)

- [x] **B7** — Rename “Advanced settings” → “Advanced options”  
- [x] **B1** — Privacy subtitle on transcribe panel  
- [x] **B5** — Collapse Advanced while recording  
- [x] **B8** — Remember-open checkbox (`wisper-keep-advanced-open`)  
- [x] **B6** — Model tier selector + `large-turbo` in `StarterModel`  
- [x] **B9** — Hardware advisor (`get_system_profile`, `run_compute_benchmark`, recommend)  
- [x] **B2** — Model-missing inline banner  
- [x] **B3** — Disabled button styling pass  
- [x] **B4** — GPU fallback copy alignment (if needed)  
- [x] Bump version → **0.2.0-beta.19** + CHANGELOG  
- [ ] Tag `v0.2.0-beta.19` + Release CI  

---

## Slice C — beta.20 (one feature → smoke → commit)

- [x] **C3** — `aria-expanded` / `aria-controls` on Advanced toggle  
- [x] **C4** — Escape closes Advanced  
- [x] **C2** — Video format hint (warn only, no size cap)  
- [x] **C5** — Extend `phase1-exit-qa.ps1`  
- [x] Bump version → **0.2.0-beta.20** + CHANGELOG  
- [ ] Tag `v0.2.0-beta.20` + Release CI  

---

## Tier 3 — Manual QA (after beta.19)

- Welcome guide → system check → recommended model → download → transcribe  
- Override model tier (Small on strong PC, Large on weak — warn only)  
- Remember-open Advanced persists across restart  
- Jimmy Intel Mac DMG smoke  
- Windows CUDA smoke  

---

## Explicitly out of scope

- File size limits (upload, URL, recording, model)  
- Jimmy 13-event analytics suite  
- Pin icon / Tauri prefs file (Option C)  
