// 00 First-run setup — installs the on-device dependencies (voice model + ffmpeg) with progress,
// so a non-technical user never touches the terminal. Skippable (transcribe will self-provision).
import { useEffect, useRef, useState } from "react";
import { Box, Button, LinearProgress, Paper, Stack, Typography } from "@mui/material";
import ScreenShell from "../components/ScreenShell";
import { setupStatus, downloadModel, downloadFfmpeg, onSetupProgress } from "../lib/api";
import type { SetupStatus, SetupProgress } from "../lib/api";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);

function DepRow({ label, size, ready, prog, installing }: {
  label: string; size: string; ready: boolean; prog?: SetupProgress; installing: boolean;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle2">
          {label} <Typography component="span" variant="caption" color="text.secondary">· {size}</Typography>
        </Typography>
        <Typography variant="caption" color={ready ? "secondary.dark" : "text.secondary"}>
          {ready ? "Installed" : prog ? prog.status : "Not installed"}
        </Typography>
      </Stack>
      {!ready && installing && (
        <LinearProgress
          variant={prog?.percent != null ? "determinate" : "indeterminate"}
          value={prog?.percent ?? 0}
          color="secondary"
          sx={{ mt: 1, height: 8, borderRadius: 4 }}
        />
      )}
    </Paper>
  );
}

export default function SetupScreen({ onReady }: { onReady: () => void }) {
  const [status, setStatus] = useState<SetupStatus>();
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<Record<string, SetupProgress>>({});
  const [err, setErr] = useState<string>();
  const unlisten = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    if (!inTauri) { onReady(); return; }            // browser preview — skip setup
    setupStatus()
      .then((s) => { setStatus(s); if (s.modelReady) onReady(); })
      .catch(() => onReady());                       // backend unavailable — don't block
    return () => { unlisten.current?.(); };
  }, []);

  const install = async () => {
    setInstalling(true); setErr(undefined);
    try {
      unlisten.current = await onSetupProgress((p) => setProgress((m) => ({ ...m, [p.component]: p })));
      if (!status?.modelReady) await downloadModel();
      if (!status?.ffmpegReady) await downloadFfmpeg();
      const s = await setupStatus();
      setStatus(s);
      if (s.modelReady) onReady();
    } catch (e) {
      setErr(String(e));
      setInstalling(false);
    }
  };

  if (!status) {
    return (
      <ScreenShell title="SiteAssure" subtitle="Checking your device…" eyebrow="Setup">
        <Box sx={{ py: 4 }}><LinearProgress color="secondary" /></Box>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell
      title="Set up SiteAssure"
      subtitle="A one-time install of the on-device voice model and audio tools. No account, and nothing leaves your device."
      eyebrow="First run"
    >
      <Stack spacing={2} sx={{ pb: 2 }}>
        <DepRow label="On-device voice model (Whisper)" size="~1.6 GB" ready={status.modelReady} prog={progress.model} installing={installing} />
        <DepRow label="Audio tools (ffmpeg)" size="~80 MB" ready={status.ffmpegReady} prog={progress.ffmpeg} installing={installing} />

        {err && <Typography color="error" variant="body2">{err}</Typography>}

        <Button variant="contained" color="secondary" size="large" disabled={installing} onClick={install}>
          {installing ? "Installing…" : "Download & install"}
        </Button>
        <Button onClick={onReady} disabled={installing} sx={{ alignSelf: "center" }}>
          Skip for now
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center" }}>
          Needs a network connection once; everything runs offline afterward.
        </Typography>
      </Stack>
    </ScreenShell>
  );
}
