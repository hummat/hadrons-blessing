/**
 * Stagger calculator engine -- computes stagger results for every weapon action
 * in a build, determining what stagger tier each action achieves against each breed.
 *
 * Direct port of Darktide's stagger_calculation.lua.
 * Reuses powerLevelToDamage from damage-calculator for impact power scaling.
 *
 * Source: scripts/utilities/attack/stagger_calculation.lua
 *         scripts/settings/damage/stagger_settings.lua
 *         scripts/settings/damage/power_level_settings.lua
 */

import { readFileSync } from "node:fs";
import { GENERATED_ROOT } from "./paths.js";
import { join } from "node:path";
import {
  powerLevelToDamage,
  assembleBuildBuffStack,
  loadCalculatorData,
  adaptBreed,
} from "./damage-calculator.js";

// -- Types --------------------------------------------------------------------

interface StaggerSettings {
  stagger_categories: Record<string, string[]>;
  default_stagger_thresholds: Record<string, number>;
  default_stagger_resistance: number;
}

interface DamageProfile {
  power_distribution?: { attack?: number; impact?: number | null };
  power_distribution_ranged?: { impact?: { near?: number; far?: number } };
  armor_damage_modifier?: { impact?: Record<string, unknown> };
  armor_damage_modifier_ranged?: {
    near?: { impact?: Record<string, unknown> };
    far?: { impact?: Record<string, unknown> };
  };
  stagger_category?: string;
  [key: string]: unknown;
}

interface CalculatorConstants {
  default_power_level: number;
  ranged_close?: number;
  ranged_far?: number;
  [key: string]: unknown;
}

interface BreedStagger {
  stagger_reduction?: number;
  stagger_reduction_ranged?: number;
  stagger_resistance?: number;
  stagger_thresholds?: Record<string, number>;
}

interface BreedData {
  id: string;
  hit_zones?: Record<string, { armor_type?: string }>;
  base_armor_type?: string;
  stagger?: BreedStagger;
  [key: string]: unknown;
}

interface ActionMap {
  weapon_template: string;
  actions: Record<string, string[]>;
}

interface CalculatorData {
  profiles: Array<DamageProfile & { id: string }>;
  actionMaps: ActionMap[];
  constants: CalculatorConstants;
  breeds: BreedData[];
}

export interface EffectiveStaggerResult {
  effectiveStrength: number;
  staggerReduction: number;
  admApplied: number;
  blocked: boolean;
}

