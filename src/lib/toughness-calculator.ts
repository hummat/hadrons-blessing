/**
 * Toughness calculator engine -- computes survivability metrics for a build.
 *
 * Given a build's defensive talents/blessings/perks, calculates:
 * - Effective toughness (with bonuses and DR)
 * - Damage reduction breakdown (multiplicative stacking)
 * - Effective HP (health pool + effective toughness)
 * - Toughness regeneration rates
 * - State-based damage modifiers (dodge/slide/sprint)
 * - Melee bleedthrough and ranged spillover
 *
 * This is a DEFENDER-SIDE calculator -- it analyzes the player's build,
 * not the enemy.
 *
 * Source references:
 *   scripts/settings/toughness/archetype_toughness_templates.lua
 *   scripts/utilities/attack/damage_calculation.lua (toughness damage path)
 */

import { readFileSync } from "node:fs";
import { CLASS_BASE_STATS_PATH } from "./paths.js";

// -- Types --------------------------------------------------------------------

interface DRSource {
  source_entity: string;
  stat: string;
  value: number;
  type: string;
  condition: string | null;
}

export interface DefensiveSources {
  dr_sources: DRSource[];
  toughness_flat: number;
  toughness_bonus: number;
  toughness_regen_rate_modifier: number;
  toughness_replenish_modifier: number;
  toughness_replenish_multiplier: number;
  max_health_modifier: number;
  extra_wounds: number;
}

export interface ToughnessDRResult {
  total_dr: number;
  damage_multiplier: number;
}

export interface EffectiveHPParams {
  baseHealth: number;
  wounds: number;
  baseToughness: number;
  toughnessFlat?: number;
  toughnessBonus?: number;
  damageMultiplier?: number;
  maxHealthModifier?: number;
}

export interface EffectiveHPResult {
  max_toughness: number;
  effective_toughness: number;
  health_pool: number;
  effective_hp: number;
}

export interface BleedthroughParams {
  damage: number;
  toughnessPercent: number;
  isMelee: boolean;
  spilloverMod?: number;
}

export interface BleedthroughResult {
  bleedthrough: number;
  toughness_absorbed: number;
}

interface RegenData {
  base_rate_per_second: number;
  coherency_regen_rate_multipliers: Record<string, number>;
  melee_kill_recovery_percent: number;
  regeneration_delay_seconds: number;
}

export interface ToughnessRegenParams {
  regenData: RegenData;
  baseToughness: number;
  toughnessFlat?: number;
  toughnessBonus?: number;
  regenRateModifier?: number;
  replenishModifier?: number;
  replenishMultiplier?: number;
}

export interface ToughnessRegenResult {
  base_rate: number;
  modified_rate: number;
  delay_seconds: number;
  coherency: Record<string, number>;
  melee_kill_recovery_percent: number;
  melee_kill_recovery: number;
}

interface ClassStats {
  base_health: number;
  base_toughness: number;
  base_stamina: number;
  wounds_by_difficulty: number[];
}

interface ClassBaseStatsData {
  classes: Record<string, ClassStats>;
  state_damage_modifiers: Record<string, Record<string, number>>;
  toughness_regen: RegenData;
}

interface BuildSlot {
  canonical_entity_id?: string;
  resolution_status?: string;
}

interface BuildWeapon {
  blessings?: BuildSlot[];
  perks?: BuildSlot[];
}

interface BuildCurio {
  perks?: BuildSlot[];
}

interface Build {
  class?: BuildSlot;
  ability?: BuildSlot;
  blitz?: BuildSlot;
  aura?: BuildSlot;
  keystone?: BuildSlot;
  talents?: BuildSlot[];
  weapons?: BuildWeapon[];
  curios?: BuildCurio[];
  [key: string]: unknown;
}

interface EntityCalcEffect {
  stat?: string;
  magnitude?: number | null;
  magnitude_min?: number | null;
  magnitude_max?: number | null;
  type?: string;
  condition?: string | null;
}

