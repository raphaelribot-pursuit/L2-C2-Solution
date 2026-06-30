// 05 Record & audit history — verified badge, version history, amend-with-reason.
import { useEffect, useMemo, useState } from "react";
import { Box, Button, Stack, Typography, Chip, Card, CardContent, TextField, Divider, Paper } from "@mui/material";
import VerifiedIcon from "@mui/icons-material/Verified";
import GppMaybeIcon from "@mui/icons-material/GppMaybe";
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
      <Box sx={{ p: 2 }}>
        <Button onClick={onHome}>Home</Button>
        {err && <Typography color="error">{err}</Typography>}
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, pb: 4 }}>
      <Button onClick={onHome} sx={{ mb: 2 }}>Home</Button>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ my: 1 }}>
        <Typography variant="h3">{rec.kind}</Typography>
        {rec.auditVerified ? (
          <Chip icon={<VerifiedIcon />} color="secondary" size="small" label="Audit verified" />
        ) : (
          <Chip icon={<GppMaybeIcon />} color="error" size="small" label="Tampering detected" />
        )}
      </Stack>

      <Typography variant="h3" sx={{ fontSize: 18, mt: 2 }}>Version history</Typography>
      <Stack spacing={1} sx={{ my: 1 }}>
        {rec.versions.map((v) => (
          <Card key={v.version} variant="outlined" sx={{ borderColor: "grey.300" }}>
            <CardContent>
              <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems="flex-start" spacing={1}>
                <Typography variant="subtitle2">
                  v{v.version} · {v.author} · {new Date(v.createdAt).toLocaleString()}
                </Typography>
                {v.reason && <Typography variant="caption" color="text.secondary">Reason: {v.reason}</Typography>}
              </Stack>
              <Typography variant="body2" sx={{ mt: 1, whiteSpace: "pre-wrap" }}>{v.narrative}</Typography>
            </CardContent>
          </Card>
        ))}
      </Stack>

      <Divider sx={{ my: 2 }} />
      <Typography variant="h3" sx={{ fontSize: 18 }}>Amend</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Edit the cleaned narrative, then save with a required amendment reason.
      </Typography>

      <Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: "background.default" }}>
        <Typography variant="subtitle2" gutterBottom>Before / after diff</Typography>
        <Typography component="div" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
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
      </Paper>

      <TextField label="Narrative" multiline minRows={3} fullWidth value={narrative}
        onChange={(e) => setNarrative(e.target.value)} sx={{ my: 1 }} />
      <TextField label="Reason (required)" fullWidth value={reason}
        onChange={(e) => setReason(e.target.value)} sx={{ mb: 1 }} />
      {err && <Typography color="error" variant="body2" sx={{ mb: 1 }}>{err}</Typography>}
      <Button variant="contained" color="secondary" disabled={amending} onClick={amend}>
        {amending ? "Amending…" : "Save amendment"}
      </Button>
    </Box>
  );
}
