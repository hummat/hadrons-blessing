// @ts-check
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  powerLevelToDamage,
  calculateDamageBuff,
  resolveArmorDamageModifier,
  calculateRending,
  calculateFinesseBoost,
  calculatePositional,
  hitZoneDamageMultiplier,
  applyArmorTypeBuffs,
  boostCurveMultiplier,
  applyDiminishingReturns,
  classifyDamageEfficiency,
  computeHit,
  assembleBuildBuffStack,
  loadCalculatorData,
  computeBreakpoints,
  summarizeBreakpoints,
} from "./ground-truth/lib/damage-calculator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------- helpers ----------
const approx = (actual, expected, tol = 0.001) =>
  assert.ok(
    Math.abs(actual - expected) < tol,
    `expected ≈${expected}, got ${actual} (tol ${tol})`,
  );

// ---------- boostCurveMultiplier ----------
describe("boostCurveMultiplier", () => {
  const curve = [0, 0.3, 0.6, 0.8, 1];

  it("returns 0 at 0%", () => {
    assert.equal(boostCurveMultiplier(curve, 0), 0);
  });

  it("returns last value at 100%", () => {
    assert.equal(boostCurveMultiplier(curve, 1), 1);
  });

  it("returns exact point at 25%", () => {
    // 25% → index 1 → curve[1] = 0.3
    approx(boostCurveMultiplier(curve, 0.25), 0.3);
  });

  it("interpolates at 50%", () => {
    // 50% → index 2 → curve[2] = 0.6
    approx(boostCurveMultiplier(curve, 0.5), 0.6);
  });

  it("interpolates between points at 12.5%", () => {
    // 12.5% → scaledIndex = 0.5, lerp(curve[0], curve[1], 0.5) = lerp(0, 0.3, 0.5) = 0.15
    approx(boostCurveMultiplier(curve, 0.125), 0.15);
  });

  it("interpolates between points at 37.5%", () => {
    // 37.5% → scaledIndex = 1.5, lerp(curve[1], curve[2], 0.5) = lerp(0.3, 0.6, 0.5) = 0.45
    approx(boostCurveMultiplier(curve, 0.375), 0.45);
  });

  it("handles 2-point curve", () => {
    approx(boostCurveMultiplier([0, 1], 0.5), 0.5);
  });

  it("handles single-point curve at 0%", () => {
    assert.equal(boostCurveMultiplier([5], 0), 5);
  });
});

// ---------- Stage 1: powerLevelToDamage ----------
describe("stage 1: powerLevelToDamage", () => {
  // Source constants: MIN_POWER_LEVEL=0, MAX_POWER_LEVEL=10000
  // damage_output[armorType] = { min: 0, max: 20 } for all armor types
  // percentage = clamp(attack_power_level, 0, 10000) / 10000
  // base_damage = min + (max - min) * percentage

  const constants = {
    default_power_level: 500,
    min_power_level: 0,
    max_power_level: 10000,
    damage_output: {
      unarmored: { min: 0, max: 20 },
      armored: { min: 0, max: 20 },
    },
  };

  it("computes base damage for melee with power_distribution.attack=100", () => {
    // power_level=500, attack=100 (raw multiplier)
    // attack_power_level = 500 * 100 = 50000
    // percentage = clamp(50000, 0, 10000) / 10000 = 1.0 (capped)
    // damage = 0 + 20 * 1.0 = 20
    const result = powerLevelToDamage({
      powerLevel: 500,
      powerDistribution: { attack: 100 },
      armorType: "armored",
      constants,
    });
    approx(result, 20);
  });

  it("computes with small power distribution", () => {
    // power_level=500, attack=0.05
    // In source: if !dropoff_scalar && multiplier > 0 && < 2 → multiplier *= 250
    // So effective: 0.05 * 250 = 12.5, attack_power_level = 500 * 12.5 = 6250
    // percentage = 6250 / 10000 = 0.625
    // damage = 20 * 0.625 = 12.5
    const result = powerLevelToDamage({
      powerLevel: 500,
      powerDistribution: { attack: 0.05 },
      armorType: "unarmored",
      constants,
      isRanged: false,
    });
    approx(result, 12.5);
  });

  it("uses default power level when not specified", () => {
    const result = powerLevelToDamage({
      powerDistribution: { attack: 100 },
      armorType: "unarmored",
      constants,
    });
    approx(result, 20); // same as PL=500 default
  });

  it("caps percentage at 1 for huge attack power levels", () => {
    // attack=300, PL=500 → attack_pl = 150000, percentage = capped at 1
    // damage = 20
    const result = powerLevelToDamage({
      powerLevel: 500,
      powerDistribution: { attack: 300 },
      armorType: "armored",
      constants,
    });
    approx(result, 20);
  });

  it("returns 0 with attack=0", () => {
    const result = powerLevelToDamage({
      powerLevel: 500,
      powerDistribution: { attack: 0 },
      armorType: "armored",
      constants,
    });
    assert.equal(result, 0);
  });

  it("handles ranged with dropoff (near/far power distribution)", () => {
    // For ranged: power_distribution_ranged.attack = { near, far }
    // dropoff_scalar already computed externally
    // power_multiplier = lerp(near, far, sqrt(dropoff_scalar))
    // No <2 scaling for ranged (has dropoff_scalar)
    const result = powerLevelToDamage({
      powerLevel: 500,
      powerDistribution: { attack: 100 },
      powerDistributionRanged: { attack: { near: 0.8, far: 0.3 } },
      armorType: "unarmored",
      constants,
      isRanged: true,
      dropoffScalar: 0.25,
    });
    // sqrt(0.25) = 0.5, power_mult = lerp(0.8, 0.3, 0.5) = 0.55
    // attack_pl = 500 * 0.55 = 275, pct = 275/10000 = 0.0275
    // damage = 20 * 0.0275 = 0.55
    approx(result, 0.55);
  });
});

// ---------- Stage 2: calculateDamageBuff ----------
describe("stage 2: calculateDamageBuff", () => {
  it("applies additive and multiplicative buffs", () => {
    // Source formula: base_damage * (additive_sum * multiplicative_product * target_modifier) - base_damage + base_damage
    // = base_damage * additive_sum * multiplicative_product * target_modifier
    const result = calculateDamageBuff({
      baseDamage: 10,
      buffStack: {
        additive_sum: 1.3,
        multiplicative_product: 1.1,
        target_modifier: 1.0,
      },
    });
    // 10 * 1.3 * 1.1 * 1.0 = 14.3
    approx(result, 14.3);
  });

  it("returns base damage with empty buff stack", () => {
    const result = calculateDamageBuff({ baseDamage: 10, buffStack: {} });
    assert.equal(result, 10);
  });

  it("returns base damage with all defaults", () => {
    const result = calculateDamageBuff({
      baseDamage: 7.5,
      buffStack: { additive_sum: 1.0, multiplicative_product: 1.0, target_modifier: 1.0 },
    });
    approx(result, 7.5);
  });

  it("handles target modifier reducing damage", () => {
    const result = calculateDamageBuff({
      baseDamage: 10,
      buffStack: { additive_sum: 1.0, multiplicative_product: 1.0, target_modifier: 0.5 },
    });
    approx(result, 5.0);
  });

  it("returns separate base and buff components", () => {
    // The source computes: buff_damage = base * (stat_buffs * mult * target - 1)
    // total = base + buff_damage = base * stat_buffs * mult * target
    const result = calculateDamageBuff({
      baseDamage: 10,
      buffStack: { additive_sum: 1.5, multiplicative_product: 1.0, target_modifier: 1.0 },
    });
    approx(result, 15.0);
  });
});

// ---------- Stage 3: resolveArmorDamageModifier ----------
describe("stage 3: resolveArmorDamageModifier", () => {
  it("applies melee ADM with quality lerp (table entry)", () => {
    // ADM is a [min, max] table → lerp by quality
    const adm = resolveArmorDamageModifier({
      profile: { armor_damage_modifier: { attack: { armored: [0.5, 0.8] } } },
      armorType: "armored",
      quality: 0.8,
      isRanged: false,
    });
    // lerp(0.5, 0.8, 0.8) = 0.5 + 0.3*0.8 = 0.74
    approx(adm, 0.74);
  });

  it("returns scalar ADM directly (no lerp)", () => {
    const adm = resolveArmorDamageModifier({
      profile: { armor_damage_modifier: { attack: { unarmored: 1.5 } } },
      armorType: "unarmored",
      quality: 0.5,
      isRanged: false,
    });
    approx(adm, 1.5);
  });

  it("lerps ranged ADM by linear distance-based dropoff", () => {
    const adm = resolveArmorDamageModifier({
      profile: {
        armor_damage_modifier_ranged: {
          near: { attack: { armored: [0.5, 0.8] } },
          far: { attack: { armored: [0.2, 0.4] } },
        },
      },
      armorType: "armored",
      quality: 1.0,
      isRanged: true,
      distance: 16.875, // dropoff = (16.875 - 12.5) / (30 - 12.5) = 0.25
      constants: { ranged_close: 12.5, ranged_far: 30 },
    });
    // near_adm = lerp(0.5, 0.8, 1.0) = 0.8
    // far_adm = lerp(0.2, 0.4, 1.0) = 0.4
    // Source: damage_profile.lua:190 — ADM uses linear lerp (not sqrt)
    // ADM = lerp(0.8, 0.4, 0.25) = 0.8 + (0.4 - 0.8) * 0.25 = 0.7
    approx(adm, 0.7);
  });

  it("returns near ADM at close distance", () => {
    const adm = resolveArmorDamageModifier({
      profile: {
        armor_damage_modifier_ranged: {
          near: { attack: { armored: 0.8 } },
          far: { attack: { armored: 0.3 } },
        },
      },
      armorType: "armored",
      quality: 0.5,
      isRanged: true,
      distance: 5, // below ranged_close (12.5), clamps to dropoff=0
      constants: { ranged_close: 12.5, ranged_far: 30 },
    });
    // sqrt(0) = 0, lerp(0.8, 0.3, 0) = 0.8
    approx(adm, 0.8);
  });

  it("returns far ADM at max distance", () => {
    const adm = resolveArmorDamageModifier({
      profile: {
        armor_damage_modifier_ranged: {
          near: { attack: { armored: 0.8 } },
          far: { attack: { armored: 0.3 } },
        },
      },
      armorType: "armored",
      quality: 0.5,
      isRanged: true,
      distance: 30, // at ranged_far, dropoff=1.0
      constants: { ranged_close: 12.5, ranged_far: 30 },
    });
    // sqrt(1) = 1, lerp(0.8, 0.3, 1) = 0.3
    approx(adm, 0.3);
  });

  it("falls back to default ADM when profile lacks entry", () => {
    const adm = resolveArmorDamageModifier({
      profile: {},
      armorType: "armored",
      quality: 0.5,
      isRanged: false,
      defaultADM: { attack: { armored: [0.6, 1.0] } },
    });
    // lerp(0.6, 1.0, 0.5) = 0.8
    approx(adm, 0.8);
  });
});

