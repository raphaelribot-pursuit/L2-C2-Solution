import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

export const GUIDE_COMPLETE_KEY = "wisper-guide-complete";

interface DownloadProgress {
  percent: number | null;
  status: string;
}

type GuideStep = "welcome" | "model" | "how" | "done";

interface WelcomeGuideProps {
  open: boolean;
  modelReady: boolean;
  onFinish: () => void;
  onRefreshModel: () => Promise<void>;
}

export function WelcomeGuide({
  open: visible,
  modelReady,
  onFinish,
  onRefreshModel,
}: WelcomeGuideProps) {
  const [step, setStep] = useState<GuideStep>("welcome");
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setStep("welcome");
    setError(null);
    setDownloadProgress(null);
    setDownloading(false);
  }, [visible]);

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

  if (!visible) return null;

  function goNextFromWelcome() {
    setStep(modelReady ? "how" : "model");
  }

  async function startDownload() {
    setError(null);
    setDownloading(true);
    setDownloadProgress({ percent: 0, status: "Starting download…" });
    try {
      await invoke("start_model_download", { model: "base" });
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

  function finish() {
    localStorage.setItem(GUIDE_COMPLETE_KEY, "1");
    onFinish();
  }

  const progressPercent = downloadProgress?.percent ?? (downloading ? 2 : 0);

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

        {step === "model" && (
          <>
            <p className="guide-eyebrow">Step 1 of 2</p>
            <h2 id="guide-title">Download the speech model</h2>
            <p className="guide-lead">
              Wisper needs a one-time download (~150 MB) before it can understand speech.
              You only do this once.
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
                <strong>Read the transcript</strong> — your words appear below. You can copy or
                export them.
              </li>
            </ol>
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
