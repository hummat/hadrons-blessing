import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadClassBaseStats,
  collectDefensiveSources,
  computeToughnessDR,
  computeEffectiveHP,
  computeBleedthrough,
  computeToughnessRegen,
  computeSurvivability,
} from "./toughness-calculator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------- helpers ----------
const approx = (actual, expected, tol = 0.01) =>
  assert.ok(
    Math.abs(actual - expected) < tol,
    `expected ~${expected}, got ${actual} (tol ${tol})`,
  );

// ---------- loadClassBaseStats ----------
describe("loadClassBaseStats", () => {
  it("loads class base stats with required structure", () => {
    const data = loadClassBaseStats();
    assert.ok(data.classes, "missing classes");
    assert.ok(data.classes.veteran, "missing veteran");
    assert.ok(data.classes.zealot, "missing zealot");
    assert.ok(data.toughness_regen, "missing toughness_regen");
    assert.ok(data.state_damage_modifiers, "missing state_damage_modifiers");
  });

  it("veteran has expected base stats", () => {
    const data = loadClassBaseStats();
    assert.equal(data.classes.veteran.base_health, 150);
    assert.equal(data.classes.veteran.base_toughness, 100);
  });
});

// ---------- computeToughnessDR ----------
describe("computeToughnessDR", () => {
  it("returns 0 DR with no sources", () => {
    const result = computeToughnessDR([]);
    assert.equal(result.total_dr, 0);
    assert.equal(result.damage_multiplier, 1);
  });

  it("handles single additive modifier", () => {
    // -0.1 modifier = 10% DR
    const result = computeToughnessDR([
      { stat: "toughness_damage_taken_modifier", value: -0.1 },
    ]);
    approx(result.total_dr, 0.1);
    approx(result.damage_multiplier, 0.9);
  });

  it("handles multiple additive modifiers (summed)", () => {
    // Two -0.05 modifiers = -0.10 total = 10% DR
    const result = computeToughnessDR([
      { stat: "toughness_damage_taken_modifier", value: -0.05 },
      { stat: "toughness_damage_taken_modifier", value: -0.05 },
    ]);
    approx(result.total_dr, 0.1);
    approx(result.damage_multiplier, 0.9);
  });

  it("handles single multiplicative modifier", () => {
    // -0.15 = 15% DR multiplicatively
    const result = computeToughnessDR([
      { stat: "toughness_damage_taken_multiplier", value: -0.15 },
    ]);
    approx(result.total_dr, 0.15);
    approx(result.damage_multiplier, 0.85);
  });

  it("handles multiple multiplicative modifiers (stacked)", () => {
    // Two -0.15 multipliers: (1 + -0.15) * (1 + -0.15) = 0.85 * 0.85 = 0.7225
    const result = computeToughnessDR([
      { stat: "toughness_damage_taken_multiplier", value: -0.15 },
      { stat: "toughness_damage_taken_multiplier", value: -0.15 },
    ]);
    approx(result.damage_multiplier, 0.7225);
    approx(result.total_dr, 0.2775);
  });

  it("handles mixed additive + multiplicative", () => {
    // Additive: -0.10 => factor = 0.90
    // Multiplicative: -0.15 => factor = 0.85
    // Combined: 0.90 * 0.85 = 0.765
    const result = computeToughnessDR([
      { stat: "toughness_damage_taken_modifier", value: -0.10 },
      { stat: "toughness_damage_taken_multiplier", value: -0.15 },
    ]);
    approx(result.damage_multiplier, 0.765);
    approx(result.total_dr, 0.235);
  });

  it("handles damage_taken_multiplier (generic DR)", () => {
    const result = computeToughnessDR([
      { stat: "damage_taken_multiplier", value: -0.20 },
    ]);
    approx(result.total_dr, 0.20);
    approx(result.damage_multiplier, 0.80);
  });

  it("clamps damage_multiplier to [0, 1]", () => {
    // Extreme DR: should clamp to 0 damage (100% DR)
    const result = computeToughnessDR([
      { stat: "toughness_damage_taken_modifier", value: -0.60 },
      { stat: "toughness_damage_taken_multiplier", value: -0.60 },
    ]);
    assert.ok(result.damage_multiplier >= 0, "damage_multiplier should be >= 0");
    assert.ok(result.total_dr <= 1, "total_dr should be <= 1");
  });
});