// ---------- Stage 4: calculateRending ----------
describe("stage 4: calculateRending", () => {
  const armoredConstants = {
    rending_armor_type_multiplier: { armored: 1 },
    overdamage_rending_multiplier: { armored: 0.25 },
  };

  it("applies rending below ADM=1 (no overdamage)", () => {
    // adm=0.5, rending=0.3
    // rending_mult = 0.3 * 1 = 0.3
    // adm_lost = max(1 - 0.5, 0) = 0.5
    // 0.5 > 0.3 → rended_adm = 0.5 + 0.3 = 0.8
    const result = calculateRending({
      rendingSources: 0.3,
      armorDamageModifier: 0.5,
      armorType: "armored",
      constants: armoredConstants,
    });
    approx(result.rendedADM, 0.8);
  });

  it("applies overdamage when rending exceeds ADM loss", () => {
    // adm=0.7, rending=0.5
    // rending_mult = 0.5
    // adm_lost = 0.3
    // adm_lost(0.3) < rending(0.5) → rended = 1 + (0.5 - 0.3) * 0.25 = 1.05
    const result = calculateRending({
      rendingSources: 0.5,
      armorDamageModifier: 0.7,
      armorType: "armored",
      constants: armoredConstants,
    });
    approx(result.rendedADM, 1.05);
  });

  it("applies overdamage when ADM already >= 1", () => {
    // adm=1.2, rending=0.3
    // adm >= 1 → rended = 1.2 + 0.3 * 0.25 = 1.275
    const result = calculateRending({
      rendingSources: 0.3,
      armorDamageModifier: 1.2,
      armorType: "armored",
      constants: armoredConstants,
    });
    approx(result.rendedADM, 1.275);
  });

  it("returns unchanged ADM on unarmored", () => {
    const result = calculateRending({
      rendingSources: 0.5,
      armorDamageModifier: 1.0,
      armorType: "unarmored",
      constants: {
        rending_armor_type_multiplier: { unarmored: 0 },
        overdamage_rending_multiplier: { unarmored: 0 },
      },
    });
    approx(result.rendedADM, 1.0);
  });

  it("caps rending sources (input already capped at 1)", () => {
    // Even with rendingSources=1.0 (max from source), the formula works
    // adm=0.3, rending=1.0 → adm_lost=0.7 < 1.0 → rended = 1 + (1.0 - 0.7) * 0.25 = 1.075
    const result = calculateRending({
      rendingSources: 1.0,
      armorDamageModifier: 0.3,
      armorType: "armored",
      constants: armoredConstants,
    });
    approx(result.rendedADM, 1.075);
  });

  it("handles zero rending", () => {
    const result = calculateRending({
      rendingSources: 0,
      armorDamageModifier: 0.5,
      armorType: "armored",
      constants: armoredConstants,
    });
    approx(result.rendedADM, 0.5);
  });
});

// ---------- Stage 5: calculateFinesseBoost ----------
describe("stage 5: calculateFinesseBoost", () => {
  const defaultCurve = [0, 0.3, 0.6, 0.8, 1];
  const defaultConstants = {
    default_finesse_boost_amount: { unarmored: 0.5, armored: 0.5, super_armor: 0.5 },
    default_crit_boost_amount: 0.5,
    boost_curves: { default: defaultCurve },
  };

  it("returns 1 when no crit and no weakspot", () => {
    const result = calculateFinesseBoost({
      isCrit: false,
      isWeakspot: false,
      armorType: "armored",
      constants: defaultConstants,
    });
    approx(result, 1.0);
  });

  it("applies weakspot boost only", () => {
    // finesse_amount = 0.5 (default weakspot)
    // boost = boostCurve(default, 0.5) = 0.6
    // result = 1 + 0.6 = 1.6
    const result = calculateFinesseBoost({
      isCrit: false,
      isWeakspot: true,
      armorType: "armored",
      constants: defaultConstants,
    });
    approx(result, 1.6);
  });

  it("applies crit boost only", () => {
    // finesse_amount = 0.5 (default crit)
    // boost = boostCurve(default, 0.5) = 0.6
    // result = 1 + 0.6 = 1.6
    const result = calculateFinesseBoost({
      isCrit: true,
      isWeakspot: false,
      armorType: "armored",
      constants: defaultConstants,
    });
    approx(result, 1.6);
  });

  it("stacks weakspot + crit (capped at 1)", () => {
    // finesse_amount = 0.5 + 0.5 = 1.0, clamped to 1.0
    // boost = boostCurve(default, 1.0) = 1.0
    // result = 1 + 1.0 = 2.0
    const result = calculateFinesseBoost({
      isCrit: true,
      isWeakspot: true,
      armorType: "armored",
      constants: defaultConstants,
    });
    approx(result, 2.0);
  });

  it("uses profile-specific finesse_boost table", () => {
    // Profile overrides weakspot boost to 0.75 for armored
    // finesse_amount = 0.75, boost = boostCurve(default, 0.75) = 0.8
    // result = 1 + 0.8 = 1.8
    const result = calculateFinesseBoost({
      isCrit: false,
      isWeakspot: true,
      armorType: "armored",
      constants: defaultConstants,
      profileFinesseBoost: { armored: 0.75 },
    });
    approx(result, 1.8);
  });

  it("uses profile-specific boost curve", () => {
    // Custom curve: linear [0, 1]
    // weakspot finesse = 0.5, boost = boostCurve([0, 1], 0.5) = 0.5
    // result = 1 + 0.5 = 1.5
    const result = calculateFinesseBoost({
      isCrit: false,
      isWeakspot: true,
      armorType: "armored",
      constants: defaultConstants,
      profileBoostCurve: [0, 1],
    });
    approx(result, 1.5);
  });

  it("uses profile-specific crit_boost amount", () => {
    // Override crit boost to 0.3
    // finesse = 0.3, boost = boostCurve(default, 0.3) ≈ lerp between 0.3 and 0.6 at t=0.2
    // scaledIdx = 0.3 * 4 = 1.2, lerp(0.3, 0.6, 0.2) = 0.36
    // result = 1 + 0.36 = 1.36
    const result = calculateFinesseBoost({
      isCrit: true,
      isWeakspot: false,
      armorType: "armored",
      constants: defaultConstants,
      profileCritBoost: 0.3,
    });
    approx(result, 1.36);
  });
});

// ---------- Stage 6: calculatePositional ----------
describe("stage 6: calculatePositional", () => {
  it("returns unchanged damage with no positional flags", () => {
    const result = calculatePositional({
      damage: 100,
      isBackstab: false,
      isFlanking: false,
      buffStack: {},
    });
    approx(result, 100);
  });

  it("applies backstab bonus", () => {
    // Source: backstab_damage_buff = stat_buffs.backstab_damage or 1
    // backstab_damage = damage * (backstab_damage_buff - 1)
    // So if backstab_damage = 1.2, bonus = damage * 0.2
    const result = calculatePositional({
      damage: 100,
      isBackstab: true,
      isFlanking: false,
      buffStack: { backstab_damage: 1.2 },
    });
    approx(result, 120);
  });

  it("applies flanking bonus", () => {
    // flanking_damage_buff = stat_buffs.flanking_damage or 1
    // flanking_damage = damage * (flanking_damage_buff - 1)
    const result = calculatePositional({
      damage: 100,
      isBackstab: false,
      isFlanking: true,
      buffStack: { flanking_damage: 1.15 },
    });
    approx(result, 115);
  });

  it("stacks backstab and flanking", () => {
    // backstab_damage = 100 * (1.2 - 1) = 20
    // flanking_damage = 100 * (1.15 - 1) = 15
    // total = 100 + 20 + 15 = 135
    const result = calculatePositional({
      damage: 100,
      isBackstab: true,
      isFlanking: true,
      buffStack: { backstab_damage: 1.2, flanking_damage: 1.15 },
    });
    approx(result, 135);
  });

  it("applies backstab_bonus from damage profile", () => {
    // Source also has: backstab_bonus = is_backstab and damage_profile.backstab_bonus or 0
    // multiplier = backstab_damage_buff + backstab_bonus
    // backstab_damage = damage * (multiplier - 1)
    const result = calculatePositional({
      damage: 100,
      isBackstab: true,
      isFlanking: false,
      buffStack: { backstab_damage: 1.2 },
      backstabBonus: 0.1,
    });
    // multiplier = 1.2 + 0.1 = 1.3, backstab_dmg = 100 * 0.3 = 30, total = 130
    approx(result, 130);
  });

  it("returns base damage when backstab=true but no buff", () => {
    // backstab_damage defaults to 1, so bonus = 0
    const result = calculatePositional({
      damage: 100,
      isBackstab: true,
      isFlanking: false,
      buffStack: {},
    });
    approx(result, 100);
  });
});

