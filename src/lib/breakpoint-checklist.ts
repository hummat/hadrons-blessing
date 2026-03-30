// @ts-nocheck
/**
 * Breakpoint checklist scoring — evaluates a build's weapons against
 * community-standard breakpoint targets (one-shot Rager head, two-hit
 * Crusher, etc.) and scores difficulty scaling resilience.
 *
 * Data lives in data/ground-truth/breakpoint-checklist.json.
 * Matrix shape from computeBreakpoints() in damage-calculator.mjs.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHECKLIST_PATH = join(__dirname, "..", "..", "data", "ground-truth", "breakpoint-checklist.json");

let _checklist = null;

function loadChecklist() {
  if (!_checklist) {
    _checklist = JSON.parse(readFileSync(CHECKLIST_PATH, "utf-8"));
  }
  return _checklist;
}

/**
 * Action type categories — mirrors ACTION_CATEGORY from damage-calculator.mjs.
 * Duplicated (not imported) to keep breakpoint-checklist self-contained and
 * avoid circular dependency with damage-calculator.mjs.
 */
const ACTION_CATEGORY = {
  light_attack: "light",
  action_swing: "light",
  action_swing_right: "light",
  action_swing_up: "light",
  push_followup: "light",
  heavy_attack: "heavy",
  shoot_hip: "light",
  shoot_zoomed: "light",
  shoot_charged: "heavy",
  weapon_special: "special",
  push: "push",
  action_overheat_explode: "special",
};

/**
 * For a given weapon's actions at a specific scenario and difficulty,
 * find the best (lowest) hitsToKill across all actions for a breed+hitZone.
 *
 * @param {object[]} actions - Weapon action results from matrix
 * @param {string} scenario - "sustained", "aimed", or "burst"
 * @param {string} breedId - Target breed_id
 * @param {string} difficulty - e.g. "damnation"
 * @param {string} hitZone - "head" or "torso"
 * @returns {number} Best hitsToKill (Infinity if no match)
 */
function bestHitsToKill(actions, scenario, breedId, difficulty, hitZone) {
  let best = Infinity;

  for (const action of actions) {
    const scenarioData = action.scenarios?.[scenario];
    if (!scenarioData) continue;

    for (const entry of scenarioData.breeds) {
      if (entry.breed_id !== breedId) continue;
      if (entry.difficulty !== difficulty) continue;
      if (entry.hitZone !== hitZone) continue;
      if (Number.isFinite(entry.hitsToKill) && entry.hitsToKill < best) {
        best = entry.hitsToKill;
      }
    }
  }

  return best;
}

/**
 * Score how many checklist breakpoints the build's weapons can hit.
 *
 * For each checklist entry, checks whether any weapon can achieve
 * <= max_hits for that breed/difficulty/hitZone/scenario. Scores the
 * weighted fraction of met breakpoints on a 1–5 scale.
 *
 * Only considers damage entries (entries without a `type` field).
 *
 * @param {object} matrix - Output from computeBreakpoints()
 * @returns {{ score: number, breakdown: object, explanations: string[] } | null}
 *   null when the matrix has no weapons.
 */