interface EntityCalc {
  effects?: EntityCalcEffect[];
  tiers?: { effects: EntityCalcEffect[] }[];
}

interface Entity {
  kind?: string;
  domain?: string;
  internal_name?: string | null;
  calc?: EntityCalc;
}

interface Edge {
  type: string;
  from_entity_id: string;
  to_entity_id: string;
}

interface EntityIndex {
  entities: Map<string, Entity>;
  edges?: Edge[];
}

interface ConditionFlags {
  health_state?: string;
  warp_charge?: number;
  ads_active?: boolean;
  ability_active?: boolean;
  during_reload?: boolean;
  proc_stacks?: number;
  [key: string]: unknown;
}

// -- Difficulty mapping -------------------------------------------------------

const DIFFICULTY_INDEX: Record<string, number> = {
  uprising: 0,
  malice: 1,
  heresy: 2,
  damnation: 3,
  auric: 4,
};

// -- Toughness-related stat names ---------------------------------------------

/**
 * Stats that contribute to toughness damage reduction.
 * These are collected from build entities and reported as DR sources.
 */
const TOUGHNESS_DR_STATS = new Set([
  "toughness_damage_taken_modifier",
  "toughness_damage_taken_multiplier",
  "damage_taken_multiplier",
]);

const TOUGHNESS_POOL_STATS = new Set([
  "toughness",
  "toughness_bonus",
]);

const TOUGHNESS_REGEN_STATS = new Set([
  "toughness_regen_rate_modifier",
  "toughness_replenish_modifier",
  "toughness_replenish_multiplier",
]);

const HEALTH_POOL_STATS = new Set([
  "max_health_modifier",
  "extra_max_amount_of_wounds",
]);

/** All toughness-relevant stats -- union of all categories above. */
const ALL_TOUGHNESS_STATS = new Set([
  ...TOUGHNESS_DR_STATS,
  ...TOUGHNESS_POOL_STATS,
  ...TOUGHNESS_REGEN_STATS,
  ...HEALTH_POOL_STATS,
]);

// -- Data Loading -------------------------------------------------------------

/**
 * Loads class-base-stats.json from the data directory.
 */
export function loadClassBaseStats(): ClassBaseStatsData {
  return JSON.parse(
    readFileSync(CLASS_BASE_STATS_PATH, "utf-8"),
  ) as ClassBaseStatsData;
}

// -- Entity Walking (DR Source Collection) ------------------------------------

/**
 * Walks the build's resolved entities and collects toughness-related buff effects,
 * tracking each source individually.
 */
