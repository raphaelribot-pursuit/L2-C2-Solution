# Figma ↔ Code agent handoff

## Agent status (update this block when anything changes)

**Last updated:** 2026-06-19 · **Owner:** Aisling confirmed hybrid mockup

| Area | Status |
|------|--------|
| **Design direction** | **Locked** — A+B hybrid (`direction-ab-hybrid.html`). Aisling approved this mockup. |
| **Brand** | **Resona** · tagline *a private whisper* · appmark in `wisper/design/brand/` |
| **Figma** | **Done (v1)** — [Resona — Visual Redesign (A+B Hybrid)](https://www.figma.com/design/L3F3rn5AKtB4n1TQ0OlTYm/Resona-Visual-Redesign-A-B-Hybrid). Page `Screens — A+B Hybrid`: frames `01 - Empty Hero`, `02 - Model Missing`, `03 - With Transcript`. Variables: `Resona / Deep Current` (12 colors). Rebuild scripts: `_figma_scripts/`. |
| **HTML mockup** | **Canonical visual reference** — `wisper/design/mockups/direction-ab-hybrid.html` (open in browser; use tabs). |
| **Phase A+B components** | **Written, not wired** — exist under `wisper/src/` but **`App.tsx` does not import them yet**. Running app still looks like old Wisper. |
| **Component files (ready)** | `EmptyStateHero.tsx`, `AppHeader.tsx`, `UrlImportRow.tsx`, `ModelMissingPanel.tsx`, `ExportMenu.tsx`, `ResonaAppmark.tsx`, `tokens.css` |
| **Branch** | Resona UI → `feature/resona-ui` (suggested). Feature slices → `Jimmy-Contributions` / `master`. Current working tree may be mixed/uncommitted — check `git status` before editing. |
| **Merge gate** | **Not open** — do not import Resona components into `App.tsx` on feature branches until Aisling says **merge gate**. One commit must include `App.tsx` + all Resona imports + `tokens.css` + assets together. |
| **Phase C** | **Not started** — two-column library + transcript (≥800px); split Advanced (Setup vs Options). |
| **Slice H** | **Deferred** — live dictation, partials, grammar, fillers, writing score (see `TODO.md`). |

### Next actions by agent

| Agent | Do this next | Do **not** |
|-------|----------------|------------|
| **Figma / design** | Polish Figma vs HTML mockup (real `resona-appmark.svg`, spacing, component variants). Update frames if mockup changes. | Touch `App.tsx` transcription/export logic. |
| **Code / features** | Wait for **merge gate**, then wire Phase A+B on `feature/resona-ui` to match `direction-ab-hybrid.html`. Run `npm run build` after frontend changes. | Import Resona components from `Jimmy-Contributions` feature work until merge gate. Mix “Slice J + reskin” in one PR. |

### Paste-ready context (copy into a new chat)

**Figma agent:** Read this file + `docs/RESONA-VISUAL-REDESIGN.md` + `wisper/design/mockups/direction-ab-hybrid.html`. Figma file linked above. Status table is source of truth for what’s done.

**Code agent:** Read this file + `docs/RESONA-VISUAL-REDESIGN.md`. Visual reference = `direction-ab-hybrid.html`. Resona TSX files exist; **merge gate closed** until Aisling opens it. Feature slices stay on Wisper `App.tsx` only until then.

---

Cursor agents **cannot talk to each other directly**. Coordination happens only through **shared files in this repo** (or URLs you paste into both chats).

## Two parallel tracks

| Track | Branch (suggested) | Touches | Ships as |
|-------|-------------------|---------|----------|
| **Feature slices** (I, J, K…) | `master` / `Jimmy-Contributions` | Wisper `App.tsx`, core, Tauri | `v0.2.0-beta.N` tags |
| **Resona visual redesign** | `feature/resona-ui` | `tokens.css`, `AppHeader.tsx`, `App.css`, design mockups | Separate UX slice after partner OK |

**Rule:** Feature-slice commits must **not** import Resona-only components unless every imported file is in the **same commit**. Beta.25 failed CI when `App.tsx` referenced untracked Resona files.

## Single source of truth

1. **Product / layout intent:** [RESONA-VISUAL-REDESIGN.md](./RESONA-VISUAL-REDESIGN.md)
2. **Visual reference:** `wisper/design/mockups/direction-ab-hybrid.html`
3. **Brand assets:** `wisper/design/brand/`
4. **Figma file:** https://www.figma.com/design/L3F3rn5AKtB4n1TQ0OlTYm/Resona-Visual-Redesign-A-B-Hybrid (also in `RESONA-VISUAL-REDESIGN.md`)

## Workflow (both agents)

1. **Figma agent** — updates mockups, tokens, or component TSX on `feature/resona-ui`; commits with message prefix `resona:`.
2. **Code agent (here)** — ships infra/features on `master`; does not merge Resona UI until you say so.
3. **You** — review mockup HTML in browser; approve Phase C (two-column layout) before we swap `App.tsx` to Resona components.
4. **Merge gate** — one commit or PR that includes `App.tsx` + all Resona imports + `tokens.css` + design assets together.

## Using Figma MCP (optional)

If the Figma MCP server is connected in Cursor, the code agent can read frames from a **shared Figma URL** you paste in chat or in `RESONA-VISUAL-REDESIGN.md`. That replaces guessing from filenames alone.

## If the Figma agent hangs

Typical fixes:

1. **Cancel and start a new chat** with a smaller task (e.g. “update only `tokens.css` spacing” instead of “redesign entire app”).
2. **Check Figma MCP** — Settings → MCP → Figma: authenticated and green.
3. **Avoid mixing tracks** in one prompt (“implement Slice J and reskin header”) — split into two sessions.
4. **Commit WIP to `feature/resona-ui`** so work survives even if the agent stalls.

## What to paste when switching agents

**Into Figma agent:**

> Read `docs/RESONA-VISUAL-REDESIGN.md` and `wisper/design/mockups/direction-ab-hybrid.html`. Do not change export/transcription logic in `App.tsx` feature areas.

**Into code agent:**

> Feature slices use Wisper `App.tsx` only. Resona components are on `feature/resona-ui` — do not import them until merge gate.
