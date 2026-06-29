// 06 Back-office trade-risk dashboard (stretch) — OSHA spine benchmark + on-device record count.
import { useEffect, useState } from "react";
import { Box, Button, Stack, Typography, Card, CardContent, LinearProgress } from "@mui/material";
import { listRecords } from "../lib/api";
import { tradeStats } from "../lib/tradeStats";

const meta = tradeStats.meta as { in_msa_inspections: number; cited_rate: number; total_penalty: number };
const fmtMoney = (n: number) => `$${(n / 1_000_000).toFixed(1)}M`;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card variant="outlined" sx={{ flex: 1, minWidth: 120 }}>
      <CardContent>
        <Typography variant="h3" sx={{ fontSize: 24 }}>{value}</Typography>
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
    .sort((a, b) => b[1].cited_rate - a[1].cited_rate);

  return (
    <Box sx={{ p: 2, pb: 4 }}>
      <Button onClick={onHome}>Home</Button>
      <Typography variant="h3" gutterBottom>Trade-risk dashboard</Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        OSHA construction enforcement · NY–Newark–Jersey City MSA
      </Typography>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ my: 2 }}>
        <Stat label="Records on device" value={String(count)} />
        <Stat label="In-MSA inspections" value={meta.in_msa_inspections.toLocaleString()} />
        <Stat label="Cited rate" value={`${(meta.cited_rate * 100).toFixed(1)}%`} />
        <Stat label="Total penalties" value={fmtMoney(meta.total_penalty)} />
      </Stack>

      <Typography variant="h3" sx={{ fontSize: 18, mt: 3, mb: 1 }}>Violation rate by trade</Typography>
      <Stack spacing={1.5}>
        {trades.map(([naics, t]) => (
          <Box key={naics}>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2">{t.name}</Typography>
              <Typography variant="body2" color="secondary.dark">
                {(t.cited_rate * 100).toFixed(1)}% · {t.inspections} insp.
              </Typography>
            </Stack>
            <LinearProgress variant="determinate" value={Math.min(100, t.cited_rate * 100)}
              color="secondary" sx={{ height: 10, borderRadius: 5 }} />
          </Box>
        ))}
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 3 }}>
        Source: DOL Open Data (OSHA enforcement), recomputed in-house. See docs/OSHA_DATA_METHODOLOGY.md.
      </Typography>
    </Box>
  );
}
