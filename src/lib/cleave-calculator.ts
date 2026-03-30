/**
 * Cleave calculator engine -- simulates multi-target melee sweeps.
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
 *   the profile extractor does not extract per-target overrides. All targets
 *   receive the same damage as target 0. This means the cleave calculator may
 *   slightly overestimate damage on later targets for profiles that have
 *   damage falloff.
 *
 * Source: scripts/utilities/attack/damage_profile.lua (cleave_distribution)
 *         scripts/utilities/attack/damage_calculation.lua (hit processing)
 */

import {
  computeHit,
  assembleBuildBuffStack,
  loadCalculatorData,
  adaptBreed,
} from "./damage-calculator.js";
import type { CalculatorData } from "./damage-calculator.js";

// -- Types --------------------------------------------------------------------

interface HordeTarget {
  breed_id: string;
  hit_mass_damnation: number;
}

interface ResolvedTarget {
  breed_id: string;
  hit_mass: number;
  hp: number;
  breed: Record<string, unknown>;
}

interface PerTargetResult {
  breed_id: string;
  hit_mass: number;
  damage: number;
  hp: number;
  killed: boolean;
}

interface CleaveResult {
  targets_hit: number;
  targets_killed: number;
  per_target: PerTargetResult[];
}

export interface SimulateCleaveParams {
  cleaveBudget: number;
  targets: ResolvedTarget[];
  computeDamageForTarget: (target: ResolvedTarget, index: number) => number;
}

interface DamageProfile {
  id?: string;
  power_distribution?: { attack?: number | number[]; impact?: number | number[] };
  power_distribution_ranged?: Record<string, unknown>;
  cleave_distribution?: { attack?: number | number[] };
  melee_attack_strength?: unknown;
  [key: string]: unknown;
}

interface ActionMap {
  weapon_template: string;
  actions: Record<string, string[]>;
}

interface BuildSlot {
  canonical_entity_id?: string | null;
  resolution_status?: string;
}

interface BuildWeapon {
  slot?: string;
  name?: BuildSlot;
  blessings?: BuildSlot[];
  perks?: BuildSlot[];
}

interface Build {
  weapons?: BuildWeapon[];
  [key: string]: unknown;
}

interface EntityIndex {
  entities: Map<string, unknown>;
  edges?: unknown[];
}

// -- Helpers ------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// -- Horde Compositions -------------------------------------------------------

/**
 * Standard horde compositions for cleave simulation.
 *
 * Each composition is an array of target descriptors sorted by hit_mass
 * ascending (lightest first -- the game processes front-to-back, and
 * lightest enemies are hit first in a typical horde).
 */
export const HORDE_COMPOSITIONS: Record<string, HordeTarget[]> = {
  mixed_melee_horde: [
    { breed_id: "chaos_poxwalker", hit_mass_damnation: 1.5 },
    { breed_id: "chaos_poxwalker", hit_mass_damnation: 1.5 },
    { breed_id: "renegade_assault", hit_mass_damnation: 1.5 },
    { breed_id: "renegade_assault", hit_mass_damnation: 1.5 },
    { breed_id: "renegade_melee", hit_mass_damnation: 3.5 },
    { breed_id: "renegade_melee", hit_mass_damnation: 3.5 },
  ],
  elite_mixed: [
    { breed_id: "renegade_assault", hit_mass_damnation: 1.5 },
    { breed_id: "renegade_melee", hit_mass_damnation: 3.5 },
    { breed_id: "renegade_melee", hit_mass_damnation: 3.5 },
    { breed_id: "renegade_berzerker", hit_mass_damnation: 10 },
  ],
};

// -- Core Functions -----------------------------------------------------------

/**
 * Resolves a cleave budget from a cleave_distribution.attack entry.
 *
 * If the entry is a [min, max] array, lerps by quality.
 * If it's a scalar, returns it directly.
 * If null/undefined, returns 0.
 */
