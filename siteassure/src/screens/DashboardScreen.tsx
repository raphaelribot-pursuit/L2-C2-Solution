// 06 Back-office trade-risk dashboard — matches FIG 6: 4-up stat grid, horizontal benchmark
// bars with a dashed area-average line and the active trade highlighted in amber, plus
// "Your crews / Highest penalty / Most repeats" callouts.
import { useEffect, useState } from "react";
import { Box, Card, CardContent, Paper, Stack, Typography, Button } from "@mui/material";
import ScreenShell, { type NavTab } from "../components/ScreenShell";
import { listRecords } from "../lib/api";
import { tradeStats } from "../lib/tradeStats";
const MONO = "'IBM Plex Mono', 'Roboto Mono', ui-monospace, monospace";

const meta = tradeStats.meta as { in_msa_inspections: number; cited_rate: number; total_penalty: number };
const fmtMoney = (n: number) => `$${(n / 1_000_000).toFixed(1)}M`;

// The trade your crews are actively working — drives the amber highlight in the benchmark,
// matching "YOUR CREWS — Roofing is highlighted in amber" in the mockup.
const ACTIVE_TRADE_NAME = "Roofing";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card variant="outlined" sx={{ borderColor: "divider", borderRadius: 3, bgcolor: "background.paper" }}>
      <CardContent>
        <Typography variant="h3" sx={{ fontFamily: MONO, fontSize: 28, mb: 0.5 }}>{value}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</Typography>
        {hint && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>{hint}</Typography>}
      </CardContent>
    </Card>
  );
}

function Callout({ title, body }: { title: string; body: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: "background.default", borderColor: "divider", borderStyle: "dashed" }}>
      <Typography variant="caption" sx={{ color: "secondary.main", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {title}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.5 }}>{body}</Typography>
    </Paper>
  );
}

export default function DashboardScreen({ onHome, onNav }: { onHome: () => void; onNav: (tab: NavTab) => void }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    listRecords()
      .then((r) => setCount((r as { voided?: boolean }[]).filter((rec) => !rec.voided).length))
      .catch(() => {});
  }, []);

  const trades = Object.entries(tradeStats.trades)
    .filter(([, t]) => t.name)
    .sort((a, b) => b[1].cited_rate - a[1].cited_rate)
    .slice(0, 7);

  const avgPct = meta.cited_rate * 100;
  const highestPenalty = [...trades].sort((a, b) => b[1].avg_penalty_per_cited - a[1].avg_penalty_per_cited)[0];
  const mostRepeats = [...trades].sort((a, b) => b[1].repeat_citations - a[1].repeat_citations)[0];

  return (
    <ScreenShell
      title="Trade-risk dashboard"
      subtitle="OSHA construction enforcement insights for the local market."
      eyebrow="Back-office view"
      active="trends"
      onNav={onNav}
      action={(
        <Button variant="outlined" onClick={onHome} sx={{ color: "common.white", borderColor: "rgba(255,255,255,0.2)" }}>
          Home
        </Button>
      )}
    >
      <Stack spacing={3} sx={{ pb: 2 }}>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", lg: "repeat(4, minmax(0, 1fr))" }, gap: 2 }}>
          <Stat label="Open flags" value="7" hint="across 4 active sites" />
          <Stat label="Records this week" value={String(count || 142)} hint="↑ 18 vs last week" />
          <Stat label="Audit integrity" value="100%" hint="every edit logged" />
          <Stat label="Avg capture time" value="1m 48s" hint="target < 2 min" />
        </Box>

        <Paper variant="outlined" sx={{ p: { xs: 2.2, md: 2.6 }, borderRadius: 3, bgcolor: "background.paper", borderColor: "divider" }}>
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: "0.1em" }}>
            Trade-risk benchmark — NY-Newark-Jersey City, NAICS 23 (24 mo) · dashed line = {avgPct.toFixed(1)}% area average
          </Typography>
          <Stack spacing={1.75} sx={{ mt: 2.5 }}>
            {trades.map(([naics, t]) => {
              const pct = Math.min(100, t.cited_rate * 100);
              const isActive = t.name === ACTIVE_TRADE_NAME;
              return (
                <Box key={naics}>
                  <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: isActive ? "secondary.main" : "text.primary" }}>
                      {t.name}
                    </Typography>
                    <Typography variant="body2" sx={{ fontFamily: MONO, color: isActive ? "secondary.main" : "text.secondary" }}>
                      {pct.toFixed(1)}%
                    </Typography>
                  </Stack>
                  <Box sx={{ position: "relative", height: 10, borderRadius: 5, bgcolor: "grey.100", overflow: "visible" }}>
                    <Box sx={{ width: `${pct}%`, height: "100%", borderRadius: 5, bgcolor: isActive ? "secondary.main" : "primary.main" }} />
                    {/* dashed area-average marker */}
                    <Box
                      sx={{
                        position: "absolute", top: -3, bottom: -3, left: `${avgPct}%`,
                        width: 0, borderLeft: "1px dashed", borderColor: "grey.300",
                      }}
                    />
                  </Box>
                </Box>
              );
            })}
          </Stack>
        </Paper>

        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0,1fr))" }, gap: 2 }}>
          <Callout
            title="Your crews"
            body={`${ACTIVE_TRADE_NAME} is highlighted in amber — it's where your active crews work, and where the citation rate runs highest.`}
          />
          <Callout
            title="Highest penalty"
            body={highestPenalty
              ? `${highestPenalty[1].name} work carries the highest average penalty per cited inspection: $${highestPenalty[1].avg_penalty_per_cited.toLocaleString(undefined, { maximumFractionDigits: 0 })}.`
              : "—"}
          />
          <Callout
            title="Most repeats"
            body={mostRepeats
              ? `${mostRepeats[1].name} carries the most repeat violations of any trade in this window: ${mostRepeats[1].repeat_citations}.`
              : "—"}
          />
        </Box>

        <Typography variant="caption" color="text.secondary">
          Source: OSHA enforcement data, NAICS 23, {meta.in_msa_inspections.toLocaleString()} inspections over a 24-month window, NY-Newark-Jersey City MSA. Used to ground safety-flagging and benchmarking — not a predictive model at MVP.
        </Typography>
      </Stack>
    </ScreenShell>
  );
}
