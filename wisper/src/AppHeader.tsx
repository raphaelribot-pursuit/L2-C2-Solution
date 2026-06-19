import { ResonaAppmark } from "./ResonaAppmark";

const WAVE_HEIGHTS = [10, 18, 30, 42, 38, 24, 36, 28, 40, 16, 32, 22];

interface AppHeaderProps {
  isRecording: boolean;
  onGetStarted: () => void;
  onAbout: () => void;
}

export function AppHeader({ isRecording, onGetStarted, onAbout }: AppHeaderProps) {
  return (
    <header className="hero-header">
      <div className="hero-header-row">
        <div className="brand-lockup">
          <ResonaAppmark className="brand-appmark" size={36} />
          <div className="brand-text">
            <h1>
              Resona<span className="brand-dot">.</span>
            </h1>
            <p className="brand-tagline">a private whisper</p>
          </div>
        </div>
        <div className="header-actions">
          {isRecording && (
            <span className="live-badge" aria-live="polite">
              <span className="live-dot" aria-hidden="true" />
              Recording
            </span>
          )}
          <button type="button" className="btn-ghost" onClick={onAbout}>
            About
          </button>
          <button type="button" className="btn-ghost" onClick={onGetStarted}>
            Get started
          </button>
        </div>
      </div>
      <p className="hero-steps" aria-hidden="true">
        <span className="step-on">Voice</span>
        <span className="step-sep">›</span>
        <span>Text</span>
        <span className="step-sep">›</span>
        <span>Export</span>
      </p>
      <div className="wavewrap" aria-hidden="true">
        <div className="wave-bars">
          {WAVE_HEIGHTS.map((height, index) => (
            <span key={index} style={{ height: `${height}px` }} />
          ))}
        </div>
        <p className="wave-caption">Drop audio below or start recording</p>
      </div>
    </header>
  );
}
