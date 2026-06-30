// 02 Voice capture — record on-device, transcribe, hand off to Confirm.
import { useEffect, useRef, useState } from "react";
import { Box, Button, Chip, CircularProgress, Paper, Stack, Typography } from "@mui/material";
import MicIcon from "@mui/icons-material/Mic";
import StopIcon from "@mui/icons-material/Stop";
import ScreenShell from "../components/ScreenShell";
import { startRecording, stopRecording, recordingStatus, transcribe } from "../lib/api";
import { cleanSegments } from "../lib/cleanup";
import type { Draft } from "../lib/types";

const BAR_COUNT = 18;
const createWaveform = () => Array.from({ length: BAR_COUNT }, () => 0.04);

export default function CaptureScreen({ draft, setDraft, onDone, onBack }: {
  draft: Draft; setDraft: (d: Draft) => void; onDone: () => void; onBack: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [peak, setPeak] = useState(0);
  const [waveform, setWaveform] = useState<number[]>(createWaveform());
  const [busy, setBusy] = useState<string>();
  const [err, setErr] = useState<string>();
  const poll = useRef<number | undefined>(undefined);

  const stopPoll = () => { if (poll.current) { window.clearInterval(poll.current); poll.current = undefined; } };
  useEffect(() => stopPoll, []);

  const updateWave = (level: number) => {
    setWaveform((prev) => {
      const next = prev.slice(1);
      const capped = Math.min(1, Math.max(0.02, level + (Math.random() - 0.5) * 0.14));
      next.push(capped);
      return next;
    });
  };

  const start = async () => {
    setErr(undefined);
    try {
      await startRecording();
      setRecording(true);
      setWaveform(createWaveform());
      poll.current = window.setInterval(async () => {
        const s = await recordingStatus();
        if (s) {
          setElapsedMs(s.durationMs);
          setPeak(s.peak);
          updateWave(s.peak);
        }
      }, 220);
    } catch (e) { setErr(String(e)); }
  };

  const stop = async () => {
    stopPoll();
    setRecording(false);
    try {
      setBusy("Saving audio…");
      const path = await stopRecording();
      setBusy("Transcribing on-device…");
      const t = await transcribe(path);
      const narrative = cleanSegments(t.segments) || t.text;
      setDraft({ ...draft, audioPath: path, transcript: t.text, segments: t.segments, narrative });
      setBusy(undefined);
      onDone();
    } catch (e) { setErr(String(e)); setBusy(undefined); }
  };

  const secs = Math.floor(elapsedMs / 1000);
  const mmss = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  const signal = recording ? (peak < 0.08 ? "No signal detected — speak clearly into the mic." : "Listening…") : "Ready to capture your field note offline.";

  return (
    <ScreenShell
      title="Voice capture"
      subtitle="On-device transcription and a clean handoff into the review stage."
      eyebrow="Step 1 of 4"
      action={(
        <Button variant="outlined" onClick={onBack} sx={{ color: "common.white", borderColor: "rgba(255,255,255,0.2)" }}>
          Cancel
        </Button>
      )}
    >
      <Stack spacing={3} alignItems="center" sx={{ pb: 4 }}>
        <Paper variant="outlined" sx={{ width: "100%", maxWidth: 720, borderRadius: 4, p: { xs: 2.5, md: 3.5 }, bgcolor: "grey.50" }}>
          <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", md: "center" }} spacing={2}>
            <Box>
              <Typography variant="overline" color="text.secondary">Live capture</Typography>
              <Typography variant="h5">{recording ? "Recording incoming context" : "Ready to capture"}</Typography>
            </Box>
            <Chip label={recording ? "Mic active" : "Offline ready"} color={recording ? "secondary" : "default"} />
          </Stack>

          <Stack alignItems="center" spacing={2.5} sx={{ mt: 3 }}>
            <Box sx={{ width: 122, height: 122, borderRadius: "50%", border: recording ? "2px solid" : "1px dashed", borderColor: recording ? "secondary.main" : "divider", display: "flex", alignItems: "center", justifyContent: "center", bgcolor: recording ? "rgba(244,164,30,0.12)" : "background.paper", boxShadow: recording ? "0 0 0 10px rgba(244,164,30,0.08)" : "none" }}>
              <Box sx={{ width: 82, height: 82, borderRadius: "50%", bgcolor: "secondary.main", display: "flex", alignItems: "center", justifyContent: "center", color: "common.white" }}>
                {recording ? <StopIcon fontSize="large" /> : <MicIcon fontSize="large" />}
              </Box>
            </Box>

            <Typography variant="h2" sx={{ fontVariantNumeric: "tabular-nums", fontSize: { xs: 38, md: 52 } }}>{mmss}</Typography>

            <Stack direction="row" justifyContent="center" alignItems="flex-end" spacing={0.5} sx={{ minHeight: 110, width: "100%", maxWidth: 420 }}>
              {waveform.map((value, index) => (
                <Box key={index} sx={{
                  width: 8,
                  height: `${Math.max(8, value * 140)}px`,
                  bgcolor: value > 0.7 ? "secondary.main" : "primary.main",
                  borderRadius: 2,
                  transition: "height 160ms ease",
                }} />
              ))}
            </Stack>

            <Typography variant="body1" color={peak < 0.08 && recording ? "error.main" : "text.secondary"} sx={{ textAlign: "center", maxWidth: 560 }}>
              {signal}
            </Typography>
          </Stack>
        </Paper>

        <Box sx={{ width: "100%", maxWidth: 720 }}>
          {busy ? (
            <Stack alignItems="center" spacing={2} sx={{ py: 3 }}>
              <CircularProgress color="secondary" />
              <Typography>{busy}</Typography>
            </Stack>
          ) : recording ? (
            <Button size="large" fullWidth variant="contained" color="secondary" startIcon={<StopIcon />} onClick={stop}>
              Done speaking
            </Button>
          ) : (
            <Button size="large" fullWidth variant="contained" color="secondary" startIcon={<MicIcon />} onClick={start}>
              Start recording
            </Button>
          )}
        </Box>

        {err && <Typography color="error">{err}</Typography>}
      </Stack>
    </ScreenShell>
  );
}
