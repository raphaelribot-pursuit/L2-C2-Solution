# Week 2 PRD — status & superseded sections

**Authoritative plan:** [Aisling-corrections.md](./Aisling-corrections.md)  
**Jimmy source:** `_partner-review/Wisper_Week2_PRD_FINAL_CORRECTED.md`  
**Branch:** `Jimmy-Contributions` → beta.19 / beta.20  
**Baseline shipped:** `v0.2.0-beta.18` on `master`  
**UX north star:** [HEART framework](https://www.heartframework.com/) — focus **Task Success** + **Adoption**

## What shipped before this branch

| Version | Week 2 relevance |
|---------|------------------|
| beta.15 | Welcome guide, one-click `base` model download, Record/Choose file, Advanced collapsed |
| beta.17 | In-app update check |
| beta.18 | Update-check CI fixes, correct “latest version” in About |

Partial Week 2 delivery = **beta.15 + beta.17–18**. Remaining UX is **beta.19–20** on `Jimmy-Contributions`.

## Jimmy PRD → Aisling correction map

| Jimmy PRD section / claim | Correction ID | Resolution |
|---------------------------|---------------|------------|
| Greenfield Week 2 UI | C1 | Delta on beta.15–18, not rewrite |
| In-app model download is “separate” | C2 | Already in `WelcomeGuide` — document it |
| `EmptyStateHero.tsx` P0 | C3 | P1 optional refactor only |
| 13 analytics events MVP | C4 | Deferred; HEART metrics manual for beta |
| Electron `app.getPath` / prefs | C5, C7 | Tauri `app_data_dir` + `localStorage` |
| Pin Advanced (config file) | C6 | **Option B** — remember-open checkbox |
| 1 GB file cap | C9 | **Rejected** — no upload/URL/recording/model caps |
| Model download banner only | C10 | Guide first-run; inline banner if model missing later |
| Privacy subtitle | C11 | Implement beta.19 |
| “Advanced settings” label | C12 | **“Advanced options”** |
| Merge `Jimmy-fixes` to master | C13 | **`Jimmy-Contributions`** branch; merge when ready |
| “10/10 production-ready” | C14 | “Spec-ready for planning” |
| Fixed `base` model only | C16 | Small / Medium / Large selector |
| — | C17 | Hardware spec + benchmark + recommendation |
| — | D14 | HEART-guided UI/UX beta.19–20 |

## In scope (beta.19)

- Model tier selector (Small / Medium / Large)
- Hardware advisor (spec reader, optional micro-benchmark, recommendation)
- Advanced options + remember-open
- Privacy subtitle, model-missing banner, disabled-state polish
- No file size limits

## In scope (beta.20)

- `aria-expanded` on Advanced toggle, Escape to collapse
- Optional video format hint (warn only)
- QA script updates

## Deferred

- Pin icon + Tauri prefs file (Option C)
- Full analytics / PostHog
- EmptyStateHero extract → **moved to Slice UX** ([RESONA-VISUAL-REDESIGN.md](./RESONA-VISUAL-REDESIGN.md))
- Language confidence banner
- Figma hard gate

### Resona polish layer (Slice H — post Slice UX)

From original Resona project; **not** in visual redesign:

- Live streaming dictation + partial transcripts
- Grammar review / filler removal / writing score

See [ROADMAP.md](../ROADMAP.md) Slice H, [TODO.md](../TODO.md) Slice H.

## Stakeholder HEART summary

See [Section 5 in Aisling-corrections.md](./Aisling-corrections.md#5-heart-framework--wisper-ux-north-star).

**Primary metrics:** activation rate (transcribe started), TTFT, recommendation acceptance %, partner clarity test (&lt;10s).
