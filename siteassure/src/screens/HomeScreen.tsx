// 01 Home / new record.
import { useEffect, useState } from "react";
import { Box, Stack, Typography, Chip, List, ListItemButton, ListItemText, Fab } from "@mui/material";
import MicIcon from "@mui/icons-material/Mic";
import { listRecords } from "../lib/api";
import type { RecordKind } from "../lib/types";

const KINDS: { k: RecordKind; label: string }[] = [
  { k: "daily_log", label: "Daily Log" },
  { k: "jha", label: "JHA" },
  { k: "inspection", label: "Inspection" },
  { k: "incident", label: "Incident" },
];

type RecordRow = { id: string; kind: string; createdAt: string; currentVersion: number; site?: string };

export default function HomeScreen({ onNew, onOpen }: { onNew: (k: RecordKind) => void; onOpen: (id: string) => void }) {
  const [kind, setKind] = useState<RecordKind>("daily_log");
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [err, setErr] = useState<string>();

  useEffect(() => {
    listRecords().then((r) => setRecords(r as RecordRow[])).catch((e) => setErr(String(e)));
  }, []);

  return (
    <Box sx={{ p: 2, pb: 12 }}>
      <Typography variant="h2">SiteAssure</Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>Speak it. Flag it. Prove it.</Typography>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ my: 2 }}>
        {KINDS.map(({ k, label }) => (
          <Chip key={k} label={label} color={kind === k ? "secondary" : "default"} onClick={() => setKind(k)} />
        ))}
      </Stack>

      <Typography variant="h3" sx={{ fontSize: 18, mt: 3 }} gutterBottom>Recent records</Typography>
      {err && <Typography color="error" variant="body2">{err}</Typography>}
      <List>
        {records.map((r) => (
          <ListItemButton key={r.id} onClick={() => onOpen(r.id)} divider>
            <ListItemText
              primary={`${r.kind} · v${r.currentVersion}`}
              secondary={`${r.site ?? "—"} · ${new Date(r.createdAt).toLocaleString()}`}
            />
          </ListItemButton>
        ))}
        {records.length === 0 && !err && (
          <Typography variant="body2" color="text.secondary">No records yet — tap the mic to capture one.</Typography>
        )}
      </List>

      <Fab color="secondary" variant="extended" onClick={() => onNew(kind)} sx={{ position: "fixed", bottom: 24, right: 24 }}>
        <MicIcon sx={{ mr: 1 }} /> Speak {KINDS.find((x) => x.k === kind)?.label}
      </Fab>
    </Box>
  );
}
