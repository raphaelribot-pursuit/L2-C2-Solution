import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

export const GUIDE_COMPLETE_KEY = "wisper-guide-complete";

const MODEL_TIERS = [
  { key: "tiny", label: "Small", size: "~75 MB" },
  { key: "base", label: "Medium", size: "~150 MB" },
  { key: "large-turbo", label: "Large", size: "~1.6 GB" },
] as const;

interface DownloadProgress {
  percent: number | null;
  status: string;
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

type GuideStep = "welcome" | "system" | "model" | "how" | "done";

interface SystemProfile {
  total_ram_mb: number;
  cpu_architecture: string;
  physical_cores: number;
  gpu_available: boolean;
  gpu_backend: string | null;
  models_dir_free_mb: number | null;
}

interface ModelRecommendation {
  model_key: string;
  model_label: string;
  model_size: string;
  backend: "cpu" | "gpu";
  reason: string;
}

interface HardwareAdvice {
  profile: SystemProfile;
  benchmark: { ran: boolean; elapsed_ms: number };
  recommendation: ModelRecommendation;
}

interface WelcomeGuideProps {
  open: boolean;
  modelReady: boolean;
  modelTier: string;
  onModelTierChange: (tier: string) => void;
  onApplyRecommendation: (rec: ModelRecommendation) => void;
  onFinish: () => void;
  onRefreshModel: () => Promise<void>;
}

export function WelcomeGuide({
  open: visible,
  modelReady,
  modelTier,
  onModelTierChange,
  onApplyRecommendation,
  onFinish,
  onRefreshModel,
}: WelcomeGuideProps) {
  const [step, setStep] = useState<GuideStep>("welcome");
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [hardwareAdvice, setHardwareAdvice] = useState<HardwareAdvice | null>(null);
  const [hardwareLoading, setHardwareLoading] = useState(false);
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

  useEffect(() => {
    if (!visible) return;
    setStep("welcome");
    setError(null);
    setDownloadProgress(null);
    setDownloading(false);
    setHardwareAdvice(null);
    setHardwareLoading(false);
    setYtDlpStatus(null);
    setYtDlpInstalling(false);
    setYtDlpInstallProgress(null);
    setFfmpegStatus(null);
    setFfmpegInstalling(false);
    setFfmpegInstallProgress(null);
  }, [visible]);

  useEffect(() => {
    if (!visible || step !== "system") return;
    let cancelled = false;
    setHardwareLoading(true);
    setError(null);
    invoke<HardwareAdvice>("get_hardware_advice")
      .then((advice) => {
        if (!cancelled) setHardwareAdvice(advice);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setHardwareLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, step]);

  useEffect(() => {
    if (!visible || !downloading) return;

    const unlistenProgress = listen<DownloadProgress>(
      "model-download-progress",
      (event) => {
        setDownloadProgress(event.payload);
      },
    );
    const unlistenComplete = listen<string>("model-download-complete", async () => {
      setDownloading(false);
      setDownloadProgress(null);
      await onRefreshModel();
      setStep("how");
    });
    const unlistenError = listen<string>("model-download-error", (event) => {
      setDownloading(false);
      setDownloadProgress(null);
      setError(event.payload);
    });

    return () => {
      void unlistenProgress.then((fn) => fn());
      void unlistenComplete.then((fn) => fn());
      void unlistenError.then((fn) => fn());
    };
  }, [visible, downloading, onRefreshModel]);

  useEffect(() => {
    if (!visible || step !== "how") return;
    invoke<YtDlpStatus>("get_yt_dlp_status")
      .then(setYtDlpStatus)
      .catch((e) => setError(String(e)));
    invoke<FfmpegStatus>("get_ffmpeg_status")
      .then(setFfmpegStatus)
      .catch((e) => setError(String(e)));
  }, [visible, step]);

  useEffect(() => {
    if (!visible || !ytDlpInstalling) return;

    const unlistenProgress = listen<DownloadProgress>(
      "yt-dlp-install-progress",
      (event) => {
        setYtDlpInstallProgress(event.payload);
      },
    );
    const unlistenComplete = listen<string>("yt-dlp-install-complete", async () => {
      setYtDlpInstalling(false);
      setYtDlpInstallProgress(null);
      const status = await invoke<YtDlpStatus>("get_yt_dlp_status");
      setYtDlpStatus(status);
    });
    const unlistenError = listen<string>("yt-dlp-install-error", (event) => {
      setYtDlpInstalling(false);
      setYtDlpInstallProgress(null);
      setError(event.payload);
    });

    return () => {
      void unlistenProgress.then((fn) => fn());
      void unlistenComplete.then((fn) => fn());
      void unlistenError.then((fn) => fn());
    };
  }, [visible, ytDlpInstalling]);

  useEffect(() => {
    if (!visible || !ffmpegInstalling) return;

    const unlistenProgress = listen<DownloadProgress>(
      "ffmpeg-install-progress",
      (event) => {
        setFfmpegInstallProgress(event.payload);
      },
    );
    const unlistenComplete = listen<string>("ffmpeg-install-complete", async () => {
      setFfmpegInstalling(false);
      setFfmpegInstallProgress(null);
      const status = await invoke<FfmpegStatus>("get_ffmpeg_status");
      setFfmpegStatus(status);
    });
    const unlistenError = listen<string>("ffmpeg-install-error", (event) => {
      setFfmpegInstalling(false);
      setFfmpegInstallProgress(null);
      setError(event.payload);
    });

    return () => {
      void unlistenProgress.then((fn) => fn());
      void unlistenComplete.then((fn) => fn());
      void unlistenError.then((fn) => fn());
    };
  }, [visible, ffmpegInstalling]);

  if (!visible) return null;

  function goNextFromWelcome() {
    if (modelReady) {
      setStep("how");
    } else {
      setStep("system");
    }
  }

  function useRecommended() {
    if (!hardwareAdvice) return;
    onApplyRecommendation(hardwareAdvice.recommendation);
    setStep("model");
  }

  async function refreshSystemCheck() {
    setHardwareLoading(true);
    setError(null);
    try {
      const advice = await invoke<HardwareAdvice>("get_hardware_advice");
      setHardwareAdvice(advice);
    } catch (e) {
      setError(String(e));
    } finally {
      setHardwareLoading(false);
    }
  }

  async function startDownload() {
    setError(null);
    setDownloading(true);
    setDownloadProgress({ percent: 0, status: "Starting download…" });
    try {
      await invoke("start_model_download", { model: modelTier });
    } catch (e) {
      setDownloading(false);
      setDownloadProgress(null);
      setError(String(e));
    }
  }

  async function pickExistingModel() {
    setError(null);
    const selected = await open({
      multiple: false,
      filters: [{ name: "Speech model", extensions: ["bin"] }],
    });
    if (!selected || typeof selected !== "string") return;

    setDownloading(true);
    setDownloadProgress({ percent: null, status: "Copying model file…" });
    try {
      await invoke("import_model_from_path", { sourcePath: selected });
      await onRefreshModel();
      setStep("how");
    } catch (e) {
      setError(String(e));
    } finally {
      setDownloading(false);
      setDownloadProgress(null);
    }
  }

  async function startYtDlpInstall() {
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

  async function startFfmpegInstall() {
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

  function finish() {
    localStorage.setItem(GUIDE_COMPLETE_KEY, "1");
    onFinish();
  }

  const progressPercent = downloadProgress?.percent ?? (downloading ? 2 : 0);
  const ytDlpProgressPercent =
    ytDlpInstallProgress?.percent ?? (ytDlpInstalling ? 2 : 0);
  const ffmpegProgressPercent =
    ffmpegInstallProgress?.percent ?? (ffmpegInstalling ? 2 : 0);

  return (
    <div className="guide-backdrop" role="presentation">
      <div
        className="guide-dialog panel"
        role="dialog"
        aria-labelledby="guide-title"
        aria-modal="true"
      >
        {step === "welcome" && (
          <>
            <p className="guide-eyebrow">Welcome</p>
            <h2 id="guide-title">Turn speech into text</h2>
            <p className="guide-lead">
              Wisper listens to recordings or audio files and writes out the words for you.
              Everything stays on your computer — nothing is uploaded.
            </p>
            <button type="button" className="primary guide-primary" onClick={goNextFromWelcome}>
              Get started
            </button>
          </>
        )}

        {step === "system" && (
          <>
            <p className="guide-eyebrow">Check your system</p>
            <h2 id="guide-title">Find the right model</h2>
            <p className="guide-lead">
              Wisper runs entirely on your computer. A quick check helps pick a model size
              that fits your hardware.
            </p>
            {hardwareLoading && !hardwareAdvice && (
              <p className="hint">Reading your system…</p>
            )}
            {hardwareAdvice && (
              <div className="system-profile">
                <p className="hint">
                  {hardwareAdvice.profile.cpu_architecture} ·{" "}
                  {Math.round(hardwareAdvice.profile.total_ram_mb / 1024)} GB RAM ·{" "}
                  {hardwareAdvice.profile.physical_cores} cores
                  {hardwareAdvice.profile.gpu_backend
                    ? ` · ${hardwareAdvice.profile.gpu_backend}`
                    : " · CPU only"}
                </p>
                <p className="guide-note">
                  <strong>
                    Recommended: {hardwareAdvice.recommendation.model_label} (
                    {hardwareAdvice.recommendation.model_size})
                  </strong>
                  {" — "}
                  {hardwareAdvice.recommendation.reason}
                </p>
                <p className="hint">
                  Quick test finished in {hardwareAdvice.benchmark.elapsed_ms} ms.
                </p>
              </div>
            )}
            {error && <p className="error">{error}</p>}
            <div className="guide-actions">
              <button
                type="button"
                className="primary"
                onClick={useRecommended}
                disabled={hardwareLoading || !hardwareAdvice}
              >
                Use recommended
              </button>
              <button
                type="button"
                onClick={() => setStep("model")}
                disabled={hardwareLoading}
              >
                Choose myself
              </button>
              <button
                type="button"
                onClick={() => void refreshSystemCheck()}
                disabled={hardwareLoading}
              >
                {hardwareLoading ? "Running test…" : "Run quick test again"}
              </button>
            </div>
          </>
        )}

        {step === "model" && (
          <>
            <p className="guide-eyebrow">Step 1 of 2</p>
            <h2 id="guide-title">Download the speech model</h2>
            <p className="guide-lead">
              Wisper needs a one-time download before it can understand speech.
              Pick a size for your computer — you only do this once.
            </p>
            <label className="field-label" htmlFor="guide-model-tier">
              Model size
            </label>
            <select
              id="guide-model-tier"
              className="language-select"
              value={modelTier}
              onChange={(e) => onModelTierChange(e.target.value)}
              disabled={downloading}
            >
              {MODEL_TIERS.map((tier) => (
                <option key={tier.key} value={tier.key}>
                  {tier.label} ({tier.size})
                </option>
              ))}
            </select>
            <p className="hint">
              Not sure? Go back to Check your system from Get started anytime.
            </p>
            {downloading && (
              <div className="guide-progress" aria-live="polite">
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-valuenow={progressPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="progress-fill download"
                    style={{ width: `${Math.max(progressPercent, 2)}%` }}
                  />
                </div>
                <p className="progress-meta">{downloadProgress?.status ?? "Downloading…"}</p>
              </div>
            )}
            {error && <p className="error">{error}</p>}
            <div className="guide-actions">
              <button
                type="button"
                className="primary"
                onClick={startDownload}
                disabled={downloading}
              >
                {downloading ? "Downloading…" : "Download speech model"}
              </button>
              <button
                type="button"
                onClick={pickExistingModel}
                disabled={downloading}
              >
                I already have a model file
              </button>
            </div>
            {modelReady && (
              <button type="button" className="guide-skip" onClick={() => setStep("how")}>
                Skip — model already installed
              </button>
            )}
          </>
        )}

        {step === "how" && (
          <>
            <p className="guide-eyebrow">Step 2 of 2</p>
            <h2 id="guide-title">How to transcribe</h2>
            <ol className="guide-steps">
              <li>
                <strong>Record</strong> — tap Record, speak, then Stop & transcribe.
              </li>
              <li>
                <strong>Or choose a file</strong> — pick an audio or video file from your
                computer.
              </li>
              <li>
                <strong>Or paste a URL</strong> — YouTube and other sites (optional; needs yt-dlp
                once).
              </li>
              <li>
                <strong>Read the transcript</strong> — your words appear below. You can copy or
                export them.
              </li>
            </ol>
            {!ytDlpStatus?.available && (
              <div className="ytdlp-banner">
                <p className="guide-note">
                  Optional: install yt-dlp now for URL import, or skip and use files and recording
                  only.
                </p>
                <button
                  type="button"
                  className="primary"
                  onClick={startYtDlpInstall}
                  disabled={ytDlpInstalling}
                >
                  {ytDlpInstalling ? "Installing yt-dlp…" : "Install yt-dlp"}
                </button>
                {ytDlpInstalling && (
                  <div className="guide-progress" aria-live="polite">
                    <div
                      className="progress-track"
                      role="progressbar"
                      aria-valuenow={ytDlpProgressPercent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="progress-fill download"
                        style={{ width: `${Math.max(ytDlpProgressPercent, 2)}%` }}
                      />
                    </div>
                    <p className="progress-meta">
                      {ytDlpInstallProgress?.status ?? "Downloading…"}
                    </p>
                  </div>
                )}
              </div>
            )}
            {ytDlpStatus?.available && (
              <p className="hint">{ytDlpStatus.hint}</p>
            )}
            {!ffmpegStatus?.available && (
              <div className="ytdlp-banner">
                <p className="guide-note">
                  Optional: install ffmpeg for reliable MP3 and video import, or skip and use WAV
                  and recording only.
                </p>
                <button
                  type="button"
                  className="primary"
                  onClick={startFfmpegInstall}
                  disabled={ffmpegInstalling}
                >
                  {ffmpegInstalling ? "Installing ffmpeg…" : "Install ffmpeg"}
                </button>
                {ffmpegInstalling && (
                  <div className="guide-progress" aria-live="polite">
                    <div
                      className="progress-track"
                      role="progressbar"
                      aria-valuenow={ffmpegProgressPercent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="progress-fill download"
                        style={{ width: `${Math.max(ffmpegProgressPercent, 2)}%` }}
                      />
                    </div>
                    <p className="progress-meta">
                      {ffmpegInstallProgress?.status ?? "Downloading…"}
                    </p>
                  </div>
                )}
              </div>
            )}
            {ffmpegStatus?.available && (
              <p className="hint">{ffmpegStatus.hint}</p>
            )}
            <p className="guide-note">
              Tip: drag an audio file onto the main window anytime.
            </p>
            <button type="button" className="primary guide-primary" onClick={() => setStep("done")}>
              Continue
            </button>
          </>
        )}

        {step === "done" && (
          <>
            <p className="guide-eyebrow">All set</p>
            <h2 id="guide-title">You&apos;re ready</h2>
            <p className="guide-lead">
              Press Record or choose an audio file to create your first transcript.
            </p>
            <button type="button" className="primary guide-primary" onClick={finish}>
              Start using Wisper
            </button>
          </>
        )}
      </div>
    </div>
  );
}