// ---------- Stage 7: hitZoneDamageMultiplier ----------
describe("stage 7: hitZoneDamageMultiplier", () => {
  it("returns multiplier from breed hitzone data", () => {
    const mult = hitZoneDamageMultiplier({
      breed: {
        hitzone_damage_multiplier: {
          melee: { head: 2.0, body: 1.0 },
        },
      },
      hitZone: "head",
      attackType: "melee",
    });
    approx(mult, 2.0);
  });

  it("returns 1.0 for unknown hitzone", () => {
    const mult = hitZoneDamageMultiplier({
      breed: {
        hitzone_damage_multiplier: {
          melee: { head: 2.0 },
        },
      },
      hitZone: "left_arm",
      attackType: "melee",
    });
    approx(mult, 1.0);
  });

  it("returns 1.0 when breed has no hitzone data", () => {
    const mult = hitZoneDamageMultiplier({
      breed: {},
      hitZone: "head",
      attackType: "melee",
    });
    approx(mult, 1.0);
  });

  it("returns 1.0 when no breed", () => {
    const mult = hitZoneDamageMultiplier({
      breed: null,
      hitZone: "head",
      attackType: "melee",
    });
    approx(mult, 1.0);
  });

  it("falls back to default attack type multipliers", () => {
    const mult = hitZoneDamageMultiplier({
      breed: {
        hitzone_damage_multiplier: {
          default: { head: 1.5, body: 1.0 },
        },
      },
      hitZone: "head",
      attackType: "ranged",
    });
    approx(mult, 1.5);
  });

  it("falls back from attack-type multiplier to default for missing hitzone", () => {
    // attack type exists but hitzone not found → try default map
    const mult = hitZoneDamageMultiplier({
      breed: {
        hitzone_damage_multiplier: {
          melee: { head: 2.0 },
          default: { left_arm: 0.8 },
        },
      },
      hitZone: "left_arm",
      attackType: "melee",
    });
    approx(mult, 0.8);
  });
});

// ---------- Stage 8: applyArmorTypeBuffs ----------
describe("stage 8: applyArmorTypeBuffs", () => {
  it("applies armored_damage buff", () => {
    const result = applyArmorTypeBuffs({
      damage: 100,
      armorType: "armored",
      buffStack: { armored_damage: 1.25 },
    });
    approx(result, 125);
  });

  it("applies unarmored_damage buff", () => {
    const result = applyArmorTypeBuffs({
      damage: 80,
      armorType: "unarmored",
      buffStack: { unarmored_damage: 1.1 },
    });
    approx(result, 88);
  });

  it("applies super_armor_damage buff", () => {
    const result = applyArmorTypeBuffs({
      damage: 50,
      armorType: "super_armor",
      buffStack: { super_armor_damage: 1.3 },
    });
    approx(result, 65);
  });

  it("returns unchanged damage when no buff for armor type", () => {
    const result = applyArmorTypeBuffs({
      damage: 100,
      armorType: "armored",
      buffStack: {},
    });
    approx(result, 100);
  });

  it("applies resistant_damage buff", () => {
    const result = applyArmorTypeBuffs({
      damage: 100,
      armorType: "resistant",
      buffStack: { resistant_damage: 0.9 },
    });
    approx(result, 90);
  });

  it("applies berserker_damage buff", () => {
    const result = applyArmorTypeBuffs({
      damage: 100,
      armorType: "berserker",
      buffStack: { berserker_damage: 1.15 },
    });
    approx(result, 115);
  });

  it("applies disgustingly_resilient_damage buff", () => {
    const result = applyArmorTypeBuffs({
      damage: 100,
      armorType: "disgustingly_resilient",
      buffStack: { disgustingly_resilient_damage: 1.2 },
    });
    approx(result, 120);
  });
});

// ---------- Stage 9: applyDiminishingReturns ----------
describe("stage 9: applyDiminishingReturns", () => {
  it("returns unmodified damage when breed has no diminishing returns", () => {
    const result = applyDiminishingReturns({
      damage: 100,
      breed: { id: "renegade_rifleman" },
      healthPercent: 0.5,
    });
    approx(result, 100);
  });

  it("applies easeInCubic scaling when breed has diminishing returns", () => {
    // easeInCubic(0.5) = 0.125
    // lerp(0, 100, 0.125) = 12.5
    const result = applyDiminishingReturns({
      damage: 100,
      breed: { id: "chaos_ogryn_executor", diminishing_returns_damage: true },
      healthPercent: 0.5,
    });
    approx(result, 12.5);
  });

  it("returns full damage at 100% health", () => {
    // easeInCubic(1.0) = 1.0
    // lerp(0, 100, 1.0) = 100
    const result = applyDiminishingReturns({
      damage: 100,
      breed: { id: "chaos_ogryn_executor", diminishing_returns_damage: true },
      healthPercent: 1.0,
    });
    approx(result, 100);
  });

  it("returns zero damage at 0% health", () => {
    // easeInCubic(0) = 0
    // lerp(0, 100, 0) = 0
    const result = applyDiminishingReturns({
      damage: 100,
      breed: { id: "chaos_ogryn_executor", diminishing_returns_damage: true },
      healthPercent: 0,
    });
    approx(result, 0);
  });

  it("returns unmodified damage when breed is null", () => {
    const result = applyDiminishingReturns({
      damage: 100,
      breed: null,
      healthPercent: 0.5,
    });
    approx(result, 100);
  });
});

// ---------- Stage 11: classifyDamageEfficiency ----------
describe("stage 11: classifyDamageEfficiency", () => {
  it("returns 'negated' for ADM <= 0.1 on armored with no rending", () => {
    const result = classifyDamageEfficiency({
      armorDamageModifier: 0.05,
      armorType: "armored",
      rendingDamage: 0,
    });
    assert.equal(result, "negated");
  });

  it("returns 'negated' for ADM <= 0.1 on super_armor with no rending", () => {
    const result = classifyDamageEfficiency({
      armorDamageModifier: 0.1,
      armorType: "super_armor",
      rendingDamage: 0,
    });
    assert.equal(result, "negated");
  });

  it("returns 'reduced' for low ADM on armored when rending applied", () => {
    // ADM <= 0.1 but rending > 0 → not negated, ADM <= 0.6 → reduced
    const result = classifyDamageEfficiency({
      armorDamageModifier: 0.05,
      armorType: "armored",
      rendingDamage: 5,
    });
    assert.equal(result, "reduced");
  });

  it("returns 'full' for ADM > 0.6", () => {
    const result = classifyDamageEfficiency({
      armorDamageModifier: 0.7,
      armorType: "armored",
      rendingDamage: 0,
    });
    assert.equal(result, "full");
  });

  it("returns 'reduced' for ADM between 0.1 and 0.6 on armored", () => {
    const result = classifyDamageEfficiency({
      armorDamageModifier: 0.4,
      armorType: "armored",
      rendingDamage: 0,
    });
    assert.equal(result, "reduced");
  });

  it("returns 'full' for ADM > 0.6 on unarmored", () => {
    const result = classifyDamageEfficiency({
      armorDamageModifier: 0.8,
      armorType: "unarmored",
      rendingDamage: 0,
    });
    assert.equal(result, "full");
  });

  it("returns 'reduced' for low ADM on unarmored (not negated)", () => {
    // unarmored with ADM 0.05 → not negated (only armored/super_armor can be negated)
    // ADM <= 0.6 → reduced
    const result = classifyDamageEfficiency({
      armorDamageModifier: 0.05,
      armorType: "unarmored",
      rendingDamage: 0,
    });
    assert.equal(result, "reduced");
  });

  it("returns 'negated' for zero ADM on armored", () => {
    const result = classifyDamageEfficiency({
      armorDamageModifier: 0,
      armorType: "armored",
      rendingDamage: 0,
    });
    assert.equal(result, "negated");
  });
});

// ---------- computeHit ----------

const FIXTURE_CONSTANTS = {
  default_power_level: 500,
  min_power_level: 0,
  max_power_level: 10000,
  damage_output: {
    unarmored: { min: 0, max: 20 },
    armored: { min: 0, max: 20 },
    super_armor: { min: 0, max: 20 },
  },
  boost_curves: { default: [0, 0.3, 0.6, 0.8, 1] },
  default_finesse_boost_amount: { unarmored: 0.5, armored: 0.5, super_armor: 0.5 },
  default_crit_boost_amount: 0.5,
  default_boost_curve_multiplier: 0.5,
  rending_armor_type_multiplier: { unarmored: 0, armored: 1, super_armor: 1 },
  overdamage_rending_multiplier: { unarmored: 0, armored: 0.25, super_armor: 0.25 },
  ranged_close: 12.5,
  ranged_far: 30,
};

const FIXTURE_MELEE_PROFILE = {
  melee_attack_strength: "heavy",
  power_distribution: { attack: 0.6, impact: 0.4 },
  armor_damage_modifier: {
    attack: {
      unarmored: [0.8, 1.2],
      armored: [0.4, 0.7],
      super_armor: [0, 0.1],
    },
  },
  boost_curve_multiplier_finesse: 0.25,
};

