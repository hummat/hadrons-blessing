# Buff Semantic Extraction Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the empty `calc` field on every talent/blessing/perk entity with structured effect data extracted from the decompiled Darktide Lua buff system.

**Architecture:** Three-layer parser stack: generic Lua data literal reader → TalentSettings lookup builder → Darktide-specific buff semantic extractor. Pipeline entry point `npm run effects:build` reads Lua source files, resolves magnitudes through TalentSettings two-pass lookup, tags conditions via heuristic pattern matching, writes populated `calc` fields into entity JSON files in-place, creates `buff` entities for referenced templates, and generates `grants_buff` edge records. Integrated into `make check`.

**Tech Stack:** Node.js ESM, `node:test` + `node:assert`, AJV for schema validation. Zero runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-03-16-buff-semantic-extraction-design.md`

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `scripts/ground-truth/lib/lua-data-reader.mjs` | Generic Lua data literal reader — parses table literals, block extraction, clone/merge/patch statements |
| `scripts/ground-truth/lib/talent-settings-parser.mjs` | Reads `talent_settings_*.lua` → `Map<dotted.path, number>` lookup table |
| `scripts/ground-truth/lib/condition-tagger.mjs` | Maps Lua function references/bodies to semantic condition tags |
| `scripts/ground-truth/lib/buff-semantic-parser.mjs` | Darktide-specific orchestrator — resolves buff templates, extracts effects, produces `calc` objects |
| `scripts/extract-buff-effects.mjs` | CLI entry point for `npm run effects:build` |
| `data/ground-truth/schemas/calc.schema.json` | JSON Schema for the `calc` sub-object on entities |
| `scripts/lua-data-reader.test.mjs` | Tests for lua-data-reader |
| `scripts/talent-settings-parser.test.mjs` | Tests for talent-settings-parser |
| `scripts/condition-tagger.test.mjs` | Tests for condition-tagger |
| `scripts/buff-semantic-parser.test.mjs` | Tests for buff-semantic-parser |
| `scripts/extract-buff-effects.test.mjs` | Integration tests for the full pipeline |

### Modified files

| File | Change |
|---|---|
| `data/ground-truth/schemas/entity-base.schema.json` | Reference `calc.schema.json` from the `calc` property |
| `scripts/build-ground-truth-index.mjs` | Load and validate calc sub-schema |
| `data/ground-truth/entities/*.json` | Populated `calc` fields (written by pipeline) |
| `data/ground-truth/entities/shared-buffs.json` | New `buff` entity records for referenced buff templates |
| `data/ground-truth/edges/*.json` | New `grants_buff` edge records (written by pipeline) |
| `package.json` | Add `effects:build` script, register new test files |
| `Makefile` | Add `effects-build` target before `npm run check` in `check` |
| `scripts/ground-truth/lib/cli.mjs` | Add `effects:build` setup hint |

---

## Chunk 1: Foundation (Schema + Lua Data Reader)

### Task 1: Create calc sub-schema

**Files:**
- Create: `data/ground-truth/schemas/calc.schema.json`
- Modify: `data/ground-truth/schemas/entity-base.schema.json`

- [ ] **Step 1: Write the calc sub-schema**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "calc.schema.json",
  "title": "Entity calc (buff semantic data)",
  "description": "Structured effect data extracted from Darktide Lua buff system",
  "type": "object",
  "properties": {
    "effects": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "stat": { "type": "string", "minLength": 1 },
          "magnitude": { "type": ["number", "null"] },
          "magnitude_expr": { "type": ["string", "null"] },
          "magnitude_min": { "type": ["number", "null"] },
          "magnitude_max": { "type": ["number", "null"] },
          "condition": { "type": ["string", "null"] },
          "trigger": { "type": ["string", "null"] },
          "type": {
            "type": "string",
            "enum": [
              "stat_buff",
              "conditional_stat_buff",
              "proc_stat_buff",
              "lerped_stat_buff",
              "conditional_lerped_stat_buff",
              "stepped_stat_buff"
            ]
          }
        },
        "required": ["stat", "type"],
        "additionalProperties": false
      },
      "minItems": 1
    },
    "tiers": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "effects": {
            "type": "array",
            "items": { "$ref": "#/properties/effects/items" }
          },
          "active_duration": { "type": ["number", "null"] },
          "child_duration": { "type": ["number", "null"] },
          "max_stacks": { "type": ["integer", "null"] },
          "duration": { "type": ["number", "null"] }
        },
        "required": ["effects"],
        "additionalProperties": true
      },
      "minItems": 4,
      "maxItems": 4
    },
    "max_stacks": { "type": ["integer", "null"] },
    "duration": { "type": ["number", "null"] },
    "active_duration": { "type": ["number", "null"] },
    "keywords": {
      "type": "array",
      "items": { "type": "string" }
    },
    "class_name": { "type": ["string", "null"] },
    "buff_template_names": {
      "type": "array",
      "items": { "type": "string", "minLength": 1 },
      "minItems": 1
    }
  },
  "additionalProperties": false
}
```

- [ ] **Step 2: Update entity-base.schema.json to reference calc schema**

Change the `calc` property from `{ "type": "object" }` to `{ "oneOf": [{ "type": "object", "properties": {}, "additionalProperties": false }, { "$ref": "calc.schema.json" }] }`. This allows either empty `{}` (no calc data) or a valid calc object.

- [ ] **Step 3: Verify schema loads in index build**

Run: `npm run index:build`
Expected: PASS — existing entities with `calc: {}` still validate.

- [ ] **Step 4: Commit**

```bash
git add data/ground-truth/schemas/calc.schema.json data/ground-truth/schemas/entity-base.schema.json
git commit -m "Add calc sub-schema for buff semantic data (#7)"
```

---

### Task 2: Lua data reader — table literal parsing

**Files:**
- Create: `scripts/ground-truth/lib/lua-data-reader.mjs`
- Create: `scripts/lua-data-reader.test.mjs`

The lua-data-reader has two responsibilities: (A) parse Lua table literals into JS objects, and (B) extract named blocks from Lua files. This task covers (A).

- [ ] **Step 1: Write failing tests for table literal parsing**

Test file: `scripts/lua-data-reader.test.mjs`

```js
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/lua-data-reader.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `parseLuaTable`**

Create `scripts/ground-truth/lib/lua-data-reader.mjs` with a `parseLuaTable(luaText)` function that:

1. Tokenizes the Lua table literal into a stream of tokens: `{`, `}`, `[`, `]`, `=`, `,`, numbers, strings (double and single quoted), `true`/`false`/`nil`, identifiers (including dotted chains like `stat_buffs.foo`), `function...end` blocks (captured as opaque text), and arithmetic operators (`+`, `-`, `*`, `/`).
2. The tokenizer MUST strip `--` line comments and `--[[ ]]` block comments before tokenizing.
3. Parses the token stream recursively:
   - `{ key = value, ... }` → JS object
   - `{ value, value, ... }` (no keys) → JS array
   - `[expr] = value` → key is the string representation of expr (e.g. `"stat_buffs.toughness"`)
   - `"string"` → JS string
   - `number` → JS number (including negative literals)
   - `true`/`false` → JS boolean
   - `nil` → JS null
   - `identifier` or `dotted.chain` → `{ $ref: "identifier" }`
   - `function(...) ... end` → `{ $func: "<body text>" }`
   - `expr op expr` → `{ $expr: "<full text>", $op: "op" }`
   - `Func.name(args)` → `{ $call: "Func.name", $args: [parsed args] }`

Key implementation detail: The tokenizer must handle `function...end` by counting nested `function`/`if`/`do`/`for`/`while`...`end` pairs to find the correct closing `end`. This is the only control-flow-aware part of the parser.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/lua-data-reader.test.mjs`
Expected: All 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/lua-data-reader.mjs scripts/lua-data-reader.test.mjs
git commit -m "Add Lua data literal table parser (#7)"
```

---

### Task 3: Lua data reader — block extraction

**Files:**
- Modify: `scripts/ground-truth/lib/lua-data-reader.mjs`
- Modify: `scripts/lua-data-reader.test.mjs`

- [ ] **Step 1: Write failing tests for block extraction**

Append to `scripts/lua-data-reader.test.mjs`:

```js
import { extractTemplateBlocks } from "./ground-truth/lib/lua-data-reader.mjs";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/lua-data-reader.test.mjs`
Expected: FAIL — `extractTemplateBlocks` not exported.

- [ ] **Step 3: Implement `extractTemplateBlocks`**

Add to `scripts/ground-truth/lib/lua-data-reader.mjs`:

`extractTemplateBlocks(luaSource)` returns `{ blocks, aliases, localFunctions }`.

**Auto-detect the table variable name:** Scan for `local <var> = {}` — the first such assignment is the template table variable. Default to `"templates"` if not found. Use this variable name throughout instead of hardcoding `"templates"`.

Scans the source line-by-line for:
1. `local <var> = TalentSettings.<namespace>` → add to `aliases` map
2. `local <name> = function(...) ... end` → add body to `localFunctions` map (use `function...end` depth tracking)
3. `<tableVar>.<name> = { ... }` → inline block (use brace-depth to find closing `}`, then `parseLuaTable` on captured text)
4. `<tableVar>.<name> = table.clone(<source>)` → clone block. If source starts with `<tableVar>.`, strip prefix and set `cloneExternal: false`. Otherwise set `cloneExternal: true` and store the full reference.
5. `<tableVar>.<name> = table.merge(<inlineTable>, <baseRef>)` → merge block. Parse the inline table with `parseLuaTable`, store baseRef as string.
6. `<tableVar>.<name>.<field> = <value>` → post-construction patch. If value starts with `{`, capture the table literal and parse with `parseLuaTable`. Otherwise parse as scalar (number, string, boolean, identifier ref).
7. `table.make_unique(<tableVar>)` → skip silently.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/lua-data-reader.test.mjs`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/lua-data-reader.mjs scripts/lua-data-reader.test.mjs
git commit -m "Add Lua template block extraction (#7)"
```

---

## Chunk 2: TalentSettings + Condition Tagging

### Task 4: TalentSettings parser

**Files:**
- Create: `scripts/ground-truth/lib/talent-settings-parser.mjs`
- Create: `scripts/talent-settings-parser.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { parseTalentSettings } from "./ground-truth/lib/talent-settings-parser.mjs";

describe("parseTalentSettings", () => {
  it("parses flat numeric constants and returns dotted-path map", () => {
    const lua = `
local talent_settings = {
  psyker = {
    glass_cannon = {
      toughness_multiplier = 0.7,
      warp_charge = 0.6,
    },
  },
}
return talent_settings
`;
    const map = parseTalentSettings(lua);
    assert.equal(map.get("psyker.glass_cannon.toughness_multiplier"), 0.7);
    assert.equal(map.get("psyker.glass_cannon.warp_charge"), 0.6);
  });

  it("parses multiple namespace roots from a single file", () => {
    const lua = `
local talent_settings = {
  psyker = {
    foo = { val = 1 },
  },
  psyker_2 = {
    bar = { val = 2 },
  },
  psyker_3 = {
    baz = { val = 3 },
  },
}
return talent_settings
`;
    const map = parseTalentSettings(lua);
    assert.equal(map.get("psyker.foo.val"), 1);
    assert.equal(map.get("psyker_2.bar.val"), 2);
    assert.equal(map.get("psyker_3.baz.val"), 3);
  });

  it("handles negative values", () => {
    const lua = `
local talent_settings = {
  vet = {
    stance = { modifier = -0.15 },
  },
}
return talent_settings
`;
    const map = parseTalentSettings(lua);
    assert.equal(map.get("vet.stance.modifier"), -0.15);
  });

  it("recurses into nested tables but ignores non-numeric leaves", () => {
    const lua = `
local talent_settings = {
  psyker = {
    mixed = {
      val = 1.5,
      name = "test",
      nested = { inner = 2 },
    },
  },
}
return talent_settings
`;
    const map = parseTalentSettings(lua);
    assert.equal(map.get("psyker.mixed.val"), 1.5);
    assert.equal(map.get("psyker.mixed.nested.inner"), 2);
    assert.equal(map.has("psyker.mixed.name"), false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/talent-settings-parser.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `parseTalentSettings`**

Create `scripts/ground-truth/lib/talent-settings-parser.mjs`.

`parseTalentSettings(luaSource)`:
1. Extract the top-level table literal from the source (find `local talent_settings = { ... }` and capture the table body)
2. Use `parseLuaTable` from `lua-data-reader.mjs` to parse it
3. Recursively walk the parsed object, building dotted paths
4. For each leaf that's a JS number, insert into a `Map<string, number>`
5. Skip non-numeric leaves (strings, booleans, objects, $ref nodes)
6. Return the map

Also export `loadAllTalentSettings(sourceRoot)`:
1. Glob `scripts/settings/talent/talent_settings_*.lua` from source root
2. Parse each with `parseTalentSettings`
3. Merge into a single `Map<string, number>`
4. Return the merged map

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/talent-settings-parser.test.mjs`
Expected: All 4 tests PASS.

- [ ] **Step 5: Add source-root integration test**

Append to test file:

```js
import { loadAllTalentSettings } from "./ground-truth/lib/talent-settings-parser.mjs";

const sourceRoot = process.env.GROUND_TRUTH_SOURCE_ROOT;

describe("loadAllTalentSettings (live)", () => {
  it("loads all TalentSettings files and resolves known paths", { skip: !sourceRoot }, async () => {
    const map = await loadAllTalentSettings(sourceRoot);
    assert.ok(map.size > 500, `Expected >500 entries, got ${map.size}`);
    assert.equal(map.get("psyker_2.passive_1.on_hit_proc_chance"), 1);
  });
});
```

- [ ] **Step 6: Run tests**

Run: `node --test scripts/talent-settings-parser.test.mjs`
Expected: All tests PASS (live test runs if source root is set).

- [ ] **Step 7: Commit**

```bash
git add scripts/ground-truth/lib/talent-settings-parser.mjs scripts/talent-settings-parser.test.mjs
git commit -m "Add TalentSettings parser (#7)"
```

---

### Task 5: Condition tagger

**Files:**
- Create: `scripts/ground-truth/lib/condition-tagger.mjs`
- Create: `scripts/condition-tagger.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
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
    // Pattern from real source: inventory_component.wielded_slot
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/condition-tagger.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement condition tagger**

Create `scripts/ground-truth/lib/condition-tagger.mjs`.

**`tagCondition(node, localFunctions = {})`**:
1. If `node.$ref` starts with `ConditionalFunctions.`: look up in the known-tags map. Return the tag.
2. If `node.$call` starts with `ConditionalFunctions.all` or `.any`: recursively tag each `$args` element, join with `+`, prefix with `all:` or `any:`.
3. If `node.$ref` is a key in `localFunctions`: retrieve the function body, create a `{ $func: body }` node, recurse.
4. If `node.$func`: apply inline heuristics in order:
   - Body is essentially just `return template_data.active` (with optional variable binding) → `"active"`
   - Body contains `template_data.active` + additional logic → `"active_and_unknown"`
   - Body contains `wielded_slot` with string `"slot_primary"` or `"slot_secondary"` → extract slot name
   - Body contains `has_weapon_keyword_from_slot` → extract keyword string → `"weapon_keyword:<keyword>"`
   - Body contains `current_health`/`health_percent` → `"threshold:health"`
   - Body contains `warp_charge` → `"threshold:warp_charge"`
   - Body contains `ammo`/`clip` → `"threshold:ammo"`
   - Body contains `coherency`/`num_units` → `"coherency"`
   - Fallback: `"unknown_condition"`
5. Fallback: `"unknown_condition"`

**`tagCheckProc(node)`**:
1. If `node.$ref` starts with `CheckProcFunctions.`: strip prefix → tag
2. If `node.$call` starts with `CheckProcFunctions.all`/`.any`: recursively tag all args (may be >2), join with `+`
3. If `node.$func`: apply same inline heuristics, fallback `"unknown_condition"`
4. Fallback: `"unknown_condition"`

The known ConditionalFunctions tag map:
```js
const CONDITIONAL_TAGS = {
  "ConditionalFunctions.is_item_slot_wielded": "wielded",
  "ConditionalFunctions.is_item_slot_not_wielded": "not_wielded",
  "ConditionalFunctions.is_sprinting": "sprinting",
  "ConditionalFunctions.is_blocking": "blocking",
  "ConditionalFunctions.is_lunging": "lunging",
  "ConditionalFunctions.is_reloading": "reloading",
  "ConditionalFunctions.is_alternative_fire": "alt_fire",
  "ConditionalFunctions.has_full_toughness": "full_toughness",
  "ConditionalFunctions.has_stamina": "has_stamina",
  "ConditionalFunctions.has_empty_clip": "empty_clip",
  "ConditionalFunctions.has_high_warp_charge": "high_warp_charge",
  "ConditionalFunctions.has_high_overheat": "high_overheat",
  "ConditionalFunctions.at_max_stacks": "max_stacks",
  "ConditionalFunctions.melee_weapon_special_active": "weapon_special",
  "ConditionalFunctions.is_weapon_using_magazine": "magazine_weapon",
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/condition-tagger.test.mjs`
Expected: All 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/condition-tagger.mjs scripts/condition-tagger.test.mjs
git commit -m "Add condition tagger for buff function references (#7)"
```

---

## Chunk 3: Buff Semantic Parser

### Task 6: Buff semantic parser — core effect extraction

**Files:**
- Create: `scripts/ground-truth/lib/buff-semantic-parser.mjs`
- Create: `scripts/buff-semantic-parser.test.mjs`

- [ ] **Step 1: Write failing tests for effect extraction**

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/buff-semantic-parser.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `extractEffects`**

Create `scripts/ground-truth/lib/buff-semantic-parser.mjs`.

`extractEffects(parsedTemplate, talentSettingsMap, options = {})`:
- `options.aliases` — TalentSettings alias map `{ varName: namespace }`
- `options.localFunctions` — local function body map `{ funcName: bodyText }`
- `options.procTriggers` — extracted proc_events trigger map (for assigning triggers to proc_stat_buffs)

Steps:
1. Process `stat_buffs` → effects with `type: "stat_buff"`, resolve magnitudes
2. Process `conditional_stat_buffs` → effects with `type: "conditional_stat_buff"`, tag condition from `conditional_stat_buffs_func` using `tagCondition(node, localFunctions)`
3. Process `proc_stat_buffs` → effects with `type: "proc_stat_buff"`, assign triggers from `proc_events` keys
4. Process `lerped_stat_buffs` → effects with `type: "lerped_stat_buff"`, extract min/max from nested object
5. Process `conditional_lerped_stat_buffs` → effects with `type: "conditional_lerped_stat_buff"`, tag condition from `conditional_lerped_stat_buffs_func`
6. Process `stepped_stat_buffs` → effects with `type: "stepped_stat_buff"`
7. Extract metadata: `max_stacks`, `duration`, `active_duration`, `class_name`
8. Extract `keywords` — map `$ref` nodes by stripping the `keywords.` prefix
9. Return the assembled `calc` object

Magnitude resolution helper `resolveMagnitude(value, settingsMap, aliases)`:
- If number → return `{ magnitude: value, magnitude_expr: null }`
- If `$ref` → resolve alias prefix (`talent_settings_2.X.Y` → `psyker_2.X.Y`), look up in settingsMap. If found → return resolved number. If not → return `{ magnitude: null, magnitude_expr: originalRef }`
- If `$expr` → resolve both operands. If both resolved → evaluate (`+`, `-`, `*`, `/`) and return number. If either unresolved → return `{ magnitude: null, magnitude_expr: exprText }`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/buff-semantic-parser.test.mjs`
Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/buff-semantic-parser.mjs scripts/buff-semantic-parser.test.mjs
git commit -m "Add buff semantic parser core effect extraction (#7)"
```

---

### Task 7: Buff semantic parser — tier extraction and clone/merge resolution

**Files:**
- Modify: `scripts/ground-truth/lib/buff-semantic-parser.mjs`
- Modify: `scripts/buff-semantic-parser.test.mjs`

- [ ] **Step 1: Write failing tests for tier extraction and clone resolution**

Append to `scripts/buff-semantic-parser.test.mjs`:

```js
import { extractTiers, resolveTemplateChain } from "./ground-truth/lib/buff-semantic-parser.mjs";

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
    // External base not available — inline data is all we have
    assert.equal(resolved.get("merged").max_stacks, 3);
    assert.equal(resolved.get("merged").class_name, "proc_buff");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/buff-semantic-parser.test.mjs`
Expected: FAIL — `extractTiers` and `resolveTemplateChain` not exported.

- [ ] **Step 3: Implement tier extraction and chain resolution**

Add to `buff-semantic-parser.mjs`:

`extractTiers(tierArray, settingsMap, options)`:
- For each of the 4 tier objects, call `extractEffects` on it (tier objects have the same `stat_buffs`/`conditional_stat_buffs` fields as full templates)
- Preserve per-tier metadata fields: `active_duration`, `child_duration`, `max_stacks`, `duration` — include only if present (don't serialize absent fields as null)
- Return array of 4 tier objects

`resolveTemplateChain(blocks, externalTemplates = new Map())`:
- Build a `Map<name, resolvedTemplate>`
- Process inline blocks first — deep-copy `parsed` and apply `patches`
- Process clone blocks in dependency order (topological sort or lazy resolution for transitive chains):
  - If `cloneExternal: false` → deep-copy from resolved local template, apply patches
  - If `cloneExternal: true` → look up in `externalTemplates` map. If found, deep-copy and apply patches. If not found, create a stub with patches only (log warning).
- Process merge blocks:
  - Start with deep-copy of `mergeInline`
  - If `mergeBaseExternal: false` → get resolved local template, overwrite inline keys (second-arg-wins)
  - If `mergeBaseExternal: true` → look up in `externalTemplates`, overwrite if found
  - Apply patches on top
- Return resolved map

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/buff-semantic-parser.test.mjs`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/buff-semantic-parser.mjs scripts/buff-semantic-parser.test.mjs
git commit -m "Add tier extraction and template chain resolution (#7)"
```

---

### Task 8: Buff semantic parser — talent-to-buff linking

**Files:**
- Modify: `scripts/ground-truth/lib/buff-semantic-parser.mjs`
- Modify: `scripts/buff-semantic-parser.test.mjs`

- [ ] **Step 1: Write failing tests for talent linking**

Append to `scripts/buff-semantic-parser.test.mjs`:

```js
import { extractTalentBuffLinks } from "./ground-truth/lib/buff-semantic-parser.mjs";

describe("extractTalentBuffLinks", () => {
  it("extracts single buff_template_name", () => {
    const talentLua = `
local talents = {}
talents.my_talent = {
  passive = {
    buff_template_name = "my_talent_buff",
  },
}
return talents
`;
    const links = extractTalentBuffLinks(talentLua);
    assert.deepEqual(links.get("my_talent"), ["my_talent_buff"]);
  });

  it("extracts array buff_template_name", () => {
    const talentLua = `
local talents = {}
talents.multi_talent = {
  passive = {
    buff_template_name = { "buff_a", "buff_b", "buff_c" },
  },
}
return talents
`;
    const links = extractTalentBuffLinks(talentLua);
    assert.deepEqual(links.get("multi_talent"), ["buff_a", "buff_b", "buff_c"]);
  });

  it("skips talents without passive.buff_template_name", () => {
    const talentLua = `
local talents = {}
talents.no_buff = {
  passive = {
    identifier = "just_passive",
  },
}
return talents
`;
    const links = extractTalentBuffLinks(talentLua);
    assert.equal(links.has("no_buff"), false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/buff-semantic-parser.test.mjs`
Expected: FAIL — `extractTalentBuffLinks` not exported.

- [ ] **Step 3: Implement talent-to-buff linking**

Add to `buff-semantic-parser.mjs`:

`extractTalentBuffLinks(talentLuaSource)`:
1. Use `extractTemplateBlocks` with the auto-detected variable name (talent files use `local talents = {}`)
2. For each block, look for `passive.buff_template_name` in the parsed table
3. If it's a string → wrap in array `[name]`
4. If it's an array of strings → use as-is
5. Return `Map<talentInternalName, string[]>`

Note: `extractTemplateBlocks` auto-detects the table variable name from `local <var> = {}`, so it handles both `templates` (buff files) and `talents` (talent files) without explicit configuration.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/buff-semantic-parser.test.mjs`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/buff-semantic-parser.mjs scripts/buff-semantic-parser.test.mjs
git commit -m "Add talent-to-buff template linking (#7)"
```

---

## Chunk 4: Pipeline Integration

### Task 9: CLI entry point — `extract-buff-effects.mjs`

**Files:**
- Create: `scripts/extract-buff-effects.mjs`
- Modify: `package.json`
- Modify: `scripts/ground-truth/lib/cli.mjs`

- [ ] **Step 1: Implement the pipeline orchestrator**

Create `scripts/extract-buff-effects.mjs` following the pattern from `extract-tree-edges.mjs`:

```js
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { validateSourceSnapshot } from "./ground-truth/lib/validate.mjs";
import { ENTITIES_ROOT, EDGES_ROOT, loadJsonFile } from "./ground-truth/lib/load.mjs";
import { runCliMain } from "./ground-truth/lib/cli.mjs";
import { loadAllTalentSettings } from "./ground-truth/lib/talent-settings-parser.mjs";
import { extractTemplateBlocks } from "./ground-truth/lib/lua-data-reader.mjs";
import {
  extractEffects,
  extractTiers,
  resolveTemplateChain,
  extractTalentBuffLinks,
} from "./ground-truth/lib/buff-semantic-parser.mjs";

await runCliMain("effects:build", async () => {
  const { source_root: sourceRoot, id: snapshotId } = validateSourceSnapshot();

  // Phase 1: Load TalentSettings
  const settingsMap = await loadAllTalentSettings(sourceRoot);
  console.log(`Loaded ${settingsMap.size} TalentSettings entries`);

  // Phase 2: Load + resolve buff templates from all source files
  const BUFF_TEMPLATE_FILES = [
    // Glob patterns relative to sourceRoot
    ...globLuaFiles(sourceRoot, "scripts/settings/buff/archetype_buff_templates"),
    ...globLuaFiles(sourceRoot, "scripts/settings/buff/weapon_traits_buff_templates"),
    join("scripts/settings/buff/gadget_buff_templates.lua"),
    join("scripts/settings/buff/player_buff_templates.lua"),
    join("scripts/settings/buff/common_buff_templates.lua"),
    join("scripts/settings/buff/weapon_buff_templates.lua"),
  ];

  // For each file: extractTemplateBlocks → collect blocks + aliases + localFunctions
  // resolveTemplateChain across all files (handling cross-file clones via externalTemplates)
  // Result: allResolvedTemplates Map<name, resolvedTemplate>
  //         allAliases Map<varName, namespace> per file
  //         allLocalFunctions Map<funcName, body> per file

  // Phase 3: Load talent → buff_template_name links
  const TALENT_FILES = globLuaFiles(sourceRoot,
    "scripts/settings/ability/archetype_talents/talents");
  // For each file: extractTalentBuffLinks → merge into talentLinks Map

  // Phase 4: Load weapon trait tier data
  const TRAIT_FILES = globLuaFiles(sourceRoot,
    "scripts/settings/equipment/weapon_traits");
  // For each bespoke file: extract tier arrays keyed by trait name

  // Phase 5: Load existing entity files
  const entityFiles = readdirSync(ENTITIES_ROOT).filter(f => f.endsWith(".json"));
  const entityIndex = new Map(); // id → { entity, fileBasename }
  for (const file of entityFiles) {
    const entities = loadJsonFile(join(ENTITIES_ROOT, file));
    for (const entity of entities) {
      entityIndex.set(entity.id, { entity, file });
    }
  }

  // Phase 6: Match and populate calc fields
  let populated = 0, partial = 0, zero = 0;
  let unknownArchetype = 0, totalArchetype = 0;
  let unknownWeapon = 0, totalWeapon = 0;

  // For each talent entity: find buff_template_name link → look up resolved template
  //   → extractEffects with per-file aliases + localFunctions → write calc
  // For each weapon trait entity: find resolved template + tier data
  //   → extractEffects for base + extractTiers → write calc
  // For gadget trait entities: match by internal_name to gadget buff templates
  // For stat node entities: match by attributes.family to player buff templates

  // Track metrics per entity

  // Phase 7: Create buff entities for referenced templates
  // For each buff_template_name that doesn't have a buff entity yet,
  // create one with: kind: "buff", domain: appropriate domain or "shared",
  // calc populated from the template, status: "source_backed"
  const newBuffEntities = []; // accumulated during Phase 6

  // Phase 8: Write updated entity files (preserve key order, 2-space indent, trailing newline)
  const modifiedFiles = new Set();
  for (const [id, { entity, file }] of entityIndex) {
    if (entity.calc && Object.keys(entity.calc).length > 0) {
      modifiedFiles.add(file);
    }
  }
  for (const file of modifiedFiles) {
    const entities = [...entityIndex.values()]
      .filter(e => e.file === file)
      .map(e => e.entity);
    writeFileSync(join(ENTITIES_ROOT, file), JSON.stringify(entities, null, 2) + "\n");
  }

  // Phase 9: Generate grants_buff edges
  // For each talent with buff_template_names, create edge records
  // Only where BOTH from_entity_id and to_entity_id exist in entityIndex
  // (buff entities created in Phase 7 are now in the index)

  // Phase 10: Write edge files (append to existing domain edge files or create new ones)
  // Read existing edges, add new grants_buff edges, write back

  // Phase 11: Report summary
  console.log(`Populated: ${populated}, Partial: ${partial}, Zero: ${zero}`);
  console.log(`Unknown conditions — archetype: ${unknownArchetype}/${totalArchetype}, weapon: ${unknownWeapon}/${totalWeapon}`);
});

function globLuaFiles(sourceRoot, relDir) {
  return readdirSync(join(sourceRoot, relDir))
    .filter(f => f.endsWith(".lua"))
    .map(f => join(relDir, f));
}
```

**Key implementation details for Phase 6 (entity matching):**

Each entity kind has a different matching strategy:

1. **Talents** (ability, aura, keystone, talent, talent_modifier): Look up `internal_name` in talentLinks map → get `buff_template_name(s)` → look up each in allResolvedTemplates → `extractEffects` with the per-file aliases/localFunctions that came from the buff template's source file → merge effects from multiple templates into one `calc.effects[]` → set `calc.buff_template_names`

2. **Weapon traits** (weapon_trait kind): Look up `internal_name` in allResolvedTemplates directly (trait name = template name) → `extractEffects` for base template → also look up tier data from bespoke files → `extractTiers` → set both `calc.effects` and `calc.tiers`

3. **Weapon perks** (weapon_perk kind): Same as weapon traits but simpler — no tiers, just `extractEffects`

4. **Gadget traits** (gadget_trait kind): Look up `internal_name` in allResolvedTemplates (from `gadget_buff_templates.lua`)

5. **Stat nodes** (stat_node kind): Look up `attributes.family` in allResolvedTemplates (from `player_buff_templates.lua`)

**Key implementation detail for Phase 7 (buff entity creation):**

For each `buff_template_name` referenced in a talent's `passive.buff_template_name` that generates a `grants_buff` edge, ensure a `buff` entity exists. Create new buff entities in the appropriate domain file (e.g. `psyker` talents → `psyker.json` buff entities, shared templates → `shared-buffs.json`). Set `status: "source_backed"`, `refs` pointing to the buff template definition line in the source file.

**Key implementation detail for Phase 10 (edge file merge):**

Read existing edge JSON files per domain. Filter out any existing `grants_buff` edges (to support idempotent re-runs). Append newly generated `grants_buff` edges. Write back.

- [ ] **Step 2: Register script and tests in package.json**

Add to `package.json` scripts:
```json
"effects:build": "node scripts/extract-buff-effects.mjs"
```

Add all 5 new test files to the `test` script's file list:
`scripts/lua-data-reader.test.mjs scripts/talent-settings-parser.test.mjs scripts/condition-tagger.test.mjs scripts/buff-semantic-parser.test.mjs scripts/extract-buff-effects.test.mjs`

Add `effects:build` setup hint to `scripts/ground-truth/lib/cli.mjs` in the setup hints section.

- [ ] **Step 3: Run the pipeline on real source**

Run: `npm run effects:build`
Expected: Pipeline runs, populates calc fields, creates buff entities, generates edges, reports metrics. Iterative debugging likely needed against real Lua patterns.

- [ ] **Step 4: Verify idempotency**

Run: `npm run effects:build` a second time.
Run: `git diff data/ground-truth/` — expect zero changes.

- [ ] **Step 5: Commit**

```bash
git add scripts/extract-buff-effects.mjs scripts/ground-truth/lib/cli.mjs package.json
git commit -m "Add effects:build pipeline entry point (#7)"
```

---

### Task 10: Integration tests

**Files:**
- Create: `scripts/extract-buff-effects.test.mjs`

- [ ] **Step 1: Write integration tests**

```js
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ENTITIES_ROOT, EDGES_ROOT } from "./ground-truth/lib/load.mjs";

const sourceRoot = process.env.GROUND_TRUTH_SOURCE_ROOT;

describe("effects:build pipeline", () => {
  it("runs without errors", { skip: !sourceRoot }, () => {
    const result = spawnSync(process.execPath, ["scripts/extract-buff-effects.mjs"], {
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, GROUND_TRUTH_SOURCE_ROOT: sourceRoot },
    });
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);
    assert.ok(result.stdout.includes("Populated:"), "Expected summary output");
  });

  it("populates calc on known psyker talent", { skip: !sourceRoot }, () => {
    const entities = JSON.parse(
      readFileSync(join(ENTITIES_ROOT, "psyker.json"), "utf8")
    );
    const talent = entities.find(
      (e) => e.internal_name === "psyker_overcharge_reduced_toughness_damage_taken"
    );
    assert.ok(talent, "Expected to find psyker talent");
    assert.ok(talent.calc.effects?.length > 0, "Expected non-empty calc.effects");
    assert.ok(talent.calc.buff_template_names?.length > 0, "Expected buff_template_names");
  });

  it("populates tiers on known weapon trait", { skip: !sourceRoot }, () => {
    const entities = JSON.parse(
      readFileSync(join(ENTITIES_ROOT, "shared-weapon-traits.json"), "utf8")
    );
    // Find any weapon trait entity that should have tiers
    const trait = entities.find(
      (e) => e.kind === "weapon_trait" && e.calc?.tiers?.length === 4
    );
    assert.ok(trait, "Expected at least one weapon trait with 4 tiers");
    assert.ok(trait.calc.tiers[0].effects.length > 0, "Expected effects in tier 0");
  });

  it("generates grants_buff edges", { skip: !sourceRoot }, () => {
    const edgeFiles = ["psyker.json", "veteran.json", "zealot.json", "ogryn.json"];
    let grantsBuff = 0;
    for (const file of edgeFiles) {
      try {
        const edges = JSON.parse(readFileSync(join(EDGES_ROOT, file), "utf8"));
        grantsBuff += edges.filter((e) => e.type === "grants_buff").length;
      } catch { /* file may not exist */ }
    }
    assert.ok(grantsBuff > 0, `Expected grants_buff edges, got ${grantsBuff}`);
  });

  it("is idempotent", { skip: !sourceRoot }, () => {
    // Pipeline already ran in first test. Run again and check for changes.
    spawnSync(process.execPath, ["scripts/extract-buff-effects.mjs"], {
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, GROUND_TRUTH_SOURCE_ROOT: sourceRoot },
    });
    const diff = spawnSync("git", ["diff", "--stat", "data/ground-truth/"], {
      encoding: "utf8",
    });
    assert.equal(diff.stdout.trim(), "", "Expected no changes after second run");
  });
});
```

Note: These tests are gated on source root. The first test runs the pipeline; subsequent tests verify its output. Tests are ordered so the pipeline runs first.

- [ ] **Step 2: Run tests**

Run: `node --test scripts/extract-buff-effects.test.mjs`
Expected: All tests PASS (with source root set).

- [ ] **Step 3: Commit**

```bash
git add scripts/extract-buff-effects.test.mjs
git commit -m "Add integration tests for effects:build pipeline (#7)"
```

---

### Task 11: Makefile + `make check` integration

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Add `effects-build` target to Makefile**

Add a new phony target `effects-build` that runs `npm run effects:build` with the source root. Add it as a dependency of `check`, after `edges-build`:

```makefile
.PHONY: effects-build
effects-build: require-source-root
	GROUND_TRUTH_SOURCE_ROOT="$(GROUND_TRUTH_SOURCE_ROOT)" npm run effects:build

