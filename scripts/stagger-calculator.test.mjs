// @ts-check
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  classifyStaggerTier,
  computeEffectiveStaggerStrength,
  computeRawStaggerStrength,
  resolveImpactADM,
  loadStaggerSettings,
  computeStaggerMatrix,
  summarizeStagger,
} from "./ground-truth/lib/stagger-calculator.mjs";

// ---------- helpers ----------
const approx = (actual, expected, tol = 0.001) =>
  assert.ok(
    Math.abs(actual - expected) < tol,
    `expected ~${expected}, got ${actual} (tol ${tol})`,
  );

// ---------- Mock stagger settings ----------
const MOCK_STAGGER_SETTINGS = {
  stagger_types: [
    "light", "medium", "heavy", "light_ranged", "sticky",
    "electrocuted", "killshot", "explosion",
  ],
  default_stagger_thresholds: {
    light: 1,
    medium: 10,
    heavy: 20,
    light_ranged: 5,
    killshot: 2,
    sticky: 0.25,
    electrocuted: 0.25,
    explosion: 40,
  },
  stagger_categories: {
    melee: ["light", "medium", "heavy"],
    ranged: ["light_ranged", "medium", "heavy"],
    explosion: ["light", "medium", "heavy", "explosion"],
    killshot: ["killshot", "medium", "heavy"],
  },
  default_stagger_resistance: 1,
  rending_stagger_strength_modifier: 2,
};

// ---------- classifyStaggerTier ----------
describe("classifyStaggerTier", () => {
  const breedThresholds = {
    light: 5,
    medium: 10,
    heavy: 30,
    light_ranged: 10,
    killshot: 10,
    sticky: 3,
  };

  it("returns null tier when strength is below all thresholds", () => {
    const result = classifyStaggerTier(3, breedThresholds, "melee", MOCK_STAGGER_SETTINGS, 1);
    assert.equal(result.tier, null);
    assert.equal(result.threshold, 0);
  });

  it("returns light when strength exceeds only light threshold", () => {
    // strength=6 > light threshold 5*1=5, but < medium threshold 10*1=10
    const result = classifyStaggerTier(6, breedThresholds, "melee", MOCK_STAGGER_SETTINGS, 1);
    assert.equal(result.tier, "light");
    assert.equal(result.threshold, 5);
  });

  it("returns medium when strength exceeds medium threshold", () => {
    // strength=15 > light threshold 5 and > medium threshold 10, but < heavy threshold 30
    // chooses medium because it has the highest threshold that strength exceeds
    const result = classifyStaggerTier(15, breedThresholds, "melee", MOCK_STAGGER_SETTINGS, 1);
    assert.equal(result.tier, "medium");
    assert.equal(result.threshold, 10);
  });

  it("returns heavy when strength exceeds heavy threshold", () => {
    const result = classifyStaggerTier(35, breedThresholds, "melee", MOCK_STAGGER_SETTINGS, 1);
    assert.equal(result.tier, "heavy");
    assert.equal(result.threshold, 30);
  });

  it("applies stagger_resistance multiplier to thresholds", () => {
    // With resistance=2, light threshold becomes 5*2=10, medium becomes 10*2=20
    // strength=12 > 10 but < 20
    const result = classifyStaggerTier(12, breedThresholds, "melee", MOCK_STAGGER_SETTINGS, 2);
    assert.equal(result.tier, "light");
    assert.equal(result.threshold, 10); // 5 * 2
  });

  it("uses stagger category types for ranged", () => {
    // ranged category = [light_ranged, medium, heavy]
    // light_ranged threshold = 10, medium threshold = 10, heavy threshold = 30
    // strength=15 exceeds both light_ranged(10) and medium(10)
    // Both have threshold=10: light_ranged matches first (chosen_threshold=10),
    // then medium with threshold=10 fails the strict `chosen_threshold < threshold` check (10 < 10 is false).
    // So light_ranged wins when thresholds are equal.
    const result = classifyStaggerTier(15, breedThresholds, "ranged", MOCK_STAGGER_SETTINGS, 1);
    assert.equal(result.tier, "light_ranged");
  });

  it("returns null for unknown category", () => {
    const result = classifyStaggerTier(100, breedThresholds, "nonexistent", MOCK_STAGGER_SETTINGS, 1);
    assert.equal(result.tier, null);
  });

  it("skips threshold -1 (immune)", () => {
    const immuneThresholds = { ...breedThresholds, medium: -1 };
    // strength=15 > light(5) but medium is immune, heavy(30) not reached
    const result = classifyStaggerTier(15, immuneThresholds, "melee", MOCK_STAGGER_SETTINGS, 1);
    assert.equal(result.tier, "light");
  });

  it("falls back to default thresholds when breed lacks type", () => {
    // Breed has no "light" threshold; defaults have light=1
    const sparseThresholds = { medium: 10, heavy: 30 };
    const result = classifyStaggerTier(3, sparseThresholds, "melee", MOCK_STAGGER_SETTINGS, 1);
    assert.equal(result.tier, "light"); // default light=1, 3>1
  });

  it("uses default_stagger_resistance from settings when not provided", () => {
    const result = classifyStaggerTier(6, breedThresholds, "melee", MOCK_STAGGER_SETTINGS);
    assert.equal(result.tier, "light");
  });

  it("strength must be strictly greater than threshold (not equal)", () => {
    // Source: stagger_threshold < stagger_strength (strict less-than)
    // strength=5, threshold=5 -> threshold is NOT < strength, so no stagger at that tier
    const result = classifyStaggerTier(5, breedThresholds, "melee", MOCK_STAGGER_SETTINGS, 1);
    assert.equal(result.tier, null); // 5 is not > 5
  });
});

