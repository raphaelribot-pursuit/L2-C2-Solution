# Wisper — 2–3 Minute Pitch (Aisling & Jimmy)

**Total time:** ~2 min 30 sec · **Slides:** 3 · **Version:** beta.21

---

## Slide 1 — The Problem (~45 sec)

**Aisling:**  
Imagine you're in a lecture or a client meeting. The speaker is moving fast, and you're trying to listen *and* take notes at the same time. You can't—people speak about three times faster than they type. So details get lost: names, numbers, action items.

**Jimmy:**  
And if you reach for a transcription app, most of them want your audio in the cloud. That's a non-starter for anything sensitive—therapy, legal, HR, research.

**Aisling:**  
There's Whisper Notes on Mac, which showed people want high-quality *local* transcription. But Windows and Linux users are still stuck choosing between bad notes and giving up their privacy.

---

## Slide 2 — The Solution (~60 sec)

**Jimmy:**  
That's why we built **Wisper**—a cross-platform desktop app for Windows, Mac, and Linux.

**Aisling:**  
The flow is simple. **First, capture audio**—record from your mic, drop in a file, or paste a URL. On first launch, a welcome guide walks you through downloading a speech model and even recommends Small, Medium, or Large based on your hardware.

**Jimmy:**  
**Second, transcribe locally.** Everything runs on your machine using Whisper—we support CPU and GPU, including CUDA on NVIDIA, Metal on Mac, and Vulkan on AMD and Intel. Nothing leaves your computer. We say that right on the screen.

**Aisling:**  
**Third, search and export.** Every transcript goes into a local library with full-text search. You can edit segments and export to text. No account. No subscription. No upload.

---

## Slide 3 — How It's Built (~35 sec)

**Jimmy:**  
Under the hood: React UI in Tauri 2, Rust core with whisper.cpp, SQLite for the library, and GPU backends where your machine supports them.

**Aisling:**  
We're at **beta.21** today—all three model tiers ship, tier-aware transcription works, and we've been dogfooding on Windows with CUDA. Installers are on GitHub Releases for beta testers.

---

## Close (~10 sec)

**Together:**  
Wisper is private, local, and fast enough for real work. We'd love your feedback—and if you have a meeting tomorrow, we'd rather you try it than take notes by hand.

**Optional if asked:** GitHub — `aislingld-pursuit/L2-Clone-Prodject` · tag `v0.2.0-beta.21`

---

## Presenter split

| Section | Who leads |
|---------|-----------|
| Problem (typing vs speech) | Aisling |
| Problem (cloud privacy) | Jimmy |
| Problem (market gap) | Aisling |
| Product intro + capture step | Jimmy |
| Transcribe + privacy | Aisling |
| Library + export | Jimmy |
| Architecture | Jimmy |
| Beta status + ask | Aisling |
| Close | Both |

## Demo backup (if they ask for live)

1. Open Wisper → show welcome guide / model tier checkmarks  
2. Pick a short audio file → transcribe  
3. Show library search + "Transcription runs locally" copy  
