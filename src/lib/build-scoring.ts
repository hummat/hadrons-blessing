// Build quality scoring from synergy model output and calculator output.

import { scoreBreakpointRelevance, scoreDifficultyScaling } from "./breakpoint-checklist.js";
import type { ScoreResult } from "./breakpoint-checklist.js";
import type { AnalyzeBuildResult, CoverageResult } from "./synergy-model.js";
import type { SynergyEdge } from "./synergy-rules.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SelectionCategory = "talent" | "blessing" | "gadget" | "other";

interface ScoringBreakdown {
  [key: string]: unknown;
}

interface DimensionScore {
  score: number;
  breakdown: ScoringBreakdown;
  explanations: string[];
}

// Synergy output shape consumed by scoring functions —
// may come from analyzeBuild() or from a test helper with extra fields
interface SynergyOutput {
  synergy_edges?: SynergyEdge[];
  coverage?: Partial<CoverageResult>;
  _resolvedIds?: string[];
  _talentSideIds?: string[];
  _entitiesWithCalcIds?: string[];
}

interface BreakpointMatrix {
  weapons: unknown[];
  metadata?: { scenarios: string[] };
}

interface CalcOutput {
  matrix: BreakpointMatrix;
}

interface SurvivabilityProfile {
  effective_hp: number;
  state_modifiers: Record<string, { effective_toughness: number }>;
  toughness_regen: {
    coherency: Record<string, number>;
    melee_kill_recovery: number;
  };
}

interface SurvivabilityOutput {
  profile: SurvivabilityProfile;
  baseline: SurvivabilityProfile;
}

// ---------------------------------------------------------------------------
// classifySelection
// ---------------------------------------------------------------------------

/**
 * Classify a selection ID into a category for scoring purposes.
 */
export function classifySelection(id: string): SelectionCategory {
  if (
    id.includes(".talent.") ||
    id.includes(".ability.") ||
    id.includes(".talent_modifier.") ||
    id.includes(".stat_node.")
  ) {
    return "talent";
  }
  if (id.includes(".name_family.blessing.")) {
    return "blessing";
  }
  if (id.includes(".gadget_trait.")) {
    return "gadget";
  }
  return "other";
}

// ---------------------------------------------------------------------------
// scoreTalentCoherence
// ---------------------------------------------------------------------------

/**
 * Score talent-to-talent synergy coherence.
 *
 * Algorithm:
 *   1. Collect all talent-side IDs from _talentSideIds (if present) or from
 *      synergy_edges participants. These form the full talent population.
 *   2. Count edges where BOTH participants are talent-side (stat_alignment and
 *      trigger_target types both count).
 *   3. Compute edges_per_talent = talent_edges / max(talent_count, 1).
 *   4. Map to 1-5 base score:
 *        >= 1.5 -> 5, >= 1.0 -> 4, >= 0.5 -> 3, >= 0.2 -> 2, else -> 1
 *   5. Penalty: -0.5 per graph-isolated talent (appears in zero synergy_edges).
 *   6. Bonus: concentration > 0.06 -> +0.5.
 *   7. Clamp [1, 5], round to nearest integer.
 */
