import { DIMENSIONS } from "../dimensions.ts";
import type {
  BuildDetailData,
  DimensionScoreDetail,
  ScorecardCurioPerk,
  ScorecardPerk,
  ScorecardQualitative,
} from "../types.ts";
import { tierLabelForScore } from "./tiers.ts";

export type HoverCardTone = "default" | "warn" | "danger";
export type HoverCardSourceLabel = "scorecard" | "calculator" | "synergy model";

export interface HoverCardFact {
  label: string;
  value: string;
}

export interface PhaseAScoreHoverCard {
  key: string;
  label: string;
  score: number | null;
  max: number;
  tierLabel: string;
  triggerNote: string | null;
  title: string;
  subtitle: string;
  summary: string;
  facts: HoverCardFact[];
  sourceLabel: HoverCardSourceLabel;
  tone: HoverCardTone;
}

const EFFECT_MODELED_GRADE_WARN_THRESHOLD = 0.6;

const GAP_LABELS: Record<string, string> = {
  survivability: "Offense-first with no toughness or DR support",
  crit_chance_source: "Crit buffs with no crit chance source",
  warp_charge_producer: "Warp-charge consumer with no producer",
};

const DIMENSION_LABELS = new Map(DIMENSIONS.map((dimension) => [dimension.summary_key, dimension.label]));

function formatAverage(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "—";
  const rounded = Number.parseFloat(value.toFixed(digits));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(digits);
}

function countBy<T>(items: T[], predicate: (item: T) => boolean): number {
  return items.reduce((count, item) => count + (predicate(item) ? 1 : 0), 0);
}

function averagePerkTier(perks: ScorecardPerk[]): number | null {
  const tiers = perks.map((perk) => perk.tier).filter((tier): tier is number => typeof tier === "number");
  if (tiers.length === 0) return null;
  return tiers.reduce((sum, tier) => sum + tier, 0) / tiers.length;
}

function averageCurioTier(perks: ScorecardCurioPerk[]): number | null {
  const tiers = perks.map((perk) => perk.tier).filter((tier): tier is number => typeof tier === "number");
  if (tiers.length === 0) return null;
  return tiers.reduce((sum, tier) => sum + tier, 0) / tiers.length;
}

function summaryScore(detail: BuildDetailData, key: string): number | null {
  return detail.summary.scores[key as keyof typeof detail.summary.scores] as number | null;
}

function qualitativeDetail(detail: BuildDetailData, key: keyof ScorecardQualitative): DimensionScoreDetail | null {
  return detail.scorecard.qualitative[key] ?? null;
}

function activeScoreCount(detail: BuildDetailData): number {
  return [
    detail.summary.scores.perk_optimality,
    detail.summary.scores.curio_efficiency,
    detail.summary.scores.talent_coherence,
    detail.summary.scores.blessing_synergy,
    detail.summary.scores.role_coverage,
    detail.summary.scores.breakpoint_relevance,
    detail.summary.scores.difficulty_scaling,
    detail.summary.scores.survivability,
  ].filter((value) => value != null).length;
}

function slotBalanceLabel(detail: BuildDetailData): string {
  const melee = detail.synergy.coverage.slot_balance.melee.strength;
  const ranged = detail.synergy.coverage.slot_balance.ranged.strength;
  if (melee === ranged) return "balanced";
  const ratio = Math.min(melee, ranged) / Math.max(melee, ranged);
  if (Number.isFinite(ratio) && ratio >= 0.9) return "balanced";
  return melee > ranged ? "melee-heavy" : "ranged-heavy";
}

function joined(values: string[], fallback = "None"): string {
  return values.length > 0 ? values.join(", ") : fallback;
}

function highPriorityBreakpointMisses(detail: DimensionScoreDetail | null): string[] {
  const breakdown = detail?.breakdown;
  if (!Array.isArray(breakdown)) return [];
  return breakdown
    .filter((entry) => entry && typeof entry === "object" && entry.weight === "high" && entry.met === false)
    .map((entry) => String(entry.label));
}

