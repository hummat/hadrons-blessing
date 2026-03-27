import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  MELEE_PERK_NAMES,
  RANGED_PERK_NAMES,
  GADGET_TRAIT_NAMES,
  buildPerkAliasRecord,
} from "./enrich-entity-names.mjs";

describe("MELEE_PERK_NAMES", () => {
  it("maps weapon_trait_increase_crit_chance to Critical Hit Chance", () => {
    assert.equal(MELEE_PERK_NAMES.get("weapon_trait_increase_crit_chance"), "Critical Hit Chance");
  });

  it("maps weapon_trait_melee_common_wield_increased_armored_damage to Damage (Flak Armoured)", () => {
    assert.equal(
      MELEE_PERK_NAMES.get("weapon_trait_melee_common_wield_increased_armored_damage"),
      "Damage (Flak Armoured)",
    );
  });

  it("maps weapon_trait_reduced_block_cost to Block Efficiency", () => {
    assert.equal(MELEE_PERK_NAMES.get("weapon_trait_reduced_block_cost"), "Block Efficiency");
  });

  it("has 19 entries", () => {
    assert.equal(MELEE_PERK_NAMES.size, 19);
  });
});

describe("RANGED_PERK_NAMES", () => {
  it("maps weapon_trait_ranged_increase_crit_chance to Critical Hit Chance", () => {
    assert.equal(RANGED_PERK_NAMES.get("weapon_trait_ranged_increase_crit_chance"), "Critical Hit Chance");
  });

  it("maps weapon_trait_ranged_increased_reload_speed to Reload Speed", () => {
    assert.equal(RANGED_PERK_NAMES.get("weapon_trait_ranged_increased_reload_speed"), "Reload Speed");
  });

  it("has 17 entries", () => {
    assert.equal(RANGED_PERK_NAMES.size, 17);
  });
});

describe("GADGET_TRAIT_NAMES", () => {
  it("maps gadget_block_cost_reduction to Block Efficiency", () => {
    assert.equal(GADGET_TRAIT_NAMES.get("gadget_block_cost_reduction"), "Block Efficiency");
  });

  it("maps gadget_toughness_regen_delay to Toughness Regen Speed", () => {
    assert.equal(GADGET_TRAIT_NAMES.get("gadget_toughness_regen_delay"), "Toughness Regen Speed");
  });

  it("has 19 entries", () => {
    assert.equal(GADGET_TRAIT_NAMES.size, 19);
  });

  it("excludes innate gadget stats", () => {
    assert.equal(GADGET_TRAIT_NAMES.has("gadget_innate_health_increase"), false);
    assert.equal(GADGET_TRAIT_NAMES.has("gadget_innate_max_wounds_increase"), false);
    assert.equal(GADGET_TRAIT_NAMES.has("gadget_innate_toughness_increase"), false);
  });

  it("excludes unmapped gadget traits", () => {
    assert.equal(GADGET_TRAIT_NAMES.has("gadget_damage_reduction_vs_grenadiers"), false);
    assert.equal(GADGET_TRAIT_NAMES.has("gadget_permanent_damage_resistance"), false);
  });
});

describe("buildPerkAliasRecord", () => {
  it("builds a melee perk alias record with correct fields", () => {
    const record = buildPerkAliasRecord(
      "shared.weapon_perk.melee.weapon_trait_increase_crit_chance",
      "Critical Hit Chance",
      "melee",
    );
    assert.equal(record.text, "Critical Hit Chance");
    assert.equal(record.normalized_text, "critical hit chance");
    assert.equal(record.candidate_entity_id, "shared.weapon_perk.melee.weapon_trait_increase_crit_chance");
    assert.equal(record.alias_kind, "community_name");
    assert.equal(record.match_mode, "fuzzy_allowed");
    assert.equal(record.provenance, "build-scoring-data");
    assert.equal(record.confidence, "high");
    assert.equal(record.rank_weight, 150);
    assert.equal(record.notes, "");
    assert.deepEqual(record.context_constraints, {
      require_all: [{ key: "slot", value: "melee" }],
      prefer: [],
    });
  });

  it("builds a ranged perk alias record", () => {
    const record = buildPerkAliasRecord(
      "shared.weapon_perk.ranged.weapon_trait_ranged_increased_reload_speed",
      "Reload Speed",
      "ranged",
    );
    assert.deepEqual(record.context_constraints.require_all, [{ key: "slot", value: "ranged" }]);
  });
});
