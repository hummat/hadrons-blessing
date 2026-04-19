import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { parseLuaTable, extractTemplateBlocks } from "./lua-data-reader.js";

describe("parseLuaTable", () => {
  it("parses simple key-value pairs", () => {
    const lua = `{
      class_name = "buff",
      max_stacks = 1,
      predicted = false,
    }`;
    const result = parseLuaTable(lua);
    assert.deepEqual(result, {
      class_name: "buff",
      max_stacks: 1,
      predicted: false,
    });
  });

  it("parses bracket-subscript keys with enum refs", () => {
    const lua = `{
      [stat_buffs.ability_extra_charges] = 1,
      [stat_buffs.combat_ability_cooldown_modifier] = 0.33,
    }`;
    const result = parseLuaTable(lua);
    assert.deepEqual(result, {
      "stat_buffs.ability_extra_charges": 1,
      "stat_buffs.combat_ability_cooldown_modifier": 0.33,
    });
  });

  it("parses nested tables", () => {
    const lua = `{
      stat_buffs = {
        [stat_buffs.toughness] = 0.15,
      },
      keywords = { "stun_immune", "suppression_immune" },
    }`;
    const result = parseLuaTable(lua);
    assert.deepEqual(result.stat_buffs, {
      "stat_buffs.toughness": 0.15,
    });
    assert.deepEqual(result.keywords, ["stun_immune", "suppression_immune"]);
  });

  it("parses enum-ref array values (keywords.X syntax)", () => {
    const lua = `{
      keywords = {
        keywords.stun_immune,
        keywords.slowdown_immune,
      },
    }`;
    const result = parseLuaTable(lua);
    assert.deepEqual(result.keywords, [
      { $ref: "keywords.stun_immune" },
      { $ref: "keywords.slowdown_immune" },
    ]);
  });

  it("treats inline functions as opaque $func nodes", () => {
    const lua = `{
      conditional_stat_buffs_func = function(template_data, template_context)
        return template_data.active
      end,
    }`;
    const result = parseLuaTable(lua);
    assert.ok(result.conditional_stat_buffs_func.$func != null);
    assert.ok(result.conditional_stat_buffs_func.$func.includes("template_data.active"));
  });

  it("parses identifier references as $ref nodes", () => {
    const lua = `{
      conditional_stat_buffs_func = _psyker_passive_conditional_stat_buffs,
    }`;
    const result = parseLuaTable(lua);
    assert.deepEqual(result.conditional_stat_buffs_func, {
      $ref: "_psyker_passive_conditional_stat_buffs",
    });
  });

  it("parses dotted identifier references as $ref nodes", () => {
    const lua = `{
      conditional_stat_buffs = {
        [stat_buffs.ranged_damage] = talent_settings_2.combat_ability_base.ranged_damage,
      },
    }`;
    const result = parseLuaTable(lua);
    assert.deepEqual(
      result.conditional_stat_buffs["stat_buffs.ranged_damage"],
      { $ref: "talent_settings_2.combat_ability_base.ranged_damage" }
    );
  });

  it("parses arithmetic expressions as $expr nodes", () => {
    const lua = `{
      [stat_buffs.ranged_damage] = talent_settings_2.a.b - talent_settings_2.c.d,
    }`;
    const result = parseLuaTable(lua);
    const val = result["stat_buffs.ranged_damage"];
    assert.equal(val.$expr, "talent_settings_2.a.b - talent_settings_2.c.d");
    assert.equal(val.$op, "-");
  });

  it("parses negative number literals", () => {
    const lua = `{
      [stat_buffs.spread_modifier] = -0.3,
    }`;
    const result = parseLuaTable(lua);
    assert.equal(result["stat_buffs.spread_modifier"], -0.3);
  });

  it("parses function call values as $call nodes", () => {
    const lua = `{
      check_proc_func = CheckProcFunctions.all(CheckProcFunctions.on_item_match, CheckProcFunctions.on_melee_hit),
    }`;
    const result = parseLuaTable(lua);
    assert.equal(result.check_proc_func.$call, "CheckProcFunctions.all");
    assert.equal(result.check_proc_func.$args.length, 2);
  });

  it("handles proc_events with bracket keys", () => {
    const lua = `{
      proc_events = {
        [proc_events.on_kill] = 1,
        [proc_events.on_combat_ability] = 0.5,
      },
    }`;
    const result = parseLuaTable(lua);
    assert.deepEqual(result.proc_events, {
      "proc_events.on_kill": 1,
      "proc_events.on_combat_ability": 0.5,
    });
  });

  it("ignores Lua line comments inside tables", () => {
    const lua = `{
      -- this is a comment
      class_name = "buff", -- inline comment
      max_stacks = 1,
    }`;
    const result = parseLuaTable(lua);
    assert.equal(result.class_name, "buff");
    assert.equal(result.max_stacks, 1);
  });

  it("ignores Lua block comments inside tables", () => {
    const lua = `{
      --[[ this is a
      multi-line block comment ]]
      class_name = "buff",
      --[[ another block comment ]] max_stacks = 3,
    }`;
    const result = parseLuaTable(lua);
    assert.equal(result.class_name, "buff");
    assert.equal(result.max_stacks, 3);
  });
});

