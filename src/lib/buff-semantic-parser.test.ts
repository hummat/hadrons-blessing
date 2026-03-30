// @ts-nocheck
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { extractEffects, extractTiers, resolveTemplateChain, extractTalentBuffLinks } from "./buff-semantic-parser.js";

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

describe("extractTiers", () => {
  it("extracts 4-tier blessing data with per-tier metadata", () => {
    const tierData = [
      { stat_buffs: { "stat_buffs.melee_power_level_modifier": 0.24 }, child_duration: 3.5 },
      { stat_buffs: { "stat_buffs.melee_power_level_modifier": 0.28 }, child_duration: 3.5 },
      { stat_buffs: { "stat_buffs.melee_power_level_modifier": 0.32 }, child_duration: 3.5 },
      { stat_buffs: { "stat_buffs.melee_power_level_modifier": 0.36 }, child_duration: 3.5 },
    ];
    const tiers = extractTiers(tierData, new Map());
    assert.equal(tiers.length, 4);
    assert.equal(tiers[0].effects[0].stat, "melee_power_level_modifier");
    assert.equal(tiers[0].effects[0].magnitude, 0.24);
    assert.equal(tiers[0].child_duration, 3.5);
  });

  it("handles mixed stat_buffs + conditional_stat_buffs per tier", () => {
    const tierData = [
      {
        stat_buffs: { "stat_buffs.spread_modifier": -0.3 },
        conditional_stat_buffs: { "stat_buffs.damage_near": 0.06 },
      },
      {
        stat_buffs: { "stat_buffs.spread_modifier": -0.3 },
        conditional_stat_buffs: { "stat_buffs.damage_near": 0.09 },
      },
      {
        stat_buffs: { "stat_buffs.spread_modifier": -0.3 },
        conditional_stat_buffs: { "stat_buffs.damage_near": 0.12 },
      },
      {
        stat_buffs: { "stat_buffs.spread_modifier": -0.3 },
        conditional_stat_buffs: { "stat_buffs.damage_near": 0.15 },
      },
    ];
    const tiers = extractTiers(tierData, new Map());
    assert.equal(tiers[0].effects.length, 2);
    assert.equal(tiers[0].effects[0].type, "stat_buff");
    assert.equal(tiers[0].effects[1].type, "conditional_stat_buff");
    assert.equal(tiers[3].effects[1].magnitude, 0.15);
  });
});

describe("resolveTemplateChain", () => {
  it("resolves table.clone chains with patches", () => {
    const blocks = [
      { name: "base", type: "inline", parsed: { class_name: "buff", max_stacks: 1, stat_buffs: { "stat_buffs.toughness": 0.1 } }, patches: {} },
      { name: "derived", type: "clone", cloneSource: "base", cloneExternal: false, patches: { duration: 5 } },
    ];
    const resolved = resolveTemplateChain(blocks);
    assert.equal(resolved.get("derived").class_name, "buff");
    assert.equal(resolved.get("derived").max_stacks, 1);
    assert.equal(resolved.get("derived").duration, 5);
    assert.deepEqual(resolved.get("derived").stat_buffs, { "stat_buffs.toughness": 0.1 });
  });

  it("resolves transitive clones (A → B → C)", () => {
    const blocks = [
      { name: "root", type: "inline", parsed: { class_name: "buff", max_stacks: 2 }, patches: {} },
      { name: "mid", type: "clone", cloneSource: "root", cloneExternal: false, patches: { duration: 3 } },
      { name: "leaf", type: "clone", cloneSource: "mid", cloneExternal: false, patches: { max_stacks: 5 } },
    ];
    const resolved = resolveTemplateChain(blocks);
    assert.equal(resolved.get("leaf").class_name, "buff");
    assert.equal(resolved.get("leaf").duration, 3);
    assert.equal(resolved.get("leaf").max_stacks, 5);
  });

  it("resolves table.merge with second-arg-wins semantics", () => {
    const blocks = [
      { name: "base_tmpl", type: "inline", parsed: { class_name: "buff", max_stacks: 1 }, patches: {} },
      {
        name: "merged",
        type: "merge",
        mergeInline: { max_stacks: 3, class_name: "proc_buff" },
        mergeBase: "base_tmpl",
        mergeBaseExternal: false,
        patches: {},
      },
    ];
    const resolved = resolveTemplateChain(blocks);
    // Second arg (base_tmpl) wins on collision: class_name → "buff", max_stacks → 1
    assert.equal(resolved.get("merged").class_name, "buff");
    assert.equal(resolved.get("merged").max_stacks, 1);
  });

  it("uses mergeInline data when mergeBase is external and unresolvable", () => {
    const blocks = [
      {
        name: "merged",
        type: "merge",
        mergeInline: { max_stacks: 3, class_name: "proc_buff" },
        mergeBase: "ExternalModule.some_base",
        mergeBaseExternal: true,
        patches: {},
      },
    ];
    const resolved = resolveTemplateChain(blocks);
    assert.equal(resolved.get("merged").max_stacks, 3);
    assert.equal(resolved.get("merged").class_name, "proc_buff");
  });
});

describe("extractTalentBuffLinks", () => {
  it("extracts single buff_template_name", () => {
    const talentLua = `
local archetype_talents = {
\tarchetype = "test",
\ttalents = {
\t\tmy_talent = {
\t\t\tdescription = "test",
\t\t\tpassive = {
\t\t\t\tbuff_template_name = "my_talent_buff",
\t\t\t\tidentifier = "my_talent",
\t\t\t},
\t\t},
\t},
}
return archetype_talents
`;
    const links = extractTalentBuffLinks(talentLua);
    assert.deepEqual(links.get("my_talent"), ["my_talent_buff"]);
  });

  it("extracts array buff_template_name", () => {
    const talentLua = `
local archetype_talents = {
\tarchetype = "test",
\ttalents = {
\t\tmulti_talent = {
\t\t\tdescription = "test",
\t\t\tpassive = {
\t\t\t\tbuff_template_name = { "buff_a", "buff_b", "buff_c" },
\t\t\t},
\t\t},
\t},
}
return archetype_talents
`;
    const links = extractTalentBuffLinks(talentLua);
    assert.deepEqual(links.get("multi_talent"), ["buff_a", "buff_b", "buff_c"]);
  });

  it("skips talents without passive.buff_template_name", () => {
    const talentLua = `
local archetype_talents = {
\tarchetype = "test",
\ttalents = {
\t\tno_buff = {
\t\t\tdescription = "test",
\t\t\tpassive = {
\t\t\t\tidentifier = "just_passive",
\t\t\t},
\t\t},
\t},
}
return archetype_talents
`;
    const links = extractTalentBuffLinks(talentLua);
    assert.equal(links.has("no_buff"), false);
  });
});
