// Loads the OSHA trade-risk stats produced by data/osha_pipeline.py.
// Used for safety-flag context ("Roofing - 57.8% cited") and the back-office dashboard.
import stats from "../../data/osha_trade_stats.json";

export interface TradeStat {
  name: string | null;
  inspections: number; cited: number; cited_rate: number;
  total_penalty: number; avg_penalty_per_cited: number;
  repeat_citations: number; small_sample: boolean;
}
export const tradeStats = stats as {
  meta: Record<string, unknown>;
  trades: Record<string, TradeStat>;
};

/** Context line for a flag, e.g. "Roofing · 57.8% cited for this". */
export function citedContext(naics?: string): string | undefined {
  if (!naics) return undefined;
  const t = tradeStats.trades[naics];
  if (!t || !t.name) return undefined;
  return `${t.name} · ${(t.cited_rate * 100).toFixed(1)}% cited for this`;
}
