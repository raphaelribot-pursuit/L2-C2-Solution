// 01 Home / new record.
import { useEffect, useState } from "react";
import { Box, Button, Chip, Divider, Fab, List, ListItemButton, ListItemText, Paper, Stack, Typography } from "@mui/material";
import MicIcon from "@mui/icons-material/Mic";
import BarChartIcon from "@mui/icons-material/BarChart";
import VerifiedIcon from "@mui/icons-material/Verified";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import ScreenShell from "../components/ScreenShell";
import { listRecords } from "../lib/api";
import type { RecordKind } from "../lib/types";

const KINDS: { k: RecordKind; label: string }[] = [
  { k: "daily_log", label: "Daily Log" },
  { k: "jha", label: "JHA" },
  { k: "inspection", label: "Inspection" },
  { k: "incident", label: "Incident" },
];

type RecordRow = { id: string; kind: string; createdAt: string; currentVersion: number; site?: string };

export default function HomeScreen({ onNew, onOpen, onTrends }: { onNew: (k: RecordKind) => void; onOpen: (id: string) => void; onTrends: () => void }) {
  const [kind, setKind] = useState<RecordKind>("daily_log");
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [err, setErr] = useState<string>();

  useEffect(() => {
    listRecords().then((r) => setRecords(r as RecordRow[])).catch((e) => setErr(String(e)));
  }, []);

  const selectedLabel = KINDS.find((x) => x.k === kind)?.label ?? "Daily Log";

  return (
    <ScreenShell
      title="SiteAssure"
      subtitle="Capture field notes offline, review the facts, and leave a defensible record behind."
      eyebrow="Field ops · offline first"
      action={(
        <Button startIcon={<BarChartIcon />} variant="outlined" onClick={onTrends} sx={{ color: "common.white", borderColor: "rgba(255,255,255,0.2)" }}>
          Trends
        </Button>
      )}
    >
      <Stack spacing={3} sx={{ pb: 8 }}>
        <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 3 }, borderRadius: 3, bgcolor: "grey.50" }}>
          <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", md: "center" }} spacing={2}>
            <Box>
              <Typography variant="overline" color="text.secondary">New capture</Typography>
              <Typography variant="h4" sx={{ fontSize: { xs: 22, md: 28 } }}>Start a {selectedLabel.toLowerCase()} for this shift</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 620 }}>
                Record a field note locally, pull out the essentials, and review any safety flags before you save it.
              </Typography>
            </Box>
            <Button size="large" variant="contained" color="secondary" startIcon={<MicIcon />} onClick={() => onNew(kind)} sx={{ minWidth: 220 }}>
              Capture {selectedLabel}
            </Button>
          </Stack>

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 2.5 }}>
            {KINDS.map(({ k, label }) => (
              <Chip key={k} label={label} color={kind === k ? "secondary" : "default"} onClick={() => setKind(k)} sx={{ px: 0.5 }} />
            ))}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: { xs: 2.2, md: 2.6 }, borderRadius: 3 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
            <Box>
              <Typography variant="h6">Recent records</Typography>
              <Typography variant="body2" color="text.secondary">Stored on-device and ready for review</Typography>
            </Box>
            <Chip size="small" label="Offline ready" color="success" variant="outlined" />
          </Stack>
          <Divider sx={{ my: 2 }} />
          {err && <Typography color="error" variant="body2">{err}</Typography>}
          <List disablePadding>
            {records.map((r) => (
              <ListItemButton key={r.id} onClick={() => onOpen(r.id)} divider sx={{ borderRadius: 2, my: 0.5 }}>
                <Box sx={{ mr: 1.5, display: "flex", alignItems: "center" }}>
                  {r.currentVersion > 1 ? <VerifiedIcon color="secondary" /> : <WarningAmberRoundedIcon color="action" />}
                </Box>
                <ListItemText
                  primary={`${r.kind} · v${r.currentVersion}`}
                  secondary={`${r.site ?? "—"} · ${new Date(r.createdAt).toLocaleString()}`}
                />
              </ListItemButton>
            ))}
            {records.length === 0 && !err && (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                No records yet — tap the mic to capture your first field note.
              </Typography>
            )}
          </List>
        </Paper>
      </Stack>

      <Fab color="secondary" variant="extended" onClick={() => onNew(kind)} sx={{ position: "fixed", bottom: 24, right: 24 }}>
        <MicIcon sx={{ mr: 1 }} /> Speak {selectedLabel}
      </Fab>
    </ScreenShell>
  );
}
