// 04 Safety flags — run the deterministic engine, accept/dismiss/note, then save the record.
import { useEffect, useState } from "react";
import { Box, Button, Stack, Typography, Card, CardContent, Chip, TextField } from "@mui/material";
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
    <Box sx={{ p: 2, pb: 4 }}>
      <Button onClick={onBack}>Back</Button>
      <Typography variant="h3" gutterBottom>Safety flags</Typography>
      {flags.length === 0 && <Typography variant="body2" color="text.secondary">No flags raised.</Typography>}

      <Stack spacing={2} sx={{ my: 2 }}>
        {flags.map((f, i) => (
          <Card key={f.code + i} variant="outlined">
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="h3" sx={{ fontSize: 18 }}>{f.title}</Typography>
                <Chip size="small" label={f.status}
                  color={f.status === "accepted" ? "secondary" : f.status === "dismissed" ? "default" : "warning"} />
              </Stack>
              <Typography variant="body2" sx={{ mt: 1 }}>{f.rationale}</Typography>
              {f.oshaContext && <Typography variant="caption" color="secondary.dark">{f.oshaContext}</Typography>}
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <Button size="small" variant="contained" color="secondary" onClick={() => setStatus(i, "accepted")}>Accept</Button>
                <Button size="small" onClick={() => setStatus(i, "dismissed")}>Dismiss</Button>
              </Stack>
              <TextField size="small" fullWidth placeholder="Note…" value={f.note ?? ""}
                onChange={(e) => setNote(i, e.target.value)} sx={{ mt: 1 }} />
            </CardContent>
          </Card>
        ))}
      </Stack>

      {err && <Typography color="error" variant="body2" sx={{ mb: 1 }}>{err}</Typography>}
      <Button variant="contained" color="secondary" fullWidth disabled={saving} onClick={save}>
        {saving ? "Saving…" : "Save record"}
      </Button>
    </Box>
  );
}
