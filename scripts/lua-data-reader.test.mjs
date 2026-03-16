import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { parseLuaTable } from "./ground-truth/lib/lua-data-reader.mjs";

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
