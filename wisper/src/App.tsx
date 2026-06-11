import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  gpu_backend_kind: "metal" | "cuda" | "vulkan" | "intelsycl" | null;
  default_backend: "cpu" | "gpu";
  cpu_architecture: string;
  supports_cpu_fallback: boolean;
}

function computeHint(info: ComputeInfo | null): string {
  const cpuLine = info
    ? `CPU fallback uses ggml-cpu on ${info.cpu_architecture}.`
    : "";
  if (!info?.gpu_available) {
    return `This build is CPU-only. Rebuild with a GPU feature: gpu-vulkan (Windows/Linux), gpu-cuda (NVIDIA), or use macOS for Metal. ${cpuLine}`;
  }
  const fallbackLine = info.supports_cpu_fallback
    ? " GPU is tried first; if inference fails, Wisper automatically retries on CPU and shows a notice."
    : "";
  switch (info.gpu_backend_kind) {
    case "metal":
      return `Apple Metal — Apple Silicon and Intel Macs with a Metal-capable GPU.${fallbackLine} ${cpuLine}`;
    case "cuda":
      return `NVIDIA CUDA acceleration is compiled into this build.${fallbackLine} ${cpuLine}`;
    case "vulkan":
      return `Vulkan acceleration (NVIDIA, AMD, and Intel iGPU on Windows/Linux).${fallbackLine} ${cpuLine}`;
    case "intelsycl":
      return `Intel oneAPI SYCL acceleration is compiled into this build.${fallbackLine} ${cpuLine}`;
    default:
      return info.gpu_backend
        ? `${info.gpu_backend} GPU acceleration is available.${fallbackLine} ${cpuLine}`
        : `GPU acceleration is available.${fallbackLine} ${cpuLine}`;
  }
}

interface TranscribeResult {
  recording_id: string;
  segments: TranscriptSegment[];
  requested_backend: "cpu" | "gpu";
  actual_backend: "cpu" | "gpu";
  used_cpu_fallback: boolean;
}

interface GpuFallbackNotice {
  requested_backend: "cpu" | "gpu";
  from_gpu: string;
  reason: string;
}

interface TranscriptionProgress {
  percent: number;
  elapsed_ms: number;
  duration_ms: number;
}

interface TranscriptionErrorPayload {
  message: string;
  cancelled: boolean;
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

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
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
  const [progress, setProgress] = useState<TranscriptionProgress | null>(null);
  const [fallbackNotice, setFallbackNotice] = useState<GpuFallbackNotice | null>(
    null,
  );
  const [lastUsedCpuFallback, setLastUsedCpuFallback] = useState(false);

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

  useEffect(() => {
    const unlistenProgress = listen<TranscriptionProgress>(
      "transcription-progress",
      (event) => {
        setProgress(event.payload);
      },
    );

    const unlistenFallback = listen<GpuFallbackNotice>(
      "transcription-fallback",
      (event) => {
        setFallbackNotice(event.payload);
        setStatus(
          `${event.payload.from_gpu} failed — retrying on CPU (${computeInfo?.cpu_architecture ?? "ggml-cpu"})…`,
        );
      },
    );

    const unlistenComplete = listen<TranscribeResult>(
      "transcription-complete",
      async (event) => {
        setBusy(false);
        setProgress(null);
        setRecordingId(event.payload.recording_id);
        setSegments(event.payload.segments);
        setLastUsedCpuFallback(event.payload.used_cpu_fallback);
        if (event.payload.used_cpu_fallback) {
          setFallbackNotice(null);
          setStatus(
            `Done on CPU after ${computeInfo?.gpu_backend ?? "GPU"} fallback — ${event.payload.segments.length} segment${event.payload.segments.length === 1 ? "" : "s"} saved.`,
          );
        } else {
          setFallbackNotice(null);
          const device =
            event.payload.actual_backend === "gpu"
              ? computeInfo?.gpu_backend ?? "GPU"
              : "CPU";
          setStatus(
            `Done on ${device} — ${event.payload.segments.length} segment${event.payload.segments.length === 1 ? "" : "s"} saved to library.`,
          );
        }
        await refreshLibrary();
      },
    );

    const unlistenError = listen<TranscriptionErrorPayload>(
      "transcription-error",
      (event) => {
        setBusy(false);
        setProgress(null);
        setFallbackNotice(null);
        if (event.payload.cancelled) {
          setStatus("Transcription cancelled.");
          setError(null);
        } else {
          setError(event.payload.message);
          setStatus("Transcription failed.");
        }
      },
    );

    return () => {
      void unlistenProgress.then((fn) => fn());
      void unlistenFallback.then((fn) => fn());
      void unlistenComplete.then((fn) => fn());
      void unlistenError.then((fn) => fn());
    };
  }, [refreshLibrary, computeInfo?.cpu_architecture, computeInfo?.gpu_backend]);

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
    setProgress(null);
    setFallbackNotice(null);
    setLastUsedCpuFallback(false);
    const deviceLabel =
      computeBackend === "gpu" && computeInfo?.gpu_backend
        ? computeInfo.gpu_backend
        : "CPU";
    setStatus(`Transcribing on ${deviceLabel} (no network)…`);
    setSegments([]);

    try {
      await invoke("start_transcription", {
        audioPath,
        useGpu: computeBackend === "gpu",
      });
    } catch (e) {
      setBusy(false);
      setError(String(e));
      setStatus("Could not start transcription.");
    }
  }

  async function cancelTranscription() {
    try {
      await invoke("cancel_transcription");
      setStatus("Cancelling…");
    } catch (e) {
      setError(String(e));
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
  const transcribing = busy && progress !== null;
  const progressPercent = progress?.percent ?? 0;

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
        <p className="hint compute-hint">{computeHint(computeInfo)}</p>
        {computeInfo && (
          <p className="hint compute-meta">
            Host CPU: <code>{computeInfo.cpu_architecture}</code>
            {computeInfo.supports_cpu_fallback && " · automatic GPU → CPU fallback enabled"}
          </p>
        )}
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
          {busy && (
            <button type="button" className="cancel" onClick={cancelTranscription}>
              Cancel
            </button>
          )}
        </div>

        {busy && (
          <div className="progress-block" aria-live="polite">
            <div className="progress-track" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
              <div
                className="progress-fill"
                style={{ width: `${Math.max(progressPercent, transcribing ? 2 : 0)}%` }}
              />
            </div>
            <p className="progress-meta">
              {progress
                ? `${progressPercent}% · ${formatElapsed(progress.elapsed_ms)} elapsed`
                : "Loading model…"}
              {progress?.duration_ms
                ? ` · ${formatTimestamp(progress.duration_ms)} audio`
                : ""}
            </p>
          </div>
        )}

        {fallbackNotice && (
          <div className="fallback-notice" role="status" aria-live="polite">
            <strong>{fallbackNotice.from_gpu} unavailable</strong>
            <span>
              Retrying on CPU ({computeInfo?.cpu_architecture ?? "ggml-cpu"}).
            </span>
          </div>
        )}

        {lastUsedCpuFallback && !busy && !fallbackNotice && (
          <div className="fallback-complete" role="status">
            Completed on CPU after GPU fallback.
          </div>
        )}

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
