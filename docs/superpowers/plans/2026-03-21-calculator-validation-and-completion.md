# Calculator Validation and Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate the existing damage calculator against real data, fix known bugs, then extend with stagger (#12), cleave (#13), and toughness (#11) calculators.

**Architecture:** Validation-gated extension. Phase 1 smoke-tests the damage pipeline and audits unused extracted fields (impact, cleave). Phase 2 fixes foundation bugs. Phase 3 adds three calculator modules following the same pattern: pure-function computation module → CLI entry point → tests → scoring integration (stagger + cleave only; toughness scoring deferred).

**Tech Stack:** Node.js ESM, `node:test` + `node:assert`, no new dependencies. Reuses `lua-data-reader.mjs` for Lua parsing, `damage-calculator.mjs` patterns for pipeline stages.

**Spec:** `docs/superpowers/specs/2026-03-21-calculator-validation-and-completion-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `scripts/calculator-validation.test.mjs` | Create | Phase 1 — structured smoke test + data quality audit |
| `scripts/ground-truth/lib/damage-calculator.mjs` | Modify | Phase 2 — fix Build 14 shield crash, difficulty_health fallback, lerp factor |
| `scripts/damage-calculator.test.mjs` | Modify | Phase 2 — add Build 14 snapshot, update assertions for new HTK semantics |
| `scripts/extract-breed-data.mjs` | Modify | Phase 3 — add `hit_mass` extraction (#13), `stagger_resistance` extraction (#12) |
| `scripts/ground-truth/lib/stagger-calculator.mjs` | Create | Phase 3 — impact pipeline + stagger threshold comparison |
| `scripts/stagger-calculator.test.mjs` | Create | Phase 3 — unit + snapshot tests for stagger |
| `scripts/stagger-build.mjs` | Create | Phase 3 — CLI entry point for `npm run stagger` |
| `data/ground-truth/stagger-thresholds.json` | Create | Phase 3 — extracted stagger threshold tables |
| `scripts/ground-truth/lib/cleave-calculator.mjs` | Create | Phase 3 — cleave budget simulation |
| `scripts/cleave-calculator.test.mjs` | Create | Phase 3 — unit + snapshot tests for cleave |
| `scripts/cleave-build.mjs` | Create | Phase 3 — CLI entry point for `npm run cleave` |
| `scripts/ground-truth/lib/toughness-calculator.mjs` | Create | Phase 3 — defender-side stages 10/12/13 |
| `scripts/toughness-calculator.test.mjs` | Create | Phase 3 — unit + snapshot tests for toughness |
| `scripts/toughness-build.mjs` | Create | Phase 3 — CLI entry point for `npm run toughness` |
| `data/ground-truth/class-base-stats.json` | Create | Phase 3 — per-class HP, toughness, wounds |
| `scripts/ground-truth/lib/breakpoint-checklist.mjs` | Modify | Phase 3 — add stagger + cleave checklist entries |
| `data/ground-truth/breakpoint-checklist.json` | Modify | Phase 3 — add stagger + cleave entries |
| `package.json` | Modify | Add `stagger`, `stagger:freeze`, `cleave`, `cleave:freeze`, `toughness`, `toughness:freeze` scripts; add new test files to `test` script |
| `tests/fixtures/ground-truth/stagger/` | Create dir | Frozen stagger snapshots |
| `tests/fixtures/ground-truth/cleave/` | Create dir | Frozen cleave snapshots |
| `tests/fixtures/ground-truth/toughness/` | Create dir | Frozen toughness snapshots |

---

## Phase 1: Validation & Data Quality Report

### Task 1: Prerequisites — Generate Data

**Files:**
- Check: `.source-root` or `GROUND_TRUTH_SOURCE_ROOT` env var
- Generated: `data/ground-truth/generated/breed-data.json`, `data/ground-truth/generated/damage-profiles.json`, `data/ground-truth/generated/index.json`

The source drive must be mounted and generated data must exist before any validation tests can run.

- [ ] **Step 1: Ensure dependencies are installed**

Run: `npm install`
Expected: Clean install, no errors.

- [ ] **Step 2: Verify source root is accessible**

Run: `cat .source-root 2>/dev/null || echo $GROUND_TRUTH_SOURCE_ROOT`
Expected: A valid path to the Darktide source checkout (e.g., `/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code`).

If the source drive is not mounted, mount it first. The `.source-root` file should contain the path. If neither `.source-root` nor the env var exists:
```bash
echo /run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code > .source-root
```

- [ ] **Step 3: Generate all data**

Run: `npm run index:build && npm run breeds:build && npm run profiles:build && npm run effects:build && npm run edges:build`
Expected: All generated files created in `data/ground-truth/generated/`. No errors.

- [ ] **Step 4: Verify existing tests pass**

Run: `npm test`
Expected: All existing tests pass, including the 22 golden calc snapshot regressions.

- [ ] **Step 5: Commit (no changes expected — just verifying clean state)**

---

### Task 2: Validation Test — Damage Pipeline Sanity

**Files:**
- Create: `scripts/calculator-validation.test.mjs`
- Modify: `package.json` (add to `test` script)

Write the first validation category: run `computeBreakpoints` on all 23 builds and check for suspicious values.

- [ ] **Step 1: Write the validation test file with damage sanity checks**

```js
// scripts/calculator-validation.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadCalculatorData,
  computeBreakpoints,
} from "./ground-truth/lib/damage-calculator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const buildsDir = join(__dirname, "builds");
const generatedDir = join(__dirname, "..", "data", "ground-truth", "generated");

const hasGeneratedData =
  existsSync(join(generatedDir, "breed-data.json")) &&
  existsSync(join(generatedDir, "damage-profiles.json")) &&
  existsSync(join(generatedDir, "index.json"));