// ---------- computeEffectiveHP ----------
describe("computeEffectiveHP", () => {
  it("computes basic effective HP (no DR or bonuses)", () => {
    const result = computeEffectiveHP({
      baseHealth: 200,
      wounds: 2,
      baseToughness: 100,
    });
    assert.equal(result.health_pool, 400);
    assert.equal(result.max_toughness, 100);
    assert.equal(result.effective_toughness, 100);
    assert.equal(result.effective_hp, 500);
  });

  it("accounts for toughness bonus", () => {
    // +50% toughness bonus: 100 * 1.5 = 150 max toughness
    const result = computeEffectiveHP({
      baseHealth: 200,
      wounds: 2,
      baseToughness: 100,
      toughnessBonus: 0.5,
    });
    assert.equal(result.max_toughness, 150);
    assert.equal(result.effective_toughness, 150);
    assert.equal(result.health_pool, 400);
    assert.equal(result.effective_hp, 550);
  });

  it("accounts for flat toughness", () => {
    // +25 flat toughness: (100 + 25) = 125 max toughness
    const result = computeEffectiveHP({
      baseHealth: 200,
      wounds: 2,
      baseToughness: 100,
      toughnessFlat: 25,
    });
    assert.equal(result.max_toughness, 125);
    assert.equal(result.effective_toughness, 125);
  });

  it("accounts for flat + percentage toughness", () => {
    // (100 + 25) * (1 + 0.1) = 125 * 1.1 = 137.5
    const result = computeEffectiveHP({
      baseHealth: 200,
      wounds: 2,
      baseToughness: 100,
      toughnessFlat: 25,
      toughnessBonus: 0.1,
    });
    assert.equal(result.max_toughness, 137.5);
  });

  it("accounts for DR (damage multiplier)", () => {
    // 100 toughness / 0.5 damage_multiplier = 200 effective toughness
    const result = computeEffectiveHP({
      baseHealth: 200,
      wounds: 2,
      baseToughness: 100,
      damageMultiplier: 0.5,
    });
    assert.equal(result.max_toughness, 100);
    assert.equal(result.effective_toughness, 200);
    assert.equal(result.effective_hp, 600);
  });

  it("accounts for max health modifier", () => {
    // 200 * (1 + 0.2) * 2 = 480 health pool
    const result = computeEffectiveHP({
      baseHealth: 200,
      wounds: 2,
      baseToughness: 100,
      maxHealthModifier: 0.2,
    });
    assert.equal(result.health_pool, 480);
    assert.equal(result.effective_hp, 580);
  });

  it("computes realistic zealot damnation HP", () => {
    // Zealot: 200 HP, 2 wounds, 100 toughness, 10% DR, 15% toughness bonus
    const result = computeEffectiveHP({
      baseHealth: 200,
      wounds: 2,
      baseToughness: 100,
      toughnessBonus: 0.15,
      damageMultiplier: 0.9,
    });
    assert.equal(result.health_pool, 400);
    approx(result.max_toughness, 115);
    approx(result.effective_toughness, 127.78, 0.01);
    approx(result.effective_hp, 527.78, 0.01);
  });
});

// ---------- computeBleedthrough ----------
describe("computeBleedthrough", () => {
  it("melee at full toughness = no bleedthrough", () => {
    const result = computeBleedthrough({
      damage: 50,
      toughnessPercent: 1.0,
      isMelee: true,
    });
    assert.equal(result.bleedthrough, 0);
    assert.equal(result.toughness_absorbed, 50);
  });

  it("melee at zero toughness = full bleedthrough", () => {
    const result = computeBleedthrough({
      damage: 50,
      toughnessPercent: 0,
      isMelee: true,
    });
    assert.equal(result.bleedthrough, 50);
    assert.equal(result.toughness_absorbed, 0);
  });

  it("melee at 50% toughness = 50% bleedthrough", () => {
    const result = computeBleedthrough({
      damage: 100,
      toughnessPercent: 0.5,
      isMelee: true,
    });
    assert.equal(result.bleedthrough, 50);
    assert.equal(result.toughness_absorbed, 50);
  });

  it("melee with spillover modifier", () => {
    // toughness 80%, spillover_mod 0.5: reduction = 0.8 * 0.5 = 0.4
    // bleedthrough = 100 * (1 - 0.4) = 60
    const result = computeBleedthrough({
      damage: 100,
      toughnessPercent: 0.8,
      isMelee: true,
      spilloverMod: 0.5,
    });
    assert.equal(result.bleedthrough, 60);
    assert.equal(result.toughness_absorbed, 40);
  });

  it("ranged = no bleedthrough (absorbed by toughness)", () => {
    const result = computeBleedthrough({
      damage: 100,
      toughnessPercent: 0.5,
      isMelee: false,
    });
    assert.equal(result.bleedthrough, 0);
    assert.equal(result.toughness_absorbed, 100);
  });
});

