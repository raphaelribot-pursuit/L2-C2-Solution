import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";
import { GUIDE_COMPLETE_KEY, WelcomeGuide } from "./WelcomeGuide";

const UPDATE_DISMISS_KEY = "wisper-update-dismissed";

interface DownloadProgress {
  percent: number | null;
  status: string;
  automatic?: boolean;
}

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

interface YtDlpStatus {
  available: boolean;
  path: string | null;
  hint: string;
}

interface FfmpegStatus {
  available: boolean;
  path: string | null;
  hint: string;
}

interface ModelStatus {
  path: string;
  models_dir: string;
  ready: boolean;
  hint: string;
  installed: string[];
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
  const [modelDownloading, setModelDownloading] = useState(false);
  const [modelDownloadProgress, setModelDownloadProgress] = useState<DownloadProgress | null>(
    null,
  );
  const [ytDlpStatus, setYtDlpStatus] = useState<YtDlpStatus | null>(null);
  const [ytDlpInstalling, setYtDlpInstalling] = useState(false);
  const [ytDlpInstallProgress, setYtDlpInstallProgress] = useState<DownloadProgress | null>(
    null,
  );
  const [ffmpegStatus, setFfmpegStatus] = useState<FfmpegStatus | null>(null);
  const [ffmpegInstalling, setFfmpegInstalling] = useState(false);
  const [ffmpegInstallProgress, setFfmpegInstallProgress] = useState<DownloadProgress | null>(
    null,
  );
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(
    null,
  );
  const [urlJobActive, setUrlJobActive] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const ytDlpAutoRefreshRef = useRef(false);
  const ffmpegAutoRefreshRef = useRef(false);
  const importQueueRef = useRef<string[]>([]);
  const batchMetaRef = useRef<{ current: number; total: number } | null>(null);
  const continueImportQueueRef = useRef<() => void>(() => {});
  const startImportBatchRef = useRef<(paths: string[]) => void>(() => {});

