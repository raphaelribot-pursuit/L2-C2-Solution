import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
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

interface AppAbout extends ComputeInfo {
  app_version: string;
  platform_os: string;
  release_artifact: string;
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
  phase: "download" | "transcribe";
}

interface RecordingStatus {
  peak: number;
  duration_ms: number;
  device_name: string;
}

interface StopRecordingResult {
  audio_path: string;
  duration_ms: number;
}

interface DownloadProgress {
  percent: number | null;
  status: string;
}

interface YtDlpStatus {
  available: boolean;
  path: string | null;
  hint: string;
}

interface ModelStatus {
  path: string;
  models_dir: string;
  ready: boolean;
  hint: string;
}

type ComputeChoice = "cpu" | "gpu";

const COMPUTE_STORAGE_KEY = "wisper-compute-backend";
const LANGUAGE_STORAGE_KEY = "wisper-language";

const LANGUAGE_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "zh", label: "Chinese" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "ar", label: "Arabic" },
  { value: "hi", label: "Hindi" },
  { value: "ru", label: "Russian" },
] as const;

const AUDIO_EXTENSIONS = new Set([
  "wav",
  "mp3",
  "m4a",
  "flac",
  "ogg",
  "aac",
  "mp4",
  "mov",
  "webm",
  "mkv",
]);

function isSupportedAudioPath(path: string): boolean {
  const name = path.split(/[/\\]/).pop() ?? "";
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : undefined;
  return ext ? AUDIO_EXTENSIONS.has(ext) : false;
}

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

function librarySourceLabel(item: RecordingSummary): string {
  if (item.source === "url" || item.source_url) {
    return "Downloaded from URL";
  }
  if (item.source === "mic") {
    return "Fully offline · Mic";
  }
  return "Fully offline";
}

