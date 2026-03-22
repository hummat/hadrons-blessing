import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DATA_PATH = resolve(
  import.meta.dirname,
  "..",
  "data",
  "ground-truth",
  "class-base-stats.json"
);

const data = JSON.parse(readFileSync(DATA_PATH, "utf-8"));

describe("class-base-stats.json structure", () => {
  it("has a source_snapshot_id", () => {
    assert.ok(data.source_snapshot_id, "missing source_snapshot_id");
    assert.match(data.source_snapshot_id, /^darktide-source\./);
  });

  it("has all six classes", () => {
    const expected = ["veteran", "zealot", "psyker", "ogryn", "adamant", "broker"];
    for (const cls of expected) {
      assert.ok(data.classes[cls], `missing class: ${cls}`);
    }
  });

  it("each class has required base stat fields", () => {
    const requiredFields = [
      "base_health",
      "base_toughness",
      "wounds_by_difficulty",
      "base_stamina",
      "base_critical_strike_chance",
      "knocked_down_health",
    ];
    for (const [cls, stats] of Object.entries(data.classes)) {
      for (const field of requiredFields) {
        assert.ok(
          stats[field] !== undefined,
          `class ${cls} missing field: ${field}`
        );
      }
    }
  });

  it("base_health is a positive number for each class", () => {
    for (const [cls, stats] of Object.entries(data.classes)) {
      assert.equal(typeof stats.base_health, "number", `${cls}.base_health not a number`);
      assert.ok(stats.base_health > 0, `${cls}.base_health must be positive`);
    }
  });

  it("base_toughness is a positive number for each class", () => {
    for (const [cls, stats] of Object.entries(data.classes)) {
      assert.equal(typeof stats.base_toughness, "number", `${cls}.base_toughness not a number`);
      assert.ok(stats.base_toughness > 0, `${cls}.base_toughness must be positive`);
    }
  });

  it("wounds_by_difficulty is an array of 5 positive integers for each class", () => {
    for (const [cls, stats] of Object.entries(data.classes)) {
      assert.ok(
        Array.isArray(stats.wounds_by_difficulty),
        `${cls}.wounds_by_difficulty not an array`
      );
      assert.equal(
        stats.wounds_by_difficulty.length,
        5,
        `${cls}.wounds_by_difficulty should have 5 entries (one per difficulty)`
      );
      for (const w of stats.wounds_by_difficulty) {
        assert.ok(Number.isInteger(w) && w > 0, `${cls} wound value ${w} invalid`);
      }
    }
  });

  it("wounds decrease or stay constant as difficulty increases", () => {
    for (const [cls, stats] of Object.entries(data.classes)) {
      for (let i = 1; i < stats.wounds_by_difficulty.length; i++) {
        assert.ok(
          stats.wounds_by_difficulty[i] <= stats.wounds_by_difficulty[i - 1],
          `${cls} wounds should not increase with difficulty at index ${i}`
        );
      }
    }
  });

  it("ogryn has strictly more wounds than human classes at each difficulty", () => {
    const humanClasses = ["veteran", "zealot", "psyker", "adamant", "broker"];
    const ogrynWounds = data.classes.ogryn.wounds_by_difficulty;
    for (const cls of humanClasses) {
      const humanWounds = data.classes[cls].wounds_by_difficulty;
      for (let i = 0; i < 5; i++) {
        assert.ok(
          ogrynWounds[i] > humanWounds[i],
          `ogryn should have more wounds than ${cls} at difficulty ${i + 1}`
        );
      }
    }
  });
});