  function clearImportQueue() {
    importQueueRef.current = [];
    batchMetaRef.current = null;
    setBatchProgress(null);
  }

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
      const status = await invoke<ModelStatus>("get_model_status", { model: modelTier });
      setModelStatus(status);
      setModelPath(status.path);
    } catch (e) {
      setError(String(e));
    }
  }, [modelTier]);

  const refreshYtDlpStatus = useCallback(async () => {
    try {
      const status = await invoke<YtDlpStatus>("get_yt_dlp_status");
      setYtDlpStatus(status);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const refreshFfmpegStatus = useCallback(async () => {
    try {
      const status = await invoke<FfmpegStatus>("get_ffmpeg_status");
      setFfmpegStatus(status);
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
    const unlistenProgress = listen<DownloadProgress>("model-download-progress", (event) => {
      setModelDownloading(true);
      setModelDownloadProgress(event.payload);
    });
    const unlistenComplete = listen<string>("model-download-complete", () => {
      setModelDownloading(false);
      setModelDownloadProgress(null);
      void refreshModelStatus();
    });
    const unlistenError = listen<string>("model-download-error", (event) => {
      setModelDownloading(false);
      setModelDownloadProgress(null);
      setError(event.payload);
    });

    return () => {
      void unlistenProgress.then((fn) => fn());
      void unlistenComplete.then((fn) => fn());
      void unlistenError.then((fn) => fn());
    };
  }, [refreshModelStatus]);

  useEffect(() => {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved && LANGUAGE_OPTIONS.some((opt) => opt.value === saved)) {
      setLanguage(saved);
    }

    invoke<YtDlpStatus>("get_yt_dlp_status")
      .then(setYtDlpStatus)
      .catch((e) => setError(String(e)));
    invoke<FfmpegStatus>("get_ffmpeg_status")
      .then(setFfmpegStatus)
      .catch((e) => setError(String(e)));
    invoke("start_managed_tools_refresh").catch(() => {});
  }, []);

  useEffect(() => {
    const unlistenProgress = listen<DownloadProgress>("yt-dlp-install-progress", (event) => {
      ytDlpAutoRefreshRef.current = event.payload.automatic ?? false;
      setYtDlpInstallProgress(event.payload);
      if (!event.payload.automatic) {
        setYtDlpInstalling(true);
      }
    });
    const unlistenComplete = listen<string>("yt-dlp-install-complete", () => {
      const wasAutomatic = ytDlpAutoRefreshRef.current;
      setYtDlpInstalling(false);
      setYtDlpInstallProgress(null);
      void refreshYtDlpStatus();
      if (!wasAutomatic) {
        setStatus("yt-dlp is ready for URL imports.");
      }
    });
    const unlistenError = listen<string>("yt-dlp-install-error", (event) => {
      const wasAutomatic = ytDlpAutoRefreshRef.current;
      setYtDlpInstalling(false);
      setYtDlpInstallProgress(null);
      if (!wasAutomatic) {
        setError(event.payload);
      }
    });

    return () => {
      void unlistenProgress.then((fn) => fn());
      void unlistenComplete.then((fn) => fn());
      void unlistenError.then((fn) => fn());
    };
  }, [refreshYtDlpStatus]);

  useEffect(() => {
    const unlistenProgress = listen<DownloadProgress>("ffmpeg-install-progress", (event) => {
      ffmpegAutoRefreshRef.current = event.payload.automatic ?? false;
      setFfmpegInstallProgress(event.payload);
      if (!event.payload.automatic) {
        setFfmpegInstalling(true);
      }
    });
    const unlistenComplete = listen<string>("ffmpeg-install-complete", () => {
      const wasAutomatic = ffmpegAutoRefreshRef.current;
      setFfmpegInstalling(false);
      setFfmpegInstallProgress(null);
      void refreshFfmpegStatus();
      if (!wasAutomatic) {
        setStatus("ffmpeg is ready for MP3 and video decode.");
      }
    });
    const unlistenError = listen<string>("ffmpeg-install-error", (event) => {
      const wasAutomatic = ffmpegAutoRefreshRef.current;
      setFfmpegInstalling(false);
      setFfmpegInstallProgress(null);
      if (!wasAutomatic) {
        setError(event.payload);
      }
    });

    return () => {
      void unlistenProgress.then((fn) => fn());
      void unlistenComplete.then((fn) => fn());
      void unlistenError.then((fn) => fn());
    };
  }, [refreshFfmpegStatus]);

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
        const paths = payload.paths.filter(isSupportedAudioPath);
        if (paths.length === 0) {
          setError("Drop audio or video files (wav, mp3, m4a, mp4, …).");
          return;
        }
        startImportBatchRef.current(paths);
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
        if (importQueueRef.current.length > 0) {
          continueImportQueueRef.current();
        } else {
          clearImportQueue();
        }
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
          clearImportQueue();
          setStatus(isDownload ? "Download cancelled." : "Transcription cancelled.");
          setError(null);
        } else {
          setError(event.payload.message);
          setStatus(isDownload ? "Download failed." : "Transcription failed.");
          if (!isDownload && importQueueRef.current.length > 0) {
            setStatus(
              `File failed — continuing with ${importQueueRef.current.length} remaining…`,
            );
            continueImportQueueRef.current();
          }
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

  async function downloadSelectedModel() {
    setError(null);
    setModelDownloading(true);
    setModelDownloadProgress({ percent: null, status: "Starting download…" });
    try {
      await invoke("start_model_download", { model: modelTier });
    } catch (e) {
      setModelDownloading(false);
      setModelDownloadProgress(null);
      setError(String(e));
    }
  }

  async function downloadAllModels() {
    setError(null);
    setModelDownloading(true);
    setModelDownloadProgress({ percent: null, status: "Downloading all speech models…" });
    try {
      await invoke("start_download_all_models");
    } catch (e) {
      setModelDownloading(false);
      setModelDownloadProgress(null);
      setError(String(e));
    }
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
      multiple: true,
      filters: [
        {
          name: "Audio",
          extensions: ["wav", "mp3", "m4a", "flac", "ogg", "aac", "mp4", "mov", "webm", "mkv"],
        },
      ],
    });

    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    startImportBatchRef.current(paths);
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
    options?: {
      source?: "mic" | "import" | "url";
      title?: string;
      sourceUrl?: string;
      batch?: { current: number; total: number };
    },
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
    const fileName = path.split(/[/\\]/).pop() ?? path;
    const batchLabel = options?.batch
      ? ` (${options.batch.current} of ${options.batch.total}: ${fileName})`
      : "";
    setStatus(`Transcribing${batchLabel} on ${deviceLabel} (no network)…`);
    setSegments([]);

    try {
      await invoke("start_transcription", {
        audioPath: path,
        useGpu: computeBackend === "gpu",
        source: options?.source,
        title: options?.title,
        language,
        sourceUrl: options?.sourceUrl,
        model: modelTier,
      });
    } catch (e) {
      setBusy(false);
      setError(String(e));
      setStatus("Could not start transcription.");
    }
  }

  function startImportBatch(paths: string[]) {
    const files = paths.filter(isSupportedAudioPath);
    if (files.length === 0) {
      setError("No supported audio or video files in selection.");
      return;
    }
    setError(null);
    if (files.length === 1) {
      clearImportQueue();
      setAudioPath(files[0]);
      setRecordingId(null);
      setSegments([]);
      setStatus(`Selected: ${files[0].split(/[/\\]/).pop()}`);
      return;
    }
    const [first, ...rest] = files;
    importQueueRef.current = rest;
    const batch = { current: 1, total: files.length };
    batchMetaRef.current = batch;
    setBatchProgress(batch);
    setAudioPath(first);
    setRecordingId(null);
    setSegments([]);
    void transcribeFromPath(first, {
      source: "import",
      batch,
    });
  }

  function continueImportQueue() {
    if (importQueueRef.current.length === 0) {
      clearImportQueue();
      return;
    }
    const prev = batchMetaRef.current;
    if (!prev) {
      clearImportQueue();
      return;
    }
    const next = importQueueRef.current.shift()!;
    const batch = { current: prev.current + 1, total: prev.total };
    batchMetaRef.current = batch;
    setBatchProgress(batch);
    setRecordingId(null);
    setSegments([]);
    setAudioPath(next);
    void transcribeFromPath(next, {
      source: "import",
      batch,
    });
  }

  startImportBatchRef.current = startImportBatch;
  continueImportQueueRef.current = continueImportQueue;

  async function installYtDlp() {
    setError(null);
    setYtDlpInstalling(true);
    setYtDlpInstallProgress({ percent: 0, status: "Starting download…" });
    try {
      await invoke("start_yt_dlp_install");
    } catch (e) {
      setYtDlpInstalling(false);
      setYtDlpInstallProgress(null);
      setError(String(e));
    }
  }

  async function installFfmpeg() {
    setError(null);
    setFfmpegInstalling(true);
    setFfmpegInstallProgress({ percent: 0, status: "Starting download…" });
    try {
      await invoke("start_ffmpeg_install");
    } catch (e) {
      setFfmpegInstalling(false);
      setFfmpegInstallProgress(null);
      setError(String(e));
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
        model: modelTier,
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
    clearImportQueue();
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
    clearImportQueue();
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

  async function exportTranscriptFile(
    ext: "txt" | "srt" | "vtt" | "json" | "csv",
    exportCommand: string,
    saveCommand: string,
  ) {
    if (!recordingId) return;
    setError(null);
    try {
      const text = await invoke<string>(exportCommand, { recordingId });
      const path = await invoke<string | null>(saveCommand, {
        contents: text,
        defaultFilename: `${safeExportFilename(activeTitle ?? "transcript")}.${ext}`,
      });
      if (path) {
        setStatus(`Exported ${path.split(/[/\\]/).pop()}.`);
      }
    } catch (e) {
      setError(String(e));
      setStatus(`Could not export ${ext.toUpperCase()}.`);
    }
  }

  async function exportTranscriptBinary(
    ext: string,
    label: string,
    exportCommand: string,
    saveCommand: string,
  ) {
    if (!recordingId) return;
    setError(null);
    try {
      const bytes = await invoke<number[]>(exportCommand, { recordingId });
      const path = await invoke<string | null>(saveCommand, {
        contents: bytes,
        defaultFilename: `${safeExportFilename(activeTitle ?? "transcript")}.${ext}`,
      });
      if (path) {
        setStatus(`Exported ${path.split(/[/\\]/).pop()}.`);
      }
    } catch (e) {
      setError(String(e));
      setStatus(`Could not export ${label}.`);
    }
  }

  async function exportTranscriptTxt() {
    await exportTranscriptFile("txt", "export_transcript_txt", "save_transcript_txt_file");
  }

  async function exportTranscriptSrt() {
    await exportTranscriptFile("srt", "export_transcript_srt", "save_transcript_srt_file");
  }

  async function exportTranscriptVtt() {
    await exportTranscriptFile("vtt", "export_transcript_vtt", "save_transcript_vtt_file");
  }

  async function exportTranscriptJson() {
    await exportTranscriptFile("json", "export_transcript_json", "save_transcript_json_file");
  }

  async function exportTranscriptCsv() {
    await exportTranscriptFile("csv", "export_transcript_csv", "save_transcript_csv_file");
  }

  async function exportTranscriptDocx() {
    await exportTranscriptBinary("docx", "Word", "export_transcript_docx", "save_transcript_docx_file");
  }

  async function exportTranscriptPdf() {
    await exportTranscriptBinary("pdf", "PDF", "export_transcript_pdf", "save_transcript_pdf_file");
  }

  async function exportTranscriptZip() {
    await exportTranscriptBinary("zip", "ZIP bundle", "export_transcript_bundle", "save_transcript_bundle_file");
  }

  async function exportLibraryZip() {
    if (library.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const recordingIds = library.map((item) => item.id);
      const bytes = await invoke<number[]>("export_library_bundle", { recordingIds });
      const stamp = new Date().toISOString().slice(0, 10);
      const path = await invoke<string | null>("save_library_bundle_file", {
        contents: bytes,
        defaultFilename: `wisper-library-${stamp}.zip`,
      });
      if (path) {
        setStatus(`Exported ${library.length} recording${library.length === 1 ? "" : "s"} to ${path.split(/[/\\]/).pop()}.`);
      }
    } catch (e) {
      setError(String(e));
      setStatus("Could not export library.");
    } finally {
      setBusy(false);
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
  const installedModelLabels = MODEL_TIERS.filter((tier) =>
    modelStatus?.installed?.includes(tier.key),
  )
    .map((tier) => tier.label)
    .join(", ");
  const allModelsInstalled =
    modelStatus?.installed?.length === MODEL_TIERS.length;
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
          Drop one or more audio or video files here, or use the buttons below.
        </p>
        {batchProgress && (
          <p className="hint batch-queue" role="status">
            Import queue: file {batchProgress.current} of {batchProgress.total}
          </p>
        )}
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
            Choose audio file(s)
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
            {ytDlpStatus && ytDlpStatus.available && (
              <p className="hint">{ytDlpStatus.hint}</p>
            )}
            {!ytDlpStatus?.available && (
              <div className="ytdlp-banner">
                <p className="hint warn">
                  {ytDlpStatus?.hint ??
                    "URL import needs yt-dlp. Install it once below, or add yt-dlp to your PATH."}
                </p>
                <button
                  type="button"
                  className="primary"
                  onClick={installYtDlp}
                  disabled={busy || isRecording || ytDlpInstalling}
                >
                  {ytDlpInstalling ? "Installing yt-dlp…" : "Install yt-dlp"}
                </button>
                {ytDlpInstalling && ytDlpInstallProgress && (
                  <div className="ytdlp-progress" aria-live="polite">
                    <div
                      className="progress-track"
                      role="progressbar"
                      aria-valuenow={ytDlpInstallProgress.percent ?? 2}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="progress-fill download"
                        style={{
                          width: `${Math.max(ytDlpInstallProgress.percent ?? 2, 2)}%`,
                        }}
                      />
                    </div>
                    <p className="progress-meta">{ytDlpInstallProgress.status}</p>
                  </div>
                )}
              </div>
            )}
            <div className="ffmpeg-import">
              <p className="field-label">MP3 / video decode</p>
              {ffmpegStatus && ffmpegStatus.available && (
                <p className="hint">{ffmpegStatus.hint}</p>
              )}
              {!ffmpegStatus?.available && (
                <div className="ytdlp-banner">
                  <p className="hint warn">
                    {ffmpegStatus?.hint ??
                      "Some MP3 and video files need ffmpeg for full-length decode. Install once below, or add ffmpeg to your PATH."}
                  </p>
                  <button
                    type="button"
                    className="primary"
                    onClick={installFfmpeg}
                    disabled={busy || isRecording || ffmpegInstalling}
                  >
                    {ffmpegInstalling ? "Installing ffmpeg…" : "Install ffmpeg"}
                  </button>
                  {ffmpegInstalling && ffmpegInstallProgress && (
                    <div className="ytdlp-progress" aria-live="polite">
                      <div
                        className="progress-track"
                        role="progressbar"
                        aria-valuenow={ffmpegInstallProgress.percent ?? 2}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          className="progress-fill download"
                          style={{
                            width: `${Math.max(ffmpegInstallProgress.percent ?? 2, 2)}%`,
                          }}
                        />
                      </div>
                      <p className="progress-meta">{ffmpegInstallProgress.status}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
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
              disabled={busy || isRecording || modelDownloading}
            >
              {MODEL_TIERS.map((tier) => (
                <option key={tier.key} value={tier.key}>
                  {tier.label} ({tier.size})
                  {modelStatus?.installed?.includes(tier.key) ? " ✓" : ""}
                </option>
              ))}
            </select>
            <p className="hint">
              Transcription uses the selected size. Install each tier once; switch anytime.
            </p>
            {modelStatus?.ready ? (
              <p className="model-ready">{modelStatus.hint}</p>
            ) : (
              <p className="model-missing">{modelStatus?.hint ?? "Checking model…"}</p>
            )}
            {installedModelLabels && (
              <p className="hint">Installed: {installedModelLabels}</p>
            )}
            {modelDownloading && modelDownloadProgress && (
              <p className="hint" aria-live="polite">
                {modelDownloadProgress.status}
                {modelDownloadProgress.percent != null
                  ? ` (${modelDownloadProgress.percent}%)`
                  : ""}
              </p>
            )}
            <p className="model-path">{modelPath || "Loading…"}</p>
            <div className="guide-actions">
              {!modelStatus?.ready && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => void downloadSelectedModel()}
                  disabled={modelDownloading || busy || isRecording}
                >
                  Download selected model
                </button>
              )}
              {!allModelsInstalled && (
                <button
                  type="button"
                  onClick={() => void downloadAllModels()}
                  disabled={modelDownloading || busy || isRecording}
                >
                  Download all models
                </button>
              )}
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
            {(ytDlpInstallProgress?.automatic || ffmpegInstallProgress?.automatic) && (
              <>
                <h3 className="advanced-subtitle">Background updates</h3>
                {ytDlpInstallProgress?.automatic && (
                  <p className="hint" aria-live="polite">
                    {ytDlpInstallProgress.status}
                    {ytDlpInstallProgress.percent != null
                      ? ` (${ytDlpInstallProgress.percent}%)`
                      : ""}
                  </p>
                )}
                {ffmpegInstallProgress?.automatic && (
                  <p className="hint" aria-live="polite">
                    {ffmpegInstallProgress.status}
                    {ffmpegInstallProgress.percent != null
                      ? ` (${ffmpegInstallProgress.percent}%)`
                      : ""}
                  </p>
                )}
                <p className="hint">
                  Wisper checks yt-dlp and ffmpeg you installed through the app about once a week.
                </p>
              </>
            )}
          </section>
        </>
      )}

      {(library.length > 0 || libraryQuery.trim()) && (
        <section className="panel library">
          <div className="library-header">
            <h2 className="panel-title">Library</h2>
            {library.length > 0 && (
              <button type="button" onClick={exportLibraryZip} disabled={busy}>
                Export all (ZIP)
              </button>
            )}
          </div>
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
                <button type="button" onClick={exportTranscriptSrt} disabled={busy}>
                  Export SRT
                </button>
                <button type="button" onClick={exportTranscriptVtt} disabled={busy}>
                  Export VTT
                </button>
                <button type="button" onClick={exportTranscriptJson} disabled={busy}>
                  JSON
                </button>
                <button type="button" onClick={exportTranscriptCsv} disabled={busy}>
                  CSV
                </button>
                <button type="button" onClick={exportTranscriptDocx} disabled={busy}>
                  Word
                </button>
                <button type="button" onClick={exportTranscriptPdf} disabled={busy}>
                  PDF
                </button>
                <button type="button" onClick={exportTranscriptZip} disabled={busy}>
                  ZIP
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
