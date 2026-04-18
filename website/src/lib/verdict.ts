import type {
  BuildScores,
  DimensionScoreDetail,
  ScorecardQualitative,
} from "./types.ts";

export type SignatureStrength = {
  key: keyof ScorecardQualitative;
  label: string;
  score: number;
  explanation: string;
};

const QUALITATIVE_LABELS: Record<keyof ScorecardQualitative, string> = {
  talent_coherence: "Talent Coherence",
  blessing_synergy: "Blessing Synergy",
  role_coverage: "Role Coverage",
  breakpoint_relevance: "Breakpoint Relevance",
  difficulty_scaling: "Difficulty Scaling",
};

type QualitativeEntry = {
  key: keyof ScorecardQualitative;
  detail: DimensionScoreDetail;
  score: number;
};

function collectQualitative(qualitative: ScorecardQualitative, scores: BuildScores): QualitativeEntry[] {
  const entries: QualitativeEntry[] = [];
  for (const key of Object.keys(QUALITATIVE_LABELS) as Array<keyof ScorecardQualitative>) {
    const detail = qualitative[key];
    const score = scores[key];
    if (detail == null || score == null) continue;
    entries.push({ key, detail, score });
  }
  return entries;
}

function toStrength(entry: QualitativeEntry): SignatureStrength {
  return {
    key: entry.key,
    label: QUALITATIVE_LABELS[entry.key],
    score: entry.score,
    explanation: entry.detail.explanations[0] ?? "",
  };
}

export function selectSignatureStrengths(
  qualitative: ScorecardQualitative,
  scores: BuildScores,
): SignatureStrength[] {
  const entries = collectQualitative(qualitative, scores);
  if (entries.length === 0) return [];

  const ranked = [...entries].sort((a, b) => b.score - a.score);
  const topTwo = ranked.filter((entry) => entry.score >= 4).slice(0, 2);
  if (topTwo.length > 0) return topTwo.map(toStrength);

  return [toStrength(ranked[0])];
}
