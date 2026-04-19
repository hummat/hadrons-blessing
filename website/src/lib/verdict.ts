import type {
  BuildDetailData,
  BuildScores,
  DimensionScoreDetail,
  ScorecardQualitative,
} from "./types.ts";
import { formatCoverageFraction, formatCoverageLabel, rewriteExplanation } from "./detail-format.ts";

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

// Below this fraction, the calc pipeline has simulated too few selections for
// a "clean verdict" claim to be trustworthy. Codex audit flagged two Havoc 40
// fixtures at 0.41 / 0.49 that read as clean despite the gap.
const CALC_COVERAGE_RISK_THRESHOLD = 0.6;

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
  | { kind: "scoring_unavailable"; text: string }
  | { kind: "low_calc_coverage"; text: string }
  | { kind: "calc_coverage_missing"; text: string }
  | { kind: "clean"; text: string }
  | { kind: "calc_coverage"; text: string };

function pickLowestQualitative(entries: QualitativeEntry[]): QualitativeEntry | null {
  if (entries.length === 0) return null;
  return entries.reduce((lowest, entry) => (entry.score < lowest.score ? entry : lowest), entries[0]);
}

export function buildRiskBullets(detail: BuildDetailData, blessingMap: Record<string, string> = {}): RiskBullet[] {
  const risks: RiskBullet[] = [];
  const informational: RiskBullet[] = [];

  const qualitativeEntries = collectQualitative(detail.scorecard.qualitative, detail.summary.scores);
  if (qualitativeEntries.length === 0) {
    risks.push({ kind: "scoring_unavailable", text: "Qualitative scoring unavailable" });
  } else {
    const lowest = pickLowestQualitative(qualitativeEntries);
    if (lowest && lowest.score <= 2) {
      const label = QUALITATIVE_LABELS[lowest.key];
      const explanation = rewriteExplanation(lowest.key, lowest.detail.explanations[0] ?? "", blessingMap);
      risks.push({
        kind: "low_dimension",
        text: explanation ? `${label} ${lowest.score}/5 \u2014 ${explanation}` : `${label} ${lowest.score}/5`,
      });
    }
  }

  const gaps = detail.synergy.coverage.coverage_gaps;
  if (gaps.length > 0) {
    const formatted = gaps.map((gap) => formatCoverageLabel(gap)).join(" \u00b7 ");
    risks.push({ kind: "gaps", text: `Gaps: ${formatted}` });
  }

  const antiCount = detail.synergy.anti_synergies.length;
  const orphanCount = detail.synergy.orphans.length;
  if (antiCount > 0 || orphanCount > 0) {
    const antiLabel = `${antiCount} anti-synergies`;
    const orphanLabel = `${orphanCount} isolated pick${orphanCount === 1 ? "" : "s"}`;
    risks.push({ kind: "anti_orphan", text: `${antiLabel} \u00b7 ${orphanLabel}` });
  }

  const pct = detail.synergy.metadata.calc_coverage_pct;
  if (pct == null || !Number.isFinite(pct)) {
    risks.push({ kind: "calc_coverage_missing", text: "Effect-modeled coverage unavailable" });
  } else if (pct < CALC_COVERAGE_RISK_THRESHOLD) {
    risks.push({
      kind: "low_calc_coverage",
      text: `Low effect-modeled coverage \u2014 only ${formatCoverageFraction(pct)} of selections simulated`,
    });
  } else {
    informational.push({ kind: "calc_coverage", text: `Effect-modeled coverage ${formatCoverageFraction(pct)}` });
  }

  if (risks.length === 0) {
    risks.push({ kind: "clean", text: "Clean verdict \u2014 no flagged risks" });
  }

  return [...risks, ...informational];
}
