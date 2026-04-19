const SCORE_TIER_LABELS: Record<number, string> = {
  5: "Exemplary",
  4: "Strong",
  3: "Solid",
  2: "Partial",
  1: "Limited",
};

export function tierLabelForScore(score: number | null): string {
  if (score == null) return "Unscorable";
  return SCORE_TIER_LABELS[score] ?? "Unscorable";
}