export function resolveCleaveBudget(entry: number | number[] | null | undefined, quality: number): number {
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
 */
export function simulateCleave({ cleaveBudget, targets, computeDamageForTarget }: SimulateCleaveParams): CleaveResult {
  if (targets.length === 0) {
    return { targets_hit: 0, targets_killed: 0, per_target: [] };
  }

  const perTarget: PerTargetResult[] = [];
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

// -- Action Category Map ------------------------------------------------------

const ACTION_CATEGORY: Record<string, string> = {
  light_attack: "light",
  action_swing: "light",
  action_swing_right: "light",
  action_swing_up: "light",
  push_followup: "light",
  heavy_attack: "heavy",
  weapon_special: "special",
  push: "push",
};

// -- Profile Resolution -------------------------------------------------------

function resolveProfileForQuality(profile: DamageProfile, quality: number): DamageProfile {
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

function isWeaponRanged(weapon: BuildWeapon): boolean {
  if (weapon.slot === "ranged") return true;
  if (weapon.slot === "melee") return false;
  return false;
}

/**
 * Checks whether an action type is a melee action (cleave only applies to melee).
 */
function isMeleeAction(actionType: string): boolean {
  return Object.prototype.hasOwnProperty.call(ACTION_CATEGORY, actionType);
}

// -- Cleave Matrix ------------------------------------------------------------

const DIFFICULTIES = ["uprising", "malice", "heresy", "damnation", "auric"];

export interface CleaveMatrixOptions {
  quality?: number;
  difficulty?: string;
  compositions?: Record<string, HordeTarget[]>;
}

/**
 * Computes a full cleave matrix for all melee weapons in a build.
 */
export function computeCleaveMatrix(
  build: Build,
  index: EntityIndex,
  calcData: CalculatorData,
  options: CleaveMatrixOptions = {},
): unknown {
  const quality = options.quality ?? 0.8;
  const difficulty = options.difficulty ?? "damnation";
  const compositions = options.compositions ?? HORDE_COMPOSITIONS;

  // Build profile lookup map
  const profileMap = new Map<string, DamageProfile>();
  for (const p of calcData.profiles as DamageProfile[]) {
    profileMap.set(p.id!, p);
  }

  // Build action map lookup by weapon template
  const actionMapByTemplate = new Map<string, ActionMap>();
  for (const am of calcData.actionMaps as ActionMap[]) {
    actionMapByTemplate.set(am.weapon_template, am);
  }

  // Build breed lookup map and pre-adapt breeds
  const breedMap = new Map<string, Record<string, unknown>>();
  for (const b of calcData.breeds) {
    const adapted = adaptBreed(b as never) as Record<string, unknown>;
    breedMap.set((b as Record<string, unknown>).id as string, adapted);
  }

  // Pre-build buff stack (sustained scenario)
  const buffStack = assembleBuildBuffStack(build as never, index as never, { health_state: "full" });

  const weaponResults: unknown[] = [];

  for (let slot = 0; slot < (build.weapons ?? []).length; slot++) {
    const weapon = build.weapons![slot];
    const entityId = weapon.name?.canonical_entity_id;
    if (!entityId || weapon.name?.resolution_status !== "resolved") continue;

    // Only process melee weapons
    if (isWeaponRanged(weapon)) continue;

    const templateName = entityId.split(".").pop()!;
    const actionMap = actionMapByTemplate.get(templateName);
    if (!actionMap) continue;

    const actionResults: unknown[] = [];

    for (const [actionType, profileIds] of Object.entries(actionMap.actions)) {
      if (!isMeleeAction(actionType)) continue;

      for (const profileId of profileIds) {
        const rawProfile = profileMap.get(profileId);
        if (!rawProfile) continue;

        const profile = resolveProfileForQuality(rawProfile, quality);
        if (!profile.power_distribution) continue;

        const cleaveEntry = rawProfile.cleave_distribution?.attack;
        const cleaveBudget = resolveCleaveBudget(cleaveEntry, quality);

        const compositionResults: Record<string, CleaveResult> = {};

        for (const [compName, compTargets] of Object.entries(compositions)) {
          const resolvedTargets: ResolvedTarget[] = [];
          for (const ct of compTargets) {
            const breed = breedMap.get(ct.breed_id);
            if (!breed) continue;

            const hitMass = (breed.hit_mass as Record<string, number> | undefined)?.[difficulty] ?? ct.hit_mass_damnation;
            const hp = (breed.difficulty_health as Record<string, number> | undefined)?.[difficulty];
            if (hp == null) continue;

            resolvedTargets.push({
              breed_id: ct.breed_id,
              hit_mass: hitMass,
              hp,
              breed,
            });
          }

          const result = simulateCleave({
            cleaveBudget,
            targets: resolvedTargets,
            computeDamageForTarget: (target, _index) => {
              const hitResult = computeHit({
                profile: profile as never,
                hitZone: "torso",
                breed: target.breed as never,
                difficulty,
                flags: {},
                buffStack,
                quality,
                distance: 0,
                constants: calcData.constants as never,
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
 */
export function summarizeCleave(matrix: { weapons: Array<{ entityId: string; templateName: string; slot: number; actions: Array<{ type: string; profileId: string; cleave_budget: number; compositions: Record<string, CleaveResult> }> }> }): unknown[] {
  return matrix.weapons.map((weapon) => {
    const summary: Record<string, { actionType: string; profileId: string; cleave_budget: number; compositions: Record<string, { targets_hit: number; targets_killed: number; total_targets: number }>; _totalHit: number }> = {};

    for (const action of weapon.actions) {
      const category = ACTION_CATEGORY[action.type] ?? null;
      if (!category || category === "push") continue;

      const compSummary: Record<string, { targets_hit: number; targets_killed: number; total_targets: number }> = {};
      for (const [compName, result] of Object.entries(action.compositions)) {
        compSummary[compName] = {
          targets_hit: result.targets_hit,
          targets_killed: result.targets_killed,
          total_targets: result.per_target.length + (
            (HORDE_COMPOSITIONS[compName]?.length ?? result.per_target.length) - result.per_target.length
          ),
        };
      }

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
      delete (summary[cat] as Record<string, unknown>)._totalHit;
    }

    return {
      entityId: weapon.entityId,
      templateName: weapon.templateName,
      slot: weapon.slot,
      summary,
    };
  });
}
