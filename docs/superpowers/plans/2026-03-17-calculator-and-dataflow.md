# Calculator and Dataflow Layer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full 13-stage damage calculator from decompiled source, enabling `npm run calc` CLI and filling the two null scoring dimensions (`breakpoint_relevance`, `difficulty_scaling`).

**Architecture:** Two build-time extraction pipelines (`breeds:build`, `profiles:build`) generate JSON from decompiled Lua. A pure-function calculator engine consumes the generated data + buff effects from the index. Scoring integration wires calculator output into the existing `generateScorecard()`.

**Tech Stack:** Node.js ESM, `node:test` + `node:assert`, no new dependencies. Reuses `lua-data-reader.mjs` for Lua parsing.

**Spec:** `docs/superpowers/specs/2026-03-17-calculator-and-dataflow-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `scripts/ground-truth/lib/condition-tagger.mjs` | Modify | Add ~10 new condition patterns for calculator flags |
| `scripts/condition-tagger.test.mjs` | Modify | Add tests for new condition tags |
| `scripts/extract-breed-data.mjs` | Create | `breeds:build` pipeline — extract breed HP, armor, hitzones, difficulty scaling |
| `scripts/extract-breed-data.test.mjs` | Create | Tests for breed extraction |
| `scripts/extract-damage-profiles.mjs` | Create | `profiles:build` pipeline — extract weapon damage profiles + action maps |
| `scripts/extract-damage-profiles.test.mjs` | Create | Tests for profile extraction |
| `scripts/ground-truth/lib/damage-calculator.mjs` | Create | Core 13-stage pipeline, buff stack assembly, breakpoint matrix |
| `scripts/damage-calculator.test.mjs` | Create | Unit tests per stage + integration tests |
| `scripts/ground-truth/lib/breakpoint-checklist.mjs` | Create | Scoring policy — which breakpoints matter, at what weights |
| `data/ground-truth/generated/breed-data.json` | Generated | Output of `breeds:build` (gitignored) |
| `data/ground-truth/generated/damage-profiles.json` | Generated | Output of `profiles:build` (gitignored) |
| `scripts/ground-truth/lib/build-scoring.mjs` | Modify | Add `scoreFromCalculator()` adapter (calls breakpoint-checklist.mjs), mirroring `scoreFromSynergy()` pattern |
| `data/ground-truth/breakpoint-checklist.json` | Create | Data file with checklist entries + weights (tunable without code changes) |
| `scripts/score-build.mjs` | Modify (lines ~686-739) | Pass calc output as third arg to `generateScorecard(build, synergyOutput, calcOutput)` |
| `scripts/build-scoring.test.mjs` | Modify | Add tests for new scoring dimensions |
| `scripts/calc-build.mjs` | Create | CLI entry point + text/JSON formatter for `npm run calc` |
| `scripts/calc-build.test.mjs` | Create | CLI output tests |
| `package.json` | Modify | Add scripts: `profiles:build`, `breeds:build`, `calc`, `calc:freeze`; add test files to `test` script |
| `Makefile` | Modify | Add `profiles-build`, `breeds-build` to `check` target |
| `tests/fixtures/ground-truth/calc/` | Create dir + files | Frozen golden calc snapshots |
| `tests/fixtures/ground-truth/scores/` | Modify | Re-freeze scores (now with non-null breakpoint dims) |

---

## Task 1: Condition Tagger Expansion

**Files:**
- Modify: `scripts/ground-truth/lib/condition-tagger.mjs`
- Modify: `scripts/condition-tagger.test.mjs`

This is the prerequisite for the flag-based scenario system. Without it, ~48% of conditional effects remain opaque to the calculator.

**Tag naming:** New patterns are **additive** — they do not rename existing tags (`threshold:health`, `threshold:warp_charge`). The new tags (`threshold:health_low`, `threshold:toughness_high`, `ads_active`, etc.) cover cases the existing tagger classified as `unknown_condition`. If the existing `threshold:health` tag already covers health-based conditions correctly, verify and document which existing tag maps to which calculator flag.

- [ ] **Step 1: Write failing tests for new condition tags**

Use the existing test patterns in `scripts/condition-tagger.test.mjs`. The `tagCondition` function expects inner condition nodes with `$func`, `$ref`, or `$call` keys — NOT outer buff template wrappers. Read the actual Lua templates for each pattern to get realistic node shapes.

```js
// In scripts/condition-tagger.test.mjs — add to existing describe block
// Node shapes must match what tagCondition actually receives (inner condition nodes)
it("tags ADS condition as ads_active", () => {
  // From veteran_buff_templates.lua — the conditional check references alternate_fire
  const node = { $ref: "ConditionalFunctions.is_alternative_fire" };
  assert.equal(tagCondition(node), "ads_active");
});

it("tags low health as threshold:health_low", () => {
  // From zealot_buff_templates.lua — fanatic_rage uses current_health_percent < threshold
  const node = { $func: "function(template_data, template_context) return template_context.health_extension:current_health_percent() < 0.5 end" };
  assert.equal(tagCondition(node), "threshold:health_low");
});

