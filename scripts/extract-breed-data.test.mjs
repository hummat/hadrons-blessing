/**
 * Tests for the breeds:build pipeline output (breed-data.json) and
 * unit tests for Lua breed parser functions.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseHealthHelpers,
  parseBreedFile,
  parseTags,
  parseHitZoneNames,
  parseHitzoneArmorOverride,
  parseHitzoneDamageMultiplier,
  parseWeakspotTypes,
  parseStaggerData,
  parseStaggerTypeTable,
} from "./extract-breed-data.mjs";

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

  it("has required fields on every breed", () => {
    for (const breed of breeds.breeds) {
      assert.ok(typeof breed.id === "string", `breed missing id`);
      assert.ok(typeof breed.display_name === "string", `${breed.id} missing display_name`);
      assert.ok(typeof breed.faction === "string", `${breed.id} missing faction`);
      assert.ok(typeof breed.base_armor_type === "string", `${breed.id} missing base_armor_type`);
      assert.ok(typeof breed.community_armor_name === "string", `${breed.id} missing community_armor_name`);
      assert.ok(Array.isArray(breed.tags), `${breed.id} tags should be array`);
      assert.ok(typeof breed.hit_zones === "object", `${breed.id} missing hit_zones`);
    }
  });

  it("hit_zones have correct shape", () => {
    for (const breed of breeds.breeds) {
      for (const [zoneName, zone] of Object.entries(breed.hit_zones)) {
        assert.ok(typeof zone.armor_type === "string",
          `${breed.id}.${zoneName} missing armor_type`);
        assert.ok(typeof zone.weakspot === "boolean",
          `${breed.id}.${zoneName} missing weakspot`);
        assert.ok(typeof zone.damage_multiplier === "object",
          `${breed.id}.${zoneName} missing damage_multiplier`);
      }
    }
  });

  it("renegade_berzerker hitzone overrides are correct", () => {
    const rager = breeds.breeds.find(b => b.id === "renegade_berzerker");
    // torso and center_mass have super_armor override
    assert.equal(rager.hit_zones.torso.armor_type, "super_armor");
    assert.equal(rager.hit_zones.center_mass.armor_type, "super_armor");
    // head inherits base armor (armored)
    assert.equal(rager.hit_zones.head.armor_type, "armored");
    // head is a weakspot
    assert.equal(rager.hit_zones.head.weakspot, true);
    assert.equal(rager.hit_zones.torso.weakspot, false);
  });

  it("chaos_poxwalker is disgustingly_resilient / Unyielding", () => {
    const pox = breeds.breeds.find(b => b.id === "chaos_poxwalker");
    assert.ok(pox, "chaos_poxwalker not found");
    assert.equal(pox.base_armor_type, "disgustingly_resilient");
    assert.equal(pox.community_armor_name, "Unyielding");
  });

  it("has source_snapshot_id and generated_at", () => {
    assert.ok(typeof breeds.source_snapshot_id === "string");
    assert.ok(typeof breeds.generated_at === "string");
  });

  it("renegade_berzerker difficulty health matches known values", () => {
    const rager = breeds.breeds.find(b => b.id === "renegade_berzerker");
    assert.equal(rager.difficulty_health.uprising, 850);
    assert.equal(rager.difficulty_health.malice, 1000);
    assert.equal(rager.difficulty_health.heresy, 1250);
    assert.equal(rager.difficulty_health.damnation, 1875);
    assert.equal(rager.difficulty_health.auric, 2500);
  });

  it("ranged damage multipliers extracted for renegade_berzerker", () => {
    const rager = breeds.breeds.find(b => b.id === "renegade_berzerker");
    // lower limbs have 0.5 ranged multiplier
    assert.equal(rager.hit_zones.lower_left_arm.damage_multiplier.ranged, 0.5);
    assert.equal(rager.hit_zones.lower_right_leg.damage_multiplier.ranged, 0.5);
    // head has default 1.0 for both
    assert.equal(rager.hit_zones.head.damage_multiplier.ranged, 1.0);
    assert.equal(rager.hit_zones.head.damage_multiplier.melee, 1.0);
  });
});

// ── Lua parser unit tests ─────────────────────────────────────────────

const approx = (actual, expected, tol = 0.001) =>
  assert.ok(Math.abs(actual - expected) < tol, `expected ≈${expected}, got ${actual}`);

describe("parseHealthHelpers", () => {
  it("extracts multiplier arrays from helper functions", () => {
    const lua = `
local function _elite_health_steps(health)
  local health_steps = { health * 0.5, health * 0.75, health * 1, health * 1.5, health * 2 }
  return health_steps
end`;
    const helpers = parseHealthHelpers(lua);
    assert.equal(helpers.size, 1);
    assert.deepEqual(helpers.get("_elite_health_steps"), [0.5, 0.75, 1, 1.5, 2]);
  });

  it("ignores helpers with fewer than 5 multipliers", () => {
    const lua = `
local function _short_health_steps(health)
  local health_steps = { health * 0.5, health * 1 }
  return health_steps
end`;
    assert.equal(parseHealthHelpers(lua).size, 0);
  });
});

describe("parseBreedFile", () => {
  const MINIMAL_BREED = `
local breed_name = "renegade_berzerker"
local breed_data = {
\tdisplay_name = "loc_breed_display_name_renegade_berzerker",
\tsub_faction_name = "renegade",
\tarmor_type = armor_types.berserker,
\thit_zones = {
\t\t{ name = hit_zone_names.head, actors = {} },
\t\t{ name = hit_zone_names.torso, actors = {} },
\t},
\thitzone_armor_override = {
\t\t[hit_zone_names.head] = armor_types.armored,
\t},
\thitzone_damage_multiplier = {
\t\tranged = { [hit_zone_names.head] = 1.5 },
\t\tmelee = { [hit_zone_names.head] = 1.2 },
\t},
\thit_zone_weakspot_types = {
\t\t[hit_zone_names.head] = weakspot_types.headshot,
\t},
\ttags = { elite = true, melee = true },
}`;

  it("parses a complete breed file", () => {
    const breed = parseBreedFile(MINIMAL_BREED);
    assert.ok(breed);
    assert.equal(breed.id, "renegade_berzerker");
    assert.equal(breed.base_armor_type, "berserker");
    assert.equal(breed.faction, "renegade");
    assert.deepEqual(breed.tags, ["elite", "melee"]);
    assert.equal(breed.hit_zones.head.armor_type, "armored");
    assert.equal(breed.hit_zones.head.weakspot, true);
    assert.equal(breed.hit_zones.torso.armor_type, "berserker");
    assert.equal(breed.hit_zones.torso.weakspot, false);
    approx(breed.hit_zones.head.damage_multiplier.ranged, 1.5);
    approx(breed.hit_zones.head.damage_multiplier.melee, 1.2);
  });

  it("returns null when breed_name is missing", () => {
    assert.equal(parseBreedFile(`local breed_data = {}`), null);
  });

  it("returns null when armor_type is missing", () => {
    const lua = `local breed_name = "test"\nlocal breed_data = { hit_zones = { { name = hit_zone_names.head } } }`;
    assert.equal(parseBreedFile(lua), null);
  });

  it("returns null when no hit zones found", () => {
    const lua = `local breed_name = "test"\nlocal breed_data = { armor_type = armor_types.unarmored }`;
    assert.equal(parseBreedFile(lua), null);
  });

  it("detects name override in breed_data", () => {
    const lua = `local breed_name = "chaos_hound_mutator"\nlocal breed_data = {\n\tname = "chaos_hound",\n\tarmor_type = armor_types.unarmored,\n\thit_zones = { { name = hit_zone_names.torso } },\n}`;
    const breed = parseBreedFile(lua);
    assert.ok(breed);
    assert.equal(breed.id, "chaos_hound");
  });
});

describe("parseTags", () => {
  it("extracts sorted tags", () => {
    assert.deepEqual(parseTags(`tags = { elite = true, melee = true, aggressive = true }`), ["aggressive", "elite", "melee"]);
  });

  it("returns empty array when no tags", () => {
    assert.deepEqual(parseTags("nothing"), []);
  });
});

describe("parseHitZoneNames", () => {
  it("extracts unique zone names from hit_zones block", () => {
    const lua = `hit_zones = {\n  { name = hit_zone_names.head },\n  { name = hit_zone_names.torso },\n}`;
    assert.deepEqual(parseHitZoneNames(lua), ["head", "torso"]);
  });

  it("deduplicates repeated names", () => {
    const lua = `hit_zones = {\n  { name = hit_zone_names.head },\n  { name = hit_zone_names.head },\n}`;
    assert.deepEqual(parseHitZoneNames(lua), ["head"]);
  });

  it("returns empty when no block", () => {
    assert.deepEqual(parseHitZoneNames("nothing"), []);
  });
});

describe("parseHitzoneArmorOverride", () => {
  it("extracts armor overrides", () => {
    const lua = `hitzone_armor_override = {\n  [hit_zone_names.head] = armor_types.armored,\n}`;
    const m = parseHitzoneArmorOverride(lua);
    assert.equal(m.get("head"), "armored");
  });

  it("returns empty map when no overrides", () => {
    assert.equal(parseHitzoneArmorOverride("nothing").size, 0);
  });
});

describe("parseHitzoneDamageMultiplier", () => {
  it("extracts ranged and melee multipliers", () => {
    const lua = `hitzone_damage_multiplier = {\n  ranged = { [hit_zone_names.head] = 2.0 },\n  melee = { [hit_zone_names.head] = 1.5 },\n}`;
    const result = parseHitzoneDamageMultiplier(lua);
    assert.equal(result.ranged.get("head"), 2.0);
    assert.equal(result.melee.get("head"), 1.5);
  });

  it("returns empty maps when no block", () => {
    const result = parseHitzoneDamageMultiplier("nothing");
    assert.equal(result.ranged.size, 0);
  });
});

describe("parseWeakspotTypes", () => {
  it("extracts weakspot zones", () => {
    const lua = `hit_zone_weakspot_types = {\n  [hit_zone_names.head] = weakspot_types.headshot,\n}`;
    const ws = parseWeakspotTypes(lua);
    assert.ok(ws.has("head"));
    assert.equal(ws.size, 1);
  });

  it("returns empty set when no block", () => {
    assert.equal(parseWeakspotTypes("nothing").size, 0);
  });
});

// ── Stagger data parser tests ────────────────────────────────────────

describe("parseStaggerData", () => {
  it("extracts stagger_resistance scalar", () => {
    const lua = `\tstagger_resistance = 0.75,\n\tstagger_thresholds = {\n\t\t[stagger_types.light] = 1,\n\t}`;
    const data = parseStaggerData(lua);
    assert.equal(data.stagger_resistance, 0.75);
  });

  it("defaults stagger_resistance to 1 when absent", () => {
    const lua = `nothing relevant`;
    const data = parseStaggerData(lua);
    assert.equal(data.stagger_resistance, 1);
  });

  it("extracts stagger_reduction and stagger_reduction_ranged", () => {
    const lua = `\tstagger_reduction = 5,\n\tstagger_reduction_ranged = 15,\n\tstagger_resistance = 1,`;
    const data = parseStaggerData(lua);
    assert.equal(data.stagger_reduction, 5);
    assert.equal(data.stagger_reduction_ranged, 15);
  });

  it("omits stagger_reduction when absent", () => {
    const lua = `\tstagger_resistance = 1,`;
    const data = parseStaggerData(lua);
    assert.equal(data.stagger_reduction, undefined);
    assert.equal(data.stagger_reduction_ranged, undefined);
  });

  it("extracts ignore_stagger_accumulation", () => {
    const lua = `\tignore_stagger_accumulation = true,\n\tstagger_resistance = 1,`;
    const data = parseStaggerData(lua);
    assert.equal(data.ignore_stagger_accumulation, true);
  });

  it("omits ignore_stagger_accumulation when absent", () => {
    const lua = `\tstagger_resistance = 1,`;
    const data = parseStaggerData(lua);
    assert.equal(data.ignore_stagger_accumulation, undefined);
  });

  it("extracts stagger_thresholds table", () => {
    const lua = `\tstagger_thresholds = {\n\t\t[stagger_types.light] = 1,\n\t\t[stagger_types.medium] = 10,\n\t\t[stagger_types.heavy] = 20,\n\t\t[stagger_types.explosion] = 40,\n\t}`;
    const data = parseStaggerData(lua);
    assert.deepEqual(data.stagger_thresholds, {
      light: 1,
      medium: 10,
      heavy: 20,
      explosion: 40,
    });
  });

  it("handles negative thresholds (immune)", () => {
    const lua = `\tstagger_thresholds = {\n\t\t[stagger_types.light] = -1,\n\t\t[stagger_types.medium] = -1,\n\t\t[stagger_types.heavy] = -1,\n\t\t[stagger_types.explosion] = 200,\n\t}`;
    const data = parseStaggerData(lua);
    assert.equal(data.stagger_thresholds.light, -1);
    assert.equal(data.stagger_thresholds.explosion, 200);
  });

  it("extracts stagger_durations and stagger_immune_times", () => {
    const lua = `\tstagger_durations = {\n\t\t[stagger_types.light] = 0.5,\n\t\t[stagger_types.medium] = 0.8,\n\t}\n\tstagger_immune_times = {\n\t\t[stagger_types.light] = 0.2,\n\t\t[stagger_types.medium] = 0.2,\n\t}`;
    const data = parseStaggerData(lua);
    assert.deepEqual(data.stagger_durations, { light: 0.5, medium: 0.8 });
    assert.deepEqual(data.stagger_immune_times, { light: 0.2, medium: 0.2 });
  });
});

describe("parseStaggerTypeTable", () => {
  it("returns null when table is not found", () => {
    assert.equal(parseStaggerTypeTable("nothing", "stagger_thresholds"), null);
  });

  it("ignores unknown stagger type names", () => {
    const lua = `stagger_thresholds = {\n\t[stagger_types.bogus_type] = 99,\n\t[stagger_types.light] = 1,\n}`;
    const result = parseStaggerTypeTable(lua, "stagger_thresholds");
    assert.deepEqual(result, { light: 1 });
  });

  it("handles floating point values", () => {
    const lua = `stagger_durations = {\n\t[stagger_types.sticky] = 1.6666666666666667,\n}`;
    const result = parseStaggerTypeTable(lua, "stagger_durations");
    approx(result.sticky, 1.6666666666666667);
  });
});

// ── Stagger data in generated breed-data.json ────────────────────────

describe("stagger data in breed-data.json", { skip: !HAS_SOURCE && "requires GROUND_TRUTH_SOURCE_ROOT" }, () => {
  let breeds;
  it("loads breed data", () => {
    breeds = JSON.parse(readFileSync(join(GENERATED_DIR, "breed-data.json"), "utf-8"));
    assert.ok(breeds.breeds.length >= 25);
  });

  it("every breed has stagger.stagger_resistance", () => {
    for (const breed of breeds.breeds) {
      assert.ok(typeof breed.stagger === "object",
        `${breed.id} missing stagger object`);
      assert.ok(typeof breed.stagger.stagger_resistance === "number",
        `${breed.id} missing stagger_resistance`);
    }
  });

  it("chaos_poxwalker has correct stagger values", () => {
    const pox = breeds.breeds.find(b => b.id === "chaos_poxwalker");
    assert.equal(pox.stagger.stagger_resistance, 0.75);
    assert.equal(pox.stagger.stagger_thresholds.light, 1);
    assert.equal(pox.stagger.stagger_thresholds.medium, 10);
    assert.equal(pox.stagger.stagger_thresholds.heavy, 20);
    assert.equal(pox.stagger.stagger_thresholds.light_ranged, 8);
    assert.equal(pox.stagger.stagger_durations.light, 0.5);
  });

  it("chaos_plague_ogryn has ignore_stagger_accumulation and stagger_reduction", () => {
    const po = breeds.breeds.find(b => b.id === "chaos_plague_ogryn");
    assert.equal(po.stagger.ignore_stagger_accumulation, true);
    assert.equal(po.stagger.stagger_reduction, 50);
    assert.equal(po.stagger.stagger_thresholds.explosion, 200);
    assert.equal(po.stagger.stagger_thresholds.light, -1);
  });

  it("renegade_melee has standard stagger thresholds", () => {
    const rm = breeds.breeds.find(b => b.id === "renegade_melee");
    assert.equal(rm.stagger.stagger_resistance, 1);
    assert.equal(rm.stagger.stagger_thresholds.medium, 12);
    assert.equal(rm.stagger.stagger_thresholds.heavy, 30);
  });

  it("cultist_mutant has very high stagger_resistance", () => {
    const cm = breeds.breeds.find(b => b.id === "cultist_mutant");
    assert.equal(cm.stagger.stagger_resistance, 2000);
  });

  it("breeds with stagger_reduction_ranged have it set", () => {
    const shocktrooper = breeds.breeds.find(b => b.id === "renegade_shocktrooper");
    assert.ok(shocktrooper.stagger.stagger_reduction_ranged >= 0,
      "renegade_shocktrooper should have stagger_reduction_ranged");
  });
});

// ── stagger-settings.json tests ──────────────────────────────────────

describe("stagger-settings.json", { skip: !HAS_SOURCE && "requires GROUND_TRUTH_SOURCE_ROOT" }, () => {
  let settings;
  it("loads stagger-settings.json", () => {
    settings = JSON.parse(readFileSync(join(GENERATED_DIR, "stagger-settings.json"), "utf-8"));
    assert.ok(settings);
  });

  it("has 14 stagger types", () => {
    assert.equal(settings.stagger_types.length, 14);
    assert.ok(settings.stagger_types.includes("light"));
    assert.ok(settings.stagger_types.includes("explosion"));
    assert.ok(settings.stagger_types.includes("companion_push"));
  });

  it("has correct default thresholds", () => {
    assert.equal(settings.default_stagger_thresholds.light, 1);
    assert.equal(settings.default_stagger_thresholds.medium, 10);
    assert.equal(settings.default_stagger_thresholds.heavy, 20);
    assert.equal(settings.default_stagger_thresholds.explosion, 40);
    assert.equal(settings.default_stagger_thresholds.light_ranged, 5);
    assert.equal(settings.default_stagger_thresholds.killshot, 2);
  });

  it("has stagger categories with correct entries", () => {
    assert.deepEqual(settings.stagger_categories.melee, ["light", "medium", "heavy"]);
    assert.deepEqual(settings.stagger_categories.ranged, ["light_ranged", "medium", "heavy"]);
    assert.deepEqual(settings.stagger_categories.killshot, ["killshot", "medium", "heavy"]);
  });

  it("has scalar constants", () => {
    assert.equal(settings.default_stagger_resistance, 1);
    assert.equal(settings.max_excessive_force, 5);
    assert.equal(settings.default_stagger_count_multiplier, 1.5);
    assert.equal(settings.stagger_pool_decay_time, 1);
    assert.equal(settings.stagger_pool_decay_delay, 0.2);
    assert.equal(settings.rending_stagger_strength_modifier, 2);
  });

  it("has duration and length scale arrays", () => {
    assert.deepEqual(settings.stagger_duration_scale, [0.75, 1.25]);
    assert.deepEqual(settings.stagger_length_scale, [0.8, 1.2]);
  });

  it("has impact comparison values", () => {
    assert.equal(settings.stagger_impact_comparison.explosion, 4);
    assert.equal(settings.stagger_impact_comparison.heavy, 3);
    assert.equal(settings.stagger_impact_comparison.medium, 2);
    assert.equal(settings.stagger_impact_comparison.light, 1);
  });

  it("has source_snapshot_id", () => {
    assert.ok(typeof settings.source_snapshot_id === "string");
  });
});
