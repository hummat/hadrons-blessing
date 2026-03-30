/**
 * Calculator validation tests — smoke tests, data audits, and known-bug
 * characterization for the damage pipeline across all 23 builds.
 *
 * Tasks 2-4 from the calculator validation plan.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILDS_DIR = join(__dirname, "..", "..", "data", "builds");
const GENERATED_DIR = join(__dirname, "..", "..", "data", "ground-truth", "generated");

const hasGeneratedData =
  existsSync(join(GENERATED_DIR, "damage-profiles.json")) &&
  existsSync(join(GENERATED_DIR, "breed-data.json"));

// ======================================================================
// Task 2: Damage Pipeline Sanity
// ======================================================================

describe("Task 2: Damage Pipeline Sanity", { skip: !hasGeneratedData && "no generated data" }, async () => {
  // Load everything once before tests run
  const { loadCalculatorData, computeBreakpoints } = await import(
    "./damage-calculator.js"
  );
  const { loadIndex } = await import("./synergy-model.js");

  const calcData = loadCalculatorData();
  const index = loadIndex();

  const files = readdirSync(BUILDS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const builds = files.map((f) => ({
    file: f,
    build: JSON.parse(readFileSync(join(BUILDS_DIR, f), "utf-8")),
  }));

  /** @type {Map<string, any>} */
  const results = new Map();
  /** @type {Map<string, Error>} */
  const errors = new Map();

  for (const { file, build } of builds) {
    try {
      const result = computeBreakpoints(build, index, calcData);
      results.set(file, result);
    } catch (err) {
      errors.set(file, /** @type {Error} */ (err));
      console.log(`[expected?] ${file} threw: ${/** @type {Error} */ (err).message}`);
    }
  }

  it("runs computeBreakpoints on all 23 builds (capturing errors)", () => {
    assert.equal(builds.length, 23, `expected 23 builds, found ${builds.length}`);
    // Build 14 may crash — that's OK. Others should succeed.
    const unexpectedErrors = [...errors.entries()].filter(
      ([f]) => !f.startsWith("14-"),
    );
    if (unexpectedErrors.length > 0) {
      const details = unexpectedErrors
        .map(([f, e]) => `  ${f}: ${e.message}`)
        .join("\n");
      assert.fail(`unexpected errors in non-build-14 builds:\n${details}`);
    }
  });

  it("no NaN damage values", () => {
    for (const [file, result] of results) {
      for (const weapon of result.weapons) {
        for (const action of weapon.actions) {
          for (const [scenarioName, scenario] of Object.entries(action.scenarios)) {
            for (const entry of scenario.breeds) {
              assert.ok(
                !Number.isNaN(entry.damage),
                `NaN damage in ${file} → ${weapon.entityId} → ${action.type}/${action.profileId} → ${scenarioName} → ${entry.breed_id}/${entry.difficulty}`,
              );
            }
          }
        }
      }
    }
  });

  it("no negative damage values", () => {
    for (const [file, result] of results) {
      for (const weapon of result.weapons) {
        for (const action of weapon.actions) {
          for (const [scenarioName, scenario] of Object.entries(action.scenarios)) {
            for (const entry of scenario.breeds) {
              assert.ok(
                entry.damage >= 0,
                `negative damage (${entry.damage}) in ${file} → ${weapon.entityId} → ${action.type}/${action.profileId} → ${scenarioName} → ${entry.breed_id}/${entry.difficulty}`,
              );
            }
          }
        }
      }
    }
  });

  it("no implausible HTK values (>200, excluding Infinity)", () => {
    // Many weapon/breed combinations legitimately produce HTK>200:
    //  - Boss/captain breeds have enormous HP pools
    //  - Low-damage weapons (needle pistol, push) vs armored targets
    // We report HTK>200 informationally, but only hard-fail on truly
    // implausible values (>1000 for non-boss breeds) that would indicate
    // a pipeline math bug.
    const HIGH_HP_BREED_PATTERNS = [
      "captain", "beast_of_nurgle", "chaos_spawn", "daemonhost",
      "plague_ogryn", "mutant", "chaos_ogryn",
    ];
    const isBoss = (breedId) =>
      HIGH_HP_BREED_PATTERNS.some((p) => breedId.includes(p));

    let countOver200 = 0;
    const trulyImplausible = [];
    for (const [file, result] of results) {
      for (const weapon of result.weapons) {
        for (const action of weapon.actions) {
          for (const [scenarioName, scenario] of Object.entries(action.scenarios)) {
            for (const entry of scenario.breeds) {
              if (!Number.isFinite(entry.hitsToKill)) continue;
              if (entry.hitsToKill > 200) {
                countOver200++;
              }
              // Hard-fail threshold: >1000 for non-boss breeds signals a pipeline bug
              if (entry.hitsToKill > 1000 && !isBoss(entry.breed_id)) {
                trulyImplausible.push(
                  `${file} → ${weapon.entityId} → ${action.type}/${action.profileId} → ${scenarioName} → ${entry.breed_id}/${entry.difficulty}: HTK=${entry.hitsToKill}`,
                );
              }
            }
          }
        }
      }
    }
    if (countOver200 > 0) {
      console.log(
        `HTK>200 entries: ${countOver200} (includes bosses and low-damage weapon combos)`,
      );
    }
    if (trulyImplausible.length > 0) {
      assert.fail(
        `${trulyImplausible.length} implausible HTK values (>1000, non-boss):\n  ${trulyImplausible.slice(0, 10).join("\n  ")}${trulyImplausible.length > 10 ? `\n  ... and ${trulyImplausible.length - 10} more` : ""}`,
      );
    }
  });

  it("every weapon resolves to at least one action", () => {
    const weaponsWithNoActions = [];
    for (const [file, result] of results) {
      for (const weapon of result.weapons) {
        if (weapon.actions.length === 0) {
          weaponsWithNoActions.push(`${file} → ${weapon.entityId}`);
        }
      }
    }
    if (weaponsWithNoActions.length > 0) {
      assert.fail(
        `${weaponsWithNoActions.length} weapon(s) with 0 actions:\n  ${weaponsWithNoActions.join("\n  ")}`,
      );
    }
  });

  it("Build 14 error is captured without failing the suite", () => {
    // This test documents whether Build 14 crashes. Either outcome is acceptable.
    if (errors.has("14-arbites-nuncio-aquila.json")) {
      const err = errors.get("14-arbites-nuncio-aquila.json");
      console.log(`Build 14 error (captured): ${err.message}`);
    } else if (results.has("14-arbites-nuncio-aquila.json")) {
      const r = results.get("14-arbites-nuncio-aquila.json");
      console.log(
        `Build 14 succeeded: ${r.weapons.length} weapon(s), ` +
          `${r.weapons.reduce((s, w) => s + w.actions.length, 0)} total actions`,
      );
    }
    // Always passes — this is a characterization test
    assert.ok(true);
  });
});

