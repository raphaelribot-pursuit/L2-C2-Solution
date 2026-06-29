// 02 Voice capture — record on-device, transcribe, hand off to Confirm.
import { useEffect, useRef, useState } from "react";
import { Box, Button, Stack, Typography, LinearProgress, CircularProgress } from "@mui/material";
import MicIcon from "@mui/icons-material/Mic";
import StopIcon from "@mui/icons-material/Stop";
import { startRecording, stopRecording, recordingStatus, transcribe } from "../lib/api";
import { cleanSegments } from "../lib/cleanup";
import type { Draft } from "../lib/types";

export default function CaptureScreen({ draft, setDraft, onDone, onBack }: {
  draft: Draft; setDraft: (d: Draft) => void; onDone: () => void; onBack: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [peak, setPeak] = useState(0);
  const [busy, setBusy] = useState<string>();
  const [err, setErr] = useState<string>();
  const poll = useRef<number | undefined>(undefined);

  const stopPoll = () => { if (poll.current) { window.clearInterval(poll.current); poll.current = undefined; } };
  useEffect(() => stopPoll, []);

  const start = async () => {
    setErr(undefined);
    try {
      await startRecording();
      setRecording(true);
      poll.current = window.setInterval(async () => {
        const s = await recordingStatus();
        if (s) { setElapsedMs(s.durationMs); setPeak(s.peak); }
      }, 250);
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

  return (
    <Box sx={{ p: 2, textAlign: "center" }}>
      <Button onClick={onBack} sx={{ float: "left" }}>Back</Button>
      <Typography variant="h3" sx={{ mt: 5 }}>Voice capture</Typography>
      <Typography variant="body2" color="text.secondary">On-device · offline</Typography>

      <Typography variant="h1" sx={{ my: 4, fontVariantNumeric: "tabular-nums" }}>{mmss}</Typography>
      <LinearProgress variant="determinate" value={Math.min(100, peak * 100)} color="secondary"
        sx={{ mb: 5, height: 8, borderRadius: 4 }} />

      {busy ? (
        <Stack alignItems="center" spacing={2}><CircularProgress color="secondary" /><Typography>{busy}</Typography></Stack>
      ) : recording ? (
        <Button size="large" variant="contained" color="secondary" startIcon={<StopIcon />} onClick={stop}>Done speaking</Button>
      ) : (
        <Button size="large" variant="contained" color="secondary" startIcon={<MicIcon />} onClick={start}>Start recording</Button>
      )}

      {err && <Typography color="error" sx={{ mt: 2 }}>{err}</Typography>}
    </Box>
  );
}