const FIXTURE_RAGER_BREED = {
  id: "renegade_berzerker",
  base_armor_type: "armored",
  hit_zones: {
    head: { armor_type: "armored", weakspot: true, damage_multiplier: { ranged: 1.0, melee: 1.0 } },
    torso: { armor_type: "super_armor", weakspot: false, damage_multiplier: { ranged: 1.0, melee: 1.0 } },
  },
  difficulty_health: {
    uprising: 850,
    malice: 1000,
    heresy: 1250,
    damnation: 1875,
    auric: 2500,
  },
};

describe("computeHit", () => {
  it("computes full pipeline for a melee headshot", () => {
    const result = computeHit({
      profile: FIXTURE_MELEE_PROFILE,
      hitZone: "head",
      breed: FIXTURE_RAGER_BREED,
      difficulty: "damnation",
      flags: { is_crit: false, is_weakspot: true },
      buffStack: { additive_sum: 1.15, multiplicative_product: 1.0, target_modifier: 1.0 },
      quality: 0.8,
      distance: 0,
      chargeLevel: 1,
      constants: FIXTURE_CONSTANTS,
    });
    assert.ok(result.damage > 0, "damage should be positive");
    assert.ok(result.hitsToKill >= 1, "hitsToKill should be at least 1");
    assert.equal(result.effectiveArmorType, "armored"); // head = armored (berzerker)
    assert.ok(result.baseDamage > 0, "baseDamage should be positive");
    // ADM = lerp(0.4, 0.7, 0.8) = 0.64 > 0.6 threshold → "full"
    assert.equal(result.damageEfficiency, "full");
  });

  it("returns Infinity hitsToKill for zero damage", () => {
    const result = computeHit({
      profile: FIXTURE_MELEE_PROFILE,
      hitZone: "torso",
      breed: FIXTURE_RAGER_BREED,
      difficulty: "damnation",
      flags: {},
      buffStack: { additive_sum: 1.0, multiplicative_product: 1.0, target_modifier: 1.0 },
      quality: 0.0, // min quality → ADM at [0, 0.1] min = 0
      distance: 0,
      constants: FIXTURE_CONSTANTS,
    });
    assert.equal(result.effectiveArmorType, "super_armor");
    // With quality 0, super_armor ADM = lerp(0, 0.1, 0) = 0 → damage = 0 → hitsToKill = Infinity
    assert.equal(result.hitsToKill, Infinity);
  });

  it("includes finesse boost on weakspot headshots", () => {
    const noWeakspot = computeHit({
      profile: FIXTURE_MELEE_PROFILE,
      hitZone: "head",
      breed: FIXTURE_RAGER_BREED,
      difficulty: "damnation",
      flags: { is_weakspot: false },
      buffStack: { additive_sum: 1.0, multiplicative_product: 1.0, target_modifier: 1.0 },
      quality: 0.8,
      distance: 0,
      constants: FIXTURE_CONSTANTS,
    });
    const withWeakspot = computeHit({
      profile: FIXTURE_MELEE_PROFILE,
      hitZone: "head",
      breed: FIXTURE_RAGER_BREED,
      difficulty: "damnation",
      flags: { is_weakspot: true },
      buffStack: { additive_sum: 1.0, multiplicative_product: 1.0, target_modifier: 1.0 },
      quality: 0.8,
      distance: 0,
      constants: FIXTURE_CONSTANTS,
    });
    assert.ok(withWeakspot.damage > noWeakspot.damage, "weakspot should do more damage");
    assert.ok(withWeakspot.finesseBoost > 1, "finesse boost should be > 1");
    assert.equal(noWeakspot.finesseBoost, 1, "no finesse without weakspot flag");
  });

  it("reports correct stagesApplied", () => {
    const result = computeHit({
      profile: FIXTURE_MELEE_PROFILE,
      hitZone: "head",
      breed: FIXTURE_RAGER_BREED,
      difficulty: "damnation",
      flags: {},
      buffStack: { additive_sum: 1.0, multiplicative_product: 1.0, target_modifier: 1.0 },
      quality: 0.8,
      distance: 0,
      constants: FIXTURE_CONSTANTS,
    });
    assert.deepEqual(result.stagesApplied, [1, 2, 3, 4, 5, 6, 7, 8, 9, 11]);
  });

  it("computes hitsToKill correctly", () => {
    const result = computeHit({
      profile: FIXTURE_MELEE_PROFILE,
      hitZone: "head",
      breed: FIXTURE_RAGER_BREED,
      difficulty: "uprising", // 850 HP
      flags: { is_crit: false, is_weakspot: true },
      buffStack: { additive_sum: 1.0, multiplicative_product: 1.0, target_modifier: 1.0 },
      quality: 0.8,
      distance: 0,
      constants: FIXTURE_CONSTANTS,
    });
    // Verify hitsToKill = ceil(HP / damage)
    const expected = Math.ceil(850 / result.damage);
    assert.equal(result.hitsToKill, expected);
  });

  it("handles missing hitzone gracefully (falls back to base_armor_type)", () => {
    const result = computeHit({
      profile: FIXTURE_MELEE_PROFILE,
      hitZone: "left_arm", // not in breed hit_zones
      breed: FIXTURE_RAGER_BREED,
      difficulty: "damnation",
      flags: {},
      buffStack: { additive_sum: 1.0, multiplicative_product: 1.0, target_modifier: 1.0 },
      quality: 0.8,
      distance: 0,
      constants: FIXTURE_CONSTANTS,
    });
    assert.equal(result.effectiveArmorType, "armored"); // falls back to base_armor_type
    assert.ok(result.damage > 0);
  });

  it("does not apply finesse when is_weakspot=true but hitzone is not weakspot", () => {
    // Torso is not a weakspot, so even with is_weakspot flag, finesse shouldn't apply
    const result = computeHit({
      profile: FIXTURE_MELEE_PROFILE,
      hitZone: "torso",
      breed: FIXTURE_RAGER_BREED,
      difficulty: "damnation",
      flags: { is_weakspot: true },
      buffStack: { additive_sum: 1.0, multiplicative_product: 1.0, target_modifier: 1.0 },
      quality: 0.8, // super_armor ADM = lerp(0, 0.1, 0.8) = 0.08
      distance: 0,
      constants: FIXTURE_CONSTANTS,
    });
    assert.equal(result.finesseBoost, 1, "finesse should not apply on non-weakspot zone");
  });
});

// ---------- assembleBuildBuffStack ----------

