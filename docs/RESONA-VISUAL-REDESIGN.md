# Resona visual redesign — planning doc

**Status:** Phase A + B **implemented** on `feature/resona-ui` (2026-06-19) — pending Jimmy HEART re-test before merge to `master`  
**Figma:** https://www.figma.com/design/L3F3rn5AKtB4n1TQ0OlTYm/Resona-Visual-Redesign-A-B-Hybrid  
**Date:** 2026-06-19  
**Source projects:** Wisper clone (`wisper/`) + Resona (`L2 project 1 Resona/resona/`)  
**Mockups:** `wisper/design/mockups/`  
**Brand assets:** `wisper/design/brand/` (from Resona + `Downloads/files.zip`)

---

## Executive summary

Merge **Wisper’s shipped feature set** (library, URL import, GPU, multi-model, exports) with **Resona’s visual identity** (Deep Current + Living Surface hybrid). Rebrand user-facing name to **Resona** with tagline **“a private whisper”** (draft — confirm with Jimmy).

Implementation **Phase A + B** is scoped; **mockup sign-off complete** (Aisling confirmed `direction-ab-hybrid.html`).

---

## Brand decision (draft)

| Item | Decision |
|------|----------|
| **Product name** | **Resona** (revisit Wisper branding) |
| **Tagline** | **a private whisper** (alternatives: “private voice-to-text”, “Voice → Text · on your device”) |
| **Mark** | Leaf + soundwave appmark (`resona-appmark.svg`) |
| **Design direction** | **A + B hybrid** — Deep Current tokens + gradient/waveform header |
| **Repo / package name** | TBD at implementation (may stay `wisper` internally until rename slice) |

Reference: Resona `docs/DESIGN.md`, `docs/NAMING.md`, Jimmy visual owner.

---

## Chosen UX decisions (locked for mockups)

| Topic | Choice |
|-------|--------|
| Hero | Full Jimmy-style dashed drop zone (~200px) |
| URL import | Main panel (not Advanced-only) |
| Model missing | Full “One more step” panel (remove duplicate inline banner) |
| Scope | EmptyStateHero extraction + visual reskin (Phase A + B) |
| Visual | A + B hybrid mockup |

---

## Mockup index

| File | Description |
|------|-------------|
| `direction-ab-hybrid.html` | **Selected direction** — A tokens + B gradient header + Resona brand |
| `direction-a-deep-current.html` | Deep Current only (desktop) |
| `direction-b-living-surface.html` | Living Surface only |
| `direction-c-daylight.html` | Light theme option |
| `brainstorm-import/` | Claude chat mockups from `Downloads/files.zip` |

Open in browser: double-click any `.html` under `wisper/design/mockups/`.

---

## Implementation phases (pending OK)

### Phase A — Structure (no full retheme yet)

- Extract `EmptyStateHero.tsx` (drop zone, Record/Choose/Transcribe, drag-over)
- URL row on main transcribe panel
- Single model-missing full panel (remove inner `model-banner` duplicate)
- Export dropdown (TXT / SRT / VTT)
- Introduce `tokens.css` from Resona Deep Current

### Phase B — Visual reskin + rebrand

- Apply hybrid layout: gradient header + solid content card
- Resona typography, colors, panel radius
- Header: appmark + “Resona.” + tagline
- Reskin welcome guide to match tokens
- Window title / About copy → Resona (package rename deferred to own slice if needed)

### Phase C — Layout (after A + B)

- Two-column library + transcript at ≥800px
- Split Advanced: Setup vs per-job options

---

## Resona-origin features — explicitly deferred

These exist in the Resona codebase (`L2 project 1 Resona/resona/`) but are **out of scope** for the visual redesign slice and tracked for a **future product slice** (Slice H in `TODO.md` / `ROADMAP.md`).

| Feature | Resona location | Notes |
|---------|-----------------|-------|
| **Live streaming dictation** | `src-tauri/src/streaming.rs`, `vad.rs` | Partial/final transcript events; real-time UI |
| **Partial transcripts** | `transcript://partial` events in streaming | Requires streaming pipeline |
| **Grammar review** | `src/lib/grammar.ts` | Capitalization, punctuation, duplicates |
| **Filler word removal** | grammar + UI “Remove fillers” | Post-transcribe pass |
| **Writing score** | Review block in `App.tsx` | Grammar, conciseness, readability, clarity metrics |

**Rationale:** Wisper clone prioritizes transcription workstation features (library, segments, URL, GPU, exports). Resona polish layer ships **after** visual rebrand is stable and partners sign off.

**Prerequisite for Slice H:** Phase A + B complete; HEART Task Success metrics still green.

---

## What we take from Resona (visual only)

- Color tokens (`--bg`, `--mint`, `--teal`, etc.)
- Leaf + wave brand SVGs
- Typography scale (title, descriptor, panel labels)
- Gradient header + waveform motif (not photographic concept art)
- Privacy lock-line pattern

## What we keep from Wisper (unchanged in redesign)

- SQLite library, segment edit, SRT/VTT export
- Welcome guide + hardware advisor
- yt-dlp / ffmpeg installers
- GPU backends + fallback
- No file size caps, no cloud STT

---

## Stakeholder sign-off

| Gate | Who | Status |
|------|-----|--------|
| Hybrid mockup OK | Aisling | **Approved** — `direction-ab-hybrid.html` confirmed |
| Tagline OK | Aisling | **Approved** — *a private whisper* |
| Phase A + B go | Aisling | **Approved — implemented** |
| HEART clarity re-test | Both partners | After implementation |

---

## Related docs

- [ROADMAP.md](../ROADMAP.md) — Slice UX + deferred Resona features
- [TODO.md](../TODO.md) — Slice UX (pending) + Slice H (Resona polish)
- [docs/Aisling-corrections.md](./Aisling-corrections.md) — HEART UX north star
- Resona source: `../L2 project 1 Resona/resona/docs/DESIGN.md`
