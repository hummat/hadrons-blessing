/**
 * Damage calculator engine — core pipeline stages 1–8.
 *
 * Direct port of Darktide's damage_calculation.lua (13-stage pipeline).
 * Each stage is a pure function with no side effects.
 *
 * Source: scripts/utilities/attack/damage_calculation.lua
 * Supporting: scripts/utilities/attack/power_level.lua
 *             scripts/utilities/attack/damage_profile.lua
 *             scripts/settings/damage/power_level_settings.lua
 *             scripts/settings/damage/armor_settings.lua
 */

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
 * @param {number} [params.dropoffScalar] - Ranged dropoff (0=near, 1=far)
 * @param {object} [params.constants] - { ranged_close, ranged_far }
 * @param {object} [params.defaultADM] - Fallback ADM table if profile lacks entry
 * @returns {number} Armor damage modifier (typically 0–2)
 */
export function resolveArmorDamageModifier({
  profile,
  armorType,
  quality,
  isRanged,
  dropoffScalar,
  constants,
  defaultADM,
}) {
  if (isRanged && profile.armor_damage_modifier_ranged) {
    const ranged = profile.armor_damage_modifier_ranged;
    const nearEntry = ranged.near?.attack?.[armorType];
    const farEntry = ranged.far?.attack?.[armorType];

    const nearADM = lerpADMEntry(nearEntry, quality);
    const farADM = lerpADMEntry(farEntry, quality);

    // Source: damage_profile.lua:190
    const ds = dropoffScalar ?? 0;
    return lerp(nearADM, farADM, Math.sqrt(ds));
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