describe("assembleBuildBuffStack", () => {
  it("accumulates unconditional stat_buffs additively", () => {
    const mockIndex = {
      entities: new Map([
        ["t.talent.a", { calc: { effects: [{ stat: "damage", magnitude: 0.1, type: "stat_buff" }] } }],
        ["t.talent.b", { calc: { effects: [{ stat: "damage", magnitude: 0.05, type: "stat_buff" }] } }],
      ]),
      edges: [],
    };
    const build = {
      talents: [
        { canonical_entity_id: "t.talent.a", resolution_status: "resolved" },
        { canonical_entity_id: "t.talent.b", resolution_status: "resolved" },
      ],
      weapons: [],
      curios: [],
    };
    const stack = assembleBuildBuffStack(build, mockIndex, {});
    // additive_sum = 1 + 0.1 + 0.05 = 1.15
    approx(stack.additive_sum, 1.15);
  });

  it("excludes conditional effects when flag is not set", () => {
    const mockIndex = {
      entities: new Map([
        ["t.talent.a", { calc: { effects: [
          { stat: "damage", magnitude: 0.2, type: "conditional_stat_buff", condition: "threshold:health_low" },
        ] } }],
      ]),
      edges: [],
    };
    const build = {
      talents: [
        { canonical_entity_id: "t.talent.a", resolution_status: "resolved" },
      ],
      weapons: [],
      curios: [],
    };
    const stack = assembleBuildBuffStack(build, mockIndex, { health_state: "full" });
    assert.equal(stack.additive_sum, 1); // not included
  });

  it("includes conditional effects when flag matches", () => {
    const mockIndex = {
      entities: new Map([
        ["t.talent.a", { calc: { effects: [
          { stat: "damage", magnitude: 0.2, type: "conditional_stat_buff", condition: "threshold:health_low" },
        ] } }],
      ]),
      edges: [],
    };
    const build = {
      talents: [
        { canonical_entity_id: "t.talent.a", resolution_status: "resolved" },
      ],
      weapons: [],
      curios: [],
    };
    const stack = assembleBuildBuffStack(build, mockIndex, { health_state: "low" });
    approx(stack.additive_sum, 1.2);
  });

  it("skips unresolved selections", () => {
    const mockIndex = {
      entities: new Map([
        ["t.talent.a", { calc: { effects: [{ stat: "damage", magnitude: 0.5, type: "stat_buff" }] } }],
      ]),
      edges: [],
    };
    const build = {
      talents: [
        { canonical_entity_id: "t.talent.a", resolution_status: "unresolved" },
      ],
      weapons: [],
      curios: [],
    };
    const stack = assembleBuildBuffStack(build, mockIndex, {});
    assert.equal(stack.additive_sum, 1); // unresolved → skipped
  });

  it("collects rending_multiplier separately", () => {
    const mockIndex = {
      entities: new Map([
        ["t.talent.a", { calc: { effects: [
          { stat: "rending_multiplier", magnitude: 0.1, type: "stat_buff" },
        ] } }],
      ]),
      edges: [],
    };
    const build = {
      talents: [
        { canonical_entity_id: "t.talent.a", resolution_status: "resolved" },
      ],
      weapons: [],
      curios: [],
    };
    const stack = assembleBuildBuffStack(build, mockIndex, {});
    approx(stack.rending_multiplier, 1.1); // 1 + 0.1
    assert.equal(stack.additive_sum, 1); // not in additive sum
  });

  it("collects per-armor-type damage stats separately", () => {
    const mockIndex = {
      entities: new Map([
        ["t.talent.a", { calc: { effects: [
          { stat: "armored_damage", magnitude: 0.15, type: "stat_buff" },
          { stat: "unarmored_damage", magnitude: 0.1, type: "stat_buff" },
        ] } }],
      ]),
      edges: [],
    };
    const build = {
      talents: [
        { canonical_entity_id: "t.talent.a", resolution_status: "resolved" },
      ],
      weapons: [],
      curios: [],
    };
    const stack = assembleBuildBuffStack(build, mockIndex, {});
    approx(stack.armored_damage, 1.15);
    approx(stack.unarmored_damage, 1.1);
    assert.equal(stack.additive_sum, 1); // not in additive sum
  });

  it("skips effects with null magnitude", () => {
    const mockIndex = {
      entities: new Map([
        ["t.talent.a", { calc: { effects: [
          { stat: "damage", magnitude: null, type: "stat_buff" },
          { stat: "damage", magnitude: 0.1, type: "stat_buff" },
        ] } }],
      ]),
      edges: [],
    };
    const build = {
      talents: [
        { canonical_entity_id: "t.talent.a", resolution_status: "resolved" },
      ],
      weapons: [],
      curios: [],
    };
    const stack = assembleBuildBuffStack(build, mockIndex, {});
    approx(stack.additive_sum, 1.1); // only the non-null one
  });

  it("handles empty build gracefully", () => {
    const mockIndex = { entities: new Map(), edges: [] };
    const build = { talents: [], weapons: [], curios: [] };
    const stack = assembleBuildBuffStack(build, mockIndex, {});
    assert.equal(stack.additive_sum, 1);
    assert.equal(stack.multiplicative_product, 1);
    assert.equal(stack.target_modifier, 1);
  });

  it("treats 'active' and 'wielded' conditions as always-true", () => {
    const mockIndex = {
      entities: new Map([
        ["t.talent.a", { calc: { effects: [
          { stat: "damage", magnitude: 0.1, type: "conditional_stat_buff", condition: "active" },
        ] } }],
        ["t.talent.b", { calc: { effects: [
          { stat: "damage", magnitude: 0.05, type: "conditional_stat_buff", condition: "wielded" },
        ] } }],
      ]),
      edges: [],
    };
    const build = {
      talents: [
        { canonical_entity_id: "t.talent.a", resolution_status: "resolved" },
        { canonical_entity_id: "t.talent.b", resolution_status: "resolved" },
      ],
      weapons: [],
      curios: [],
    };
    const stack = assembleBuildBuffStack(build, mockIndex, {});
    approx(stack.additive_sum, 1.15); // both included
  });

  it("excludes unknown_condition effects", () => {
    const mockIndex = {
      entities: new Map([
        ["t.talent.a", { calc: { effects: [
          { stat: "damage", magnitude: 0.5, type: "conditional_stat_buff", condition: "unknown_condition" },
        ] } }],
      ]),
      edges: [],
    };
    const build = {
      talents: [
        { canonical_entity_id: "t.talent.a", resolution_status: "resolved" },
      ],
      weapons: [],
      curios: [],
    };
    const stack = assembleBuildBuffStack(build, mockIndex, {});
    assert.equal(stack.additive_sum, 1); // excluded
  });

  it("accumulates multiplicative stats as product", () => {
    const mockIndex = {
      entities: new Map([
        ["t.talent.a", { calc: { effects: [
          { stat: "smite_damage_multiplier", magnitude: 0.2, type: "stat_buff" },
        ] } }],
        ["t.talent.b", { calc: { effects: [
          { stat: "companion_damage_multiplier", magnitude: 0.3, type: "stat_buff" },
        ] } }],
      ]),
      edges: [],
    };
    const build = {
      talents: [
        { canonical_entity_id: "t.talent.a", resolution_status: "resolved" },
        { canonical_entity_id: "t.talent.b", resolution_status: "resolved" },
      ],
      weapons: [],
      curios: [],
    };
    const stack = assembleBuildBuffStack(build, mockIndex, {});
    // (1 + 0.2) * (1 + 0.3) = 1.2 * 1.3 = 1.56
    approx(stack.multiplicative_product, 1.56);
    assert.equal(stack.additive_sum, 1);
  });

  it("accumulates target-side multipliers into target_modifier", () => {
    const mockIndex = {
      entities: new Map([
        ["t.talent.a", { calc: { effects: [
          { stat: "damage_taken_multiplier", magnitude: 0.15, type: "stat_buff" },
        ] } }],
      ]),
      edges: [],
    };
    const build = {
      talents: [
        { canonical_entity_id: "t.talent.a", resolution_status: "resolved" },
      ],
      weapons: [],
      curios: [],
    };
    const stack = assembleBuildBuffStack(build, mockIndex, {});
    approx(stack.target_modifier, 1.15);
    assert.equal(stack.additive_sum, 1);
  });

  it("collects weapon perk and blessing effects", () => {
    const mockIndex = {
      entities: new Map([
        ["s.perk.a", { calc: { effects: [
          { stat: "armored_damage", magnitude: 0.1, type: "conditional_stat_buff", condition: "wielded" },
        ] } }],
        ["s.blessing.b", { calc: { effects: [
          { stat: "damage", magnitude: 0.2, type: "stat_buff" },
        ] } }],
      ]),
      edges: [],
    };
    const build = {
      talents: [],
      weapons: [{
        perks: [{ canonical_entity_id: "s.perk.a", resolution_status: "resolved" }],
        blessings: [{ canonical_entity_id: "s.blessing.b", resolution_status: "resolved" }],
      }],
      curios: [],
    };
    const stack = assembleBuildBuffStack(build, mockIndex, {});
    approx(stack.armored_damage, 1.1);
    approx(stack.additive_sum, 1.2);
  });

  it("collects curio perk effects", () => {
    const mockIndex = {
      entities: new Map([
        ["s.curio.a", { calc: { effects: [
          { stat: "damage", magnitude: 0.05, type: "stat_buff" },
        ] } }],
      ]),
      edges: [],
    };
    const build = {
      talents: [],
      weapons: [],
      curios: [{
        perks: [{ canonical_entity_id: "s.curio.a", resolution_status: "resolved" }],
      }],
    };
    const stack = assembleBuildBuffStack(build, mockIndex, {});
    approx(stack.additive_sum, 1.05);
  });

  it("collects structural slot effects (ability, blitz, aura, keystone)", () => {
    const mockIndex = {
      entities: new Map([
        ["c.ability.x", { calc: { effects: [{ stat: "damage", magnitude: 0.1, type: "stat_buff" }] } }],
        ["c.keystone.y", { calc: { effects: [{ stat: "damage", magnitude: 0.2, type: "stat_buff" }] } }],
      ]),
      edges: [],
    };
    const build = {
      ability: { canonical_entity_id: "c.ability.x", resolution_status: "resolved" },
      blitz: null,
      aura: null,
      keystone: { canonical_entity_id: "c.keystone.y", resolution_status: "resolved" },
      talents: [],
      weapons: [],
      curios: [],
    };
    const stack = assembleBuildBuffStack(build, mockIndex, {});
    approx(stack.additive_sum, 1.3); // 1 + 0.1 + 0.2
  });

  it("traverses name_family entities via instance_of edges", () => {
    const mockIndex = {
      entities: new Map([
        ["shared.name_family.blessing.test", { kind: "name_family", calc: {} }],
        ["shared.weapon_trait.melee.test_t4", {
          calc: {
            tiers: [
              { effects: [{ stat: "damage", magnitude: 0.05, type: "stat_buff" }] },
              { effects: [{ stat: "damage", magnitude: 0.15, type: "stat_buff" }] },
            ],
          },
        }],
      ]),
      edges: [
        { type: "instance_of", from_entity_id: "shared.weapon_trait.melee.test_t4", to_entity_id: "shared.name_family.blessing.test" },
      ],
    };
    const build = {
      talents: [],
      weapons: [{
        blessings: [{ canonical_entity_id: "shared.name_family.blessing.test", resolution_status: "resolved" }],
        perks: [],
      }],
      curios: [],
    };
    const stack = assembleBuildBuffStack(build, mockIndex, {});
    // Should use last tier's effects: magnitude 0.15
    approx(stack.additive_sum, 1.15);
  });

  it("includes proc_stat_buff when proc_stacks > 0", () => {
    const mockIndex = {
      entities: new Map([
        ["t.talent.a", { calc: { effects: [
          { stat: "damage", magnitude: 0.1, type: "proc_stat_buff" },
        ] } }],
      ]),
      edges: [],
    };
    const build = {
      talents: [
        { canonical_entity_id: "t.talent.a", resolution_status: "resolved" },
      ],
      weapons: [],
      curios: [],
    };

    const stackOff = assembleBuildBuffStack(build, mockIndex, {});
    assert.equal(stackOff.additive_sum, 1); // proc_stacks not set → excluded

    const stackOn = assembleBuildBuffStack(build, mockIndex, { proc_stacks: 3 });
    approx(stackOn.additive_sum, 1.1); // included
  });

  it("scales warp_charge threshold by flags.warp_charge", () => {
    const mockIndex = {
      entities: new Map([
        ["t.talent.a", { calc: { effects: [
          { stat: "damage", magnitude: 0.3, type: "conditional_stat_buff", condition: "threshold:warp_charge" },
        ] } }],
      ]),
      edges: [],
    };
    const build = {
      talents: [
        { canonical_entity_id: "t.talent.a", resolution_status: "resolved" },
      ],
      weapons: [],
      curios: [],
    };

    // No warp charge → excluded
    const stackNone = assembleBuildBuffStack(build, mockIndex, { warp_charge: 0 });
    assert.equal(stackNone.additive_sum, 1);

    // Half warp charge → magnitude * 0.5 = 0.15
    const stackHalf = assembleBuildBuffStack(build, mockIndex, { warp_charge: 0.5 });
    approx(stackHalf.additive_sum, 1.15);

    // Full warp charge → magnitude * 1.0 = 0.3
    const stackFull = assembleBuildBuffStack(build, mockIndex, { warp_charge: 1.0 });
    approx(stackFull.additive_sum, 1.3);
  });

  it("handles lerped_stat_buff with magnitude_min/magnitude_max", () => {
    const mockIndex = {
      entities: new Map([
        ["t.talent.a", { calc: { effects: [
          { stat: "damage", magnitude: 0.2, magnitude_min: 0.05, magnitude_max: 0.25, type: "lerped_stat_buff" },
        ] } }],
      ]),
      edges: [],
    };
    const build = {
      talents: [
        { canonical_entity_id: "t.talent.a", resolution_status: "resolved" },
      ],
      weapons: [],
      curios: [],
    };
    // warp_charge=0.5 → lerp(0.05, 0.25, 0.5) = 0.15
    const stack = assembleBuildBuffStack(build, mockIndex, { warp_charge: 0.5 });
    approx(stack.additive_sum, 1.15);
  });

  it("handles lerped_stat_buff with only magnitude (no min/max)", () => {
    const mockIndex = {
      entities: new Map([
        ["t.talent.a", { calc: { effects: [
          { stat: "damage", magnitude: 0.2, magnitude_min: null, magnitude_max: null, type: "lerped_stat_buff" },
        ] } }],
      ]),
      edges: [],
    };
    const build = {
      talents: [
        { canonical_entity_id: "t.talent.a", resolution_status: "resolved" },
      ],
      weapons: [],
      curios: [],
    };
    const stack = assembleBuildBuffStack(build, mockIndex, {});
    approx(stack.additive_sum, 1.2); // uses magnitude directly
  });

  it("includes during_heavy condition unconditionally", () => {
    const mockIndex = {
      entities: new Map([
        ["t.talent.a", { calc: { effects: [
          { stat: "damage", magnitude: 0.25, type: "conditional_stat_buff", condition: "during_heavy" },
        ] } }],
      ]),
      edges: [],
    };
    const build = {
      talents: [
        { canonical_entity_id: "t.talent.a", resolution_status: "resolved" },
      ],
      weapons: [],
      curios: [],
    };
    const stack = assembleBuildBuffStack(build, mockIndex, {});
    approx(stack.additive_sum, 1.25); // always included
  });

  it("includes ads_active condition only when flag is true", () => {
    const mockIndex = {
      entities: new Map([
        ["t.talent.a", { calc: { effects: [
          { stat: "damage", magnitude: 0.1, type: "conditional_stat_buff", condition: "ads_active" },
        ] } }],
      ]),
      edges: [],
    };
    const build = {
      talents: [
        { canonical_entity_id: "t.talent.a", resolution_status: "resolved" },
      ],
      weapons: [],
      curios: [],
    };

    const stackOff = assembleBuildBuffStack(build, mockIndex, {});
    assert.equal(stackOff.additive_sum, 1);

    const stackOn = assembleBuildBuffStack(build, mockIndex, { ads_active: true });
    approx(stackOn.additive_sum, 1.1);
  });

  it("skips entities not found in index", () => {
    const mockIndex = {
      entities: new Map(), // empty — entity not found
      edges: [],
    };
    const build = {
      talents: [
        { canonical_entity_id: "t.talent.missing", resolution_status: "resolved" },
      ],
      weapons: [],
      curios: [],
    };
    const stack = assembleBuildBuffStack(build, mockIndex, {});
    assert.equal(stack.additive_sum, 1); // gracefully skipped
  });

  it("skips entities with no calc or no effects", () => {
    const mockIndex = {
      entities: new Map([
        ["t.talent.a", { calc: {} }], // no effects
        ["t.talent.b", {}], // no calc at all
      ]),
      edges: [],
    };
    const build = {
      talents: [
        { canonical_entity_id: "t.talent.a", resolution_status: "resolved" },
        { canonical_entity_id: "t.talent.b", resolution_status: "resolved" },
      ],
      weapons: [],
      curios: [],
    };
    const stack = assembleBuildBuffStack(build, mockIndex, {});
    assert.equal(stack.additive_sum, 1);
  });

  it("handles missing build fields gracefully", () => {
    const mockIndex = { entities: new Map(), edges: [] };
    // Minimal build — no talents, weapons, or curios keys
    const build = {};
    const stack = assembleBuildBuffStack(build, mockIndex, {});
    assert.equal(stack.additive_sum, 1);
    assert.equal(stack.multiplicative_product, 1);
    assert.equal(stack.target_modifier, 1);
  });

  it("stacks multiple individual stats from different sources", () => {
    const mockIndex = {
      entities: new Map([
        ["t.talent.a", { calc: { effects: [
          { stat: "backstab_damage", magnitude: 0.1, type: "stat_buff" },
        ] } }],
        ["t.talent.b", { calc: { effects: [
          { stat: "backstab_damage", magnitude: 0.05, type: "stat_buff" },
        ] } }],
      ]),
      edges: [],
    };
    const build = {
      talents: [
        { canonical_entity_id: "t.talent.a", resolution_status: "resolved" },
        { canonical_entity_id: "t.talent.b", resolution_status: "resolved" },
      ],
      weapons: [],
      curios: [],
    };
    const stack = assembleBuildBuffStack(build, mockIndex, {});
    approx(stack.backstab_damage, 1.15); // 1 + 0.1 + 0.05
  });

  it("includes toughness_high condition when health_state is full", () => {
    const mockIndex = {
      entities: new Map([
        ["t.talent.a", { calc: { effects: [
          { stat: "damage", magnitude: 0.1, type: "conditional_stat_buff", condition: "threshold:toughness_high" },
        ] } }],
      ]),
      edges: [],
    };
    const build = {
      talents: [
        { canonical_entity_id: "t.talent.a", resolution_status: "resolved" },
      ],
      weapons: [],
      curios: [],
    };

    const stackFull = assembleBuildBuffStack(build, mockIndex, { health_state: "full" });
    approx(stackFull.additive_sum, 1.1);

    const stackLow = assembleBuildBuffStack(build, mockIndex, { health_state: "low" });
    assert.equal(stackLow.additive_sum, 1); // excluded
  });
});

