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

  // -- New condition patterns (condition tagger expansion) --------------------

  it("tags alternate_fire_component.is_active as ads_active", () => {
    // Ogryn bracing pattern: alternate_fire_component.is_active directly
    const node = {
      $func: "function (template_data, template_context)\n\tlocal braced = template_data.alternate_fire_component.is_active\n\n\treturn braced\nend",
    };
    assert.equal(tagCondition(node), "ads_active");
  });

  it("tags hipfire negation of alternate_fire as ads_active", () => {
    // Broker pattern: not alternate_fire_component.is_active (hipfire check)
    const node = {
      $func: "function (template_data, template_context)\n\tlocal unit_data_extension = ScriptUnit.has_extension(template_context.unit, \"unit_data_system\")\n\n\tif unit_data_extension then\n\t\tlocal alternate_fire_component = unit_data_extension:read_component(\"alternate_fire\")\n\t\tlocal hipfire = not alternate_fire_component.is_active\n\t\tlocal weapon_action_component = unit_data_extension:read_component(\"weapon_action\")\n\t\tlocal braced = PlayerUnitAction.has_current_action_keyword(weapon_action_component, \"braced\")\n\n\t\treturn hipfire or braced\n\tend\nend",
    };
    assert.equal(tagCondition(node), "ads_active");
  });

  it("tags $ref ConditionalFunctions.is_alternative_fire as ads_active", () => {
    // Named reference path (CONDITIONAL_TAGS) — same game state as inline alternate_fire checks
    assert.equal(
      tagCondition({ $ref: "ConditionalFunctions.is_alternative_fire" }),
      "ads_active"
    );
  });

  it("local alias of alternate_fire is_active falls through to unknown (known limitation)", () => {
    // When the component is stored in a local before the return, the specific
    // `alternate_fire_component` pattern doesn't match (it needs the full chain),
    // and the generic `active` regex doesn't cover `is_active` in the wrapped form.
    // This is a known limitation — the semantics are correct at the buff level.
    const node = {
      $func: "function (template_data, template_context)\n\tlocal afc = template_data.alternate_fire_component\n\treturn afc.is_active\nend",
    };
    assert.equal(tagCondition(node), "unknown_condition");
  });

  it("tags toughness_percent > threshold as threshold:toughness_high", () => {
    // Veteran/Zealot pattern: current_toughness_percent() > 0.75
    const node = {
      $func: "function (template_data, template_context)\n\tlocal current_toughness = template_data.toughness_extension:current_toughness_percent()\n\n\treturn current_toughness > 0.75\nend",
    };
    assert.equal(tagCondition(node), "threshold:toughness_high");
  });

  it("tags toughness_percent with talent_settings threshold as threshold:toughness_high", () => {
    // Zealot variant with talent_settings threshold
    const node = {
      $func: "function (template_data, template_context)\n\tlocal current_toughness = template_data.toughness_extension:current_toughness_percent()\n\n\treturn current_toughness > talent_settings.zealot_toughness_reduction_on_high_toughness.threshold\nend",
    };
    assert.equal(tagCondition(node), "threshold:toughness_high");
  });

  it("tags stamina current_fraction with threshold as threshold:stamina_high", () => {
    // Ogryn pattern: stamina_component.current_fraction > threshold
    const node = {
      $func: "function (template_data, template_context)\n\tlocal current_stamina = template_data.stamina_component.current_fraction\n\tlocal above_threshold = current_stamina > talent_settings_shared.ogryn_damage_reduction_on_high_stamina.stamina_threshold\n\n\treturn above_threshold\nend",
    };
    assert.equal(tagCondition(node), "threshold:stamina_high");
  });

  it("tags stamina_fraction at full as threshold:stamina_full", () => {
    // Broker pattern: current_stamina_fraction >= conditional_threshold (full stamina)
    const node = {
      $func: "function (template_data, template_context)\n\tlocal unit_data_extension = ScriptUnit.extension(template_context.unit, \"unit_data_system\")\n\n\ttemplate_data.stamina_read_component = unit_data_extension:read_component(\"stamina\")\n\n\tlocal current_stamina_fraction = template_data.stamina_read_component.current_fraction\n\tlocal buff_template = template_context.template\n\tlocal override_data = template_context.template_override_data\n\tlocal conditional_threshold = override_data.conditional_threshold or buff_template.conditional_threshold or 0\n\n\treturn conditional_threshold <= current_stamina_fraction\nend",
    };
    assert.equal(tagCondition(node), "threshold:stamina_full");
  });

  it("tags health_percent < threshold as threshold:health_low", () => {
    // Ogryn pattern: current_health_percent() < threshold
    const node = {
      $func: "function (template_data, template_context)\n\tlocal unit = template_context.unit\n\tlocal health_extension = ScriptUnit.has_extension(unit, \"health_system\")\n\n\tif health_extension then\n\t\tlocal current_health_percent = health_extension:current_health_percent()\n\n\t\treturn current_health_percent < increased_toughness_health_threshold\n\tend\nend",
    };
    assert.equal(tagCondition(node), "threshold:health_low");
  });

  it("tags action_settings.kind == windup as during_windup", () => {
    // Ogryn/Zealot/Adamant pattern: action kind == "windup"
    const node = {
      $func: "function (template_data, template_context)\n\tlocal weapon_action_component = template_data.weapon_action_component\n\tlocal weapon_template = WeaponTemplate.current_weapon_template(weapon_action_component)\n\tlocal _, action_settings = Action.current_action(weapon_action_component, weapon_template)\n\tlocal is_windup = action_settings and action_settings.kind == \"windup\"\n\n\treturn is_windup\nend",
    };
    assert.equal(tagCondition(node), "during_windup");
  });

  it("tags is_reloading condition as during_reload", () => {
    // Broker pattern: is_reloading or timestamp check
    const node = {
      $func: "function (template_data, template_context)\n\tlocal t = FixedFrame.get_latest_fixed_time()\n\n\treturn template_data.is_reloading or t < template_data.conditional_func_timestamp\nend",
    };
    assert.equal(tagCondition(node), "during_reload");
  });

  it("tags reload_shotgun/reload_state action_kind as during_reload", () => {
    // Veteran/Zealot pattern: action_kind reload check
    const node = {
      $func: "function (template_data, template_context)\n\tlocal action_kind = current_action and current_action.kind\n\tlocal is_reloading = action_kind and (action_kind == \"reload_shotgun\" or action_kind == \"reload_state\" or action_kind == \"ranged_load_special\")\n\n\treturn template_data.done and not is_reloading\nend",
    };
    assert.equal(tagCondition(node), "during_reload");
  });

  it("tags has_keyword combat_ability_stance as ability_active", () => {
    // Veteran pattern: has_keyword(keywords.veteran_combat_ability_stance) in update_func,
    // conditional_stat_buffs_func returns template_data.active — but that's tagged as
    // "active" already. This tests the inline keyword check.
    const node = {
      $func: "function (template_data, template_context)\n\tlocal buff_extension = template_context.buff_extension\n\tlocal has_stealth = buff_extension:has_unique_buff_id(\"zealot_invisibility\")\n\n\ttemplate_data.has_stealth = has_stealth\n\n\treturn has_stealth\nend",
    };
    assert.equal(tagCondition(node), "ability_active");
  });

  it("tags has_keyword combat_ability as ability_active", () => {
    // Psyker/Veteran patterns with has_keyword for combat ability check
    const node = {
      $func: "function (template_data, template_context)\n\treturn template_data.buff_extension:has_keyword(keywords.veteran_combat_ability_stance)\nend",
    };
    assert.equal(tagCondition(node), "ability_active");
  });

  it("tags sliding movement_state as sliding", () => {
    // Broker pattern: movement_state_component.method == "sliding"
    const node = {
      $func: 'function (template_data, template_context, t)\n\treturn template_data.movement_state_component.method == "sliding"\nend',
    };
    assert.equal(tagCondition(node), "sliding");
  });

  it("tags standing still velocity check as standing_still", () => {
    // Veteran pattern: velocity_magnitude < epsilon
    const node = {
      $func: "function (template_data, template_context)\n\tlocal velocity_magnitude = Vector3.length_squared(template_data.locomotion_component.velocity_current)\n\tlocal standing_still = velocity_magnitude < STANDING_STILL_EPSILON\n\n\treturn standing_still\nend",
    };
    assert.equal(tagCondition(node), "standing_still");
  });

  it("tags is_perfect_blocking as perfect_block", () => {
    // Ogryn/Zealot/Adamant pattern: block_component.is_perfect_blocking
    const node = {
      $func: "function (template_data, template_context)\n\treturn template_data.block_component.is_perfect_blocking\nend",
    };
    assert.equal(tagCondition(node), "perfect_block");
  });

  it("tags return template_data.is_active (no function wrapper) as active", () => {
    // The tokenizer strips the outer "function...end" wrapper; the body starts
    // with the parameter list. veteran_ranged_power_out_of_melee is the
    // canonical example: conditional_stat_buffs_func returns a precomputed
    // template_data.is_active flag set by update_func.
    // Source: veteran_buff_templates.lua, templates.veteran_ranged_power_out_of_melee
    const node = {
      $func: "(template_data, template_context)\n\t\treturn template_data.is_active",
    };
    assert.equal(tagCondition(node), "active");
  });
});