export function scoreBreakpointRelevance(matrix) {
  if (!matrix || !matrix.weapons || matrix.weapons.length === 0) {
    return null;
  }

  const { checklist, weight_values } = loadChecklist();
  const damageEntries = checklist.filter(e => !e.type);

  let weightedHits = 0;
  let weightedTotal = 0;
  const breakdown = [];

  for (const entry of damageEntries) {
    const w = weight_values[entry.weight] ?? 1;
    weightedTotal += w;

    let met = false;
    let bestHTK = Infinity;

    for (const weapon of matrix.weapons) {
      const htk = bestHitsToKill(
        weapon.actions,
        entry.scenario,
        entry.breed_id,
        entry.difficulty,
        entry.hit_zone,
      );
      if (htk < bestHTK) bestHTK = htk;
      if (htk <= entry.max_hits) {
        met = true;
      }
    }

    if (met) weightedHits += w;

    breakdown.push({
      label: entry.label,
      met,
      best_htk: Number.isFinite(bestHTK) ? bestHTK : null,
      max_hits: entry.max_hits,
      weight: entry.weight,
    });
  }

  // Map weighted fraction to 1–5
  const ratio = weightedTotal > 0 ? weightedHits / weightedTotal : 0;
  let score;
  if (ratio >= 0.85) score = 5;
  else if (ratio >= 0.65) score = 4;
  else if (ratio >= 0.45) score = 3;
  else if (ratio >= 0.25) score = 2;
  else score = 1;

  const metCount = breakdown.filter(b => b.met).length;
  const explanations = [];
  explanations.push(`${metCount}/${damageEntries.length} breakpoints met (weighted ${weightedHits}/${weightedTotal})`);

  const missedHigh = breakdown.filter(b => !b.met && b.weight === "high");
  if (missedHigh.length > 0) {
    explanations.push(`Missed high-priority: ${missedHigh.map(b => b.label).join(", ")}`);
  }

  return { score, breakdown, explanations };
}

/**
 * Score how well breakpoints hold across difficulties.
 *
 * Uses a simple absolute approach (no population baseline):
 *   - Score 5: best weapon hits key breakpoints at auric
 *   - Score 3: hits at damnation but not auric
 *   - Score 1: doesn't hit key breakpoints at damnation
 *
 * "Key breakpoints" = the high-weight checklist entries.
 *
 * @param {object} matrix - Output from computeBreakpoints()
 * @returns {{ score: number, breakdown: object, explanations: string[] } | null}
 *   null when the matrix has no weapons.
 */
export function scoreDifficultyScaling(matrix) {
  if (!matrix || !matrix.weapons || matrix.weapons.length === 0) {
    return null;
  }

  const { checklist, weight_values } = loadChecklist();
  const highEntries = checklist.filter(e => e.weight === "high" && !e.type);

  if (highEntries.length === 0) {
    return { score: 3, breakdown: { auric_met: 0, damnation_met: 0, total: 0 }, explanations: ["No high-priority checklist entries"] };
  }

  let damnationMet = 0;
  let auricMet = 0;
  const perEntry = [];

  for (const entry of highEntries) {
    let damnationBest = Infinity;
    let auricBest = Infinity;

    for (const weapon of matrix.weapons) {
      const dHTK = bestHitsToKill(
        weapon.actions,
        entry.scenario,
        entry.breed_id,
        "damnation",
        entry.hit_zone,
      );
      const aHTK = bestHitsToKill(
        weapon.actions,
        entry.scenario,
        entry.breed_id,
        "auric",
        entry.hit_zone,
      );
      if (dHTK < damnationBest) damnationBest = dHTK;
      if (aHTK < auricBest) auricBest = aHTK;
    }

    const damnationOk = damnationBest <= entry.max_hits;
    const auricOk = auricBest <= entry.max_hits;
    if (damnationOk) damnationMet++;
    if (auricOk) auricMet++;

    perEntry.push({
      label: entry.label,
      damnation_htk: Number.isFinite(damnationBest) ? damnationBest : null,
      auric_htk: Number.isFinite(auricBest) ? auricBest : null,
      damnation_met: damnationOk,
      auric_met: auricOk,
    });
  }

  const total = highEntries.length;
  const damnationRatio = damnationMet / total;
  const auricRatio = auricMet / total;

  let score;
  if (auricRatio >= 0.8) score = 5;
  else if (auricRatio >= 0.5) score = 4;
  else if (damnationRatio >= 0.8) score = 3;
  else if (damnationRatio >= 0.5) score = 2;
  else score = 1;

  const explanations = [];
  explanations.push(`High-priority: ${damnationMet}/${total} at damnation, ${auricMet}/${total} at auric`);

  const degraded = perEntry.filter(e => e.damnation_met && !e.auric_met);
  if (degraded.length > 0) {
    explanations.push(`Degrades at auric: ${degraded.map(e => e.label).join(", ")}`);
  }

  return {
    score,
    breakdown: {
      auric_met: auricMet,
      damnation_met: damnationMet,
      total,
      per_entry: perEntry,
    },
    explanations,
  };
}

