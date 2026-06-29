# SiteAssure

Offline, voice-first field documentation with a tamper-evident audit trail, for the skilled
trades & construction. Speak it. Flag it. Prove it.

A foreman speaks the daily log / JHA / inspection / incident note; the app transcribes it
**on-device**, structures it, flags likely safety gaps against real OSHA enforcement patterns,
and stores it as an amendable, fully audited record — no signal required.

> This repo is the **build framework / scaffold** — the locked decisions, the data spine, and the
> contracts pinned down. The actual implementation is built from here in Claude Code. Start with
> [`CLAUDE_CODE_KICKOFF.md`](./CLAUDE_CODE_KICKOFF.md).

**Lives in** the public repo **[L2-C2-Solution](https://github.com/raphaelribot-pursuit/L2-C2-Solution)**.
**Built by** Aisling Leiva-Davila ([@aislingld-pursuit](https://github.com/aislingld-pursuit)) · Raphael Ribot ([@raphaelribot-pursuit](https://github.com/raphaelribot-pursuit)).

## v1 scope (the one-week build)

Single device, single user, offline. Built on **wisper's Tauri/Rust shell** (whisper.cpp stays
on-device) with a **React + TypeScript + Material UI** front end and the **MeridianEHR** records /
amendment / audit logic. Sync, multi-user roles, reviewer approval, and conflict handling are
**v2** — designed-for, not built this week. See `docs/SiteAssure_OneWeek_BuildPlan.md`.

## Layout

```
siteassure/
├─ CLAUDE_CODE_KICKOFF.md   # paste-into-Claude-Code brief — start here
├─ db/schema.sql            # SQLite: records + record_versions + hash-chained audit_log
├─ src-tauri/               # Rust core (Tauri shell from wisper)
│  └─ src/ main.rs · commands.rs · audit.rs · db.rs · flags.rs
├─ src/                     # React + TS + MUI front end
│  ├─ theme.ts              # charcoal/amber/steel tokens
│  ├─ lib/ types.ts · api.ts · tradeStats.ts
│  └─ screens/ Home · Capture · Confirm · Flags · Record · Dashboard
├─ data/                    # OSHA data spine — pipeline + generated stats (sourced in-house)
└─ docs/                    # PRD, one-week build plan, OSHA methodology, screen-flow mockup
```

## Quickstart (after Claude Code fleshes out the stubs)

```bash
npm install
npm run tauri dev     # desktop dev (phone-sized window)
# data refresh: see data/README.md
```

## The merge seam

- **Rust / Tauri** owns: on-device transcription (whisper.cpp), SQLite, and the append-only
  hash-chained audit log (integrity lives here). See `src-tauri/src/`.
- **React / MUI** owns: the five capture screens + records list + dashboard. See `src/`.
- The contract between them is `src-tauri/src/commands.rs` ⇄ `src/lib/api.ts` (kept in sync).

---

## P0 Final — locked build decisions (2026-06-28)

Planning is closed. Demo **Sun 2026-07-05**. Full phase plan: [`ROADMAP.md`](./ROADMAP.md). Privacy: [`DATA_POLICY.md`](./DATA_POLICY.md). Security: [`SECURITY.md`](./SECURITY.md).

**Reuse, confirmed:**
- **wisper → taken wholesale:** on-device transcription, mic capture, model benchmark/recommend/download, GPU matrix (Vulkan/CUDA on Windows · Metal on Apple Silicon → CPU fallback), **ffmpeg + video tooling**, build scripts.
- **MeridianEHR → reference only:** the amend UX shape (reason + before/after). Its store is mutable CRUD and its summary is a cloud call — neither is ported. The tamper-evident hash chain is SiteAssure's own (`src-tauri/src/audit.rs`).

**Resolved:**
1. Reviewer/approver roles → **v2** (schema carries nullable `status`/`role` hooks now; no workflow built).
2. STT model → stage **Whisper Large V3 Turbo** primary + **base.en** fallback; reuse wisper onboarding; GPU-first → CPU.
3. AI cleanup → cloud is **optional / off by default**; the Cleaned/Raw view is **deterministic + offline** (no LLM in the core loop).

**Cross-platform:** Windows 11 (demo) + macOS Apple Silicon (M2 Max). Linux is v2.

### Prerequisites
- **Windows 11:** CMake + a GPU SDK (CUDA for NVIDIA, else Vulkan). See wisper's `build-gpu.ps1`.
- **macOS (Apple Silicon):** Xcode Command Line Tools + `brew install cmake`. Metal needs nothing extra.

### Stage the model + ffmpeg (required — the offline demo can't download)
The Whisper model (~1.6 GB) and the ffmpeg binary are **gitignored** and must be placed on each machine before going offline:
- **Windows:** `%APPDATA%\org.pursuit.siteassure\models\ggml-large-v3-turbo.bin`
- **macOS:** `~/Library/Application Support/org.pursuit.siteassure/models/ggml-large-v3-turbo.bin`

`base.en` (~142 MB) is the fallback if Turbo is too slow on the demo hardware.

### CI gate
Every PR runs GitHub Actions (`.github/workflows/`). **No phase advances unless build · lint · test · smoke · security are all green.**
