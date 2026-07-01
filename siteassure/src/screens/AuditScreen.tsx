// New: dedicated Audit screen (persistent-nav "Audit" tab). Surfaces the hash-chain
// tamper-evidence guarantee that previously only showed up as a small banner on individual
// records. Calls audit_status / list_audit_log -- Rust commands that still need to be added
// (see api.ts); until then this shows a clear "not wired up yet" state instead of crashing.
import { useEffect, useState } from "react";
import { Alert, Box, Chip, CircularProgress, Divider, List, ListItem, ListItemText, Paper, Stack, Typography } from "@mui/material";
import VerifiedRoundedIcon from "@mui/icons-material/VerifiedRounded";
import GppMaybeRoundedIcon from "@mui/icons-material/GppMaybeRounded";
import ScreenShell, { type NavTab } from "../components/ScreenShell";
import { auditStatus, listAuditLog } from "../lib/api";
import type { AuditEntry, AuditStatus } from "../lib/types";
const MONO = "'IBM Plex Mono', 'Roboto Mono', ui-monospace, monospace";

const ACTION_LABEL: Record<string, string> = {
  create: "Created",
  amend: "Amended",
  void: "Deleted (voided)",
  flag_accept: "Flag accepted",
  flag_dismiss: "Flag dismissed",
  capture: "Audio captured",
  export: "Exported",
};

export default function AuditScreen({ onNav }: { onNav: (tab: NavTab) => void }) {
  const [status, setStatus] = useState<AuditStatus>();
  const [entries, setEntries] = useState<AuditEntry[]>();
  const [err, setErr] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([auditStatus(), listAuditLog(50)])
      .then(([s, e]) => { setStatus(s); setEntries(e); })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <ScreenShell
      title="Audit trail"
      subtitle="Every create, amend, and delete is chained and hash-verified -- nothing is silently altered or removed."
      eyebrow="Tamper evidence"
      active="audit"
      onNav={onNav}
    >
      <Stack spacing={2.5} sx={{ pb: 2 }}>
        {loading && (
          <Stack alignItems="center" justifyContent="center" spacing={2} sx={{ py: 6 }}>
            <CircularProgress color="secondary" />
          </Stack>
        )}

        {!loading && err && (
          <Alert severity="warning" variant="outlined">
            The audit commands (<code>audit_status</code> / <code>list_audit_log</code>) aren't
            registered in <code>commands.rs</code> / <code>main.rs</code> yet -- this screen is
            built and ready, it just needs that backend wiring. Error: {err}
          </Alert>
        )}

        {!loading && !err && status && (
          <Paper
            variant="outlined"
            sx={{
              p: 2.5,
              borderRadius: 3,
              bgcolor: "background.paper",
              display: "flex",
              alignItems: "center",
              gap: 2,
            }}
          >
            {status.verified ? (
              <VerifiedRoundedIcon sx={{ color: "success.main", fontSize: 32 }} />
            ) : (
              <GppMaybeRoundedIcon sx={{ color: "error.main", fontSize: 32 }} />
            )}
            <Box>
              <Typography sx={{ fontWeight: 700 }}>
                {status.verified ? "Audit verified -- no tampering detected" : "Audit chain integrity failed"}
              </Typography>
              <Typography variant="caption" sx={{ fontFamily: MONO, color: "text.secondary" }}>
                {status.count} entries · head {status.lastHash.slice(0, 12)}… · updated {new Date(status.updatedAt).toLocaleString()}
              </Typography>
            </Box>
          </Paper>
        )}

        {!loading && !err && entries && (
          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: "0.18em" }}>
              Recent chain entries
            </Typography>
            <Divider sx={{ my: 1 }} />
            <List disablePadding>
              {entries.map((e) => (
                <ListItem
                  key={e.seq}
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
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Chip
                          size="small"
                          label={ACTION_LABEL[e.action] ?? e.action}
                          sx={{ bgcolor: "rgba(92,141,178,0.16)", color: "primary.main", fontWeight: 700 }}
                        />
                        <Typography sx={{ fontWeight: 600 }}>{e.actor}</Typography>
                      </Stack>
                    }
                    secondary={
                      <Typography variant="caption" sx={{ fontFamily: MONO, color: "text.secondary" }}>
                        seq {e.seq} · {new Date(e.ts).toLocaleString()}
                        {e.recordId ? ` · record ${e.recordId.slice(0, 8)}…` : ""}
                        {e.version ? ` · v${e.version}` : ""}
                      </Typography>
                    }
                  />
                </ListItem>
              ))}
              {entries.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                  No audit entries yet.
                </Typography>
              )}
            </List>
          </Box>
        )}
      </Stack>
    </ScreenShell>
  );
}
