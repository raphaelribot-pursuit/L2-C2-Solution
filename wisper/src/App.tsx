import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";
import { GUIDE_COMPLETE_KEY, WelcomeGuide } from "./WelcomeGuide";

const UPDATE_DISMISS_KEY = "wisper-update-dismissed";

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

interface UpdateCheckResult {
  available: boolean;
  current_version: string;
  latest_version: string | null;
  release_url: string | null;
  download_url: string | null;
  notes: string | null;
  check_error: string | null;
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
const ADVANCED_STORAGE_KEY = "wisper-show-advanced";
const KEEP_ADVANCED_OPEN_KEY = "wisper-keep-advanced-open";
const MODEL_TIER_STORAGE_KEY = "wisper-model-tier";

const MODEL_TIERS = [
  { key: "tiny", label: "Small", size: "~75 MB" },
  { key: "base", label: "Medium", size: "~150 MB" },
  { key: "large-turbo", label: "Large", size: "~1.6 GB" },
] as const;

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

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "mkv", "avi"]);

function isSupportedAudioPath(path: string): boolean {
  const name = path.split(/[/\\]/).pop() ?? "";
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : undefined;
  return ext ? AUDIO_EXTENSIONS.has(ext) : false;
}

function isVideoPath(path: string): boolean {
  const name = path.split(/[/\\]/).pop() ?? "";
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : undefined;
  return ext ? VIDEO_EXTENSIONS.has(ext) : false;
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
  const [status, setStatus] = useState("Choose an audio file or tap Record to begin.");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(
    () => localStorage.getItem(GUIDE_COMPLETE_KEY) !== "1",
  );
  const [showAdvanced, setShowAdvanced] = useState(
    () =>
      localStorage.getItem(KEEP_ADVANCED_OPEN_KEY) === "1" ||
      localStorage.getItem(ADVANCED_STORAGE_KEY) === "1",
  );
  const [progress, setProgress] = useState<TranscriptionProgress | null>(null);
  const [fallbackNotice, setFallbackNotice] = useState<GpuFallbackNotice | null>(
    null,
  );
  const [lastUsedCpuFallback, setLastUsedCpuFallback] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [aboutInfo, setAboutInfo] = useState<AppAbout | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateDismissedVersion, setUpdateDismissedVersion] = useState(() =>
    localStorage.getItem(UPDATE_DISMISS_KEY),
  );
  const [keepAdvancedOpen, setKeepAdvancedOpen] = useState(
    () => localStorage.getItem(KEEP_ADVANCED_OPEN_KEY) === "1",
  );
  const [modelTier, setModelTier] = useState(
    () => localStorage.getItem(MODEL_TIER_STORAGE_KEY) || "base",
  );
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

  const refreshUpdateCheck = useCallback(async () => {
    setUpdateChecking(true);
    try {
      const result = await invoke<UpdateCheckResult>("check_for_app_update");
      setUpdateInfo(result);
      return result;
    } catch (e) {
      const message = String(e);
      setUpdateInfo({
        available: false,
        current_version: aboutInfo?.app_version ?? "",
        latest_version: null,
        release_url: null,
        download_url: null,
        notes: null,
        check_error: message,
      });
      return null;
    } finally {
      setUpdateChecking(false);
    }
  }, [aboutInfo?.app_version]);

  const openUpdateRelease = useCallback(async (url: string) => {
    try {
      await invoke("open_release_url", { url });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const dismissUpdateBanner = useCallback((version: string) => {
    localStorage.setItem(UPDATE_DISMISS_KEY, version);
    setUpdateDismissedVersion(version);
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
    void refreshUpdateCheck();
  }, [refreshLibrary, refreshModelStatus, refreshUpdateCheck]);

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

    void refreshUpdateCheck();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowAbout(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showAbout, refreshUpdateCheck]);

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

  useEffect(() => {
    if (isRecording) {
      setShowAdvanced(false);
    }
  }, [isRecording]);

  useEffect(() => {
    if (!showAdvanced) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (showAbout) return;

      if (urlInput.trim()) {
        const discard = window.confirm(
          "Close Advanced options and discard the URL in the import field?",
        );
        if (!discard) return;
        setUrlInput("");
      }

      setShowAdvanced(false);
      localStorage.setItem(ADVANCED_STORAGE_KEY, "0");
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showAdvanced, urlInput, showAbout]);

  function selectBackend(next: ComputeChoice) {
    setComputeBackend(next);
    localStorage.setItem(COMPUTE_STORAGE_KEY, next);
  }

  function selectLanguage(next: string) {
    setLanguage(next);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  }

  function toggleAdvanced() {
    setShowAdvanced((prev) => {
      const next = !prev;
      localStorage.setItem(ADVANCED_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  function toggleKeepAdvancedOpen(checked: boolean) {
    setKeepAdvancedOpen(checked);
    if (checked) {
      localStorage.setItem(KEEP_ADVANCED_OPEN_KEY, "1");
      setShowAdvanced(true);
      localStorage.setItem(ADVANCED_STORAGE_KEY, "1");
    } else {
      localStorage.removeItem(KEEP_ADVANCED_OPEN_KEY);
    }
  }

  function selectModelTier(key: string) {
    setModelTier(key);
    localStorage.setItem(MODEL_TIER_STORAGE_KEY, key);
  }

  function openWelcomeGuide() {
    setShowWelcome(true);
  }

  function closeWelcomeGuide() {
    setShowWelcome(false);
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
      setError("Speech model not installed yet.");
      setStatus("Open Get started to download the model (one-time setup).");
      setShowWelcome(true);
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
      const path = await invoke<string | null>("save_transcript_txt_file", {
        contents: text,
        defaultFilename: `${safeExportFilename(activeTitle ?? "transcript")}.txt`,
      });
      if (path) {
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
  const modelMissing = modelStatus !== null && !modelStatus.ready;
  const updateReleaseUrl =
    updateInfo?.download_url ?? updateInfo?.release_url ?? null;
  const showUpdateBanner =
    updateInfo?.available === true &&
    updateInfo.latest_version !== null &&
    updateDismissedVersion !== updateInfo.latest_version;
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
    <>
      <WelcomeGuide
        open={showWelcome}
        modelReady={modelStatus?.ready ?? false}
        modelTier={modelTier}
        onModelTierChange={selectModelTier}
        onApplyRecommendation={(rec) => {
          selectModelTier(rec.model_key);
          if (rec.backend === "gpu" && computeInfo?.gpu_available) {
            selectBackend("gpu");
          } else {
            selectBackend("cpu");
          }
        }}
        onFinish={closeWelcomeGuide}
        onRefreshModel={refreshModelStatus}
      />
    <main className="app">
      <header className="header">
        <div className="header-main">
          <h1>Wisper</h1>
          <p className="subtitle">
            Turn speech into text on your computer — private and offline.
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="about-trigger"
            onClick={openWelcomeGuide}
          >
            Get started
          </button>
          <button
            type="button"
            className="about-trigger"
            onClick={() => setShowAbout(true)}
            aria-haspopup="dialog"
          >
            About
          </button>
        </div>
      </header>

      {showUpdateBanner && updateInfo?.latest_version && updateReleaseUrl && (
        <section className="panel update-banner" aria-live="polite">
          <div className="update-banner-copy">
            <h2>Update available</h2>
            <p>
              Wisper <strong>{updateInfo.latest_version}</strong> is ready. You&apos;re on{" "}
              {updateInfo.current_version}.
            </p>
          </div>
          <div className="update-banner-actions">
            <button
              type="button"
              className="primary"
              onClick={() => void openUpdateRelease(updateReleaseUrl)}
            >
              View release
            </button>
            <button
              type="button"
              onClick={() => dismissUpdateBanner(updateInfo.latest_version!)}
            >
              Not now
            </button>
          </div>
        </section>
      )}

      {modelMissing && !showWelcome && (
        <section className="panel onboarding" aria-live="polite">
          <h2>One more step</h2>
          <p className="guide-lead">
            Wisper needs a speech model before it can transcribe. Tap Get started and we&apos;ll
            walk you through a one-time download (~150 MB).
          </p>
          <button type="button" className="primary" onClick={openWelcomeGuide}>
            Open setup guide
          </button>
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
            <div className="about-updates">
              <h3>Updates</h3>
              {updateChecking ? (
                <p className="hint">Checking for updates…</p>
              ) : updateInfo?.check_error ? (
                <p className="hint about-update-error">{updateInfo.check_error}</p>
              ) : updateInfo?.available ? (
                <>
                  <p className="about-update-available">
                    <strong>{updateInfo.latest_version}</strong> is available (you have{" "}
                    {updateInfo.current_version}).
                  </p>
                  {updateInfo.notes && (
                    <p className="hint about-update-notes">{updateInfo.notes}</p>
                  )}
                  {updateReleaseUrl && (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => void openUpdateRelease(updateReleaseUrl)}
                    >
                      View release
                    </button>
                  )}
                </>
              ) : (
                <p className="hint">
                  You&apos;re on the latest release
                  {updateInfo?.latest_version
                    ? ` (${updateInfo.latest_version}).`
                    : "."}
                </p>
              )}
              <button
                type="button"
                onClick={() => void refreshUpdateCheck()}
                disabled={updateChecking}
              >
                Check for updates
              </button>
            </div>
            <p className="hint about-footnote">
              Each installer links one GPU stack (Vulkan, CUDA, or Metal). Use the
              artifact that matches your GPU — see the repo README.
            </p>
          </div>
        </div>
      )}

      <section className={`panel import-panel${dragOver ? " drag-over" : ""}`}>
        <h2 className="panel-title">Transcribe audio</h2>
        <p className="privacy-subtitle">
          Transcription runs locally on your device. No data leaves your computer.
        </p>
        {modelMissing && !showWelcome && (
          <div className="model-banner" role="status">
            <p>
              Speech model not installed yet. Download once to start transcribing.
            </p>
            <button type="button" className="primary" onClick={openWelcomeGuide}>
              Get started
            </button>
          </div>
        )}
        <p className="drop-hint">
          Drop an audio or video file here, or use the buttons below.
        </p>
        {audioPath && isVideoPath(audioPath) && (
          <p className="hint warn">
            That looks like video — Wisper will extract audio for transcription. For
            best results, try MP3 or WAV if extraction is slow.
          </p>
        )}
        <div className="actions">
          {!isRecording ? (
            <button
              type="button"
              className={`record${modelMissing ? " disabled-muted" : ""}`}
              onClick={startRecording}
              disabled={busy || modelMissing}
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
            className={`primary${!audioPath || modelMissing ? " disabled-muted" : ""}`}
            onClick={transcribe}
            disabled={busy || isRecording || !audioPath || modelMissing}
          >
            {busy ? "Transcribing…" : "Transcribe"}
          </button>
          {modelMissing && (
            <p className="hint disabled-hint">
              Install the speech model first — use Get started above.
            </p>
          )}
          {!modelMissing && !audioPath && !busy && !isRecording && (
            <p className="hint disabled-hint">Choose or record audio to enable Transcribe.</p>
          )}
          {busy && (
            <button type="button" className="cancel" onClick={cancelTranscription}>
              Cancel
            </button>
          )}
        </div>

        {showAdvanced && (
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
                className={`primary${!ytDlpStatus?.available || !urlInput.trim() ? " disabled-muted" : ""}`}
                onClick={importUrlAndTranscribe}
                disabled={busy || isRecording || !ytDlpStatus?.available || !urlInput.trim()}
              >
                Download & transcribe
              </button>
            </div>
            {ytDlpStatus && (
              <p className={`hint${ytDlpStatus.available ? "" : " warn"}`}>
                {ytDlpStatus.hint}
              </p>
            )}
            {!ytDlpStatus?.available && (
              <p className="hint disabled-hint">
                URL import needs yt-dlp installed on your system.
              </p>
            )}
          </div>
        )}

        {!showAdvanced && (
          <p className="hint advanced-hint">
            <button
              type="button"
              className="link-button"
              onClick={toggleAdvanced}
              aria-expanded={showAdvanced}
              aria-controls="advanced-panel"
            >
              Advanced options
            </button>
            {" "}— language, GPU, URL import, and model details.
          </p>
        )}

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
              Restarting on CPU ({computeInfo?.cpu_architecture ?? "ggml-cpu"}) from the
              beginning.
            </span>
          </div>
        )}

        {lastUsedCpuFallback && !busy && !fallbackNotice && (
          <div className="fallback-complete" role="status">
            Completed on CPU after GPU restarted from the beginning.
          </div>
        )}

        <p className="status">{status}</p>
        {error && <p className="error">{error}</p>}
      </section>

      {showAdvanced && (
        <>
          <section id="advanced-panel" className="panel advanced-panel">
            <div className="advanced-header">
              <h2 className="panel-title">Advanced options</h2>
              <button
                type="button"
                className="link-button"
                onClick={toggleAdvanced}
                aria-expanded={showAdvanced}
                aria-controls="advanced-panel"
              >
                Hide
              </button>
            </div>
            <label className="keep-advanced-label">
              <input
                type="checkbox"
                checked={keepAdvancedOpen}
                onChange={(e) => toggleKeepAdvancedOpen(e.target.checked)}
                disabled={busy || isRecording}
              />
              Keep open on this computer
            </label>

            <h3 className="advanced-subtitle">Language</h3>
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
              Auto-detect works for most files. Pick a language if results are wrong.
            </p>

            <h3 className="advanced-subtitle">Compute</h3>
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

            <h3 className="advanced-subtitle">Speech model</h3>
            <label className="field-label" htmlFor="model-tier-select">
              Model size
            </label>
            <select
              id="model-tier-select"
              className="language-select"
              value={modelTier}
              onChange={(e) => selectModelTier(e.target.value)}
              disabled={busy || isRecording || downloading}
            >
              {MODEL_TIERS.map((tier) => (
                <option key={tier.key} value={tier.key}>
                  {tier.label} ({tier.size})
                </option>
              ))}
            </select>
            <p className="hint">
              Small is fastest on older hardware; Large is best quality. Change before
              downloading in Get started.
            </p>
            {modelStatus?.ready ? (
              <p className="model-ready">Installed and ready</p>
            ) : (
              <p className="model-missing">Not installed</p>
            )}
            <p className="model-path">{modelPath || "Loading…"}</p>
            <div className="guide-actions">
              <button type="button" onClick={openWelcomeGuide}>
                Open setup guide
              </button>
              <button
                type="button"
                onClick={() => invoke("open_models_folder").catch((e) => setError(String(e)))}
              >
                Open models folder
              </button>
            </div>
          </section>
        </>
      )}

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
    </>
  );
}

export default App;