describe("extractTemplateBlocks", () => {
  it("extracts inline table definitions", () => {
    const lua = `
local templates = {}
templates.foo_buff = {
  class_name = "buff",
  max_stacks = 1,
}
return templates
`;
    const { blocks } = extractTemplateBlocks(lua);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].name, "foo_buff");
    assert.equal(blocks[0].type, "inline");
    assert.equal(blocks[0].parsed.class_name, "buff");
  });

  it("extracts table.clone statements with local sources", () => {
    const lua = `
local templates = {}
templates.foo = { class_name = "buff" }
templates.bar = table.clone(templates.foo)
return templates
`;
    const { blocks } = extractTemplateBlocks(lua);
    const bar = blocks.find((b) => b.name === "bar");
    assert.equal(bar.type, "clone");
    assert.equal(bar.cloneSource, "foo");
    assert.equal(bar.cloneExternal, false);
  });

  it("extracts table.clone statements with external base refs", () => {
    const lua = `
local templates = {}
templates.baz = table.clone(BaseWeaponTraitBuffTemplates.toughness_on_kills)
return templates
`;
    const { blocks } = extractTemplateBlocks(lua);
    const baz = blocks.find((b) => b.name === "baz");
    assert.equal(baz.type, "clone");
    assert.equal(baz.cloneSource, "BaseWeaponTraitBuffTemplates.toughness_on_kills");
    assert.equal(baz.cloneExternal, true);
  });

  it("extracts table.merge with both inline and base", () => {
    const lua = `
local templates = {}
templates.baz = table.merge({
  max_stacks = 3,
  class_name = "proc_buff",
}, BaseTemplates.some_base)
return templates
`;
    const { blocks } = extractTemplateBlocks(lua);
    const baz = blocks.find((b) => b.name === "baz");
    assert.equal(baz.type, "merge");
    assert.equal(baz.mergeInline.max_stacks, 3);
    assert.equal(baz.mergeInline.class_name, "proc_buff");
    assert.equal(baz.mergeBase, "BaseTemplates.some_base");
  });

  it("extracts post-construction scalar patches", () => {
    const lua = `
local templates = {}
templates.foo = table.clone(templates.base)
templates.foo.duration = 5
templates.foo.child_buff_template = "foo_child"
return templates
`;
    const { blocks } = extractTemplateBlocks(lua);
    const foo = blocks.find((b) => b.name === "foo");
    assert.deepEqual(foo.patches, {
      duration: 5,
      child_buff_template: "foo_child",
    });
  });

  it("extracts post-construction table-valued patches", () => {
    const lua = `
local templates = {}
templates.foo = table.clone(templates.base)
templates.foo.stat_buffs = {
  [stat_buffs.damage] = 0.5,
}
return templates
`;
    const { blocks } = extractTemplateBlocks(lua);
    const foo = blocks.find((b) => b.name === "foo");
    assert.deepEqual(foo.patches.stat_buffs, {
      "stat_buffs.damage": 0.5,
    });
  });

  it("extracts local function definitions", () => {
    const lua = `
local _my_condition = function(template_data, template_context)
  return template_data.active
end
local templates = {}
templates.foo = {
  conditional_stat_buffs_func = _my_condition,
}
return templates
`;
    const { blocks, localFunctions } = extractTemplateBlocks(lua);
    assert.equal(blocks[0].parsed.conditional_stat_buffs_func.$ref, "_my_condition");
    assert.ok(localFunctions._my_condition.includes("template_data.active"));
  });

  it("extracts TalentSettings alias declarations", () => {
    const lua = `
local talent_settings = TalentSettings.psyker
local talent_settings_2 = TalentSettings.psyker_2
local stimm_talent_settings = TalentSettings.broker
local templates = {}
return templates
`;
    const { aliases } = extractTemplateBlocks(lua);
    assert.equal(aliases.talent_settings, "psyker");
    assert.equal(aliases.talent_settings_2, "psyker_2");
    assert.equal(aliases.stimm_talent_settings, "broker");
  });

  it("extracts simple local scalar declarations for later semantic modeling", () => {
    const lua = `
local ABILITY_TYPE = "grenade_ability"
local grenades_restored = talent_settings_2.offensive_1_3.grenade_restored
local templates = {}
return templates
`;
    const { localScalars } = extractTemplateBlocks(lua);
    assert.equal(localScalars.ABILITY_TYPE, "grenade_ability");
    assert.deepEqual(localScalars.grenades_restored, {
      $ref: "talent_settings_2.offensive_1_3.grenade_restored",
    });
  });

  it("auto-detects the template table variable name", () => {
    const lua = `
local base_templates = {}
base_templates.foo = { class_name = "buff" }
return base_templates
`;
    const { blocks } = extractTemplateBlocks(lua);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].name, "foo");
  });

  it("ignores table.make_unique calls", () => {
    const lua = `
local templates = {}
table.make_unique(templates)
templates.foo = { class_name = "buff" }
return templates
`;
    const { blocks } = extractTemplateBlocks(lua);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].name, "foo");
  });
});