// ---------- computeToughnessRegen ----------
describe("computeToughnessRegen", () => {
  const mockRegenData = {
    base_rate_per_second: 5,
    regeneration_delay_seconds: 3,
    coherency_regen_rate_multipliers: {
      "0": 0,
      "1": 0.5,
      "2": 0.75,
      "3": 1.0,
    },
    melee_kill_recovery_percent: 0.05,
  };

  it("base regen with no modifiers", () => {
    const result = computeToughnessRegen({
      regenData: mockRegenData,
      baseToughness: 100,
    });
    assert.equal(result.base_rate, 5);
    assert.equal(result.modified_rate, 5);
    assert.equal(result.delay_seconds, 3);
    assert.equal(result.coherency.solo, 0);
    assert.equal(result.coherency.one_ally, 2.5);
    assert.equal(result.coherency.two_allies, 3.75);
    assert.equal(result.coherency.three_allies, 5);
    assert.equal(result.melee_kill_recovery, 5); // 100 * 0.05 = 5
  });

  it("regen with rate modifier", () => {
    // +30% regen rate
    const result = computeToughnessRegen({
      regenData: mockRegenData,
      baseToughness: 100,
      regenRateModifier: 0.3,
    });
    assert.equal(result.modified_rate, 6.5);
    // one_ally: 5 * 0.5 * 1.3 = 3.25
    assert.equal(result.coherency.one_ally, 3.25);
  });

  it("melee kill recovery with toughness bonus", () => {
    // 100 toughness + 50% bonus = 150 max toughness
    // Recovery = 150 * 0.05 = 7.5
    const result = computeToughnessRegen({
      regenData: mockRegenData,
      baseToughness: 100,
      toughnessBonus: 0.5,
    });
    assert.equal(result.melee_kill_recovery, 7.5);
  });

  it("melee kill recovery with flat toughness", () => {
    // (100 + 25) * 0.05 = 6.25
    const result = computeToughnessRegen({
      regenData: mockRegenData,
      baseToughness: 100,
      toughnessFlat: 25,
    });
    assert.equal(result.melee_kill_recovery, 6.25);
  });

  it("melee kill recovery with replenish modifier", () => {
    // melee_kill_recovery_percent = 0.05 + 0.03 = 0.08
    // recovery = 100 * 0.08 = 8
    const result = computeToughnessRegen({
      regenData: mockRegenData,
      baseToughness: 100,
      replenishModifier: 0.03,
    });
    assert.equal(result.melee_kill_recovery, 8);
  });

  it("melee kill recovery with replenish multiplier", () => {
    // melee_kill_recovery_percent = 0.05 * 1.5 = 0.075
    // recovery = 100 * 0.075 = 7.5
    const result = computeToughnessRegen({
      regenData: mockRegenData,
      baseToughness: 100,
      replenishMultiplier: 1.5,
    });
    assert.equal(result.melee_kill_recovery, 7.5);
  });
});

