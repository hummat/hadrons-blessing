// @ts-nocheck
/**
 * Stagger calculator engine — computes stagger results for every weapon action
 * in a build, determining what stagger tier each action achieves against each breed.
 *
 * Direct port of Darktide's stagger_calculation.lua.
 * Reuses powerLevelToDamage from damage-calculator.mjs for impact power scaling.
 *
 * Source: scripts/utilities/attack/stagger_calculation.lua
 *         scripts/settings/damage/stagger_settings.lua
 *         scripts/settings/damage/power_level_settings.lua
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  powerLevelToDamage,
  assembleBuildBuffStack,
  loadCalculatorData,
  adaptBreed,
} from "./damage-calculator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GENERATED_DIR = join(__dirname, "..", "..", "data", "ground-truth", "generated");

// ── Helpers ──────────────────────────────────────────────────────────

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// ── Data Loading ─────────────────────────────────────────────────────

/**
 * Loads stagger-settings.json from the generated data directory.
 *
 * @returns {object} Stagger settings including categories, thresholds, types
 */
export function loadStaggerSettings() {
  return JSON.parse(readFileSync(join(GENERATED_DIR, "stagger-settings.json"), "utf-8"));
}

// ── Impact Power ─────────────────────────────────────────────────────

/**
 * Computes the raw stagger strength from a damage profile's impact power
 * distribution, analogous to powerLevelToDamage but for the impact channel.
 *
 * Source: _calculate_stagger_strength (stagger_calculation.lua:67-93)
 *         Uses stagger_strength_output table (same shape as damage_output:
 *         {min: 0, max: 20} for all armor types).
 *
 * Since stagger_strength_output has the same {min:0, max:20} values as
 * damage_output for all armor types, we reuse powerLevelToDamage directly
 * with the impact power distribution substituted for the attack distribution.
 *
 * @param {object} params
 * @param {object} params.profile - Damage profile (resolved for quality)
 * @param {string} params.armorType - Target armor type key
 * @param {object} params.constants - Pipeline constants from damage-profiles.json
 * @param {boolean} params.isRanged - Whether ranged attack
 * @param {number} [params.dropoffScalar] - Ranged dropoff scalar (0=close, 1=far)
 * @returns {number} Raw stagger strength before ADM and reduction
 */
export function computeRawStaggerStrength({
  profile,
  armorType,
  constants,
  isRanged,
  dropoffScalar,
}) {
  // Build an impact-only power distribution to pass to powerLevelToDamage.
  // powerLevelToDamage reads .attack from powerDistribution, so we substitute
  // the impact value into the attack slot.
  const pd = profile.power_distribution;
  if (!pd || pd.impact == null) return 0;

  const impactPd = { attack: pd.impact };

  // For ranged profiles with per-distance impact distribution, substitute too
  let impactPdRanged;
  if (isRanged && profile.power_distribution_ranged) {
    impactPdRanged = {
      attack: {
        near: profile.power_distribution_ranged.impact?.near ?? pd.impact,
        far: profile.power_distribution_ranged.impact?.far ?? pd.impact,
      },
    };
  }

  return powerLevelToDamage({
    powerLevel: constants.default_power_level,
    powerDistribution: impactPd,
    powerDistributionRanged: impactPdRanged,
    armorType,
    constants,
    isRanged,
    dropoffScalar,
  });
}

// ── Impact ADM ───────────────────────────────────────────────────────

/**
 * Resolves the impact armor damage modifier for a profile and armor type.
 *
 * Source: DamageProfile.armor_damage_modifier("impact", ...) in
 *         stagger_calculation.lua:27
 *
 * Profiles store impact ADM under armor_damage_modifier.impact[armorType]
 * (melee) or armor_damage_modifier_ranged.{near,far}.impact[armorType] (ranged).
 *
 * @param {object} params
 * @param {object} params.profile - Damage profile (raw, before quality lerp)
 * @param {string} params.armorType - Target armor type key
 * @param {number} params.quality - Weapon modifier quality 0-1
 * @param {boolean} params.isRanged - Whether ranged attack
 * @param {number} [params.dropoffScalar] - Ranged dropoff scalar
 * @returns {number} Impact armor damage modifier
 */