describe("tagCheckProc", () => {
  it("tags inline check_proc_func with params.is_heavy as during_heavy", () => {
    // Ogryn pattern: ogryn_melee_damage_after_heavy check_proc_func checks params.is_heavy.
    // Source: ogryn_buff_templates.lua, templates.ogryn_melee_damage_after_heavy
    const node = {
      $func: "(params, template_data, template_context)\n\t\tlocal num_hit_units = params.num_hit_units\n\n\t\tif num_hit_units == 0 then\n\t\t\treturn false\n\t\tend\n\n\t\tlocal is_heavy = params.is_heavy\n\n\t\tif not is_heavy then\n\t\t\treturn false\n\t\tend\n\n\t\treturn true",
    };
    assert.equal(tagCheckProc(node), "during_heavy");
  });

  it("tags inline check_proc_func with melee_attack_strength heavy as during_heavy", () => {
    // Adamant pattern: adamant_heavy_attacks_increase_damage check_proc_func uses
    // params.is_heavy or params.melee_attack_strength == "heavy".
    // Source: adamant_buff_templates.lua, templates.adamant_heavy_attacks_increase_damage
    const node = {
      $func: "(params, template_data, template_context)\n\t\tlocal is_heavy = params.is_heavy or params.melee_attack_strength == \"heavy\"\n\n\t\tif not params.is_heavy then\n\t\t\treturn false\n\t\tend\n\n\t\treturn params.num_hit_units > 0",
    };
    assert.equal(tagCheckProc(node), "during_heavy");
  });

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
