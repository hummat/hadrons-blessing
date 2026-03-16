import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { extractEffects } from "./ground-truth/lib/buff-semantic-parser.mjs";

describe("extractEffects", () => {
  it("extracts flat stat_buffs with literal magnitudes", () => {
    const template = {
      class_name: "buff",
      max_stacks: 1,
      stat_buffs: {
        "stat_buffs.ability_extra_charges": 1,
        "stat_buffs.combat_ability_cooldown_modifier": 0.33,
      },
    };
    const calc = extractEffects(template, new Map());
    assert.equal(calc.effects.length, 2);
    assert.deepEqual(calc.effects[0], {
      stat: "ability_extra_charges",
      magnitude: 1,
      magnitude_expr: null,
      magnitude_min: null,
      magnitude_max: null,
      condition: null,
      trigger: null,
      type: "stat_buff",
    });
    assert.equal(calc.class_name, "buff");
    assert.equal(calc.max_stacks, 1);
  });

  it("resolves TalentSettings magnitude references", () => {
    const template = {
      conditional_stat_buffs: {
        "stat_buffs.ranged_damage": { $ref: "talent_settings_2.combat.ranged_damage" },
      },
    };
    const settings = new Map([["psyker_2.combat.ranged_damage", 0.25]]);
    const aliases = { talent_settings_2: "psyker_2" };
    const calc = extractEffects(template, settings, { aliases });
    assert.equal(calc.effects[0].magnitude, 0.25);
    assert.equal(calc.effects[0].type, "conditional_stat_buff");
  });

  it("stores unresolvable magnitudes as magnitude_expr", () => {
    const template = {
      stat_buffs: {
        "stat_buffs.damage": {
          $expr: "talent_settings.a.b - talent_settings.c.d",
          $op: "-",
        },
      },
    };
    const settings = new Map([["psyker.a.b", 0.5]]);
    const aliases = { talent_settings: "psyker" };
    const calc = extractEffects(template, settings, { aliases });
    assert.equal(calc.effects[0].magnitude, null);
    assert.ok(calc.effects[0].magnitude_expr.includes("-"));
  });

  it("evaluates simple arithmetic on resolved operands", () => {
    const template = {
      stat_buffs: {
        "stat_buffs.damage": {
          $expr: "talent_settings_2.a.val - talent_settings_2.b.val",
          $op: "-",
        },
      },
    };
    const settings = new Map([
      ["psyker_2.a.val", 0.5],
      ["psyker_2.b.val", 0.2],
    ]);
    const aliases = { talent_settings_2: "psyker_2" };
    const calc = extractEffects(template, settings, { aliases });
    assert.ok(Math.abs(calc.effects[0].magnitude - 0.3) < 0.001);
  });

  it("extracts proc_events as triggers", () => {
    const template = {
      class_name: "proc_buff",
      active_duration: 4,
      proc_events: {
        "proc_events.on_lunge_end": 1,
      },
      proc_stat_buffs: {
        "stat_buffs.melee_damage": 1,
      },
    };
    const calc = extractEffects(template, new Map());
    assert.equal(calc.effects[0].stat, "melee_damage");
    assert.equal(calc.effects[0].type, "proc_stat_buff");
    assert.equal(calc.effects[0].trigger, "on_lunge_end");
    assert.equal(calc.active_duration, 4);
  });

  it("extracts lerped_stat_buffs as min/max range", () => {
    const template = {
      lerped_stat_buffs: {
        "stat_buffs.damage": {
          min: 0.05,
          max: 0.25,
        },
      },
    };
    const calc = extractEffects(template, new Map());
    assert.equal(calc.effects[0].type, "lerped_stat_buff");
    assert.equal(calc.effects[0].magnitude_min, 0.05);
    assert.equal(calc.effects[0].magnitude_max, 0.25);
    assert.equal(calc.effects[0].magnitude, null);
  });

  it("extracts keywords from $ref array", () => {
    const template = {
      keywords: [
        { $ref: "keywords.stun_immune" },
        { $ref: "keywords.suppression_immune" },
      ],
    };
    const calc = extractEffects(template, new Map());
    assert.deepEqual(calc.keywords, ["stun_immune", "suppression_immune"]);
  });

  it("tags conditions from conditional_stat_buffs_func", () => {
    const template = {
      conditional_stat_buffs: {
        "stat_buffs.damage": 0.1,
      },
      conditional_stat_buffs_func: {
        $ref: "ConditionalFunctions.is_item_slot_wielded",
      },
    };
    const calc = extractEffects(template, new Map());
    assert.equal(calc.effects[0].condition, "wielded");
    assert.equal(calc.effects[0].type, "conditional_stat_buff");
  });

  it("passes localFunctions to condition tagger for local variable refs", () => {
    const template = {
      conditional_stat_buffs: {
        "stat_buffs.damage": 0.1,
      },
      conditional_stat_buffs_func: {
        $ref: "_my_local_func",
      },
    };
    const localFunctions = {
      _my_local_func: "function(td, tc)\n  return td.active\nend",
    };
    const calc = extractEffects(template, new Map(), { localFunctions });
    assert.equal(calc.effects[0].condition, "active");
  });
});