function breakpointCounts(detail: DimensionScoreDetail | null): { met: number; total: number } {
  const breakdown = detail?.breakdown;
  if (!Array.isArray(breakdown)) return { met: 0, total: 0 };
  return {
    met: breakdown.filter((entry) => entry && typeof entry === "object" && entry.met === true).length,
    total: breakdown.length,
  };
}

function difficultyDegradations(detail: DimensionScoreDetail | null): string[] {
  const breakdown = detail?.breakdown;
  if (!breakdown || typeof breakdown !== "object" || !Array.isArray((breakdown as Record<string, unknown>).per_entry)) return [];
  return ((breakdown as Record<string, unknown>).per_entry as Array<Record<string, unknown>>)
    .filter((entry) => entry.damnation_met === true && entry.auric_met === false)
    .map((entry) => String(entry.label));
}

function scoreTone(score: number | null, tone: HoverCardTone): HoverCardTone {
  if (tone !== "default") return tone;
  if (score != null && score <= 2) return "warn";
  return "default";
}

function createCard(
  detail: BuildDetailData,
  key: string,
  sourceLabel: HoverCardSourceLabel,
  summary: string,
  title: string,
  subtitle: string,
  facts: HoverCardFact[],
  tone: HoverCardTone = "default",
): PhaseAScoreHoverCard {
  const score = summaryScore(detail, key);
  const max = DIMENSIONS.find((dimension) => dimension.summary_key === key)?.max ?? 5;
  const label = DIMENSION_LABELS.get(key) ?? title;
  const tierLabel = key === "composite" ? detail.summary.scores.grade : tierLabelForScore(score);
  const triggerNote = key === "composite" ? `Grade ${detail.summary.scores.grade}` : tierLabel;

  return {
    key,
    label,
    score,
    max,
    tierLabel,
    triggerNote,
    title,
    subtitle,
    summary,
    facts,
    sourceLabel,
    tone: scoreTone(score, tone),
  };
}

function perkCard(detail: BuildDetailData): PhaseAScoreHoverCard {
  const perks = detail.scorecard.weapons.flatMap((weapon) => weapon.perks.perks);
  const avgTier = averagePerkTier(perks);
  const score = summaryScore(detail, "perk_optimality");
  return createCard(
    detail,
    "perk_optimality",
    "scorecard",
    "How close your weapon perks are to max rolls, averaged across weapons.",
    "Perk Optimality",
    `${score ?? "—"}/5 ${tierLabelForScore(score)}`,
    [
      { label: "Score", value: `${score ?? "—"}/5 — ${tierLabelForScore(score)}` },
      { label: "Range", value: "1 (low-tier rolls) to 5 (all T4 or near)" },
      { label: "Derivation", value: "Each perk snaps to its nearest tier 1–4, averaged per weapon, then across weapons." },
      {
        label: "This build",
        value: `${detail.scorecard.weapons.length} weapons · avg perk tier ${formatAverage(avgTier)}/4`,
      },
      {
        label: "Implies",
        value:
          score === 5
            ? "Near-max rolls across the board — no breakpoint left on the table from sub-tier perks."
            : score != null && score >= 3
              ? "Mostly solid rolls; a re-roll or two would earn small breakpoint headroom."
              : "Several perks are under-rolled — re-rolling to tier max is usually a cheaper upgrade than swapping builds.",
      },
      {
        label: "Caveat",
        value:
          "Judges roll quality, not perk choice. A T4 perk on the wrong stat still scores well here; Role Coverage and Breakpoint Relevance catch that.",
      },
    ],
  );
}