export function collectDefensiveSources(
  build: Build,
  index: EntityIndex,
  flags?: ConditionFlags,
): DefensiveSources {
  const _flags = flags ?? {};
  const entities = index.entities;
  const edges = index.edges ?? [];
  const classDomain = build.class?.canonical_entity_id?.split(".").pop() ?? null;

  // Step 1: Collect all resolved entity IDs (same as assembleBuildBuffStack)
  const entityIds: string[] = [];

  // Structural slots
  for (const field of ["ability", "blitz", "aura", "keystone"] as const) {
    const slot = build[field] as BuildSlot | undefined;
    if (slot?.canonical_entity_id && slot.resolution_status === "resolved") {
      entityIds.push(slot.canonical_entity_id);
    }
  }

  // Flat talents
  for (const t of build.talents ?? []) {
    if (t.canonical_entity_id && t.resolution_status === "resolved") {
      entityIds.push(t.canonical_entity_id);
    }
  }

  // Weapons: blessings + perks
  for (const w of build.weapons ?? []) {
    for (const b of w.blessings ?? []) {
      if (b.canonical_entity_id && b.resolution_status === "resolved") {
        entityIds.push(b.canonical_entity_id);
      }
    }
    for (const p of w.perks ?? []) {
      if (p.canonical_entity_id && p.resolution_status === "resolved") {
        entityIds.push(p.canonical_entity_id);
      }
    }
  }

  // Curios: perks
  for (const c of build.curios ?? []) {
    for (const p of c.perks ?? []) {
      if (p.canonical_entity_id && p.resolution_status === "resolved") {
        entityIds.push(p.canonical_entity_id);
      }
    }
  }

  // Build instance_of reverse index for name_family traversal
  const instanceOfIndex = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.type !== "instance_of") continue;
    if (!instanceOfIndex.has(edge.to_entity_id)) {
      instanceOfIndex.set(edge.to_entity_id, []);
    }
    instanceOfIndex.get(edge.to_entity_id)!.push(edge.from_entity_id);
  }

  // Step 2: Walk entities and collect toughness-related effects
  const result: DefensiveSources = {
    dr_sources: [],
    toughness_flat: 0,
    toughness_bonus: 0,
    toughness_regen_rate_modifier: 0,
    toughness_replenish_modifier: 0,
    toughness_replenish_multiplier: 1,
    max_health_modifier: 0,
    extra_wounds: 0,
  };

  for (const entityId of entityIds) {
    const entity = entities.get(entityId);
    if (!entity) continue;

    // Resolve effects -- direct or via name_family traversal
    let effects: EntityCalcEffect[] = [];

    if (entity.calc?.effects && entity.calc.effects.length > 0) {
      effects = entity.calc.effects;
    } else if (entity.kind === "name_family") {
      const fromIds = instanceOfIndex.get(entityId) ?? [];
      for (const fromId of fromIds) {
        const fromEntity = entities.get(fromId);
        if (!fromEntity) continue;
        if (fromEntity.calc?.effects && fromEntity.calc.effects.length > 0) {
          effects = fromEntity.calc.effects;
          break;
        }
        if (fromEntity.calc?.tiers && fromEntity.calc.tiers.length > 0) {
          const lastTier = fromEntity.calc.tiers[fromEntity.calc.tiers.length - 1];
          effects = lastTier.effects ?? [];
          break;
        }
      }
    } else if (entity.kind === "stat_node" && entity.internal_name && classDomain) {
      const prefix = entity.internal_name;
      for (const [_id, e] of entities) {
        if (
          e.domain === classDomain &&
          e.kind === "talent" &&
          e.internal_name?.startsWith(prefix)
        ) {
          if (e.calc?.effects && e.calc.effects.length > 0) {
            effects = e.calc.effects;
            break;
          }
          if (e.calc?.tiers && e.calc.tiers.length > 0) {
            const lastTier = e.calc.tiers[e.calc.tiers.length - 1];
            effects = lastTier.effects ?? [];
            break;
          }
        }
      }
      // Fallback: stat_nodes with matching buff via instance_of edges
      if (effects.length === 0) {
        for (const [_id, e] of entities) {
          if (
            e.kind === "buff" &&
            e.internal_name?.startsWith(prefix) &&
            e.calc?.effects && e.calc.effects.length > 0
          ) {
            effects = e.calc.effects;
            break;
          }
        }
      }
    }

    // Filter and accumulate toughness-relevant effects
    for (const effect of effects) {
      if (effect.magnitude == null) continue;
      const { stat, magnitude, type, condition } = effect;
      if (!stat || !ALL_TOUGHNESS_STATS.has(stat)) continue;

      // Filter by type + flags (same logic as assembleBuildBuffStack)
      let effectiveMagnitude = magnitude!;

      if (type === "stat_buff") {
        // Unconditional -- always included
      } else if (type === "conditional_stat_buff") {
        const condResult = isConditionActive(condition ?? null, _flags);
        if (!condResult.active) continue;
        if (condResult.scale != null) {
          effectiveMagnitude = magnitude! * condResult.scale;
        }
      } else if (type === "proc_stat_buff") {
        if ((_flags.proc_stacks ?? 0) <= 0) continue;
      } else if (type === "lerped_stat_buff") {
        const { magnitude_min, magnitude_max } = effect;
        if (magnitude_min != null && magnitude_max != null) {
          const t = _flags.warp_charge ?? 0;
          effectiveMagnitude = magnitude_min + (magnitude_max - magnitude_min) * t;
        }
      } else if (type === "conditional_lerped_stat_buff") {
        const condResult = isConditionActive(condition ?? null, _flags);
        if (!condResult.active) continue;
        const { magnitude_min, magnitude_max } = effect;
        if (magnitude_min != null && magnitude_max != null) {
          const t = condResult.scale ?? (_flags.warp_charge ?? 0);
          effectiveMagnitude = magnitude_min + (magnitude_max - magnitude_min) * t;
        }
      } else if (type === "stepped_stat_buff") {
        // Step count metadata is not modeled yet; use the extracted magnitude as-is.
      } else {
        continue; // Unknown type -- skip
      }

      // Accumulate by category
      if (TOUGHNESS_DR_STATS.has(stat)) {
        result.dr_sources.push({
          source_entity: entityId,
          stat,
          value: effectiveMagnitude,
          type: type!,
          condition: condition ?? null,
        });
      }

      if (stat === "toughness") {
        result.toughness_flat += effectiveMagnitude;
      } else if (stat === "toughness_bonus") {
        result.toughness_bonus += effectiveMagnitude;
      } else if (stat === "toughness_regen_rate_modifier") {
        result.toughness_regen_rate_modifier += effectiveMagnitude;
      } else if (stat === "toughness_replenish_modifier") {
        result.toughness_replenish_modifier += effectiveMagnitude;
      } else if (stat === "toughness_replenish_multiplier") {
        result.toughness_replenish_multiplier *= (1 + effectiveMagnitude);
      } else if (stat === "max_health_modifier") {
        result.max_health_modifier += effectiveMagnitude;
      } else if (stat === "extra_max_amount_of_wounds") {
        result.extra_wounds += effectiveMagnitude;
      }
    }
  }

  return result;
}

