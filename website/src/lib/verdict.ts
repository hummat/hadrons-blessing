import type {
  BuildDetailData,
  BuildScores,
  DimensionScoreDetail,
  ScorecardQualitative,
} from "./types.ts";
import { formatCoverageLabel } from "./detail-format.ts";

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

export type RiskBullet =
  | { kind: "low_dimension"; text: string }
  | { kind: "gaps"; text: string }
  | { kind: "anti_orphan"; text: string }
  | { kind: "clean"; text: string }
  | { kind: "calc_coverage"; text: string };

function pickLowestQualitative(
  qualitative: ScorecardQualitative,
  scores: BuildScores,
): QualitativeEntry | null {
  const entries = collectQualitative(qualitative, scores);
  if (entries.length === 0) return null;
  return entries.reduce((lowest, entry) => (entry.score < lowest.score ? entry : lowest), entries[0]);
}

export function buildRiskBullets(detail: BuildDetailData): RiskBullet[] {
  const bullets: RiskBullet[] = [];

  const lowest = pickLowestQualitative(detail.scorecard.qualitative, detail.summary.scores);
  if (lowest && lowest.score <= 2) {
    const label = QUALITATIVE_LABELS[lowest.key];
    const explanation = lowest.detail.explanations[0] ?? "";
    bullets.push({
      kind: "low_dimension",
      text: explanation ? `${label} ${lowest.score}/5 \u2014 ${explanation}` : `${label} ${lowest.score}/5`,
    });
  }

  const gaps = detail.synergy.coverage.coverage_gaps;
  if (gaps.length > 0) {
    const formatted = gaps.map((gap) => formatCoverageLabel(gap)).join(" \u00b7 ");
    bullets.push({ kind: "gaps", text: `Gaps: ${formatted}` });
  }

  const antiCount = detail.synergy.anti_synergies.length;
  const orphanCount = detail.synergy.orphans.length;
  if (antiCount > 0 || orphanCount > 0) {
    const antiLabel = `${antiCount} anti-synergies`;
    const orphanLabel = `${orphanCount} isolated pick${orphanCount === 1 ? "" : "s"}`;
    bullets.push({ kind: "anti_orphan", text: `${antiLabel} \u00b7 ${orphanLabel}` });
  }

  if (bullets.length === 0) {
    bullets.push({ kind: "clean", text: "Clean verdict \u2014 no flagged risks" });
  }

  const pct = Math.round(detail.synergy.metadata.calc_coverage_pct);
  bullets.push({ kind: "calc_coverage", text: `Calc coverage ${pct}%` });

  return bullets;
}