.PHONY: check
check: require-source-root edges-build effects-build
	GROUND_TRUTH_SOURCE_ROOT="$(GROUND_TRUTH_SOURCE_ROOT)" npm run check
```

- [ ] **Step 2: Verify full quality gate**

Run: `make check`
Expected: `edges:build` → `effects:build` → `index:build` → tests → `index:check` all pass.

- [ ] **Step 3: Commit**

```bash
git add Makefile
git commit -m "Integrate effects:build into make check (#7)"
```

---

### Task 12: Acceptance verification and final commits

**Files:**
- No new files — verification task

- [ ] **Step 1: Run full quality gate and verify acceptance criteria**

Run: `make check`

Verify:
1. Every talent/blessing/perk entity with a `buff_template_name` has non-empty `calc.effects[]`
2. Blessing entities have `calc.tiers` with exactly 4 tier objects
3. Unknown condition rates within targets (archetype <15%, weapon trait <5%)
4. `make check` passes
5. Zero runtime dependencies added (check `package.json` dependencies)
6. Pipeline is idempotent (run twice, `git diff` shows nothing)
7. Coverage metrics reported in pipeline output

- [ ] **Step 2: Commit all populated entity and edge data**

Only proceed if Step 1 passes completely.

```bash
git add data/ground-truth/entities/ data/ground-truth/edges/
git commit -m "Populate calc fields on entity records via effects:build (#7)"
```

- [ ] **Step 3: Update CLAUDE.md**

Add `npm run effects:build` to the Commands section. Add notes about calc fields to Data Architecture. Update Open Issues to reflect #7 status.

```bash
git add CLAUDE.md
git commit -m "Update CLAUDE.md with effects:build documentation (#7)"
```