// ---------- collectDefensiveSources ----------
describe("collectDefensiveSources (mock build)", () => {
  // Create a minimal mock build and index
  const mockBuild = {
    class: {
      canonical_entity_id: "shared.class.zealot",
      resolution_status: "resolved",
    },
    ability: null,
    blitz: null,
    aura: null,
    keystone: null,
    talents: [
      {
        canonical_entity_id: "zealot.talent.test_tdr",
        resolution_status: "resolved",
      },
      {
        canonical_entity_id: "zealot.talent.test_toughness_flat",
        resolution_status: "resolved",
      },
    ],
    weapons: [],
    curios: [
      {
        perks: [
          {
            canonical_entity_id: "shared.gadget_trait.test_toughness_bonus",
            resolution_status: "resolved",
          },
        ],
      },
    ],
  };

  const mockEntities = new Map([
    [
      "zealot.talent.test_tdr",
      {
        id: "zealot.talent.test_tdr",
        kind: "talent",
        domain: "zealot",
        internal_name: "test_tdr",
        calc: {
          effects: [
            {
              stat: "toughness_damage_taken_multiplier",
              magnitude: -0.15,
              type: "stat_buff",
              condition: null,
            },
          ],
        },
      },
    ],
    [
      "zealot.talent.test_toughness_flat",
      {
        id: "zealot.talent.test_toughness_flat",
        kind: "talent",
        domain: "zealot",
        internal_name: "test_toughness_flat",
        calc: {
          effects: [
            {
              stat: "toughness",
              magnitude: 25,
              type: "stat_buff",
              condition: null,
            },
          ],
        },
      },
    ],
    [
      "shared.gadget_trait.test_toughness_bonus",
      {
        id: "shared.gadget_trait.test_toughness_bonus",
        kind: "gadget_trait",
        domain: "shared",
        internal_name: "test_toughness_bonus",
        calc: {
          effects: [
            {
              stat: "toughness_bonus",
              magnitude: 0.05,
              type: "stat_buff",
              condition: null,
            },
          ],
        },
      },
    ],
  ]);

  const mockIndex = { entities: mockEntities, edges: [] };

  it("collects DR sources from talents", () => {
    const result = collectDefensiveSources(mockBuild, mockIndex);
    assert.equal(result.dr_sources.length, 1);
    assert.equal(result.dr_sources[0].stat, "toughness_damage_taken_multiplier");
    assert.equal(result.dr_sources[0].value, -0.15);
    assert.equal(result.dr_sources[0].source_entity, "zealot.talent.test_tdr");
  });

  it("collects flat toughness from talents", () => {
    const result = collectDefensiveSources(mockBuild, mockIndex);
    assert.equal(result.toughness_flat, 25);
  });

  it("collects toughness_bonus from curio perks", () => {
    const result = collectDefensiveSources(mockBuild, mockIndex);
    approx(result.toughness_bonus, 0.05);
  });

  it("handles conditional effects based on flags", () => {
    const condBuild = {
      class: { canonical_entity_id: "shared.class.zealot", resolution_status: "resolved" },
      talents: [
        {
          canonical_entity_id: "zealot.talent.cond_tdr",
          resolution_status: "resolved",
        },
      ],
      weapons: [],
      curios: [],
    };

    const condEntities = new Map([
      [
        "zealot.talent.cond_tdr",
        {
          id: "zealot.talent.cond_tdr",
          kind: "talent",
          domain: "zealot",
          internal_name: "cond_tdr",
          calc: {
            effects: [
              {
                stat: "toughness_damage_taken_multiplier",
                magnitude: -0.20,
                type: "conditional_stat_buff",
                condition: "threshold:health_low",
              },
            ],
          },
        },
      ],
    ]);

    const condIndex = { entities: condEntities, edges: [] };

    // Without health_state=low, should be excluded
    const withoutFlag = collectDefensiveSources(condBuild, condIndex, {});
    assert.equal(withoutFlag.dr_sources.length, 0);

    // With health_state=low, should be included
    const withFlag = collectDefensiveSources(condBuild, condIndex, { health_state: "low" });
    assert.equal(withFlag.dr_sources.length, 1);
    assert.equal(withFlag.dr_sources[0].value, -0.20);
  });
});

