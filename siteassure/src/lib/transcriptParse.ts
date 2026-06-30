import { tradeStats } from "./tradeStats";
import type { RecordFields } from "./types";

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function normalizedInput(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function parseDate(raw: string): string | undefined {
  const text = normalizedInput(raw.toLowerCase());
  const monthMatch = text.match(new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{1,2})(?:,?\\s*(\\d{4}))?\\b`, "i"));
  if (monthMatch) {
    const month = MONTHS.indexOf(monthMatch[1].toLowerCase());
    const day = Number(monthMatch[2]);
    const year = monthMatch[3] ? Number(monthMatch[3]) : new Date().getFullYear();
    const parsed = new Date(year, month, day);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  const numericMatch = text.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (numericMatch) {
    let month = Number(numericMatch[1]);
    let day = Number(numericMatch[2]);
    let year = numericMatch[3] ? Number(numericMatch[3]) : new Date().getFullYear();
    if (year < 100) year += 2000;
    const parsed = new Date(year, month - 1, day);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  return undefined;
}

function parseSite(raw: string): string | undefined {
  const text = normalizedInput(raw);
  const match = text.match(/\b(?:site|location|project|job site)\s*(?:is|at|:)?\s*([A-Z][\w\s\-\/.,]{3,80})/i);
  if (match) {
    return match[1].trim().replace(/\.+$/, "");
  }
  return undefined;
}

function parseCrew(raw: string): string | undefined {
  const text = normalizedInput(raw);
  const match = text.match(/\b(?:crew|team|crew of|team of|foreman)\s*(?:is|:|of)?\s*([A-Z][\w\s\-]{2,80})/i);
  if (match) {
    return match[1].trim().replace(/\.+$/, "");
  }
  return undefined;
}

const TRADE_KEYWORDS: Record<string, string> = {
  electrical: "238210",
  plumbing: "238220",
  roofing: "238160",
  carpentry: "238350",
  "concrete": "238110",
  drywall: "238310",
  hvac: "238220",
  welding: "238190",
  "steel erection": "238120",
  masonry: "238140",
};

function parseTradeNaics(raw: string): string | undefined {
  const text = normalizedInput(raw.toLowerCase());

  for (const [keyword, code] of Object.entries(TRADE_KEYWORDS)) {
    if (text.includes(keyword)) return code;
  }

  for (const [code, stat] of Object.entries(tradeStats.trades)) {
    if (!stat.name) continue;
    const name = stat.name.toLowerCase();
    if (text.includes(name)) return code;
  }

  return undefined;
}

export function autoParseFields(text: string, current: RecordFields): RecordFields {
  const parsed: RecordFields = { ...current };
  const normalized = normalizedInput(text);

  if (!parsed.date) {
    const date = parseDate(normalized);
    if (date) parsed.date = date;
  }
  if (!parsed.site) {
    const site = parseSite(text);
    if (site) parsed.site = site;
  }
  if (!parsed.crew) {
    const crew = parseCrew(text);
    if (crew) parsed.crew = crew;
  }
  if (!parsed.tradeNaics) {
    const tradeNaics = parseTradeNaics(normalized);
    if (tradeNaics) parsed.tradeNaics = tradeNaics;
  }

  return parsed;
}