// ... similar tests for all ~10 patterns — read actual Lua buff templates to get real node shapes
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/condition-tagger.test.mjs`
Expected: New tests FAIL with unexpected tag values (`unknown_condition`)

- [ ] **Step 3: Add new patterns to `tagInlineFunc` in condition-tagger.mjs**

Read the actual Lua buff templates for each pattern to find the exact inline function bodies that need matching. For each of the ~10 patterns in the spec (ads_active, out_of_melee, threshold:toughness_high, threshold:stamina_high, threshold:health_low, during_heavy, during_windup, threshold:stamina_full, during_reload, ability_active), add a regex pattern to `tagInlineFunc()` or an entry to `CONDITIONAL_TAGS`.

Source files to read for pattern discovery:
- `scripts/settings/buff/archetype_buff_templates/veteran_buff_templates.lua` (ads, out_of_melee, toughness threshold)
- `scripts/settings/buff/archetype_buff_templates/zealot_buff_templates.lua` (health_low/Martyrdom, during_heavy)
- `scripts/settings/buff/archetype_buff_templates/ogryn_buff_templates.lua` (stamina_high, during_windup)
- `scripts/settings/buff/archetype_buff_templates/psyker_buff_templates.lua` (ability_active/Scrier's Gaze)
- `scripts/settings/buff/archetype_buff_templates/hive_scum_buff_templates.lua` (stamina_full, during_reload)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/condition-tagger.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Re-run effects:build to verify new tags propagate**

Run: `GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code npm run effects:build`

Check output: fewer `unknown_condition` tags reported. Before: 46 unknown. After: ~36 or fewer.

- [ ] **Step 6: Commit**

```bash
git add scripts/ground-truth/lib/condition-tagger.mjs scripts/condition-tagger.test.mjs
git commit -m "feat: expand condition tagger with ~10 calculator-relevant patterns (#5)"
```

---

## Task 2: Breed Data Extraction Pipeline

**Files:**
- Create: `scripts/extract-breed-data.mjs`
- Create: `scripts/extract-breed-data.test.mjs`
- Modify: `package.json` (add `breeds:build` script, add test file to `test` list)
- Modify: `Makefile` (add `breeds-build` target)

- [ ] **Step 1: Write failing test that expects breed-data.json to exist and have correct shape**

```js
// scripts/extract-breed-data.test.mjs
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GENERATED_DIR = join(__dirname, "..", "data", "ground-truth", "generated");
const HAS_SOURCE = !!process.env.GROUND_TRUTH_SOURCE_ROOT;