function curioCard(detail: BuildDetailData): PhaseAScoreHoverCard {
  const perks = detail.scorecard.curios.perks;
  const optimalCount = countBy(perks, (perk) => perk.rating === "optimal");
  const solidCount = countBy(perks, (perk) => perk.rating === "good");
  const neutralCount = countBy(perks, (perk) => perk.rating === "neutral");
  const avoidCount = countBy(perks, (perk) => perk.rating === "avoid");
  const avgTier = averageCurioTier(perks);
  const score = summaryScore(detail, "curio_efficiency");
  return createCard(
    detail,
    "curio_efficiency",
    "scorecard",
    "Whether your curio perks fit this class's usual toolkit, and whether they're rolled high.",
    "Curio Efficiency",
    `${score ?? "—"}/5 ${tierLabelForScore(score)}`,
    [
      { label: "Score", value: `${score ?? "—"}/5 — ${tierLabelForScore(score)}` },
      { label: "Range", value: "1 (an 'avoid' perk present) to 5 (all class-optimal, all near-max)" },
      {
        label: "Derivation",
        value: "Each curio perk gets a class-specific rating (optimal / solid / neutral / avoid) plus a tier 1–4 from its roll value.",
      },
      {
        label: "This build",
        value: `${optimalCount} optimal · ${solidCount} solid · ${neutralCount} neutral · ${avoidCount} avoid · avg tier ${formatAverage(avgTier)}/4`,
      },
      {
        label: "Implies",
        value:
          score === 5
            ? "Every perk is class-optimal and near-max."
            : score != null && score >= 3
              ? "Most are class-appropriate; some are sub-tier or off-profile."
            : score === 2
              ? "Several neutral picks — you'd gain survivability or damage by swapping to class-standard perks."
                : "An 'avoid' perk is dragging the build down.",
      },
      {
        label: "Caveat",
        value: "Our per-class ratings are a starting point. A niche curio line can still make sense for a specific play pattern.",
      },
    ],
  );
}

function talentCard(detail: BuildDetailData): PhaseAScoreHoverCard {
  const score = summaryScore(detail, "talent_coherence");
  const dimension = qualitativeDetail(detail, "talent_coherence");
  const breakdown = (dimension?.breakdown ?? {}) as Record<string, unknown>;
  const talentCount = Number(breakdown.talent_count ?? detail.structure.talents.length);
  const pairCount = Number(breakdown.talent_edges ?? 0);
  const isolatedCount = Number(breakdown.graph_isolated_count ?? 0);
  return createCard(
    detail,
    "talent_coherence",
    "synergy model",
    "How tightly your talents feed each other — do they stack the same stats or chain into each other, or do they work in isolation?",
    "Talent Coherence",
    `${score ?? "—"}/5 ${tierLabelForScore(score)}`,
    [
      { label: "Score", value: `${score ?? "—"}/5 — ${tierLabelForScore(score)}` },
      { label: "Range", value: "1 (scattered picks) to 5 (tightly amplifying core)" },
      {
        label: "Derivation",
        value: "Count talent-to-talent synergies, divide by talent count, then adjust for focus and talents that do not interact with anything.",
      },
      {
        label: "This build",
        value: `${talentCount} talents · ${pairCount} synergy pairs · ${isolatedCount} standalone picks`,
      },
      {
        label: "Implies",
        value:
          score != null && score >= 4
            ? "Nearly every talent either stacks the same category or chains into another pick — the build has a clear thesis."
            : score === 3
              ? "A core works, but a few picks are scattered relative to it."
              : "Mostly independent picks — individually fine, but they do not amplify each other.",
      },
      {
        label: "Important caveat",
        value:
          "Only scores synergies the simulator can see. Teammate-coherency buffs, positional play, and narrative talents can work even when they do not produce visible synergy pairs.",
      },
    ],
  );
}