describe("toughness_regen structure", () => {
  it("has base_rate_per_second", () => {
    assert.equal(typeof data.toughness_regen.base_rate_per_second, "number");
    assert.ok(data.toughness_regen.base_rate_per_second > 0);
  });

  it("has regeneration_delay_seconds", () => {
    assert.equal(typeof data.toughness_regen.regeneration_delay_seconds, "number");
    assert.ok(data.toughness_regen.regeneration_delay_seconds > 0);
  });

  it("has coherency_regen_rate_multipliers with increasing values", () => {
    const mults = data.toughness_regen.coherency_regen_rate_multipliers;
    assert.ok(mults, "missing coherency_regen_rate_multipliers");
    // 0 allies = 0 regen
    assert.equal(mults["0"], 0, "0 allies should give 0 coherency regen");
    // Values should increase
    let prev = -1;
    for (let i = 0; i <= 7; i++) {
      const val = mults[String(i)];
      assert.equal(typeof val, "number", `missing multiplier for ${i} allies`);
      assert.ok(val >= prev, `multiplier for ${i} allies should be >= previous`);
      prev = val;
    }
  });

  it("has melee_kill_recovery_percent", () => {
    assert.equal(typeof data.toughness_regen.melee_kill_recovery_percent, "number");
    assert.ok(data.toughness_regen.melee_kill_recovery_percent > 0);
    assert.ok(data.toughness_regen.melee_kill_recovery_percent < 1);
  });
});

describe("state_damage_modifiers structure", () => {
  it("has entries for all six classes", () => {
    const expected = ["veteran", "zealot", "psyker", "ogryn", "adamant", "broker"];
    for (const cls of expected) {
      assert.ok(data.state_damage_modifiers[cls], `missing state_damage_modifiers for ${cls}`);
    }
  });

  it("each class has dodging, sliding, sprinting modifiers between 0 and 1", () => {
    const states = ["dodging", "sliding", "sprinting"];
    for (const [cls, mods] of Object.entries(data.state_damage_modifiers)) {
      if (cls.startsWith("_")) continue;
      for (const state of states) {
        const val = mods[state];
        assert.equal(typeof val, "number", `${cls}.${state} not a number`);
        assert.ok(val >= 0 && val <= 1, `${cls}.${state} = ${val} out of range [0, 1]`);
      }
    }
  });

  it("ogryn has no toughness damage reduction from dodge/slide/sprint", () => {
    const ogryn = data.state_damage_modifiers.ogryn;
    assert.equal(ogryn.dodging, 1.0, "ogryn dodging should be 1.0 (no reduction)");
    assert.equal(ogryn.sliding, 1.0, "ogryn sliding should be 1.0 (no reduction)");
    assert.equal(ogryn.sprinting, 1.0, "ogryn sprinting should be 1.0 (no reduction)");
  });

  it("zealot has toughness damage reduction in all movement states", () => {
    const zealot = data.state_damage_modifiers.zealot;
    assert.ok(zealot.dodging < 1.0, "zealot dodging should reduce damage");
    assert.ok(zealot.sliding < 1.0, "zealot sliding should reduce damage");
    assert.ok(zealot.sprinting < 1.0, "zealot sprinting should reduce damage");
  });
});

describe("spot-check known values", () => {
  it("veteran has 150 HP", () => {
    assert.equal(data.classes.veteran.base_health, 150);
  });

  it("ogryn has 300 HP", () => {
    assert.equal(data.classes.ogryn.base_health, 300);
  });

  it("zealot has 200 HP", () => {
    assert.equal(data.classes.zealot.base_health, 200);
  });

  it("veteran base toughness is 100", () => {
    assert.equal(data.classes.veteran.base_toughness, 100);
  });

  it("psyker base toughness is 75", () => {
    assert.equal(data.classes.psyker.base_toughness, 75);
  });

  it("adamant (arbites) base toughness is 80", () => {
    assert.equal(data.classes.adamant.base_toughness, 80);
  });

  it("ogryn has 3 wounds on damnation (difficulty 4)", () => {
    assert.equal(data.classes.ogryn.wounds_by_difficulty[3], 3);
  });

  it("veteran has 2 wounds on damnation (difficulty 4)", () => {
    assert.equal(data.classes.veteran.wounds_by_difficulty[3], 2);
  });
});