// ---------- computeBreakpoints (unit tests with mock data) ----------

const MOCK_CONSTANTS = {
  default_power_level: 500,
  min_power_level: 0,
  max_power_level: 10000,
  damage_output: {
    unarmored: { min: 0, max: 20 },
    armored: { min: 0, max: 15 },
    super_armor: { min: 0, max: 10 },
    resistant: { min: 0, max: 18 },
    berserker: { min: 0, max: 20 },
    disgustingly_resilient: { min: 0, max: 16 },
    void_shield: { min: 0, max: 5 },
    player: { min: 0, max: 20 },
  },
  default_finesse_boost_amount: { unarmored: 0.5, armored: 0.5, super_armor: 0.25, resistant: 0.5, berserker: 0.5, disgustingly_resilient: 0.5 },
  default_crit_boost_amount: 0.5,
  boost_curves: { default: [0, 0.3, 0.6, 0.8, 1] },
  rending_armor_type_multiplier: { unarmored: 0, armored: 1, super_armor: 1, resistant: 0.5, berserker: 0, disgustingly_resilient: 0, void_shield: 0 },
  overdamage_rending_multiplier: { unarmored: 0, armored: 0.5, super_armor: 0.5, resistant: 0.25, berserker: 0, disgustingly_resilient: 0, void_shield: 0 },
  default_armor_damage_modifier: { attack: { unarmored: 1, armored: 1, super_armor: 0.25, resistant: 1, berserker: 1, disgustingly_resilient: 1, void_shield: 0.5 } },
};

const MOCK_PROFILES = [
  {
    id: "mock_light_melee",
    source_file: "test",
    damage_type: "metal_slashing_light",
    stagger_category: "melee",
    melee_attack_strength: "light",
    power_distribution: { attack: 80, impact: 5 },
    armor_damage_modifier: { attack: { unarmored: 1.2, armored: 0.5, super_armor: 0.1, resistant: 0.8, berserker: 1.0, disgustingly_resilient: 0.9 } },
  },
  {
    id: "mock_heavy_melee",
    source_file: "test",
    damage_type: "metal_slashing_heavy",
    stagger_category: "melee",
    melee_attack_strength: "heavy",
    power_distribution: { attack: 120, impact: 10 },
    armor_damage_modifier: { attack: { unarmored: 1.5, armored: 0.8, super_armor: 0.3, resistant: 1.0, berserker: 1.2, disgustingly_resilient: 1.0 } },
  },
  {
    id: "mock_ranged_shot",
    source_file: "test",
    damage_type: "auto_bullet",
    stagger_category: "killshot",
    melee_attack_strength: null,
    power_distribution: { attack: 60, impact: 2 },
    armor_damage_modifier_ranged: {
      near: { attack: { unarmored: 1.0, armored: 0.6, super_armor: 0.05, resistant: 0.9, berserker: 1.0, disgustingly_resilient: 0.8 } },
      far: { attack: { unarmored: 0.8, armored: 0.4, super_armor: 0.02, resistant: 0.7, berserker: 0.8, disgustingly_resilient: 0.6 } },
    },
  },
];

