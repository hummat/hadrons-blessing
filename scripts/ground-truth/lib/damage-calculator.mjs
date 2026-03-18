/**
 * Damage calculator engine — all 13 pipeline stages + computeHit orchestrator,
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
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GENERATED_DIR = join(__dirname, "..", "..", "..", "data", "ground-truth", "generated");

// ── Utilities ───────────────────────────────────────────────────────

/**
 * Piecewise linear interpolation across a boost curve array.
 *
 * Source: _boost_curve_multiplier in damage_calculation.lua:203-212
 * The curve is an array of N points evenly spaced from percent=0 to percent=1.
 *
 * @param {number[]} curve - Array of curve values (e.g. [0, 0.3, 0.6, 0.8, 1])
 * @param {number} percent - Input value 0–1
 * @returns {number} Interpolated curve output
 */
export function boostCurveMultiplier(curve, percent) {
  const n = curve.length - 1;
  if (n <= 0) return curve[0] ?? 0;
  const curveT = n * percent;
  const lowerIndex = Math.floor(curveT);
  const upperIndex = Math.min(lowerIndex + 1, n);
  const t = curveT - lowerIndex;
  return curve[lowerIndex] * (1 - t) + curve[upperIndex] * t;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// ── Stage 1: Power Level → Base Damage ──────────────────────────────

/**
 * Converts power level + power distribution into base damage.
 *
 * Source: _power_level_scaled_damage (damage_calculation.lua:214-223)
 *         _distribute_power_level_to_power_type (damage_profile.lua:386-446)
 *         PowerLevel.power_level_percentage (power_level.lua:21-23)
 *
 * @param {object} params
 * @param {number} [params.powerLevel] - Total power level (default from constants)
 * @param {object} params.powerDistribution - { attack: number } raw power distribution
 * @param {object} [params.powerDistributionRanged] - { attack: { near, far } } for ranged
 * @param {string} params.armorType - Target armor type key
 * @param {object} params.constants - { default_power_level, min_power_level, max_power_level, damage_output }
 * @param {boolean} [params.isRanged] - Whether this is a ranged attack
 * @param {number} [params.dropoffScalar] - Ranged dropoff scalar (0=close, 1=far)
 * @returns {number} Base damage before buffs
 */
export function powerLevelToDamage({
  powerLevel,
  powerDistribution,
  powerDistributionRanged,
  armorType,
  constants,
  isRanged,
  dropoffScalar,
}) {
  const pl = powerLevel ?? constants.default_power_level;
  const minPL = constants.min_power_level ?? 0;
  const maxPL = constants.max_power_level ?? 10000;
  const plRange = maxPL - minPL;

  let powerMultiplier;

  if (isRanged && dropoffScalar != null && powerDistributionRanged) {
    // Ranged: interpolate between near and far power distribution
    // Source: damage_profile.lua:401-419
    const pdr = powerDistributionRanged.attack;
    const near = pdr.near;
    const far = pdr.far;
    powerMultiplier = lerp(near, far, Math.sqrt(dropoffScalar));
  } else {
    // Melee or ranged without dropoff: use flat power distribution
    // Source: damage_profile.lua:420-443
    powerMultiplier = powerDistribution.attack ?? 0;

    // Source: damage_profile.lua:441-443
    // For melee (no dropoff_scalar), if multiplier is between 0 and 2 (exclusive),
    // it's a normalized fraction that gets scaled by 250 for attack power type.
    if (dropoffScalar == null && powerMultiplier > 0 && powerMultiplier < 2) {
      powerMultiplier = powerMultiplier * 250;
    }
  }

  // Source: damage_profile.lua:445
  const attackPowerLevel = pl * powerMultiplier;

  // Source: power_level.lua:21-23
  // percentage = (attack_power_level - MIN_POWER_LEVEL) / (MAX_POWER_LEVEL - MIN_POWER_LEVEL)
  const percentage = clamp((attackPowerLevel - minPL) / plRange, 0, 1);

  // Source: damage_calculation.lua:216-222
  const dmgTable = constants.damage_output[armorType];
  const dmgMin = dmgTable.min;
  const dmgMax = dmgTable.max;
  return dmgMin + (dmgMax - dmgMin) * percentage;
}

// ── Stage 2: Buff Multiplier Stack ──────────────────────────────────

/**
 * Applies the pre-assembled buff stack to base damage.
 *
 * Source: _base_damage (damage_calculation.lua:563-591)
 * The source computes:
 *   buff_damage_modifier = damage_stat_buffs * damage_taken_stat_buffs - 1
 *   buff_damage = base_damage * buff_damage_modifier
 *   total = base_damage + buff_damage = base_damage * damage_stat_buffs * damage_taken_stat_buffs
 *
 * For the static calculator, assembleBuildBuffStack (Task 6) pre-computes:
 *   additive_sum    — sum of all additive damage stat buffs (starts at 1)
 *   multiplicative_product — product of all multiplicative buffs (starts at 1)
 *   target_modifier — combined target-side damage-taken modifier (starts at 1)
 *
 * @param {object} params
 * @param {number} params.baseDamage - Raw base damage from stage 1
 * @param {object} params.buffStack - { additive_sum?, multiplicative_product?, target_modifier? }
 * @returns {number} Buffed damage
 */
export function calculateDamageBuff({ baseDamage, buffStack }) {
  const additive = buffStack.additive_sum ?? 1;
  const multiplicative = buffStack.multiplicative_product ?? 1;
  const target = buffStack.target_modifier ?? 1;
  return baseDamage * additive * multiplicative * target;
}

// ── Stage 3: Armor Damage Modifier ──────────────────────────────────

/**
 * Resolves the armor damage modifier (ADM) for the attack.
 *
 * Source: DamageProfile.armor_damage_modifier (damage_profile.lua:99-232)
 *
 * Melee: profile.armor_damage_modifier.attack[armorType] — scalar or [min, max] lerped by quality
 * Ranged: profile.armor_damage_modifier_ranged.{near,far}.attack[armorType] — lerped by quality,
 *         then interpolated by sqrt(dropoffScalar)
 *
 * @param {object} params
 * @param {object} params.profile - Damage profile with ADM tables
 * @param {string} params.armorType - Target armor type
 * @param {number} params.quality - Weapon modifier quality (0–1 lerp value)
 * @param {boolean} params.isRanged - Whether ranged attack
 * @param {number} [params.distance] - Distance to target in meters (ranged only)
 * @param {object} [params.constants] - { ranged_close, ranged_far }
 * @param {object} [params.defaultADM] - Fallback ADM table if profile lacks entry
 * @returns {number} Armor damage modifier (typically 0–2)
 */
export function resolveArmorDamageModifier({
  profile,
  armorType,
  quality,
  isRanged,
  distance,
  constants,
  defaultADM,
}) {
  if (isRanged && profile.armor_damage_modifier_ranged) {
    const ranged = profile.armor_damage_modifier_ranged;
    const nearEntry = ranged.near?.attack?.[armorType];
    const farEntry = ranged.far?.attack?.[armorType];

    const nearADM = lerpADMEntry(nearEntry, quality);
    const farADM = lerpADMEntry(farEntry, quality);

    // Compute dropoff scalar from distance using ranged_close/ranged_far
    // Source: damage_profile.lua:190
    const close = constants?.ranged_close ?? 12.5;
    const far = constants?.ranged_far ?? 30;
    const dropoffScalar = clamp((distance ?? 0) - close, 0, far - close) / (far - close);
    return lerp(nearADM, farADM, Math.sqrt(dropoffScalar));
  }

  // Melee path
  // Source: damage_profile.lua:192-211
  const adm = profile.armor_damage_modifier;
  let entry;

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
 * Source: DamageProfile.lerp_damage_profile_entry (damage_profile.lua:379-384)
 */
function lerpADMEntry(entry, quality) {
  if (Array.isArray(entry)) {
    return lerp(entry[0], entry[1], quality ?? 0);
  }
  return entry ?? 1;
}

// ── Stage 4: Rending ────────────────────────────────────────────────

/**
 * Applies rending to the armor damage modifier.
 *
 * Source: damage_calculation.lua:67-83
 *
 * Three cases based on ADM vs rending:
 * 1. ADM >= 1: overdamage directly (rended = ADM + rending * overdamage_mult)
 * 2. ADM + rending > 1: partial overdamage (rended = 1 + excess * overdamage_mult)
 * 3. ADM + rending <= 1: simple addition (rended = ADM + rending)
 *
 * @param {object} params
 * @param {number} params.rendingSources - Accumulated rending multiplier (0–1, pre-capped)
 * @param {number} params.armorDamageModifier - ADM from stage 3
 * @param {string} params.armorType - Target armor type
 * @param {object} params.constants - { rending_armor_type_multiplier, overdamage_rending_multiplier }
 * @returns {{ rendedADM: number }}
 */
export function calculateRending({
  rendingSources,
  armorDamageModifier,
  armorType,
  constants,
}) {
  const rendingArmorMult = constants.rending_armor_type_multiplier[armorType] ?? 0;
  const overdamageMult = constants.overdamage_rending_multiplier[armorType] ?? 0;
  const rendingMultiplier = rendingSources * rendingArmorMult;

  if (rendingMultiplier <= 0) {
    return { rendedADM: armorDamageModifier };
  }

  // Source: damage_calculation.lua:73-79
  let rendedADM;
  const admLost = Math.max(1 - armorDamageModifier, 0);

  if (armorDamageModifier >= 1) {
    // Case 1: ADM already above 1 — all rending is overdamage
    rendedADM = armorDamageModifier + rendingMultiplier * overdamageMult;
  } else if (admLost < rendingMultiplier) {
    // Case 2: Rending fills the gap to 1 and overflows
    rendedADM = 1 + (rendingMultiplier - admLost) * overdamageMult;
  } else {
    // Case 3: Rending doesn't reach 1 — simple addition
    rendedADM = armorDamageModifier + rendingMultiplier;
  }

  return { rendedADM };
}

// ── Stage 5: Finesse Boost ──────────────────────────────────────────

/**
 * Calculates the finesse (crit + weakspot) boost multiplier.
 *
 * Source: _finesse_boost_damage (damage_calculation.lua:646-757)
 *         ui_finesse_multiplier (damage_calculation.lua:135-167)
 *
 * The finesse amount is the sum of weakspot + crit contributions, clamped to [0, 1],
 * then passed through the boost curve to produce a multiplier.
 *
 * @param {object} params
 * @param {boolean} params.isCrit
 * @param {boolean} params.isWeakspot
 * @param {string} params.armorType
 * @param {object} params.constants - { default_finesse_boost_amount, default_crit_boost_amount, boost_curves }
 * @param {number[]} [params.profileBoostCurve] - Override boost curve from profile
 * @param {object} [params.profileFinesseBoost] - Override finesse boost table { [armorType]: amount }
 * @param {number} [params.profileCritBoost] - Override crit boost amount
 * @returns {number} Finesse multiplier (>= 1)
 */
export function calculateFinesseBoost({
  isCrit,
  isWeakspot,
  armorType,
  constants,
  profileBoostCurve,
  profileFinesseBoost,
  profileCritBoost,
}) {
  let finesseAmount = 0;

  // Source: damage_calculation.lua:648-662
  if (isWeakspot) {
    const boostTable = profileFinesseBoost;
    finesseAmount +=
      boostTable?.[armorType] ??
      constants.default_finesse_boost_amount[armorType] ??
      0.5;
  }

  // Source: damage_calculation.lua:664-670
  if (isCrit) {
    const critBoost =
      profileCritBoost ?? constants.default_crit_boost_amount ?? 0.5;
    finesseAmount += critBoost;
  }

  if (finesseAmount <= 0) {
    return 1;
  }

  // Source: damage_calculation.lua:677
  finesseAmount = Math.min(finesseAmount, 1);

  // Source: damage_calculation.lua:680
  const curve =
    profileBoostCurve ?? constants.boost_curves?.default ?? [0, 0.3, 0.6, 0.8, 1];
  const boost = boostCurveMultiplier(curve, finesseAmount);

  return 1 + boost;
}

// ── Stage 6: Positional ─────────────────────────────────────────────

/**
 * Applies backstab and flanking damage bonuses.
 *
 * Source: _backstab_damage (damage_calculation.lua:808-815)
 *         _flanking_damage (damage_calculation.lua:817-822)
 *
 * @param {object} params
 * @param {number} params.damage - Current damage value
 * @param {boolean} params.isBackstab
 * @param {boolean} params.isFlanking
 * @param {object} params.buffStack - { backstab_damage?, flanking_damage? } (default 1)
 * @param {number} [params.backstabBonus] - Profile-specific backstab_bonus (default 0)
 * @returns {number} Damage after positional bonuses
 */
export function calculatePositional({
  damage,
  isBackstab,
  isFlanking,
  buffStack,
  backstabBonus,
}) {
  // Source: damage_calculation.lua:808-815
  let backstabDamage = 0;
  if (isBackstab) {
    const backstabBuff = buffStack.backstab_damage ?? 1;
    const profileBonus = backstabBonus ?? 0;
    const multiplier = backstabBuff + profileBonus;
    backstabDamage = damage * (multiplier - 1);
  }

  // Source: damage_calculation.lua:817-822
  let flankingDamage = 0;
  if (isFlanking) {
    const flankingBuff = buffStack.flanking_damage ?? 1;
    flankingDamage = damage * (flankingBuff - 1);
  }

  return damage + backstabDamage + flankingDamage;
}

// ── Stage 7: Hit Zone Damage Multiplier ─────────────────────────────

/**
 * Looks up the damage multiplier for the hit zone on the target breed.
 *
 * Source: _hit_zone_damage_multiplier (damage_calculation.lua:769-806)
 *
 * @param {object} params
 * @param {object|null} params.breed - Breed data with hitzone_damage_multiplier
 * @param {string} params.hitZone - Hit zone name (e.g. "head", "body")
 * @param {string} params.attackType - "melee" or "ranged"
 * @returns {number} Hit zone multiplier (default 1.0)
 */
export function hitZoneDamageMultiplier({ breed, hitZone, attackType }) {
  if (!breed) return 1;

  const hzm = breed.hitzone_damage_multiplier;
  if (!hzm) return 1;

  // Source: damage_calculation.lua:793
  const defaultMap = hzm.default;
  const attackTypeMap = hzm[attackType] ?? defaultMap;

  if (!attackTypeMap) return 1;

  // Source: damage_calculation.lua:799
  const mult = attackTypeMap[hitZone] ?? defaultMap?.[hitZone];

  return mult ?? 1;
}

// ── Stage 8: Armor-Type Stat Buffs ──────────────────────────────────

/**
 * Armor-type-specific damage buffs (e.g. armored_damage, unarmored_damage).
 *
 * Source: _apply_armor_type_buffs_to_damage (damage_calculation.lua:196-201)
 *         ARMOR_TYPE_TO_STAT_BUFF lookup (damage_calculation.lua:187-194)
 *
 * @param {object} params
 * @param {number} params.damage - Current damage
 * @param {string} params.armorType - Target armor type
 * @param {object} params.buffStack - { [armorType_damage]: multiplier }
 * @returns {number} Damage after armor-type buff
 */
export function applyArmorTypeBuffs({ damage, armorType, buffStack }) {
  // Source: ARMOR_TYPE_TO_STAT_BUFF (damage_calculation.lua:187-194)
  const statName = `${armorType}_damage`;
  const mult = buffStack[statName] ?? 1;
  return damage * mult;
}

// ── Stage 9: Diminishing Returns ───────────────────────────────────

/**
 * Applies diminishing returns scaling based on target's current health.
 *
 * Source: _apply_diminishing_returns_to_damage (damage_calculation.lua:759-767)
 *
 * Only applies when breed.diminishing_returns_damage is truthy.
 * Uses easeInCubic(healthPercent) to scale damage — at full health (1.0)
 * this is a no-op (1^3 = 1). At lower health, damage is reduced cubically.
 *
 * For static breakpoint analysis, healthPercent defaults to 1.0 (full health),
 * making this effectively a no-op. Implemented for correctness and future use
 * in multi-hit simulations.
 *
 * @param {object} params
 * @param {number} params.damage - Current damage value
 * @param {object|null} params.breed - Breed data (needs diminishing_returns_damage flag)
 * @param {number} params.healthPercent - Target's current health as fraction 0–1
 * @returns {number} Damage after diminishing returns
 */
export function applyDiminishingReturns({ damage, breed, healthPercent }) {
  if (!breed || !breed.diminishing_returns_damage) {
    return damage;
  }

  // Source: math.easeInCubic(x) = x^3
  // Source: math.lerp(0, damage, easeInCubic(healthPercent))
  const eased = healthPercent * healthPercent * healthPercent;
  return lerp(0, damage, eased);
}

// ── Stage 10: Force Field (no-op) ──────────────────────────────────
// Force field short-circuit — skip in static calculator.
// Force fields are dynamic ability effects (e.g. Psyker dome) that
// negate all damage. Not relevant for breakpoint analysis.
// Deferred to #11 (toughness/survivability calculator).

// ── Stage 11: Damage Efficiency Classification ─────────────────────

/**
 * Classifies the damage efficiency of an attack based on ADM and armor type.
 *
 * Source: armor_damage_modifier_to_damage_efficiency (attack_settings.lua:26-34)
 *
 * Three categories:
 * - "negated": (armored or super_armor) with ADM <= 0.1 and no rending damage,
 *              or void_shield targets
 * - "full": ADM > 0.6
 * - "reduced": everything else
 *
 * @param {object} params
 * @param {number} params.armorDamageModifier - Effective ADM (after rending)
 * @param {string} params.armorType - Target armor type
 * @param {number} [params.rendingDamage] - Amount of rending damage applied (default 0)
 * @returns {"negated"|"reduced"|"full"} Damage efficiency category
 */
export function classifyDamageEfficiency({
  armorDamageModifier,
  armorType,
  rendingDamage,
}) {
  const rending = rendingDamage ?? 0;

  // Source: attack_settings.lua:27
  if (
    (armorType === "super_armor" || armorType === "armored") &&
    armorDamageModifier <= 0.1 &&
    rending === 0
  ) {
    return "negated";
  }

  // Source: attack_settings.lua:27 (void_shield clause)
  if (armorType === "void_shield") {
    return "negated";
  }

  // Source: attack_settings.lua:29
  if (armorDamageModifier > 0.6) {
    return "full";
  }

  // Source: attack_settings.lua:31
  return "reduced";
}

// ── Stage 12: Toughness/Health Split (no-op) ───────────────────────
// Toughness vs health damage allocation — skip in static calculator.
// Breakpoint analysis uses raw health damage (pre-toughness).
// Deferred to #11 (toughness/survivability calculator).

// ── Stage 13: Final Application (no-op) ────────────────────────────
// Leech, resist_death, and other post-damage hooks — skip in static
// calculator. Breakpoint analysis uses pre-stage-13 damage.
// Deferred to #11 (toughness/survivability calculator).

// ── Orchestrator: computeHit ───────────────────────────────────────

/**
 * Composes all 13 pipeline stages into a single hit computation.
 *
 * This is the primary public API for the damage calculator. It takes a
 * damage profile, target breed, difficulty, and buff state, then runs
 * the full pipeline to produce final damage and hits-to-kill.
 *
 * @param {object} params
 * @param {object} params.profile - Damage profile (from damage-profiles.json)
 * @param {string} params.hitZone - Hit zone name ("head", "torso", etc.)
 * @param {object} params.breed - Breed data (from breed-data.json)
 * @param {string} params.difficulty - "uprising"|"malice"|"heresy"|"damnation"|"auric"
 * @param {object} [params.flags] - { is_crit, is_weakspot, is_backstab, is_flanking }
 * @param {object} [params.buffStack] - Pre-assembled buff stack
 * @param {number} [params.quality] - Weapon modifier quality 0–1 (default 0.8)
 * @param {number} [params.distance] - Distance in meters (default 0 = melee)
 * @param {number} [params.chargeLevel] - Charge level 0–1 (default 1)
 * @param {object} params.constants - Pipeline constants from damage-profiles.json
 * @returns {object} Hit result with damage, hitsToKill, and stage outputs
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
  chargeLevel,
  constants,
}) {
  const _flags = flags ?? {};
  const _buffStack = buffStack ?? {};
  const _quality = quality ?? 0.8;
  const _distance = distance ?? 0;

  // ── Resolve effective armor type for this hitzone ──
  // hitzone_armor_override takes precedence over base_armor_type
  const hitZoneData = breed.hit_zones?.[hitZone] ?? {};
  const effectiveArmorType = hitZoneData.armor_type ?? breed.base_armor_type;
  const isHitZoneWeakspot = hitZoneData.weakspot ?? false;

  // ── Determine if ranged ──
  const isRanged = !profile.melee_attack_strength;

  // ── Compute dropoff scalar for ranged ──
  // Source: damage_profile.lua:190
  let dropoffScalar;
  if (isRanged) {
    const close = constants.ranged_close ?? 12.5;
    const far = constants.ranged_far ?? 30;
    dropoffScalar = clamp((_distance - close) / (far - close), 0, 1);
  }

  // ── Stage 1: Power level → base damage ──
  const baseDamage = powerLevelToDamage({
    powerLevel: constants.default_power_level,
    powerDistribution: profile.power_distribution,
    powerDistributionRanged: profile.power_distribution_ranged,
    armorType: effectiveArmorType,
    constants,
    isRanged,
    dropoffScalar,
  });

  // ── Stage 2: Buff multiplier ──
  const buffedDamage = calculateDamageBuff({ baseDamage, buffStack: _buffStack });

  // ── Stage 3: Armor damage modifier ──
  const adm = resolveArmorDamageModifier({
    profile,
    armorType: effectiveArmorType,
    quality: _quality,
    isRanged,
    distance: _distance,
    constants,
    defaultADM: constants.default_armor_damage_modifier,
  });

  // ── Stage 4: Rending ──
  const rendingSources = _buffStack.rending_multiplier ?? 0;
  const { rendedADM } = calculateRending({
    rendingSources,
    armorDamageModifier: adm,
    armorType: effectiveArmorType,
    constants,
  });

  // Apply ADM to buffed damage
  let damage = buffedDamage * rendedADM;

  // ── Stage 5: Finesse boost ──
  // Both the flag and the hitzone must agree for weakspot finesse
  const effectiveWeakspot = (_flags.is_weakspot ?? false) && isHitZoneWeakspot;

  const finesseBoost = calculateFinesseBoost({
    isCrit: _flags.is_crit ?? false,
    isWeakspot: effectiveWeakspot,
    armorType: effectiveArmorType,
    constants,
    profileBoostCurve: profile.boost_curve,
    profileFinesseBoost: profile.finesse_boost,
    profileCritBoost: profile.crit_boost,
  });
  damage *= finesseBoost;

  // ── Stage 6: Positional ──
  damage = calculatePositional({
    damage,
    isBackstab: _flags.is_backstab ?? false,
    isFlanking: _flags.is_flanking ?? false,
    buffStack: _buffStack,
    backstabBonus: profile.backstab_bonus,
  });

  // ── Stage 7: Hitzone multiplier ──
  const attackType = isRanged ? "ranged" : "melee";
  const hzMult = hitZoneDamageMultiplier({ breed, hitZone, attackType });
  damage *= hzMult;

  // ── Stage 8: Armor-type stat buffs (attacker side) ──
  damage = applyArmorTypeBuffs({ damage, armorType: effectiveArmorType, buffStack: _buffStack });

  // ── Stage 9: Diminishing returns ──
  damage = applyDiminishingReturns({ damage, breed, healthPercent: 1.0 });

  // Stage 10: Force field — skip (not relevant for breakpoint analysis)
  // Stage 12: Toughness/health split — skip (breakpoints use raw health damage)
  // Stage 13: Final application — skip (breakpoints use pre-stage-13 damage)

  // ── Stage 11: Damage efficiency classification ──
  // Source passes pre-rending ADM to the efficiency classifier (line 107)
  // and rending_damage = damage * (rended_adm - raw_adm) (line 81)
  const rendingDamage = rendedADM > adm ? (rendedADM - adm) * buffedDamage : 0;
  const damageEfficiency = classifyDamageEfficiency({
    armorDamageModifier: adm,
    armorType: effectiveArmorType,
    rendingDamage,
  });

  // ── Compute hits to kill ──
  const enemyHP = breed.difficulty_health?.[difficulty] ?? 0;
  const hitsToKill = enemyHP > 0 && damage > 0 ? Math.ceil(enemyHP / damage) : Infinity;

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

// ── Buff Stack Assembly ─────────────────────────────────────────────

/**
 * Known multiplicative stats — their magnitudes are multiplied together
 * rather than summed.
 */
const MULTIPLICATIVE_STATS = new Set([
  "smite_damage_multiplier",
  "companion_damage_multiplier",
]);

/**
 * Known target-side multiplier stats — combined into target_modifier.
 */
const TARGET_MULTIPLIER_STATS = new Set([
  "damage_taken_multiplier",
  "damage_taken_melee_multiplier",
  "damage_taken_ranged_multiplier",
]);

/**
 * Stats stored individually on the buff stack for use by specific pipeline
 * stages (rending, positional, armor-type). They do NOT contribute to
 * additive_sum.
 */
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
 *
 * @param {string|null} condition - Condition tag from the effect
 * @param {object} flags - Scenario flags
 * @returns {{ active: boolean, scale?: number }}
 *   active=true means include the effect; scale (if present) means
 *   multiply magnitude by this value (for lerped conditions).
 */
function isConditionActive(condition, flags) {
  if (!condition) return { active: true };

  switch (condition) {
    case "threshold:health_low":
      return { active: flags.health_state === "low" };
    case "threshold:toughness_high":
      return { active: flags.health_state === "full" };
    case "threshold:warp_charge":
      // Lerped: scale magnitude by warp_charge fraction (0-1)
      return {
        active: (flags.warp_charge ?? 0) > 0,
        scale: flags.warp_charge ?? 0,
      };
    case "threshold:stamina_high":
    case "threshold:stamina_full":
      return { active: true }; // conservative: assume stamina is high
    case "ads_active":
      return { active: flags.ads_active === true };
    case "ability_active":
      return { active: flags.ability_active === true };
    case "during_heavy":
      // Always include — filtering happens at computeHit level
      return { active: true };
    case "during_reload":
      return { active: flags.during_reload === true };
    case "wielded":
    case "active":
      return { active: true }; // self-sufficient when equipped
    case "unknown_condition":
      return { active: false }; // conservative: exclude
    default:
      return { active: false }; // unrecognized → exclude
  }
}

/**
 * Assembles a buff stack from a canonical build, entity index, and scenario flags.
 *
 * Collects all resolved entity IDs from the build (talents, structural slots,
 * weapon blessings/perks, curio perks), looks up their calc.effects in the index,
 * filters by condition flags, and accumulates into a flat buff stack object
 * consumed by computeHit.
 *
 * For name_family entities (blessings), traverses instance_of edges to find
 * a weapon_trait with effects or tiered effects (using last tier).
 *
 * @param {object} build - Canonical build JSON
 * @param {object} index - { entities: Map<string, entity>, edges: Array<edge> }
 * @param {object} flags - Scenario flags (health_state, warp_charge, ads_active, etc.)
 * @returns {object} Flat buff stack with additive_sum, multiplicative_product,
 *   target_modifier, and individual per-stat values.
 */
export function assembleBuildBuffStack(build, index, flags) {
  const _flags = flags ?? {};
  const entities = index.entities;
  const edges = index.edges ?? [];

  // ── Step 1: Collect all resolved entity IDs ──
  const entityIds = [];

  // Structural slots
  for (const field of ["ability", "blitz", "aura", "keystone"]) {
    const slot = build[field];
    if (
      slot?.canonical_entity_id &&
      slot.resolution_status === "resolved"
    ) {
      entityIds.push(slot.canonical_entity_id);
    }
  }

  // Flat talents
  for (const t of build.talents ?? []) {
    if (
      t.canonical_entity_id &&
      t.resolution_status === "resolved"
    ) {
      entityIds.push(t.canonical_entity_id);
    }
  }

  // Weapons: blessings + perks
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

  // Curios: perks
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

  // ── Build instance_of reverse index for name_family traversal ──
  const instanceOfIndex = new Map();
  for (const edge of edges) {
    if (edge.type !== "instance_of") continue;
    if (!instanceOfIndex.has(edge.to_entity_id)) {
      instanceOfIndex.set(edge.to_entity_id, []);
    }
    instanceOfIndex.get(edge.to_entity_id).push(edge.from_entity_id);
  }

  // ── Step 2-3: Look up effects, filter, accumulate ──
  let additiveSum = 0;
  let multiplicativeProduct = 1;
  let targetModifier = 1;
  const individualStats = {};

  for (const entityId of entityIds) {
    const entity = entities.get(entityId);
    if (!entity) continue;

    // Resolve effects — direct or via name_family traversal
    let effects = [];

    if (entity.calc?.effects?.length > 0) {
      effects = entity.calc.effects;
    } else if (entity.kind === "name_family") {
      // Traverse instance_of edges to find a weapon_trait with effects
      const fromIds = instanceOfIndex.get(entityId) ?? [];
      for (const fromId of fromIds) {
        const fromEntity = entities.get(fromId);
        if (!fromEntity) continue;
        if (fromEntity.calc?.effects?.length > 0) {
          effects = fromEntity.calc.effects;
          break;
        }
        if (fromEntity.calc?.tiers?.length > 0) {
          const lastTier =
            fromEntity.calc.tiers[fromEntity.calc.tiers.length - 1];
          effects = lastTier.effects ?? [];
          break;
        }
      }
    }

    // Filter and accumulate each effect
    for (const effect of effects) {
      if (effect.magnitude == null) continue; // skip expression-based

      const { stat, magnitude, type, condition } = effect;
      if (!stat) continue;

      // ── Filter by type + flags ──
      let effectiveMagnitude = magnitude;

      if (type === "stat_buff") {
        // Unconditional — always included
      } else if (type === "conditional_stat_buff") {
        const result = isConditionActive(condition, _flags);
        if (!result.active) continue;
        if (result.scale != null) {
          effectiveMagnitude = magnitude * result.scale;
        }
      } else if (type === "proc_stat_buff") {
        if ((_flags.proc_stacks ?? 0) <= 0) continue;
      } else if (type === "lerped_stat_buff") {
        // Lerped: if magnitude_min/magnitude_max present, interpolate
        const { magnitude_min, magnitude_max } = effect;
        if (magnitude_min != null && magnitude_max != null) {
          // Use warp_charge as the lerp factor (most common lerped buff)
          const t = _flags.warp_charge ?? 0;
          effectiveMagnitude = magnitude_min + (magnitude_max - magnitude_min) * t;
        }
        // Otherwise use magnitude directly (already set)
      } else {
        // Unknown effect type — skip conservatively
        continue;
      }

      // ── Accumulate ──
      if (INDIVIDUAL_STATS.has(stat)) {
        // Individual stats accumulate additively into their own slot
        // Stored as 1 + sum(magnitudes) for direct use as multipliers
        individualStats[stat] = (individualStats[stat] ?? 1) + effectiveMagnitude;
      } else if (MULTIPLICATIVE_STATS.has(stat)) {
        multiplicativeProduct *= 1 + effectiveMagnitude;
      } else if (TARGET_MULTIPLIER_STATS.has(stat)) {
        targetModifier *= 1 + effectiveMagnitude;
      } else {
        // Default: additive damage stat
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

// ── Data Loading ─────────────────────────────────────────────────────

/**
 * Loads the two generated JSON files (damage-profiles.json & breed-data.json)
 * and returns a bundled object for use by computeBreakpoints.
 *
 * @returns {{ profiles: object[], actionMaps: object[], constants: object, breeds: object[] }}
 */
export function loadCalculatorData() {
  const profileData = JSON.parse(readFileSync(join(GENERATED_DIR, "damage-profiles.json"), "utf-8"));
  const breedData = JSON.parse(readFileSync(join(GENERATED_DIR, "breed-data.json"), "utf-8"));
  return {
    profiles: profileData.profiles,
    actionMaps: profileData.action_maps,
    constants: profileData.constants,
    breeds: breedData.breeds,
  };
}

// ── Breakpoint Matrix ────────────────────────────────────────────────

/**
 * Action type categories for summary grouping.
 * Maps action_map action names to light/heavy/special/push.
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

const DIFFICULTIES = ["uprising", "malice", "heresy", "damnation", "auric"];

const SCENARIO_PRESETS = {
  sustained: { health_state: "full" },
  aimed: { is_weakspot: true, health_state: "full" },
  burst: { is_crit: true, is_weakspot: true, proc_stacks: Infinity, health_state: "low" },
};

const SCENARIO_HITZONES = {
  sustained: "torso",
  aimed: "head",
  burst: "head",
};

/**
 * Adapts the generated breed-data.json hit_zones format to the shape
 * expected by computeHit.
 *
 * Generated format:
 *   hit_zones: { head: { armor_type, weakspot, damage_multiplier: { ranged, melee } }, ... }
 *
 * computeHit expects:
 *   hit_zones: { head: { armor_type, weakspot }, ... }
 *   hitzone_damage_multiplier: { ranged: { head: 1.5 }, melee: { head: 1 }, default: { head: 1 } }
 *
 * @param {object} rawBreed - Breed record from breed-data.json
 * @returns {object} Breed record with hitzone_damage_multiplier added
 */
function adaptBreed(rawBreed) {
  if (!rawBreed.hit_zones) return rawBreed;

  const hzm = { default: {}, melee: {}, ranged: {} };
  const adaptedHitZones = {};

  for (const [zone, data] of Object.entries(rawBreed.hit_zones)) {
    adaptedHitZones[zone] = {
      armor_type: data.armor_type,
      weakspot: data.weakspot ?? false,
    };
    const dm = data.damage_multiplier;
    if (dm) {
      if (dm.melee != null) hzm.melee[zone] = dm.melee;
      if (dm.ranged != null) hzm.ranged[zone] = dm.ranged;
      hzm.default[zone] = dm.melee ?? dm.ranged ?? 1;
    }
  }

  return {
    ...rawBreed,
    hit_zones: adaptedHitZones,
    hitzone_damage_multiplier: hzm,
  };
}

/**
 * Lerps array-valued profile fields by quality. If the value is already
 * a scalar, returns it unchanged.
 *
 * @param {number|number[]} entry - Scalar or [min, max] array
 * @param {number} quality - 0-1 lerp factor
 * @returns {number} Resolved scalar value
 */
function lerpProfileEntry(entry, quality) {
  if (Array.isArray(entry)) {
    return entry[0] + (entry[1] - entry[0]) * quality;
  }
  return entry;
}

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
    resolved.attack = lerpProfileEntry(pd.attack, quality);
  }
  if (Array.isArray(pd.impact)) {
    resolved.impact = lerpProfileEntry(pd.impact, quality);
  }

  return { ...profile, power_distribution: resolved };
}

/**
 * Determines whether a weapon is ranged based on its slot or template name.
 *
 * @param {object} weapon - Build weapon entry
 * @param {string} templateName - Internal weapon template name
 * @returns {boolean}
 */
function isWeaponRanged(weapon, templateName) {
  if (weapon.slot === "ranged") return true;
  if (weapon.slot === "melee") return false;
  // Heuristic: if the template has action_maps with shoot_ actions, it's ranged
  // But we don't have that info here, so fall back to melee
  return false;
}

/**
 * Computes a breakpoint matrix for all weapons in a build.
 *
 * For each weapon × action × scenario × breed × difficulty, runs computeHit
 * and stores the result. Also builds per-weapon summaries with best actions
 * per category at damnation difficulty.
 *
 * @param {object} build - Canonical build JSON
 * @param {object} index - { entities: Map, edges: Array } from loadIndex()
 * @param {object} calcData - From loadCalculatorData()
 * @returns {object} Breakpoint matrix (see output shape in docs)
 */
export function computeBreakpoints(build, index, calcData) {
  const quality = 0.8;

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

  // Pre-adapt all breeds
  const breeds = calcData.breeds.map(adaptBreed);

  // Pre-build buff stacks per scenario
  const buffStacks = {};
  for (const [name, flags] of Object.entries(SCENARIO_PRESETS)) {
    buffStacks[name] = assembleBuildBuffStack(build, index, flags);
  }

  const weaponResults = [];

  for (let slot = 0; slot < (build.weapons ?? []).length; slot++) {
    const weapon = build.weapons[slot];
    const entityId = weapon.name?.canonical_entity_id;
    if (!entityId || weapon.name?.resolution_status !== "resolved") continue;

    // Extract internal template name: shared.weapon.autogun_p1_m1 → autogun_p1_m1
    const templateName = entityId.split(".").pop();
    const actionMap = actionMapByTemplate.get(templateName);
    if (!actionMap) continue; // No action map for this weapon — skip

    const isRanged = isWeaponRanged(weapon, templateName);
    const distance = isRanged ? 20 : 0;

    const actionResults = [];

    for (const [actionType, profileIds] of Object.entries(actionMap.actions)) {
      for (const profileId of profileIds) {
        const rawProfile = profileMap.get(profileId);
        if (!rawProfile) continue;

        const profile = resolveProfileForQuality(rawProfile, quality);

        const scenarios = {};

        for (const scenarioName of Object.keys(SCENARIO_PRESETS)) {
          const hitZone = SCENARIO_HITZONES[scenarioName];
          const buffStack = buffStacks[scenarioName];
          const flags = SCENARIO_PRESETS[scenarioName];
          const breedResults = [];

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

    // Build summary: best action per category at damnation for sustained scenario
    const summary = buildActionSummary(actionResults);

    weaponResults.push({
      entityId,
      slot,
      actions: actionResults,
      summary,
    });
  }

  return {
    weapons: weaponResults,
    metadata: {
      quality,
      scenarios: Object.keys(SCENARIO_PRESETS),
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Builds a per-weapon summary: bestLight, bestHeavy, bestSpecial.
 * Picks the action with the lowest average hitsToKill at damnation for each category.
 *
 * @param {object[]} actionResults - Array of action results from computeBreakpoints
 * @returns {{ bestLight: object|null, bestHeavy: object|null, bestSpecial: object|null }}
 */
function buildActionSummary(actionResults) {
  const categoryBest = { light: null, heavy: null, special: null };

  for (const action of actionResults) {
    const category = ACTION_CATEGORY[action.type] ?? null;
    if (!category || category === "push") continue;
    if (!categoryBest.hasOwnProperty(category)) continue;

    // Compute average hitsToKill at damnation across all breeds for sustained scenario
    const sustained = action.scenarios.sustained;
    if (!sustained) continue;

    const damnationEntries = sustained.breeds.filter(b => b.difficulty === "damnation");
    if (damnationEntries.length === 0) continue;

    // Use sum of finite hitsToKill; treat Infinity as very large
    const totalHTK = damnationEntries.reduce((sum, b) => {
      return sum + (Number.isFinite(b.hitsToKill) ? b.hitsToKill : 9999);
    }, 0);
    const avgHTK = totalHTK / damnationEntries.length;

    // Build per-breed breakdown at damnation
    const damnationBreakpoints = {};
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

  // Strip internal _avgHTK from output
  const clean = (entry) => {
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

// ── Breakpoint Summary ───────────────────────────────────────────────

/** Key breed IDs for breakpoint summary: elite, armored heavy, horde. */
const KEY_BREEDS = ["renegade_berzerker", "chaos_ogryn_bulwark", "chaos_poxwalker"];

/**
 * Extracts per-weapon best-case hits-to-kill for key enemies at damnation.
 * Used by the scoring layer.
 *
 * For each weapon, for each scenario, picks the best action per category
 * (light/heavy/special) by lowest hitsToKill for key enemies.
 *
 * @param {object} matrix - Output from computeBreakpoints
 * @returns {object[]} Array of summary entries
 */
export function summarizeBreakpoints(matrix) {
  const summaries = [];

  for (const weapon of matrix.weapons) {
    for (const scenarioName of matrix.metadata.scenarios) {
      // Group actions by category
      const categoryActions = { light: [], heavy: [], special: [] };

      for (const action of weapon.actions) {
        const category = ACTION_CATEGORY[action.type] ?? null;
        if (!category || category === "push") continue;
        if (!categoryActions.hasOwnProperty(category)) continue;
        categoryActions[category].push(action);
      }

      for (const [category, actions] of Object.entries(categoryActions)) {
        if (actions.length === 0) continue;

        // Pick action with lowest average hitsToKill across key breeds at damnation
        let bestAction = null;
        let bestAvg = Infinity;

        for (const action of actions) {
          const scenario = action.scenarios[scenarioName];
          if (!scenario) continue;

          const keyEntries = scenario.breeds.filter(
            b => b.difficulty === "damnation" && KEY_BREEDS.includes(b.breed_id)
          );
          if (keyEntries.length === 0) continue;

          const avg = keyEntries.reduce((sum, b) => {
            return sum + (Number.isFinite(b.hitsToKill) ? b.hitsToKill : 9999);
          }, 0) / keyEntries.length;

          if (avg < bestAvg) {
            bestAvg = avg;
            bestAction = action;
          }
        }

        if (!bestAction) continue;

        const scenario = bestAction.scenarios[scenarioName];
        const keyBreakpoints = {};
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
