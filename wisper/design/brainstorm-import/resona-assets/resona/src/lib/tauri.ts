import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Entitlements } from "./tiers";

export const api = {
  loadModel: (modelId: string, path: string) =>
    invoke<void>("load_model", { modelId, path }),
  getEntitlements: () => invoke<Entitlements>("get_entitlements"),
  setLicense: (key: string) => invoke<Entitlements>("set_license", { key }),
  transcribeSamples: (samples: Float32Array, language: string | null, translate: boolean) =>
    invoke<string>("transcribe_samples", { samples: Array.from(samples), language, translate }),
  startDictation: (language: string | null, translate: boolean) =>
    invoke<void>("start_dictation", { language, translate }),
  stopDictation: () => invoke<void>("stop_dictation"),
};

// Subscribe to the live dictation stream. Returns an unlisten cleanup fn.
export async function onTranscript(
  onPartial: (text: string) => void,
  onFinal: (text: string) => void
): Promise<UnlistenFn> {
  const u1 = await listen<{ text: string }>("transcript://partial", (e) => onPartial(e.payload.text));
  const u2 = await listen<{ text: string }>("transcript://final", (e) => onFinal(e.payload.text));
  return () => { u1(); u2(); };
}

// Decode any uploaded audio/video file to 16kHz mono Float32 (same trick as the
// web version — whisper needs exactly this or it produces garbage).
export async function decodeToMono16k(file: File): Promise<Float32Array> {
  const buf = await file.arrayBuffer();
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(buf);
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  await ctx.close();
  return rendered.getChannelData(0);
}
