// 04 Safety flags — matches FIG 4: "N flags found / Reviewed before saving" header, amber flag
// badge per card, OSHA stat chip, Accept/Dismiss/Note row, collapsible overflow for 3+ flags.
import { useEffect, useState } from "react";
import { Box, Button, Card, CardContent, Chip, Collapse, IconButton, InputBase, Paper, Stack, Typography } from "@mui/material";
import FlagRoundedIcon from "@mui/icons-material/FlagRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import EditNoteRoundedIcon from "@mui/icons-material/EditNoteRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import ScreenShell, { type NavTab } from "../components/ScreenShell";
import { scanFlags, saveRecord } from "../lib/api";
import type { Draft, SafetyFlag } from "../lib/types";

const VISIBLE_COUNT = 2;

export default function FlagsScreen({ draft, setDraft, onSaved, onBack, onNav }: {
  draft: Draft; setDraft: (d: Draft) => void; onSaved: (id: string) => void; onBack: () => void; onNav: (tab: NavTab) => void;
}) {
  const [flags, setFlags] = useState<SafetyFlag[]>(draft.flags);
  const [err, setErr] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [noteOpenIndex, setNoteOpenIndex] = useState<number | null>(null);

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

  const visible = showAll ? flags : flags.slice(0, VISIBLE_COUNT);
  const overflow = flags.length - visible.length;

  return (
    <ScreenShell
      title="Safety flags"
      subtitle="Review each finding, document your decision, and save a defensible record."
      eyebrow="Step 3 of 4"
      active="home"
      onNav={onNav}
      action={(
        <Button variant="outlined" onClick={onBack} sx={{ color: "common.white", borderColor: "rgba(255,255,255,0.2)" }}>
          Back
        </Button>
      )}
    >
      <Stack spacing={3} sx={{ pb: 2 }}>
        <Paper
          variant="outlined"
          sx={{ p: 2.4, borderRadius: 3, bgcolor: "rgba(244,164,30,0.10)", borderColor: "rgba(244,164,30,0.35)" }}
        >
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <FlagRoundedIcon sx={{ color: "secondary.main" }} />
            <Box>
              <Typography variant="h6" sx={{ color: "secondary.main" }}>
                {flags.length} flag{flags.length === 1 ? "" : "s"} found
              </Typography>
              <Typography variant="body2" color="text.secondary">Reviewed before saving</Typography>
            </Box>
          </Stack>
        </Paper>

        {flags.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 3, borderRadius: 3, bgcolor: "background.paper", borderColor: "divider" }}>
            <Typography variant="h6">No flags raised</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              The narrative did not match any safety patterns, or the capture is too short.
            </Typography>
          </Paper>
        ) : (
          <Stack spacing={2}>
            {visible.map((f, idx) => {
              const i = flags.indexOf(f);
              return (
                <Card key={f.code + i} variant="outlined" sx={{ borderRadius: 3, borderColor: "divider", bgcolor: "background.paper" }}>
                  <CardContent>
                    <Stack direction="row" spacing={1.5} alignItems="flex-start">
                      <Box sx={{ mt: 0.3, width: 28, height: 28, borderRadius: "50%", bgcolor: "secondary.main", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <FlagRoundedIcon sx={{ fontSize: 16, color: "#1E242A" }} />
                      </Box>
                      <Box sx={{ flex: 1 }}>
                        <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }} spacing={1}>
                          <Typography variant="h6" sx={{ fontSize: 17 }}>{f.title}</Typography>
                          <Chip
                            size="small"
                            label={f.status}
                            sx={{
                              fontWeight: 700,
                              bgcolor: f.status === "accepted" ? "rgba(45,170,90,0.18)" : f.status === "dismissed" ? "rgba(154,165,173,0.18)" : "rgba(244,164,30,0.18)",
                              color: f.status === "accepted" ? "success.main" : f.status === "dismissed" ? "text.secondary" : "secondary.main",
                            }}
                          />
                        </Stack>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>{f.rationale}</Typography>
                        {f.oshaContext && (
                          <Chip
                            size="small"
                            variant="outlined"
                            label={f.oshaContext}
                            sx={{ mt: 1.25, borderColor: "primary.main", color: "primary.main", fontWeight: 600 }}
                          />
                        )}
                        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                          <Button size="small" variant="contained" startIcon={<CheckRoundedIcon />} onClick={() => setStatus(i, "accepted")} sx={{ bgcolor: "success.main", color: "#0B1A10", "&:hover": { bgcolor: "success.main" } }}>
                            Accept
                          </Button>
                          <Button size="small" variant="outlined" startIcon={<CloseRoundedIcon />} onClick={() => setStatus(i, "dismissed")} sx={{ color: "text.secondary", borderColor: "divider" }}>
                            Dismiss
                          </Button>
                          <IconButton size="small" onClick={() => setNoteOpenIndex(noteOpenIndex === i ? null : i)} sx={{ color: "text.secondary" }}>
                            <EditNoteRoundedIcon fontSize="small" />
                          </IconButton>
                        </Stack>
                        <Collapse in={noteOpenIndex === i || !!f.note}>
                          <InputBase
                            fullWidth
                            placeholder="Inspector note…"
                            value={f.note ?? ""}
                            onChange={(e) => setNote(i, e.target.value)}
                            sx={{ mt: 1.5, fontSize: 14, px: 1.2, py: 0.8, bgcolor: "background.default", borderRadius: 1.5, border: "1px solid", borderColor: "divider" }}
                          />
                        </Collapse>
                      </Box>
                    </Stack>
                  </CardContent>
                </Card>
              );
            })}

            {overflow > 0 && !showAll && (
              <Button
                onClick={() => setShowAll(true)}
                endIcon={<ExpandMoreRoundedIcon />}
                sx={{ justifyContent: "flex-start", color: "text.secondary", textTransform: "none" }}
              >
                +{overflow} more — {flags[VISIBLE_COUNT]?.title.toLowerCase()}
              </Button>
            )}
          </Stack>
        )}

        {err && <Typography color="error" variant="body2">{err}</Typography>}
        <Button variant="contained" color="secondary" fullWidth disabled={saving} onClick={save} sx={{ color: "#1E242A", py: 1.3 }}>
          {saving ? "Saving…" : "Save record"}
        </Button>
      </Stack>
    </ScreenShell>
  );
}
