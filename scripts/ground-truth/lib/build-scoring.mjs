// scripts/ground-truth/lib/build-scoring.mjs
// Build quality scoring from synergy model output and calculator output.

import { scoreBreakpointRelevance, scoreDifficultyScaling } from "./breakpoint-checklist.mjs";

/**
 * Classify a selection ID into a category for scoring purposes.
 * @param {string} id
 * @returns {"talent"|"blessing"|"gadget"|"other"}
 */
export function classifySelection(id) {
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

/**
 * Score talent-to-talent synergy coherence.
 *
 * Algorithm:
 *   1. Collect all talent-side IDs from _talentSideIds (if present) or from
 *      synergy_edges participants. These form the full talent population.
 *   2. Count edges where BOTH participants are talent-side (stat_alignment and
 *      trigger_target types both count).
 *   3. Compute edges_per_talent = talent_edges / max(talent_count, 1).
 *   4. Map to 1–5 base score:
 *        >= 1.5 → 5, >= 1.0 → 4, >= 0.5 → 3, >= 0.2 → 2, else → 1
 *   5. Penalty: -0.5 per graph-isolated talent (appears in zero synergy_edges).
 *   6. Bonus: concentration > 0.06 → +0.5.
 *   7. Clamp [1, 5], round to nearest integer.
 *
 * @param {object} synergyOutput
 * @returns {{ score: number, breakdown: object, explanations: string[] }}
 */
function scoreTalentCoherence(synergyOutput) {
  const { synergy_edges = [], coverage = {}, _resolvedIds, _talentSideIds } = synergyOutput;
  const concentration = coverage.concentration ?? 0;

  // --- Collect talent-side ID population ---
  // Priority:
  //   1. _resolvedIds from real analyzeBuild() output — filter by classifySelection
  //   2. _talentSideIds from test helper (already pre-filtered to talent-side)
  //   3. Extract from edge participants (fallback — misses isolated talents)
  let talentPopulation;
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

  // --- Count talent-talent edges ---
  // Build the set of talent IDs that appear in any edge (for isolation check).
  const talentsInAnyEdge = new Set();
  let talent_edges = 0;

  for (const edge of synergy_edges) {
    const { type, selections = [] } = edge;
    if (type !== "stat_alignment" && type !== "trigger_target") continue;

    const edgeTalentIds = selections.filter((id) => classifySelection(id) === "talent");

    // Track all talent IDs that participate in any edge (not just talent-talent).
    for (const id of edgeTalentIds) {
      talentsInAnyEdge.add(id);
    }

    // Count edge only if both participants are talent-side.
    if (selections.length >= 2 && edgeTalentIds.length === selections.length) {
      talent_edges++;
    }
  }

  // --- Graph isolation ---
  let graph_isolated_count = 0;
  for (const id of talentPopulation) {
    if (!talentsInAnyEdge.has(id)) {
      graph_isolated_count++;
    }
  }

  // --- Base score from edges_per_talent ---
  const edges_per_talent = talent_count > 0 ? talent_edges / talent_count : 0;
  let base_score;
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

  const explanations = [];
  if (graph_isolated_count > 0) {
    explanations.push(`${graph_isolated_count} talent(s) participate in no synergy edges (-0.5 each)`);
  }
  if (bonuses > 0) {
    explanations.push(`High stat concentration (${concentration.toFixed(3)}) +0.5`);
  }

  return {
    score,
    breakdown: {
      talent_edges,
      talent_count,
      edges_per_talent: Math.round(edges_per_talent * 1000) / 1000,
      graph_isolated_count,
      concentration,
      penalties,
      bonuses,
    },
    explanations,
  };
}

/**
 * Score blessing-to-talent and blessing-to-blessing synergy.
 *
 * Algorithm:
 *   1. Collect all blessing IDs from _resolvedIds (preferred) or edge participants (fallback).
 *   2. Count edges where at least one participant is a blessing (blessing_edges).
 *   3. Count edges where BOTH participants are blessings (blessing_blessing_edges).
 *   4. edges_per_blessing = blessing_edges / blessing_count. If 0 blessings → score 1.
 *   5. Map to 1–5 base score:
 *        >= 3.5 → 5, >= 2.5 → 4, >= 1.5 → 3, >= 0.5 → 2, else → 1
 *   6. Bonus: blessing_blessing_edges > 0 → +0.5.
 *   7. Penalty: graph-isolated blessings (appear in zero synergy edges) → -1 each.
 *   8. Clamp [1, 5], round to nearest integer.
 *
 * @param {object} synergyOutput
 * @returns {{ score: number, breakdown: object, explanations: string[] }}
 */
function scoreBlessingSynergy(synergyOutput) {
  const { synergy_edges = [], _resolvedIds } = synergyOutput;

  // --- Collect blessing population ---
  // Priority: _resolvedIds filtered by classifySelection, then edge participants.
  let blessingPopulation;
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
  const blessingsInAnyEdge = new Set();
  let blessing_edges = 0;
  let blessing_blessing_edges = 0;

  for (const edge of synergy_edges) {
    const { type, selections = [] } = edge;
    if (type !== "stat_alignment" && type !== "trigger_target") continue;

    const edgeBlessingIds = selections.filter((id) => classifySelection(id) === "blessing");
    if (edgeBlessingIds.length === 0) continue;

    // Track blessings participating in any edge.
    for (const id of edgeBlessingIds) {
      blessingsInAnyEdge.add(id);
    }

    // Any edge where at least one participant is a blessing.
    blessing_edges++;

    // Edge where both participants are blessings.
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
  let base_score;
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
  const explanations = [];
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

/**
 * Score how well the build covers key role-level stat families.
 *
 * Algorithm:
 *   1. active_families = Object.keys(coverage.family_profile).length
 *   2. Base score: >= 9 → 5, >= 7 → 4, >= 5 → 3, >= 3 → 2, else → 1
 *   3. Penalty: each coverage_gap → -1
 *   4. Slot balance ratio: min(melee, ranged) / max(melee, ranged). Both 0 → 1.0. Ratio < 0.3 → -1
 *   5. Clamp [1, 5], round to nearest integer
 *
 * @param {object} synergyOutput
 * @returns {{ score: number, breakdown: object, explanations: string[] }}
 */
function scoreRoleCoverage(synergyOutput) {
  const { coverage = {} } = synergyOutput;
  const family_profile = coverage.family_profile ?? {};
  const coverage_gaps = coverage.coverage_gaps ?? [];
  const slot_balance = coverage.slot_balance ?? {};

  const active_families = Object.keys(family_profile).length;

  // Base score from active family count
  let base_score;
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
  const melee = slot_balance.melee?.strength ?? 0;
  const ranged = slot_balance.ranged?.strength ?? 0;
  let slot_balance_ratio;
  if (melee === 0 && ranged === 0) {
    slot_balance_ratio = 0.5; // no data → neutral rather than perfect
  } else {
    slot_balance_ratio = Math.min(melee, ranged) / Math.max(melee, ranged);
  }
  const imbalance_penalty = slot_balance_ratio < 0.3 ? -1 : 0;

  const raw = base_score + gap_penalty + imbalance_penalty;
  const score = Math.round(Math.min(5, Math.max(1, raw)));

  const explanations = [];
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

/**
 * Compute all scoring dimensions from a synergy model output object.
 *
 * @param {object} synergyOutput - Output from analyzeBuild() in synergy-model.mjs
 * @returns {{ talent_coherence: object, blessing_synergy: object, role_coverage: object }}
 */
export function scoreFromSynergy(synergyOutput) {
  return {
    talent_coherence: scoreTalentCoherence(synergyOutput),
    blessing_synergy: scoreBlessingSynergy(synergyOutput),
    role_coverage: scoreRoleCoverage(synergyOutput),
  };
}

/**
 * Compute scoring dimensions from calculator output (breakpoint matrix).
 *
 * @param {object} calcOutput - { matrix } from computeBreakpoints()
 * @returns {{ breakpoint_relevance: object|null, difficulty_scaling: object|null }}
 */
export function scoreFromCalculator(calcOutput) {
  return {
    breakpoint_relevance: scoreBreakpointRelevance(calcOutput.matrix),
    difficulty_scaling: scoreDifficultyScaling(calcOutput.matrix),
  };
}