// ── Stagger tier ordering ─────────────────────────────────────────────

/** Canonical stagger tier rank for comparison. Higher = better. */
const STAGGER_TIER_RANK = {
  none: 0,
  null: 0,
  light: 1,
  light_ranged: 1,
  killshot: 1,
  sticky: 1,
  electrocuted: 1,
  blinding: 1,
  companion_push: 1,
  shield_block: 1,
  medium: 2,
  shield_heavy_block: 2,
  heavy: 3,
  shield_broken: 3,
  wall_collision: 3,
  explosion: 4,
};

/**
 * For a given weapon's actions at a specific difficulty, find the best
 * (highest) stagger tier across all melee actions for a breed.
 *
 * @param {object[]} actions - Weapon action results from stagger matrix
 * @param {string} breedId - Target breed_id
 * @param {string} difficulty - e.g. "damnation"
 * @returns {string} Best stagger tier ("none" if no match)
 */
function bestStaggerTier(actions, breedId, difficulty) {
  let bestRank = 0;
  let bestTier = "none";

  for (const action of actions) {
    for (const entry of action.breeds) {
      if (entry.breed_id !== breedId) continue;
      if (entry.difficulty !== difficulty) continue;

      const tier = entry.stagger_tier ?? "none";
      const rank = STAGGER_TIER_RANK[tier] ?? 0;
      if (rank > bestRank) {
        bestRank = rank;
        bestTier = tier;
      }
    }
  }

  return bestTier;
}

/**
 * Score how many stagger checklist targets the build's weapons can hit.
 *
 * For each stagger checklist entry (`type === "stagger"`), checks whether
 * any weapon achieves at least `min_tier` stagger against that breed at
 * the specified difficulty. Scores the weighted fraction of met entries
 * on a 1–5 scale (same thresholds as scoreBreakpointRelevance).
 *
 * @param {object} staggerMatrix - Output from computeStaggerMatrix()
 * @returns {{ score: number, breakdown: object, explanations: string[] } | null}
 *   null when the matrix has no weapons.
 */
export function scoreStaggerRelevance(staggerMatrix) {
  if (!staggerMatrix || !staggerMatrix.weapons || staggerMatrix.weapons.length === 0) {
    return null;
  }

  const { checklist, weight_values } = loadChecklist();
  const staggerEntries = checklist.filter(e => e.type === "stagger");

  if (staggerEntries.length === 0) {
    return null;
  }

  let weightedHits = 0;
  let weightedTotal = 0;
  const breakdown = [];

  for (const entry of staggerEntries) {
    const w = weight_values[entry.weight] ?? 1;
    weightedTotal += w;

    let met = false;
    let bestAchieved = "none";
    let bestAchievedRank = 0;

    const minRank = STAGGER_TIER_RANK[entry.min_tier] ?? 0;

    for (const weapon of staggerMatrix.weapons) {
      const tier = bestStaggerTier(
        weapon.actions,
        entry.breed_id,
        entry.difficulty,
      );
      const rank = STAGGER_TIER_RANK[tier] ?? 0;
      if (rank > bestAchievedRank) {
        bestAchievedRank = rank;
        bestAchieved = tier;
      }
      if (rank >= minRank) {
        met = true;
      }
    }

    if (met) weightedHits += w;

    breakdown.push({
      label: entry.label,
      met,
      best_tier: bestAchieved,
      min_tier: entry.min_tier,
      weight: entry.weight,
    });
  }

  // Map weighted fraction to 1–5 (same thresholds as damage breakpoints)
  const ratio = weightedTotal > 0 ? weightedHits / weightedTotal : 0;
  let score;
  if (ratio >= 0.85) score = 5;
  else if (ratio >= 0.65) score = 4;
  else if (ratio >= 0.45) score = 3;
  else if (ratio >= 0.25) score = 2;
  else score = 1;

  const metCount = breakdown.filter(b => b.met).length;
  const explanations = [];
  explanations.push(`${metCount}/${staggerEntries.length} stagger targets met (weighted ${weightedHits}/${weightedTotal})`);

  const missedHigh = breakdown.filter(b => !b.met && b.weight === "high");
  if (missedHigh.length > 0) {
    explanations.push(`Missed high-priority: ${missedHigh.map(b => b.label).join(", ")}`);
  }

  return { score, breakdown, explanations };
}