function blessingCard(detail: BuildDetailData): PhaseAScoreHoverCard {
  const score = summaryScore(detail, "blessing_synergy");
  const dimension = qualitativeDetail(detail, "blessing_synergy");
  const breakdown = (dimension?.breakdown ?? {}) as Record<string, unknown>;
  const blessingCount = Number(breakdown.blessing_count ?? detail.structure.weapons.flatMap((weapon) => weapon.blessings).length);
  const synergyCount = Number(breakdown.blessing_edges ?? 0);
  const orphanedCount = Number(breakdown.orphaned_blessings ?? 0);
  return createCard(
    detail,
    "blessing_synergy",
    "synergy model",
    "Whether your blessings feed your talents and each other, or sit alone on their weapons.",
    "Blessing Synergy",
    `${score ?? "—"}/5 ${tierLabelForScore(score)}`,
    [
      { label: "Score", value: `${score ?? "—"}/5 — ${tierLabelForScore(score)}` },
      { label: "Range", value: "1 (blessings work in isolation) to 5 (deeply woven in)" },
      {
        label: "Derivation",
        value: "Count synergies that involve at least one blessing, per blessing. Bonus if two blessings cooperate; penalty per blessing that does not interact with anything.",
      },
      {
        label: "This build",
        value: `${blessingCount} blessings · ${synergyCount} synergies · ${orphanedCount} with no interaction`,
      },
      {
        label: "Implies",
        value:
          score === 5
            ? "Blessings amplify your talents or each other."
            : score != null && score >= 3
              ? "Blessings are individually strong but picked more for the weapon than for the build."
              : "Most blessings do not interact with the rest of the build — they are mostly weapon-native picks.",
      },
      {
        label: "Caveat",
        value:
          "A blessing that is perfect for its weapon but has no visible synergy with your talents gets no credit here. That is a modeling limit, not necessarily a build flaw.",
      },
    ],
  );
}

function roleCoverageCard(detail: BuildDetailData): PhaseAScoreHoverCard {
  const score = summaryScore(detail, "role_coverage");
  const dimension = qualitativeDetail(detail, "role_coverage");
  const breakdown = (dimension?.breakdown ?? {}) as Record<string, unknown>;
  const activeFamilies = Number(breakdown.active_families ?? 0);
  const totalFamilies = Number(breakdown.total_families ?? 11);
  const coverageGaps = ((breakdown.coverage_gaps as string[] | undefined) ?? detail.synergy.coverage.coverage_gaps).map(
    (gap) => GAP_LABELS[gap] ?? gap,
  );
  const facts: HoverCardFact[] = [
    { label: "Score", value: `${score ?? "—"}/5 — ${tierLabelForScore(score)}` },
    { label: "Range", value: "1 (very narrow plus a clear gap) to 5 (broad coverage, no gaps)" },
    {
      label: "Derivation",
      value: "Count the active stat categories out of 11, then subtract for any named gap and for severe melee/ranged imbalance.",
    },
    {
      label: "This build",
      value: `${activeFamilies}/${totalFamilies} categories active${coverageGaps.length > 0 ? ` · gaps: ${coverageGaps.join(" · ")}` : ""} · ${slotBalanceLabel(detail)}`,
    },
    {
        label: "Implies",
        value:
          score === 5
            ? "Broad coverage, no flagged gaps."
          : score != null && score >= 3
            ? "Narrow or slightly off-balance, but nothing obviously missing."
            : "Very narrow and carrying at least one named gap.",
    },
  ];

  if (coverageGaps.length > 0) {
    facts.push({ label: "Gaps", value: joined(coverageGaps) });
  }

  if ((score ?? 0) <= 3 || coverageGaps.length > 0) {
    facts.push({
      label: "Specialist caveat",
      value:
        "Narrow is not the same as bad. A dedicated elite-killer or horde-clear build can score low here and still do its job. Read the gaps, not just the number.",
    });
  }

  return createCard(
    detail,
    "role_coverage",
    "synergy model",
    "How broad your build is across stat categories, and whether it has any obvious gaps.",
    "Role Coverage",
    `${score ?? "—"}/5 ${tierLabelForScore(score)}`,
    facts,
    coverageGaps.length > 0 && (score ?? 0) <= 2 ? "warn" : "default",
  );
}