const MOCK_ACTION_MAPS = [
  {
    weapon_template: "combatsword_p1_m1",
    actions: {
      light_attack: ["mock_light_melee"],
      heavy_attack: ["mock_heavy_melee"],
    },
  },
  {
    weapon_template: "autogun_p1_m1",
    actions: {
      shoot_hip: ["mock_ranged_shot"],
    },
  },
];

const MOCK_BREEDS = [
  {
    id: "chaos_poxwalker",
    display_name: "Poxwalker",
    faction: "chaos",
    base_armor_type: "unarmored",
    tags: ["horde"],
    difficulty_health: { uprising: 50, malice: 63, heresy: 75, damnation: 100, auric: 125 },
    hit_zones: {
      head: { armor_type: "unarmored", weakspot: true, damage_multiplier: { melee: 2.0, ranged: 2.0 } },
      torso: { armor_type: "unarmored", weakspot: false, damage_multiplier: { melee: 1.0, ranged: 1.0 } },
    },
  },
  {
    id: "renegade_berzerker",
    display_name: "Berzerker",
    faction: "renegade",
    base_armor_type: "armored",
    tags: ["elite"],
    difficulty_health: { uprising: 850, malice: 1000, heresy: 1250, damnation: 1875, auric: 2500 },
    hit_zones: {
      head: { armor_type: "armored", weakspot: true, damage_multiplier: { melee: 1.0, ranged: 1.0 } },
      torso: { armor_type: "super_armor", weakspot: false, damage_multiplier: { melee: 1.0, ranged: 1.0 } },
    },
  },
];

const MOCK_CALC_DATA = {
  profiles: MOCK_PROFILES,
  actionMaps: MOCK_ACTION_MAPS,
  constants: MOCK_CONSTANTS,
  breeds: MOCK_BREEDS,
};

const MOCK_INDEX = {
  entities: new Map(),
  edges: [],
};

const MOCK_BUILD = {
  class: { raw_label: "veteran", canonical_entity_id: "shared.class.veteran", resolution_status: "resolved" },
  ability: null,
  blitz: null,
  aura: null,
  keystone: null,
  talents: [],
  weapons: [
    {
      slot: "melee",
      name: { raw_label: "Combat Sword", canonical_entity_id: "shared.weapon.combatsword_p1_m1", resolution_status: "resolved" },
      blessings: [],
      perks: [],
    },
    {
      slot: "ranged",
      name: { raw_label: "Autogun", canonical_entity_id: "shared.weapon.autogun_p1_m1", resolution_status: "resolved" },
      blessings: [],
      perks: [],
    },
  ],
  curios: [],
};

describe("computeBreakpoints (unit)", () => {
  it("produces a matrix with correct structure", () => {
    const matrix = computeBreakpoints(MOCK_BUILD, MOCK_INDEX, MOCK_CALC_DATA);

    assert.equal(matrix.weapons.length, 2, "should have 2 weapons");
    assert.equal(matrix.metadata.quality, 0.8);
    assert.deepEqual(matrix.metadata.scenarios, ["sustained", "aimed", "burst"]);
    assert.ok(matrix.metadata.timestamp, "should have timestamp");
  });

  it("melee weapon has light and heavy actions", () => {
    const matrix = computeBreakpoints(MOCK_BUILD, MOCK_INDEX, MOCK_CALC_DATA);
    const melee = matrix.weapons.find(w => w.entityId === "shared.weapon.combatsword_p1_m1");
    assert.ok(melee, "melee weapon should be in matrix");
    assert.equal(melee.slot, 0);

    const actionTypes = melee.actions.map(a => a.type);
    assert.ok(actionTypes.includes("light_attack"), "should have light_attack");
    assert.ok(actionTypes.includes("heavy_attack"), "should have heavy_attack");
  });

  it("ranged weapon has shoot_hip action", () => {
    const matrix = computeBreakpoints(MOCK_BUILD, MOCK_INDEX, MOCK_CALC_DATA);
    const ranged = matrix.weapons.find(w => w.entityId === "shared.weapon.autogun_p1_m1");
    assert.ok(ranged, "ranged weapon should be in matrix");
    assert.equal(ranged.slot, 1);

    const actionTypes = ranged.actions.map(a => a.type);
    assert.ok(actionTypes.includes("shoot_hip"), "should have shoot_hip");
  });

  it("each action has all 3 scenarios", () => {
    const matrix = computeBreakpoints(MOCK_BUILD, MOCK_INDEX, MOCK_CALC_DATA);
    for (const weapon of matrix.weapons) {
      for (const action of weapon.actions) {
        assert.ok(action.scenarios.sustained, `${action.type} missing sustained`);
        assert.ok(action.scenarios.aimed, `${action.type} missing aimed`);
        assert.ok(action.scenarios.burst, `${action.type} missing burst`);
      }
    }
  });

  it("each scenario has breeds × difficulties entries", () => {
    const matrix = computeBreakpoints(MOCK_BUILD, MOCK_INDEX, MOCK_CALC_DATA);
    const expectedCount = MOCK_BREEDS.length * 5; // 2 breeds × 5 difficulties
    for (const weapon of matrix.weapons) {
      for (const action of weapon.actions) {
        for (const scenarioName of ["sustained", "aimed", "burst"]) {
          const scenario = action.scenarios[scenarioName];
          assert.equal(scenario.breeds.length, expectedCount,
            `${action.type}/${scenarioName} should have ${expectedCount} breed entries`);
        }
      }
    }
  });

  it("all breed entries have numeric hitsToKill", () => {
    const matrix = computeBreakpoints(MOCK_BUILD, MOCK_INDEX, MOCK_CALC_DATA);
    for (const weapon of matrix.weapons) {
      for (const action of weapon.actions) {
        for (const [scenarioName, scenario] of Object.entries(action.scenarios)) {
          for (const entry of scenario.breeds) {
            assert.ok(
              typeof entry.hitsToKill === "number",
              `${weapon.entityId}/${action.type}/${scenarioName}/${entry.breed_id}/${entry.difficulty}: hitsToKill is ${typeof entry.hitsToKill}`,
            );
            assert.ok(
              !Number.isNaN(entry.hitsToKill),
              `${weapon.entityId}/${action.type}/${scenarioName}/${entry.breed_id}/${entry.difficulty}: hitsToKill is NaN`,
            );
          }
        }
      }
    }
  });

  it("all breed entries have positive damage", () => {
    const matrix = computeBreakpoints(MOCK_BUILD, MOCK_INDEX, MOCK_CALC_DATA);
    for (const weapon of matrix.weapons) {
      for (const action of weapon.actions) {
        for (const [scenarioName, scenario] of Object.entries(action.scenarios)) {
          for (const entry of scenario.breeds) {
            assert.ok(
              typeof entry.damage === "number" && !Number.isNaN(entry.damage),
              `${weapon.entityId}/${action.type}/${scenarioName}/${entry.breed_id}: damage is ${entry.damage}`,
            );
          }
        }
      }
    }
  });

  it("hitsToKill is higher for tougher enemies at same difficulty", () => {
    const matrix = computeBreakpoints(MOCK_BUILD, MOCK_INDEX, MOCK_CALC_DATA);
    const melee = matrix.weapons[0];
    const light = melee.actions.find(a => a.type === "light_attack");
    const sustained = light.scenarios.sustained;

    const poxDamn = sustained.breeds.find(b => b.breed_id === "chaos_poxwalker" && b.difficulty === "damnation");
    const berDamn = sustained.breeds.find(b => b.breed_id === "renegade_berzerker" && b.difficulty === "damnation");

    assert.ok(berDamn.hitsToKill > poxDamn.hitsToKill,
      `berzerker (${berDamn.hitsToKill}) should take more hits than poxwalker (${poxDamn.hitsToKill})`);
  });

  it("burst scenario does more damage than sustained (headshots + crit)", () => {
    const matrix = computeBreakpoints(MOCK_BUILD, MOCK_INDEX, MOCK_CALC_DATA);
    const melee = matrix.weapons[0];
    const light = melee.actions.find(a => a.type === "light_attack");

    // Pick the same breed and difficulty, compare sustained vs burst damage
    // Note: sustained targets torso (no weakspot), burst targets head (weakspot + crit)
    const poxSustained = light.scenarios.sustained.breeds.find(
      b => b.breed_id === "chaos_poxwalker" && b.difficulty === "damnation"
    );
    const poxBurst = light.scenarios.burst.breeds.find(
      b => b.breed_id === "chaos_poxwalker" && b.difficulty === "damnation"
    );

    // burst should do more (crit + weakspot + head hitzone mult of 2.0)
    assert.ok(poxBurst.damage > poxSustained.damage,
      `burst (${poxBurst.damage}) should do more than sustained (${poxSustained.damage})`);
  });

  it("builds summary with bestLight and bestHeavy for melee weapon", () => {
    const matrix = computeBreakpoints(MOCK_BUILD, MOCK_INDEX, MOCK_CALC_DATA);
    const melee = matrix.weapons.find(w => w.entityId === "shared.weapon.combatsword_p1_m1");
    assert.ok(melee.summary, "should have summary");
    assert.ok(melee.summary.bestLight, "should have bestLight");
    assert.ok(melee.summary.bestHeavy, "should have bestHeavy");
    assert.equal(melee.summary.bestLight.actionType, "light_attack");
    assert.equal(melee.summary.bestHeavy.actionType, "heavy_attack");
    assert.ok(melee.summary.bestLight.damnation, "bestLight should have damnation breakpoints");
  });

  it("skips weapons with unresolved names", () => {
    const build = {
      ...MOCK_BUILD,
      weapons: [
        { slot: "melee", name: { raw_label: "Unknown", canonical_entity_id: null, resolution_status: "unresolved" }, blessings: [], perks: [] },
      ],
    };
    const matrix = computeBreakpoints(build, MOCK_INDEX, MOCK_CALC_DATA);
    assert.equal(matrix.weapons.length, 0, "should skip unresolved weapons");
  });

  it("skips weapons without action maps", () => {
    const build = {
      ...MOCK_BUILD,
      weapons: [
        { slot: "melee", name: { raw_label: "Unknown Sword", canonical_entity_id: "shared.weapon.unknown_sword_p1_m1", resolution_status: "resolved" }, blessings: [], perks: [] },
      ],
    };
    const matrix = computeBreakpoints(build, MOCK_INDEX, MOCK_CALC_DATA);
    assert.equal(matrix.weapons.length, 0, "should skip weapons without action maps");
  });

  it("handles array power_distribution with quality lerp", () => {
    const profiles = [
      {
        id: "mock_lerp_profile",
        source_file: "test",
        damage_type: "test",
        stagger_category: "melee",
        melee_attack_strength: "light",
        power_distribution: { attack: [50, 150], impact: [2, 8] },
        armor_damage_modifier: { attack: { unarmored: 1.0 } },
      },
    ];
    const actionMaps = [
      { weapon_template: "test_weapon_m1", actions: { light_attack: ["mock_lerp_profile"] } },
    ];
    const build = {
      ...MOCK_BUILD,
      weapons: [
        { slot: "melee", name: { raw_label: "Test", canonical_entity_id: "shared.weapon.test_weapon_m1", resolution_status: "resolved" }, blessings: [], perks: [] },
      ],
    };
    const calcData = { ...MOCK_CALC_DATA, profiles, actionMaps };
    const matrix = computeBreakpoints(build, MOCK_INDEX, calcData);

    assert.equal(matrix.weapons.length, 1);
    assert.ok(matrix.weapons[0].actions.length > 0);
    // With quality 0.8: attack = lerp(50, 150, 0.8) = 130
    // Damage should be positive and finite
    const entry = matrix.weapons[0].actions[0].scenarios.sustained.breeds[0];
    assert.ok(Number.isFinite(entry.damage) && entry.damage > 0,
      `damage should be finite positive, got ${entry.damage}`);
  });
});

