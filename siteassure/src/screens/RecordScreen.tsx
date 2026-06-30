// 05 Record & audit history — verified badge, version history, amend-with-reason.
import { useEffect, useMemo, useState } from "react";
import { Box, Button, Card, CardContent, Chip, Divider, Paper, Stack, TextField, Typography } from "@mui/material";
import VerifiedIcon from "@mui/icons-material/Verified";
import GppMaybeIcon from "@mui/icons-material/GppMaybe";
import ScreenShell from "../components/ScreenShell";
import { getRecord, amendRecord } from "../lib/api";
import { diffText } from "../lib/diff";
import type { RecordWithHistory } from "../lib/types";

export default function RecordScreen({ id, onHome }: { id: string; onHome: () => void }) {
  const [rec, setRec] = useState<RecordWithHistory>();
  const [err, setErr] = useState<string>();
  const [reason, setReason] = useState("");
  const [narrative, setNarrative] = useState("");
  const [amending, setAmending] = useState(false);

  const load = () =>
    getRecord(id)
      .then((r) => {
        setRec(r);
        const last = r.versions[r.versions.length - 1];
        setNarrative(last?.narrative ?? "");
      })
      .catch((e) => setErr(String(e)));

  useEffect(() => { load(); }, [id]);

  const current = rec?.versions[rec.versions.length - 1];
  const previous = rec?.versions[rec.versions.length - 2];
  const diff = useMemo(() => {
    if (!current) return [];
    return diffText(previous?.narrative ?? current.narrative, narrative);
  }, [previous?.narrative, current?.narrative, narrative]);

  const amend = async () => {
    if (!reason.trim()) { setErr("A reason is required to amend."); return; }
    setAmending(true); setErr(undefined);
    try {
      await amendRecord(id, { narrative }, reason);
      setReason("");
      await load();
    } catch (e) { setErr(String(e)); }
    finally { setAmending(false); }
  };

  if (!rec) {
    return (
      <ScreenShell title="Record" subtitle="Loading the latest audit trail." eyebrow="Inspection record" action={<Button variant="outlined" onClick={onHome} sx={{ color: "common.white", borderColor: "rgba(255,255,255,0.2)" }}>Home</Button>}>
        <Typography color="error">{err}</Typography>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell
      title={`${rec.kind} record`}
      subtitle="Evidence trail, version history, and amendment workflow in one place."
      eyebrow="Audit review"
      action={(
        <Button variant="outlined" onClick={onHome} sx={{ color: "common.white", borderColor: "rgba(255,255,255,0.2)" }}>
          Home
        </Button>
      )}
    >
      <Stack spacing={3} sx={{ pb: 2 }}>
        <Paper variant="outlined" sx={{ p: { xs: 2.2, md: 2.6 }, borderRadius: 3, bgcolor: "grey.50" }}>
          <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }} spacing={1.5}>
            <Box>
              <Typography variant="overline" color="text.secondary">Current status</Typography>
              <Typography variant="h5">{rec.kind}</Typography>
            </Box>
            {rec.auditVerified ? (
              <Chip icon={<VerifiedIcon />} color="secondary" size="small" label="Audit verified" />
            ) : (
              <Chip icon={<GppMaybeIcon />} color="error" size="small" label="Tampering detected" />
            )}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: { xs: 2.2, md: 2.6 }, borderRadius: 3 }}>
          <Typography variant="h6">Version history</Typography>
          <Stack spacing={1.5} sx={{ mt: 2 }}>
            {rec.versions.map((v) => (
              <Card key={v.version} variant="outlined" sx={{ borderColor: "divider", borderRadius: 2 }}>
                <CardContent>
                  <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems="flex-start" spacing={1}>
                    <Typography variant="subtitle2">v{v.version} · {v.author} · {new Date(v.createdAt).toLocaleString()}</Typography>
                    {v.reason && <Typography variant="caption" color="text.secondary">Reason: {v.reason}</Typography>}
                  </Stack>
                  <Typography variant="body2" sx={{ mt: 1, whiteSpace: "pre-wrap" }}>{v.narrative}</Typography>
                </CardContent>
              </Card>
            ))}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: { xs: 2.2, md: 2.6 }, borderRadius: 3 }}>
          <Typography variant="h6">Amend record</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Edit the cleaned narrative, then save with a required amendment reason.
          </Typography>
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" gutterBottom>Before / after diff</Typography>
          <Typography component="div" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word", mt: 1 }}>
            {diff.map((segment, idx) => (
              <Box
                component="span"
                key={idx}
                sx={{
                  color: segment.type === "removed" ? "error.main" : segment.type === "added" ? "success.dark" : "text.primary",
                  backgroundColor: segment.type === "same" ? "transparent" : segment.type === "removed" ? "rgba(244, 67, 54, 0.08)" : "rgba(56, 142, 60, 0.12)",
                  px: segment.type === "same" ? 0 : 0.4,
                  borderRadius: 0.5,
                }}
              >
                {segment.text}
              </Box>
            ))}
          </Typography>
          <TextField label="Narrative" multiline minRows={3} fullWidth value={narrative} onChange={(e) => setNarrative(e.target.value)} sx={{ my: 2 }} />
          <TextField label="Reason (required)" fullWidth value={reason} onChange={(e) => setReason(e.target.value)} />
          {err && <Typography color="error" variant="body2" sx={{ mt: 1 }}>{err}</Typography>}
          <Button variant="contained" color="secondary" disabled={amending} onClick={amend} sx={{ mt: 2 }}>
            {amending ? "Amending…" : "Save amendment"}
          </Button>
        </Paper>
      </Stack>
    </ScreenShell>
  );
}
