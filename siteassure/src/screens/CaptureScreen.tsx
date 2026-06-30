// 02 Voice capture — record on-device, transcribe, hand off to Confirm.
import { useEffect, useRef, useState } from "react";
import { Box, Button, Stack, Typography, CircularProgress, Paper } from "@mui/material";
import MicIcon from "@mui/icons-material/Mic";
import StopIcon from "@mui/icons-material/Stop";
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
    <Box sx={{ p: 2, textAlign: "center" }}>
      <Button onClick={onBack} sx={{ position: "absolute", top: 16, left: 16 }}>Back</Button>
      <Typography variant="h3" sx={{ mt: 4, mb: 1 }}>Voice capture</Typography>
      <Typography variant="body2" color="text.secondary">On-device transcription · no network needed</Typography>

      <Paper variant="outlined" sx={{ mt: 4, p: 3, bgcolor: "background.paper" }}>
        <Typography variant="h1" sx={{ fontVariantNumeric: "tabular-nums", mb: 2 }}>{mmss}</Typography>
        <Stack direction="row" justifyContent="center" alignItems="flex-end" spacing={0.5} sx={{ minHeight: 120, mb: 2 }}>
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
        <Typography variant="body2" color={peak < 0.08 && recording ? "error.main" : "text.secondary"}>
          {signal}
        </Typography>
      </Paper>

      <Box sx={{ mt: 4 }}>
        {busy ? (
          <Stack alignItems="center" spacing={2}><CircularProgress color="secondary" /><Typography>{busy}</Typography></Stack>
        ) : recording ? (
          <Button size="large" variant="contained" color="secondary" startIcon={<StopIcon />} onClick={stop}>
            Done speaking
          </Button>
        ) : (
          <Button size="large" variant="contained" color="secondary" startIcon={<MicIcon />} onClick={start}>
            Start recording
          </Button>
        )}
      </Box>

      {err && <Typography color="error" sx={{ mt: 2 }}>{err}</Typography>}
    </Box>
  );
}
