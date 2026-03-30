// @ts-nocheck
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  matchByKnownAliases,
  buildSlugToFamilyMap,
  matchSingletonFamilies,
  deduceLastRemaining,
} from "../cli/generate-weapon-name-mapping.js";

describe("matchByKnownAliases", () => {
  it("creates mapping entries from existing weapon aliases", () => {
    const aliases = [
      { text: "Agripinaa Mk VIII Braced Autogun", candidate_entity_id: "shared.weapon.autogun_p2_m1" },
    ];
    const glWeapons = [
      { display_name: "Agripinaa Mk VIII Braced Autogun", url_slug: "braced-autogun" },
    ];
    const result = matchByKnownAliases(aliases, glWeapons);
    assert.equal(result.length, 1);
    assert.equal(result[0].gl_name, "Agripinaa Mk VIII Braced Autogun");
    assert.equal(result[0].template_id, "autogun_p2_m1");
    assert.equal(result[0].source, "existing_alias");
  });

  it("skips aliases not found in GL catalog", () => {
    const aliases = [
      { text: "Some Deleted Weapon", candidate_entity_id: "shared.weapon.deleted_p1_m1" },
    ];
    const result = matchByKnownAliases(aliases, []);
    assert.equal(result.length, 0);
  });

  it("skips non-weapon aliases", () => {
    const aliases = [
      { text: "Block Efficiency", candidate_entity_id: "shared.gadget_trait.block_cost" },
    ];
    const glWeapons = [
      { display_name: "Block Efficiency", url_slug: "some-slug" },
    ];
    const result = matchByKnownAliases(aliases, glWeapons);
    assert.equal(result.length, 0);
  });

  it("deduplicates when multiple aliases match the same GL weapon", () => {
    const aliases = [
      { text: "Branx Mk VIII Dual Stub Pistols", candidate_entity_id: "shared.weapon.dual_stubpistols_p1_m1" },
      { text: "Branx MkVIII Dual Stub Pistols", candidate_entity_id: "shared.weapon.dual_stubpistols_p1_m1" },
    ];
    const glWeapons = [
      { display_name: "Branx MkVIII Dual Stub Pistols", url_slug: "dual-stub-pistols" },
    ];
    const result = matchByKnownAliases(aliases, glWeapons);
    assert.equal(result.length, 1);
    assert.equal(result[0].template_id, "dual_stubpistols_p1_m1");
  });
});

describe("buildSlugToFamilyMap", () => {
  it("maps GL URL slug to internal family using known mappings", () => {
    const knownMap = [
      { gl_name: "Agripinaa Mk VIII Braced Autogun", template_id: "autogun_p2_m1" },
    ];
    const glWeapons = [
      { display_name: "Agripinaa Mk VIII Braced Autogun", url_slug: "braced-autogun" },
    ];
    const familyMarks = { autogun_p2: ["autogun_p2_m1", "autogun_p2_m2", "autogun_p2_m3"] };
    const result = buildSlugToFamilyMap(knownMap, glWeapons, familyMarks);
    assert.equal(result.get("braced-autogun"), "autogun_p2");
  });

  it("does not overwrite existing slug mapping with a different family", () => {
    const knownMap = [
      { gl_name: "Weapon A", template_id: "autogun_p2_m1" },
      { gl_name: "Weapon B", template_id: "autogun_p2_m2" },
    ];
    const glWeapons = [
      { display_name: "Weapon A", url_slug: "braced-autogun" },
      { display_name: "Weapon B", url_slug: "braced-autogun" },
    ];
    const familyMarks = { autogun_p2: ["autogun_p2_m1", "autogun_p2_m2"] };
    const result = buildSlugToFamilyMap(knownMap, glWeapons, familyMarks);
    assert.equal(result.get("braced-autogun"), "autogun_p2");
  });

  it("handles template_id belonging to no family gracefully", () => {
    const knownMap = [
      { gl_name: "Unknown Weapon", template_id: "unknown_p1_m1" },
    ];
    const glWeapons = [
      { display_name: "Unknown Weapon", url_slug: "unknown-weapon" },
    ];
    const familyMarks = {};
    const result = buildSlugToFamilyMap(knownMap, glWeapons, familyMarks);
    assert.equal(result.has("unknown-weapon"), false);
  });
});