export function resolveImpactADM({
  profile,
  armorType,
  quality,
  isRanged,
  dropoffScalar,
}) {
  if (isRanged && profile.armor_damage_modifier_ranged) {
    const ranged = profile.armor_damage_modifier_ranged;
    const nearEntry = ranged.near?.impact?.[armorType];
    const farEntry = ranged.far?.impact?.[armorType];

    if (nearEntry == null && farEntry == null) return 1;

    const nearADM = lerpADMEntry(nearEntry, quality);
    const farADM = lerpADMEntry(farEntry, quality);

    if (dropoffScalar != null) {
      return lerp(nearADM, farADM, Math.sqrt(dropoffScalar));
    }
    return nearADM;
  }

  // Melee: use armor_damage_modifier.impact
  const impactAdm = profile.armor_damage_modifier?.impact;
  if (!impactAdm) return 1;

  const entry = impactAdm[armorType];
  return lerpADMEntry(entry, quality);
}

/**
 * Lerps an ADM entry (scalar or [min, max] array) by quality.
 */
function lerpADMEntry(entry, quality) {
  if (entry == null) return 1;
  if (Array.isArray(entry)) {
    return entry[0] + (entry[1] - entry[0]) * quality;
  }
  return entry;
}

// ── Effective Stagger Strength ───────────────────────────────────────

/**
 * Computes the effective stagger strength after applying ADM, stagger
 * resistance, and stagger reduction from the breed.
 *
 * Source: stagger_calculation.lua:25-36
 *   stagger_strength = raw_strength * armor_damage_modifier
 *   sum_stagger_strength = stagger_strength + pool - 0.5 * stagger_reduction
 *
 * For our static calculator, stagger_strength_pool = 0 (first hit scenario).
 *
 * @param {object} params
 * @param {number} params.rawStrength - Raw stagger strength from impact power
 * @param {number} params.impactADM - Impact armor damage modifier
 * @param {object} params.breedStagger - Breed's stagger data
 * @param {boolean} params.isRanged - Whether ranged attack (uses stagger_reduction_ranged)
 * @returns {{ effectiveStrength: number, staggerReduction: number, admApplied: number, blocked: boolean }}
 */
export function computeEffectiveStaggerStrength({
  rawStrength,
  impactADM,
  breedStagger,
  isRanged,
}) {
  const adm = impactADM ?? 1;
  const staggerReduction = isRanged
    ? (breedStagger.stagger_reduction_ranged ?? breedStagger.stagger_reduction ?? 0)
    : (breedStagger.stagger_reduction ?? 0);

  // Source: stagger_calculation.lua:29-30
  // If stagger_reduction > stagger_strength + pool, stagger is blocked
  const strengthAfterAdm = rawStrength * adm;
  if (staggerReduction > strengthAfterAdm) {
    return {
      effectiveStrength: 0,
      staggerReduction,
      admApplied: adm,
      blocked: true,
    };
  }

  // Source: stagger_calculation.lua:36
  // sum_stagger_strength = stagger_strength + pool - 0.5 * stagger_reduction
  // pool = 0 for single-hit analysis
  const effectiveStrength = strengthAfterAdm - 0.5 * staggerReduction;

  return {
    effectiveStrength: Math.max(0, effectiveStrength),
    staggerReduction,
    admApplied: adm,
    blocked: false,
  };
}

// ── Stagger Tier Classification ──────────────────────────────────────

/**
 * Determines the highest stagger tier achieved given effective stagger
 * strength, breed thresholds, category, and stagger resistance.
 *
 * Source: _get_stagger_type (stagger_calculation.lua:127-159)
 *
 * Walks the stagger category's type list in order, checking each threshold
 * scaled by stagger_resistance. Returns the type with the highest threshold
 * that the strength exceeds (not equals — strictly greater than).
 *
 * A threshold of -1 means the breed is immune to that stagger type.
 *
 * @param {number} strength - Effective stagger strength (after ADM + reduction)
 * @param {object} breedThresholds - Breed's stagger_thresholds map
 * @param {string} category - Stagger category key (e.g. "melee", "ranged")
 * @param {object} staggerSettings - Loaded stagger settings
 * @param {number} [staggerResistance] - Breed's stagger_resistance (default from settings)
 * @returns {{ tier: string|null, threshold: number }}
 */