// ---------- computeSurvivability (mock) ----------
describe("computeSurvivability (mock build)", () => {
  const mockBuild = {
    class: {
      canonical_entity_id: "shared.class.zealot",
      resolution_status: "resolved",
    },
    talents: [],
    weapons: [],
    curios: [],
  };

  // Minimal index with no defensive entities
  const mockIndex = { entities: new Map(), edges: [] };

  it("produces a valid survivability profile", () => {
    const result = computeSurvivability(mockBuild, mockIndex, {
      difficulty: "damnation",
    });

    assert.equal(result.class, "zealot");
    assert.equal(result.difficulty, "damnation");
    assert.equal(result.base.health, 200);
    assert.equal(result.base.wounds, 2);
    assert.equal(result.base.toughness, 100);
    assert.equal(result.total_dr, 0);
    assert.equal(result.max_toughness, 100);
    assert.equal(result.effective_toughness, 100);
    assert.equal(result.health_pool, 400);
    assert.equal(result.effective_hp, 500);
  });

  it("has state modifiers for zealot", () => {
    const result = computeSurvivability(mockBuild, mockIndex);
    assert.ok(result.state_modifiers.dodging, "missing dodging state");
    assert.ok(result.state_modifiers.sliding, "missing sliding state");
    assert.ok(result.state_modifiers.sprinting, "missing sprinting state");

    // Zealot has 0.5 damage modifier in all states
    approx(result.state_modifiers.dodging.tdr, 0.5);
    approx(result.state_modifiers.sliding.tdr, 0.5);
    approx(result.state_modifiers.sprinting.tdr, 0.5);
    approx(result.state_modifiers.dodging.effective_toughness, 200);
  });

  it("has toughness regen data", () => {
    const result = computeSurvivability(mockBuild, mockIndex);
    assert.ok(result.toughness_regen, "missing toughness_regen");
    assert.equal(result.toughness_regen.base_rate, 5);
    assert.ok(result.toughness_regen.coherency.solo === 0, "solo coherency should be 0");
    assert.ok(result.toughness_regen.coherency.one_ally > 0, "one_ally should be > 0");
  });

  it("works with different difficulties", () => {
    const uprising = computeSurvivability(mockBuild, mockIndex, { difficulty: "uprising" });
    const damnation = computeSurvivability(mockBuild, mockIndex, { difficulty: "damnation" });

    // Uprising = 4 wounds, damnation = 2 wounds for zealot
    assert.equal(uprising.base.wounds, 4);
    assert.equal(damnation.base.wounds, 2);
    assert.ok(uprising.health_pool > damnation.health_pool, "uprising should have more health pool");
  });

  it("throws on unknown class", () => {
    const badBuild = {
      class: { canonical_entity_id: "shared.class.unknown", resolution_status: "resolved" },
      talents: [],
      weapons: [],
      curios: [],
    };
    assert.throws(() => computeSurvivability(badBuild, mockIndex));
  });
});

// ---------- Integration tests (real build data) ----------
const HAS_SOURCE = !!process.env.GROUND_TRUTH_SOURCE_ROOT;

