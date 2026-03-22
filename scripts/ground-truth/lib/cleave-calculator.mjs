/**
 * Cleave calculator engine — simulates multi-target melee sweeps.
 *
 * Given a weapon action's cleave budget and a horde composition, determines
 * how many enemies are hit and killed per swing.
 *
 * How cleave works in Darktide:
 * 1. Each melee weapon action has a cleave_distribution.attack budget
 *    (lerped by quality like damage profiles)
 * 2. When swinging, the weapon hits targets front-to-back
 * 3. Each target consumes hit_mass from the cleave budget
 * 4. When the budget is exhausted, no more targets are hit
 *    (but the first target is always hit regardless of budget)
 * 5. Damage to subsequent targets may use different power distributions
 *    via the profile's targets[n] overrides (damage falloff per target)
 *
 * Limitations:
 * - Per-target damage falloff (targets[n] overrides) is NOT modeled because
 *   the profile extractor (extract-damage-profiles.mjs) does not extract
 *   per-target overrides. All targets receive the same damage as target 0.
 *   This means the cleave calculator may slightly overestimate damage on
 *   later targets for profiles that have damage falloff.
 *
 * Reuses from damage-calculator.mjs:
 * - computeHit — compute damage per target
 * - assembleBuildBuffStack — build's buff stack
 * - loadCalculatorData — data loading
 * - adaptBreed — breed format adapter
 *
 * Source: scripts/utilities/attack/damage_profile.lua (cleave_distribution)
 *         scripts/utilities/attack/damage_calculation.lua (hit processing)
 */

import {
  computeHit,
  assembleBuildBuffStack,
  loadCalculatorData,
  adaptBreed,
} from "./damage-calculator.mjs";

// ── Helpers ──────────────────────────────────────────────────────────

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// ── Horde Compositions ───────────────────────────────────────────────

/**
 * Standard horde compositions for cleave simulation.
 *
 * Each composition is an array of target descriptors sorted by hit_mass
 * ascending (lightest first — the game processes front-to-back, and
 * lightest enemies are hit first in a typical horde).
 *
 * hit_mass_damnation is used for sorting reference; actual hit_mass is
 * looked up per-difficulty at simulation time.
 */
export const HORDE_COMPOSITIONS = {
  /**
   * Mixed melee horde — 6 targets, typical horde density in a melee swing arc.
   * Mix of poxwalkers, renegade assault, and renegade melee.
   */
  mixed_melee_horde: [
    { breed_id: "chaos_poxwalker", hit_mass_damnation: 1.5 },
    { breed_id: "chaos_poxwalker", hit_mass_damnation: 1.5 },
    { breed_id: "renegade_assault", hit_mass_damnation: 1.5 },
    { breed_id: "renegade_assault", hit_mass_damnation: 1.5 },
    { breed_id: "renegade_melee", hit_mass_damnation: 3.5 },
    { breed_id: "renegade_melee", hit_mass_damnation: 3.5 },
  ],

  /**
   * Elite mixed — 4 targets, a rager mixed with trash.
   * Sorted by hit_mass ascending.
   */
  elite_mixed: [
    { breed_id: "renegade_assault", hit_mass_damnation: 1.5 },
    { breed_id: "renegade_melee", hit_mass_damnation: 3.5 },
    { breed_id: "renegade_melee", hit_mass_damnation: 3.5 },
    { breed_id: "renegade_berzerker", hit_mass_damnation: 10 },
  ],
};

// ── Core Functions ───────────────────────────────────────────────────

/**
 * Resolves a cleave budget from a cleave_distribution.attack entry.
 *
 * If the entry is a [min, max] array, lerps by quality.
 * If it's a scalar, returns it directly.
 * If null/undefined, returns 0.
 *
 * Source: DamageProfile.lerp_damage_profile_entry (damage_profile.lua:379-384)
 *
 * @param {number|number[]|null|undefined} entry - Scalar or [min, max] cleave budget
 * @param {number} quality - Weapon modifier quality 0-1
 * @returns {number} Resolved cleave budget
 */
export function resolveCleaveBudget(entry, quality) {
  if (entry == null) return 0;
  if (Array.isArray(entry)) {
    return lerp(entry[0], entry[1], quality);
  }
  return entry;
}

/**
 * Core cleave simulation: consume hit_mass per target, compute damage per target.
 *
 * Iterates through targets front-to-back, consuming hit_mass from the cleave
 * budget. The first target is always hit regardless of budget (Darktide rule).
 * When the remaining budget is less than the next target's hit_mass, no more
 * targets are hit.
 *
 * @param {object} params
 * @param {number} params.cleaveBudget - Total cleave budget for this swing
 * @param {Array<{breed_id: string, hit_mass: number, hp: number}>} params.targets -
 *   Ordered target list with hit_mass and HP at the chosen difficulty
 * @param {(target: object, index: number) => number} params.computeDamageForTarget -
 *   Callback that returns damage dealt to the target at the given index
 * @returns {{ targets_hit: number, targets_killed: number, per_target: Array<{breed_id: string, hit_mass: number, damage: number, hp: number, killed: boolean}> }}
 */
