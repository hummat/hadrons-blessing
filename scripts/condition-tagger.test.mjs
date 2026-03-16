import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { tagCondition, tagCheckProc } from "./ground-truth/lib/condition-tagger.mjs";

describe("tagCondition", () => {
  it("tags ConditionalFunctions.is_item_slot_wielded", () => {
    assert.equal(
      tagCondition({ $ref: "ConditionalFunctions.is_item_slot_wielded" }),
      "wielded"
    );
  });

  it("tags ConditionalFunctions.is_sprinting", () => {
    assert.equal(
      tagCondition({ $ref: "ConditionalFunctions.is_sprinting" }),
      "sprinting"
    );
  });

  it("tags ConditionalFunctions.all() compound", () => {
    const node = {
      $call: "ConditionalFunctions.all",
      $args: [
        { $ref: "ConditionalFunctions.is_item_slot_wielded" },
        { $ref: "ConditionalFunctions.is_sprinting" },
      ],
    };
    assert.equal(tagCondition(node), "all:wielded+sprinting");
  });

  it("tags ConditionalFunctions.any() compound", () => {
    const node = {
      $call: "ConditionalFunctions.any",
      $args: [
        { $ref: "ConditionalFunctions.has_full_toughness" },
        { $ref: "ConditionalFunctions.at_max_stacks" },
      ],
    };
    assert.equal(tagCondition(node), "any:full_toughness+max_stacks");
  });

  it("tags inline function with template_data.active only", () => {
    const node = {
      $func: "function(template_data, template_context)\n  return template_data.active\nend",
    };
    assert.equal(tagCondition(node), "active");
  });

  it("tags inline function with wielded_slot check", () => {
    const node = {
      $func: 'function(td, tc)\n  local inventory_component = tc.unit_data_extension\n  if inventory_component.wielded_slot == "slot_primary" then return true end\nend',
    };
    assert.equal(tagCondition(node), "slot_primary");
  });

  it("tags inline function with weapon keyword check", () => {
    const node = {
      $func: 'function(td, tc)\n  return has_weapon_keyword_from_slot(tc, "bolter")\nend',
    };
    assert.equal(tagCondition(node), "weapon_keyword:bolter");
  });

  it("returns unknown_condition for unrecognized inline function", () => {
    const node = {
      $func: "function(td, tc)\n  return some_complex_logic(td, tc)\nend",
    };
    assert.equal(tagCondition(node), "unknown_condition");
  });

  it("resolves local function variable references via lookup", () => {
    const localFuncs = {
      _my_cond: "function(td, tc)\n  return td.active\nend",
    };
    const node = { $ref: "_my_cond" };
    assert.equal(tagCondition(node, localFuncs), "active");
  });
});

describe("tagCheckProc", () => {
  it("tags named CheckProcFunctions by stripping prefix", () => {
    assert.equal(tagCheckProc({ $ref: "CheckProcFunctions.on_kill" }), "on_kill");
    assert.equal(tagCheckProc({ $ref: "CheckProcFunctions.on_melee_hit" }), "on_melee_hit");
    assert.equal(tagCheckProc({ $ref: "CheckProcFunctions.always" }), "always");
  });

  it("tags compound all() with N args", () => {
    const node = {
      $call: "CheckProcFunctions.all",
      $args: [
        { $ref: "CheckProcFunctions.on_item_match" },
        { $ref: "CheckProcFunctions.on_melee_hit" },
        { $ref: "CheckProcFunctions.on_crit" },
      ],
    };
    assert.equal(tagCheckProc(node), "all:on_item_match+on_melee_hit+on_crit");
  });

  it("tags compound with mixed inline and named args", () => {
    const node = {
      $call: "CheckProcFunctions.all",
      $args: [
        { $func: "function(params)\n  return params.item\nend" },
        { $ref: "CheckProcFunctions.on_melee_hit" },
      ],
    };
    const result = tagCheckProc(node);
    assert.ok(result.startsWith("all:"));
    assert.ok(result.includes("on_melee_hit"));
  });
});
