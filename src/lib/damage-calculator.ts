/**
 * Damage calculator engine -- all 13 pipeline stages + computeHit orchestrator,
 * breakpoint matrix computation, and summary extraction.
 *
 * Direct port of Darktide's damage_calculation.lua (13-stage pipeline).
 * Each stage is a pure function with no side effects.
 *
 * Source: scripts/utilities/attack/damage_calculation.lua
 * Supporting: scripts/utilities/attack/power_level.lua
 *             scripts/utilities/attack/damage_profile.lua
 *             scripts/settings/damage/power_level_settings.lua
 *             scripts/settings/damage/armor_settings.lua
 *             scripts/settings/damage/attack_settings.lua
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATED_ROOT } from "./paths.js";

// -- Types --------------------------------------------------------------------

interface PowerDistribution {
  attack: number | number[];
  impact?: number | number[];
  [key: string]: unknown;
}

interface PowerDistributionRanged {
  attack: { near: number; far: number };
  impact?: { near?: number; far?: number };
  [key: string]: unknown;
}

interface ADMTable {
  attack?: Record<string, number | number[]>;
  [key: string]: unknown;
}

interface ADMRanged {
  near?: ADMTable;
  far?: ADMTable;
}

interface DamageProfile {
  id?: string;
  power_distribution?: PowerDistribution;
  power_distribution_ranged?: PowerDistributionRanged;
  armor_damage_modifier?: ADMTable;
  armor_damage_modifier_ranged?: ADMRanged;
  boost_curve?: number[];
  finesse_boost?: Record<string, number>;
  crit_boost?: number;
  backstab_bonus?: number;
  melee_attack_strength?: unknown;
  stagger_category?: string;
  cleave_distribution?: { attack?: number | number[] };
  [key: string]: unknown;
}

interface DamageOutput {
  min: number;
  max: number;
}

interface CalculatorConstants {
  default_power_level: number;
  min_power_level?: number;
  max_power_level?: number;
  damage_output: Record<string, DamageOutput>;
  rending_armor_type_multiplier: Record<string, number>;
  overdamage_rending_multiplier: Record<string, number>;
  default_finesse_boost_amount: Record<string, number>;
  default_crit_boost_amount?: number;
  boost_curves?: Record<string, number[]>;
  ranged_close?: number;
  ranged_far?: number;
  default_armor_damage_modifier?: ADMTable;
  [key: string]: unknown;
}

interface HitZoneData {
  armor_type?: string;
  weakspot?: boolean;
}

interface BreedHitZoneDamageMultiplier {
  default?: Record<string, number>;
  melee?: Record<string, number>;
  ranged?: Record<string, number>;
  [key: string]: Record<string, number> | undefined;
}

interface BreedData {
  id: string;
  hit_zones?: Record<string, HitZoneData & { damage_multiplier?: { melee?: number; ranged?: number } }>;
  hitzone_damage_multiplier?: BreedHitZoneDamageMultiplier;
  base_armor_type?: string;
  difficulty_health?: Record<string, number>;
  diminishing_returns_damage?: boolean;
  stagger?: Record<string, unknown>;
  hit_mass?: Record<string, number>;
  [key: string]: unknown;
}

interface ActionMap {
  weapon_template: string;
  actions: Record<string, string[]>;
}

interface ProfileData {
  profiles: DamageProfile[];
  action_maps: ActionMap[];
  constants: CalculatorConstants;
}

interface BreedFileData {
  breeds: BreedData[];
}

export interface BuffStack {
  additive_sum?: number;
  multiplicative_product?: number;
  target_modifier?: number;
  rending_multiplier?: number;
  backstab_damage?: number;
  flanking_damage?: number;
  [key: string]: number | undefined;
}

type DamageEfficiency = "negated" | "reduced" | "full";

export interface HitResult {
  damage: number;
  hitsToKill: number | null;
  baseDamage: number;
  buffMultiplier: number;
  armorDamageModifier: number;
  rendingApplied: number;
  finesseBoost: number;
  hitZoneMultiplier: number;
  effectiveArmorType: string;
  damageEfficiency: DamageEfficiency;
  stagesApplied: number[];
}

export interface CalculatorData {
  profiles: DamageProfile[];
  actionMaps: ActionMap[];
  constants: CalculatorConstants;
  breeds: BreedData[];
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

interface EntityIndex {
  entities: Map<string, Entity>;
  edges?: Array<{ type: string; from_entity_id: string; to_entity_id: string }>;
}

interface ConditionFlags {
  health_state?: string;
  warp_charge?: number;
  ads_active?: boolean;
  ability_active?: boolean;
  during_reload?: boolean;
  proc_stacks?: number;
  is_weakspot?: boolean;
  is_crit?: boolean;
  is_backstab?: boolean;
  is_flanking?: boolean;
  [key: string]: unknown;
}

// -- Utilities ----------------------------------------------------------------

/**
 * Piecewise linear interpolation across a boost curve array.
 *
 * Source: _boost_curve_multiplier in damage_calculation.lua:203-212
 */
