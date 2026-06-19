import { useEffect, useRef, useState } from "react";
import { api, onTranscript, decodeToMono16k } from "./lib/tauri";
import { reviewLocal, type Review } from "./lib/grammar";
import { FEATURE_MATRIX, type Entitlements } from "./lib/tiers";

const MODELS = [
  { id: "tiny", label: "tiny · fastest", file: "ggml-tiny.bin" },
  { id: "base", label: "base · balanced", file: "ggml-base.bin" },
  { id: "small", label: "small · accurate (Pro)", file: "ggml-small.bin" },
];

export default function App() {
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [modelPath, setModelPath] = useState("");
  const [modelId, setModelId] = useState("base");
  const [language, setLanguage] = useState("auto");
  const [loaded, setLoaded] = useState(false);
  const [live, setLive] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [partial, setPartial] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [status, setStatus] = useState("");
  const [showUpgrade, setShowUpgrade] = useState(false);
  const unlisten = useRef<null | (() => void)>(null);

  useEffect(() => { api.getEntitlements().then(setEnt); }, []);

  async function loadModel() {
    try {
      setStatus("Loading model…");
      await api.loadModel(modelId, modelPath);
      setLoaded(true); setStatus("Model ready ✓");
    } catch (e) { setStatus(String(e)); if (String(e).includes("Pro")) setShowUpgrade(true); }
  }

  async function toggleLive() {
    if (live) { await api.stopDictation(); unlisten.current?.(); setLive(false); finalize(finalText); return; }
    setFinalText(""); setPartial(""); setReview(null);
    unlisten.current = await onTranscript(
      (p) => setPartial(p),
      (f) => setFinalText((prev) => { setPartial(""); return (prev + " " + f).trim(); })
    );
    try { await api.startDictation(language === "auto" ? null : language, false); setLive(true); setStatus("Listening…"); }
    catch (e) { setStatus(String(e)); unlisten.current?.(); }
  }

  async function onFile(file: File) {
    try {
      setStatus(`Decoding ${file.name}…`); setReview(null); setPartial("");
      const samples = await decodeToMono16k(file);
      setStatus("Transcribing…");
      const text = await api.transcribeSamples(samples, language === "auto" ? null : language, false);
      setFinalText(text); finalize(text); setStatus("Done ✓");
    } catch (e) { setStatus(String(e)); if (String(e).includes("Upgrade")) setShowUpgrade(true); }
  }

  function finalize(text: string) {
    if (!text.trim()) return;
    // FREE: local linter. PRO (ent.llm_grammar): route text to your backend's AI reviewer.
    setReview(reviewLocal(text));
  }

  return (
    <div className="wrap">
      <header>
        <h1>Resona<span>.</span></h1>
        <span className={`badge ${ent?.tier}`}>{ent?.tier ?? "…"}</span>
      </header>

      <div className="row">
        <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
          {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <input placeholder="path to ggml model file" value={modelPath}
          onChange={(e) => setModelPath(e.target.value)} />
        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="auto">auto</option><option value="en">English</option>
          <option value="ja">日本語</option><option value="es">Español</option>
        </select>
        <button onClick={loadModel}>Load</button>
      </div>

      <div className="panel">
        <div className="actions">
          <button className={`primary ${live ? "rec" : ""}`} disabled={!loaded} onClick={toggleLive}>
            {live ? "■ Stop dictation" : "● Live dictation"}
          </button>
          <label className="filebtn">
            Upload file
            <input type="file" accept="audio/*,video/*" disabled={!loaded}
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
        </div>

        <div className="transcript">
          {finalText}{partial && <span className="partial"> {partial}</span>}
          {!finalText && !partial && <span className="ph">Transcript appears here…</span>}
        </div>
        <div className="status">{status}</div>

        {review && (
          <div className="review">
            <div className="verdict">
              <b className="score" data-tier={review.score >= 85 ? "ok" : review.score >= 65 ? "mid" : "low"}>
                {review.score}
              </b>
              <span>{review.recommendation} <em>· {review.source}</em></span>
            </div>
            <ul>{review.issues.length === 0 ? <li className="ph">No issues found.</li>
              : review.issues.map((i, k) => <li key={k}><span className={`k ${i.kind}`}>{i.kind}</span> {i.msg}</li>)}</ul>
            <button onClick={() => setFinalText(review.fixed)}>Apply fixes</button>
          </div>
        )}
      </div>

      {showUpgrade && (
        <div className="modal" onClick={() => setShowUpgrade(false)}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <h2>Upgrade to Pro</h2>
            <table><tbody>
              {FEATURE_MATRIX.map((f) => (
                <tr key={f.label}><td>{f.label}</td>
                  <td>{cell(f.free)}</td><td className="pro">{cell(f.pro)}</td></tr>
              ))}
            </tbody></table>
            <p className="note">Checkout runs through hosted Stripe/Paddle — the app never touches card data.</p>
            <button className="primary" onClick={() => setShowUpgrade(false)}>Maybe later</button>
          </div>
        </div>
      )}
    </div>
  );
}

function cell(v: string | boolean) { return v === true ? "✓" : v === false ? "—" : v; }
