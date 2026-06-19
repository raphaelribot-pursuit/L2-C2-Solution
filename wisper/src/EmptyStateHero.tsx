interface EmptyStateHeroProps {
  dragOver: boolean;
  modelMissing: boolean;
  isRecording: boolean;
  busy: boolean;
  audioPath: string | null;
  showVideoHint: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onPickFile: () => void;
  onTranscribe: () => void;
  onCancel?: () => void;
}

export function EmptyStateHero({
  dragOver,
  modelMissing,
  isRecording,
  busy,
  audioPath,
  showVideoHint,
  onStartRecording,
  onStopRecording,
  onPickFile,
  onTranscribe,
  onCancel,
}: EmptyStateHeroProps) {
  return (
    <>
      <div
        className={`hero-drop${dragOver ? " drag-over" : ""}${modelMissing ? " dimmed" : ""}`}
        role="presentation"
      >
        <svg
          className="hero-drop-icon"
          viewBox="0 0 48 48"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M24 8v20M16 20l8 8 8-8" />
          <rect x="8" y="32" width="32" height="8" rx="2" />
        </svg>
        <h2 className="hero-drop-title">Drop audio or video here</h2>
        <p className="hero-drop-lead">
          Record, choose a file, or paste a URL — all transcription stays on your device.
        </p>
        <div className="hero-actions">
          {!isRecording ? (
            <button
              type="button"
              className={`record${modelMissing ? " disabled-muted" : ""}`}
              onClick={onStartRecording}
              disabled={busy || modelMissing}
            >
              ● Record
            </button>
          ) : (
            <button type="button" className="record stop" onClick={onStopRecording} disabled={busy}>
              Stop &amp; transcribe
            </button>
          )}
          <button type="button" onClick={onPickFile} disabled={busy || isRecording}>
            Choose file
          </button>
          <button
            type="button"
            className={`primary${!audioPath || modelMissing ? " disabled-muted" : ""}`}
            onClick={onTranscribe}
            disabled={busy || isRecording || !audioPath || modelMissing}
          >
            {busy ? "Transcribing…" : "Transcribe"}
          </button>
          {busy && onCancel && (
            <button type="button" className="cancel" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
      {showVideoHint && (
        <p className="hint warn">
          That looks like video — Resona will extract audio for transcription. For best results,
          try MP3 or WAV if extraction is slow.
        </p>
      )}
      {modelMissing && (
        <p className="hint disabled-hint">Install the speech model first — use Get started above.</p>
      )}
      {!modelMissing && !audioPath && !busy && !isRecording && (
        <p className="hint disabled-hint">Choose or record audio to enable Transcribe.</p>
      )}
    </>
  );
}