describe("matchSingletonFamilies", () => {
  it("maps GL weapons in singleton families automatically", () => {
    const slugToFamily = new Map([["plasma-gun", "plasmagun"]]);
    const familyMarks = { plasmagun: ["plasmagun_p1_m1"] };
    const glWeapons = [
      { display_name: "M35 Magnacore Mk II Plasma Gun", url_slug: "plasma-gun" },
    ];
    const existing = new Map();
    const result = matchSingletonFamilies(slugToFamily, familyMarks, glWeapons, existing);
    assert.equal(result.length, 1);
    assert.equal(result[0].gl_name, "M35 Magnacore Mk II Plasma Gun");
    assert.equal(result[0].template_id, "plasmagun_p1_m1");
    assert.equal(result[0].source, "singleton_family");
  });

  it("skips families with more than 1 mark", () => {
    const slugToFamily = new Map([["braced-autogun", "autogun_p2"]]);
    const familyMarks = { autogun_p2: ["autogun_p2_m1", "autogun_p2_m2"] };
    const glWeapons = [
      { display_name: "A", url_slug: "braced-autogun" },
      { display_name: "B", url_slug: "braced-autogun" },
    ];
    const existing = new Map();
    const result = matchSingletonFamilies(slugToFamily, familyMarks, glWeapons, existing);
    assert.equal(result.length, 0);
  });

  it("skips already-mapped marks", () => {
    const slugToFamily = new Map([["plasma-gun", "plasmagun"]]);
    const familyMarks = { plasmagun: ["plasmagun_p1_m1"] };
    const glWeapons = [
      { display_name: "M35 Magnacore Mk II Plasma Gun", url_slug: "plasma-gun" },
    ];
    const existing = new Map([["plasmagun_p1_m1", "M35 Magnacore Mk II Plasma Gun"]]);
    const result = matchSingletonFamilies(slugToFamily, familyMarks, glWeapons, existing);
    assert.equal(result.length, 0);
  });

  it("skips when GL weapon count doesn't match singleton", () => {
    const slugToFamily = new Map([["plasma-gun", "plasmagun"]]);
    const familyMarks = { plasmagun: ["plasmagun_p1_m1"] };
    const glWeapons = [
      { display_name: "Gun A", url_slug: "plasma-gun" },
      { display_name: "Gun B", url_slug: "plasma-gun" },
    ];
    const existing = new Map();
    const result = matchSingletonFamilies(slugToFamily, familyMarks, glWeapons, existing);
    assert.equal(result.length, 0);
  });
});

describe("deduceLastRemaining", () => {
  it("auto-matches when one mark and one GL weapon remain in a family", () => {
    const slugToFamily = new Map([["braced-autogun", "autogun_p2"]]);
    const familyMarks = { autogun_p2: ["autogun_p2_m1", "autogun_p2_m2"] };
    const glWeapons = [
      { display_name: "Agripinaa Mk VIII Braced Autogun", url_slug: "braced-autogun" },
      { display_name: "Graia Mk IV Braced Autogun", url_slug: "braced-autogun" },
    ];
    const alreadyMapped = new Map([["autogun_p2_m1", "Agripinaa Mk VIII Braced Autogun"]]);
    const result = deduceLastRemaining(slugToFamily, familyMarks, glWeapons, alreadyMapped);
    assert.equal(result.length, 1);
    assert.equal(result[0].gl_name, "Graia Mk IV Braced Autogun");
    assert.equal(result[0].template_id, "autogun_p2_m2");
    assert.equal(result[0].source, "last_remaining");
  });

  it("does not match when more than one remain", () => {
    const slugToFamily = new Map([["braced-autogun", "autogun_p2"]]);
    const familyMarks = { autogun_p2: ["autogun_p2_m1", "autogun_p2_m2", "autogun_p2_m3"] };
    const glWeapons = [
      { display_name: "A", url_slug: "braced-autogun" },
      { display_name: "B", url_slug: "braced-autogun" },
      { display_name: "C", url_slug: "braced-autogun" },
    ];
    const alreadyMapped = new Map([["autogun_p2_m1", "A"]]);
    const result = deduceLastRemaining(slugToFamily, familyMarks, glWeapons, alreadyMapped);
    assert.equal(result.length, 0);
  });

  it("does not match when zero marks remain", () => {
    const slugToFamily = new Map([["braced-autogun", "autogun_p2"]]);
    const familyMarks = { autogun_p2: ["autogun_p2_m1"] };
    const glWeapons = [
      { display_name: "Agripinaa Mk VIII Braced Autogun", url_slug: "braced-autogun" },
    ];
    const alreadyMapped = new Map([["autogun_p2_m1", "Agripinaa Mk VIII Braced Autogun"]]);
    const result = deduceLastRemaining(slugToFamily, familyMarks, glWeapons, alreadyMapped);
    assert.equal(result.length, 0);
  });

  it("handles multiple families correctly in a single pass", () => {
    const slugToFamily = new Map([
      ["braced-autogun", "autogun_p2"],
      ["plasma-gun", "plasmagun"],
    ]);
    const familyMarks = {
      autogun_p2: ["autogun_p2_m1", "autogun_p2_m2"],
      plasmagun: ["plasmagun_p1_m1"],
    };
    const glWeapons = [
      { display_name: "A", url_slug: "braced-autogun" },
      { display_name: "B", url_slug: "braced-autogun" },
      { display_name: "Plasma", url_slug: "plasma-gun" },
    ];
    const alreadyMapped = new Map([
      ["autogun_p2_m1", "A"],
      ["plasmagun_p1_m1", "Plasma"],
    ]);
    const result = deduceLastRemaining(slugToFamily, familyMarks, glWeapons, alreadyMapped);
    // Only braced-autogun has 1 remaining, plasma already fully mapped
    assert.equal(result.length, 1);
    assert.equal(result[0].template_id, "autogun_p2_m2");
  });
});
