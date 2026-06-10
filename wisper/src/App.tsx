import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";

interface TranscriptSegment {
  start_ms: number;
  end_ms: number;
  text: string;
}

interface RecordingSummary {
  id: string;
  title: string;
  created_at: number;
  duration_ms: number | null;
  source: string;
  source_url: string | null;
}

interface ComputeInfo {
  gpu_available: boolean;
  gpu_backend: string | null;
  default_backend: "cpu" | "gpu";
}

interface TranscribeResult {
  recording_id: string;
  segments: TranscriptSegment[];
}

type ComputeChoice = "cpu" | "gpu";

const COMPUTE_STORAGE_KEY = "wisper-compute-backend";

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function App() {
  const [modelPath, setModelPath] = useState("");
  const [computeInfo, setComputeInfo] = useState<ComputeInfo | null>(null);
  const [computeBackend, setComputeBackend] = useState<ComputeChoice>("cpu");
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [library, setLibrary] = useState<RecordingSummary[]>([]);
  const [status, setStatus] = useState("Pick an audio file to transcribe locally.");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshLibrary = useCallback(async () => {
    try {
      const items = await invoke<RecordingSummary[]>("list_recordings");
      setLibrary(items);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    invoke<string>("get_model_path")
      .then(setModelPath)
      .catch((e) => setError(String(e)));

    invoke<ComputeInfo>("get_compute_info")
      .then((info) => {
        setComputeInfo(info);
        const saved = localStorage.getItem(COMPUTE_STORAGE_KEY) as ComputeChoice | null;
        if (saved === "gpu" && info.gpu_available) {
          setComputeBackend("gpu");
        } else if (saved === "cpu") {
          setComputeBackend("cpu");
        } else {
          setComputeBackend(info.default_backend);
        }
      })
      .catch((e) => setError(String(e)));

    refreshLibrary();
  }, [refreshLibrary]);

  function selectBackend(next: ComputeChoice) {
    setComputeBackend(next);
    localStorage.setItem(COMPUTE_STORAGE_KEY, next);
  }

  async function pickFile() {
    setError(null);
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Audio",
          extensions: ["wav", "mp3", "m4a", "flac", "ogg", "aac"],
        },
      ],
    });

    if (selected && typeof selected === "string") {
      setAudioPath(selected);
      setRecordingId(null);
      setSegments([]);
      setStatus(`Selected: ${selected.split(/[/\\]/).pop()}`);
    }
  }

  async function loadRecording(id: string, title: string) {
    setBusy(true);
    setError(null);
    setStatus(`Loading "${title}"…`);

    try {
      const loaded = await invoke<TranscriptSegment[]>("get_transcript", {
        recordingId: id,
      });
      setRecordingId(id);
      setSegments(loaded);
      setAudioPath(null);
      setStatus(`Loaded ${loaded.length} segment${loaded.length === 1 ? "" : "s"} from library.`);
    } catch (e) {
      setError(String(e));
      setStatus("Failed to load transcript.");
    } finally {
      setBusy(false);
    }
  }

  async function transcribe() {
    if (!audioPath) {
      setError("Select an audio file first.");
      return;
    }

    setBusy(true);
    setError(null);
    const deviceLabel =
      computeBackend === "gpu" && computeInfo?.gpu_backend
        ? computeInfo.gpu_backend
        : "CPU";
    setStatus(`Transcribing on ${deviceLabel} (no network)…`);
    setSegments([]);

    try {
      const result = await invoke<TranscribeResult>("transcribe_audio", {
        audioPath,
        useGpu: computeBackend === "gpu",
      });
      setRecordingId(result.recording_id);
      setSegments(result.segments);
      setStatus(
        `Done — ${result.segments.length} segment${result.segments.length === 1 ? "" : "s"} saved to library.`,
      );
      await refreshLibrary();
    } catch (e) {
      setError(String(e));
      setStatus("Transcription failed.");
    } finally {
      setBusy(false);
    }
  }

  async function editSegment(index: number, text: string) {
    if (!recordingId) return;

    const next = [...segments];
    next[index] = { ...next[index], text };
    setSegments(next);

    try {
      await invoke("update_segment", {
        recordingId,
        index,
        text,
      });
    } catch (e) {
      setError(String(e));
    }
  }

  const gpuLabel = computeInfo?.gpu_backend ?? "GPU";

  return (
    <main className="app">
      <header className="header">
        <div>
          <p className="eyebrow">Phase 1 · local-first</p>
          <h1>Wisper</h1>
          <p className="subtitle">
            Transcription runs entirely on your machine via whisper.cpp.
          </p>
        </div>
      </header>

      <section className="panel">
        <h2 className="panel-title">Compute</h2>
        <div className="compute-toggle" role="radiogroup" aria-label="Compute device">
          <button
            type="button"
            role="radio"
            aria-checked={computeBackend === "cpu"}
            className={computeBackend === "cpu" ? "active" : ""}
            onClick={() => selectBackend("cpu")}
            disabled={busy}
          >
            CPU
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={computeBackend === "gpu"}
            className={computeBackend === "gpu" ? "active" : ""}
            onClick={() => selectBackend("gpu")}
            disabled={busy || !computeInfo?.gpu_available}
            title={
              computeInfo?.gpu_available
                ? `Use ${gpuLabel} acceleration`
                : "GPU not available in this build"
            }
          >
            {gpuLabel}
          </button>
        </div>
        <p className="hint compute-hint">
          {computeInfo?.gpu_available
            ? `Mac uses Metal; Windows uses Vulkan when built with the Vulkan SDK.`
            : `This build is CPU-only. On Windows, install the Vulkan SDK and rebuild to enable GPU.`}
        </p>
      </section>

      <section className="panel">
        <div className="actions">
          <button type="button" onClick={pickFile} disabled={busy}>
            Choose audio file
          </button>
          <button
            type="button"
            className="primary"
            onClick={transcribe}
            disabled={busy || !audioPath}
          >
            {busy ? "Transcribing…" : "Transcribe"}
          </button>
        </div>
        <p className="status">{status}</p>
        {error && <p className="error">{error}</p>}
      </section>

      {library.length > 0 && (
        <section className="panel library">
          <h2 className="panel-title">Library</h2>
          <ul className="library-list">
            {library.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={recordingId === item.id ? "active" : ""}
                  onClick={() => loadRecording(item.id, item.title)}
                  disabled={busy}
                >
                  <span className="library-title">{item.title}</span>
                  <span className="library-meta">
                    {formatDate(item.created_at)}
                    {item.duration_ms != null && ` · ${formatTimestamp(item.duration_ms)}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel model-panel">
        <h2>Whisper model</h2>
        <p className="model-path">{modelPath || "Loading…"}</p>
        <p className="hint">
          Place any <code>ggml-*.bin</code> model in the models folder (e.g.{" "}
          <code>ggml-large-v3-turbo.bin</code> or your renamed file if it is the
          only <code>.bin</code> there). Download from{" "}
          <a
            href="https://huggingface.co/ggerganov/whisper.cpp"
            target="_blank"
            rel="noreferrer"
          >
            Hugging Face
          </a>
          .
        </p>
      </section>

      {segments.length > 0 && (
        <section className="panel transcript">
          <h2>Transcript{recordingId ? " (editable)" : ""}</h2>
          <ul>
            {segments.map((seg, i) => (
              <li key={`${seg.start_ms}-${i}`}>
                <span className="time">
                  {formatTimestamp(seg.start_ms)} – {formatTimestamp(seg.end_ms)}
                </span>
                {recordingId ? (
                  <textarea
                    className="segment-edit"
                    value={seg.text}
                    rows={Math.max(1, Math.ceil(seg.text.length / 60))}
                    onChange={(e) => editSegment(i, e.target.value)}
                  />
                ) : (
                  <span className="text">{seg.text}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

export default App;
