// 03 Review & structure — raw transcript (immutable) shown alongside the editable cleaned narrative.
import { useEffect, useState } from "react";
import { Box, Button, Stack, Typography, TextField, ToggleButton, ToggleButtonGroup, Paper } from "@mui/material";
import type { Draft, DraftFields } from "../lib/types";
import { autoParseFields } from "../lib/transcriptParse";

export default function ConfirmScreen({ draft, setDraft, onNext, onBack }: {
  draft: Draft; setDraft: (d: Draft) => void; onNext: () => void; onBack: () => void;
}) {
  const [view, setView] = useState<"cleaned" | "raw">("cleaned");
  const f = draft.fields;
  const setField = (k: keyof DraftFields, v: string) => setDraft({ ...draft, fields: { ...f, [k]: v } });

  useEffect(() => {
    const parsed = autoParseFields(`${draft.transcript} ${draft.narrative}`.trim(), draft.fields as any);
    if (JSON.stringify(parsed) !== JSON.stringify(draft.fields)) {
      setDraft({ ...draft, fields: parsed });
    }
  }, [draft.transcript, draft.narrative]);

  return (
    <Box sx={{ p: 2, pb: 4 }}>
      <Button onClick={onBack} sx={{ mb: 2 }}>Back</Button>
      <Typography variant="h3" gutterBottom>Review &amp; structure</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Auto-parsed from the transcript where possible. Edit fields before flagging.
      </Typography>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ my: 2 }}>
        <TextField
          label="Date"
          size="small"
          fullWidth
          helperText="Auto-detected from speech"
          value={f.date ?? ""}
          onChange={(e) => setField("date", e.target.value)}
        />
        <TextField
          label="Site"
          size="small"
          fullWidth
          helperText="e.g. Main Street bridge"
          value={f.site ?? ""}
          onChange={(e) => setField("site", e.target.value)}
        />
      </Stack>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2 }}>
        <TextField
          label="Crew"
          size="small"
          fullWidth
          helperText="e.g. framing crew"
          value={f.crew ?? ""}
          onChange={(e) => setField("crew", e.target.value)}
        />
        <TextField
          label="Trade NAICS"
          size="small"
          fullWidth
          placeholder="238160"
          helperText="Auto-filled from trade keywords"
          value={f.tradeNaics ?? ""}
          onChange={(e) => setField("tradeNaics", e.target.value)}
        />
      </Stack>

      <ToggleButtonGroup exclusive size="small" value={view}
        onChange={(_, v) => v && setView(v)} sx={{ mb: 2 }}>
        <ToggleButton value="cleaned">Cleaned</ToggleButton>
        <ToggleButton value="raw">Raw</ToggleButton>
      </ToggleButtonGroup>

      {view === "cleaned" ? (
        <TextField
          label="Narrative (editable)"
          multiline
          minRows={6}
          fullWidth
          value={draft.narrative}
          onChange={(e) => setDraft({ ...draft, narrative: e.target.value })}
        />
      ) : (
        <Paper variant="outlined" sx={{ p: 2, bgcolor: "background.default" }}>
          <Typography variant="caption" color="text.secondary">Raw transcript — immutable</Typography>
          <Typography sx={{ whiteSpace: "pre-wrap", mt: 1 }}>{draft.transcript || "(no transcript)"}</Typography>
        </Paper>
      )}

      <Button variant="contained" color="secondary" fullWidth sx={{ mt: 3 }} onClick={onNext}>Confirm &amp; flag</Button>
    </Box>
  );
}
