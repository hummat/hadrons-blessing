import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getFamilies,
  getEffectCategory,
  ALL_FAMILIES,
  STAT_FAMILIES,
} from "./ground-truth/lib/synergy-stat-families.mjs";

describe("synergy-stat-families", () => {
  describe("getFamilies", () => {
    it("maps melee_damage to melee_offense", () => {
      const families = getFamilies("melee_damage");
      assert.ok(families.has("melee_offense"));
    });

    it("maps critical_strike_chance to both crit and general_offense", () => {
      const families = getFamilies("critical_strike_chance");
      assert.ok(families.has("crit"));
      assert.ok(families.has("general_offense"));
    });

    it("returns uncategorized set for unknown stats", () => {
      const families = getFamilies("completely_made_up_stat");
      assert.deepStrictEqual(families, new Set(["uncategorized"]));
    });

    it("maps toughness to toughness family", () => {
      assert.ok(getFamilies("toughness").has("toughness"));
    });

    it("maps warp_charge_amount to warp_resource", () => {
      assert.ok(getFamilies("warp_charge_amount").has("warp_resource"));
    });

    it("maps movement_speed to mobility", () => {
      assert.ok(getFamilies("movement_speed").has("mobility"));
    });

    it("maps damage to general_offense", () => {
      assert.ok(getFamilies("damage").has("general_offense"));
    });

    it("maps block_cost_multiplier to both stamina and damage_reduction", () => {
      const families = getFamilies("block_cost_multiplier");
      assert.ok(families.has("stamina"));
      assert.ok(families.has("damage_reduction"));
    });
  });

  describe("getEffectCategory", () => {
    it("classifies stat_buff as persistent", () => {
      assert.equal(getEffectCategory("stat_buff"), "persistent");
    });

    it("classifies conditional_stat_buff as persistent", () => {
      assert.equal(getEffectCategory("conditional_stat_buff"), "persistent");
    });

    it("classifies proc_stat_buff as dynamic", () => {
      assert.equal(getEffectCategory("proc_stat_buff"), "dynamic");
    });

    it("classifies lerped_stat_buff as dynamic", () => {
      assert.equal(getEffectCategory("lerped_stat_buff"), "dynamic");
    });
  });

  describe("ALL_FAMILIES", () => {
    it("contains exactly 11 families", () => {
      assert.equal(ALL_FAMILIES.length, 11);
    });
  });
});

describe("stat family coverage", () => {
  it("maps every stat found in entity data to at least one family", () => {
    const dir = "data/ground-truth/entities";
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    const unmapped = [];
    for (const f of files) {
      for (const e of JSON.parse(readFileSync(join(dir, f), "utf-8"))) {
        for (const eff of e.calc?.effects || []) {
          if (eff.stat && getFamilies(eff.stat).has("uncategorized")) {
            unmapped.push(eff.stat);
          }
        }
        for (const tier of e.calc?.tiers || []) {
          for (const eff of tier.effects || []) {
            if (eff.stat && getFamilies(eff.stat).has("uncategorized")) {
              unmapped.push(eff.stat);
            }
          }
        }
      }
    }
    assert.deepStrictEqual(
      [...new Set(unmapped)].sort(),
      [],
      `Unmapped stats: ${[...new Set(unmapped)].join(", ")}`,
    );
  });
});