// ── Cleave scoring ────────────────────────────────────────────────────

/**
 * Score how many cleave checklist targets the build's weapons can hit.
 *
 * For each cleave checklist entry (`type === "cleave"`), finds the best
 * `targets_killed` across weapon actions whose type matches the entry's
 * `action_category` for the specified composition. "Met" if
 * `targets_killed >= min_killed`. Scores the weighted fraction of met
 * entries on a 1-5 scale (same thresholds as scoreBreakpointRelevance).
 *
 * Action category mapping:
 *   "heavy" -> action types starting with "heavy_attack"
 *   "light" -> action types starting with "light_attack"
 *
 * @param {object} cleaveMatrix - Output from computeCleaveMatrix()
 * @returns {{ score: number, breakdown: object, explanations: string[] } | null}
 *   null when the matrix has no weapons.
 */
export function scoreCleaveRelevance(cleaveMatrix) {
  if (!cleaveMatrix || !cleaveMatrix.weapons || cleaveMatrix.weapons.length === 0) {
    return null;
  }

  const { checklist, weight_values } = loadChecklist();
  const cleaveEntries = checklist.filter(e => e.type === "cleave");

  if (cleaveEntries.length === 0) {
    return null;
  }

  let weightedHits = 0;
  let weightedTotal = 0;
  const breakdown = [];

  for (const entry of cleaveEntries) {
    const w = weight_values[entry.weight] ?? 1;
    weightedTotal += w;

    let met = false;
    let bestKilled = 0;

    for (const weapon of cleaveMatrix.weapons) {
      for (const action of weapon.actions) {
        // Match action_category to action type prefix
        if (entry.action_category === "heavy" && !action.type.startsWith("heavy_attack")) continue;
        if (entry.action_category === "light" && !action.type.startsWith("light_attack")) continue;

        const compResult = action.compositions?.[entry.composition];
        if (!compResult) continue;

        if (compResult.targets_killed > bestKilled) {
          bestKilled = compResult.targets_killed;
        }
        if (compResult.targets_killed >= entry.min_killed) {
          met = true;
        }
      }
    }

    if (met) weightedHits += w;

    breakdown.push({
      label: entry.label,
      met,
      best_killed: bestKilled,
      min_killed: entry.min_killed,
      weight: entry.weight,
    });
  }

  // Map weighted fraction to 1-5 (same thresholds as damage breakpoints)
  const ratio = weightedTotal > 0 ? weightedHits / weightedTotal : 0;
  let score;
  if (ratio >= 0.85) score = 5;
  else if (ratio >= 0.65) score = 4;
  else if (ratio >= 0.45) score = 3;
  else if (ratio >= 0.25) score = 2;
  else score = 1;

  const metCount = breakdown.filter(b => b.met).length;
  const explanations = [];
  explanations.push(`${metCount}/${cleaveEntries.length} cleave targets met (weighted ${weightedHits}/${weightedTotal})`);

  const missedHigh = breakdown.filter(b => !b.met && b.weight === "high");
  if (missedHigh.length > 0) {
    explanations.push(`Missed high-priority: ${missedHigh.map(b => b.label).join(", ")}`);
  }

  return { score, breakdown, explanations };
}