export function simulateCleave({ cleaveBudget, targets, computeDamageForTarget }) {
  if (targets.length === 0) {
    return { targets_hit: 0, targets_killed: 0, per_target: [] };
  }

  const perTarget = [];
  let remaining = cleaveBudget;
  let killed = 0;

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];

    // First target is always hit regardless of budget.
    // Subsequent targets require remaining budget >= hit_mass.
    if (i > 0 && remaining < target.hit_mass) {
      break;
    }

    // Consume hit_mass from budget
    remaining -= target.hit_mass;

    // Compute damage for this target
    const damage = computeDamageForTarget(target, i);
    const isKilled = damage >= target.hp;
    if (isKilled) killed++;

    perTarget.push({
      breed_id: target.breed_id,
      hit_mass: target.hit_mass,
      damage,
      hp: target.hp,
      killed: isKilled,
    });
  }

  return {
    targets_hit: perTarget.length,
    targets_killed: killed,
    per_target: perTarget,
  };
}

// ── Action Category Map ──────────────────────────────────────────────

const ACTION_CATEGORY = {
  light_attack: "light",
  action_swing: "light",
  action_swing_right: "light",
  action_swing_up: "light",
  push_followup: "light",
  heavy_attack: "heavy",
  weapon_special: "special",
  push: "push",
};

// ── Profile Resolution ───────────────────────────────────────────────

/**
 * Resolves a damage profile's power_distribution for a specific quality,
 * lerping any [min, max] arrays down to scalars.
 *
 * @param {object} profile - Raw damage profile from profiles.json
 * @param {number} quality - Weapon quality 0-1
 * @returns {object} Profile with scalar power_distribution.attack
 */
function resolveProfileForQuality(profile, quality) {
  const pd = profile.power_distribution;
  if (!pd) return profile;

  const resolved = { ...pd };
  if (Array.isArray(pd.attack)) {
    resolved.attack = pd.attack[0] + (pd.attack[1] - pd.attack[0]) * quality;
  }
  if (Array.isArray(pd.impact)) {
    resolved.impact = pd.impact[0] + (pd.impact[1] - pd.impact[0]) * quality;
  }

  return { ...profile, power_distribution: resolved };
}

/**
 * Determines whether a weapon is ranged based on its slot.
 */
function isWeaponRanged(weapon) {
  if (weapon.slot === "ranged") return true;
  if (weapon.slot === "melee") return false;
  return false;
}

/**
 * Checks whether an action type is a melee action (cleave only applies to melee).
 * Ranged actions (shoot_hip, shoot_zoomed, shoot_charged, etc.) are excluded.
 */
function isMeleeAction(actionType) {
  return ACTION_CATEGORY.hasOwnProperty(actionType);
}

// ── Cleave Matrix ────────────────────────────────────────────────────

const DIFFICULTIES = ["uprising", "malice", "heresy", "damnation", "auric"];

/**
 * Computes a full cleave matrix for all melee weapons in a build.
 *
 * For each melee weapon x action, simulates cleave against the standard horde
 * compositions at the specified difficulty. Reuses computeHit from
 * damage-calculator.mjs for per-target damage computation.
 *
 * @param {object} build - Canonical build JSON
 * @param {object} index - { entities: Map, edges: Array } from loadIndex()
 * @param {object} calcData - From loadCalculatorData()
 * @param {object} [options]
 * @param {number} [options.quality=0.8] - Weapon modifier quality 0-1
 * @param {string} [options.difficulty="damnation"] - Difficulty for horde HP/hit_mass
 * @param {object} [options.compositions] - Override compositions (default: HORDE_COMPOSITIONS)
 * @returns {object} Cleave matrix result
 */
