// 03 Review & structure — raw transcript (immutable) shown alongside the editable cleaned narrative.
import { useEffect, useState } from "react";
import { Box, Button, Paper, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import ScreenShell from "../components/ScreenShell";
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
    <ScreenShell
      title="Review and structure"
      subtitle="Auto-fill the essentials, then tighten the narrative before you review flags."
      eyebrow="Step 2 of 4"
      action={(
        <Button variant="outlined" onClick={onBack} sx={{ color: "common.white", borderColor: "rgba(255,255,255,0.2)" }}>
          Back
        </Button>
      )}
    >
      <Stack spacing={3} sx={{ pb: 2 }}>
        <Paper variant="outlined" sx={{ p: { xs: 2.2, md: 2.6 }, borderRadius: 3, bgcolor: "grey.50" }}>
          <Typography variant="overline" color="text.secondary">Field summary</Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mt: 1.5 }}>
            <TextField label="Date" size="small" fullWidth helperText="Auto-detected from speech" value={f.date ?? ""} onChange={(e) => setField("date", e.target.value)} />
            <TextField label="Site" size="small" fullWidth helperText="e.g. Main Street bridge" value={f.site ?? ""} onChange={(e) => setField("site", e.target.value)} />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mt: 2 }}>
            <TextField label="Crew" size="small" fullWidth helperText="e.g. framing crew" value={f.crew ?? ""} onChange={(e) => setField("crew", e.target.value)} />
            <TextField label="Trade NAICS" size="small" fullWidth placeholder="238160" helperText="Auto-filled from trade keywords" value={f.tradeNaics ?? ""} onChange={(e) => setField("tradeNaics", e.target.value)} />
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: { xs: 2.2, md: 2.6 }, borderRadius: 3 }}>
          <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }} spacing={1.5}>
            <Typography variant="h6">Narrative</Typography>
            <ToggleButtonGroup exclusive size="small" value={view} onChange={(_, v) => v && setView(v)}>
              <ToggleButton value="cleaned">Cleaned</ToggleButton>
              <ToggleButton value="raw">Raw</ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          {view === "cleaned" ? (
            <TextField label="Narrative (editable)" multiline minRows={7} fullWidth value={draft.narrative} onChange={(e) => setDraft({ ...draft, narrative: e.target.value })} sx={{ mt: 2 }} />
          ) : (
            <Paper variant="outlined" sx={{ p: 2, bgcolor: "background.default", mt: 2 }}>
              <Typography variant="caption" color="text.secondary">Raw transcript — immutable</Typography>
              <Typography sx={{ whiteSpace: "pre-wrap", mt: 1 }}>{draft.transcript || "(no transcript)"}</Typography>
            </Paper>
          )}
        </Paper>

        <Button variant="contained" color="secondary" fullWidth onClick={onNext}>Confirm &amp; flag</Button>
      </Stack>
    </ScreenShell>
  );
}
