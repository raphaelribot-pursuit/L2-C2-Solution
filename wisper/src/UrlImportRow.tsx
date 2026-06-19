interface DownloadProgress {
  percent: number | null;
  status: string;
}

interface YtDlpStatus {
  available: boolean;
  path: string | null;
  hint: string;
}

interface UrlImportRowProps {
  urlInput: string;
  busy: boolean;
  isRecording: boolean;
  ytDlpStatus: YtDlpStatus | null;
  ytDlpInstalling: boolean;
  ytDlpInstallProgress: DownloadProgress | null;
  onUrlChange: (value: string) => void;
  onImport: () => void;
  onInstallYtDlp: () => void;
}

export function UrlImportRow({
  urlInput,
  busy,
  isRecording,
  ytDlpStatus,
  ytDlpInstalling,
  ytDlpInstallProgress,
  onUrlChange,
  onImport,
  onInstallYtDlp,
}: UrlImportRowProps) {
  const canImport = ytDlpStatus?.available && urlInput.trim().length > 0;

  return (
    <div className="url-block">
      <label className="field-label" htmlFor="url-input-main">
        Import from URL
      </label>
      <div className="url-row">
        <input
          id="url-input-main"
          type="url"
          className="url-input"
          placeholder="https://www.youtube.com/watch?v=…"
          value={urlInput}
          onChange={(e) => onUrlChange(e.target.value)}
          disabled={busy || isRecording}
        />
        <button
          type="button"
          className={`primary${!canImport ? " disabled-muted" : ""}`}
          onClick={onImport}
          disabled={busy || isRecording || !canImport}
        >
          Download &amp; transcribe
        </button>
      </div>
      {ytDlpStatus?.available && <p className="hint">{ytDlpStatus.hint}</p>}
      {!ytDlpStatus?.available && (
        <div className="ytdlp-banner">
          <p className="hint warn">
            {ytDlpStatus?.hint ??
              "URL import needs yt-dlp. Install it once below, or add yt-dlp to your PATH."}
          </p>
          <button
            type="button"
            className="primary"
            onClick={onInstallYtDlp}
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
    </div>
  );
}