/**
 * Checks whether a conditional effect is active given the current flags.
 * (Duplicated from damage-calculator to avoid circular dependency.)
 */
function isConditionActive(
  condition: string | null,
  flags: ConditionFlags,
): { active: boolean; scale?: number } {
  if (!condition) return { active: true };

  switch (condition) {
    case "threshold:health_low":
      return { active: flags.health_state === "low" };
    case "threshold:toughness_high":
      return { active: flags.health_state === "full" };
    case "threshold:warp_charge":
      return {
        active: (flags.warp_charge ?? 0) > 0,
        scale: flags.warp_charge ?? 0,
      };
    case "threshold:stamina_high":
    case "threshold:stamina_full":
      return { active: true };
    case "ads_active":
      return { active: flags.ads_active === true };
    case "ability_active":
      return { active: flags.ability_active === true };
    case "during_heavy":
      return { active: true };
    case "during_reload":
      return { active: flags.during_reload === true };
    case "wielded":
    case "active":
      return { active: true };
    case "unknown_condition":
      return { active: false };
    default:
      return { active: false };
  }
}

// -- Toughness DR Computation -------------------------------------------------

/**
 * Computes effective toughness damage reduction from a list of DR sources.
 *
 * DR sources stack multiplicatively:
 *   effective_dr = 1 - product(1 - |dr_i|) for each source
 */
export function computeToughnessDR(drSources: DRSource[]): ToughnessDRResult {
  let additiveModifierSum = 0;
  let additiveDirectProduct = 1;
  let multiplicativeProduct = 1;

  for (const source of drSources) {
    if (source.stat === "toughness_damage_taken_modifier") {
      if (source.value > 0) {
        additiveDirectProduct *= source.value;
      } else {
        additiveModifierSum += source.value;
      }
    } else if (
      source.stat === "toughness_damage_taken_multiplier" ||
      source.stat === "damage_taken_multiplier"
    ) {
      multiplicativeProduct *= normalizeDamageFactor(source.value);
    }
  }

  const additiveFactor = additiveDirectProduct * (1 + additiveModifierSum);
  const damageMultiplier = additiveFactor * multiplicativeProduct;

  // Clamp to [0, 1]
  const clampedMultiplier = Math.max(0, Math.min(1, damageMultiplier));
  const totalDR = 1 - clampedMultiplier;

  return {
    total_dr: round4(totalDR),
    damage_multiplier: round4(clampedMultiplier),
  };
}

