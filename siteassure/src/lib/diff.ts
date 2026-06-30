export type DiffSegment = { text: string; type: "same" | "added" | "removed" };

function buildLcsMatrix(a: string[], b: string[]) {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

export function diffText(oldText: string, newText: string): DiffSegment[] {
  const oldWords = oldText.split(/(\s+)/).filter(Boolean);
  const newWords = newText.split(/(\s+)/).filter(Boolean);
  const dp = buildLcsMatrix(oldWords, newWords);
  const segments: DiffSegment[] = [];
  let i = 0;
  let j = 0;

  while (i < oldWords.length || j < newWords.length) {
    if (i < oldWords.length && j < newWords.length && oldWords[i] === newWords[j]) {
      segments.push({ text: oldWords[i], type: "same" });
      i += 1;
      j += 1;
    } else if (j < newWords.length && (i === oldWords.length || dp[i][j + 1] >= dp[i + 1][j])) {
      segments.push({ text: newWords[j], type: "added" });
      j += 1;
    } else if (i < oldWords.length) {
      segments.push({ text: oldWords[i], type: "removed" });
      i += 1;
    }
  }

  return segments;
}