function safeExportFilename(title: string): string {
  const cleaned = title.replace(/[<>:"/\\|?*]/g, "_").trim().slice(0, 80);
  return cleaned || "transcript";
}

function App() {
  const [modelPath, setModelPath] = useState("");
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [computeInfo, setComputeInfo] = useState<ComputeInfo | null>(null);
  const [computeBackend, setComputeBackend] = useState<ComputeChoice>("cpu");
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [library, setLibrary] = useState<RecordingSummary[]>([]);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [activeTitle, setActiveTitle] = useState<string | null>(null);
  const [status, setStatus] = useState("Pick an audio file to transcribe locally.");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<TranscriptionProgress | null>(null);
  const [fallbackNotice, setFallbackNotice] = useState<GpuFallbackNotice | null>(
    null,
  );
  const [lastUsedCpuFallback, setLastUsedCpuFallback] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [aboutInfo, setAboutInfo] = useState<AppAbout | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus | null>(
    null,
  );
  const [language, setLanguage] = useState("auto");
  const [urlInput, setUrlInput] = useState("");
  const [ytDlpStatus, setYtDlpStatus] = useState<YtDlpStatus | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(
    null,
  );
  const [urlJobActive, setUrlJobActive] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const refreshLibrary = useCallback(async () => {
    try {
      const items = await invoke<RecordingSummary[]>("list_recordings");
      setLibrary(items);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const refreshModelStatus = useCallback(async () => {
    try {
      const status = await invoke<ModelStatus>("get_model_status");
      setModelStatus(status);
      setModelPath(status.path);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refreshModelStatus().catch((e) => setError(String(e)));

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
  }, [refreshLibrary, refreshModelStatus]);

  useEffect(() => {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved && LANGUAGE_OPTIONS.some((opt) => opt.value === saved)) {
      setLanguage(saved);
    }

    invoke<YtDlpStatus>("get_yt_dlp_status")
      .then(setYtDlpStatus)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        const items = await invoke<RecordingSummary[]>("search_library", {
          query: libraryQuery,
        });
        if (!cancelled) {
          setLibrary(items);
        }
      } catch {
        if (!cancelled) {
          refreshLibrary();
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [libraryQuery, refreshLibrary]);

  useEffect(() => {
    const unlistenPromise = getCurrentWindow().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === "over") {
        setDragOver(true);
      } else if (payload.type === "leave") {
        setDragOver(false);
      } else if (payload.type === "drop") {
        setDragOver(false);
        if (busy || isRecording) return;
        const path = payload.paths.find(isSupportedAudioPath);
        if (!path) {
          setError("Drop an audio or video file (wav, mp3, m4a, mp4, …).");
          return;
        }
        setError(null);
        setAudioPath(path);
        setRecordingId(null);
        setSegments([]);
        setStatus(`Dropped: ${path.split(/[/\\]/).pop()}`);
      }
    });

    return () => {
      void unlistenPromise.then((fn) => fn());
    };
  }, [busy, isRecording]);

  useEffect(() => {
    if (!showAbout) return;

    invoke<AppAbout>("get_app_about")
      .then(setAboutInfo)
      .catch((e) => setError(String(e)));

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowAbout(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showAbout]);

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
      async       (event) => {
        setBusy(false);
        setProgress(null);
        setDownloadProgress(null);
        setUrlJobActive(false);
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
        setLibraryQuery("");
      },
    );

    const unlistenError = listen<TranscriptionErrorPayload>(
      "transcription-error",
      (event) => {
        setBusy(false);
        setProgress(null);
        setDownloadProgress(null);
        setUrlJobActive(false);
        setFallbackNotice(null);
        const isDownload = event.payload.phase === "download";
        if (event.payload.cancelled) {
          setStatus(isDownload ? "Download cancelled." : "Transcription cancelled.");
          setError(null);
        } else {
          setError(event.payload.message);
          setStatus(isDownload ? "Download failed." : "Transcription failed.");
        }
      },
    );

    const unlistenRecording = listen<RecordingStatus>(
      "recording-status",
      (event) => {
        setRecordingStatus(event.payload);
      },
    );

    const unlistenDownload = listen<DownloadProgress>(
      "download-progress",
      (event) => {
        setDownloadProgress(event.payload);
        const pct = event.payload.percent;
        setStatus(
          pct != null
            ? `Downloading… ${pct}%`
            : event.payload.status || "Downloading…",
        );
      },
    );

    const unlistenDownloadComplete = listen<{
      audio_path: string;
      title: string;
    }>("download-complete", (event) => {
      setDownloadProgress(null);
      setAudioPath(event.payload.audio_path);
      setStatus(`Downloaded "${event.payload.title}" — transcribing locally…`);
    });

    return () => {
      void unlistenProgress.then((fn) => fn());
      void unlistenFallback.then((fn) => fn());
      void unlistenComplete.then((fn) => fn());
      void unlistenError.then((fn) => fn());
      void unlistenRecording.then((fn) => fn());
      void unlistenDownload.then((fn) => fn());
      void unlistenDownloadComplete.then((fn) => fn());
    };
  }, [refreshLibrary, computeInfo?.cpu_architecture, computeInfo?.gpu_backend]);

  useEffect(() => {
    if (!isRecording) {
      setRecordingStatus(null);
    }
  }, [isRecording]);

  function selectBackend(next: ComputeChoice) {
    setComputeBackend(next);
    localStorage.setItem(COMPUTE_STORAGE_KEY, next);
  }

  function selectLanguage(next: string) {
    setLanguage(next);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  }

  async function pickFile() {
    setError(null);
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Audio",
          extensions: ["wav", "mp3", "m4a", "flac", "ogg", "aac", "mp4", "mov", "webm", "mkv"],
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
      setActiveTitle(title);
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

  async function transcribeFromPath(
    path: string,
    options?: { source?: "mic" | "import" | "url"; title?: string; sourceUrl?: string },
  ) {
    if (!modelStatus?.ready) {
      setError(modelStatus?.hint ?? "Whisper model not found. Download a GGML .bin file first.");
      setStatus("Transcription blocked until a model is installed.");
      return;
    }

    setBusy(true);
    setError(null);
    setProgress(null);
    setDownloadProgress(null);
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
        audioPath: path,
        useGpu: computeBackend === "gpu",
        source: options?.source,
        title: options?.title,
        language,
        sourceUrl: options?.sourceUrl,
      });
    } catch (e) {
      setBusy(false);
      setError(String(e));
      setStatus("Could not start transcription.");
    }
  }

  async function importUrlAndTranscribe() {
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setError("Paste a YouTube or audio URL first.");
      return;
    }
    if (!ytDlpStatus?.available) {
      setError(ytDlpStatus?.hint ?? "yt-dlp is not available.");
      return;
    }

    setBusy(true);
    setError(null);
    setProgress(null);
    setDownloadProgress({ percent: null, status: "Starting download…" });
    setUrlJobActive(true);
    setFallbackNotice(null);
    setLastUsedCpuFallback(false);
    setSegments([]);
    setStatus("Downloading audio (network)…");

    try {
      await invoke("start_url_import", {
        url: trimmed,
        useGpu: computeBackend === "gpu",
        language,
      });
    } catch (e) {
      setBusy(false);
      setDownloadProgress(null);
      setUrlJobActive(false);
      setError(String(e));
      setStatus("Could not start URL import.");
    }
  }

  async function transcribe() {
    if (!audioPath) {
      setError("Select an audio file first.");
      return;
    }
    await transcribeFromPath(audioPath, { source: "import" });
  }

  async function startRecording() {
    setError(null);
    try {
      const status = await invoke<RecordingStatus>("start_recording");
      setIsRecording(true);
      setRecordingStatus(status);
      setAudioPath(null);
      setRecordingId(null);
      setSegments([]);
      setStatus(`Recording from ${status.device_name}…`);
    } catch (e) {
      setError(String(e));
    }
  }

  async function stopRecordingAndTranscribe() {
    setError(null);
    try {
      const result = await invoke<StopRecordingResult>("stop_recording");
      setIsRecording(false);
      setRecordingStatus(null);
      setAudioPath(result.audio_path);
      const title = `Voice memo ${new Date().toLocaleString()}`;
      setStatus(
        `Saved ${formatTimestamp(result.duration_ms)} — transcribing locally…`,
      );
      await transcribeFromPath(result.audio_path, { source: "mic", title });
    } catch (e) {
      setIsRecording(false);
      setRecordingStatus(null);
      setError(String(e));
      setStatus("Recording failed.");
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

  async function copyTranscript() {
    if (!recordingId) return;
    setError(null);
    try {
      const text = await invoke<string>("export_transcript_txt", { recordingId });
      await navigator.clipboard.writeText(text);
      setStatus("Transcript copied to clipboard.");
    } catch (e) {
      setError(String(e));
      setStatus("Could not copy transcript.");
    }
  }

  async function exportTranscriptTxt() {
    if (!recordingId) return;
    setError(null);
    try {
      const text = await invoke<string>("export_transcript_txt", { recordingId });
      const path = await save({
        defaultPath: `${safeExportFilename(activeTitle ?? "transcript")}.txt`,
        filters: [{ name: "Text", extensions: ["txt"] }],
      });
      if (path) {
        await invoke("write_text_file", { path, contents: text });
        setStatus(`Exported ${path.split(/[/\\]/).pop()}.`);
      }
    } catch (e) {
      setError(String(e));
      setStatus("Could not export transcript.");
    }
  }

  async function deleteActiveRecording() {
    if (!recordingId) return;
    const label = activeTitle ?? "this recording";
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await invoke("delete_recording", { recordingId });
      setRecordingId(null);
      setActiveTitle(null);
      setSegments([]);
      setLibraryQuery("");
      await refreshLibrary();
      setStatus("Recording deleted.");
    } catch (e) {
      setError(String(e));
      setStatus("Could not delete recording.");
    } finally {
      setBusy(false);
    }
  }

  const gpuLabel = computeInfo?.gpu_backend ?? "GPU";
  const setupIncomplete =
    modelStatus !== null &&
    (!modelStatus.ready || (ytDlpStatus !== null && !ytDlpStatus.available));
  const downloading = busy && downloadProgress !== null;
  const transcribing = busy && !downloading;
  const showUrlSteps = urlJobActive && busy;
  const progressPercent = progress?.percent ?? downloadProgress?.percent ?? 0;
  const progressStep = downloading ? "Download" : transcribing ? "Transcribe" : null;
  const progressLabel = downloading
    ? downloadProgress?.percent != null
      ? `Downloading… ${downloadProgress.percent}%`
      : downloadProgress?.status ?? "Downloading…"
    : progress
      ? `${progressPercent}% · ${formatElapsed(progress.elapsed_ms)} elapsed`
      : transcribing
        ? "Loading model…"
        : "";

  return (
    <main className="app">
      <header className="header">
        <div className="header-main">
          <p className="eyebrow">Phase 1 · local-first</p>
          <h1>Wisper</h1>
          <p className="subtitle">
            Transcription runs entirely on your machine via whisper.cpp.
          </p>
        </div>
        <button
          type="button"
          className="about-trigger"
          onClick={() => setShowAbout(true)}
          aria-haspopup="dialog"
        >
          About
        </button>
      </header>

      {setupIncomplete && (
        <section className="panel onboarding" aria-live="polite">
          <h2>First-run setup</h2>
          <ul className="onboarding-list">
            {modelStatus && !modelStatus.ready && (
              <li>
                <strong>Whisper model</strong> — {modelStatus.hint}
                <p className="hint">
                  Models folder: <code>{modelStatus.models_dir}</code>
                </p>
                <p className="hint">
                  From the repo:{" "}
                  <code>wisper/scripts/download-model.ps1</code> (or download from{" "}
                  <a
                    href="https://huggingface.co/ggerganov/whisper.cpp"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Hugging Face
                  </a>
                  ).
                </p>
              </li>
            )}
            {ytDlpStatus && !ytDlpStatus.available && (
              <li>
                <strong>URL import (optional)</strong> — {ytDlpStatus.hint}
              </li>
            )}
          </ul>
        </section>
      )}

      {showAbout && (
        <div
          className="about-backdrop"
          role="presentation"
          onClick={() => setShowAbout(false)}
        >
          <div
            className="about-dialog panel"
            role="dialog"
            aria-labelledby="about-title"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="about-header">
              <h2 id="about-title">About Wisper</h2>
              <button
                type="button"
                className="about-close"
                onClick={() => setShowAbout(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            {aboutInfo ? (
              <dl className="about-details">
                <div>
                  <dt>Version</dt>
                  <dd>{aboutInfo.app_version}</dd>
                </div>
                <div>
                  <dt>Platform</dt>
                  <dd>{aboutInfo.platform_os}</dd>
                </div>
                <div>
                  <dt>Release artifact</dt>
                  <dd>
                    <code>{aboutInfo.release_artifact}</code>
                  </dd>
                </div>
                <div>
                  <dt>Compiled GPU backend</dt>
                  <dd>
                    {aboutInfo.gpu_available
                      ? aboutInfo.gpu_backend ?? "GPU"
                      : "None (CPU-only build)"}
                  </dd>
                </div>
                <div>
                  <dt>Default compute</dt>
                  <dd>{aboutInfo.default_backend.toUpperCase()}</dd>
                </div>
                <div>
                  <dt>Host CPU</dt>
                  <dd>{aboutInfo.cpu_architecture}</dd>
                </div>
                <div>
                  <dt>GPU → CPU fallback</dt>
                  <dd>
                    {aboutInfo.supports_cpu_fallback ? "Enabled" : "Not available"}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="hint">Loading build info…</p>
            )}
            <p className="hint about-footnote">
              Each installer links one GPU stack (Vulkan, CUDA, or Metal). Use the
              artifact that matches your GPU — see the repo README.
            </p>
          </div>
        </div>
      )}

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
        <h2 className="panel-title">Language</h2>
        <label className="field-label" htmlFor="language-select">
          Transcription language
        </label>
        <select
          id="language-select"
          className="language-select"
          value={language}
          onChange={(e) => selectLanguage(e.target.value)}
          disabled={busy || isRecording}
        >
          {LANGUAGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <p className="hint">
          Auto-detect works for most imports. Pick a language if results are wrong.
        </p>
      </section>

      <section className={`panel import-panel${dragOver ? " drag-over" : ""}`}>
        <h2 className="panel-title">Record or import</h2>
        <p className="drop-hint">
          Drop an audio or video file here, or use the buttons below.
        </p>
        <div className="actions">
          {!isRecording ? (
            <button
              type="button"
              className="record"
              onClick={startRecording}
              disabled={busy}
            >
              Record
            </button>
          ) : (
            <button
              type="button"
              className="record stop"
              onClick={stopRecordingAndTranscribe}
              disabled={busy}
            >
              Stop & transcribe
            </button>
          )}
          <button type="button" onClick={pickFile} disabled={busy || isRecording}>
            Choose audio file
          </button>
          <button
            type="button"
            className="primary"
            onClick={transcribe}
            disabled={busy || isRecording || !audioPath}
          >
            {busy ? "Transcribing…" : "Transcribe"}
          </button>
          {busy && (
            <button type="button" className="cancel" onClick={cancelTranscription}>
              Cancel
            </button>
          )}
        </div>

        <div className="url-import">
          <label className="field-label" htmlFor="url-input">
            Import from URL
          </label>
          <div className="url-row">
            <input
              id="url-input"
              type="url"
              className="url-input"
              placeholder="https://www.youtube.com/watch?v=…"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              disabled={busy || isRecording}
            />
            <button
              type="button"
              className="primary"
              onClick={importUrlAndTranscribe}
              disabled={busy || isRecording || !ytDlpStatus?.available || !urlInput.trim()}
              title={
                ytDlpStatus?.available
                  ? undefined
                  : "Install yt-dlp first (see hint below)"
              }
            >
              Download & transcribe
            </button>
          </div>
          {ytDlpStatus && (
            <p className={`hint${ytDlpStatus.available ? "" : " warn"}`}>
              {ytDlpStatus.hint}
            </p>
          )}
        </div>

        {isRecording && (
          <div className="recording-block" aria-live="polite">
            <div
              className="level-track"
              role="meter"
              aria-valuenow={Math.round((recordingStatus?.peak ?? 0) * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Input level"
            >
              <div
                className="level-fill"
                style={{
                  width: `${Math.min(100, Math.round((recordingStatus?.peak ?? 0) * 100))}%`,
                }}
              />
            </div>
            <p className="recording-meta">
              {recordingStatus
                ? `${formatElapsed(recordingStatus.duration_ms)} · ${recordingStatus.device_name}`
                : "Starting microphone…"}
            </p>
          </div>
        )}

        {busy && (
          <div className="progress-block" aria-live="polite">
            {showUrlSteps && (
              <div className="progress-steps" aria-hidden="true">
                <span
                  className={`progress-step${downloading ? " active" : transcribing ? " done" : ""}`}
                >
                  1 · Download
                </span>
                <span className="progress-step-sep">→</span>
                <span className={`progress-step${transcribing ? " active" : ""}`}>
                  2 · Transcribe
                </span>
              </div>
            )}
            <div
              className="progress-track"
              role="progressbar"
              aria-valuenow={progressPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={progressStep ? `${progressStep} progress` : "Transcription progress"}
            >
              <div
                className={`progress-fill${downloading ? " download" : " transcribe"}`}
                style={{ width: `${Math.max(progressPercent, busy ? 2 : 0)}%` }}
              />
            </div>
            <p className="progress-meta">
              {progressStep && <span className="progress-phase">{progressStep}</span>}
              {progressLabel || (transcribing ? "Transcribing…" : "Working…")}
              {transcribing && progress?.duration_ms
                ? ` · ${formatTimestamp(progress.duration_ms)} audio`
                : ""}
            </p>
            {downloading && (
              <p className="progress-hint">
                Network used for download only — transcription stays offline.
              </p>
            )}
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

      {(library.length > 0 || libraryQuery.trim()) && (
        <section className="panel library">
          <h2 className="panel-title">Library</h2>
          <input
            type="search"
            className="library-search"
            placeholder="Search transcripts…"
            value={libraryQuery}
            onChange={(e) => setLibraryQuery(e.target.value)}
            disabled={busy}
            aria-label="Search library"
          />
          {library.length === 0 ? (
            <p className="hint">No recordings match your search.</p>
          ) : (
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
                    <span
                      className={`library-source${item.source === "url" || item.source_url ? " from-url" : " offline"}`}
                    >
                      {librarySourceLabel(item)}
                    </span>
                    {" · "}
                    {formatDate(item.created_at)}
                    {item.duration_ms != null && ` · ${formatTimestamp(item.duration_ms)}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          )}
        </section>
      )}

      <section className="panel model-panel">
        <h2>Whisper model</h2>
        {modelStatus?.ready ? (
          <p className="model-ready">Ready</p>
        ) : (
          <p className="model-missing">Not installed</p>
        )}
        <p className="model-path">{modelPath || "Loading…"}</p>
        {!modelStatus?.ready && (
          <p className="hint">
            Place any <code>ggml-*.bin</code> model in the models folder (e.g.{" "}
            <code>ggml-large-v3-turbo.bin</code>).
          </p>
        )}
      </section>

      {segments.length > 0 && (
        <section className="panel transcript">
          <div className="transcript-header">
            <h2>Transcript{recordingId ? " (editable)" : ""}</h2>
            {recordingId && (
              <div className="actions transcript-actions">
                <button type="button" onClick={copyTranscript} disabled={busy}>
                  Copy
                </button>
                <button type="button" onClick={exportTranscriptTxt} disabled={busy}>
                  Export TXT
                </button>
                <button
                  type="button"
                  className="cancel"
                  onClick={deleteActiveRecording}
                  disabled={busy}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
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