function normalizeDamageFactor(value: number): number {
  // Source-backed calc data now preserves literal multipliers (0.75 means 25% DR).
  // Keep supporting older delta-style values (-0.25 means 25% DR) for unit tests
  // and any stale fixtures.
  return value > 0 ? value : 1 + value;
}

// -- Effective HP -------------------------------------------------------------

/**
 * Computes effective HP -- the total damage a player can absorb before dying.
 */
export function computeEffectiveHP({
  baseHealth,
  wounds,
  baseToughness,
  toughnessFlat = 0,
  toughnessBonus = 0,
  damageMultiplier = 1,
  maxHealthModifier = 0,
}: EffectiveHPParams): EffectiveHPResult {
  const maxToughness = (baseToughness + toughnessFlat) * (1 + toughnessBonus);
  const effectiveToughness = damageMultiplier > 0
    ? maxToughness / damageMultiplier
    : Infinity;
  const healthPool = baseHealth * (1 + maxHealthModifier) * wounds;
  const effectiveHP = healthPool + effectiveToughness;

  return {
    max_toughness: round2(maxToughness),
    effective_toughness: round2(effectiveToughness),
    health_pool: round2(healthPool),
    effective_hp: round2(effectiveHP),
  };
}

// -- Bleedthrough -------------------------------------------------------------

/**
 * Computes melee bleedthrough damage -- the portion of melee damage that
 * passes through remaining toughness to health.
 */
export function computeBleedthrough({
  damage,
  toughnessPercent,
  isMelee,
  spilloverMod = 1.0,
}: BleedthroughParams): BleedthroughResult {
  if (!isMelee) {
    return {
      bleedthrough: 0,
      toughness_absorbed: damage,
    };
  }

  const reduction = toughnessPercent * spilloverMod;
  const bleedthrough = damage * (1 - reduction);

  return {
    bleedthrough: round2(Math.max(0, bleedthrough)),
    toughness_absorbed: round2(damage - Math.max(0, bleedthrough)),
  };
}

// -- Toughness Regen ----------------------------------------------------------

/**
 * Computes toughness regeneration rates.
 */
export function computeToughnessRegen({
  regenData,
  baseToughness,
  toughnessFlat = 0,
  toughnessBonus = 0,
  regenRateModifier = 0,
  replenishModifier = 0,
  replenishMultiplier = 1,
}: ToughnessRegenParams): ToughnessRegenResult {
  const baseRate = regenData.base_rate_per_second;
  const coherencyMults = regenData.coherency_regen_rate_multipliers;
  const meleeKillPercent = regenData.melee_kill_recovery_percent;
  const maxToughness = (baseToughness + toughnessFlat) * (1 + toughnessBonus);

  // Regen rate per coherency step
  const coherency: Record<string, number> = {};
  const allyLabels: Record<number, string> = { 0: "solo", 1: "one_ally", 2: "two_allies", 3: "three_allies" };

  for (let allies = 0; allies <= 3; allies++) {
    const coherencyMult = coherencyMults[String(allies)] ?? 0;
    const rate = baseRate * coherencyMult * (1 + regenRateModifier);
    const label = allyLabels[allies];
    coherency[label] = round2(rate);
  }

  // Melee kill recovery: base percent modified by replenish modifiers
  const meleeKillRecoveryPercent = (meleeKillPercent + replenishModifier) * replenishMultiplier;
  const meleeKillRecovery = round2(maxToughness * meleeKillRecoveryPercent);

  return {
    base_rate: baseRate,
    modified_rate: round2(baseRate * (1 + regenRateModifier)),
    delay_seconds: regenData.regeneration_delay_seconds,
    coherency,
    melee_kill_recovery_percent: round4(meleeKillRecoveryPercent),
    melee_kill_recovery: meleeKillRecovery,
  };
}

// -- Full Survivability Profile -----------------------------------------------

