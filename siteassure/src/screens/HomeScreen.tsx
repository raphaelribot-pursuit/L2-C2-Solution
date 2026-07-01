// 01 Home / new record -- matches FIG 1: tagline, record-type pills, centered amber "tap to
// speak" mic, recent records with flag-count chips. Persistent bottom nav is provided by
// ScreenShell itself now, so this file no longer renders its own BottomNavigation.
import { useEffect, useState } from "react";
import { Box, Chip, Divider, List, ListItemButton, ListItemText, Stack, Typography } from "@mui/material";
import MicIcon from "@mui/icons-material/Mic";
import FlagRoundedIcon from "@mui/icons-material/FlagRounded";
import ScreenShell, { type NavTab } from "../components/ScreenShell";
import { listRecords } from "../lib/api";
import type { RecordKind } from "../lib/types";
const MONO = "'IBM Plex Mono', 'Roboto Mono', ui-monospace, monospace";
const AMBER_GLOW_22 = "0 0 0 10px rgba(244,164,30,0.22)";
const AMBER_GLOW_32 = "0 0 0 10px rgba(244,164,30,0.32)";
const RECENT_COUNT = 5;

const KINDS: { k: RecordKind; label: string }[] = [
  { k: "daily_log", label: "Daily log" },
  { k: "jha", label: "JHA" },
  { k: "inspection", label: "Inspection" },
  { k: "incident", label: "Incident" },
];

// listRecords() returns unknown[]. openFlagCount is optional -- rendered only when present/non-zero.
// voided records are filtered out of this view entirely (soft-deleted, still in the audit trail).
export type RecordRow = {
  id: string;
  kind: string;
  createdAt: string;
  currentVersion: number;
  site?: string;
  openFlagCount?: number;
  voided?: boolean;
};

export function relativeDay(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  const day = d.toDateString() === today.toDateString()
    ? "Today"
    : d.toDateString() === yest.toDateString()
    ? "Yesterday"
    : d.toLocaleDateString();
  return `${day} · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export default function HomeScreen({
  onNew, onOpen, onNav,
}: {
  onNew: (k: RecordKind) => void;
  onOpen: (id: string) => void;
  onNav: (tab: NavTab) => void;
}) {
  const [kind, setKind] = useState<RecordKind>("daily_log");
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [err, setErr] = useState<string>();

  useEffect(() => {
    listRecords().then((r) => setRecords(r as RecordRow[])).catch((e) => setErr(String(e)));
  }, []);

  const visible = records.filter((r) => !r.voided);
  const recent = visible.slice(0, RECENT_COUNT);

  return (
    <ScreenShell
      title="SiteAssure"
      subtitle="Speak it. Flag it. Prove it."
      eyebrow="Field ops · offline first"
      active="home"
      onNav={onNav}
    >
      <Stack spacing={3} sx={{ pb: 2 }}>
        {/* Record-type pills -- dark filled = selected, outlined = inactive */}
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {KINDS.map(({ k, label }) => (
            <Chip
              key={k}
              label={label}
              onClick={() => setKind(k)}
              variant={kind === k ? "filled" : "outlined"}
              sx={{
                px: 1,
                fontWeight: 600,
                bgcolor: kind === k ? "grey.900" : "transparent",
                color: kind === k ? "common.white" : "text.secondary",
                borderColor: "divider",
              }}
            />
          ))}
        </Stack>

        {/* Centered amber tap-to-speak mic -- primary affordance per FIG 1 */}
        <Stack alignItems="center" spacing={1.5} sx={{ py: { xs: 3, md: 4 } }}>
          <Box
            component="button"
            onClick={() => onNew(kind)}
            sx={{
              all: "unset",
              cursor: "pointer",
              width: 132,
              height: 132,
              borderRadius: "50%",
              bgcolor: "secondary.main",
              color: "#1E242A",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: AMBER_GLOW_22,
              transition: "transform 120ms ease, box-shadow 120ms ease",
              "&:hover": { transform: "scale(1.03)", boxShadow: AMBER_GLOW_32 },
              "&:active": { transform: "scale(0.98)" },
            }}
          >
            <MicIcon sx={{ fontSize: 52 }} />
          </Box>
          <Typography
            variant="overline"
            sx={{ color: "secondary.main", letterSpacing: "0.3em", fontWeight: 700 }}
          >
            Tap to speak
          </Typography>
        </Stack>

        {/* Recent records list */}
        <Box>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: "0.18em" }}>
              Recent records
            </Typography>
            {visible.length > RECENT_COUNT && (
              <Typography
                variant="caption"
                onClick={() => onNav("records")}
                sx={{ color: "secondary.main", fontWeight: 700, cursor: "pointer" }}
              >
                View all ({visible.length})
              </Typography>
            )}
          </Stack>
          <Divider sx={{ mb: 1.5 }} />
          {err && <Typography color="error" variant="body2">{err}</Typography>}
          <List disablePadding>
            {recent.map((r) => (
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
                      {r.kind.replace(/_/g, " ")} — {r.site ?? "Unassigned site"}
                    </Typography>
                  }
                  secondary={
                    <Typography
                      variant="caption"
                      component="span"
                      sx={{ fontFamily: MONO, color: "text.secondary" }}
                    >
                      {relativeDay(r.createdAt)}
                    </Typography>
                  }
                />
                {!!r.openFlagCount && (
                  <Chip
                    size="small"
                    icon={<FlagRoundedIcon sx={{ fontSize: "14px !important" }} />}
                    label={`${r.openFlagCount} flag${r.openFlagCount === 1 ? "" : "s"}`}
                    sx={{
                      bgcolor: "rgba(244,164,30,0.16)",
                      color: "secondary.main",
                      fontWeight: 700,
                    }}
                  />
                )}
              </ListItemButton>
            ))}
            {visible.length === 0 && !err && (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                No records yet -- tap the mic to capture your first field note.
              </Typography>
            )}
          </List>
        </Box>
      </Stack>
    </ScreenShell>
  );
}
