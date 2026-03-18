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