// ---------- summarizeBreakpoints (unit) ----------

describe("summarizeBreakpoints (unit)", () => {
  it("extracts key breakpoints for each weapon/scenario/category", () => {
    const matrix = computeBreakpoints(MOCK_BUILD, MOCK_INDEX, MOCK_CALC_DATA);
    const summaries = summarizeBreakpoints(matrix);

    assert.ok(summaries.length > 0, "should have at least one summary entry");

    // Check that each summary has the expected shape
    for (const s of summaries) {
      assert.ok(s.weaponId, "should have weaponId");
      assert.ok(s.scenario, "should have scenario");
      assert.ok(s.category, "should have category");
      assert.ok(s.bestAction, "should have bestAction");
      assert.ok(s.bestAction.type, "bestAction should have type");
      assert.ok(s.bestAction.profileId, "bestAction should have profileId");
      assert.ok(s.keyBreakpoints, "should have keyBreakpoints");
    }
  });

  it("includes key breeds in breakpoints", () => {
    const matrix = computeBreakpoints(MOCK_BUILD, MOCK_INDEX, MOCK_CALC_DATA);
    const summaries = summarizeBreakpoints(matrix);

    // Find a melee light summary
    const meleeLight = summaries.find(
      s => s.weaponId === "shared.weapon.combatsword_p1_m1" && s.category === "light" && s.scenario === "sustained"
    );
    assert.ok(meleeLight, "should have melee light sustained summary");
    assert.ok("renegade_berzerker" in meleeLight.keyBreakpoints, "should include renegade_berzerker");
    assert.ok("chaos_poxwalker" in meleeLight.keyBreakpoints, "should include chaos_poxwalker");
  });

  it("returns null for missing key breeds", () => {
    // Build with only 1 breed (poxwalker), missing berzerker and bulwark
    const singleBreedData = {
      ...MOCK_CALC_DATA,
      breeds: [MOCK_BREEDS[0]], // only poxwalker
    };
    const matrix = computeBreakpoints(MOCK_BUILD, MOCK_INDEX, singleBreedData);
    const summaries = summarizeBreakpoints(matrix);

    const entry = summaries.find(s => s.scenario === "sustained" && s.category === "light");
    assert.ok(entry, "should have a summary");
    // chaos_ogryn_bulwark and renegade_berzerker are not in data → null
    assert.equal(entry.keyBreakpoints.chaos_ogryn_bulwark, null, "missing breed should be null");
    assert.equal(entry.keyBreakpoints.renegade_berzerker, null, "missing breed should be null");
    // poxwalker should have a numeric value
    assert.ok(typeof entry.keyBreakpoints.chaos_poxwalker === "number", "present breed should be numeric");
  });

  it("covers all scenarios", () => {
    const matrix = computeBreakpoints(MOCK_BUILD, MOCK_INDEX, MOCK_CALC_DATA);
    const summaries = summarizeBreakpoints(matrix);
    const scenarios = new Set(summaries.map(s => s.scenario));
    assert.ok(scenarios.has("sustained"), "should cover sustained");
    assert.ok(scenarios.has("aimed"), "should cover aimed");
    assert.ok(scenarios.has("burst"), "should cover burst");
  });
});

// ---------- computeBreakpoints (integration — requires source root) ----------

const HAS_SOURCE = !!process.env.GROUND_TRUTH_SOURCE_ROOT;

describe("computeBreakpoints (integration)", { skip: !HAS_SOURCE && "requires GROUND_TRUTH_SOURCE_ROOT" }, () => {
  it("produces a breakpoint matrix for a psyker build", async () => {
    const { loadIndex } = await import("./ground-truth/lib/synergy-model.mjs");
    const build = JSON.parse(readFileSync(join(__dirname, "builds", "08-gandalf-melee-wizard.json"), "utf-8"));
    const index = loadIndex();
    const calcData = loadCalculatorData();
    const matrix = computeBreakpoints(build, index, calcData);

    assert.ok(matrix.weapons.length > 0, "no weapons in matrix");
    assert.ok(matrix.weapons[0].actions.length > 0, "no actions");
    assert.ok(matrix.weapons[0].actions[0].scenarios.sustained, "missing sustained scenario");
    assert.ok(matrix.weapons[0].summary, "missing summary");
    assert.equal(matrix.metadata.quality, 0.8);

    // Log stats for the report
    let totalActions = 0;
    let totalBreedEntries = 0;
    for (const w of matrix.weapons) {
      totalActions += w.actions.length;
      for (const a of w.actions) {
        for (const s of Object.values(a.scenarios)) {
          totalBreedEntries += s.breeds.length;
        }
      }
    }
    console.log(`  [integration] weapons=${matrix.weapons.length} actions=${totalActions} breedEntries=${totalBreedEntries}`);
    console.log(`  [integration] breeds=${calcData.breeds.length} difficulties=5 scenarios=3`);
  });

  it("all breed entries have numeric hitsToKill", async () => {
    const { loadIndex } = await import("./ground-truth/lib/synergy-model.mjs");
    const build = JSON.parse(readFileSync(join(__dirname, "builds", "08-gandalf-melee-wizard.json"), "utf-8"));
    const index = loadIndex();
    const calcData = loadCalculatorData();
    const matrix = computeBreakpoints(build, index, calcData);

    let checked = 0;
    for (const weapon of matrix.weapons) {
      for (const action of weapon.actions) {
        for (const [scenarioName, scenario] of Object.entries(action.scenarios)) {
          for (const entry of scenario.breeds) {
            assert.ok(
              typeof entry.hitsToKill === "number" && !Number.isNaN(entry.hitsToKill),
              `${weapon.entityId}/${action.type}/${scenarioName}/${entry.breed_id}/${entry.difficulty}: hitsToKill is ${entry.hitsToKill}`,
            );
            assert.ok(
              typeof entry.damage === "number" && !Number.isNaN(entry.damage),
              `${weapon.entityId}/${action.type}/${scenarioName}/${entry.breed_id}/${entry.difficulty}: damage is ${entry.damage}`,
            );
            checked++;
          }
        }
      }
    }
    console.log(`  [integration] verified ${checked} breed entries`);
  });

  it("summarizeBreakpoints returns valid summaries", async () => {
    const { loadIndex } = await import("./ground-truth/lib/synergy-model.mjs");
    const build = JSON.parse(readFileSync(join(__dirname, "builds", "08-gandalf-melee-wizard.json"), "utf-8"));
    const index = loadIndex();
    const calcData = loadCalculatorData();
    const matrix = computeBreakpoints(build, index, calcData);
    const summaries = summarizeBreakpoints(matrix);

    assert.ok(summaries.length > 0, "should have summaries");
    for (const s of summaries) {
      assert.ok(s.weaponId, "should have weaponId");
      assert.ok(s.scenario, "should have scenario");
      assert.ok(s.category, "should have category");
      assert.ok(s.bestAction.type, "should have bestAction.type");
      for (const [breedId, htk] of Object.entries(s.keyBreakpoints)) {
        if (htk !== null) {
          assert.ok(typeof htk === "number" && !Number.isNaN(htk),
            `${s.weaponId}/${s.scenario}/${s.category}/${breedId}: hitsToKill is ${htk}`);
        }
      }
    }
    console.log(`  [integration] ${summaries.length} summary entries`);
  });
});
