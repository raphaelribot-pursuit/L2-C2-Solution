import { ResonaAppmark } from "./ResonaAppmark";

interface ModelMissingPanelProps {
  onOpenGuide: () => void;
}

export function ModelMissingPanel({ onOpenGuide }: ModelMissingPanelProps) {
  return (
    <section className="setup-panel" aria-live="polite">
      <ResonaAppmark className="setup-appmark" size={56} />
      <h2>One more step</h2>
      <p>
        Resona needs a speech model before it can transcribe. We&apos;ll check your system and
        recommend the right size.
      </p>
      <p className="setup-tiers">Small (~75 MB) · Medium (~150 MB) · Large (~1.6 GB)</p>
      <button type="button" className="primary setup-cta" onClick={onOpenGuide}>
        Open setup guide
      </button>
    </section>
  );
}