function scoreTalentCoherence(synergyOutput: SynergyOutput): DimensionScore {
  const {
    synergy_edges = [],
    coverage = {},
    _resolvedIds,
    _talentSideIds,
    _entitiesWithCalcIds,
  } = synergyOutput;
  const concentration = coverage.concentration ?? 0;

  // --- Collect talent-side ID population ---
  let talentPopulation: Set<string>;
  if (_resolvedIds && _resolvedIds.length > 0) {
    talentPopulation = new Set(_resolvedIds.filter((id) => classifySelection(id) === "talent"));
  } else if (_talentSideIds && _talentSideIds.length > 0) {
    talentPopulation = new Set(_talentSideIds.filter((id) => classifySelection(id) === "talent"));
  } else {
    talentPopulation = new Set();
    for (const edge of synergy_edges) {
      for (const id of edge.selections ?? []) {
        if (classifySelection(id) === "talent") {
          talentPopulation.add(id);
        }
      }
    }
  }

  const talent_count = talentPopulation.size;
  const measurableTalentPopulation =
    _entitiesWithCalcIds !== undefined
      ? new Set(
          [...talentPopulation].filter((id) => new Set(_entitiesWithCalcIds).has(id))
        )
      : null;
  const measurable_talent_count = measurableTalentPopulation?.size ?? talent_count;

  // --- Count talent-talent edges ---
  const talentsInAnyEdge = new Set<string>();
  let talent_edges = 0;

  for (const edge of synergy_edges) {
    const { type, selections = [] } = edge;
    if (type !== "stat_alignment" && type !== "trigger_target") continue;

    const edgeTalentIds = selections.filter((id) => classifySelection(id) === "talent");

    for (const id of edgeTalentIds) {
      talentsInAnyEdge.add(id);
    }

    if (selections.length >= 2 && edgeTalentIds.length === selections.length) {
      talent_edges++;
    }
  }

  // --- Graph isolation ---
  let graph_isolated_count = 0;
  for (const id of measurableTalentPopulation ?? talentPopulation) {
    if (!talentsInAnyEdge.has(id)) {
      graph_isolated_count++;
    }
  }

  // --- Base score from edges_per_talent ---
  const edges_per_talent = measurable_talent_count > 0 ? talent_edges / measurable_talent_count : 0;
  let base_score: number;
  if (edges_per_talent >= 1.5) {
    base_score = 5;
  } else if (edges_per_talent >= 1.0) {
    base_score = 4;
  } else if (edges_per_talent >= 0.5) {
    base_score = 3;
  } else if (edges_per_talent >= 0.2) {
    base_score = 2;
  } else {
    base_score = 1;
  }

  // --- Penalties and bonuses ---
  const penalties = graph_isolated_count * -0.5;
  const bonuses = concentration > 0.06 ? 0.5 : 0;

  const raw = base_score + penalties + bonuses;
  const score = Math.round(Math.min(5, Math.max(1, raw)));

  const explanations: string[] = [];
  if (graph_isolated_count > 0) {
    explanations.push(
      `${graph_isolated_count} measurable talent(s) participate in no synergy edges (-0.5 each)`
    );
  }
  if (bonuses > 0) {
    explanations.push(`High stat concentration (${concentration.toFixed(3)}) +0.5`);
  }
  if (
    measurableTalentPopulation !== null &&
    measurable_talent_count < talent_count
  ) {
    explanations.push(
      `${talent_count - measurable_talent_count} talent(s) without calc data excluded from isolation penalty`
    );
  }

  return {
    score,
    breakdown: {
      talent_edges,
      talent_count,
      measurable_talent_count,
      edges_per_talent: Math.round(edges_per_talent * 1000) / 1000,
      graph_isolated_count,
      concentration,
      penalties,
      bonuses,
    },
    explanations,
  };
}

// ---------------------------------------------------------------------------
// scoreBlessingSynergy
// ---------------------------------------------------------------------------

/**
 * Score blessing-to-talent and blessing-to-blessing synergy.
 */
