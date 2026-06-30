// 06 Back-office trade-risk dashboard (stretch) — OSHA spine benchmark + on-device record count.
import { useEffect, useState } from "react";
import { Box, Button, Card, CardContent, Paper, Stack, Typography } from "@mui/material";
import ScreenShell from "../components/ScreenShell";
import { listRecords } from "../lib/api";
import { tradeStats } from "../lib/tradeStats";

const meta = tradeStats.meta as { in_msa_inspections: number; cited_rate: number; total_penalty: number };
const fmtMoney = (n: number) => `$${(n / 1_000_000).toFixed(1)}M`;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card variant="outlined" sx={{ borderColor: "divider", borderRadius: 3 }}>
      <CardContent>
        <Typography variant="h3" sx={{ fontSize: 24, mb: 1 }}>{value}</Typography>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
      </CardContent>
    </Card>
  );
}

export default function DashboardScreen({ onHome }: { onHome: () => void }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    listRecords().then((r) => setCount((r as unknown[]).length)).catch(() => {});
  }, []);

  const trades = Object.entries(tradeStats.trades)
    .filter(([, t]) => t.name)
    .sort((a, b) => b[1].cited_rate - a[1].cited_rate)
    .slice(0, 7);

  return (
    <ScreenShell
      title="Trade-risk dashboard"
      subtitle="OSHA construction enforcement insights for the local market."
      eyebrow="Back-office view"
      action={(
        <Button variant="outlined" onClick={onHome} sx={{ color: "common.white", borderColor: "rgba(255,255,255,0.2)" }}>
          Home
        </Button>
      )}
    >
      <Stack spacing={3} sx={{ pb: 2 }}>
        <Paper variant="outlined" sx={{ p: { xs: 2.2, md: 2.6 }, borderRadius: 3, bgcolor: "grey.50" }}>
          <Stack spacing={2} sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" } }}>
            <Stat label="Records on device" value={String(count)} />
            <Stat label="In-MSA inspections" value={meta.in_msa_inspections.toLocaleString()} />
            <Stat label="Cited rate" value={`${(meta.cited_rate * 100).toFixed(1)}%`} />
            <Stat label="Total penalties" value={fmtMoney(meta.total_penalty)} />
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: { xs: 2.2, md: 2.6 }, borderRadius: 3 }}>
          <Typography variant="h6">Violation rate by trade</Typography>
          <Stack spacing={1.5} sx={{ mt: 2 }}>
            {trades.map(([naics, t]) => {
              const pct = Math.min(100, t.cited_rate * 100);
              return (
                <Paper key={naics} variant="outlined" sx={{ p: 2, bgcolor: "background.paper", borderColor: "divider", borderRadius: 2 }}>
                  <Stack direction={{ xs: "column", sm: "row" }} alignItems="center" spacing={2}>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{t.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{t.inspections.toLocaleString()} inspections · {(pct).toFixed(1)}% cited</Typography>
                    </Box>
                    <Box sx={{ flex: 1, width: "100%" }}>
                      <Box sx={{ height: 10, borderRadius: 5, bgcolor: "grey.200", overflow: "hidden" }}>
                        <Box sx={{ width: `${pct}%`, height: "100%", bgcolor: "secondary.main" }} />
                      </Box>
                    </Box>
                    <Typography variant="body2" sx={{ minWidth: 60, textAlign: "right" }}>{pct.toFixed(1)}%</Typography>
                  </Stack>
                </Paper>
              );
            })}
          </Stack>
        </Paper>

        <Typography variant="caption" color="text.secondary">
          Source: DOL Open Data (OSHA enforcement), recomputed in-house.
        </Typography>
      </Stack>
    </ScreenShell>
  );
}