export function boostCurveMultiplier(curve: number[], percent: number): number {
  const n = curve.length - 1;
  if (n <= 0) return curve[0] ?? 0;
  percent = clamp(percent, 0, 1);
  const curveT = n * percent;
  const lowerIndex = Math.floor(curveT);
  const upperIndex = Math.min(lowerIndex + 1, n);
  const t = curveT - lowerIndex;
  return curve[lowerIndex] * (1 - t) + curve[upperIndex] * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// -- Stage 1: Power Level -> Base Damage --------------------------------------

export interface PowerLevelToDamageParams {
  powerLevel?: number;
  powerDistribution: { attack: number | { near: number; far: number } };
  powerDistributionRanged?: { attack: { near: number; far: number } };
  armorType: string;
  constants: CalculatorConstants;
  isRanged?: boolean;
  dropoffScalar?: number;
}

/**
 * Converts power level + power distribution into base damage.
 *
 * Source: _power_level_scaled_damage (damage_calculation.lua:214-223)
 */
export function powerLevelToDamage({
  powerLevel,
  powerDistribution,
  powerDistributionRanged,
  armorType,
  constants,
  isRanged,
  dropoffScalar,
}: PowerLevelToDamageParams): number {
  const pl = powerLevel ?? constants.default_power_level;
  const minPL = constants.min_power_level ?? 0;
  const maxPL = constants.max_power_level ?? 10000;
  const plRange = maxPL - minPL;
  if (plRange <= 0) {
    throw new Error(`Invalid power level range: min=${minPL}, max=${maxPL} (plRange must be > 0)`);
  }

  let powerMultiplier: number;

  if (isRanged && dropoffScalar != null && powerDistributionRanged) {
    const pdr = powerDistributionRanged.attack;
    const near = pdr.near;
    const far = pdr.far;
    powerMultiplier = lerp(near, far, Math.sqrt(dropoffScalar));
  } else {
    powerMultiplier = (powerDistribution.attack as number) ?? 0;

    if (dropoffScalar == null && powerMultiplier > 0 && powerMultiplier < 2) {
      powerMultiplier = powerMultiplier * 250;
    }
  }

  const attackPowerLevel = pl * powerMultiplier;
  const percentage = clamp((attackPowerLevel - minPL) / plRange, 0, 1);

  const dmgTable = constants.damage_output[armorType];
  if (!dmgTable) {
    throw new Error(`Unknown armor type '${armorType}' -- not found in damage_output constants`);
  }
  const dmgMin = dmgTable.min;
  const dmgMax = dmgTable.max;
  return dmgMin + (dmgMax - dmgMin) * percentage;
}

// -- Stage 2: Buff Multiplier Stack -------------------------------------------

export interface DamageBuffParams {
  baseDamage: number;
  buffStack: BuffStack;
}

/**
 * Applies the pre-assembled buff stack to base damage.
 *
 * Source: _base_damage (damage_calculation.lua:563-591)
 */
export function calculateDamageBuff({ baseDamage, buffStack }: DamageBuffParams): number {
  const additive = buffStack.additive_sum ?? 1;
  const multiplicative = buffStack.multiplicative_product ?? 1;
  const target = buffStack.target_modifier ?? 1;
  return baseDamage * additive * multiplicative * target;
}

// -- Stage 3: Armor Damage Modifier -------------------------------------------

export interface ArmorDamageModifierParams {
  profile: DamageProfile;
  armorType: string;
  quality: number;
  isRanged: boolean;
  distance?: number;
  constants?: CalculatorConstants;
  defaultADM?: ADMTable;
}

/**
 * Resolves the armor damage modifier (ADM) for the attack.
 *
 * Source: DamageProfile.armor_damage_modifier (damage_profile.lua:99-232)
 */
export function resolveArmorDamageModifier({
  profile,
  armorType,
  quality,
  isRanged,
  distance,
  constants,
  defaultADM,
}: ArmorDamageModifierParams): number {
  if (isRanged && profile.armor_damage_modifier_ranged) {
    const ranged = profile.armor_damage_modifier_ranged;
    const nearEntry = ranged.near?.attack?.[armorType];
    const farEntry = ranged.far?.attack?.[armorType];

    if (nearEntry == null && farEntry == null && defaultADM?.attack?.[armorType] != null) {
      return lerpADMEntry(defaultADM.attack[armorType], quality);
    }

    const nearADM = lerpADMEntry(nearEntry, quality);
    const farADM = lerpADMEntry(farEntry, quality);

    const close = constants?.ranged_close ?? 12.5;
    const far = constants?.ranged_far ?? 30;
    const dropoffScalar = clamp((distance ?? 0) - close, 0, far - close) / (far - close);
    return lerp(nearADM, farADM, dropoffScalar);
  }

  const adm = profile.armor_damage_modifier;
  let entry: number | number[] | undefined;

  if (adm?.attack?.[armorType] != null) {
    entry = adm.attack[armorType];
  } else if (defaultADM?.attack?.[armorType] != null) {
    entry = defaultADM.attack[armorType];
  } else {
    return 1;
  }

  return lerpADMEntry(entry, quality);
}

/**
 * If entry is a [min, max] array, lerp by quality. Otherwise return scalar.
 */
function lerpADMEntry(entry: number | number[] | null | undefined, quality: number): number {
  if (Array.isArray(entry)) {
    return lerp(entry[0], entry[1], quality ?? 0);
  }
  return entry ?? 1;
}

// -- Stage 4: Rending ---------------------------------------------------------

export interface RendingParams {
  rendingSources: number;
  armorDamageModifier: number;
  armorType: string;
  constants: CalculatorConstants;
}

/**
 * Applies rending to the armor damage modifier.
 *
 * Source: damage_calculation.lua:67-83
 */
export function calculateRending({
  rendingSources,
  armorDamageModifier,
  armorType,
  constants,
}: RendingParams): { rendedADM: number } {
  const rendingArmorMult = constants.rending_armor_type_multiplier[armorType] ?? 0;
  const overdamageMult = constants.overdamage_rending_multiplier[armorType] ?? 0;
  const rendingMultiplier = rendingSources * rendingArmorMult;

  if (rendingMultiplier <= 0) {
    return { rendedADM: armorDamageModifier };
  }

  let rendedADM: number;
  const admLost = Math.max(1 - armorDamageModifier, 0);

  if (armorDamageModifier >= 1) {
    rendedADM = armorDamageModifier + rendingMultiplier * overdamageMult;
  } else if (admLost < rendingMultiplier) {
    rendedADM = 1 + (rendingMultiplier - admLost) * overdamageMult;
  } else {
    rendedADM = armorDamageModifier + rendingMultiplier;
  }

  return { rendedADM };
}

// -- Stage 5: Finesse Boost ---------------------------------------------------

export interface FinesseBoostParams {
  isCrit: boolean;
  isWeakspot: boolean;
  armorType: string;
  constants: CalculatorConstants;
  profileBoostCurve?: number[];
  profileFinesseBoost?: Record<string, number>;
  profileCritBoost?: number;
}

/**
 * Calculates the finesse (crit + weakspot) boost multiplier.
 *
 * Source: ui_finesse_multiplier (damage_calculation.lua:135-167)
 */
export function calculateFinesseBoost({
  isCrit,
  isWeakspot,
  armorType,
  constants,
  profileBoostCurve,
  profileFinesseBoost,
  profileCritBoost,
}: FinesseBoostParams): number {
  let finesseAmount = 0;

  if (isWeakspot) {
    const boostTable = profileFinesseBoost;
    finesseAmount +=
      boostTable?.[armorType] ??
      constants.default_finesse_boost_amount[armorType] ??
      0.5;
  }

  if (isCrit) {
    const critBoost =
      profileCritBoost ?? constants.default_crit_boost_amount ?? 0.5;
    finesseAmount += critBoost;
  }

  if (finesseAmount <= 0) {
    return 1;
  }

  finesseAmount = Math.min(finesseAmount, 1);

  const curve =
    profileBoostCurve ?? constants.boost_curves?.default ?? [0, 0.3, 0.6, 0.8, 1];
  const boost = boostCurveMultiplier(curve, finesseAmount);

  return 1 + boost;
}

// -- Stage 6: Positional ------------------------------------------------------

export interface PositionalParams {
  damage: number;
  isBackstab: boolean;
  isFlanking: boolean;
  buffStack: BuffStack;
  backstabBonus?: number;
}

/**
 * Applies backstab and flanking damage bonuses.
 *
 * Source: _backstab_damage (damage_calculation.lua:808-815)
 */
export function calculatePositional({
  damage,
  isBackstab,
  isFlanking,
  buffStack,
  backstabBonus,
}: PositionalParams): number {
  let backstabDamage = 0;
  if (isBackstab) {
    const backstabBuff = buffStack.backstab_damage ?? 1;
    const profileBonus = backstabBonus ?? 0;
    const multiplier = backstabBuff + profileBonus;
    backstabDamage = damage * (multiplier - 1);
  }

  let flankingDamage = 0;
  if (isFlanking) {
    const flankingBuff = buffStack.flanking_damage ?? 1;
    flankingDamage = damage * (flankingBuff - 1);
  }

  return damage + backstabDamage + flankingDamage;
}

// -- Stage 7: Hit Zone Damage Multiplier --------------------------------------

export interface HitZoneMultiplierParams {
  breed: BreedData | null;
  hitZone: string;
  attackType: string;
}

/**
 * Looks up the damage multiplier for the hit zone on the target breed.
 *
 * Source: _hit_zone_damage_multiplier (damage_calculation.lua:769-806)
 */
export function hitZoneDamageMultiplier({ breed, hitZone, attackType }: HitZoneMultiplierParams): number {
  if (!breed) return 1;

  const hzm = breed.hitzone_damage_multiplier;
  if (!hzm) return 1;

  const defaultMap = hzm.default;
  const attackTypeMap = hzm[attackType] ?? defaultMap;

  if (!attackTypeMap) return 1;

  const mult = attackTypeMap[hitZone] ?? defaultMap?.[hitZone];

  return mult ?? 1;
}

// -- Stage 8: Armor-Type Stat Buffs -------------------------------------------

export interface ArmorTypeBuffParams {
  damage: number;
  armorType: string;
  buffStack: BuffStack;
}

/**
 * Armor-type-specific damage buffs (e.g. armored_damage, unarmored_damage).
 *
 * Source: _apply_armor_type_buffs_to_damage (damage_calculation.lua:196-201)
 */
export function applyArmorTypeBuffs({ damage, armorType, buffStack }: ArmorTypeBuffParams): number {
  const statName = `${armorType}_damage`;
  const mult = buffStack[statName] ?? 1;
  return damage * mult;
}

// -- Stage 9: Diminishing Returns ---------------------------------------------

export interface DiminishingReturnsParams {
  damage: number;
  breed: BreedData | null;
  healthPercent: number;
}

/**
 * Applies diminishing returns scaling based on target's current health.
 *
 * Source: _apply_diminishing_returns_to_damage (damage_calculation.lua:759-767)
 */
export function applyDiminishingReturns({ damage, breed, healthPercent }: DiminishingReturnsParams): number {
  if (!breed || !breed.diminishing_returns_damage) {
    return damage;
  }

  const eased = healthPercent * healthPercent * healthPercent;
  return lerp(0, damage, eased);
}

// -- Stage 11: Damage Efficiency Classification -------------------------------

export interface DamageEfficiencyParams {
  armorDamageModifier: number;
  armorType: string;
  rendingDamage?: number;
}

/**
 * Classifies the damage efficiency of an attack based on ADM and armor type.
 *
 * Source: armor_damage_modifier_to_damage_efficiency (attack_settings.lua:26-34)
 */
export function classifyDamageEfficiency({
  armorDamageModifier,
  armorType,
  rendingDamage,
}: DamageEfficiencyParams): DamageEfficiency {
  const rending = rendingDamage ?? 0;

  if (
    (armorType === "super_armor" || armorType === "armored") &&
    armorDamageModifier <= 0.1 &&
    rending === 0
  ) {
    return "negated";
  }

  if (armorType === "void_shield") {
    return "negated";
  }

  if (armorDamageModifier > 0.6) {
    return "full";
  }

  return "reduced";
}

// -- Orchestrator: computeHit -------------------------------------------------

export interface ComputeHitParams {
  profile: DamageProfile;
  hitZone: string;
  breed: BreedData;
  difficulty: string;
  flags?: ConditionFlags;
  buffStack?: BuffStack;
  quality?: number;
  distance?: number;
  chargeLevel?: number;
  constants: CalculatorConstants;
}

/**
 * Composes the active pipeline stages (1-9, 11) into a single hit computation.
 */
export function computeHit({
  profile,
  hitZone,
  breed,
  difficulty,
  flags,
  buffStack,
  quality,
  distance,
  chargeLevel: _chargeLevel,
  constants,
}: ComputeHitParams): HitResult {
  const _flags = flags ?? {};
  const _buffStack = buffStack ?? {};
  const _quality = quality ?? 0.8;
  const _distance = distance ?? 0;

  // Resolve effective armor type for this hitzone
  const hitZoneData: HitZoneData = (breed.hit_zones as Record<string, HitZoneData> | undefined)?.[hitZone] ?? {};
  const effectiveArmorType = hitZoneData.armor_type ?? breed.base_armor_type ?? "unarmored";
  const isHitZoneWeakspot = hitZoneData.weakspot ?? false;

  // Determine if ranged
  const isRanged = !profile.melee_attack_strength;

  // Compute dropoff scalar for ranged
  let dropoffScalar: number | undefined;
  if (isRanged) {
    const close = constants.ranged_close ?? 12.5;
    const far = constants.ranged_far ?? 30;
    dropoffScalar = clamp((_distance - close) / (far - close), 0, 1);
  }

  // Stage 1: Power level -> base damage
  const baseDamage = powerLevelToDamage({
    powerLevel: constants.default_power_level,
    powerDistribution: profile.power_distribution as { attack: number },
    powerDistributionRanged: profile.power_distribution_ranged as PowerLevelToDamageParams["powerDistributionRanged"],
    armorType: effectiveArmorType,
    constants,
    isRanged,
    dropoffScalar,
  });

  // Stage 2: Buff multiplier
  const buffedDamage = calculateDamageBuff({ baseDamage, buffStack: _buffStack });

  // Stage 3: Armor damage modifier
  const adm = resolveArmorDamageModifier({
    profile,
    armorType: effectiveArmorType,
    quality: _quality,
    isRanged,
    distance: _distance,
    constants,
    defaultADM: constants.default_armor_damage_modifier,
  });

  // Stage 4: Rending
  const rendingSources = _buffStack.rending_multiplier ?? 0;
  const { rendedADM } = calculateRending({
    rendingSources,
    armorDamageModifier: adm,
    armorType: effectiveArmorType,
    constants,
  });

  // Apply ADM to buffed damage
  let damage = buffedDamage * rendedADM;

  // Stage 5: Finesse boost
  const effectiveWeakspot = (_flags.is_weakspot ?? false) && isHitZoneWeakspot;

  const finesseBoost = calculateFinesseBoost({
    isCrit: (_flags.is_crit as boolean) ?? false,
    isWeakspot: effectiveWeakspot,
    armorType: effectiveArmorType,
    constants,
    profileBoostCurve: profile.boost_curve,
    profileFinesseBoost: profile.finesse_boost,
    profileCritBoost: profile.crit_boost,
  });
  damage *= finesseBoost;

  // Stage 6: Positional
  damage = calculatePositional({
    damage,
    isBackstab: (_flags.is_backstab as boolean) ?? false,
    isFlanking: (_flags.is_flanking as boolean) ?? false,
    buffStack: _buffStack,
    backstabBonus: profile.backstab_bonus,
  });

  // Stage 7: Hitzone multiplier
  const attackType = isRanged ? "ranged" : "melee";
  const hzMult = hitZoneDamageMultiplier({ breed, hitZone, attackType });
  damage *= hzMult;

  // Stage 8: Armor-type stat buffs (attacker side)
  damage = applyArmorTypeBuffs({ damage, armorType: effectiveArmorType, buffStack: _buffStack });

  // Stage 9: Diminishing returns
  damage = applyDiminishingReturns({ damage, breed, healthPercent: 1.0 });

  // Stage 11: Damage efficiency classification
  const rendingDamage = rendedADM > adm ? (rendedADM - adm) * buffedDamage : 0;
  const damageEfficiency = classifyDamageEfficiency({
    armorDamageModifier: adm,
    armorType: effectiveArmorType,
    rendingDamage,
  });

  // Compute hits to kill
  const enemyHP = breed.difficulty_health?.[difficulty];
  if (enemyHP == null) {
    return {
      damage,
      hitsToKill: null,
      baseDamage,
      buffMultiplier: baseDamage > 0 ? buffedDamage / baseDamage : 1,
      armorDamageModifier: rendedADM,
      rendingApplied: rendedADM - adm,
      finesseBoost,
      hitZoneMultiplier: hzMult,
      effectiveArmorType,
      damageEfficiency,
      stagesApplied: [1, 2, 3, 4, 5, 6, 7, 8, 9, 11],
    };
  }
  const hitsToKill = damage > 0 ? Math.ceil(enemyHP / damage) : Infinity;

  return {
    damage,
    hitsToKill,
    baseDamage,
    buffMultiplier: baseDamage > 0 ? buffedDamage / baseDamage : 1,
    armorDamageModifier: rendedADM,
    rendingApplied: rendedADM - adm,
    finesseBoost,
    hitZoneMultiplier: hzMult,
    effectiveArmorType,
    damageEfficiency,
    stagesApplied: [1, 2, 3, 4, 5, 6, 7, 8, 9, 11],
  };
}

// -- Buff Stack Assembly ------------------------------------------------------

/** Stats whose magnitudes are multiplied together rather than summed. */
const MULTIPLICATIVE_STATS = new Set([
  "smite_damage_multiplier",
  "companion_damage_multiplier",
]);

/** Target-side multiplier stats -- combined into target_modifier. */
const TARGET_MULTIPLIER_STATS = new Set([
  "damage_taken_multiplier",
  "damage_taken_melee_multiplier",
  "damage_taken_ranged_multiplier",
]);

/** Stats stored individually on the buff stack for specific pipeline stages. */
const INDIVIDUAL_STATS = new Set([
  "rending_multiplier",
  "backstab_damage",
  "flanking_damage",
  "unarmored_damage",
  "armored_damage",
  "super_armor_damage",
  "resistant_damage",
  "berserker_damage",
  "disgustingly_resilient_damage",
]);

/**
 * Checks whether a conditional effect is active given the current flags.
 */
function isConditionActive(
  condition: string | null | undefined,
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

/**
 * Assembles a buff stack from a canonical build, entity index, and scenario flags.
 */
export function assembleBuildBuffStack(build: Build, index: EntityIndex, flags?: ConditionFlags): BuffStack {
  const _flags = flags ?? {};
  const entities = index.entities;
  const edges = index.edges ?? [];
  const classDomain = build.class?.canonical_entity_id?.split(".").pop() ?? null;

  // Step 1: Collect all resolved entity IDs
  const entityIds: string[] = [];

  for (const field of ["ability", "blitz", "aura", "keystone"] as const) {
    const slot = build[field] as BuildSlot | undefined;
    if (
      slot?.canonical_entity_id &&
      slot.resolution_status === "resolved"
    ) {
      entityIds.push(slot.canonical_entity_id);
    }
  }

  for (const t of build.talents ?? []) {
    if (
      t.canonical_entity_id &&
      t.resolution_status === "resolved"
    ) {
      entityIds.push(t.canonical_entity_id);
    }
  }

  for (const w of build.weapons ?? []) {
    for (const b of w.blessings ?? []) {
      if (
        b.canonical_entity_id &&
        b.resolution_status === "resolved"
      ) {
        entityIds.push(b.canonical_entity_id);
      }
    }
    for (const p of w.perks ?? []) {
      if (
        p.canonical_entity_id &&
        p.resolution_status === "resolved"
      ) {
        entityIds.push(p.canonical_entity_id);
      }
    }
  }

  for (const c of build.curios ?? []) {
    for (const p of c.perks ?? []) {
      if (
        p.canonical_entity_id &&
        p.resolution_status === "resolved"
      ) {
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

  // Step 2-3: Look up effects, filter, accumulate
  let additiveSum = 0;
  let multiplicativeProduct = 1;
  let targetModifier = 1;
  const individualStats: Record<string, number> = {};

  for (const entityId of entityIds) {
    const entity = entities.get(entityId);
    if (!entity) continue;

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
          const lastTier =
            fromEntity.calc.tiers[fromEntity.calc.tiers.length - 1];
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
          e.internal_name?.startsWith(prefix) &&
          e.calc?.effects && e.calc.effects.length > 0
        ) {
          effects = e.calc.effects;
          break;
        }
      }
    }

    for (const effect of effects) {
      if (effect.magnitude == null) continue;

      const { stat, magnitude, type, condition } = effect;
      if (!stat) continue;

      let effectiveMagnitude = magnitude!;

      if (type === "stat_buff") {
        // Unconditional
      } else if (type === "conditional_stat_buff") {
        const result = isConditionActive(condition, _flags);
        if (!result.active) continue;
        if (result.scale != null) {
          effectiveMagnitude = magnitude! * result.scale;
        }
      } else if (type === "proc_stat_buff") {
        if ((_flags.proc_stacks ?? 0) <= 0) continue;
      } else if (type === "lerped_stat_buff") {
        const { magnitude_min, magnitude_max } = effect;
        if (magnitude_min != null && magnitude_max != null) {
          const t = _flags.warp_charge ?? 0;
          effectiveMagnitude = magnitude_min + (magnitude_max - magnitude_min) * t;
        }
      } else {
        continue;
      }

      if (INDIVIDUAL_STATS.has(stat)) {
        individualStats[stat] = (individualStats[stat] ?? 1) + effectiveMagnitude;
      } else if (MULTIPLICATIVE_STATS.has(stat)) {
        multiplicativeProduct *= 1 + effectiveMagnitude;
      } else if (TARGET_MULTIPLIER_STATS.has(stat)) {
        targetModifier *= 1 + effectiveMagnitude;
      } else {
        additiveSum += effectiveMagnitude;
      }
    }
  }

  return {
    additive_sum: 1 + additiveSum,
    multiplicative_product: multiplicativeProduct,
    target_modifier: targetModifier,
    ...individualStats,
  };
}

// -- Data Loading -------------------------------------------------------------

/**
 * Loads the two generated JSON files (damage-profiles.json & breed-data.json)
 * and returns a bundled object for use by computeBreakpoints.
 */
export function loadCalculatorData(): CalculatorData {
  const profileData = JSON.parse(readFileSync(join(GENERATED_ROOT, "damage-profiles.json"), "utf-8")) as ProfileData;
  const breedData = JSON.parse(readFileSync(join(GENERATED_ROOT, "breed-data.json"), "utf-8")) as BreedFileData;
  return {
    profiles: profileData.profiles,
    actionMaps: profileData.action_maps,
    constants: profileData.constants,
    breeds: breedData.breeds,
  };
}

// -- Breakpoint Matrix --------------------------------------------------------

const ACTION_CATEGORY: Record<string, string> = {
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

const DIFFICULTIES = ["uprising", "malice", "heresy", "damnation", "auric"];

const SCENARIO_PRESETS: Record<string, ConditionFlags> = {
  sustained: { health_state: "full" },
  aimed: { is_weakspot: true, health_state: "full" },
  burst: { is_crit: true, is_weakspot: true, proc_stacks: Infinity, health_state: "low" },
};

const SCENARIO_HITZONES: Record<string, string> = {
  sustained: "torso",
  aimed: "head",
  burst: "head",
};

function resolveRangedScenarioDistance(
  constants: CalculatorConstants,
  scenarioName: string,
): number {
  const close = constants.ranged_close ?? 12.5;
  const far = constants.ranged_far ?? 30;

  if (scenarioName === "sustained") {
    return close;
  }

  return close + (far - close) / 2;
}

/**
 * Adapts the generated breed-data.json hit_zones format to the shape
 * expected by computeHit.
 */
export function adaptBreed(rawBreed: BreedData): BreedData {
  if (!rawBreed.hit_zones) return rawBreed;

  const hzm: BreedHitZoneDamageMultiplier = { default: {}, melee: {}, ranged: {} };
  const adaptedHitZones: Record<string, HitZoneData> = {};

  for (const [zone, data] of Object.entries(rawBreed.hit_zones)) {
    adaptedHitZones[zone] = {
      armor_type: data.armor_type,
      weakspot: data.weakspot ?? false,
    };
    const dm = data.damage_multiplier;
    if (dm) {
      if (dm.melee != null) hzm.melee![zone] = dm.melee;
      if (dm.ranged != null) hzm.ranged![zone] = dm.ranged;
      hzm.default![zone] = dm.melee ?? dm.ranged ?? 1;
    }
  }

  return {
    ...rawBreed,
    hit_zones: adaptedHitZones as BreedData["hit_zones"],
    hitzone_damage_multiplier: hzm,
  };
}

function lerpProfileEntry(entry: number | number[], quality: number): number {
  if (Array.isArray(entry)) {
    return entry[0] + (entry[1] - entry[0]) * quality;
  }
  return entry;
}

function resolveProfileForQuality(profile: DamageProfile, quality: number): DamageProfile {
  const pd = profile.power_distribution;
  if (!pd) return profile;

  const resolved = { ...pd };
  if (Array.isArray(pd.attack)) {
    resolved.attack = lerpProfileEntry(pd.attack, quality);
  }
  if (Array.isArray(pd.impact)) {
    resolved.impact = lerpProfileEntry(pd.impact, quality);
  }

  return { ...profile, power_distribution: resolved };
}

function isWeaponRanged(weapon: BuildWeapon, templateName: string): boolean {
  if (weapon.slot === "ranged") return true;
  if (weapon.slot === "melee") return false;
  console.warn(`Warning: weapon '${templateName}' has no slot -- defaulting to melee`);
  return false;
}

/**
 * Computes a breakpoint matrix for all weapons in a build.
 */
export function computeBreakpoints(build: Build, index: EntityIndex, calcData: CalculatorData): unknown {
  const quality = 0.8;

  const profileMap = new Map<string, DamageProfile>();
  for (const p of calcData.profiles) {
    profileMap.set(p.id!, p);
  }

  const actionMapByTemplate = new Map<string, ActionMap>();
  for (const am of calcData.actionMaps) {
    actionMapByTemplate.set(am.weapon_template, am);
  }

  const breeds = calcData.breeds.map(adaptBreed);

  const buffStacks: Record<string, BuffStack> = {};
  for (const [name, flags] of Object.entries(SCENARIO_PRESETS)) {
    buffStacks[name] = assembleBuildBuffStack(build, index, flags);
  }

  const weaponResults: unknown[] = [];
  const rangedScenarioDistances = Object.fromEntries(
    Object.keys(SCENARIO_PRESETS).map((scenarioName) => [
      scenarioName,
      resolveRangedScenarioDistance(calcData.constants, scenarioName),
    ]),
  ) as Record<string, number>;

  for (let slot = 0; slot < (build.weapons ?? []).length; slot++) {
    const weapon = build.weapons![slot];
    const entityId = weapon.name?.canonical_entity_id;
    if (!entityId || weapon.name?.resolution_status !== "resolved") continue;

    const templateName = entityId.split(".").pop()!;
    const actionMap = actionMapByTemplate.get(templateName);
    if (!actionMap) continue;

    const isRanged = isWeaponRanged(weapon, templateName);

    const actionResults: unknown[] = [];

    for (const [actionType, profileIds] of Object.entries(actionMap.actions)) {
      for (const profileId of profileIds) {
        const rawProfile = profileMap.get(profileId);
        if (!rawProfile) continue;

        const profile = resolveProfileForQuality(rawProfile, quality);
        if (!profile.power_distribution) continue;

        const scenarios: Record<string, unknown> = {};

        for (const scenarioName of Object.keys(SCENARIO_PRESETS)) {
          const hitZone = SCENARIO_HITZONES[scenarioName];
          const buffStack = buffStacks[scenarioName];
          const flags = SCENARIO_PRESETS[scenarioName];
          const distance = isRanged ? rangedScenarioDistances[scenarioName] : 0;
          const breedResults: unknown[] = [];

          for (const breed of breeds) {
            for (const diff of DIFFICULTIES) {
              const result = computeHit({
                profile,
                hitZone,
                breed,
                difficulty: diff,
                flags,
                buffStack,
                quality,
                distance,
                constants: calcData.constants,
              });

              breedResults.push({
                breed_id: breed.id,
                difficulty: diff,
                hitsToKill: result.hitsToKill,
                damage: result.damage,
                hitZone,
                effectiveArmorType: result.effectiveArmorType,
                damageEfficiency: result.damageEfficiency,
              });
            }
          }

          scenarios[scenarioName] = { breeds: breedResults };
        }

        actionResults.push({
          type: actionType,
          profileId,
          scenarios,
        });
      }
    }

    const summary = buildActionSummary(actionResults);

    weaponResults.push({
      entityId,
      slot,
      actions: actionResults,
      summary,
    });
  }

  if (weaponResults.length === 0 && (build.weapons ?? []).length > 0) {
    const skipped = (build.weapons ?? []).map((w, i) => {
      const eid = w.name?.canonical_entity_id;
      const status = w.name?.resolution_status;
      return `  slot ${i}: ${eid ?? "no entity ID"} (${status ?? "unknown"})`;
    });
    console.warn(`Warning: all ${build.weapons!.length} weapon(s) skipped in breakpoint calc:\n${skipped.join("\n")}`);
  }

  return {
    weapons: weaponResults,
    metadata: {
      quality,
      scenarios: Object.keys(SCENARIO_PRESETS),
      ranged_scenario_distances: rangedScenarioDistances,
      timestamp: new Date().toISOString(),
    },
  };
}

interface ActionResultForSummary {
  type: string;
  profileId: string;
  scenarios: Record<string, { breeds: Array<{ breed_id: string; difficulty: string; hitsToKill: number | null }> }>;
}

function buildActionSummary(actionResults: unknown[]): { bestLight: unknown; bestHeavy: unknown; bestSpecial: unknown } {
  const categoryBest: Record<string, { actionType: string; profileId: string; damnation: Record<string, number | null>; _avgHTK: number } | null> = { light: null, heavy: null, special: null };

  for (const action of actionResults as ActionResultForSummary[]) {
    const category = ACTION_CATEGORY[action.type] ?? null;
    if (!category || category === "push") continue;
    if (!Object.prototype.hasOwnProperty.call(categoryBest, category)) continue;

    const sustained = action.scenarios.sustained;
    if (!sustained) continue;

    const damnationEntries = sustained.breeds.filter(b => b.difficulty === "damnation");
    if (damnationEntries.length === 0) continue;

    const totalHTK = damnationEntries.reduce((sum, b) => {
      return sum + (Number.isFinite(b.hitsToKill) ? b.hitsToKill! : 9999);
    }, 0);
    const avgHTK = totalHTK / damnationEntries.length;

    const damnationBreakpoints: Record<string, number | null> = {};
    for (const entry of damnationEntries) {
      damnationBreakpoints[entry.breed_id] = entry.hitsToKill;
    }

    const candidate = {
      actionType: action.type,
      profileId: action.profileId,
      damnation: damnationBreakpoints,
      _avgHTK: avgHTK,
    };

    const current = categoryBest[category];
    if (!current || avgHTK < current._avgHTK) {
      categoryBest[category] = candidate;
    }
  }

  const clean = (entry: typeof categoryBest[string]): unknown => {
    if (!entry) return null;
    const { _avgHTK, ...rest } = entry;
    return rest;
  };

  return {
    bestLight: clean(categoryBest.light),
    bestHeavy: clean(categoryBest.heavy),
    bestSpecial: clean(categoryBest.special),
  };
}

// -- Breakpoint Summary -------------------------------------------------------

const KEY_BREEDS = ["renegade_berzerker", "chaos_ogryn_bulwark", "chaos_poxwalker"];

/**
 * Extracts per-weapon best-case hits-to-kill for key enemies at damnation.
 */
export function summarizeBreakpoints(matrix: { weapons: Array<{ entityId: string; actions: ActionResultForSummary[] }>; metadata: { scenarios: string[] } }): unknown[] {
  const summaries: unknown[] = [];

  for (const weapon of matrix.weapons) {
    for (const scenarioName of matrix.metadata.scenarios) {
      const categoryActions: Record<string, ActionResultForSummary[]> = { light: [], heavy: [], special: [] };

      for (const action of weapon.actions) {
        const category = ACTION_CATEGORY[action.type] ?? null;
        if (!category || category === "push") continue;
        if (!Object.prototype.hasOwnProperty.call(categoryActions, category)) continue;
        categoryActions[category].push(action);
      }

      for (const [category, actions] of Object.entries(categoryActions)) {
        if (actions.length === 0) continue;

        let bestAction: ActionResultForSummary | null = null;
        let bestAvg = Infinity;

        for (const action of actions) {
          const scenario = action.scenarios[scenarioName];
          if (!scenario) continue;

          const keyEntries = scenario.breeds.filter(
            b => b.difficulty === "damnation" && KEY_BREEDS.includes(b.breed_id)
          );
          if (keyEntries.length === 0) continue;

          const avg = keyEntries.reduce((sum, b) => {
            return sum + (Number.isFinite(b.hitsToKill) ? b.hitsToKill! : 9999);
          }, 0) / keyEntries.length;

          if (avg < bestAvg) {
            bestAvg = avg;
            bestAction = action;
          }
        }

        if (!bestAction) continue;

        const scenario = bestAction.scenarios[scenarioName];
        const keyBreakpoints: Record<string, number | null> = {};
        for (const breedId of KEY_BREEDS) {
          const entry = scenario.breeds.find(
            b => b.breed_id === breedId && b.difficulty === "damnation"
          );
          keyBreakpoints[breedId] = entry?.hitsToKill ?? null;
        }

        summaries.push({
          weaponId: weapon.entityId,
          scenario: scenarioName,
          category,
          bestAction: {
            type: bestAction.type,
            profileId: bestAction.profileId,
          },
          keyBreakpoints,
        });
      }
    }
  }

  return summaries;
}