function scoreBlessingSynergy(synergyOutput: SynergyOutput): DimensionScore {
  const { synergy_edges = [], _resolvedIds } = synergyOutput;

  // --- Collect blessing population ---
  let blessingPopulation: Set<string>;
  if (_resolvedIds && _resolvedIds.length > 0) {
    blessingPopulation = new Set(_resolvedIds.filter((id) => classifySelection(id) === "blessing"));
  } else {
    blessingPopulation = new Set();
    for (const edge of synergy_edges) {
      for (const id of edge.selections ?? []) {
        if (classifySelection(id) === "blessing") {
          blessingPopulation.add(id);
        }
      }
    }
  }

  const blessing_count = blessingPopulation.size;
  if (blessing_count === 0) {
    return {
      score: 1,
      breakdown: {
        blessing_edges: 0,
        blessing_count: 0,
        edges_per_blessing: 0,
        blessing_blessing_edges: 0,
        orphaned_blessings: 0,
      },
      explanations: [],
    };
  }

  // --- Count edges involving blessings ---
  const blessingsInAnyEdge = new Set<string>();
  let blessing_edges = 0;
  let blessing_blessing_edges = 0;

  for (const edge of synergy_edges) {
    const { type, selections = [] } = edge;
    if (type !== "stat_alignment" && type !== "trigger_target") continue;

    const edgeBlessingIds = selections.filter((id) => classifySelection(id) === "blessing");
    if (edgeBlessingIds.length === 0) continue;

    for (const id of edgeBlessingIds) {
      blessingsInAnyEdge.add(id);
    }

    blessing_edges++;

    if (selections.length >= 2 && edgeBlessingIds.length === selections.length) {
      blessing_blessing_edges++;
    }
  }

  // --- Graph isolation ---
  let orphaned_blessings = 0;
  for (const id of blessingPopulation) {
    if (!blessingsInAnyEdge.has(id)) {
      orphaned_blessings++;
    }
  }

  // --- Base score from edges_per_blessing ---
  const edges_per_blessing = blessing_edges / blessing_count;
  let base_score: number;
  if (edges_per_blessing >= 3.5) {
    base_score = 5;
  } else if (edges_per_blessing >= 2.5) {
    base_score = 4;
  } else if (edges_per_blessing >= 1.5) {
    base_score = 3;
  } else if (edges_per_blessing >= 0.5) {
    base_score = 2;
  } else {
    base_score = 1;
  }

  // --- Bonus and penalties ---
  const bonus = blessing_blessing_edges > 0 ? 0.5 : 0;
  const penalty = orphaned_blessings * -1;

  const raw = base_score + bonus + penalty;
  const score = Math.round(Math.min(5, Math.max(1, raw)));

  // --- Explanations ---
  const explanations: string[] = [];
  const connectedBlessings = [...blessingsInAnyEdge];
  if (connectedBlessings.length > 0) {
    const names = connectedBlessings.map((id) => id.split(".").at(-1)).join(", ");
    explanations.push(`Blessings with synergy edges: ${names}`);
  }
  if (blessing_blessing_edges > 0) {
    explanations.push(`${blessing_blessing_edges} blessing-blessing edge(s) +0.5`);
  }
  if (orphaned_blessings > 0) {
    explanations.push(`${orphaned_blessings} blessing(s) participate in no synergy edges (-1 each)`);
  }

  return {
    score,
    breakdown: {
      blessing_edges,
      blessing_count,
      edges_per_blessing: Math.round(edges_per_blessing * 1000) / 1000,
      blessing_blessing_edges,
      orphaned_blessings,
    },
    explanations,
  };
}

// ---------------------------------------------------------------------------
// scoreRoleCoverage
// ---------------------------------------------------------------------------

/**
 * Score how well the build covers key role-level stat families.
 */
