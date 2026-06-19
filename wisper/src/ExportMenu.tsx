import { useEffect, useRef, useState } from "react";

interface ExportMenuProps {
  disabled: boolean;
  onExportTxt: () => void;
  onExportSrt: () => void;
  onExportVtt: () => void;
}

export function ExportMenu({ disabled, onExportTxt, onExportSrt, onExportVtt }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function run(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div className="export-menu" ref={rootRef}>
      <button
        type="button"
        className="export-menu-trigger"
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Export ▾
      </button>
      {open && (
        <div className="export-menu-panel" role="menu">
          <button type="button" role="menuitem" onClick={() => run(onExportTxt)}>
            Plain text (.txt)
          </button>
          <button type="button" role="menuitem" onClick={() => run(onExportSrt)}>
            Subtitles (.srt)
          </button>
          <button type="button" role="menuitem" onClick={() => run(onExportVtt)}>
            WebVTT (.vtt)
          </button>
        </div>
      )}
    </div>
  );
}
