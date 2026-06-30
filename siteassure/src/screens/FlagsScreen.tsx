// 04 Safety flags — run the deterministic engine, accept/dismiss/note, then save the record.
import { useEffect, useState } from "react";
import { Box, Button, Card, CardContent, Chip, Paper, Stack, TextField, Typography } from "@mui/material";
import ScreenShell from "../components/ScreenShell";
import { scanFlags, saveRecord } from "../lib/api";
import type { Draft, SafetyFlag } from "../lib/types";

export default function FlagsScreen({ draft, setDraft, onSaved, onBack }: {
  draft: Draft; setDraft: (d: Draft) => void; onSaved: (id: string) => void; onBack: () => void;
}) {
  const [flags, setFlags] = useState<SafetyFlag[]>(draft.flags);
  const [err, setErr] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (draft.flags.length) return;
    scanFlags(draft.narrative, draft.fields.tradeNaics)
      .then((hits) => setFlags(hits.map((h) => ({ ...h, status: "open" as const }))))
      .catch((e) => setErr(String(e)));
  }, []);

  const setStatus = (i: number, status: SafetyFlag["status"]) =>
    setFlags((fs) => fs.map((f, j) => (j === i ? { ...f, status } : f)));
  const setNote = (i: number, note: string) =>
    setFlags((fs) => fs.map((f, j) => (j === i ? { ...f, note } : f)));

  const save = async () => {
    setSaving(true); setErr(undefined);
    try {
      const id = await saveRecord({
        kind: draft.kind,
        site: draft.fields.site,
        tradeNaics: draft.fields.tradeNaics,
        transcript: draft.transcript,
        narrative: draft.narrative,
        fieldsJson: JSON.stringify(draft.fields),
        flagsJson: JSON.stringify(flags),
        audioPath: draft.audioPath,
      });
      setDraft({ ...draft, flags });
      onSaved(id);
    } catch (e) { setErr(String(e)); setSaving(false); }
  };

  return (
    <ScreenShell
      title="Safety flags"
      subtitle="Review each finding, document your decision, and save a defensible record."
      eyebrow="Step 3 of 4"
      action={(
        <Button variant="outlined" onClick={onBack} sx={{ color: "common.white", borderColor: "rgba(255,255,255,0.2)" }}>
          Back
        </Button>
      )}
    >
      <Stack spacing={3} sx={{ pb: 2 }}>
        {flags.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 3, borderRadius: 3, bgcolor: "grey.50" }}>
            <Typography variant="h6">No flags raised</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              The narrative did not match any safety patterns, or the capture is too short.
            </Typography>
          </Paper>
        ) : (
          <Stack spacing={2}>
            {flags.map((f, i) => (
              <Card key={f.code + i} variant="outlined" sx={{ borderRadius: 3, borderColor: "divider" }}>
                <CardContent>
                  <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }} spacing={1.5}>
                    <Box>
                      <Typography variant="h6">{f.title}</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{f.rationale}</Typography>
                    </Box>
                    <Chip size="small" label={f.status} color={f.status === "accepted" ? "secondary" : f.status === "dismissed" ? "default" : "warning"} />
                  </Stack>
                  {f.oshaContext && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
                      {f.oshaContext}
                    </Typography>
                  )}
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 2 }}>
                    <Button size="small" variant="contained" color="secondary" onClick={() => setStatus(i, "accepted")}>Accept</Button>
                    <Button size="small" variant="outlined" onClick={() => setStatus(i, "dismissed")}>Dismiss</Button>
                  </Stack>
                  <TextField size="small" fullWidth placeholder="Inspector note…" value={f.note ?? ""} onChange={(e) => setNote(i, e.target.value)} sx={{ mt: 2 }} />
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}

        {err && <Typography color="error" variant="body2">{err}</Typography>}
        <Button variant="contained" color="secondary" fullWidth disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save record"}
        </Button>
      </Stack>
    </ScreenShell>
  );
}
