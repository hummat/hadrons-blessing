/**
 * Tests for the breeds:build pipeline output (breed-data.json).
 */
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