// ---------- computeEffectiveStaggerStrength ----------
describe("computeEffectiveStaggerStrength", () => {
  it("applies ADM and subtracts half reduction", () => {
    const result = computeEffectiveStaggerStrength({
      rawStrength: 10,
      impactADM: 1.5,
      breedStagger: { stagger_reduction: 4 },
      isRanged: false,
    });
    // strengthAfterAdm = 10 * 1.5 = 15
    // effectiveStrength = 15 - 0.5 * 4 = 13
    approx(result.effectiveStrength, 13);
    assert.equal(result.blocked, false);
    approx(result.admApplied, 1.5);
    approx(result.staggerReduction, 4);
  });

  it("marks blocked when reduction exceeds strength", () => {
    const result = computeEffectiveStaggerStrength({
      rawStrength: 5,
      impactADM: 1,
      breedStagger: { stagger_reduction: 10 },
      isRanged: false,
    });
    assert.equal(result.effectiveStrength, 0);
    assert.equal(result.blocked, true);
  });

  it("uses stagger_reduction_ranged for ranged attacks", () => {
    const result = computeEffectiveStaggerStrength({
      rawStrength: 10,
      impactADM: 1,
      breedStagger: {
        stagger_reduction: 2,
        stagger_reduction_ranged: 8,
      },
      isRanged: true,
    });
    // effectiveStrength = 10 - 0.5 * 8 = 6
    approx(result.effectiveStrength, 6);
    approx(result.staggerReduction, 8);
  });

  it("falls back to stagger_reduction when ranged has no specific reduction", () => {
    const result = computeEffectiveStaggerStrength({
      rawStrength: 10,
      impactADM: 1,
      breedStagger: { stagger_reduction: 4 },
      isRanged: true,
    });
    approx(result.effectiveStrength, 8);
    approx(result.staggerReduction, 4);
  });

  it("handles zero reduction", () => {
    const result = computeEffectiveStaggerStrength({
      rawStrength: 10,
      impactADM: 1,
      breedStagger: {},
      isRanged: false,
    });
    approx(result.effectiveStrength, 10);
    approx(result.staggerReduction, 0);
  });

  it("defaults impactADM to 1 when null", () => {
    const result = computeEffectiveStaggerStrength({
      rawStrength: 10,
      impactADM: null,
      breedStagger: {},
      isRanged: false,
    });
    approx(result.effectiveStrength, 10);
  });

  it("clamps effectiveStrength to non-negative", () => {
    const result = computeEffectiveStaggerStrength({
      rawStrength: 3,
      impactADM: 1,
      breedStagger: { stagger_reduction: 2 },
      isRanged: false,
    });
    // strengthAfterAdm = 3, reduction = 2 (not blocked since 2 < 3)
    // effectiveStrength = 3 - 0.5 * 2 = 2
    approx(result.effectiveStrength, 2);
    assert.equal(result.blocked, false);
  });
});

// ---------- computeRawStaggerStrength ----------
describe("computeRawStaggerStrength", () => {
  const constants = {
    default_power_level: 500,
    min_power_level: 0,
    max_power_level: 10000,
    damage_output: {
      unarmored: { min: 0, max: 20 },
      armored: { min: 0, max: 20 },
    },
  };

  it("computes stagger strength from impact power", () => {
    // impact=0.5 → powerMultiplier=0.5*250=125 (melee, between 0 and 2)
    // attackPowerLevel = 500 * 125 = 62500 → clamped percentage = 1
    // staggerStrength = 0 + 20 * 1 = 20
    const result = computeRawStaggerStrength({
      profile: { power_distribution: { attack: 100, impact: 0.5 } },
      armorType: "unarmored",
      constants,
      isRanged: false,
    });
    approx(result, 20);
  });

  it("returns 0 when no impact in power_distribution", () => {
    const result = computeRawStaggerStrength({
      profile: { power_distribution: { attack: 100 } },
      armorType: "unarmored",
      constants,
      isRanged: false,
    });
    assert.equal(result, 0);
  });

  it("scales linearly with impact for small values", () => {
    // impact=10 (>= 2, not scaled by 250)
    // attackPowerLevel = 500 * 10 = 5000
    // percentage = (5000 - 0) / (10000 - 0) = 0.5
    // staggerStrength = 0 + 20 * 0.5 = 10
    const result = computeRawStaggerStrength({
      profile: { power_distribution: { attack: 100, impact: 10 } },
      armorType: "unarmored",
      constants,
      isRanged: false,
    });
    approx(result, 10);
  });
});