export function classifyStaggerTier(
  strength,
  breedThresholds,
  category,
  staggerSettings,
  staggerResistance,
) {
  const categoryTypes = staggerSettings.stagger_categories[category];
  if (!categoryTypes || categoryTypes.length === 0) {
    return { tier: null, threshold: 0 };
  }

  const defaultThresholds = staggerSettings.default_stagger_thresholds;
  const resistance = staggerResistance ?? staggerSettings.default_stagger_resistance ?? 1;

  let chosenType = null;
  let chosenThreshold = 0;

  for (const staggerType of categoryTypes) {
    // Look up threshold: breed-specific first, then default
    let threshold = breedThresholds?.[staggerType] ?? defaultThresholds[staggerType];

    if (threshold == null || threshold < 0) {
      // -1 or missing = immune to this stagger type
      continue;
    }

    // Source: stagger_calculation.lua:144
    // stagger_threshold = stagger_threshold * (stagger_resistance * stagger_resistance_modifier)
    // We don't model stagger_resistance_modifier from profiles (it's 1 for most cases)
    threshold = threshold * resistance;

    // Source: stagger_calculation.lua:146
    // chosen_stagger_threshold < stagger_threshold and stagger_threshold < stagger_strength
    if (chosenThreshold < threshold && threshold < strength) {
      chosenType = staggerType;
      chosenThreshold = threshold;
    }
  }

  return { tier: chosenType, threshold: chosenThreshold };
}

// ── Profile Resolution ───────────────────────────────────────────────

/**
 * Resolves a damage profile's power_distribution for a specific quality,
 * lerping any [min, max] arrays down to scalars.
 *
 * @param {object} profile - Raw damage profile from profiles.json
 * @param {number} quality - Weapon quality 0-1
 * @returns {object} Profile with scalar power_distribution.impact
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
 * Determines whether a weapon is ranged based on its slot or template name.
 */
function isWeaponRanged(weapon) {
  if (weapon.slot === "ranged") return true;
  if (weapon.slot === "melee") return false;
  return false;
}

// ── Action Category Map ──────────────────────────────────────────────

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

// ── Stagger Matrix ───────────────────────────────────────────────────

/**
 * Computes a full stagger matrix for all weapons in a build.
 *
 * For each weapon x action x breed x difficulty, computes the stagger tier
 * achieved. Follows the same iteration pattern as computeBreakpoints in
 * damage-calculator.mjs.
 *
 * @param {object} build - Canonical build JSON
 * @param {object} index - { entities: Map, edges: Array } from loadIndex()
 * @param {object} calcData - From loadCalculatorData()
 * @param {object} staggerSettings - From loadStaggerSettings()
 * @returns {object} Stagger matrix result
 */