function breakpointCard(detail: BuildDetailData): PhaseAScoreHoverCard {
  const score = summaryScore(detail, "breakpoint_relevance");
  const dimension = qualitativeDetail(detail, "breakpoint_relevance");
  const { met, total } = breakpointCounts(dimension);
  const missingHighPriority = highPriorityBreakpointMisses(dimension);
  const facts: HoverCardFact[] = [
    { label: "Score", value: `${score ?? "—"}/5 — ${tierLabelForScore(score)}` },
    { label: "Range", value: "1 (most checklist breakpoints missed) to 5 (nearly all met)" },
    {
      label: "Derivation",
      value: "For each checklist entry, we find your best hits-to-kill across all weapons at that enemy, hit location, and scenario.",
    },
    {
      label: "This build",
      value: `${met}/${total} breakpoints met${missingHighPriority.length > 0 ? ` · missing high-priority: ${missingHighPriority.join(", ")}` : ""}`,
    },
    {
      label: "Implies",
      value:
          score === 5
            ? "You hit the muscle-memory breakpoints — one-shot Trapper/Hound head, two-hit Crusher, two-hit Rager body, and similar anchors."
            : score != null && score >= 3
              ? "Common ones land; a few key breeds take an extra hit."
              : "Time-to-kill runs long — horde and elite fights will feel slow.",
    },
    {
      label: "Caveat",
      value:
        "Our checklist, not the game's. The list is curated for decisive breakpoints, not exhaustive coverage of every matchup.",
    },
    {
      label: "Coverage caveat",
      value:
        "If a weapon family is not fully modelled yet, the score can under-credit it. The per-weapon breakpoint panels may show Unsupported.",
    },
  ];

  return createCard(
    detail,
    "breakpoint_relevance",
    "calculator",
    "How many of our Damnation breakpoint checklist entries your build hits, weighted by importance.",
    "Breakpoint Relevance",
    `${score ?? "—"}/5 ${tierLabelForScore(score)}`,
    facts,
  );
}

function difficultyCard(detail: BuildDetailData): PhaseAScoreHoverCard {
  const score = summaryScore(detail, "difficulty_scaling");
  const dimension = qualitativeDetail(detail, "difficulty_scaling");
  const breakdown = (dimension?.breakdown ?? {}) as Record<string, unknown>;
  const damnationMet = Number(breakdown.damnation_met ?? 0);
  const auricMet = Number(breakdown.auric_met ?? 0);
  const total = Number(breakdown.total ?? 0);
  const degraded = difficultyDegradations(dimension);
  const facts: HoverCardFact[] = [
    { label: "Score", value: `${score ?? "—"}/5 — ${tierLabelForScore(score)}` },
    { label: "Range", value: "1 (breaks at Damnation already) to 5 (holds through Auric)" },
    {
      label: "Derivation",
      value: "Tracks only the high-priority breakpoints and compares whether they still land at Damnation versus Auric.",
    },
    {
      label: "This build",
      value: `High-priority breakpoints met: ${damnationMet}/${total} at Damnation · ${auricMet}/${total} at Auric${degraded.length > 0 ? ` · breaks at Auric: ${degraded.join(", ")}` : ""}`,
    },
    {
      label: "Implies",
      value:
          score === 5
            ? "Stable through Auric scaling — Crushers and Ragers die on schedule."
            : score != null && score >= 3
              ? "Holds at Damnation; some key breakpoints break at Auric."
              : "Already under-killing at Damnation — elites will feel noticeably slower.",
    },
    {
      label: "Important caveat",
      value:
        "Auric is our proxy for high-intensity play. Havoc layers extra resistance modifiers we do not model — holding at Auric is a good sign, not a guarantee.",
    },
  ];

  return createCard(
    detail,
    "difficulty_scaling",
    "calculator",
    "Do your key breakpoints still hold at Auric, or do they break down on the harder difficulty?",
    "Difficulty Scaling",
    `${score ?? "—"}/5 ${tierLabelForScore(score)}`,
    facts,
  );
}