describe("breeds:build output", { skip: !HAS_SOURCE && "requires GROUND_TRUTH_SOURCE_ROOT" }, () => {
  let breeds;
  it("generates breed-data.json", () => {
    breeds = JSON.parse(readFileSync(join(GENERATED_DIR, "breed-data.json"), "utf-8"));
    assert.ok(Array.isArray(breeds.breeds));
    assert.ok(breeds.breeds.length >= 25, `expected >=25 breeds, got ${breeds.breeds.length}`);
  });

  it("has correct shape for renegade_berzerker", () => {
    const rager = breeds.breeds.find(b => b.id === "renegade_berzerker");
    assert.ok(rager, "renegade_berzerker not found");
    assert.equal(rager.base_armor_type, "armored");
    assert.equal(rager.community_armor_name, "Flak");
    assert.ok(rager.hit_zones.head, "missing head hitzone");
    assert.equal(rager.hit_zones.torso.armor_type, "super_armor");
    assert.ok(rager.difficulty_health.damnation > 0);
    assert.ok(rager.difficulty_health.uprising > 0);
    assert.ok(rager.tags.includes("elite"));
  });

  it("has difficulty health for all 5 levels", () => {
    for (const breed of breeds.breeds) {
      for (const diff of ["uprising", "malice", "heresy", "damnation", "auric"]) {
        assert.ok(typeof breed.difficulty_health[diff] === "number",
          `${breed.id} missing health for ${diff}`);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code node --test scripts/extract-breed-data.test.mjs`
Expected: FAIL (breed-data.json does not exist)

- [ ] **Step 3: Implement `extract-breed-data.mjs`**

Pipeline structure (following `extract-buff-effects.mjs` pattern):

```js
import { runCliMain } from "./ground-truth/lib/cli.mjs";
import { validateSourceSnapshot } from "./ground-truth/lib/validate.mjs";
import { parseLuaTable } from "./ground-truth/lib/lua-data-reader.mjs";
// ... imports

await runCliMain("breeds:build", async () => {
  const { source_root } = validateSourceSnapshot();

  // Phase 1: Parse minion_difficulty_settings.lua for health arrays
  // Source: scripts/settings/difficulty/minion_difficulty_settings.lua

  // Phase 2: Parse breed files from scripts/settings/breed/breeds/{faction}/*_breed.lua
  // Extract: armor_type, tags, hitzone_damage_multiplier, hitzone_armor_override

  // Phase 3: Resolve difficulty health per breed (match breed to difficulty category)

  // Phase 4: Build community_armor_name mapping

  // Phase 5: Write data/ground-truth/generated/breed-data.json
});
```

Key source paths to read:
- `scripts/settings/difficulty/minion_difficulty_settings.lua` — health arrays per category
- `scripts/settings/breed/breeds/renegade/*_breed.lua` — renegade faction breeds
- `scripts/settings/breed/breeds/cultist/*_breed.lua` — cultist faction breeds
- `scripts/settings/breed/breeds/chaos/*_breed.lua` — chaos breeds (monsters, hounds)

The implementation must handle:
- `hitzone_armor_override` per breed (e.g. renegade_berzerker torso → super_armor)
- Per-breed custom health arrays vs shared step arrays (`_elite_health_steps` etc.)
- `hitzone_damage_multiplier.ranged` and `.melee` per hitzone
- Breed `tags` from `breed_data.tags` table

- [ ] **Step 4: Run test to verify it passes**

Run: `GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code node --test scripts/extract-breed-data.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Add to package.json and Makefile**

In `package.json`, add `"breeds:build": "node scripts/extract-breed-data.mjs"` to scripts, and add `scripts/extract-breed-data.test.mjs` to the test script list.

In `Makefile`, add `breeds-build` target following the pattern of `effects-build`. Add it to `check` prerequisites: `check: require-source-root edges-build effects-build breeds-build profiles-build`.

- [ ] **Step 6: Commit**

```bash
git add scripts/extract-breed-data.mjs scripts/extract-breed-data.test.mjs package.json Makefile
git commit -m "feat: add breeds:build pipeline — breed HP, armor, hitzones, difficulty scaling (#5)"
```

---

**Parallelization note:** Tasks 2 and 3 are fully independent — they read different source files and produce different output files. They can be developed in parallel by separate agents.

---

## Task 3: Damage Profile Extraction Pipeline

**Files:**
- Create: `scripts/extract-damage-profiles.mjs`
- Create: `scripts/extract-damage-profiles.test.mjs`
- Modify: `package.json` (add `profiles:build` script, add test file)
- Modify: `Makefile` (add `profiles-build` target)

This is the largest extraction task. It must resolve the 3-hop action→profile indirection chain and the lerp_X ADM references.

- [ ] **Step 1: Write failing test for damage-profiles.json shape**

```js
// scripts/extract-damage-profiles.test.mjs
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GENERATED_DIR = join(__dirname, "..", "data", "ground-truth", "generated");
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
      assert.ok(p.damage_type, `${p.id} missing damage_type`);
      assert.ok(p.power_distribution, `${p.id} missing power_distribution`);
      assert.ok(typeof p.power_distribution.attack === "number", `${p.id} attack power not a number`);
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
    // At least one action type should have profiles
    const hasAction = map.actions.light_attack || map.actions.heavy_attack || map.actions.weapon_special;
    assert.ok(hasAction, `${map.weapon_template} has no actions`);
  });

  it("constants include damage output ranges and armor settings", () => {
    assert.ok(data.constants.damage_output, "missing damage_output");
    assert.ok(data.constants.default_power_level, "missing default_power_level");
    assert.ok(data.constants.boost_curves, "missing boost_curves");
    assert.ok(data.constants.overdamage_rending_multiplier, "missing overdamage_rending_multiplier");
    assert.ok(data.constants.rending_armor_type_multiplier, "missing rending_armor_type_multiplier");
    assert.ok(data.constants.default_finesse_boost_amount, "missing default_finesse_boost_amount");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code node --test scripts/extract-damage-profiles.test.mjs`
Expected: FAIL (damage-profiles.json does not exist)

- [ ] **Step 3: Implement `extract-damage-profiles.mjs`**

Pipeline structure:

```js
await runCliMain("profiles:build", async () => {
  const { source_root } = validateSourceSnapshot();

  // Phase 1: Load lerp lookup table from damage_profile_settings.lua
  // Resolve lerp_X references (e.g. lerp_0_75 → { min: 0, max: 0.75 })
  // Also load: cleave distribution presets, crit/finesse tables, boost curves

  // Phase 2: Load pipeline constants from power_level_settings.lua + armor_settings.lua + damage_settings.lua
  // Extract: damage_output, default_power_level, boost_curves, rending tables, finesse tables

  // Phase 3: Parse damage profile template files
  // Source paths:
  //   - scripts/settings/equipment/weapon_templates/{family}/settings_templates/*_damage_profile_templates.lua
  //   - scripts/settings/damage/damage_profiles/ (archetype/role-based shared profiles)
  // For each profile: resolve lerp_X references in ADM values using Phase 1 lookup

  // Phase 4: Parse weapon templates for action → profile mapping
  // For each weapon template:
  //   - Read action_inputs to get action chains
  //   - Resolve actions[action_name] → damage_profile (melee) or
  //     fire_configuration.hit_scan_template → damage_profile (ranged)
  //   - Produce flat action → profile_id[] mapping

  // Phase 5: Write data/ground-truth/generated/damage-profiles.json
  // Shape: { profiles: [...], action_maps: [...], constants: {...} }
});
```

Key implementation challenges:
- The lerp_X resolution: every ADM value in a profile references a `damage_lerp_values.lerp_X` name that must be resolved to `{ min, max }` from `damage_profile_settings.lua`
- Ranged vs melee ADM shape distinction: ranged profiles have `armor_damage_modifier_ranged.near/far`, melee have flat `armor_damage_modifier`
- Action chain resolution: `action_inputs` → `actions` → `fire_configuration.hit_scan_template` (ranged) or `damage_profile` (melee). HitScan templates live in per-weapon `settings_templates/` files
- Some profiles are archetype-based (linesman, smiter, ninjafencer) and shared across weapon families — these come from `scripts/settings/damage/damage_profiles/`

- [ ] **Step 4: Run test to verify it passes**

Run: `GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code node --test scripts/extract-damage-profiles.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Add to package.json and Makefile**

Add `"profiles:build": "node scripts/extract-damage-profiles.mjs"` and test file.

- [ ] **Step 6: Verify both pipelines run under `make check`**

Run: `make check`
Expected: `edges:build` → `effects:build` → `breeds:build` → `profiles:build` → `npm run check` all pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/extract-damage-profiles.mjs scripts/extract-damage-profiles.test.mjs package.json Makefile
git commit -m "feat: add profiles:build pipeline — damage profiles, action maps, constants (#5)"
```

---

## Task 4: Calculator Engine — Core Pipeline (Stages 1–8)

**Files:**
- Create: `scripts/ground-truth/lib/damage-calculator.mjs`
- Create: `scripts/damage-calculator.test.mjs`
- Modify: `package.json` (add test file)

These are the stages that matter for breakpoints. Each stage is a pure function.

- [ ] **Step 1: Write failing tests for individual stages**

Test each stage in isolation with hardcoded inputs. Do NOT depend on generated data — use inline fixture objects. This keeps the tests fast and source-root-independent.

```js
// scripts/damage-calculator.test.mjs
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  powerLevelToDamage,      // stage 1
  calculateDamageBuff,      // stage 2
  resolveArmorDamageModifier,  // stage 3
  calculateRending,         // stage 4
  calculateFinesseBoost,    // stage 5
  calculatePositional,      // stage 6
  hitZoneDamageMultiplier,  // stage 7
  applyArmorTypeBuffs,      // stage 8
} from "./ground-truth/lib/damage-calculator.mjs";

describe("damage-calculator stages", () => {
  describe("stage 1: power level → base damage", () => {
    it("maps default PL 500 to mid-range damage", () => {
      const constants = {
        default_power_level: 500,
        damage_output: { armored: { min: 0, max: 20 } },
      };
      // PL=500, power_distribution.attack=100 → attack_power_level=100
      // PowerLevel.power_level_percentage(100) = 100/10000 = 0.01
      // damage = 0 + 20 * 0.01 = 0.2
      const result = powerLevelToDamage({
        powerLevel: 500,
        powerDistribution: 100,
        armorType: "armored",
        constants,
      });
      assert.ok(typeof result === "number");
      assert.ok(result > 0);
    });
  });

  describe("stage 3: armor damage modifier", () => {
    it("applies melee ADM directly", () => {
      const adm = resolveArmorDamageModifier({
        profile: {
          armor_damage_modifier: {
            attack: { armored: [0.5, 0.8] },
          },
        },
        armorType: "armored",
        quality: 0.8,
        isRanged: false,
      });
      // lerp(0.5, 0.8, 0.8) = 0.5 + 0.3*0.8 = 0.74
      assert.ok(Math.abs(adm - 0.74) < 0.01);
    });

    it("lerps ranged ADM by sqrt(distance)", () => {
      const adm = resolveArmorDamageModifier({
        profile: {
          armor_damage_modifier_ranged: {
            near: { attack: { armored: [0.5, 0.8] } },
            far:  { attack: { armored: [0.2, 0.4] } },
          },
        },
        armorType: "armored",
        quality: 1.0,
        isRanged: true,
        distance: 20, // between close (12.5) and far (30)
        constants: { ranged_close: 12.5, ranged_far: 30 },
      });
      assert.ok(typeof adm === "number");
      assert.ok(adm > 0.4 && adm < 0.8); // between near and far values
    });
  });

  describe("stage 4: rending", () => {
    it("applies rending to armored targets", () => {
      const result = calculateRending({
        rendingSources: 0.3, // 30% rending from buffs
        armorDamageModifier: 0.5,
        armorType: "armored",
        constants: {
          rending_armor_type_multiplier: { armored: 1.0, unarmored: 0 },
          overdamage_rending_multiplier: { armored: 0.25, unarmored: 0 },
        },
      });
      assert.ok(result.rendedADM > 0.5); // rending improved the ADM
    });

    it("gives zero rending on unarmored targets", () => {
      const result = calculateRending({
        rendingSources: 0.5,
        armorDamageModifier: 1.0,
        armorType: "unarmored",
        constants: {
          rending_armor_type_multiplier: { unarmored: 0 },
          overdamage_rending_multiplier: { unarmored: 0 },
        },
      });
      assert.equal(result.rendedADM, 1.0);
    });
  });

  describe("stage 5: finesse boost", () => {
    it("applies weakspot boost through curve", () => {
      const boost = calculateFinesseBoost({
        isCrit: false,
        isWeakspot: true,
        armorType: "armored",
        constants: {
          default_finesse_boost_amount: { armored: 0.5 },
          default_crit_boost_amount: 0.5,
          boost_curves: { default: [0, 0.3, 0.6, 0.8, 1.0] },
        },
        profileBoostCurve: null,
      });
      assert.ok(boost > 1.0); // should multiply damage
    });
  });

  // ... similar for stages 6, 7, 8
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/damage-calculator.test.mjs`
Expected: FAIL (module does not exist)

- [ ] **Step 3: Implement stages 1–8 as individual exported functions**

Implement in `scripts/ground-truth/lib/damage-calculator.mjs`. Each stage is a pure function with no side effects. Port the math directly from `damage_calculation.lua` (the decompiled source has been read in detail during spec development — see the spec's "Stage 2 Stat Buff Categories" section for the full list of terms).

Key functions to implement:
- `powerLevelToDamage({ powerLevel, powerDistribution, armorType, constants })` — stage 1
- `calculateDamageBuff({ attackType, statBuffs, targetStatBuffs, ... })` — stage 2 (the ~40-term additive sum + multiplicative terms)
- `resolveArmorDamageModifier({ profile, armorType, quality, isRanged, distance, constants })` — stage 3
- `calculateRending({ rendingSources, armorDamageModifier, armorType, constants })` — stage 4
- `calculateFinesseBoost({ isCrit, isWeakspot, armorType, constants, profileBoostCurve })` — stage 5
- `calculatePositional({ damage, backstabMult, flankingMult, isBackstab, isFlanking })` — stage 6
- `hitZoneDamageMultiplier({ breed, hitZone, attackType })` — stage 7
- `applyArmorTypeBuffs({ damage, armorType, statBuffs })` — stage 8
- `boostCurveMultiplier(curve, percent)` — shared utility (the piecewise linear interpolation)

Reference the spec's Stage 2 breakdown for the exact categorization of additive vs multiplicative stat buffs.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/damage-calculator.test.mjs`
Expected: All stage 1–8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/damage-calculator.mjs scripts/damage-calculator.test.mjs package.json
git commit -m "feat: implement calculator stages 1-8 — core damage pipeline (#5)"
```

---

## Task 5: Calculator Engine — Remaining Stages (9–13) + `computeHit`

**Files:**
- Modify: `scripts/ground-truth/lib/damage-calculator.mjs`
- Modify: `scripts/damage-calculator.test.mjs`

- [ ] **Step 1: Write failing tests for stages 9–13 and the composed `computeHit`**

```js
describe("stage 9: diminishing returns", () => {
  it("returns unmodified damage for breeds without diminishing_returns_damage", () => {
    const result = applyDiminishingReturns({ damage: 100, breed: { diminishing_returns_damage: false } });
    assert.equal(result, 100);
  });
});

describe("computeHit", () => {
  it("computes full pipeline for a melee hit", () => {
    const result = computeHit({
      profile: FIXTURE_MELEE_PROFILE,
      hitZone: "head",
      breed: FIXTURE_RAGER_BREED,
      difficulty: "damnation",
      flags: { is_crit: false, is_weakspot: true },
      buffStack: { damage: 1.15, melee_damage: 1.1 },
      quality: 0.8,
      distance: 0,
      chargeLevel: 1,
      constants: FIXTURE_CONSTANTS,
    });
    assert.ok(result.damage > 0);
    assert.ok(result.hitsToKill >= 1);
    assert.equal(result.effectiveArmorType, "unarmored"); // head hitzone
    assert.ok(result.baseDamage > 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement stages 9–13 and the `computeHit` orchestrator**

Functions to add:
- `applyDiminishingReturns({ damage, breed, healthPercent })` — stage 9
- `classifyDamageEfficiency({ armorDamageModifier, armorType, rendingDamage })` — stage 11
- `computeHit({ profile, hitZone, breed, difficulty, flags, buffStack, quality, distance, chargeLevel, constants })` — composes all 13 stages, returns full result object per spec

Stages 10, 12, 13 are skipped in static calc (force fields, toughness split, death resolution) — implement as no-ops that return the input, with comments noting they're available for future #11 work.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/damage-calculator.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/damage-calculator.mjs scripts/damage-calculator.test.mjs
git commit -m "feat: implement calculator stages 9-13 + computeHit orchestrator (#5)"
```

---

## Task 6: Buff Stack Assembly

**Files:**
- Modify: `scripts/ground-truth/lib/damage-calculator.mjs`
- Modify: `scripts/damage-calculator.test.mjs`

This is the bridge between the entity effects model and the damage pipeline. Follow the algorithm in the spec's `assembleBuildBuffStack` section.

- [ ] **Step 1: Write failing tests for buff stack assembly**

```js
describe("assembleBuildBuffStack", () => {
  it("accumulates unconditional stat_buffs additively", () => {
    const mockIndex = {
      entities: new Map([
        ["t.talent.a", { calc: { effects: [{ stat: "damage", magnitude: 0.1, type: "stat_buff" }] } }],
        ["t.talent.b", { calc: { effects: [{ stat: "damage", magnitude: 0.05, type: "stat_buff" }] } }],
      ]),
    };
    const build = { talents: [
      { canonical_entity_id: "t.talent.a", resolution_status: "resolved" },
      { canonical_entity_id: "t.talent.b", resolution_status: "resolved" },
    ], weapons: [], curios: [] };
    const flags = { proc_stacks: 0, health_state: "full", warp_charge: 0 };
    const stack = assembleBuildBuffStack(build, mockIndex, flags);
    // damage = 1 + 0.1 + 0.05 = 1.15
    assert.ok(Math.abs(stack.damage - 1.15) < 0.001);
  });

  it("excludes conditional effects when flag is not set", () => {
    const mockIndex = {
      entities: new Map([
        ["t.talent.a", { calc: { effects: [
          { stat: "damage", magnitude: 0.2, type: "conditional_stat_buff", condition: "threshold:health_low" },
        ] } }],
      ]),
    };
    const build = { talents: [
      { canonical_entity_id: "t.talent.a", resolution_status: "resolved" },
    ], weapons: [], curios: [] };
    const stack = assembleBuildBuffStack(build, mockIndex, { health_state: "full" });
    assert.equal(stack.damage, undefined); // not included
  });

  it("includes conditional effects when flag matches", () => {
    // Same as above but with health_state: "low"
    const mockIndex = {
      entities: new Map([
        ["t.talent.a", { calc: { effects: [
          { stat: "damage", magnitude: 0.2, type: "conditional_stat_buff", condition: "threshold:health_low" },
        ] } }],
      ]),
    };
    const build = { talents: [
      { canonical_entity_id: "t.talent.a", resolution_status: "resolved" },
    ], weapons: [], curios: [] };
    const stack = assembleBuildBuffStack(build, mockIndex, { health_state: "low" });
    assert.ok(Math.abs(stack.damage - 1.2) < 0.001);
  });

  it("scales lerped_stat_buff by warp_charge flag", () => {
    const mockIndex = {
      entities: new Map([
        ["t.talent.a", { calc: { effects: [
          { stat: "damage", magnitude: 0.3, type: "lerped_stat_buff", condition: "threshold:warp_charge" },
        ] } }],
      ]),
    };
    const build = { talents: [
      { canonical_entity_id: "t.talent.a", resolution_status: "resolved" },
    ], weapons: [], curios: [] };
    const stack = assembleBuildBuffStack(build, mockIndex, { warp_charge: 0.5 });
    // 0.3 * 0.5 = 0.15 → 1 + 0.15 = 1.15
    assert.ok(Math.abs(stack.damage - 1.15) < 0.001);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement `assembleBuildBuffStack`**

Follow the spec algorithm:
1. Iterate all resolved selections (talents, blessings from weapons, perks from weapons, gadget traits from curios)
2. Look up `calc.effects` from index
3. Filter by condition → flag mapping (see spec table)
4. Accumulate: additive stats sum `(magnitude)` onto running total starting at 1; multiplicative stats multiply into separate product
5. Return flat `{ stat_name: value }` map

`assembleBuildBuffStack(build, index, flags)` takes the index as a parameter — it does NOT call `loadIndex` internally. The caller (CLI, scoring) loads the index via `loadIndex()` from `synergy-model.mjs` and passes it in. This supports test mocking (as shown in the test fixtures above) and production use alike. Use the same selection iteration pattern as `resolveSelections` in `synergy-model.mjs`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/damage-calculator.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/damage-calculator.mjs scripts/damage-calculator.test.mjs
git commit -m "feat: implement assembleBuildBuffStack — flag-based condition filtering (#5)"
```

---

## Task 7: Breakpoint Matrix + Summary

**Files:**
- Modify: `scripts/ground-truth/lib/damage-calculator.mjs`
- Modify: `scripts/damage-calculator.test.mjs`

- [ ] **Step 1: Write failing test for `computeBreakpoints` with a real build fixture**

```js
const HAS_SOURCE = !!process.env.GROUND_TRUTH_SOURCE_ROOT;

describe("computeBreakpoints", { skip: !HAS_SOURCE && "requires GROUND_TRUTH_SOURCE_ROOT" }, () => {
  it("produces a breakpoint matrix for a psyker build", async () => {
    const { loadIndex } = await import("./ground-truth/lib/synergy-model.mjs");
    const { loadCalculatorData, computeBreakpoints } = await import("./ground-truth/lib/damage-calculator.mjs");
    const build = JSON.parse(readFileSync(
      join(__dirname, "builds", "08-gandalf-melee-wizard.json"), "utf-8"
    ));
    const index = loadIndex();
    const calcData = loadCalculatorData();
    const matrix = computeBreakpoints(build, index, calcData);

    assert.ok(matrix.weapons.length > 0, "no weapons in matrix");
    assert.ok(matrix.weapons[0].actions.length > 0, "no actions");
    assert.ok(matrix.weapons[0].actions[0].scenarios.sustained, "missing sustained scenario");
    assert.ok(matrix.weapons[0].summary.bestLight, "missing bestLight summary");
    assert.ok(matrix.metadata.quality === 0.8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `loadCalculatorData`, `computeBreakpoints`, `summarizeBreakpoints`**

**API deviation from spec:** The spec defines `computeBreakpoints(build, index, profiles, breeds)` (4 args). We bundle profiles+breeds+constants into a single `calcData` object returned by `loadCalculatorData()`, giving `computeBreakpoints(build, index, calcData)` (3 args). The `index` is loaded separately via `loadIndex()` from `synergy-model.mjs` — it is NOT part of `loadCalculatorData()` (unlike what the spec's `loadCalculatorData → { profiles, breeds, index }` suggests). This keeps concerns separate: calc data = generated JSON, index = entity data.

```js
// loadCalculatorData reads the two generated JSON files (no index — that comes from synergy-model.mjs)
export function loadCalculatorData() {
  const profilesPath = join(GENERATED_DIR, "damage-profiles.json");
  const breedsPath = join(GENERATED_DIR, "breed-data.json");
  const profileData = JSON.parse(readFileSync(profilesPath, "utf-8"));
  const breedData = JSON.parse(readFileSync(breedsPath, "utf-8"));
  return { profiles: profileData.profiles, actionMaps: profileData.action_maps,
           constants: profileData.constants, breeds: breedData.breeds };
}
```

`computeBreakpoints`:
1. Build buff stacks for each scenario (sustained, aimed, burst) via `assembleBuildBuffStack`
2. For each weapon in the build, find its action map
3. For each action, for each scenario, for each breed, for each difficulty: call `computeHit` with best hitzone for that scenario (head for aimed/burst, body for sustained)
4. Assemble into the matrix shape from the spec
5. `summarizeBreakpoints` picks best light/heavy/special per weapon per scenario

- [ ] **Step 4: Run test to verify it passes**

Run: `GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code node --test scripts/damage-calculator.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/damage-calculator.mjs scripts/damage-calculator.test.mjs
git commit -m "feat: implement computeBreakpoints — full weapon×breed×difficulty×scenario matrix (#5)"
```

---

## Task 8: Breakpoint Checklist + Scoring Integration

**Files:**
- Create: `scripts/ground-truth/lib/breakpoint-checklist.mjs`
- Modify: `scripts/ground-truth/lib/build-scoring.mjs`
- Modify: `scripts/score-build.mjs` (lines ~735-739)
- Modify: `scripts/build-scoring.test.mjs`

- [ ] **Step 1: Write failing tests for the two new scoring dimensions**

```js
// Add to scripts/build-scoring.test.mjs
describe("breakpoint_relevance", () => {
  it("scores higher when more breakpoints are hit", () => {
    // Mock matrix where weapon hits 8/10 checklist entries
    const highMatrix = makeBreakpointMatrix({ breakpointsHit: 8, total: 10 });
    const lowMatrix = makeBreakpointMatrix({ breakpointsHit: 2, total: 10 });
    const high = scoreBreakpointRelevance(highMatrix);
    const low = scoreBreakpointRelevance(lowMatrix);
    assert.ok(high.score > low.score);
    assert.ok(high.score >= 1 && high.score <= 5);
  });
});

describe("difficulty_scaling", () => {
  it("scores higher when breakpoints hold at higher difficulties", () => {
    // Mock: build maintains breakpoints through auric
    const strong = makeDifficultyProfile({ heresy: 8, damnation: 7, auric: 6 });
    const weak = makeDifficultyProfile({ heresy: 8, damnation: 4, auric: 1 });
    const strongScore = scoreDifficultyScaling(strong, mockBaseline);
    const weakScore = scoreDifficultyScaling(weak, mockBaseline);
    assert.ok(strongScore.score > weakScore.score);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Create breakpoint checklist data file**

Create `data/ground-truth/breakpoint-checklist.json` with the checklist entries from the spec table. This is a data file — weights and entries can be tuned without code changes.

```jsonc
{
  "checklist": [
    { "label": "One-shot Rager head", "breed_id": "renegade_berzerker", "difficulty": "damnation", "max_hits": 1, "hit_zone": "head", "scenario": "aimed", "weight": "high" },
    { "label": "Two-hit Rager body", "breed_id": "renegade_berzerker", "difficulty": "damnation", "max_hits": 2, "hit_zone": "torso", "scenario": "sustained", "weight": "high" },
    // ... remaining entries from spec
  ],
  "weight_values": { "high": 3, "medium": 2, "low": 1 }
}
```

- [ ] **Step 4: Implement scoring functions**

Create `scripts/ground-truth/lib/breakpoint-checklist.mjs`:
- Load checklist from the JSON data file (lazy-load with module-level cache, matching `build-scoring-data.json` loader pattern)
- Export `scoreBreakpointRelevance(matrix)` — evaluates matrix against checklist, returns `{ score: 1-5, breakdown, explanations }`
- Export `scoreDifficultyScaling(matrix, populationBaseline)` — compares degradation across difficulties

Add `scoreFromCalculator(calcOutput)` to `scripts/ground-truth/lib/build-scoring.mjs` — adapter that calls `scoreBreakpointRelevance` and `scoreDifficultyScaling`, mirroring the existing `scoreFromSynergy()` pattern.

- [ ] **Step 5: Implement population baseline computation**

`computePopulationBaseline(buildsDir, index, calcData)`:
1. Iterate all 23 build fixtures in `scripts/builds/`
2. For each build, compute breakpoint matrix
3. Derive median hits-to-kill per checklist entry across all builds
4. Return baseline object

This is computed lazily at scoring time and cached in memory. It does NOT persist to a file — it recalculates when the scorer runs (the 23-build computation takes < 2 seconds). The cache invalidates naturally per process.

- [ ] **Step 6: Wire into `generateScorecard` in `score-build.mjs`**

**Critical:** `generateScorecard()` is currently synchronous with signature `(build, synergyOutput)`. Do NOT load calc data inside it. Instead, extend the signature to `(build, synergyOutput, calcOutput)` — matching how synergy was wired (computed externally, passed in).

```js
// In score-build.mjs generateScorecard():
// Before:
breakpoint_relevance: null,
difficulty_scaling: null,

// After: use the passed-in calcOutput
const { breakpoint_relevance, difficulty_scaling } = calcOutput
  ? scoreFromCalculator(calcOutput)
  : { breakpoint_relevance: null, difficulty_scaling: null };
```

The CLI entry point (line ~889) computes calc output before calling `generateScorecard`, using dynamic import:

```js
const { loadCalculatorData, computeBreakpoints } = await import("./ground-truth/lib/damage-calculator.mjs");
const calcData = loadCalculatorData();
const matrix = computeBreakpoints(build, index, calcData);
const scorecard = generateScorecard(build, synergyOutput, matrix);
```

If generated calc data doesn't exist (e.g. running `score` without `profiles:build`), the dynamic import catch falls through and `calcOutput` is null — graceful degradation, same as before.

- [ ] **Step 5: Run scoring tests to verify they pass**

Run: `node --test scripts/build-scoring.test.mjs`
Expected: All tests PASS (new dimension tests + existing tests still green)

- [ ] **Step 6: Commit**

```bash
git add scripts/ground-truth/lib/breakpoint-checklist.mjs scripts/ground-truth/lib/build-scoring.mjs \
  scripts/score-build.mjs scripts/build-scoring.test.mjs
git commit -m "feat: wire breakpoint_relevance + difficulty_scaling into scoring (#5, #9)"
```

---

## Task 9: CLI — `npm run calc`

**Files:**
- Create: `scripts/calc-build.mjs`
- Create: `scripts/calc-build.test.mjs`
- Modify: `package.json` (add `calc` and `calc:freeze` scripts, add test file)

- [ ] **Step 1: Write failing test for CLI output**

```js
// scripts/calc-build.test.mjs
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HAS_SOURCE = !!process.env.GROUND_TRUTH_SOURCE_ROOT;
const BUILD = join(__dirname, "builds", "08-gandalf-melee-wizard.json");

describe("calc CLI", { skip: !HAS_SOURCE && "requires GROUND_TRUTH_SOURCE_ROOT" }, () => {
  it("produces valid JSON with --json flag", () => {
    const out = execFileSync("node", [join(__dirname, "calc-build.mjs"), BUILD, "--json"], {
      encoding: "utf-8",
      env: { ...process.env },
    });
    const data = JSON.parse(out);
    assert.ok(data.weapons, "missing weapons");
    assert.ok(data.metadata, "missing metadata");
  });

  it("produces text output by default", () => {
    const out = execFileSync("node", [join(__dirname, "calc-build.mjs"), BUILD, "--text"], {
      encoding: "utf-8",
      env: { ...process.env },
    });
    assert.ok(out.includes("Sustained"), "missing scenario header");
    assert.ok(out.includes("Breakpoints hit"), "missing breakpoint summary");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `calc-build.mjs`**

Follow `score-build.mjs` CLI pattern:
- Guard with `process.argv[1] === fileURLToPath(import.meta.url)`
- `parseArgs` from `node:util` with `--json`, `--text`, `--compare`, positionals
- Load index, calculator data
- Call `computeBreakpoints`
- Format output: JSON mode → `JSON.stringify`, text mode → formatted table (see spec's text output example, using community armor names)
- Batch mode: if positional is a directory, process all `.json` files
- Freeze mode (`--freeze`): for each build, write JSON output to `tests/fixtures/ground-truth/calc/{prefix}.calc.json`
- Compare mode: compute two matrices, diff breakpoints hit/lost

Also implement `formatCalcText(matrix)` for the human-readable table with community armor names.

- [ ] **Step 4: Run test to verify it passes**

Run: `GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code node --test scripts/calc-build.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Add scripts to package.json**

```json
"calc": "node scripts/calc-build.mjs",
"calc:freeze": "node scripts/calc-build.mjs scripts/builds/ --json --freeze"
```

- [ ] **Step 6: Commit**

```bash
git add scripts/calc-build.mjs scripts/calc-build.test.mjs package.json
git commit -m "feat: add calc CLI with --json/--text output and compare mode (#5)"
```

---

## Task 10: Golden Snapshots + Cross-Validation + Final Wiring

**Files:**
- Create: `tests/fixtures/ground-truth/calc/` directory + snapshot files
- Modify: `tests/fixtures/ground-truth/scores/` (re-freeze with new dimensions)
- Modify: `AGENTS.md` (update commands, data architecture, open issues — CLAUDE.md is a symlink to AGENTS.md, always edit AGENTS.md)

- [ ] **Step 1: Generate and freeze calc snapshots for all 23 builds**

Run: `GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code npm run calc:freeze`

Verify: `tests/fixtures/ground-truth/calc/` contains 23 `.calc.json` files.

- [ ] **Step 2: Add snapshot regression test to `calc-build.test.mjs`**

```js
describe("frozen calc snapshots", { skip: !HAS_SOURCE && "requires GROUND_TRUTH_SOURCE_ROOT" }, () => {
  const SNAPSHOT_DIR = join(__dirname, "..", "tests", "fixtures", "ground-truth", "calc");
  it("matches frozen snapshots for all builds", () => {
    // For each build, compute fresh matrix and compare against snapshot
    // Allow small float tolerance (1e-6)
  });
});
```

- [ ] **Step 3: Re-freeze score snapshots**

Run: `GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code npm run score:freeze`

The score snapshots now include non-null `breakpoint_relevance` and `difficulty_scaling`. Verify no S/A grades remain impossible.

- [ ] **Step 4: Cross-validate against Wartide**

Pick 5 weapon × enemy × difficulty combinations from [Wartide calculator](https://dt.wartide.net/calc/). Run `npm run calc` with an empty buff stack (no talents) and compare base damage and hits-to-kill. Document results in a test or comment.

- [ ] **Step 5: Run full quality gate**

Run: `make check`
Expected: All pipelines build, all tests pass, no regressions.

- [ ] **Step 6: Update CLAUDE.md**

Add to Commands section:
```
npm run profiles:build
npm run breeds:build
npm run calc -- <build.json> [--json|--text]
npm run calc -- <build.json> --compare <other.json>
npm run calc:freeze
```

Update Data Architecture with `generated/damage-profiles.json` and `generated/breed-data.json`.

Update Open Issues: #5 → Completed Issues. Add #11, #12, #13 to Open Issues.

Update Build Fixtures count from 20 to 23 (AGENTS.md is stale — filesystem has 23 builds).

Update `make check` description to include new pipelines.

- [ ] **Step 7: Commit all snapshots + docs**

```bash
git add tests/fixtures/ground-truth/calc/ tests/fixtures/ground-truth/scores/ CLAUDE.md
git commit -m "feat: frozen calc/score snapshots, cross-validation, docs update (#5)"
```

- [ ] **Step 8: Final integration commit with all package.json + Makefile changes verified**

Run `make check` one final time to confirm clean state.

```bash
git add -A
git commit -m "feat: complete calculator and dataflow layer (#5)

Full 13-stage damage pipeline, two extraction pipelines (profiles:build,
breeds:build), flag-based scenario system, breakpoint scoring integration,
calc CLI with --json/--text/--compare. Closes #5."
```