export function computeStaggerMatrix(build, index, calcData, staggerSettings) {
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

  const staggerCategoriesUsed = new Set();
  const weaponResults = [];

  for (let slot = 0; slot < (build.weapons ?? []).length; slot++) {
    const weapon = build.weapons[slot];
    const entityId = weapon.name?.canonical_entity_id;
    if (!entityId || weapon.name?.resolution_status !== "resolved") continue;

    // Extract internal template name: shared.weapon.autogun_p1_m1 → autogun_p1_m1
    const templateName = entityId.split(".").pop();
    const actionMap = actionMapByTemplate.get(templateName);
    if (!actionMap) continue;

    const isRanged = isWeaponRanged(weapon);
    const distance = isRanged ? 20 : 0;

    // Compute dropoff scalar for ranged
    let dropoffScalar;
    if (isRanged) {
      const close = calcData.constants.ranged_close ?? 12.5;
      const far = calcData.constants.ranged_far ?? 30;
      dropoffScalar = clamp((distance - close) / (far - close), 0, 1);
    }

    const actionResults = [];

    for (const [actionType, profileIds] of Object.entries(actionMap.actions)) {
      for (const profileId of profileIds) {
        const rawProfile = profileMap.get(profileId);
        if (!rawProfile) continue;

        const staggerCategory = rawProfile.stagger_category;
        if (!staggerCategory) continue;

        staggerCategoriesUsed.add(staggerCategory);

        const profile = resolveProfileForQuality(rawProfile, quality);
        if (!profile.power_distribution) continue;

        const breedResults = [];

        for (const breed of breeds) {
          for (const diff of DIFFICULTIES) {
            // Get base armor type for the breed (torso hit zone)
            const hitZoneData = breed.hit_zones?.torso ?? {};
            const armorType = hitZoneData.armor_type ?? breed.base_armor_type;

            // Step 1: Compute raw stagger strength from impact power
            const rawStrength = computeRawStaggerStrength({
              profile,
              armorType,
              constants: calcData.constants,
              isRanged,
              dropoffScalar,
            });

            // Step 2: Resolve impact ADM
            const impactAdm = resolveImpactADM({
              profile: rawProfile, // Use raw profile for ADM lerping
              armorType,
              quality,
              isRanged,
              dropoffScalar,
            });

            // Step 3: Compute effective stagger strength
            const breedStagger = breed.stagger ?? {};
            const {
              effectiveStrength,
              staggerReduction,
              admApplied,
              blocked,
            } = computeEffectiveStaggerStrength({
              rawStrength,
              impactADM: impactAdm,
              breedStagger,
              isRanged,
            });

            // Step 4: Classify stagger tier
            const staggerResistance =
              breedStagger.stagger_resistance ??
              staggerSettings.default_stagger_resistance;

            const { tier, threshold } = classifyStaggerTier(
              effectiveStrength,
              breedStagger.stagger_thresholds,
              staggerCategory,
              staggerSettings,
              staggerResistance,
            );

            breedResults.push({
              breed_id: breed.id,
              difficulty: diff,
              stagger_strength: effectiveStrength,
              stagger_tier: tier,
              thresholds: breedStagger.stagger_thresholds ?? {},
              details: {
                raw_impact: rawStrength,
                effective_strength: effectiveStrength,
                impact_adm: admApplied,
                resistance_applied: staggerResistance,
                reduction_applied: staggerReduction,
                blocked,
              },
            });
          }
        }

        actionResults.push({
          type: actionType,
          profileId,
          stagger_category: staggerCategory,
          breeds: breedResults,
        });
      }
    }

    weaponResults.push({
      entityId,
      slot,
      actions: actionResults,
    });
  }

  return {
    weapons: weaponResults,
    metadata: {
      quality,
      stagger_categories_used: [...staggerCategoriesUsed],
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Extracts a per-weapon stagger summary for scoring.
 * For each weapon, picks the best stagger tier achieved per action category
 * at damnation difficulty across key breeds.
 *
 * @param {object} matrix - Output from computeStaggerMatrix
 * @param {string[]} [keyBreeds] - Breed IDs to summarize for
 * @returns {object[]} Array of weapon summaries
 */
export function summarizeStagger(
  matrix,
  keyBreeds = ["renegade_berzerker", "chaos_ogryn_bulwark", "chaos_poxwalker"],
) {
  const STAGGER_RANK = {
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

  return matrix.weapons.map((weapon) => {
    const summary = {};

    for (const action of weapon.actions) {
      const category = ACTION_CATEGORY[action.type] ?? null;
      if (!category || category === "push") continue;

      const damnationEntries = action.breeds.filter(
        (b) => b.difficulty === "damnation" && keyBreeds.includes(b.breed_id),
      );

      const perBreed = {};
      for (const entry of damnationEntries) {
        perBreed[entry.breed_id] = {
          tier: entry.stagger_tier,
          strength: entry.stagger_strength,
        };
      }

      // Compute average stagger rank across key breeds
      const avgRank =
        damnationEntries.reduce(
          (sum, e) => sum + (STAGGER_RANK[e.stagger_tier] ?? 0),
          0,
        ) / Math.max(damnationEntries.length, 1);

      const candidate = {
        actionType: action.type,
        profileId: action.profileId,
        stagger_category: action.stagger_category,
        damnation: perBreed,
        _avgRank: avgRank,
      };

      if (!summary[category] || avgRank > summary[category]._avgRank) {
        summary[category] = candidate;
      }
    }

    // Strip internal _avgRank from output
    const clean = (entry) => {
      if (!entry) return null;
      const { _avgRank, ...rest } = entry;
      return rest;
    };

    return {
      entityId: weapon.entityId,
      slot: weapon.slot,
      bestLight: clean(summary.light),
      bestHeavy: clean(summary.heavy),
      bestSpecial: clean(summary.special),
    };
  });
}
