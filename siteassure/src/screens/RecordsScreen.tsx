// New: dedicated Records screen (persistent-nav "Records" tab). Full searchable/filterable
// list of every non-voided record, not just Home's capped "Recent records" slice.
import { useEffect, useMemo, useState } from "react";
import { Box, Chip, Divider, InputAdornment, List, ListItemButton, ListItemText, Stack, TextField, Typography } from "@mui/material";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import FlagRoundedIcon from "@mui/icons-material/FlagRounded";
import ScreenShell, { type NavTab } from "../components/ScreenShell";
import { listRecords } from "../lib/api";
import { relativeDay, type RecordRow } from "./HomeScreen";
const MONO = "'IBM Plex Mono', 'Roboto Mono', ui-monospace, monospace";

const KIND_LABEL: Record<string, string> = {
  daily_log: "Daily log",
  jha: "JHA",
  inspection: "Inspection",
  incident: "Incident",
};

export default function RecordsScreen({
  onOpen, onNav,
}: {
  onOpen: (id: string) => void;
  onNav: (tab: NavTab) => void;
}) {
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [err, setErr] = useState<string>();
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<string | null>(null);

  useEffect(() => {
    listRecords().then((r) => setRecords(r as RecordRow[])).catch((e) => setErr(String(e)));
  }, []);

  const kinds = useMemo(
    () => Array.from(new Set(records.map((r) => r.kind))),
    [records]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records
      .filter((r) => !r.voided)
      .filter((r) => !kindFilter || r.kind === kindFilter)
      .filter((r) => !q || r.kind.toLowerCase().includes(q) || (r.site ?? "").toLowerCase().includes(q))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [records, query, kindFilter]);

  return (
    <ScreenShell
      title="Records"
      subtitle="Every daily log, JHA, inspection, and incident report on this device."
      eyebrow="Field ops"
      active="records"
      onNav={onNav}
    >
      <Stack spacing={2.5} sx={{ pb: 2 }}>
        <TextField
          placeholder="Search by trade or site"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          size="small"
          fullWidth
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchRoundedIcon fontSize="small" sx={{ color: "text.secondary" }} />
              </InputAdornment>
            ),
          }}
        />

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip
            label="All"
            onClick={() => setKindFilter(null)}
            variant={kindFilter === null ? "filled" : "outlined"}
            sx={{
              fontWeight: 600,
              bgcolor: kindFilter === null ? "grey.900" : "transparent",
              color: kindFilter === null ? "common.white" : "text.secondary",
              borderColor: "divider",
            }}
          />
          {kinds.map((k) => (
            <Chip
              key={k}
              label={KIND_LABEL[k] ?? k.replace(/_/g, " ")}
              onClick={() => setKindFilter(k)}
              variant={kindFilter === k ? "filled" : "outlined"}
              sx={{
                fontWeight: 600,
                bgcolor: kindFilter === k ? "grey.900" : "transparent",
                color: kindFilter === k ? "common.white" : "text.secondary",
                borderColor: "divider",
              }}
            />
          ))}
        </Stack>

        <Divider />

        {err && <Typography color="error" variant="body2">{err}</Typography>}

        <List disablePadding>
          {filtered.map((r) => (
            <ListItemButton
              key={r.id}
              onClick={() => onOpen(r.id)}
              sx={{
                borderRadius: 2,
                my: 0.5,
                border: "1px solid",
                borderColor: "divider",
                bgcolor: "background.paper",
              }}
            >
              <ListItemText
                primary={
                  <Typography sx={{ fontWeight: 600 }}>
                    {(KIND_LABEL[r.kind] ?? r.kind.replace(/_/g, " "))} — {r.site ?? "Unassigned site"}
                  </Typography>
                }
                secondary={
                  <Typography
                    variant="caption"
                    component="span"
                    sx={{ fontFamily: MONO, color: "text.secondary" }}
                  >
                    {relativeDay(r.createdAt)} · v{r.currentVersion}
                  </Typography>
                }
              />
              {!!r.openFlagCount && (
                <Chip
                  size="small"
                  icon={<FlagRoundedIcon sx={{ fontSize: "14px !important" }} />}
                  label={`${r.openFlagCount} flag${r.openFlagCount === 1 ? "" : "s"}`}
                  sx={{ bgcolor: "rgba(244,164,30,0.16)", color: "secondary.main", fontWeight: 700 }}
                />
              )}
            </ListItemButton>
          ))}
          {filtered.length === 0 && !err && (
            <Box sx={{ py: 4, textAlign: "center" }}>
              <Typography variant="body2" color="text.secondary">
                {records.length === 0 ? "No records yet." : "No records match your search."}
              </Typography>
            </Box>
          )}
        </List>
      </Stack>
    </ScreenShell>
  );
}
