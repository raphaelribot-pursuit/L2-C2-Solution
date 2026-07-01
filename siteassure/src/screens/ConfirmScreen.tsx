// 03 Review & structure — matches FIG 3: labeled DATE/SITE/CREW/TRADE rows with inline edit,
// Cleaned/Raw narrative toggle, "AI summary — shown alongside the raw transcript" caption,
// and a "Listen to original audio" affordance.
import { useEffect, useState } from "react";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import { Box, Button, IconButton, InputBase, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import ScreenShell, { type NavTab } from "../components/ScreenShell";
import type { Draft, DraftFields } from "../lib/types";
import { autoParseFields } from "../lib/transcriptParse";
const MONO = "'IBM Plex Mono', 'Roboto Mono', ui-monospace, monospace";

const FIELD_ROWS: { key: keyof DraftFields; label: string; placeholder: string }[] = [
  { key: "date", label: "Date", placeholder: "Jun 26, 2026" },
  { key: "site", label: "Site", placeholder: "Hartley Ave — Lot 14" },
  { key: "crew", label: "Crew", placeholder: "Diaz crew (6)" },
  { key: "tradeNaics", label: "Trade", placeholder: "Roofing" },
];

function FieldRow({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      sx={{ py: 1.4, borderBottom: "1px solid", borderColor: "divider" }}
    >
      <Typography variant="overline" sx={{ color: "text.secondary", letterSpacing: "0.16em", minWidth: 84 }}>
        {label}
      </Typography>
      {editing ? (
        <InputBase
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setEditing(false)}
          sx={{ flex: 1, ml: 2, fontSize: 16, color: "text.primary" }}
        />
      ) : (
        <Typography
          sx={{ flex: 1, ml: 2, color: value ? "text.primary" : "text.secondary", fontStyle: value ? "normal" : "italic" }}
        >
          {value || placeholder}
        </Typography>
      )}
      <IconButton size="small" onClick={() => setEditing((e) => !e)} sx={{ color: "text.secondary" }}>
        <EditRoundedIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
}

export default function ConfirmScreen({ draft, setDraft, onNext, onBack, onNav }: {
  draft: Draft; setDraft: (d: Draft) => void; onNext: () => void; onBack: () => void; onNav: (tab: NavTab) => void;
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
      title="Confirm details"
      subtitle="Auto-filled from your speech — tap the pencil to correct anything before you save."
      eyebrow="Step 2 of 4"
      active="home"
      onNav={onNav}
      action={(
        <Button variant="outlined" onClick={onBack} sx={{ color: "common.white", borderColor: "rgba(255,255,255,0.2)" }}>
          Back
        </Button>
      )}
    >
      <Stack spacing={3} sx={{ pb: 2 }}>
        <Paper variant="outlined" sx={{ px: { xs: 2, md: 2.6 }, borderRadius: 3, bgcolor: "background.paper", borderColor: "divider" }}>
          {FIELD_ROWS.map((row) => (
            <FieldRow
              key={row.key}
              label={row.label}
              placeholder={row.placeholder}
              value={(f[row.key] as string) ?? ""}
              onChange={(v) => setField(row.key, v)}
            />
          ))}
        </Paper>

        <Paper variant="outlined" sx={{ p: { xs: 2.2, md: 2.6 }, borderRadius: 3, bgcolor: "background.paper", borderColor: "divider" }}>
          <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }} spacing={1.5}>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: "0.16em" }}>Narrative</Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={view}
              onChange={(_, v) => v && setView(v)}
              sx={{
                "& .MuiToggleButton-root": { color: "text.secondary", borderColor: "divider", px: 2 },
                "& .Mui-selected": { bgcolor: "grey.900 !important", color: "common.white !important" },
              }}
            >
              <ToggleButton value="cleaned">Cleaned</ToggleButton>
              <ToggleButton value="raw">Raw</ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          {view === "cleaned" ? (
            <Box sx={{ mt: 2 }}>
              <InputBase
                multiline
                minRows={6}
                fullWidth
                value={draft.narrative}
                onChange={(e) => setDraft({ ...draft, narrative: e.target.value })}
                sx={{ fontSize: 15, lineHeight: 1.7, color: "text.primary" }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5, fontStyle: "italic" }}>
                AI summary — shown alongside the raw transcript, never replacing it.
              </Typography>
            </Box>
          ) : (
            <Paper variant="outlined" sx={{ p: 2, bgcolor: "background.default", borderColor: "divider", mt: 2 }}>
              <Typography variant="caption" sx={{ fontFamily: MONO, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Raw transcript — immutable
              </Typography>
              <Typography sx={{ whiteSpace: "pre-wrap", mt: 1 }}>{draft.transcript || "(no transcript)"}</Typography>
            </Paper>
          )}

          {draft.audioPath && (
            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 2, cursor: "pointer", color: "primary.main" }}>
              <PlayArrowRoundedIcon fontSize="small" />
              <Typography variant="body2" sx={{ fontWeight: 600 }}>Listen to original audio</Typography>
            </Stack>
          )}
        </Paper>

        <Button variant="contained" color="secondary" fullWidth onClick={onNext} sx={{ color: "#1E242A", py: 1.3 }}>
          Confirm &amp; save
        </Button>
      </Stack>
    </ScreenShell>
  );
}