// ---------- resolveImpactADM ----------
describe("resolveImpactADM", () => {
  it("returns 1 when profile has no ADM", () => {
    const result = resolveImpactADM({
      profile: {},
      armorType: "unarmored",
      quality: 0.8,
      isRanged: false,
    });
    assert.equal(result, 1);
  });

  it("resolves scalar impact ADM for melee", () => {
    const result = resolveImpactADM({
      profile: {
        armor_damage_modifier: {
          attack: { unarmored: 1 },
          impact: { unarmored: 0.8 },
        },
      },
      armorType: "unarmored",
      quality: 0.8,
      isRanged: false,
    });
    approx(result, 0.8);
  });

  it("lerps array impact ADM by quality", () => {
    const result = resolveImpactADM({
      profile: {
        armor_damage_modifier: {
          impact: { armored: [0.4, 0.8] },
        },
      },
      armorType: "armored",
      quality: 0.5,
      isRanged: false,
    });
    // 0.4 + (0.8 - 0.4) * 0.5 = 0.6
    approx(result, 0.6);
  });

  it("resolves ranged impact ADM with near/far interpolation", () => {
    const result = resolveImpactADM({
      profile: {
        armor_damage_modifier_ranged: {
          near: { impact: { unarmored: 1.0 } },
          far: { impact: { unarmored: 0.5 } },
        },
      },
      armorType: "unarmored",
      quality: 0.8,
      isRanged: true,
      dropoffScalar: 0, // sqrt(0) = 0 → near value
    });
    approx(result, 1.0);
  });

  it("interpolates ranged ADM by sqrt(dropoffScalar)", () => {
    const result = resolveImpactADM({
      profile: {
        armor_damage_modifier_ranged: {
          near: { impact: { unarmored: 1.0 } },
          far: { impact: { unarmored: 0.5 } },
        },
      },
      armorType: "unarmored",
      quality: 0.8,
      isRanged: true,
      dropoffScalar: 1, // sqrt(1) = 1 → far value
    });
    approx(result, 0.5);
  });
});

// ---------- loadStaggerSettings ----------
describe("loadStaggerSettings", () => {
  it("loads stagger settings from generated JSON", () => {
    const settings = loadStaggerSettings();
    assert.ok(settings.stagger_types);
    assert.ok(Array.isArray(settings.stagger_types));
    assert.ok(settings.stagger_categories);
    assert.ok(settings.stagger_categories.melee);
    assert.ok(Array.isArray(settings.stagger_categories.melee));
    assert.equal(typeof settings.default_stagger_resistance, "number");
    assert.equal(typeof settings.rending_stagger_strength_modifier, "number");
    assert.ok(settings.default_stagger_thresholds);
  });

  it("has expected stagger categories", () => {
    const settings = loadStaggerSettings();
    assert.ok(settings.stagger_categories.melee.includes("light"));
    assert.ok(settings.stagger_categories.melee.includes("medium"));
    assert.ok(settings.stagger_categories.melee.includes("heavy"));
    assert.ok(settings.stagger_categories.ranged.includes("light_ranged"));
  });
});