function scoreRoleCoverage(synergyOutput: SynergyOutput): DimensionScore {
  const { coverage = {} } = synergyOutput;
  const family_profile = coverage.family_profile ?? {};
  const coverage_gaps = coverage.coverage_gaps ?? [];
  const slot_balance = coverage.slot_balance ?? {};

  const active_families = Object.keys(family_profile).length;

  // Base score from active family count
  let base_score: number;
  if (active_families >= 9) {
    base_score = 5;
  } else if (active_families >= 7) {
    base_score = 4;
  } else if (active_families >= 5) {
    base_score = 3;
  } else if (active_families >= 3) {
    base_score = 2;
  } else {
    base_score = 1;
  }

  // Gap penalty
  const gap_penalty = coverage_gaps.length * -1;

  // Slot balance ratio (both-zero = no coverage data, not "perfect balance")
  const melee = (slot_balance as Partial<CoverageResult["slot_balance"]>).melee?.strength ?? 0;
  const ranged = (slot_balance as Partial<CoverageResult["slot_balance"]>).ranged?.strength ?? 0;
  let slot_balance_ratio: number;
  if (melee === 0 && ranged === 0) {
    slot_balance_ratio = 0.5; // no data -> neutral rather than perfect
  } else {
    slot_balance_ratio = Math.min(melee, ranged) / Math.max(melee, ranged);
  }
  const imbalance_penalty = slot_balance_ratio < 0.3 ? -1 : 0;

  const raw = base_score + gap_penalty + imbalance_penalty;
  const score = Math.round(Math.min(5, Math.max(1, raw)));

  const explanations: string[] = [];
  if (coverage_gaps.length > 0) {
    explanations.push(`Coverage gaps: ${coverage_gaps.join(", ")} (-1 each)`);
  }
  if (imbalance_penalty < 0) {
    explanations.push(`Severe slot imbalance (ratio ${slot_balance_ratio.toFixed(2)}) -1`);
  }

  return {
    score,
    breakdown: {
      active_families,
      total_families: 11,
      coverage_gaps,
      slot_balance_ratio,
    },
    explanations,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute all scoring dimensions from a synergy model output object.
 */
export function scoreFromSynergy(synergyOutput: SynergyOutput): {
  talent_coherence: DimensionScore;
  blessing_synergy: DimensionScore;
  role_coverage: DimensionScore;
} {
  return {
    talent_coherence: scoreTalentCoherence(synergyOutput),
    blessing_synergy: scoreBlessingSynergy(synergyOutput),
    role_coverage: scoreRoleCoverage(synergyOutput),
  };
}

/**
 * Compute scoring dimensions from calculator output (breakpoint matrix).
 */
export function scoreFromCalculator(calcOutput: CalcOutput): {
  breakpoint_relevance: ScoreResult | null;
  difficulty_scaling: ScoreResult | null;
} {
  return {
    breakpoint_relevance: scoreBreakpointRelevance(calcOutput.matrix as any),
    difficulty_scaling: scoreDifficultyScaling(calcOutput.matrix as any),
  };
}

function safeRatio(value: number, baseline: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(baseline) || baseline <= 0) {
    return null;
  }
  return value / baseline;
}

function cappedRatio(value: number | null): number {
  if (value == null || !Number.isFinite(value)) {
    return 1;
  }
  return Math.min(Math.max(value, 0), 3);
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 1;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function scoreFromSurvivability(
  survivabilityOutput: SurvivabilityOutput,
): DimensionScore | null {
  const { profile, baseline } = survivabilityOutput;

  const effectiveHpRatio = safeRatio(profile.effective_hp, baseline.effective_hp);
  const dodgeRatio = safeRatio(
    profile.state_modifiers.dodging?.effective_toughness ?? 0,
    baseline.state_modifiers.dodging?.effective_toughness ?? 0,
  );
  const slideRatio = safeRatio(
    profile.state_modifiers.sliding?.effective_toughness ?? 0,
    baseline.state_modifiers.sliding?.effective_toughness ?? 0,
  );
  const movementRatios = [dodgeRatio, slideRatio].filter((value): value is number => value != null);
  const stateToughnessRatio = average(movementRatios);
  const coherencyRatio = safeRatio(
    profile.toughness_regen.coherency.one_ally ?? 0,
    baseline.toughness_regen.coherency.one_ally ?? 0,
  );
  const meleeRecoveryRatio = safeRatio(
    profile.toughness_regen.melee_kill_recovery,
    baseline.toughness_regen.melee_kill_recovery,
  );
  const recoveryRatio = Math.max(
    coherencyRatio ?? 0,
    meleeRecoveryRatio ?? 0,
  );

  if (effectiveHpRatio == null) {
    return null;
  }

  const scoreIndex =
    0.5 * cappedRatio(effectiveHpRatio)
    + 0.25 * cappedRatio(stateToughnessRatio)
    + 0.25 * cappedRatio(recoveryRatio);

  let score: number;
  if (scoreIndex >= 2.3) {
    score = 5;
  } else if (scoreIndex >= 1.8) {
    score = 4;
  } else if (scoreIndex >= 1.45) {
    score = 3;
  } else if (scoreIndex >= 1.15) {
    score = 2;
  } else {
    score = 1;
  }

  const explanations = [
    `Effective HP x${effectiveHpRatio.toFixed(2)} vs class baseline`,
    `Movement toughness x${stateToughnessRatio.toFixed(2)} from dodge/slide states`,
    `Recovery x${recoveryRatio.toFixed(2)} from coherency or melee-kill sustain`,
  ];

  return {
    score,
    breakdown: {
      score_index: Math.round(scoreIndex * 1000) / 1000,
      effective_hp_ratio: Math.round(effectiveHpRatio * 1000) / 1000,
      state_toughness_ratio: Math.round(stateToughnessRatio * 1000) / 1000,
      recovery_ratio: Math.round(recoveryRatio * 1000) / 1000,
      effective_hp: profile.effective_hp,
      baseline_effective_hp: baseline.effective_hp,
      coherency_one_ally_ratio:
        coherencyRatio != null ? Math.round(coherencyRatio * 1000) / 1000 : null,
      melee_kill_recovery_ratio:
        meleeRecoveryRatio != null ? Math.round(meleeRecoveryRatio * 1000) / 1000 : null,
    },
    explanations,
  };
}
