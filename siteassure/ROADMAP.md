# SiteAssure — Build Roadmap (P0 Final)

Locked **2026-06-28**. Demo **Sun 2026-07-05**. 6 build days (Mon 6/29 → Sat 7/4) + demo day.

**Owners:** **(A)** Aisling — Rust/Tauri (transcribe · SQLite · audit) · **(R)** Raphael — React/MUI screens · **(pair)** both.
**Source:** `[reuse]` fold wisper · `[reuse-own]` SiteAssure scaffold · `[new]` write.

## Gate rule
GitHub Actions runs on every PR (`.github/workflows/`). **No phase advances unless every required check is green:** build (Windows + macOS) · lint · test · offline smoke · security. See [`SECURITY.md`](./SECURITY.md).

## Reuse verdict
- **wisper → wholesale:** transcription, mic, model benchmark/recommend/download, GPU matrix (Vulkan/CUDA · Metal → CPU), `ffmpeg_tools`, `video/`, build scripts. Beta-green.
- **MeridianEHR → reference only:** amend UX (reason + before/after). Its audit is **not** hash-chained; its summary is a **cloud** call — neither is ported.
- **SiteAssure own → keep:** `audit.rs` (real chain), `schema.sql`, theme, OSHA data spine.

## Phases & CI gates

### Phase 0 — Decisions + repo + CI (Mon AM)
- [ ] 0.1 (pair) Work split locked: A=Rust, R=React. `[new]`
- [ ] 0.2 (pair) Repo, branch/PR convention, both GitHub emails verified. `[new]`
- [ ] 0.3 (pair) Freeze command contract; fix seam casing (`#[serde(rename_all="camelCase")]`). `[new]`
- [x] 0.4 (A) Nullable `status` (record_versions) + `role` (audit_log) — v2 hooks, no workflow. `[reuse-own]` *(done in `db/schema.sql`)*
- [ ] 0.5 (pair) Wire base + security workflows; branch protection on required checks. `[new]`
- **Gate:** base workflow green on an empty PR.

### Phase 1 — Transcription + onboarding spine (DE-RISK FIRST · Mon–Tue) · J1 P0
- [ ] 1.1 (A) `wisper-core` as workspace path dep; copy GPU flags + `dev*.ps1`/`dev-macos.sh`. `[reuse]`
- [ ] 1.2 (A) Onboarding: hardware advice + benchmark + recommend + download. `[reuse]`
- [ ] 1.3 (R) Minimal MUI first-run onboarding screen. `[new]`
- [ ] 1.4 (A) `transcribe` wraps `wisper_core::transcribe_file` (GPU→CPU fallback free); map segments. `[reuse]`
- [ ] 1.5 (A) Port `mic.rs` → `start_recording`/`stop_recording`. `[reuse]`
- [ ] 1.6 (A) Pre-stage Turbo + base.en on both machines; gitignored. `[reuse]`
- **Gate:** offline smoke — transcribe bundled sample → text. SEC-003 (`audio_path` validation).

### Phase 2 — Persistence + audit core (Tue–Wed) · J1/J3 P0
- [ ] 2.1 (A) `db.rs` open rusqlite + apply schema; uncomment `main.rs` setup. `[new]`
- [ ] 2.2 (A) `tauri-plugin-sql` for record/version reads. `[new]`
- [ ] 2.3 (A) `audit.rs` = sole `audit_log` writer. `[reuse-own]`
- [ ] 2.4 (A) Audit hardening: head anchor (catch tail-truncation) + verify stored `prev_hash`. `[new]`
- [ ] 2.5 (A) Encrypt at rest (SQLCipher or OS keychain). `[new]`
- **Gate:** chain tamper test; SQLite parameterized; encryption present.

### Phase 3 — Capture → Confirm → Save (Wed) · J1 P0 · screens 01–03
- [ ] 3.1 (R) HomeScreen · 3.2 (R) CaptureScreen · 3.3 (R) ConfirmScreen — raw immutable + **deterministic offline** Cleaned/Raw. `[new]`
- [ ] 3.4 (A) `save_record` → v1 + `create` audit; `capture` audit entry hashing the retained audio. `[new]`
- [ ] 3.5 (pair) `App.tsx` router. `[new]`
- **Gate:** smoke save→restart→read; SEC-001 write-path validation.

### Phase 3b — ffmpeg / audio retention
- [ ] 3b.1 (A) Stage ffmpeg binary; transcode + store retained audio; hash the stored artifact. `[reuse]`
- **Gate:** SEC-002 SSRF/path guards; ffmpeg staged.

### Phase 4 — Safety flags (Thu) · J2 P0 · screen 04
- [ ] 4.1 (A) `flags.rs` rules (fall protection / PPE / scaffolding) · 4.2 (A) OSHA context · 4.3 (R) flag cards · 4.4 (A) flag audit entries. `[new/reuse]`
- **Gate:** recall ≥80% / FP ≤20% sanity on a fixture transcript.

### Phase 5 — Records + amend + history (Fri) · J3 P0 · screen 05 — *"Prove it"*
- [ ] 5.1 (A) `amend_record` (new version, reason required, prior preserved) · 5.2 (A) `get_record` + verify · 5.3 (R) RecordScreen + "Audit verified" badge + history · 5.4 (R) Records list. `[new]`
- **Gate:** amend preserves prior + `verify()` passes.

### Phase 6 — Dashboard (STRETCH) + polish (Sat) · J4 P1 · screen 06
- [ ] 6.1 (R) Dashboard · 6.2 (A) seed from real OSHA narratives · 6.3 (pair) polish. `[new]`

### Phase 7 — Demo (Sun 7/5)
- [ ] 7.0 (pair) Smoke gate: build + record→transcribe green on **Win11 AND macOS Apple Silicon**. `[new]`
- [ ] 7.1 (pair) Airplane-mode end-to-end · 7.2 (pair) Bug bash; package; rehearse Setup→Conflict→Resolution.

## Cut order if behind
dashboard → onboarding screen (demo uses pre-staged model) → fewer auto-parsed fields → cleanup tab.
**Never cut:** transcribe → save → amend-with-history.

## Out of scope (v2)
sync · multi-user roles · reviewer/approver approval · conflict resolution · external auditor access · mobile (iOS Metal / Android CPU path) · Spanish · ML risk predictor.