function survivabilityCard(detail: BuildDetailData): PhaseAScoreHoverCard {
  const score = summaryScore(detail, "survivability");
  const dimension = qualitativeDetail(detail, "survivability");
  const breakdown = (dimension?.breakdown ?? {}) as Record<string, unknown>;
  const ehpRatio = Number(breakdown.effective_hp_ratio ?? 0);
  const stateRatio = Number(breakdown.state_toughness_ratio ?? 0);
  const recoveryRatio = Number(breakdown.recovery_ratio ?? 0);
  const facts: HoverCardFact[] = [
    { label: "Score", value: `${score ?? "—"}/5 — ${tierLabelForScore(score)}` },
    { label: "Range", value: "1 (near baseline) to 5 (stacked durability and recovery)" },
    {
      label: "Derivation",
      value: "Compares your effective HP, dodge/slide toughness, and sustain loops against a class-baseline build at Damnation.",
    },
    {
      label: "This build",
      value: `EHP x${formatAverage(ehpRatio, 2)} · movement toughness x${formatAverage(stateRatio, 2)} · recovery x${formatAverage(recoveryRatio, 2)}`,
    },
    {
      label: "Implies",
      value:
        score === 5
          ? "Durability is a core strength — the build invests heavily in staying power."
          : score != null && score >= 3
            ? "Defensive investment is real, but not carrying the whole build."
            : "You are close to baseline durability for this class — mistakes get punished quickly.",
    },
    {
      label: "Caveat",
      value:
        "This is class-relative, not raw HP worship. Ogryn bulk does not auto-win, and niche enemy-specific DR lines are still under-modeled here.",
    },
  ];

  return createCard(
    detail,
    "survivability",
    "calculator",
    "How much tougher this build is than the same class stripped back to baseline stats and default sustain.",
    "Survivability",
    `${score ?? "—"}/5 ${tierLabelForScore(score)}`,
    facts,
  );
}

function compositeCard(detail: BuildDetailData): PhaseAScoreHoverCard {
  const composite = detail.summary.scores.composite;
  const coverage = detail.synergy.metadata.calc_coverage_pct;
  const hasSurvivability = detail.summary.scores.survivability != null;
  const compositeMax = hasSurvivability ? 40 : 35;
  const facts: HoverCardFact[] = [
    { label: "Score", value: `${composite}/${compositeMax} · Grade ${detail.summary.scores.grade}` },
    { label: "Dimensions contributing", value: `${activeScoreCount(detail)}/${hasSurvivability ? 8 : 7}` },
    {
      label: "Grading bands",
      value: hasSurvivability
        ? "S ≥36 · A ≥31 · B ≥25 · C ≥19 · D <19"
        : "S ≥32 · A ≥27 · B ≥22 · C ≥17 · D <17",
    },
    {
      label: "Dimensions",
      value: hasSurvivability
        ? "Perk Optimality · Curio Efficiency · Talent Coherence · Blessing Synergy · Role Coverage · Breakpoint Relevance · Difficulty Scaling · Survivability"
        : "Perk Optimality · Curio Efficiency · Talent Coherence · Blessing Synergy · Role Coverage · Breakpoint Relevance · Difficulty Scaling",
    },
    {
      label: "Scaling rule",
      value: "If a dimension was unscorable, the composite scales up from the dimensions we could score so missing data does not force a lower letter.",
    },
    {
      label: "Implies",
      value:
        "Two builds with the same composite can look very different — same sum, different shape. The grade is a starting point; the dimensions are the story.",
    },
    {
      label: "Caveat",
      value: "Our grading, not community consensus. The cutoffs are calibrated against the 24 fixture meta builds.",
    },
  ];

  if (coverage < EFFECT_MODELED_GRADE_WARN_THRESHOLD) {
    facts.push({
      label: "Coverage caveat",
      value:
        "Some dimensions were unscorable or lightly modelled, so the letter can overstate the build. Treat it as provisional.",
    });
  }

  return createCard(
    detail,
    "composite",
    "scorecard",
    `Overall score from the ${hasSurvivability ? "eight" : "seven"} dimensions, plus the letter bucket it lands in.`,
    `Grade ${detail.summary.scores.grade} · ${composite}/${compositeMax}`,
    "Our grading",
    facts,
    coverage < EFFECT_MODELED_GRADE_WARN_THRESHOLD ? "warn" : "default",
  );
}

export function buildPhaseAScoreHoverCards(detail: BuildDetailData): PhaseAScoreHoverCard[] {
  return [
    compositeCard(detail),
    perkCard(detail),
    curioCard(detail),
    talentCard(detail),
    blessingCard(detail),
    roleCoverageCard(detail),
    breakpointCard(detail),
    difficultyCard(detail),
    survivabilityCard(detail),
  ];
}
