// 02 Voice capture — matches FIG 2: dashed amber recording ring, live timer, steel waveform,
// a live transcript snippet card, and a clear "transcribing fully on-device" status pill.
import { useEffect, useRef, useState } from "react";
import { Box, Button, Chip, CircularProgress, Paper, Stack, Typography } from "@mui/material";
import MicIcon from "@mui/icons-material/Mic";
import StopIcon from "@mui/icons-material/Stop";
import LockClockRoundedIcon from "@mui/icons-material/LockClockRounded";
import ScreenShell, { type NavTab } from "../components/ScreenShell";
import { startRecording, stopRecording, recordingStatus, transcribe } from "../lib/api";
import { cleanSegments } from "../lib/cleanup";
import type { Draft } from "../lib/types";
const MONO = "'IBM Plex Mono', 'Roboto Mono', ui-monospace, monospace";
const AMBER_GLOW_14 = "0 0 0 10px rgba(244,164,30,0.14)";

const BAR_COUNT = 24;
const createWaveform = () => Array.from({ length: BAR_COUNT }, () => 0.04);

export default function CaptureScreen({ draft, setDraft, onDone, onBack, onNav }: {
  draft: Draft; setDraft: (d: Draft) => void; onDone: () => void; onBack: () => void; onNav: (tab: NavTab) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [peak, setPeak] = useState(0);
  const [waveform, setWaveform] = useState<number[]>(createWaveform());
  const [liveSnippet, setLiveSnippet] = useState<string>("");
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
    setLiveSnippet("");
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
      setLiveSnippet(t.text);
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
      active="home"
      onNav={onNav}
      action={(
        <Button variant="outlined" onClick={onBack} sx={{ color: "common.white", borderColor: "rgba(255,255,255,0.2)" }}>
          Cancel
        </Button>
      )}
    >
      <Stack spacing={3} alignItems="center" sx={{ pb: 4 }}>
        <Paper
          variant="outlined"
          sx={{
            width: "100%",
            maxWidth: 720,
            borderRadius: 4,
            p: { xs: 2.5, md: 3.5 },
            bgcolor: "background.paper",
            borderColor: "divider",
          }}
        >
          <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", md: "center" }} spacing={2}>
            <Box>
              <Typography variant="overline" color="text.secondary">Live capture</Typography>
              <Typography variant="h5">{recording ? "Recording…" : "Ready to capture"}</Typography>
            </Box>
            <Chip
              label={recording ? "Mic active" : "Offline ready"}
              sx={{
                bgcolor: recording ? "rgba(244,164,30,0.16)" : "rgba(92,141,178,0.16)",
                color: recording ? "secondary.main" : "primary.main",
                fontWeight: 700,
              }}
            />
          </Stack>

          <Stack alignItems="center" spacing={2.5} sx={{ mt: 3 }}>
            <Box
              sx={{
                width: 132, height: 132, borderRadius: "50%",
                border: recording ? "2px dashed" : "1px dashed",
                borderColor: recording ? "secondary.main" : "divider",
                display: "flex", alignItems: "center", justifyContent: "center",
                bgcolor: recording ? "rgba(244,164,30,0.10)" : "background.default",
                boxShadow: recording ? AMBER_GLOW_14 : "none",
                transition: "box-shadow 200ms ease",
              }}
            >
              <Box sx={{ width: 88, height: 88, borderRadius: "50%", bgcolor: "secondary.main", display: "flex", alignItems: "center", justifyContent: "center", color: "#1E242A" }}>
                {recording ? <StopIcon fontSize="large" /> : <MicIcon fontSize="large" />}
              </Box>
            </Box>

            <Typography variant="h2" sx={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums", fontSize: { xs: 38, md: 52 } }}>
              {mmss}
            </Typography>

            <Stack direction="row" justifyContent="center" alignItems="flex-end" spacing={0.6} sx={{ minHeight: 90, width: "100%", maxWidth: 460 }}>
              {waveform.map((value, index) => (
                <Box key={index} sx={{
                  width: 6,
                  height: `${Math.max(6, value * 110)}px`,
                  bgcolor: value > 0.7 ? "secondary.main" : "primary.main",
                  borderRadius: 2,
                  transition: "height 160ms ease",
                }} />
              ))}
            </Stack>

            {recording && (
              <Paper variant="outlined" sx={{ width: "100%", p: 2, bgcolor: "background.default", borderColor: "divider", borderRadius: 2 }}>
                <Typography variant="body2" sx={{ fontStyle: "italic", color: "text.secondary", minHeight: 24 }}>
                  {liveSnippet ? `"…${liveSnippet.slice(-140)}"` : "Listening for speech…"}
                </Typography>
              </Paper>
            )}

            <Stack direction="row" spacing={1} alignItems="center">
              <LockClockRoundedIcon sx={{ fontSize: 16, color: "text.secondary" }} />
              <Typography variant="caption" sx={{ fontFamily: MONO, letterSpacing: "0.04em", color: "text.secondary", textTransform: "uppercase" }}>
                transcribing fully on-device
              </Typography>
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
            <Button size="large" fullWidth variant="contained" color="secondary" startIcon={<StopIcon />} onClick={stop} sx={{ color: "#1E242A" }}>
              Done speaking
            </Button>
          ) : (
            <Button size="large" fullWidth variant="contained" color="secondary" startIcon={<MicIcon />} onClick={start} sx={{ color: "#1E242A" }}>
              Start recording
            </Button>
          )}
        </Box>

        {err && <Typography color="error">{err}</Typography>}
      </Stack>
    </ScreenShell>
  );
}
