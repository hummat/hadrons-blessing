/**
 * Tests for the damage profile extraction pipeline output and
 * unit tests for Lua profile parser functions.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findBalancedBrace,
  countBraceDepth,
  parseArmorTypeValues,
  parseAttackImpactPair,
  applyCloneOverrides,
} from "../cli/extract-damage-profiles.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GENERATED_DIR = join(__dirname, "..", "..", "data", "ground-truth", "generated");
const HAS_SOURCE = !!process.env.GROUND_TRUTH_SOURCE_ROOT;

describe("profiles:build output", { skip: !HAS_SOURCE && "requires GROUND_TRUTH_SOURCE_ROOT" }, () => {
  let data;
  it("generates damage-profiles.json", () => {
    data = JSON.parse(readFileSync(join(GENERATED_DIR, "damage-profiles.json"), "utf-8"));
    assert.ok(Array.isArray(data.profiles));
    assert.ok(data.profiles.length >= 100, `expected >=100 profiles, got ${data.profiles.length}`);
    assert.ok(Array.isArray(data.action_maps));
    assert.ok(data.constants, "missing constants object");
  });

  it("profiles have required fields", () => {
    for (const p of data.profiles.slice(0, 10)) {
      assert.ok(p.id, "missing id");
      assert.ok(p.damage_type || p.damage_type === null, `${p.id} missing damage_type`);
      // power_distribution may be null for explosion/grenade profiles that use power_distribution_ranged
      if (p.power_distribution) {
        assert.ok(
          typeof p.power_distribution.attack === "number" ||
          (Array.isArray(p.power_distribution.attack) && p.power_distribution.attack.length === 2),
          `${p.id} attack power not a number or [min, max]`,
        );
      }
    }
  });

  it("melee profiles have flat armor_damage_modifier", () => {
    const melee = data.profiles.find(p => p.melee_attack_strength);
    assert.ok(melee, "no melee profile found");
    assert.ok(melee.armor_damage_modifier, `${melee.id} missing armor_damage_modifier`);
    assert.ok(melee.armor_damage_modifier.attack, `${melee.id} missing attack ADM`);
  });

  it("ranged profiles have near/far armor_damage_modifier_ranged", () => {
    const ranged = data.profiles.find(p => !p.melee_attack_strength && p.armor_damage_modifier_ranged);
    assert.ok(ranged, "no ranged profile with ADM found");
    assert.ok(ranged.armor_damage_modifier_ranged.near, `${ranged.id} missing near ADM`);
    assert.ok(ranged.armor_damage_modifier_ranged.far, `${ranged.id} missing far ADM`);
  });

  it("action maps link weapons to profile IDs", () => {
    const map = data.action_maps[0];
    assert.ok(map.weapon_template, "missing weapon_template");
    assert.ok(map.actions, "missing actions");
    const actionKeys = Object.keys(map.actions);
    assert.ok(actionKeys.length > 0, `${map.weapon_template} has no actions`);
  });

  it("constants include damage output ranges and armor settings", () => {
    assert.ok(data.constants.damage_output, "missing damage_output");
    assert.ok(data.constants.default_power_level, "missing default_power_level");
    assert.ok(data.constants.boost_curves, "missing boost_curves");
    assert.ok(data.constants.overdamage_rending_multiplier, "missing overdamage_rending_multiplier");
    assert.ok(data.constants.rending_armor_type_multiplier, "missing rending_armor_type_multiplier");
    assert.ok(data.constants.default_finesse_boost_amount, "missing default_finesse_boost_amount");
  });

  it("profiles have correct ADM value types", () => {
    // Melee ADMs can be plain numbers OR lerp [min, max] arrays
    // (per-weapon melee profiles may use damage_lerp_values references)
    const melee = data.profiles.find(p => p.melee_attack_strength && p.armor_damage_modifier);
    if (melee) {
      const attackAdm = melee.armor_damage_modifier.attack;
      for (const [key, val] of Object.entries(attackAdm)) {
        const isNum = typeof val === "number";
        const isArr = Array.isArray(val) && val.length === 2;
        assert.ok(isNum || isArr, `${melee.id} ADM attack.${key} should be number or [min,max], got ${JSON.stringify(val)}`);
      }
    }

    // Ranged ADMs with lerp values should be [min, max] arrays or numbers
    const ranged = data.profiles.find(p => p.armor_damage_modifier_ranged?.near?.attack);
    if (ranged) {
      const nearAttack = ranged.armor_damage_modifier_ranged.near.attack;
      for (const [key, val] of Object.entries(nearAttack)) {
        const isNum = typeof val === "number";
        const isArr = Array.isArray(val) && val.length === 2;
        assert.ok(isNum || isArr, `${ranged.id} near.attack.${key} should be number or [min,max], got ${JSON.stringify(val)}`);
      }
    }
  });

  it("hitscan-based action maps resolve profile names", () => {
    // Find a weapon with shoot actions (ranged weapon)
    const rangedMap = data.action_maps.find(m =>
      Object.keys(m.actions).some(k => k.includes("shoot")),
    );
    if (rangedMap) {
      const shootAction = Object.entries(rangedMap.actions).find(([k]) => k.includes("shoot"));
      assert.ok(shootAction, `${rangedMap.weapon_template} missing shoot action`);
      const [, profiles] = shootAction;
      assert.ok(Array.isArray(profiles), "shoot action profiles should be an array");
      assert.ok(profiles.length > 0, "shoot action should have at least one profile");
      // Verify the profile name exists in the profiles array
      const profileIds = new Set(data.profiles.map(p => p.id));
      for (const pName of profiles) {
        assert.ok(profileIds.has(pName), `action map references unknown profile: ${pName}`);
      }
    }
  });

  it("constants include all expected fields", () => {
    const c = data.constants;
    assert.equal(c.default_power_level, 500);
    assert.equal(c.default_crit_boost_amount, 0.5);
    assert.equal(c.default_boost_curve_multiplier, 0.5);
    assert.ok(c.boost_damage_armor_conversion, "missing boost_damage_armor_conversion");
    assert.ok(c.rending_boost_amount, "missing rending_boost_amount");
    assert.ok(c.default_armor_damage_modifier, "missing default_armor_damage_modifier");
  });
});

// ── Lua parser unit tests ─────────────────────────────────────────────

describe("findBalancedBrace", () => {
  it("finds closing brace in simple block", () => {
    const s = "{ a = 1, b = 2 }";
    assert.equal(findBalancedBrace(s, 0), s.length - 1);
  });

  it("handles nested braces", () => {
    const s = "{ a = { b = 1 }, c = 2 }";
    assert.equal(findBalancedBrace(s, 0), s.length - 1);
  });

  it("skips line comments containing braces", () => {
    const s = '{ a = 1, -- { this is a comment }\nb = 2 }';
    assert.equal(findBalancedBrace(s, 0), s.length - 1);
  });

  it("skips string literals containing braces", () => {
    const s = '{ a = "{not a brace}", b = 1 }';
    assert.equal(findBalancedBrace(s, 0), s.length - 1);
  });

  it("skips multiline comments --[[ ... ]]", () => {
    const s = '{ a = 1, --[[ { nested } { braces } ]] b = 2 }';
    assert.equal(findBalancedBrace(s, 0), s.length - 1);
  });

  it("skips long strings [[ ... ]]", () => {
    const s = '{ a = [[ { not a brace } ]], b = 1 }';
    assert.equal(findBalancedBrace(s, 0), s.length - 1);
  });

  it("returns -1 when not starting at brace", () => {
    assert.equal(findBalancedBrace("abc", 0), -1);
  });

  it("returns -1 for unbalanced braces", () => {
    assert.equal(findBalancedBrace("{ a = 1", 0), -1);
  });
});

describe("countBraceDepth", () => {
  it("counts depth at position", () => {
    const s = "{ a = { b = 1 }, c = 2 }";
    assert.equal(countBraceDepth(s, 0), 0);
    assert.equal(countBraceDepth(s, 1), 1);
    assert.equal(countBraceDepth(s, 7), 2);
    assert.equal(countBraceDepth(s, 16), 1);
  });

  it("skips braces in line comments", () => {
    const s = "{ -- {\n}";
    assert.equal(countBraceDepth(s, s.length), 0);
  });

  it("skips braces in multiline comments", () => {
    const s = "{ --[[ { } ]] }";
    assert.equal(countBraceDepth(s, s.length), 0);
  });

  it("skips braces in strings", () => {
    const s = '{ "}" }';
    assert.equal(countBraceDepth(s, s.length), 0);
  });
});

describe("parseArmorTypeValues", () => {
  it("parses lerp value references", () => {
    const lerpValues = { lerp_100: [0.5, 1.0], lerp_200: [0.2, 0.8] };
    const block = `{
      [armor_types.unarmored] = damage_lerp_values.lerp_100,
      [armor_types.armored] = damage_lerp_values.lerp_200,
    }`;
    const result = parseArmorTypeValues(block, lerpValues);
    assert.deepEqual(result.unarmored, [0.5, 1.0]);
    assert.deepEqual(result.armored, [0.2, 0.8]);
  });

  it("parses literal numeric values", () => {
    const block = `{
      [armor_types.unarmored] = 1.5,
      [armor_types.super_armor] = 0.1,
    }`;
    const result = parseArmorTypeValues(block, {});
    assert.equal(result.unarmored, 1.5);
    assert.equal(result.super_armor, 0.1);
  });

  it("defaults unknown lerp to [1, 1] (neutral)", () => {
    const block = `{ [armor_types.armored] = damage_lerp_values.nonexistent }`;
    const result = parseArmorTypeValues(block, {});
    assert.deepEqual(result.armored, [1, 1]);
  });
});

describe("parseAttackImpactPair", () => {
  it("parses scalar attack and impact values", () => {
    const block = "{ attack = 0.6, impact = 0.4 }";
    const result = parseAttackImpactPair(block);
    assert.equal(result.attack, 0.6);
    assert.equal(result.impact, 0.4);
  });

  it("parses array form { min, max }", () => {
    const block = "{ attack = { 0.25, 0.5 }, impact = 0.3 }";
    const result = parseAttackImpactPair(block);
    assert.deepEqual(result.attack, [0.25, 0.5]);
    assert.equal(result.impact, 0.3);
  });
});

describe("applyCloneOverrides", () => {
  it("overrides power_distribution.attack scalar", () => {
    const profile = {
      id: "base",
      power_distribution: { attack: 0.5, impact: 0.3 },
    };
    const lua = `damage_templates.clone_x.power_distribution.attack = 0.175`;
    applyCloneOverrides(profile, "clone_x", lua, {});
    assert.equal(profile.power_distribution.attack, 0.175);
    assert.equal(profile.power_distribution.impact, 0.3); // unchanged
  });

  it("overrides damage_type", () => {
    const profile = { id: "base", damage_type: "kinetic" };
    const lua = `damage_templates.clone_y.damage_type = damage_types.burning`;
    applyCloneOverrides(profile, "clone_y", lua, {});
    assert.equal(profile.damage_type, "burning");
  });

  it("skips ragdoll and suppression overrides", () => {
    const profile = { id: "base" };
    const lua = `damage_templates.clone_z.ragdoll_push_force = 100\ndamage_templates.clone_z.suppression_value = 5`;
    applyCloneOverrides(profile, "clone_z", lua, {});
    // Should not add any fields
    assert.deepEqual(Object.keys(profile), ["id"]);
  });
});