export function computeCleaveMatrix(build, index, calcData, options = {}) {
  const quality = options.quality ?? 0.8;
  const difficulty = options.difficulty ?? "damnation";
  const compositions = options.compositions ?? HORDE_COMPOSITIONS;

  // Build profile lookup map
  const profileMap = new Map();
  for (const p of calcData.profiles) {
    profileMap.set(p.id, p);
  }

  // Build action map lookup by weapon template
  const actionMapByTemplate = new Map();
  for (const am of calcData.actionMaps) {
    actionMapByTemplate.set(am.weapon_template, am);
  }

  // Build breed lookup map and pre-adapt breeds
  const breedMap = new Map();
  for (const b of calcData.breeds) {
    const adapted = adaptBreed(b);
    breedMap.set(b.id, adapted);
  }

  // Pre-build buff stack (sustained scenario — no special flags for horde clearing)
  const buffStack = assembleBuildBuffStack(build, index, { health_state: "full" });

  const weaponResults = [];

  for (let slot = 0; slot < (build.weapons ?? []).length; slot++) {
    const weapon = build.weapons[slot];
    const entityId = weapon.name?.canonical_entity_id;
    if (!entityId || weapon.name?.resolution_status !== "resolved") continue;

    // Only process melee weapons — ranged weapons don't cleave
    if (isWeaponRanged(weapon)) continue;

    // Extract internal template name: shared.weapon.combat_sword_p1_m1 → combat_sword_p1_m1
    const templateName = entityId.split(".").pop();
    const actionMap = actionMapByTemplate.get(templateName);
    if (!actionMap) continue;

    const actionResults = [];

    for (const [actionType, profileIds] of Object.entries(actionMap.actions)) {
      // Only process melee actions
      if (!isMeleeAction(actionType)) continue;

      for (const profileId of profileIds) {
        const rawProfile = profileMap.get(profileId);
        if (!rawProfile) continue;

        const profile = resolveProfileForQuality(rawProfile, quality);
        if (!profile.power_distribution) continue;

        // Resolve cleave budget
        const cleaveEntry = rawProfile.cleave_distribution?.attack;
        const cleaveBudget = resolveCleaveBudget(cleaveEntry, quality);

        // Simulate against each composition
        const compositionResults = {};

        for (const [compName, compTargets] of Object.entries(compositions)) {
          // Build resolved target list with actual hit_mass and HP for this difficulty
          const resolvedTargets = [];
          for (const ct of compTargets) {
            const breed = breedMap.get(ct.breed_id);
            if (!breed) continue;

            const hitMass = breed.hit_mass?.[difficulty] ?? ct.hit_mass_damnation;
            const hp = breed.difficulty_health?.[difficulty];
            if (hp == null) continue;

            resolvedTargets.push({
              breed_id: ct.breed_id,
              hit_mass: hitMass,
              hp,
              breed, // carry the adapted breed for computeHit
            });
          }

          // Simulate cleave
          const result = simulateCleave({
            cleaveBudget,
            targets: resolvedTargets,
            computeDamageForTarget: (target, _index) => {
              // Use computeHit for accurate per-target damage
              // Note: per-target overrides (targets[n]) not available in extracted data;
              // all targets use the primary profile's damage (see module doc).
              const hitResult = computeHit({
                profile,
                hitZone: "torso",
                breed: target.breed,
                difficulty,
                flags: {},
                buffStack,
                quality,
                distance: 0,
                constants: calcData.constants,
              });
              return hitResult.damage;
            },
          });

          compositionResults[compName] = result;
        }

        actionResults.push({
          type: actionType,
          profileId,
          cleave_budget: cleaveBudget,
          compositions: compositionResults,
        });
      }
    }

    // Skip weapons with no melee actions computed
    if (actionResults.length === 0) continue;

    weaponResults.push({
      entityId,
      templateName: entityId.split(".").pop(),
      slot,
      actions: actionResults,
    });
  }

  return {
    weapons: weaponResults,
    metadata: {
      quality,
      difficulty,
      compositions_used: Object.keys(compositions),
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Extracts a per-weapon cleave summary for display or scoring.
 *
 * For each weapon, picks the best cleave action per category (light/heavy/special)
 * and reports targets_hit and targets_killed against each composition.
 *
 * @param {object} matrix - Output from computeCleaveMatrix
 * @returns {object[]} Array of weapon summaries
 */
export function summarizeCleave(matrix) {
  return matrix.weapons.map((weapon) => {
    const summary = {};

    for (const action of weapon.actions) {
      const category = ACTION_CATEGORY[action.type] ?? null;
      if (!category || category === "push") continue;

      // Build composition summary for this action
      const compSummary = {};
      for (const [compName, result] of Object.entries(action.compositions)) {
        compSummary[compName] = {
          targets_hit: result.targets_hit,
          targets_killed: result.targets_killed,
          total_targets: result.per_target.length + (
            // Count unhit targets from the composition
            (HORDE_COMPOSITIONS[compName]?.length ?? result.per_target.length) - result.per_target.length
          ),
        };
      }

      // Keep best action per category (most targets hit across compositions)
      const totalHit = Object.values(compSummary).reduce((s, c) => s + c.targets_hit, 0);

      if (!summary[category] || totalHit > summary[category]._totalHit) {
        summary[category] = {
          actionType: action.type,
          profileId: action.profileId,
          cleave_budget: action.cleave_budget,
          compositions: compSummary,
          _totalHit: totalHit,
        };
      }
    }

    // Strip internal _totalHit
    for (const cat of Object.keys(summary)) {
      delete summary[cat]._totalHit;
    }

    return {
      entityId: weapon.entityId,
      templateName: weapon.templateName,
      slot: weapon.slot,
      summary,
    };
  });
}