export interface StaggerTierResult {
  tier: string | null;
  threshold: number;
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// -- Data Loading -------------------------------------------------------------

/**
 * Loads stagger-settings.json from the generated data directory.
 */
export function loadStaggerSettings(): StaggerSettings {
  return JSON.parse(readFileSync(join(GENERATED_ROOT, "stagger-settings.json"), "utf-8")) as StaggerSettings;
}

// -- Impact Power -------------------------------------------------------------

export interface RawStaggerStrengthParams {
  profile: DamageProfile;
  armorType: string;
  constants: CalculatorConstants;
  isRanged: boolean;
  dropoffScalar?: number;
}

/**
 * Computes the raw stagger strength from a damage profile's impact power
 * distribution, analogous to powerLevelToDamage but for the impact channel.
 *
 * Source: _calculate_stagger_strength (stagger_calculation.lua:67-93)
 */
export function computeRawStaggerStrength({
  profile,
  armorType,
  constants,
  isRanged,
  dropoffScalar,
}: RawStaggerStrengthParams): number {
  const pd = profile.power_distribution;
  if (!pd || pd.impact == null) return 0;

  const impactPd = { attack: pd.impact as number };

  let impactPdRanged: { attack: { near: number; far: number } } | undefined;
  if (isRanged && profile.power_distribution_ranged) {
    impactPdRanged = {
      attack: {
        near: profile.power_distribution_ranged.impact?.near ?? (pd.impact as number),
        far: profile.power_distribution_ranged.impact?.far ?? (pd.impact as number),
      },
    };
  }

  return powerLevelToDamage({
    powerLevel: constants.default_power_level,
    powerDistribution: impactPd,
    powerDistributionRanged: impactPdRanged,
    armorType,
    constants: constants as never,
    isRanged,
    dropoffScalar,
  });
}

// -- Impact ADM ---------------------------------------------------------------

export interface ImpactADMParams {
  profile: DamageProfile;
  armorType: string;
  quality: number;
  isRanged: boolean;
  dropoffScalar?: number;
}

/**
 * Resolves the impact armor damage modifier for a profile and armor type.
 *
 * Source: DamageProfile.armor_damage_modifier("impact", ...)
 *         in stagger_calculation.lua:27
 */
export function resolveImpactADM({
  profile,
  armorType,
  quality,
  isRanged,
  dropoffScalar,
}: ImpactADMParams): number {
  if (isRanged && profile.armor_damage_modifier_ranged) {
    const ranged = profile.armor_damage_modifier_ranged;
    const nearEntry = (ranged.near?.impact as Record<string, unknown> | undefined)?.[armorType] as number | number[] | null | undefined;
    const farEntry = (ranged.far?.impact as Record<string, unknown> | undefined)?.[armorType] as number | number[] | null | undefined;

    if (nearEntry == null && farEntry == null) return 1;

    const nearADM = lerpADMEntry(nearEntry, quality);
    const farADM = lerpADMEntry(farEntry, quality);

    if (dropoffScalar != null) {
      return lerp(nearADM, farADM, Math.sqrt(dropoffScalar));
    }
    return nearADM;
  }

  // Melee: use armor_damage_modifier.impact
  const impactAdm = profile.armor_damage_modifier?.impact as Record<string, unknown> | undefined;
  if (!impactAdm) return 1;

  const entry = impactAdm[armorType] as number | number[] | null | undefined;
  return lerpADMEntry(entry, quality);
}

/**
 * Lerps an ADM entry (scalar or [min, max] array) by quality.
 */
function lerpADMEntry(entry: number | number[] | null | undefined, quality: number): number {
  if (entry == null) return 1;
  if (Array.isArray(entry)) {
    return entry[0] + (entry[1] - entry[0]) * quality;
  }
  return entry;
}

// -- Effective Stagger Strength -----------------------------------------------

export interface EffectiveStaggerParams {
  rawStrength: number;
  impactADM: number;
  breedStagger: BreedStagger;
  isRanged: boolean;
}

/**
 * Computes the effective stagger strength after applying ADM, stagger
 * resistance, and stagger reduction from the breed.
 *
 * Source: stagger_calculation.lua:25-36
 */
export function computeEffectiveStaggerStrength({
  rawStrength,
  impactADM,
  breedStagger,
  isRanged,
}: EffectiveStaggerParams): EffectiveStaggerResult {
  const adm = impactADM ?? 1;
  const staggerReduction = isRanged
    ? (breedStagger.stagger_reduction_ranged ?? breedStagger.stagger_reduction ?? 0)
    : (breedStagger.stagger_reduction ?? 0);

  const strengthAfterAdm = rawStrength * adm;
  if (staggerReduction > strengthAfterAdm) {
    return {
      effectiveStrength: 0,
      staggerReduction,
      admApplied: adm,
      blocked: true,
    };
  }

  const effectiveStrength = strengthAfterAdm - 0.5 * staggerReduction;

  return {
    effectiveStrength: Math.max(0, effectiveStrength),
    staggerReduction,
    admApplied: adm,
    blocked: false,
  };
}

// -- Stagger Tier Classification ----------------------------------------------

/**
 * Determines the highest stagger tier achieved given effective stagger
 * strength, breed thresholds, category, and stagger resistance.
 *
 * Source: _get_stagger_type (stagger_calculation.lua:127-159)
 */
export function classifyStaggerTier(
  strength: number,
  breedThresholds: Record<string, number> | undefined,
  category: string,
  staggerSettings: StaggerSettings,
  staggerResistance?: number,
): StaggerTierResult {
  const categoryTypes = staggerSettings.stagger_categories[category];
  if (!categoryTypes || categoryTypes.length === 0) {
    return { tier: null, threshold: 0 };
  }

  const defaultThresholds = staggerSettings.default_stagger_thresholds;
  const resistance = staggerResistance ?? staggerSettings.default_stagger_resistance ?? 1;

  let chosenType: string | null = null;
  let chosenThreshold = 0;

  for (const staggerType of categoryTypes) {
    let threshold = breedThresholds?.[staggerType] ?? defaultThresholds[staggerType];

    if (threshold == null || threshold < 0) {
      continue;
    }

    threshold = threshold * resistance;

    if (chosenThreshold < threshold && threshold < strength) {
      chosenType = staggerType;
      chosenThreshold = threshold;
    }
  }

  return { tier: chosenType, threshold: chosenThreshold };
}

// -- Profile Resolution -------------------------------------------------------

function resolveProfileForQuality(profile: DamageProfile, quality: number): DamageProfile {
  const pd = profile.power_distribution;
  if (!pd) return profile;

  const resolved = { ...pd };
  if (Array.isArray(pd.attack)) {
    resolved.attack = pd.attack[0] + (pd.attack[1] - pd.attack[0]) * quality;
  }
  if (Array.isArray(pd.impact)) {
    resolved.impact = (pd.impact as number[])[0] + ((pd.impact as number[])[1] - (pd.impact as number[])[0]) * quality;
  }

  return { ...profile, power_distribution: resolved };
}

function isWeaponRanged(weapon: BuildWeapon): boolean {
  if (weapon.slot === "ranged") return true;
  if (weapon.slot === "melee") return false;
  return false;
}

// -- Action Category Map ------------------------------------------------------

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

// -- Stagger Matrix -----------------------------------------------------------

/**
 * Computes a full stagger matrix for all weapons in a build.
 */
export function computeStaggerMatrix(
  build: Build,
  index: EntityIndex,
  calcData: CalculatorData,
  staggerSettings: StaggerSettings,
): unknown {
  const quality = 0.8;

  const profileMap = new Map<string, DamageProfile & { id: string }>();
  for (const p of calcData.profiles) {
    profileMap.set(p.id, p);
  }

  const actionMapByTemplate = new Map<string, ActionMap>();
  for (const am of calcData.actionMaps) {
    actionMapByTemplate.set(am.weapon_template, am);
  }

  const breeds = calcData.breeds.map((b) => adaptBreed(b as never)) as BreedData[];

  const staggerCategoriesUsed = new Set<string>();
  const weaponResults: unknown[] = [];

  for (let slot = 0; slot < (build.weapons ?? []).length; slot++) {
    const weapon = build.weapons![slot];
    const entityId = weapon.name?.canonical_entity_id;
    if (!entityId || weapon.name?.resolution_status !== "resolved") continue;

    const templateName = entityId.split(".").pop()!;
    const actionMap = actionMapByTemplate.get(templateName);
    if (!actionMap) continue;

    const isRanged = isWeaponRanged(weapon);
    const distance = isRanged ? 20 : 0;

    let dropoffScalar: number | undefined;
    if (isRanged) {
      const close = calcData.constants.ranged_close ?? 12.5;
      const far = calcData.constants.ranged_far ?? 30;
      dropoffScalar = clamp((distance - close) / (far - close), 0, 1);
    }

    const actionResults: unknown[] = [];

    for (const [actionType, profileIds] of Object.entries(actionMap.actions)) {
      for (const profileId of profileIds) {
        const rawProfile = profileMap.get(profileId);
        if (!rawProfile) continue;

        const staggerCategory = rawProfile.stagger_category;
        if (!staggerCategory) continue;

        staggerCategoriesUsed.add(staggerCategory);

        const profile = resolveProfileForQuality(rawProfile, quality);
        if (!profile.power_distribution) continue;

        const breedResults: unknown[] = [];

        for (const breed of breeds) {
          for (const diff of DIFFICULTIES) {
            const hitZoneData = breed.hit_zones?.torso as { armor_type?: string } | undefined ?? {};
            const armorType = hitZoneData.armor_type ?? breed.base_armor_type ?? "unarmored";

            const rawStrength = computeRawStaggerStrength({
              profile,
              armorType,
              constants: calcData.constants,
              isRanged,
              dropoffScalar,
            });

            const impactAdm = resolveImpactADM({
              profile: rawProfile,
              armorType,
              quality,
              isRanged,
              dropoffScalar,
            });

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
 */
export function summarizeStagger(
  matrix: { weapons: Array<{ entityId: string; slot: number; actions: Array<{ type: string; profileId: string; stagger_category: string; breeds: Array<{ breed_id: string; difficulty: string; stagger_tier: string | null; stagger_strength: number }> }> }> },
  keyBreeds: string[] = ["renegade_berzerker", "chaos_ogryn_bulwark", "chaos_poxwalker"],
): unknown[] {
  const STAGGER_RANK: Record<string, number> = {
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
    const summary: Record<string, { actionType: string; profileId: string; stagger_category: string; damnation: Record<string, { tier: string | null; strength: number }>; _avgRank: number }> = {};

    for (const action of weapon.actions) {
      const category = ACTION_CATEGORY[action.type] ?? null;
      if (!category || category === "push") continue;

      const damnationEntries = action.breeds.filter(
        (b) => b.difficulty === "damnation" && keyBreeds.includes(b.breed_id),
      );

      const perBreed: Record<string, { tier: string | null; strength: number }> = {};
      for (const entry of damnationEntries) {
        perBreed[entry.breed_id] = {
          tier: entry.stagger_tier,
          strength: entry.stagger_strength,
        };
      }

      const avgRank =
        damnationEntries.reduce(
          (sum, e) => sum + (STAGGER_RANK[String(e.stagger_tier)] ?? 0),
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
    const clean = (entry: typeof summary[string] | undefined): unknown => {
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
