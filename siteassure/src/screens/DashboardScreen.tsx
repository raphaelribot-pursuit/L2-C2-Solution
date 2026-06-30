// 06 Back-office trade-risk dashboard (stretch) — OSHA spine benchmark + on-device record count.
import { useEffect, useState } from "react";
import { Box, Button, Stack, Typography, Card, CardContent, Paper } from "@mui/material";
import { listRecords } from "../lib/api";
import { tradeStats } from "../lib/tradeStats";

const meta = tradeStats.meta as { in_msa_inspections: number; cited_rate: number; total_penalty: number };
const fmtMoney = (n: number) => `$${(n / 1_000_000).toFixed(1)}M`;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card variant="outlined" sx={{ flex: 1, minWidth: 140, borderColor: "grey.300" }}>
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
    <Box sx={{ p: 2, pb: 4 }}>
      <Button onClick={onHome} sx={{ mb: 2 }}>Home</Button>
      <Typography variant="h3" gutterBottom>Trade-risk dashboard</Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        OSHA construction enforcement · NY–Newark–Jersey City MSA
      </Typography>

      <Paper variant="outlined" sx={{ p: 2, mb: 3, bgcolor: "background.default", borderColor: "grey.300" }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <Stat label="Records on device" value={String(count)} />
          <Stat label="In-MSA inspections" value={meta.in_msa_inspections.toLocaleString()} />
          <Stat label="Cited rate" value={`${(meta.cited_rate * 100).toFixed(1)}%`} />
          <Stat label="Total penalties" value={fmtMoney(meta.total_penalty)} />
        </Stack>
      </Paper>

      <Typography variant="h3" sx={{ fontSize: 18, mt: 1, mb: 1 }}>Violation rate by trade</Typography>
      <Stack spacing={2}>
        {trades.map(([naics, t]) => {
          const pct = Math.min(100, t.cited_rate * 100);
          return (
            <Paper key={naics} variant="outlined" sx={{ p: 2, bgcolor: "background.paper", borderColor: "grey.300" }}>
              <Stack direction={{ xs: "column", sm: "row" }} alignItems="center" spacing={2}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{t.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t.inspections.toLocaleString()} inspections · {(pct).toFixed(1)}% cited
                  </Typography>
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

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 3 }}>
        Source: DOL Open Data (OSHA enforcement), recomputed in-house.
      </Typography>
    </Box>
  );
}