describe("computeSurvivability (integration)", { skip: !HAS_SOURCE && "requires GROUND_TRUTH_SOURCE_ROOT" }, () => {
  it("computes full profile for zealot build 04", async () => {
    const { loadIndex } = await import("./synergy-model.js");
    const build = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "data", "builds", "04-spicy-meta-zealot.json"), "utf-8"),
    );
    const index = loadIndex();
    const result = computeSurvivability(build, index, { difficulty: "damnation" });

    // Basic structure checks
    assert.equal(result.class, "zealot");
    assert.equal(result.difficulty, "damnation");
    assert.equal(result.base.health, 200);
    assert.equal(result.base.toughness, 100);
    assert.equal(result.base.wounds, 2);

    // Build 04 has curio toughness perks — should have toughness_bonus > 0
    assert.ok(result.max_toughness > 100, `max toughness should exceed base (got ${result.max_toughness})`);

    // Should have DR sources (build has TDR talent)
    assert.ok(result.dr_sources.length > 0, "should have DR sources");

    // DR should be positive
    assert.ok(result.total_dr > 0, `total_dr should be > 0 (got ${result.total_dr})`);

    // Effective toughness should exceed max_toughness when DR > 0
    assert.ok(
      result.effective_toughness > result.max_toughness,
      `effective_toughness (${result.effective_toughness}) should exceed max_toughness (${result.max_toughness})`,
    );

    // State modifiers — zealot should have TDR in all movement states
    assert.ok(result.state_modifiers.dodging.tdr > 0, "zealot should have dodge TDR");

    // Log summary for debugging
    console.log(`  [integration] zealot build 04 survivability:`);
    console.log(`    DR sources: ${result.dr_sources.length}`);
    console.log(`    total_dr: ${result.total_dr}`);
    console.log(`    max_toughness: ${result.max_toughness}`);
    console.log(`    effective_toughness: ${result.effective_toughness}`);
    console.log(`    health_pool: ${result.health_pool}`);
    console.log(`    effective_hp: ${result.effective_hp}`);
    console.log(`    dodge effective_toughness: ${result.state_modifiers.dodging.effective_toughness}`);
  });

  it("computes full profile for ogryn build 12", async () => {
    const { loadIndex } = await import("./synergy-model.js");
    const build = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "data", "builds", "12-ogryn-shield-tank.json"), "utf-8"),
    );
    const index = loadIndex();
    const result = computeSurvivability(build, index, { difficulty: "damnation" });

    assert.equal(result.class, "ogryn");
    assert.equal(result.base.health, 300);
    assert.equal(result.base.toughness, 75);
    assert.equal(result.base.wounds, 3); // ogryn has 3 wounds on damnation

    // Ogryn should have higher health pool due to more health and wounds
    assert.ok(result.health_pool >= 900, `ogryn health pool should be >= 900 (got ${result.health_pool})`);

    // Ogryn has no state TDR (all 1.0 modifiers)
    assert.equal(result.state_modifiers.dodging.tdr, 0);
    assert.equal(result.state_modifiers.sliding.tdr, 0);
    assert.equal(result.state_modifiers.sprinting.tdr, 0);

    console.log(`  [integration] ogryn build 12 survivability:`);
    console.log(`    DR sources: ${result.dr_sources.length}`);
    console.log(`    total_dr: ${result.total_dr}`);
    console.log(`    effective_hp: ${result.effective_hp}`);
  });

  it("computes full profile for psyker build 08", async () => {
    const { loadIndex } = await import("./synergy-model.js");
    const build = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "data", "builds", "08-gandalf-melee-wizard.json"), "utf-8"),
    );
    const index = loadIndex();
    const result = computeSurvivability(build, index, { difficulty: "damnation" });

    assert.equal(result.class, "psyker");
    assert.equal(result.base.health, 150);
    assert.equal(result.base.toughness, 75);

    // Psyker has dodge TDR (0.5 modifier) but not sprint
    approx(result.state_modifiers.dodging.tdr, 0.5);
    approx(result.state_modifiers.sprinting.tdr, 0);

    console.log(`  [integration] psyker build 08 survivability:`);
    console.log(`    effective_hp: ${result.effective_hp}`);
    console.log(`    max_toughness: ${result.max_toughness}`);
    console.log(`    toughness_regen.melee_kill_recovery: ${result.toughness_regen.melee_kill_recovery}`);
  });

  it("all 20 builds produce valid survivability profiles", async () => {
    const { loadIndex } = await import("./synergy-model.js");
    const index = loadIndex();
    const buildsDir = join(__dirname, "..", "..", "data", "builds");
    const fs = await import("node:fs");
    const buildFiles = fs.readdirSync(buildsDir)
      .filter((f) => f.endsWith(".json"))
      .sort();

    let processed = 0;
    for (const file of buildFiles) {
      const build = JSON.parse(readFileSync(join(buildsDir, file), "utf-8"));
      const result = computeSurvivability(build, index, { difficulty: "damnation" });

      // Basic validity checks
      assert.ok(result.class, `${file}: missing class`);
      assert.ok(result.base.health > 0, `${file}: health should be > 0`);
      assert.ok(result.base.wounds > 0, `${file}: wounds should be > 0`);
      assert.ok(result.base.toughness > 0, `${file}: toughness should be > 0`);
      assert.ok(result.effective_hp > 0, `${file}: effective_hp should be > 0`);
      assert.ok(result.health_pool > 0, `${file}: health_pool should be > 0`);
      assert.ok(result.max_toughness > 0, `${file}: max_toughness should be > 0`);
      assert.ok(result.effective_toughness > 0, `${file}: effective_toughness should be > 0`);
      assert.ok(result.toughness_regen, `${file}: missing toughness_regen`);
      assert.ok(result.state_modifiers, `${file}: missing state_modifiers`);
      assert.ok(result.total_dr >= 0, `${file}: total_dr should be >= 0`);
      assert.ok(result.total_dr < 1, `${file}: total_dr should be < 1 (${result.total_dr})`);

      processed++;
    }

    console.log(`  [integration] processed ${processed} builds successfully`);
    assert.ok(processed >= 20, `expected >= 20 builds, got ${processed}`);
  });
});