describe("calculator validation — damage pipeline sanity", { skip: !hasGeneratedData && "no generated data" }, () => {
  let index, calcData;
  const buildFiles = readdirSync(buildsDir).filter((f) => f.endsWith(".json")).sort();

  it("loads shared data", async () => {
    const { loadIndex } = await import("./ground-truth/lib/synergy-model.mjs");
    index = loadIndex();
    calcData = loadCalculatorData();
    assert.ok(index);
    assert.ok(calcData);
  });

  for (const file of buildFiles) {
    describe(`build: ${file}`, () => {
      let matrix;

      it("computes breakpoints without throwing", () => {
        const build = JSON.parse(readFileSync(join(buildsDir, file), "utf-8"));
        try {
          matrix = computeBreakpoints(build, index, calcData);
        } catch (err) {
          // Record the error for Build 14 / shield weapon characterization
          matrix = { error: err.message, weapons: [] };
          // Don't assert.fail — let subsequent checks characterize the failure
        }
      });

      it("has no NaN damage values", () => {
        if (matrix?.error) return; // skip if build errored (characterized separately)
        for (const weapon of matrix.weapons) {
          for (const action of weapon.actions) {
            for (const [scenario, breeds] of Object.entries(action.scenarios)) {
              for (const entry of breeds) {
                assert.ok(
                  !Number.isNaN(entry.damage),
                  `NaN damage: ${weapon.entityId} / ${action.type} / ${scenario} / ${entry.breed_id} @ ${entry.difficulty}`
                );
              }
            }
          }
        }
      });

      it("has no negative damage values", () => {
        if (matrix?.error) return;
        for (const weapon of matrix.weapons) {
          for (const action of weapon.actions) {
            for (const [scenario, breeds] of Object.entries(action.scenarios)) {
              for (const entry of breeds) {
                assert.ok(
                  entry.damage >= 0,
                  `Negative damage: ${weapon.entityId} / ${action.type} / ${scenario} / ${entry.breed_id} @ ${entry.difficulty}`
                );
              }
            }
          }
        }
      });

      it("has no implausible HTK values (>200)", () => {
        if (matrix?.error) return;
        for (const weapon of matrix.weapons) {
          for (const action of weapon.actions) {
            for (const [scenario, breeds] of Object.entries(action.scenarios)) {
              for (const entry of breeds) {
                if (entry.hitsToKill === Infinity) continue; // legitimate negation
                assert.ok(
                  entry.hitsToKill <= 200,
                  `Implausible HTK ${entry.hitsToKill}: ${weapon.entityId} / ${action.type} / ${scenario} / ${entry.breed_id} @ ${entry.difficulty}`
                );
              }
            }
          }
        }
      });

      it("every weapon resolves to at least one action", () => {
        if (matrix?.error) return;
        for (const weapon of matrix.weapons) {
          if (weapon.skipped) continue; // unresolved weapons are ok
          assert.ok(
            weapon.actions.length > 0,
            `Weapon ${weapon.entityId} has zero actions`
          );
        }
      });
    });
  }
});
```

- [ ] **Step 2: Add to package.json test script**

In `package.json`, add `scripts/calculator-validation.test.mjs` to the `test` script's file list.

- [ ] **Step 3: Run to verify tests execute**

Run: `node --test scripts/calculator-validation.test.mjs`
Expected: All tests pass for builds 01-13, 15-23. Build 14 may error (shield weapon) — the test captures this without failing.

- [ ] **Step 4: Commit**

```bash
git add scripts/calculator-validation.test.mjs package.json
git commit -m "test: add damage pipeline validation smoke tests (Phase 1)"
```

---

### Task 3: Validation Test — Impact, Stagger, and Cleave Data Audit

**Files:**
- Modify: `scripts/calculator-validation.test.mjs`

Add field-level audits for the data that stagger and cleave calculators will consume. These tests don't compute anything — they just verify the extracted data is present and well-formed.

- [ ] **Step 1: Add impact/stagger data audit tests**

Append to `scripts/calculator-validation.test.mjs`:

```js
describe("calculator validation — impact/stagger data audit", { skip: !hasGeneratedData && "no generated data" }, () => {
  let calcData;

  it("loads calculator data", () => {
    calcData = loadCalculatorData();
    assert.ok(calcData);
  });

  it("every profile with attack power also has impact power", () => {
    const missing = [];
    for (const profile of calcData.profiles) {
      const pd = profile.power_distribution;
      if (!pd) continue;
      if (pd.attack != null && pd.impact == null) {
        missing.push(profile.id);
      }
    }
    assert.equal(missing.length, 0, `Profiles with attack but no impact: ${missing.join(", ")}`);
  });

  it("impact values are non-negative numbers", () => {
    for (const profile of calcData.profiles) {
      const pd = profile.power_distribution;
      if (!pd || pd.impact == null) continue;
      const impact = Array.isArray(pd.impact) ? pd.impact : [pd.impact];
      for (const val of impact) {
        assert.ok(typeof val === "number" && !Number.isNaN(val) && val >= 0,
          `Bad impact value ${val} in profile ${profile.id}`);
      }
    }
  });

  it("stagger_category is present on profiles that have power_distribution", () => {
    const missing = [];
    for (const profile of calcData.profiles) {
      if (profile.power_distribution && !profile.stagger_category) {
        missing.push(profile.id);
      }
    }
    // Report count — some profiles legitimately lack stagger_category
    console.log(`  Profiles with power_distribution but no stagger_category: ${missing.length}/${calcData.profiles.length}`);
    // Don't fail — just report. Many profiles are ranged and may not have stagger_category.
  });

  it("reports profile counts for data quality summary", () => {
    const withImpact = calcData.profiles.filter((p) => p.power_distribution?.impact != null).length;
    const withStagger = calcData.profiles.filter((p) => p.stagger_category).length;
    const total = calcData.profiles.length;
    console.log(`  Profiles total: ${total}`);
    console.log(`  Profiles with impact power: ${withImpact}`);
    console.log(`  Profiles with stagger_category: ${withStagger}`);
  });
});
```

- [ ] **Step 2: Add cleave data audit tests**

Append to `scripts/calculator-validation.test.mjs`:

```js
describe("calculator validation — cleave data audit", { skip: !hasGeneratedData && "no generated data" }, () => {
  let calcData;

  it("loads calculator data", () => {
    calcData = loadCalculatorData();
    assert.ok(calcData);
  });

  it("every profile has cleave_distribution with attack and impact", () => {
    const missing = [];
    for (const profile of calcData.profiles) {
      const cd = profile.cleave_distribution;
      if (!cd || cd.attack == null || cd.impact == null) {
        missing.push(profile.id);
      }
    }
    console.log(`  Profiles missing cleave_distribution: ${missing.length}/${calcData.profiles.length}`);
    // Some profiles (e.g., pure ranged with no cleave) may legitimately lack it
  });

  it("cleave values are non-negative numbers", () => {
    for (const profile of calcData.profiles) {
      const cd = profile.cleave_distribution;
      if (!cd) continue;
      for (const key of ["attack", "impact"]) {
        const val = cd[key];
        if (val == null) continue;
        const vals = Array.isArray(val) ? val : [val];
        for (const v of vals) {
          assert.ok(typeof v === "number" && !Number.isNaN(v) && v >= 0,
            `Bad cleave ${key} value ${v} in profile ${profile.id}`);
        }
      }
    }
  });

  it("reports whether hit_mass exists in breed data", () => {
    const breedData = JSON.parse(
      readFileSync(join(generatedDir, "breed-data.json"), "utf-8")
    );
    const breeds = breedData.breeds || [];
    const withHitMass = breeds.filter((b) => b.hit_mass != null).length;
    console.log(`  Breeds with hit_mass: ${withHitMass}/${breeds.length}`);
    if (withHitMass === 0) {
      console.log("  → hit_mass not extracted yet — needed for cleave calculator (#13)");
    }
  });
});
```

- [ ] **Step 3: Run the audits**

Run: `node --test scripts/calculator-validation.test.mjs`
Expected: All pass. Console output shows data quality summary — counts of profiles with impact, stagger_category, cleave data, and whether hit_mass exists (expected: 0).

- [ ] **Step 4: Commit**

```bash
git add scripts/calculator-validation.test.mjs
git commit -m "test: add impact/stagger/cleave data quality audits (Phase 1)"
```

---

### Task 4: Validation Test — Known Bug Surface

**Files:**
- Modify: `scripts/calculator-validation.test.mjs`

Characterize Build 14's failure, audit lerp factor usage, and check difficulty_health coverage.

- [ ] **Step 1: Add known bug characterization tests**

Append to `scripts/calculator-validation.test.mjs`:

```js
describe("calculator validation — known bug surface", { skip: !hasGeneratedData && "no generated data" }, () => {
  let index, calcData;

  it("loads shared data", async () => {
    const { loadIndex } = await import("./ground-truth/lib/synergy-model.mjs");
    index = loadIndex();
    calcData = loadCalculatorData();
  });

  it("characterizes Build 14 failure", () => {
    const buildPath = join(buildsDir, "14-arbites-nuncio-aquila.json");
    if (!existsSync(buildPath)) {
      console.log("  Build 14 not found — skipping");
      return;
    }
    const build = JSON.parse(readFileSync(buildPath, "utf-8"));
    try {
      computeBreakpoints(build, index, calcData);
      console.log("  Build 14 succeeded (shield bug may be fixed)");
    } catch (err) {
      console.log(`  Build 14 failure: ${err.message}`);
      // Characterize: which weapon/action/profile caused the crash?
      for (const weapon of build.weapons) {
        const templateName = weapon.canonical_entity_id?.split(".").pop();
        const actionMap = calcData.actionMaps?.find(
          (m) => m.weapon_template === templateName
        );
        if (actionMap) {
          for (const [actionType, profileIds] of Object.entries(actionMap.actions)) {
            for (const pid of profileIds) {
              if (!pid) {
                console.log(`  → null profile ref in ${templateName} / ${actionType}`);
              }
            }
          }
        }
      }
    }
  });

  it("audits lerped_stat_buff usage across all builds", async () => {
    const { loadIndex } = await import("./ground-truth/lib/synergy-model.mjs");
    const idx = loadIndex();
    const lerpedEffects = [];

    for (const file of readdirSync(buildsDir).filter((f) => f.endsWith(".json"))) {
      const build = JSON.parse(readFileSync(join(buildsDir, file), "utf-8"));
      // Collect all entity IDs from the build
      const entityIds = [
        build.ability?.canonical_entity_id,
        build.blitz?.canonical_entity_id,
        build.aura?.canonical_entity_id,
        build.keystone?.canonical_entity_id,
        ...(build.talents || []).map((t) => t.canonical_entity_id),
        ...(build.weapons || []).flatMap((w) => [
          ...(w.blessings || []).map((b) => b.canonical_entity_id),
          ...(w.perks || []).map((p) => p.canonical_entity_id),
        ]),
      ].filter(Boolean);

      for (const eid of entityIds) {
        const entity = idx?.entities?.[eid];
        const effects = entity?.calc?.effects;
        if (!effects) continue;
        for (const effect of effects) {
          if (effect.type === "lerped_stat_buff") {
            lerpedEffects.push({ build: file, entity: eid, stat: effect.stat, condition: effect.condition });
          }
        }
      }
    }

    console.log(`  lerped_stat_buff effects found: ${lerpedEffects.length}`);
    const uniqueConditions = [...new Set(lerpedEffects.map((e) => e.condition).filter(Boolean))];
    console.log(`  Unique lerp conditions: ${uniqueConditions.join(", ") || "(none — all use implicit warp_charge)"}`);
    const uniqueStats = [...new Set(lerpedEffects.map((e) => e.stat))];
    console.log(`  Lerped stats: ${uniqueStats.join(", ")}`);
  });

  it("checks difficulty_health coverage for checklist breeds", () => {
    const breedData = JSON.parse(
      readFileSync(join(generatedDir, "breed-data.json"), "utf-8")
    );
    const breeds = breedData.breeds || [];
    const checklistBreeds = [
      "renegade_berzerker", "chaos_ogryn_executor", "renegade_netgunner",
      "chaos_hound", "chaos_poxwalker_bomber", "chaos_poxwalker",
      "renegade_executor", "chaos_ogryn_bulwark", "renegade_sniper",
    ];
    const difficulties = ["uprising", "malice", "heresy", "damnation", "auric"];

    for (const breedId of checklistBreeds) {
      const breed = breeds.find((b) => b.id === breedId);
      if (!breed) {
        console.log(`  MISSING breed: ${breedId}`);
        continue;
      }
      const missing = difficulties.filter((d) => !breed.difficulty_health?.[d]);
      if (missing.length > 0) {
        console.log(`  ${breedId}: missing difficulty_health for ${missing.join(", ")}`);
      }
    }
  });
});
```

- [ ] **Step 2: Run the full validation suite**

Run: `node --test scripts/calculator-validation.test.mjs`
Expected: All tests pass. Console output provides the full data quality report: Build 14 failure characterization, lerp factor audit, difficulty_health coverage.

- [ ] **Step 3: Commit**

```bash
git add scripts/calculator-validation.test.mjs
git commit -m "test: add known bug surface characterization (Phase 1)"
```

---

### Task 5: Triage Validation Results

**Files:** None — this is an analysis step.

Review the Phase 1 output and decide the Phase 2 fix list and Phase 3 go/no-go.

- [ ] **Step 1: Run the complete validation suite and capture output**

Run: `node --test scripts/calculator-validation.test.mjs 2>&1 | tee /tmp/validation-report.txt`

- [ ] **Step 2: Assess Phase 3 readiness**

Check the data quality summary:
- Impact data coverage: if most profiles have impact, #12 stagger is ready.
- Cleave data coverage: if most profiles have cleave_distribution, #13 cleave is ready (pending hit_mass extraction).
- hit_mass: expected absent — confirms extraction needed for #13.

- [ ] **Step 3: Document findings**

Note any unexpected failures or data gaps discovered. Adjust Phase 2 scope if needed (e.g., if new bugs are found beyond the known list). Adjust Phase 3 ordering if data quality suggests a different priority.

---

## Phase 2: Foundation Fixes

### Task 6: Fix Build 14 Shield Weapon Crash

**Files:**
- Modify: `scripts/ground-truth/lib/damage-calculator.mjs` (in `computeBreakpoints`, around L1170-1190)
- Modify: `scripts/damage-calculator.test.mjs` (add unit test for null profile handling)

**Context:** The `computeBreakpoints` function iterates `actionMap.actions` entries and resolves each profile ID. Shield weapons have action maps with null profile references, causing a crash when the code tries to look up the profile.

- [ ] **Step 1: Write failing test for null profile handling**

Add to `scripts/damage-calculator.test.mjs` in the `computeBreakpoints` describe block:

```js
it("skips null profile references without crashing", () => {
  // Mock action map with a null profile ID
  const mockCalcData = {
    profiles: [{ id: "valid_profile", power_distribution: { attack: 100, impact: 50 }, armor_damage_modifier: { attack: {} }, cleave_distribution: { attack: 1, impact: 1 } }],
    actionMaps: [{ weapon_template: "test_shield_weapon", actions: { light_attack: [null, "valid_profile", null] } }],
    constants: calcData.constants, // reuse real constants
    breeds: [mockBreed],
  };
  const build = {
    class: "veteran",
    weapons: [{ canonical_entity_id: "shared.weapon.test_shield_weapon", resolution_status: "resolved" }],
    talents: [], curios: [],
  };
  const matrix = computeBreakpoints(build, {}, mockCalcData);
  assert.equal(matrix.weapons.length, 1);
  // Should have results from the valid_profile only, null profiles skipped
  const weapon = matrix.weapons[0];
  assert.ok(weapon.actions.length > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/damage-calculator.test.mjs --test-name-pattern "skips null profile"`
Expected: FAIL — crash on null profile reference.

- [ ] **Step 3: Fix `computeBreakpoints` to skip null profiles**

In `scripts/ground-truth/lib/damage-calculator.mjs`, in the `computeBreakpoints` function, find the loop that iterates profile IDs (inside the `for (const [actionType, profileIds] of Object.entries(actionMap.actions))` block). Add a null guard:

```js
for (const profileId of profileIds) {
  if (!profileId) continue; // skip null profile references (shield weapons)
  const rawProfile = profileMap.get(profileId);
  // ... rest of existing code
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/damage-calculator.test.mjs --test-name-pattern "skips null profile"`
Expected: PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `npm test`
Expected: All tests pass. Existing behavior unchanged for non-shield weapons.

- [ ] **Step 6: Commit**

```bash
git add scripts/ground-truth/lib/damage-calculator.mjs scripts/damage-calculator.test.mjs
git commit -m "fix: skip null profile references in computeBreakpoints (Build 14 shield)"
```

---

### Task 7: Fix difficulty_health Fallback Ambiguity

**Files:**
- Modify: `scripts/ground-truth/lib/damage-calculator.mjs` (around L690-693)
- Modify: `scripts/damage-calculator.test.mjs` (update unit tests)
- Modify: `scripts/ground-truth/lib/breakpoint-checklist.mjs` (handle null HTK)

**Context:** Currently `difficulty_health?.[difficulty] ?? 0` maps missing data to `hitsToKill = Infinity`, which is indistinguishable from "damage genuinely negated." Fix: missing data → `hitsToKill: null`.

- [ ] **Step 1: Write failing test for null HTK on missing difficulty_health**

Add to `scripts/damage-calculator.test.mjs` in the `computeHit` describe block:

```js
it("returns null hitsToKill when difficulty_health is missing", () => {
  const breed = { ...mockBreed, difficulty_health: {} }; // no entries
  const result = computeHit({
    profile: mockProfile, hitZone: "torso", breed,
    difficulty: "damnation", flags: {}, buffStack: emptyStack,
    quality: 0.8, distance: 0, chargeLevel: 1, constants: calcData.constants,
  });
  assert.equal(result.hitsToKill, null, "missing HP should produce null, not Infinity");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/damage-calculator.test.mjs --test-name-pattern "null hitsToKill"`
Expected: FAIL — currently returns `Infinity` instead of `null`.

- [ ] **Step 3: Fix the fallback in `computeHit`**

In `damage-calculator.mjs` around L690-693, change:

```js
// Before:
const enemyHP = breed.difficulty_health?.[difficulty] ?? 0;
const hitsToKill = enemyHP > 0 && damage > 0 ? Math.ceil(enemyHP / damage) : Infinity;

// After:
const enemyHP = breed.difficulty_health?.[difficulty];
const hitsToKill = enemyHP == null ? null         // data absent
  : enemyHP > 0 && damage > 0 ? Math.ceil(enemyHP / damage)
  : Infinity;                                      // genuinely unkillable
```

- [ ] **Step 4: Update breakpoint-checklist.mjs to handle null HTK**

In `scripts/ground-truth/lib/breakpoint-checklist.mjs`, in the `bestHitsToKill` function, ensure null values are skipped (not treated as better than any number):

Find the comparison that picks the best (lowest) HTK. Ensure `null` entries are filtered out before comparison. If all entries are `null`, the function should return `null` (not `Infinity`).

Also update `scoreBreakpointRelevance`: if `bestHitsToKill` returns `null` for a checklist entry, exclude that entry from the weighted fraction (don't count it as "met" or "unmet" — it's uncomputable).

- [ ] **Step 5: Update golden snapshot handling for null HTK**

Use this serialization convention:
- `computeHit` returns `null` for data-absent and `Infinity` for genuinely negated damage
- In `calc-build.mjs` freeze mode, serialize with a replacer: `Infinity` → `"Infinity"` string, `null` stays `null` (since `JSON.stringify(Infinity)` produces `null`, which would be ambiguous without this)
- In snapshot deserialization (`damage-calculator.test.mjs` L2387), update the mapping: `"Infinity"` string → `Infinity`, `null` → `null` (data absent, skip comparison)

In `scripts/damage-calculator.test.mjs`, update the golden snapshot regression block: the existing line `const expHTK = ee.hitsToKill === null ? Infinity : ee.hitsToKill` becomes `const expHTK = ee.hitsToKill === "Infinity" ? Infinity : ee.hitsToKill` (null stays null — skip those entries from HTK assertions).

- [ ] **Step 6: Run tests, re-freeze snapshots**

Run: `npm test` — expect some snapshot failures due to the new HTK semantics.
Run: `npm run calc:freeze` — regenerate golden snapshots.
Run: `npm test` — all should pass now.

- [ ] **Step 7: Commit**

```bash
git add scripts/ground-truth/lib/damage-calculator.mjs scripts/damage-calculator.test.mjs scripts/ground-truth/lib/breakpoint-checklist.mjs scripts/calc-build.mjs tests/fixtures/ground-truth/calc/
git commit -m "fix: distinguish data-absent (null) from negated (Infinity) in HTK"
```

---

### Task 8: Fix Lerp Factor Hardcode (Conditional)

**Files:**
- Modify: `scripts/ground-truth/lib/damage-calculator.mjs` (around L950-960)
- Modify: `scripts/damage-calculator.test.mjs`

**Gate:** Only proceed if Task 4/5 revealed lerp variables beyond `warp_charge`. If `warp_charge` is the only one, add a documenting comment and skip implementation.

- [ ] **Step 1: Check Phase 1 lerp audit results**

If only `warp_charge` lerp conditions were found:
- Add comment to the lerp section in `damage-calculator.mjs`:
  ```js
  // All lerped_stat_buff effects in the current build corpus use warp_charge
  // as their interpolation factor. If future builds introduce other lerp
  // variables (e.g., peril, charge_level), resolve the factor from the
  // buff template's condition field instead of hardcoding.
  ```
- Commit and move on.

If other lerp variables exist:

- [ ] **Step 2: Write failing test for non-warp lerp factor**

```js
it("resolves lerp factor from effect condition, not hardcoded warp_charge", () => {
  // ... test with a lerped_stat_buff that uses a different condition
});
```

- [ ] **Step 3: Implement condition-aware lerp factor resolution**

In the lerped_stat_buff handler, read the lerp variable name from `effect.condition` (or a new field), then look it up in `flags[lerpVariable]` instead of hardcoding `flags.warp_charge`.

- [ ] **Step 4: Run tests, commit**

```bash
git add scripts/ground-truth/lib/damage-calculator.mjs scripts/damage-calculator.test.mjs
git commit -m "fix: resolve lerp factor from buff condition instead of hardcoding"
```

---

### Task 9: Re-freeze All Snapshots + Phase 2 Completion

**Files:**
- Modified: `tests/fixtures/ground-truth/calc/*.calc.json`
- Modified: `tests/fixtures/ground-truth/scores/*.score.json` (if scoring changed)

- [ ] **Step 1: Re-freeze calc snapshots (now includes Build 14)**

Run: `npm run calc:freeze`
Expected: 23 snapshot files written (was 22 — Build 14 now included).

- [ ] **Step 2: Re-freeze score snapshots if scoring changed**

Run: `npm run score:freeze`

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/ground-truth/calc/ tests/fixtures/ground-truth/scores/
git commit -m "fix: re-freeze calc/score snapshots after Phase 2 fixes"
```

---

## Phase 3: Calculator Extensions

**Gate:** Proceed only after Phase 1 confirms data quality for each extension. Adjust ordering based on findings.

### Task 10: Extract Stagger Data from Darktide Source

**Files:**
- Modify: `scripts/extract-breed-data.mjs`
- Create: `data/ground-truth/stagger-thresholds.json`

**Context:** Two pieces of data are needed for stagger: (1) per-breed stagger resistance from breed definition files, (2) stagger threshold tables from `stagger_settings.lua` or equivalent. The existing breed extractor's `parseBreedFile` is the template for (1). For (2), a new one-time extraction reads the stagger tables from the source.

- [ ] **Step 1: Read the Darktide source to find stagger data**

Search the source for stagger-related settings:
```bash
grep -r "stagger_resistance\|stagger_settings\|stagger_threshold\|stagger_type" $(cat .source-root)/scripts/settings/ --include="*.lua" -l
```

Identify the file(s) containing:
- Stagger threshold tables (impact value required per stagger tier per armor type)
- Per-breed stagger resistance modifiers
- `stagger_strength_output` or equivalent table from `power_level_settings.lua`

- [ ] **Step 2: Extend `parseBreedFile` to extract stagger resistance**

In `scripts/extract-breed-data.mjs`, add stagger resistance extraction to `parseBreedFile`. The breed definition files contain a `stagger_resistance` field — extract it as a numeric value. Add it to the returned breed object.

If the stagger resistance lives in `minion_difficulty_settings.lua` instead (like `difficulty_health`), add a `parseStaggerResistance(sourceRoot)` function following the `parseDifficultyHealth` pattern.

- [ ] **Step 3: Extract stagger threshold tables**

Write a new extraction function that reads stagger settings from the source and produces `data/ground-truth/stagger-thresholds.json`:

```json
{
  "source_snapshot_id": "...",
  "generated_at": "...",
  "stagger_types": {
    "light": { "description": "Light stagger — brief flinch" },
    "medium": { "description": "Medium stagger — interrupt attack" },
    "heavy": { "description": "Heavy stagger — stun + stumble" }
  },
  "thresholds_by_breed": {
    "renegade_berzerker": { "light": 2.0, "medium": 4.0, "heavy": 8.0 },
    "chaos_ogryn_executor": { "light": 5.0, "medium": 10.0, "heavy": 20.0 }
  }
}
```

The exact structure depends on what the source data looks like. Adapt based on Step 1 findings.

- [ ] **Step 4: Rebuild breed data and verify**

Run: `npm run breeds:build`
Expected: `breed-data.json` now includes `stagger_resistance` per breed.

- [ ] **Step 5: Commit**

```bash
git add scripts/extract-breed-data.mjs data/ground-truth/stagger-thresholds.json
git commit -m "feat: extract stagger resistance + threshold data from source (#12)"
```

---

### Task 11: Implement Stagger Calculator

**Files:**
- Create: `scripts/ground-truth/lib/stagger-calculator.mjs`
- Create: `scripts/stagger-calculator.test.mjs`

**Context:** The stagger pipeline mirrors stages 1-4 of the damage pipeline but uses `power_distribution.impact` and outputs stagger strength compared against breed thresholds. Reuse `boostCurveMultiplier`, `powerLevelToDamage` patterns from `damage-calculator.mjs`.

- [ ] **Step 1: Write failing unit tests for core stagger functions**

```js
// scripts/stagger-calculator.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeImpactPower,
  computeStaggerStrength,
  classifyStaggerTier,
  computeStaggerMatrix,
} from "./ground-truth/lib/stagger-calculator.mjs";

describe("stagger-calculator", () => {
  describe("computeImpactPower", () => {
    it("converts impact power distribution to base impact value", () => {
      // Same curve as powerLevelToDamage but using impact
      const result = computeImpactPower({
        impactPower: 100,
        powerLevel: 500,
        constants: { /* mock power_level_to_damage output table */ },
      });
      assert.ok(typeof result === "number" && result > 0);
    });
  });

  describe("classifyStaggerTier", () => {
    it("returns 'none' when stagger strength is below light threshold", () => {
      assert.equal(classifyStaggerTier(1.0, { light: 2.0, medium: 4.0, heavy: 8.0 }), "none");
    });

    it("returns 'light' when between light and medium", () => {
      assert.equal(classifyStaggerTier(3.0, { light: 2.0, medium: 4.0, heavy: 8.0 }), "light");
    });

    it("returns 'medium' when between medium and heavy", () => {
      assert.equal(classifyStaggerTier(5.0, { light: 2.0, medium: 4.0, heavy: 8.0 }), "medium");
    });

    it("returns 'heavy' when above heavy threshold", () => {
      assert.equal(classifyStaggerTier(10.0, { light: 2.0, medium: 4.0, heavy: 8.0 }), "heavy");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/stagger-calculator.test.mjs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement stagger-calculator.mjs**

Create `scripts/ground-truth/lib/stagger-calculator.mjs`:

```js
// stagger-calculator.mjs — Impact pipeline + stagger tier classification
//
// Mirrors damage-calculator.mjs stages 1-4 but uses power_distribution.impact
// and compares against breed stagger thresholds instead of HP.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load stagger threshold data.
 */
export function loadStaggerData() {
  const thresholds = JSON.parse(
    readFileSync(join(__dirname, "..", "..", "..", "data", "ground-truth", "stagger-thresholds.json"), "utf-8")
  );
  return thresholds;
}

/**
 * Compute base impact power from power_distribution.impact.
 * Same scaling as powerLevelToDamage but using impact value.
 */
export function computeImpactPower({ impactPower, powerLevel, constants }) {
  // Reuse the same power-level-to-output curve as damage
  // The source uses the same interpolation table for both damage and impact
  // Implementation mirrors powerLevelToDamage from damage-calculator.mjs
  // but with impact power distribution instead of attack
  // ... (exact implementation depends on source verification in Task 10)
}

/**
 * Apply impact buff multipliers from buff stack.
 * Analogous to calculateDamageBuff for the impact path.
 */
export function applyImpactBuffs(baseImpact, buffStack) {
  // Impact-specific buffs: impact_modifier, stagger_strength_modifier, etc.
  // ... (stat names from synergy-stat-families.mjs)
}

/**
 * Compute stagger strength from impact power and armor type.
 * Uses stagger_strength_output table from power_level_settings constants.
 */
export function computeStaggerStrength({ impactValue, armorType, constants, isRending }) {
  // Look up stagger_strength_output[armorType] interpolation
  // If rending, apply 2× multiplier (verify from source)
  // ... (exact multiplier from source verification)
}

/**
 * Classify stagger tier based on stagger strength vs breed thresholds.
 * Returns: "none" | "light" | "medium" | "heavy" | "stun"
 */
export function classifyStaggerTier(staggerStrength, thresholds) {
  if (staggerStrength >= (thresholds.heavy ?? Infinity)) return "heavy";
  if (staggerStrength >= (thresholds.medium ?? Infinity)) return "medium";
  if (staggerStrength >= (thresholds.light ?? Infinity)) return "light";
  return "none";
}

/**
 * Compute full stagger matrix for a build.
 * For each weapon × action × breed: stagger tier achieved.
 */
export function computeStaggerMatrix(build, index, calcData, staggerData) {
  // Pattern mirrors computeBreakpoints from damage-calculator.mjs:
  // - Iterate weapons → action maps → profiles
  // - For each profile, use power_distribution.impact
  // - Compute impact power → apply buffs → stagger strength → classify tier
  // - Compare against breed-specific thresholds from staggerData
  // ...
}
```

The exact formulas for `computeImpactPower` and `computeStaggerStrength` depend on the source data read in Task 10. The structure and interfaces are fixed; the internals are filled in after reading the Lua source.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/stagger-calculator.test.mjs`
Expected: PASS

- [ ] **Step 5: Add integration tests with real data**

Add tests that load real build data and verify:
- No NaN stagger strength values
- Every melee weapon produces stagger results
- Stagger tiers are valid enum values

- [ ] **Step 6: Commit**

```bash
git add scripts/ground-truth/lib/stagger-calculator.mjs scripts/stagger-calculator.test.mjs
git commit -m "feat: implement stagger calculator — impact pipeline + tier classification (#12)"
```

---

### Task 12: Stagger CLI + Scoring Integration

**Files:**
- Create: `scripts/stagger-build.mjs`
- Modify: `data/ground-truth/breakpoint-checklist.json`
- Modify: `scripts/ground-truth/lib/breakpoint-checklist.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create stagger CLI entry point**

Create `scripts/stagger-build.mjs` following the pattern of `scripts/calc-build.mjs`:

```js
#!/usr/bin/env node
// stagger-build.mjs — CLI for stagger analysis
// Usage: npm run stagger -- <build.json> [--text|--json]
//        npm run stagger -- <dir>/     (batch mode)
//        npm run stagger -- <dir>/ --json --freeze

import { parseArgs } from "node:util";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCalculatorData } from "./ground-truth/lib/damage-calculator.mjs";
import { computeStaggerMatrix, loadStaggerData } from "./ground-truth/lib/stagger-calculator.mjs";

// ... parseArgs for --json, --text, --freeze
// ... single file mode: computeStaggerMatrix → format output
// ... batch mode: iterate directory
// ... freeze mode: write to tests/fixtures/ground-truth/stagger/
```

- [ ] **Step 2: Add stagger checklist entries**

Add stagger-specific entries to `data/ground-truth/breakpoint-checklist.json`:

```json
{ "label": "Stagger Crusher overhead", "breed_id": "chaos_ogryn_executor", "difficulty": "damnation", "min_tier": "medium", "type": "stagger", "weight": "high" },
{ "label": "Stagger Rager attack", "breed_id": "renegade_berzerker", "difficulty": "damnation", "min_tier": "light", "type": "stagger", "weight": "medium" },
{ "label": "Stagger Mauler heavy", "breed_id": "renegade_executor", "difficulty": "damnation", "min_tier": "medium", "type": "stagger", "weight": "medium" }
```

Note: the exact `min_tier` values depend on what the community considers important breakpoints. The stagger tier names and thresholds come from Task 10's source extraction.

- [ ] **Step 3: Update breakpoint-checklist.mjs to handle stagger entries**

Add a `scoreStaggerRelevance(staggerMatrix)` function or extend `scoreBreakpointRelevance` to handle both damage and stagger checklist entries (distinguished by `type` field: `"damage"` vs `"stagger"`).

- [ ] **Step 4: Add package.json scripts**

```json
"stagger": "node scripts/stagger-build.mjs",
"stagger:freeze": "node scripts/stagger-build.mjs scripts/builds/ --json --freeze"
```

Add `scripts/stagger-calculator.test.mjs` to the `test` script file list.

- [ ] **Step 5: Freeze stagger snapshots**

Run: `npm run stagger:freeze`
Expected: Snapshot files created in `tests/fixtures/ground-truth/stagger/`.

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/stagger-build.mjs data/ground-truth/breakpoint-checklist.json scripts/ground-truth/lib/breakpoint-checklist.mjs package.json tests/fixtures/ground-truth/stagger/
git commit -m "feat: add stagger CLI + scoring integration (#12)"
```

---

### Task 13: Extract Hit Mass for Cleave

**Files:**
- Modify: `scripts/extract-breed-data.mjs`

**Context:** `hit_mass` lives in `minion_difficulty_settings.lua` alongside `difficulty_health` (already parsed by `parseDifficultyHealth`). Add a parallel `parseHitMass()` function.

- [ ] **Step 1: Read the source file for hit_mass data**

```bash
grep -n "hit_mass" $(cat .source-root)/scripts/settings/difficulty/minion_difficulty_settings.lua | head -30
```

Identify the table structure. It likely maps breed category → hit mass value (possibly per difficulty level, like `difficulty_health`).

- [ ] **Step 2: Write the `parseHitMass` function**

Add to `scripts/extract-breed-data.mjs`, following the `parseDifficultyHealth` pattern:

```js
function parseHitMass(sourceRoot) {
  const luaPath = join(sourceRoot, "scripts/settings/difficulty/minion_difficulty_settings.lua");
  const lua = readFileSync(luaPath, "utf-8");
  // Parse the hit_mass table — structure depends on Step 1 findings
  // Return Map<breedName, number | {[difficulty]: number}>
}
```

- [ ] **Step 3: Integrate into the pipeline**

In the main pipeline, call `parseHitMass()` in Phase 1 (alongside `parseDifficultyHealth`), then attach `hit_mass` to each breed record in Phase 3 (alongside `difficulty_health`).

- [ ] **Step 4: Rebuild breed data and verify**

Run: `npm run breeds:build`
Verify: `data/ground-truth/generated/breed-data.json` now includes `hit_mass` on breed records.

- [ ] **Step 5: Re-run validation to confirm hit_mass is present**

Run: `node --test scripts/calculator-validation.test.mjs --test-name-pattern "hit_mass"`
Expected: Reports non-zero count of breeds with hit_mass.

- [ ] **Step 6: Commit**

```bash
git add scripts/extract-breed-data.mjs
git commit -m "feat: extract hit_mass per breed for cleave calculator (#13)"
```

---

### Task 14: Implement Cleave Calculator

**Files:**
- Create: `scripts/ground-truth/lib/cleave-calculator.mjs`
- Create: `scripts/cleave-calculator.test.mjs`

- [ ] **Step 1: Write failing unit tests for cleave functions**

```js
// scripts/cleave-calculator.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveCleaveBudget,
  simulateCleave,
  computeCleaveMatrix,
} from "./ground-truth/lib/cleave-calculator.mjs";

describe("cleave-calculator", () => {
  describe("resolveCleaveBudget", () => {
    it("lerps cleave_distribution.attack by quality", () => {
      const budget = resolveCleaveBudget({ attack: [3, 7] }, 0.8);
      // lerp(3, 7, 0.8) = 3 + (7-3)*0.8 = 6.2
      assert.ok(Math.abs(budget - 6.2) < 0.001);
    });

    it("handles scalar cleave values", () => {
      const budget = resolveCleaveBudget({ attack: 5 }, 0.8);
      assert.equal(budget, 5);
    });
  });

  describe("simulateCleave", () => {
    it("stops when cleave budget is exhausted", () => {
      const result = simulateCleave({
        cleavebudget: 3.0,
        targets: [
          { breed_id: "poxwalker", hit_mass: 1.0, hp: 100 },
          { breed_id: "poxwalker", hit_mass: 1.0, hp: 100 },
          { breed_id: "poxwalker", hit_mass: 1.0, hp: 100 },
          { breed_id: "poxwalker", hit_mass: 1.0, hp: 100 }, // not reached
        ],
        computeDamageForTarget: (targetIndex) => 150, // kills each
      });
      assert.equal(result.targets_hit, 3);
      assert.equal(result.targets_killed, 3);
    });

    it("uses per-target damage falloff", () => {
      const damages = [200, 150, 100, 50];
      const result = simulateCleave({
        cleavebudget: 10.0,
        targets: [
          { breed_id: "a", hit_mass: 1.0, hp: 180 },
          { breed_id: "b", hit_mass: 1.0, hp: 180 },
        ],
        computeDamageForTarget: (i) => damages[i],
      });
      assert.equal(result.targets_hit, 2);
      assert.equal(result.targets_killed, 1); // first killed (200>180), second not (150<180)
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/cleave-calculator.test.mjs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement cleave-calculator.mjs**

Create `scripts/ground-truth/lib/cleave-calculator.mjs`:

```js
// cleave-calculator.mjs — Cleave budget simulation
//
// Simulates multi-target melee sweeps: how many enemies are hit and killed
// given a weapon's cleave budget and the horde composition's hit masses.

/**
 * Resolve cleave budget from cleave_distribution, lerped by quality.
 */
export function resolveCleaveBudget(cleaveDistribution, quality) {
  const raw = cleaveDistribution?.attack;
  if (raw == null) return 0;
  if (Array.isArray(raw)) {
    const [min, max] = raw;
    return min + (max - min) * quality;
  }
  return raw;
}

/**
 * Simulate a single cleave sweep against an ordered list of targets.
 *
 * @param {Object} params
 * @param {number} params.cleaveBudget - Total cleave budget for this swing
 * @param {Array<{breed_id, hit_mass, hp}>} params.targets - Ordered target list
 * @param {(targetIndex: number) => number} params.computeDamageForTarget
 *   - Returns damage dealt to the Nth target (accounts for targets[n] overrides)
 * @returns {{ targets_hit, targets_killed, per_target[] }}
 */
export function simulateCleave({ cleaveBudget, targets, computeDamageForTarget }) {
  let remaining = cleaveBudget;
  const perTarget = [];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    if (remaining < target.hit_mass && i > 0) break; // first target always hit
    remaining -= target.hit_mass;

    const damage = computeDamageForTarget(i);
    const killed = damage >= target.hp;
    perTarget.push({
      breed_id: target.breed_id,
      hit_mass: target.hit_mass,
      damage,
      hp: target.hp,
      killed,
    });

    if (remaining <= 0) break;
  }

  return {
    targets_hit: perTarget.length,
    targets_killed: perTarget.filter((t) => t.killed).length,
    per_target: perTarget,
  };
}

/**
 * Compute full cleave matrix for a build.
 * For each melee weapon × action: simulate cleave against standard compositions.
 */
export function computeCleaveMatrix(build, index, calcData) {
  // Standard horde compositions — assembled from breed data
  // Uses computeHit from damage-calculator.mjs for per-target damage
  // with targets[n] profile overrides for damage falloff
  // ...
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/cleave-calculator.test.mjs`
Expected: PASS

- [ ] **Step 5: Add integration tests with real data**

Test against real builds:
- Melee weapons produce cleave results
- Ranged-only weapons are skipped
- No NaN values in per-target damage
- targets_hit <= targets in composition

- [ ] **Step 6: Commit**

```bash
git add scripts/ground-truth/lib/cleave-calculator.mjs scripts/cleave-calculator.test.mjs
git commit -m "feat: implement cleave calculator — budget simulation + per-target damage (#13)"
```

---

### Task 15: Cleave CLI + Scoring Integration

**Files:**
- Create: `scripts/cleave-build.mjs`
- Modify: `data/ground-truth/breakpoint-checklist.json`
- Modify: `scripts/ground-truth/lib/breakpoint-checklist.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create cleave CLI entry point**

Create `scripts/cleave-build.mjs` following the `stagger-build.mjs` / `calc-build.mjs` pattern. Text mode shows per-weapon cleave table with targets hit/killed per composition. Freeze mode writes to `tests/fixtures/ground-truth/cleave/`.

- [ ] **Step 2: Add cleave checklist entries**

Add cleave entries to `data/ground-truth/breakpoint-checklist.json`:

```json
{ "label": "Heavy cleaves 3+ in mixed horde", "type": "cleave", "composition": "mixed_horde", "min_killed": 3, "action_category": "heavy", "weight": "high" },
{ "label": "Light cleaves 2+ in mixed horde", "type": "cleave", "composition": "mixed_horde", "min_killed": 2, "action_category": "light", "weight": "medium" }
```

The exact entries and thresholds depend on what realistic horde compositions look like from the source data (Task 13). Adjust after seeing real cleave numbers.

- [ ] **Step 3: Update breakpoint-checklist.mjs for cleave scoring**

Add `scoreCleaveRelevance(cleaveMatrix)` or extend the existing scoring to handle `type: "cleave"` entries.

- [ ] **Step 4: Add package.json scripts**

```json
"cleave": "node scripts/cleave-build.mjs",
"cleave:freeze": "node scripts/cleave-build.mjs scripts/builds/ --json --freeze"
```

Add `scripts/cleave-calculator.test.mjs` to the `test` script.

- [ ] **Step 5: Freeze cleave snapshots and run tests**

Run: `npm run cleave:freeze && npm test`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/cleave-build.mjs data/ground-truth/breakpoint-checklist.json scripts/ground-truth/lib/breakpoint-checklist.mjs package.json tests/fixtures/ground-truth/cleave/
git commit -m "feat: add cleave CLI + scoring integration (#13)"
```

---

### Task 16: Extract Class Base Stats for Toughness

**Files:**
- Create: `data/ground-truth/class-base-stats.json`

**Context:** Toughness calculator needs per-class HP, toughness, and wounds. These come from archetype definitions in the decompiled source.

- [ ] **Step 1: Find class base stats in the Darktide source**

```bash
grep -rn "base_health\|base_toughness\|max_wounds\|archetype_health" $(cat .source-root)/scripts/settings/ --include="*.lua" -l
```

Likely location: `scripts/settings/ability/archetype_settings/` or `scripts/settings/player/player_base_settings.lua`.

- [ ] **Step 2: Extract and create class-base-stats.json**

```json
{
  "source_snapshot_id": "...",
  "classes": {
    "veteran": { "base_health": 200, "base_toughness": 200, "wounds": 3 },
    "zealot": { "base_health": 200, "base_toughness": 200, "wounds": 3 },
    "psyker": { "base_health": 150, "base_toughness": 200, "wounds": 3 },
    "ogryn": { "base_health": 300, "base_toughness": 200, "wounds": 3 }
  },
  "toughness_regen": {
    "base_rate": 5.0,
    "coherency_multipliers": { "0": 0, "1": 0.5, "3": 1.0 }
  },
  "dodge_tdr": {
    "veteran": 1.0, "zealot": 0.5, "psyker": 0.5, "ogryn": 1.0
  },
  "sprint_tdr": {
    "veteran": 1.0, "zealot": 0.5, "psyker": 1.0, "ogryn": 1.0
  }
}
```

Values are placeholders — replace with actual values from the source. This is a checked-in data file (not generated) because it's small and changes rarely.

- [ ] **Step 3: Verify values against source**

Cross-reference each value against the decompiled Lua. Add `refs` comments or a companion evidence file if needed.

- [ ] **Step 4: Commit**

```bash
git add data/ground-truth/class-base-stats.json
git commit -m "feat: add per-class base stats for toughness calculator (#11)"
```

---

### Task 17: Implement Toughness Calculator

**Files:**
- Create: `scripts/ground-truth/lib/toughness-calculator.mjs`
- Create: `scripts/toughness-calculator.test.mjs`

- [ ] **Step 1: Write failing unit tests**

```js
// scripts/toughness-calculator.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeToughnessDR,
  computeEffectiveHP,
  computeBleedthrough,
  computeSurvivability,
} from "./ground-truth/lib/toughness-calculator.mjs";

describe("toughness-calculator", () => {
  describe("computeToughnessDR", () => {
    it("multiplies DR sources together", () => {
      // 15% + 10% DR → 1 - (0.85 * 0.90) = 0.235 total DR
      const result = computeToughnessDR([0.15, 0.10]);
      assert.ok(Math.abs(result.total_dr - 0.235) < 0.001);
    });

    it("returns 0 DR with no sources", () => {
      const result = computeToughnessDR([]);
      assert.equal(result.total_dr, 0);
    });
  });

  describe("computeEffectiveHP", () => {
    it("calculates effective HP from base stats + DR", () => {
      const result = computeEffectiveHP({
        baseHealth: 200,
        wounds: 3,
        baseToughness: 200,
        toughnessDR: 0.20,
      });
      // HP component: 200 * 3 = 600
      // Toughness component: 200 / (1 - 0.20) = 250 effective
      // Total: 850
      assert.ok(result.effective_hp > 600);
    });
  });

  describe("computeBleedthrough", () => {
    it("computes melee bleedthrough at partial toughness", () => {
      const result = computeBleedthrough({
        incomingDamage: 100,
        toughnessPercent: 0.5,
        isMelee: true,
        spilloverMod: 1.0,
      });
      // bleedthrough = lerp(damage, 0, toughness_percent * spillover_mod)
      assert.ok(result.bleedthrough >= 0 && result.bleedthrough <= 100);
    });

    it("returns zero bleedthrough for ranged at partial toughness", () => {
      const result = computeBleedthrough({
        incomingDamage: 100,
        toughnessPercent: 0.5,
        isMelee: false,
      });
      assert.equal(result.bleedthrough, 0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/toughness-calculator.test.mjs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement toughness-calculator.mjs**

Create `scripts/ground-truth/lib/toughness-calculator.mjs`:

```js
// toughness-calculator.mjs — Defender-side survivability analysis
//
// Implements the defender perspective of stages 10, 12, 13:
// - Toughness damage reduction from build talents/blessings/curio perks
// - Melee bleedthrough formula
// - Effective HP calculation
// - Toughness regen rate (coherency-based)

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadClassBaseStats() {
  return JSON.parse(
    readFileSync(join(__dirname, "..", "..", "..", "data", "ground-truth", "class-base-stats.json"), "utf-8")
  );
}

/**
 * Compute total toughness damage reduction from a list of DR multiplier values.
 * Darktide uses multiplicative DR stacking: effective = 1 - product(1 - dr_i)
 */
export function computeToughnessDR(drSources) {
  if (drSources.length === 0) return { total_dr: 0, sources: [] };
  const product = drSources.reduce((acc, dr) => acc * (1 - dr), 1);
  return { total_dr: 1 - product, sources: drSources };
}

/**
 * Compute effective HP accounting for toughness + DR.
 */
export function computeEffectiveHP({ baseHealth, wounds, baseToughness, toughnessDR }) {
  const healthPool = baseHealth * wounds;
  const effectiveToughness = toughnessDR > 0 ? baseToughness / (1 - toughnessDR) : baseToughness;
  return {
    health_pool: healthPool,
    effective_toughness: effectiveToughness,
    effective_hp: healthPool + effectiveToughness,
  };
}

/**
 * Compute melee bleedthrough damage.
 * Melee: bleedthrough = lerp(damage, 0, toughness_percent * spillover_mod)
 * Ranged: no bleedthrough while toughness > 0; full spillover when toughness breaks
 */
export function computeBleedthrough({ incomingDamage, toughnessPercent, isMelee, spilloverMod = 1.0 }) {
  if (!isMelee) return { bleedthrough: 0 };
  const factor = toughnessPercent * spilloverMod;
  const bleedthrough = incomingDamage * (1 - factor);
  return { bleedthrough: Math.max(0, bleedthrough) };
}

/**
 * Compute full survivability profile for a build.
 */
export function computeSurvivability(build, index) {
  const baseStats = loadClassBaseStats();
  const classStats = baseStats.classes[build.class];
  if (!classStats) return null;

  // Collect DR sources from build's resolved entities
  // (talents, blessings, curio perks with toughness_damage_taken_multiplier,
  //  damage_reduction, etc.)
  // ...

  // Compute effective HP, toughness regen, dodge/sprint TDR modifiers
  // ...
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/toughness-calculator.test.mjs`
Expected: PASS

- [ ] **Step 5: Add integration tests**

Test against real builds with known defensive loadouts (e.g., zealot builds with DR talents).

- [ ] **Step 6: Commit**

```bash
git add scripts/ground-truth/lib/toughness-calculator.mjs scripts/toughness-calculator.test.mjs
git commit -m "feat: implement toughness calculator — DR, effective HP, bleedthrough (#11)"
```

---

### Task 18: Toughness CLI

**Files:**
- Create: `scripts/toughness-build.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create toughness CLI entry point**

Create `scripts/toughness-build.mjs` following the established CLI pattern. Text mode shows:
- Class base stats
- DR sources and total DR
- Effective toughness and effective HP
- Dodge/sprint TDR modifiers
- Toughness regen rates at 0/1/3 allies

- [ ] **Step 2: Add package.json scripts**

```json
"toughness": "node scripts/toughness-build.mjs",
"toughness:freeze": "node scripts/toughness-build.mjs scripts/builds/ --json --freeze"
```

Add `scripts/toughness-calculator.test.mjs` to the `test` script.

- [ ] **Step 3: Freeze toughness snapshots and run tests**

Run: `npm run toughness:freeze && npm test`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/toughness-build.mjs package.json tests/fixtures/ground-truth/toughness/
git commit -m "feat: add toughness CLI — survivability analysis per build (#11)"
```

---

### Task 19: Update AGENTS.md + Close Issues

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Update AGENTS.md**

Move #11, #12, #13 from "Open Issues" to "Completed Issues." Add sections documenting the new calculators:

- Stagger Calculator: purpose, CLI usage, scoring integration
- Cleave Calculator: purpose, CLI usage, horde compositions, scoring integration
- Toughness Calculator: purpose, CLI usage, scoring status (deferred)

Add new commands to the Commands section:
```bash
npm run stagger -- <build.json> [--text|--json]
npm run cleave -- <build.json> [--text|--json]
npm run toughness -- <build.json> [--text|--json]
```

Update "Known Scoring/Calculator Limitations" to remove resolved items and document any new limitations discovered.

Update `make check` documentation if new build steps were added.

- [ ] **Step 2: Close GitHub issues**

```bash
gh issue close 11 --comment "Toughness calculator implemented — computation + CLI. Scoring integration deferred to website phase."
gh issue close 12 --comment "Stagger calculator implemented — impact pipeline + stagger tier classification + scoring integration."
gh issue close 13 --comment "Cleave calculator implemented — budget simulation + horde efficiency + scoring integration."
```

- [ ] **Step 3: Final full test suite run**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs: update AGENTS.md — mark #11, #12, #13 complete, add calculator docs"
```
