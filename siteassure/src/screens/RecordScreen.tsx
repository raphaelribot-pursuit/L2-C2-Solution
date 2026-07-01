// 05 Record & audit history — audit verified banner, version timeline, before/after diff,
// amend with required reason. No imports from theme.ts (safe against old/new theme mismatch).
import { useEffect, useMemo, useState } from "react";
import {
  Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, Divider, Paper, Stack, TextField, Typography,
} from "@mui/material";
import VerifiedIcon from "@mui/icons-material/Verified";
import GppMaybeIcon from "@mui/icons-material/GppMaybe";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import BlockRoundedIcon from "@mui/icons-material/BlockRounded";
import FiberManualRecordRoundedIcon from "@mui/icons-material/FiberManualRecordRounded";
import ScreenShell, { type NavTab } from "../components/ScreenShell";
import { getRecord, amendRecord, voidRecord } from "../lib/api";
import { diffText } from "../lib/diff";
import type { RecordWithHistory } from "../lib/types";

// Inline so this file works with either the old or new theme.ts
const MONO = "'IBM Plex Mono', 'Roboto Mono', ui-monospace, monospace";

export default function RecordScreen({ id, onHome, onNav }: { id: string; onHome: () => void; onNav: (tab: NavTab) => void }) {
  const [rec, setRec]         = useState<RecordWithHistory | undefined>(undefined);
  const [err, setErr]         = useState<string | undefined>(undefined);
  const [reason, setReason]   = useState("");
  const [narrative, setNarrative] = useState("");
  const [amending, setAmending]   = useState(false);

  // Void (soft-delete) flow — confirmation dialog with a required reason. Nothing is
  // ever hard-deleted; the record stays in the audit chain and is just hidden from
  // Home/Dashboard views.
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [voidReason, setVoidReason]         = useState("");
  const [voiding, setVoiding]               = useState(false);
  const [voidErr, setVoidErr]               = useState<string | undefined>(undefined);

  const load = () => {
    if (!id) return;
    getRecord(id)
      .then((r) => {
        setRec(r);
        const last = r.versions[r.versions.length - 1];
        setNarrative(last?.narrative ?? "");
      })
      .catch((e) => setErr(String(e)));
  };

  useEffect(() => {
    setRec(undefined);
    setErr(undefined);
    load();
  }, [id]);

  const current  = rec?.versions[rec.versions.length - 1];
  const previous = rec?.versions[rec.versions.length - 2];

  const diff = useMemo(() => {
    if (!current) return [];
    return diffText(previous?.narrative ?? current.narrative, narrative);
  }, [previous?.narrative, current?.narrative, narrative]);

  const amend = async () => {
    if (!reason.trim()) { setErr("A reason is required to amend."); return; }
    setAmending(true);
    setErr(undefined);
    try {
      await amendRecord(id, { narrative }, reason);
      setReason("");
      load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setAmending(false);
    }
  };

  const handleVoid = async () => {
    if (!voidReason.trim()) { setVoidErr("A reason is required to delete a record."); return; }
    setVoiding(true);
    setVoidErr(undefined);
    try {
      await voidRecord(id, voidReason);
      setVoidDialogOpen(false);
      setVoidReason("");
      load(); // re-fetch so the voided banner shows immediately
    } catch (e) {
      setVoidErr(String(e));
    } finally {
      setVoiding(false);
    }
  };

  const homeBtn = (
    <Button
      variant="outlined"
      onClick={onHome}
      sx={{ color: "common.white", borderColor: "rgba(255,255,255,0.2)" }}
    >
      Home
    </Button>
  );

  // ── Loading / error state ──────────────────────────────────────────────────
  if (!rec) {
    return (
      <ScreenShell
        title="Record"
        subtitle="Loading the latest audit trail."
        eyebrow="Audit review"
        action={homeBtn}
        active="records"
        onNav={onNav}
      >
        <Stack alignItems="center" justifyContent="center" spacing={2} sx={{ py: 8 }}>
          {err ? (
            <>
              <GppMaybeIcon color="error" sx={{ fontSize: 40 }} />
              <Typography color="error">{err}</Typography>
              <Button variant="outlined" onClick={onHome}>Go home</Button>
            </>
          ) : (
            <>
              <CircularProgress color="secondary" />
              <Typography color="text.secondary" variant="body2">
                Loading record…
              </Typography>
            </>
          )}
        </Stack>
      </ScreenShell>
    );
  }

  // ── Record loaded ──────────────────────────────────────────────────────────
  // Guard: kind may be missing from the top-level object if the Rust db layer
  // returns it only inside versions[]. Fall back through versions[0] or 'record'.
  const kind: string =
    rec.kind ??
    (rec.versions[0] as any)?.kind ??
    (rec.versions[0] as any)?.fields?.kind ??
    'record';
  const amended = (rec.versions?.length ?? 0) > 1;

  return (
    <ScreenShell
      title={kind.replace(/_/g, " ")}
      subtitle="Evidence trail, version history, and amendment workflow."
      eyebrow="Audit review"
      action={homeBtn}
      active="records"
      onNav={onNav}
    >
      <Stack spacing={3} sx={{ pb: 2 }}>

        {/* ── Header: kind + amended chip + audit-verified banner ── */}
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 3, borderColor: "divider" }}>
          <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }} spacing={1.5}>
            <Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="h5">{kind.replace(/_/g, " ")}</Typography>
                {amended && (
                  <Chip
                    size="small"
                    label="Amended"
                    sx={{ bgcolor: "rgba(92,141,178,0.18)", color: "primary.main", fontWeight: 700 }}
                  />
                )}
                {rec.voided && (
                  <Chip
                    size="small"
                    icon={<BlockRoundedIcon sx={{ fontSize: "14px !important" }} />}
                    label="Deleted"
                    sx={{ bgcolor: "rgba(224,89,74,0.18)", color: "error.main", fontWeight: 700 }}
                  />
                )}
              </Stack>
              <Typography
                variant="caption"
                sx={{ fontFamily: MONO, color: "text.secondary", mt: 0.5, display: "block" }}
              >
                Filed {new Date(rec.versions[0]?.createdAt ?? Date.now()).toLocaleString()}
                {rec.versions[0]?.author ? ` · ${rec.versions[0].author}` : ""}
              </Typography>
            </Box>
          </Stack>

          <Paper
            variant="outlined"
            sx={{
              mt: 2, p: 1.5, borderRadius: 2,
              bgcolor: rec.auditVerified ? "rgba(45,170,90,0.10)" : "rgba(224,89,74,0.10)",
              borderColor: rec.auditVerified ? "rgba(45,170,90,0.4)" : "rgba(224,89,74,0.4)",
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              {rec.auditVerified
                ? <VerifiedIcon color="success" fontSize="small" />
                : <GppMaybeIcon color="error" fontSize="small" />}
              <Typography
                variant="body2"
                sx={{ fontWeight: 700, color: rec.auditVerified ? "success.main" : "error.main" }}
              >
                {rec.auditVerified
                  ? "Audit verified — no tampering detected"
                  : "Tampering detected"}
              </Typography>
            </Stack>
          </Paper>
        </Paper>

        {/* ── Version timeline ── */}
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 3, borderColor: "divider" }}>
          <Typography variant="overline" color="text.secondary">Version history</Typography>
          <Stack sx={{ mt: 2 }}>
            {[...rec.versions].reverse().map((v, idx, arr) => (
              <Stack key={v.version} direction="row" spacing={2}>
                <Stack alignItems="center" sx={{ width: 20 }}>
                  <FiberManualRecordRoundedIcon
                    sx={{ fontSize: 14, color: idx === 0 ? "secondary.main" : "primary.main", mt: 0.4 }}
                  />
                  {idx < arr.length - 1 && (
                    <Box sx={{ width: 1, flex: 1, bgcolor: "divider", minHeight: 32, my: 0.5 }} />
                  )}
                </Stack>
                <Box sx={{ pb: 2.5, flex: 1 }}>
                  <Typography variant="body2" sx={{ fontFamily: MONO, color: "text.secondary" }}>
                    v{v.version} · {new Date(v.createdAt).toLocaleString()}
                    {v.author ? ` · ${v.author}` : ""}
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    {v.reason
                      ? v.reason
                      : v.version === 1
                      ? "Original record created"
                      : v.narrative}
                  </Typography>
                </Box>
              </Stack>
            ))}
          </Stack>
        </Paper>

        {/* ── Voided notice (record is soft-deleted) ── */}
        {rec.voided && (
          <Paper
            variant="outlined"
            sx={{
              p: { xs: 2, md: 2.5 }, borderRadius: 3,
              bgcolor: "rgba(224,89,74,0.08)", borderColor: "rgba(224,89,74,0.35)",
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <BlockRoundedIcon color="error" fontSize="small" />
              <Typography variant="subtitle2" sx={{ color: "error.main", fontWeight: 700 }}>
                This record was deleted
              </Typography>
            </Stack>
            <Typography variant="body2" sx={{ mt: 1 }}>
              {rec.voidedReason ?? "No reason recorded."}
            </Typography>
            <Typography
              variant="caption"
              sx={{ fontFamily: MONO, color: "text.secondary", mt: 0.5, display: "block" }}
            >
              {rec.voidedAt ? new Date(rec.voidedAt).toLocaleString() : ""}
              {rec.voidedBy ? ` · ${rec.voidedBy}` : ""}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
              It's excluded from Home and the dashboard, but stays in the audit trail — nothing is
              ever permanently removed.
            </Typography>
          </Paper>
        )}

        {/* ── Amend panel — hidden once a record is voided ── */}
        {!rec.voided && (
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 3, borderColor: "divider" }}>
          <Typography variant="h6">Amend record</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Edit the narrative below, then provide a reason before saving.
          </Typography>
          <Divider sx={{ my: 2 }} />

          {diff.length > 0 && (
            <>
              <Typography variant="subtitle2" gutterBottom>Before / after diff</Typography>
              <Typography
                component="div"
                sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word", mt: 1, mb: 2 }}
              >
                {diff.map((seg, i) => (
                  <Box
                    component="span"
                    key={i}
                    sx={{
                      color:
                        seg.type === "removed" ? "error.main"
                        : seg.type === "added"   ? "success.main"
                        : "text.primary",
                      backgroundColor:
                        seg.type === "removed" ? "rgba(224,89,74,0.14)"
                        : seg.type === "added"   ? "rgba(45,170,90,0.16)"
                        : "transparent",
                      px: seg.type === "same" ? 0 : 0.4,
                      borderRadius: 0.5,
                    }}
                  >
                    {seg.text}
                  </Box>
                ))}
              </Typography>
            </>
          )}

          <TextField
            label="Narrative"
            multiline
            minRows={3}
            fullWidth
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            sx={{ mb: 2 }}
          />
          <TextField
            label="Reason (required)"
            fullWidth
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {err && (
            <Typography color="error" variant="body2" sx={{ mt: 1 }}>
              {err}
            </Typography>
          )}
          <Button
            variant="contained"
            color="secondary"
            disabled={amending}
            onClick={amend}
            sx={{ mt: 2 }}
          >
            {amending ? "Amending…" : "Save amendment"}
          </Button>
        </Paper>
        )}

        {/* ── Danger zone — delete (soft-delete / void) ── */}
        {!rec.voided && (
        <Paper
          variant="outlined"
          sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 3, borderColor: "rgba(224,89,74,0.35)" }}
        >
          <Typography variant="h6" sx={{ color: "error.main" }}>Delete record</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Made this in error? Deleting removes it from your record list and the dashboard, but
            it stays in the audit trail with your reason attached — nothing is ever permanently
            erased.
          </Typography>
          <Button
            variant="outlined"
            color="error"
            startIcon={<DeleteOutlineIcon />}
            onClick={() => setVoidDialogOpen(true)}
            sx={{ mt: 2 }}
          >
            Delete this record
          </Button>
        </Paper>
        )}

        {/* ── Delete confirmation dialog ── */}
        <Dialog open={voidDialogOpen} onClose={() => (!voiding && setVoidDialogOpen(false))} maxWidth="sm" fullWidth>
          <DialogTitle>Delete this record?</DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ mb: 2 }}>
              This record will be removed from Home and the dashboard. It is not permanently
              erased — it stays in the audit trail so there's a record of what happened and why.
              A reason is required.
            </DialogContentText>
            <TextField
              label="Reason (required)"
              fullWidth
              autoFocus
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="e.g. Duplicate entry, wrong site selected, test recording"
            />
            {voidErr && (
              <Typography color="error" variant="body2" sx={{ mt: 1 }}>
                {voidErr}
              </Typography>
            )}
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setVoidDialogOpen(false)} disabled={voiding}>
              Cancel
            </Button>
            <Button variant="contained" color="error" onClick={handleVoid} disabled={voiding}>
              {voiding ? "Deleting…" : "Delete record"}
            </Button>
          </DialogActions>
        </Dialog>

      </Stack>
    </ScreenShell>
  );
}