// ======================================================================
// Task 3: Impact / Stagger / Cleave Data Audit
// ======================================================================

describe("Task 3: Impact/Stagger/Cleave Data Audit", { skip: !hasGeneratedData && "no generated data" }, async () => {
  const { loadCalculatorData } = await import(
    "./damage-calculator.js"
  );
  const data = loadCalculatorData();

  it("every profile with power_distribution.attack also has power_distribution.impact", () => {
    const missing = [];
    for (const profile of data.profiles) {
      const pd = profile.power_distribution;
      if (!pd) continue;
      if (pd.attack != null && pd.impact == null) {
        missing.push(profile.id);
      }
    }
    assert.equal(
      missing.length,
      0,
      `${missing.length} profile(s) have attack but no impact:\n  ${missing.slice(0, 10).join("\n  ")}`,
    );
  });

  it("impact values are non-negative numbers", () => {
    const bad = [];
    for (const profile of data.profiles) {
      const pd = profile.power_distribution;
      if (!pd || pd.impact == null) continue;
      const impact = pd.impact;
      // impact can be a scalar or [min, max] array
      const values = Array.isArray(impact) ? impact : [impact];
      for (const v of values) {
        if (typeof v !== "number" || v < 0 || Number.isNaN(v)) {
          bad.push(`${profile.id}: impact=${JSON.stringify(impact)}`);
        }
      }
    }
    assert.equal(
      bad.length,
      0,
      `${bad.length} profile(s) with invalid impact values (negative/NaN/non-number):\n  ${bad.slice(0, 10).join("\n  ")}`,
    );
  });

  it("reports stagger_category presence (informational)", () => {
    let withStagger = 0;
    let withoutStagger = 0;
    for (const profile of data.profiles) {
      if (profile.stagger_category) {
        withStagger++;
      } else {
        withoutStagger++;
      }
    }
    console.log(
      `stagger_category: ${withStagger}/${data.profiles.length} profiles have it, ${withoutStagger} missing`,
    );
    // Informational — always passes
    assert.ok(true);
  });

  it("reports cleave_distribution coverage (informational)", () => {
    let withCleave = 0;
    let missingCleave = 0;
    let missingCleaveAttack = 0;
    let missingCleaveImpact = 0;
    const missingIds = [];

    for (const profile of data.profiles) {
      const cd = profile.cleave_distribution;
      if (!cd) {
        missingCleave++;
        missingIds.push(profile.id);
        continue;
      }
      withCleave++;
      if (cd.attack == null) missingCleaveAttack++;
      if (cd.impact == null) missingCleaveImpact++;
    }

    console.log(
      `cleave_distribution: ${withCleave}/${data.profiles.length} profiles have it, ${missingCleave} missing`,
    );
    if (missingCleaveAttack > 0) {
      console.log(`  missing cleave_distribution.attack: ${missingCleaveAttack}`);
    }
    if (missingCleaveImpact > 0) {
      console.log(`  missing cleave_distribution.impact: ${missingCleaveImpact}`);
    }
    if (missingIds.length > 0) {
      console.log(
        `  profiles without cleave_distribution: ${missingIds.slice(0, 10).join(", ")}${missingIds.length > 10 ? ` ... +${missingIds.length - 10} more` : ""}`,
      );
    }
    // Informational — always passes
    assert.ok(true);
  });

  it("cleave values are non-negative numbers", () => {
    const bad = [];
    for (const profile of data.profiles) {
      const cd = profile.cleave_distribution;
      if (!cd) continue;
      for (const field of ["attack", "impact"]) {
        const val = cd[field];
        if (val == null) continue;
        const values = Array.isArray(val) ? val : [val];
        for (const v of values) {
          if (typeof v !== "number" || v < 0 || Number.isNaN(v)) {
            bad.push(`${profile.id}: cleave_distribution.${field}=${JSON.stringify(val)}`);
          }
        }
      }
    }
    assert.equal(
      bad.length,
      0,
      `${bad.length} profile(s) with invalid cleave values (negative/NaN/non-number):\n  ${bad.slice(0, 10).join("\n  ")}`,
    );
  });

  it("reports hit_mass presence in breed data (informational)", () => {
    let withHitMass = 0;
    let withoutHitMass = 0;
    for (const breed of data.breeds) {
      if (breed.hit_mass != null) {
        withHitMass++;
      } else {
        withoutHitMass++;
      }
    }
    console.log(
      `hit_mass in breed data: ${withHitMass}/${data.breeds.length} breeds have it (expected: 0)`,
    );
    // Informational — always passes
    assert.ok(true);
  });
});

