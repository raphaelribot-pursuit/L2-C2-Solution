// Grammar review. Local rule-based linter is the FREE path (offline, no setup).
// The AI path is PRO and gated by entitlements.llm_grammar — and critically,
// for a real product the LLM call should go through YOUR backend, not directly
// from the client, so the API key and the entitlement check live server-side.
export interface Issue { kind: "grammar" | "style" | "spelling"; msg: string; from?: string; to?: string; }
export interface Review { score: number; issues: Issue[]; fixed: string; recommendation: string; source: string; }

export function reviewLocal(text: string): Review {
  const issues: Issue[] = [];
  let fixed = text;
  const push = (kind: Issue["kind"], msg: string, from?: string, to?: string) =>
    issues.push({ kind, msg, from, to });

  if (/\s{2,}/.test(fixed)) { push("style", "Collapse repeated spaces"); fixed = fixed.replace(/[ \t]{2,}/g, " "); }
  if (/\s+[,.;:!?]/.test(fixed)) { push("style", "Remove space before punctuation"); fixed = fixed.replace(/\s+([,.;:!?])/g, "$1"); }
  if (/\bi\b/.test(fixed)) { push("grammar", "Capitalize the pronoun “I”", "i", "I"); fixed = fixed.replace(/\bi\b/g, "I"); }
  const dup = fixed.match(/\b(\w+)\s+\1\b/i);
  if (dup) { push("grammar", "Remove the repeated word", `${dup[1]} ${dup[1]}`, dup[1]); fixed = fixed.replace(/\b(\w+)\s+\1\b/gi, "$1"); }
  if (/\ba\s+[aeiou]/i.test(fixed)) { push("grammar", "Use “an” before a vowel sound", "a apple", "an apple"); }
  fixed = fixed.replace(/(^|[.!?]\s+)([a-z])/g, (_m, p, c) => { push("grammar", "Capitalize the start of a sentence"); return p + c.toUpperCase(); });
  const trimmed = fixed.trim();
  if (trimmed && !/[.!?]$/.test(trimmed)) { push("style", "Add closing punctuation"); fixed = trimmed + "."; }

  const seen = new Set<string>();
  const uniq = issues.filter((i) => (seen.has(i.msg) ? false : (seen.add(i.msg), true)));
  const score = Math.max(40, 100 - uniq.length * 9);
  const recommendation = score >= 85 ? "Reads well — ship it as is."
    : score >= 65 ? "A couple of tidy-ups and this is publish-ready."
    : "Worth a careful pass before sharing.";
  return { score, issues: uniq, fixed: fixed.trim(), recommendation, source: "local rules" };
}