export interface SurvivabilityOptions {
  difficulty?: string;
  flags?: ConditionFlags;
}

export interface SurvivabilityResult {
  class: string;
  difficulty: string;
  base: { health: number; wounds: number; toughness: number; stamina: number };
  dr_sources: DRSource[];
  total_dr: number;
  max_toughness: number;
  effective_toughness: number;
  health_pool: number;
  effective_hp: number;
  max_health_modifier: number;
  state_modifiers: Record<string, { tdr: number; damage_multiplier: number; effective_toughness: number }>;
  toughness_regen: ToughnessRegenResult;
}

/**
 * Computes the full survivability profile for a build at a given difficulty.
 */
export function computeSurvivability(
  build: Build,
  index: EntityIndex,
  options?: SurvivabilityOptions,
): SurvivabilityResult {
  const opts = options ?? {};
  const difficulty = opts.difficulty ?? "damnation";
  const difficultyIdx = DIFFICULTY_INDEX[difficulty] ?? 3;
  const flags = opts.flags ?? {};

  // Load class base stats
  const classBaseStats = loadClassBaseStats();

  // Determine class
  const classId = build.class?.canonical_entity_id?.split(".").pop() ?? null;
  if (!classId || !classBaseStats.classes[classId]) {
    throw new Error(`Unknown class: ${classId}`);
  }

  const classStats = classBaseStats.classes[classId];
  const baseHealth = classStats.base_health;
  const baseToughness = classStats.base_toughness;
  const baseStamina = classStats.base_stamina;
  const wounds = classStats.wounds_by_difficulty[difficultyIdx];
  const stateModifiers = classBaseStats.state_damage_modifiers[classId];
  const regenData = classBaseStats.toughness_regen;

  // Collect defensive sources from build
  const sources = collectDefensiveSources(build, index, flags);

  // Compute DR
  const { total_dr, damage_multiplier } = computeToughnessDR(sources.dr_sources);

  // Compute effective HP
  const effectiveWounds = wounds + sources.extra_wounds;
  const ehp = computeEffectiveHP({
    baseHealth,
    wounds: effectiveWounds,
    baseToughness,
    toughnessFlat: sources.toughness_flat,
    toughnessBonus: sources.toughness_bonus,
    damageMultiplier: damage_multiplier,
    maxHealthModifier: sources.max_health_modifier,
  });

  // State modifiers: compute effective toughness in each movement state
  const stateResults: Record<string, { tdr: number; damage_multiplier: number; effective_toughness: number }> = {};
  for (const [state, modifier] of Object.entries(stateModifiers)) {
    const stateDamageMultiplier = damage_multiplier * modifier;
    const stateEffectiveToughness = stateDamageMultiplier > 0
      ? ehp.max_toughness / stateDamageMultiplier
      : Infinity;
    stateResults[state] = {
      tdr: round4(1 - modifier),
      damage_multiplier: round4(stateDamageMultiplier),
      effective_toughness: round2(stateEffectiveToughness),
    };
  }

  // Compute toughness regen
  const regen = computeToughnessRegen({
    regenData,
    baseToughness,
    toughnessFlat: sources.toughness_flat,
    toughnessBonus: sources.toughness_bonus,
    regenRateModifier: sources.toughness_regen_rate_modifier,
    replenishModifier: sources.toughness_replenish_modifier,
    replenishMultiplier: sources.toughness_replenish_multiplier,
  });

  return {
    class: classId,
    difficulty,
    base: {
      health: baseHealth,
      wounds: effectiveWounds,
      toughness: baseToughness,
      stamina: baseStamina,
    },
    dr_sources: sources.dr_sources,
    total_dr,
    max_toughness: ehp.max_toughness,
    effective_toughness: ehp.effective_toughness,
    health_pool: ehp.health_pool,
    effective_hp: ehp.effective_hp,
    max_health_modifier: round4(sources.max_health_modifier),
    state_modifiers: stateResults,
    toughness_regen: regen,
  };
}

// -- Utilities ----------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
