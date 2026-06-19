# Resona — local-first voice-to-text (Tauri 2 + whisper.cpp)

Cross-platform desktop app: **live streaming dictation** + **file transcription**,
all on-device via whisper.cpp, with a grammar review pass and a freemium model.
The Rust core (`whisper-rs`, `cpal`) carries straight over to mobile when you add
the iOS/Android targets, since Tauri 2 builds from one codebase.

## Project layout

```
resona-desktop/
├── src/                      React + TypeScript frontend
│   ├── App.tsx               UI: load model, live dictation, file upload, review, paywall
│   ├── lib/tauri.ts          invoke() wrappers + event listeners + Web Audio decode
│   ├── lib/tiers.ts          frontend mirror of entitlements + feature matrix
│   └── lib/grammar.ts        local rule-based reviewer (free) / AI hook (pro)
└── src-tauri/                Rust backend
    └── src/
        ├── lib.rs            Tauri commands, app state, tier gating
        ├── whisper.rs        whisper-rs wrapper (load model, transcribe buffer)
        ├── audio.rs          cpal mic capture -> 16kHz mono f32
        ├── vad.rs            energy-based voice-activity detection
        ├── streaming.rs      capture -> VAD -> incremental whisper -> events
        └── licensing.rs      Tier / Entitlements / (demo) license validation
```

## Setup

1. **Prerequisites:** Rust (`rustup`), Node 18+, and the Tauri 2 system deps for
   your OS (see tauri.app → Prerequisites: a C toolchain, plus WebKitGTK on Linux).
   whisper.cpp compiles from source through `whisper-rs`, so you also need `cmake`.

2. **Get a model.** Download a ggml model from the whisper.cpp repo, e.g.:
   ```
   # ggml-tiny.bin (~75MB), ggml-base.bin (~140MB), ggml-small.bin (~460MB)
   curl -L -o ggml-base.bin \
     https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
   ```
   Paste that file's path into the app's "path to ggml model file" field.

3. **Run:**
   ```
   npm install
   npm run tauri dev      # dev build with hot reload
   npm run tauri build    # production bundles (.dmg/.app, .msi/.exe, .deb/.AppImage)
   ```

> The Rust against `whisper-rs` 0.16 / `cpal` 0.15 / Tauri 2 is written to compile,
> but APIs drift — if `cargo build` complains, run `cargo add whisper-rs cpal` and
> reconcile against the current docs. For GPU speed, enable a backend feature in
> `Cargo.toml` (`metal` on macOS, `cuda` on NVIDIA, `vulkan` cross-platform).

## How live streaming works

```
mic ──cpal──▶ downmix + resample to 16kHz mono ──▶ channel
                                                      │
        ┌─────────────────────────────────────────────┘
        ▼
  consumer thread:  energy VAD on each 30ms frame
        │   every 700ms while speaking ─▶ whisper(single_segment) ─▶ emit "transcript://partial"
        └── on 800ms of silence         ─▶ whisper(full)          ─▶ emit "transcript://final"
                                                                          │
  React listens via @tauri-apps/api/event ◀───────────────────────────────┘
```

The partial line updates as you talk; on a pause it commits to the transcript and
starts fresh. Two known tuning knobs in `streaming.rs`: `SPEECH_THRESHOLD` (mic
sensitivity) and `SILENCE_MS` (how long a pause ends an utterance).

**Upgrades worth making:** swap the energy VAD for `whisper-rs`'s built-in VAD or
Silero; use overlapping-window "LocalAgreement" decoding for smoother partials;
reuse one `WhisperState` instead of recreating it per partial.

## Freemium model

| Capability         | Free            | Pro                     |
|--------------------|-----------------|-------------------------|
| Live + file STT    | yes             | yes                     |
| Models             | tiny, base      | up to large-v3          |
| File length        | 10 min          | unlimited               |
| Grammar review     | local rules     | AI, context-aware       |
| Translation        | —               | yes                     |
| Export             | txt             | txt, srt, vtt, docx     |

Tier logic lives in `licensing.rs` (Rust) and is mirrored in `tiers.ts` (UI).

### The one thing that matters for the business model

**Client-side gating is UX, not security.** This app runs on the user's machine,
so any local check (`max_minutes_per_file`, model allow-list) can be patched out by
a determined user. That's fine for *local* features — the cost of someone unlocking
a bigger local model is just their own CPU.

What you must **never** gate only on the client is anything that costs *you* money:

- **AI grammar review** and any **cloud inference** must run through *your* backend.
  The client sends transcript text to your API; your API checks the user's
  entitlement (from their authenticated session) before calling the LLM. The API
  key lives on your server, never in the app bundle.
- Issue a **signed license token** (e.g. Ed25519) from your billing backend after
  checkout, and verify the signature in `validate_license()` — replace the demo
  `PRO-` prefix check, which is for wiring only.

### Billing

Use **hosted checkout** (Stripe Checkout or Paddle). The app opens the checkout URL
in the browser; the user pays there; your webhook marks them Pro and issues the
license token. The desktop app never sees or handles card data — keep it that way.

## School-project framing

Good things to write up: the privacy argument (audio never leaves the device), the
latency/accuracy/size trade-offs across model sizes, the streaming VAD pipeline, and
the honest client-vs-server gating analysis above — that last point is exactly the
kind of systems-thinking that distinguishes a freemium design that actually works.

## Contributors
- Aisling Leiva — primary builder · <aisling.ld@pursuit.org>
- Jimmy Ong — product & PRD · <jimmy.ong@pursuit.org>
