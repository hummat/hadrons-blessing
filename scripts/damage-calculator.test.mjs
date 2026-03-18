// @ts-check
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
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
} from "./ground-truth/lib/damage-calculator.mjs";

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

  it("lerps ranged ADM by sqrt(distance-based dropoff)", () => {
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
    // ADM = lerp(0.8, 0.4, sqrt(0.25)) = lerp(0.8, 0.4, 0.5) = 0.6
    approx(adm, 0.6);
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