// ---------- Integration: computeStaggerMatrix with mock data ----------
describe("computeStaggerMatrix integration", () => {
  it("computes stagger for a minimal mock build", () => {
    // Minimal build with one weapon
    const build = {
      class: { canonical_entity_id: "shared.class.veteran" },
      weapons: [
        {
          name: {
            canonical_entity_id: "shared.weapon.combat_sword_p1_m1",
            resolution_status: "resolved",
          },
          slot: "melee",
          blessings: [],
          perks: [],
        },
      ],
      talents: [],
      curios: [],
    };

    const index = { entities: new Map(), edges: [] };

    // Minimal calc data with one profile, one action map, one breed
    const calcData = {
      profiles: [
        {
          id: "test_melee_profile",
          stagger_category: "melee",
          melee_attack_strength: "light",
          power_distribution: { attack: 0.5, impact: 0.25 },
          armor_damage_modifier: {
            attack: { unarmored: 1 },
            impact: { unarmored: 1 },
          },
        },
      ],
      actionMaps: [
        {
          weapon_template: "combat_sword_p1_m1",
          actions: {
            light_attack: ["test_melee_profile"],
          },
        },
      ],
      constants: {
        default_power_level: 500,
        min_power_level: 0,
        max_power_level: 10000,
        damage_output: {
          unarmored: { min: 0, max: 20 },
        },
      },
      breeds: [
        {
          id: "test_breed",
          base_armor_type: "unarmored",
          hit_zones: {
            torso: { armor_type: "unarmored" },
            head: { armor_type: "unarmored", weakspot: true },
          },
          stagger: {
            stagger_resistance: 1,
            stagger_reduction: 0,
            stagger_thresholds: {
              light: 1,
              medium: 5,
              heavy: 15,
            },
          },
        },
      ],
    };

    const staggerSettings = MOCK_STAGGER_SETTINGS;

    const result = computeStaggerMatrix(build, index, calcData, staggerSettings);

    assert.ok(result.weapons);
    assert.equal(result.weapons.length, 1);
    assert.equal(result.weapons[0].entityId, "shared.weapon.combat_sword_p1_m1");

    const actions = result.weapons[0].actions;
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, "light_attack");
    assert.equal(actions[0].stagger_category, "melee");

    // Should have results for the test breed across all 5 difficulties
    assert.equal(actions[0].breeds.length, 5); // 1 breed * 5 difficulties
    const damnation = actions[0].breeds.find(b => b.difficulty === "damnation");
    assert.ok(damnation);
    assert.equal(damnation.breed_id, "test_breed");
    assert.ok(damnation.stagger_strength > 0);
    assert.ok(damnation.stagger_tier != null);

    // Metadata
    assert.equal(result.metadata.quality, 0.8);
    assert.ok(result.metadata.stagger_categories_used.includes("melee"));
  });

  it("skips profiles without stagger_category", () => {
    const build = {
      weapons: [
        {
          name: {
            canonical_entity_id: "shared.weapon.test_weapon",
            resolution_status: "resolved",
          },
          slot: "melee",
          blessings: [],
          perks: [],
        },
      ],
      talents: [],
      curios: [],
    };

    const index = { entities: new Map(), edges: [] };

    const calcData = {
      profiles: [
        {
          id: "no_stagger_profile",
          // No stagger_category
          power_distribution: { attack: 0.5, impact: 0.25 },
        },
      ],
      actionMaps: [
        {
          weapon_template: "test_weapon",
          actions: {
            light_attack: ["no_stagger_profile"],
          },
        },
      ],
      constants: {
        default_power_level: 500,
        min_power_level: 0,
        max_power_level: 10000,
        damage_output: { unarmored: { min: 0, max: 20 } },
      },
      breeds: [
        {
          id: "test_breed",
          base_armor_type: "unarmored",
          stagger: { stagger_resistance: 1 },
        },
      ],
    };

    const result = computeStaggerMatrix(build, index, calcData, MOCK_STAGGER_SETTINGS);
    // The weapon should have no action results since profile lacks stagger_category
    assert.equal(result.weapons[0].actions.length, 0);
  });
});

// ---------- summarizeStagger ----------
describe("summarizeStagger", () => {
  it("picks best stagger tier per action category at damnation", () => {
    const matrix = {
      weapons: [
        {
          entityId: "shared.weapon.test",
          slot: 0,
          actions: [
            {
              type: "light_attack",
              profileId: "profile_a",
              stagger_category: "melee",
              breeds: [
                { breed_id: "renegade_berzerker", difficulty: "damnation", stagger_tier: "medium", stagger_strength: 12 },
                { breed_id: "chaos_ogryn_bulwark", difficulty: "damnation", stagger_tier: "light", stagger_strength: 6 },
                { breed_id: "chaos_poxwalker", difficulty: "damnation", stagger_tier: "heavy", stagger_strength: 25 },
              ],
            },
            {
              type: "heavy_attack",
              profileId: "profile_b",
              stagger_category: "melee",
              breeds: [
                { breed_id: "renegade_berzerker", difficulty: "damnation", stagger_tier: "heavy", stagger_strength: 35 },
                { breed_id: "chaos_ogryn_bulwark", difficulty: "damnation", stagger_tier: "medium", stagger_strength: 20 },
                { breed_id: "chaos_poxwalker", difficulty: "damnation", stagger_tier: "heavy", stagger_strength: 35 },
              ],
            },
          ],
        },
      ],
    };

    const summaries = summarizeStagger(matrix);
    assert.equal(summaries.length, 1);

    const s = summaries[0];
    assert.equal(s.entityId, "shared.weapon.test");
    assert.ok(s.bestLight);
    assert.equal(s.bestLight.actionType, "light_attack");
    assert.ok(s.bestHeavy);
    assert.equal(s.bestHeavy.actionType, "heavy_attack");
    // No _avgRank in output
    assert.equal(s.bestLight._avgRank, undefined);
  });
});
