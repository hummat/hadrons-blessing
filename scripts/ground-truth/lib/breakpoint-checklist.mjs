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
const CHECKLIST_PATH = join(__dirname, "..", "..", "..", "data", "ground-truth", "breakpoint-checklist.json");

let _checklist = null;

function loadChecklist() {
  if (!_checklist) {
    _checklist = JSON.parse(readFileSync(CHECKLIST_PATH, "utf-8"));
  }
  return _checklist;
}

/**
 * Action type categories — mirrors ACTION_CATEGORY from damage-calculator.mjs.
 * Used to pick best action per scenario type.
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
 * @param {object} matrix - Output from computeBreakpoints()
 * @returns {{ score: number, breakdown: object, explanations: string[] } | null}
 *   null when the matrix has no weapons.
 */
export function scoreBreakpointRelevance(matrix) {
  if (!matrix || !matrix.weapons || matrix.weapons.length === 0) {
    return null;
  }

  const { checklist, weight_values } = loadChecklist();

  let weightedHits = 0;
  let weightedTotal = 0;
  const breakdown = [];

  for (const entry of checklist) {
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
  explanations.push(`${metCount}/${checklist.length} breakpoints met (weighted ${weightedHits}/${weightedTotal})`);

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
  const highEntries = checklist.filter(e => e.weight === "high");

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