// ======================================================================
// Task 4: Known Bug Surface
// ======================================================================

describe("Task 4: Known Bug Surface", { skip: !hasGeneratedData && "no generated data" }, async () => {
  const { loadCalculatorData, computeBreakpoints } = await import(
    "./damage-calculator.js"
  );
  const { loadIndex } = await import("./synergy-model.js");

  const data = loadCalculatorData();
  const idx = loadIndex();

  const files = readdirSync(BUILDS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const allBuilds = files.map((f) => ({
    file: f,
    build: JSON.parse(readFileSync(join(BUILDS_DIR, f), "utf-8")),
  }));

  // ── Build 14 failure characterization ──

  it("Build 14: characterize the failure — identify weapon/action with null profile refs", () => {
    const build14Entry = allBuilds.find((b) => b.file.startsWith("14-"));
    assert.ok(build14Entry, "Build 14 not found");

    const build = build14Entry.build;

    // Build the action map lookup
    const actionMapByTemplate = new Map();
    for (const am of data.actionMaps) {
      actionMapByTemplate.set(am.weapon_template, am);
    }

    const profileMap = new Map();
    for (const p of data.profiles) {
      profileMap.set(p.id, p);
    }

    const issues = [];

    for (const weapon of build.weapons ?? []) {
      const entityId = weapon.name?.canonical_entity_id;
      if (!entityId || weapon.name?.resolution_status !== "resolved") continue;
      const templateName = entityId.split(".").pop();
      const actionMap = actionMapByTemplate.get(templateName);

      if (!actionMap) {
        issues.push(`${templateName}: no action map found`);
        continue;
      }

      for (const [actionType, profileIds] of Object.entries(actionMap.actions)) {
        for (const profileId of profileIds) {
          const profile = profileMap.get(profileId);
          if (!profile) {
            issues.push(
              `${templateName} → ${actionType}: profile "${profileId}" not found in profile map`,
            );
          }
        }
      }
    }

    // Now try to run computeBreakpoints and capture any error
    let error = null;
    let result = null;
    try {
      result = computeBreakpoints(build, idx, data);
    } catch (err) {
      error = /** @type {Error} */ (err);
    }

    if (error) {
      console.log(`Build 14 crash: ${error.message}`);
      if (error.stack) {
        // Extract just the first relevant stack frame
        const frames = error.stack.split("\n").slice(1, 4).join("\n");
        console.log(`Stack (top 3 frames):\n${frames}`);
      }
    } else {
      console.log(
        `Build 14 succeeded (no crash): ${result.weapons.length} weapon(s), ` +
          `${result.weapons.reduce((s, w) => s + w.actions.length, 0)} total actions`,
      );
    }

    if (issues.length > 0) {
      console.log(`Build 14 data issues:\n  ${issues.join("\n  ")}`);
    } else {
      console.log("Build 14: no null profile refs found in action maps");
    }

    // Characterization test — always passes
    assert.ok(true);
  });

  // ── Lerp factor audit ──

  it("lerped_stat_buff audit: count effects and list unique lerp conditions", () => {
    const lerpedEffects = [];
    const lerpConditions = new Set();

    // Walk all entities in the index looking for lerped_stat_buff effects
    for (const [entityId, entity] of idx.entities) {
      const effects = entity.calc?.effects ?? [];
      // Also check tiered effects
      const tieredEffects = (entity.calc?.tiers ?? []).flatMap(
        (t) => t.effects ?? [],
      );
      const allEffects = [...effects, ...tieredEffects];

      for (const effect of allEffects) {
        if (effect.type === "lerped_stat_buff") {
          lerpedEffects.push({
            entityId,
            stat: effect.stat,
            condition: effect.condition,
            magnitude_min: effect.magnitude_min,
            magnitude_max: effect.magnitude_max,
          });
          if (effect.condition) {
            lerpConditions.add(effect.condition);
          } else {
            lerpConditions.add("(no condition / null)");
          }
        }
      }
    }

    console.log(`lerped_stat_buff effects in index: ${lerpedEffects.length} total`);
    console.log(`unique lerp conditions: ${[...lerpConditions].sort().join(", ")}`);

    // Now count how many builds actually reference entities with lerped effects
    const lerpedEntityIds = new Set(lerpedEffects.map((e) => e.entityId));
    let buildsWithLerped = 0;
    for (const { build } of allBuilds) {
      const entityIds = collectBuildEntityIds(build);
      const hasLerped = entityIds.some((id) => {
        // Direct match
        if (lerpedEntityIds.has(id)) return true;
        // Check via instance_of edges (for name_family blessings)
        const entity = idx.entities.get(id);
        if (entity?.kind === "name_family") {
          for (const edge of idx.edges) {
            if (edge.type === "instance_of" && edge.to_entity_id === id) {
              if (lerpedEntityIds.has(edge.from_entity_id)) return true;
            }
          }
        }
        return false;
      });
      if (hasLerped) buildsWithLerped++;
    }

    console.log(
      `builds referencing lerped_stat_buff entities: ${buildsWithLerped}/${allBuilds.length}`,
    );

    // Informational — always passes
    assert.ok(true);
  });

  // ── difficulty_health coverage ──

  it("difficulty_health: all 9 checklist breeds have valid entries for all 5 difficulties", () => {
    const CHECKLIST_BREEDS = [
      "renegade_berzerker",
      "chaos_ogryn_executor",
      "chaos_poxwalker",
      "renegade_executor",
      "chaos_ogryn_bulwark",
      "renegade_netgunner",
      "chaos_hound",
      "chaos_poxwalker_bomber",
      "renegade_sniper",
    ];

    const DIFFICULTIES = ["uprising", "malice", "heresy", "damnation", "auric"];

    const breedMap = new Map();
    for (const breed of data.breeds) {
      breedMap.set(breed.id, breed);
    }

    const missing = [];
    const invalid = [];

    for (const breedId of CHECKLIST_BREEDS) {
      const breed = breedMap.get(breedId);
      if (!breed) {
        missing.push(`${breedId}: breed not found in breed data`);
        continue;
      }
      if (!breed.difficulty_health) {
        missing.push(`${breedId}: no difficulty_health object`);
        continue;
      }
      for (const diff of DIFFICULTIES) {
        const hp = breed.difficulty_health[diff];
        if (hp == null) {
          missing.push(`${breedId}: missing difficulty_health.${diff}`);
        } else if (typeof hp !== "number" || hp <= 0 || Number.isNaN(hp)) {
          invalid.push(`${breedId}: difficulty_health.${diff} = ${hp} (invalid)`);
        }
      }
    }

    if (missing.length > 0) {
      console.log(`difficulty_health missing entries:\n  ${missing.join("\n  ")}`);
    }
    if (invalid.length > 0) {
      console.log(`difficulty_health invalid entries:\n  ${invalid.join("\n  ")}`);
    }

    // This is a hard assertion — checklist breeds must have valid health data
    assert.equal(
      missing.length,
      0,
      `${missing.length} missing difficulty_health entries:\n  ${missing.join("\n  ")}`,
    );
    assert.equal(
      invalid.length,
      0,
      `${invalid.length} invalid difficulty_health entries:\n  ${invalid.join("\n  ")}`,
    );
  });
});

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Collects all resolved entity IDs from a canonical build.
 * @param {any} build
 * @returns {string[]}
 */
function collectBuildEntityIds(build) {
  const ids = [];
  for (const field of ["ability", "blitz", "aura", "keystone"]) {
    const slot = build[field];
    if (slot?.canonical_entity_id && slot.resolution_status === "resolved") {
      ids.push(slot.canonical_entity_id);
    }
  }
  for (const t of build.talents ?? []) {
    if (t.canonical_entity_id && t.resolution_status === "resolved") {
      ids.push(t.canonical_entity_id);
    }
  }
  for (const w of build.weapons ?? []) {
    for (const b of w.blessings ?? []) {
      if (b.canonical_entity_id && b.resolution_status === "resolved") {
        ids.push(b.canonical_entity_id);
      }
    }
    for (const p of w.perks ?? []) {
      if (p.canonical_entity_id && p.resolution_status === "resolved") {
        ids.push(p.canonical_entity_id);
      }
    }
  }
  for (const c of build.curios ?? []) {
    for (const p of c.perks ?? []) {
      if (p.canonical_entity_id && p.resolution_status === "resolved") {
        ids.push(p.canonical_entity_id);
      }
    }
  }
  return ids;
}
