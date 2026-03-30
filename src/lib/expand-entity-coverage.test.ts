// @ts-nocheck
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  parseWeaponFilename,
  parseBespokeFilename,
  extractConceptSuffix,
  detectSlot,
  weaponEntityId,
  traitEntityId,
  perkEntityId,
  gadgetTraitEntityId,
  nameFamilyEntityId,
  makeWeaponEntity,
  makeTraitEntity,
  makePerkEntity,
  makeGadgetTraitEntity,
  makeNameFamilyEntity,
  makeInstanceOfEdge,
  makeWeaponHasTraitPoolEdge,
  buildConceptFamilyMap,
  scanWeaponMarks,
  scanBespokeTraits,
  scanPerks,
  scanGadgetTraits,
} from "../cli/expand-entity-coverage.js";

// --- Task 1: Filename parsing helpers ---

describe("parseWeaponFilename", () => {
  it("parses a standard weapon filename", () => {
    const result = parseWeaponFilename("autogun_p1_m1.lua");
    assert.deepEqual(result, { family: "autogun", pSeries: "p1", mark: "m1", internalName: "autogun_p1_m1" });
  });

  it("parses a 2h family weapon filename", () => {
    const result = parseWeaponFilename("chainsword_2h_p1_m1.lua");
    assert.deepEqual(result, { family: "chainsword_2h", pSeries: "p1", mark: "m1", internalName: "chainsword_2h_p1_m1" });
  });

  it("parses an ogryn compound weapon filename", () => {
    const result = parseWeaponFilename("ogryn_gauntlet_power_p1_m1.lua");
    assert.deepEqual(result, { family: "ogryn_gauntlet_power", pSeries: "p1", mark: "m1", internalName: "ogryn_gauntlet_power_p1_m1" });
  });

  it("returns null for non-mark files", () => {
    assert.equal(parseWeaponFilename("autogun_traits.lua"), null);
  });
});

describe("parseBespokeFilename", () => {
  it("parses a standard bespoke filename", () => {
    const result = parseBespokeFilename("weapon_traits_bespoke_autogun_p1.lua");
    assert.deepEqual(result, { family: "autogun", pSeries: "p1" });
  });

  it("parses a 2h bespoke filename", () => {
    const result = parseBespokeFilename("weapon_traits_bespoke_chainsword_2h_p1.lua");
    assert.deepEqual(result, { family: "chainsword_2h", pSeries: "p1" });
  });

  it("parses an ogryn compound bespoke filename", () => {
    const result = parseBespokeFilename("weapon_traits_bespoke_ogryn_gauntlet_power_p1.lua");
    assert.deepEqual(result, { family: "ogryn_gauntlet_power", pSeries: "p1" });
  });
});

describe("extractConceptSuffix", () => {
  it("strips the bespoke prefix", () => {
    const result = extractConceptSuffix("weapon_trait_bespoke_autogun_p1_slaughterer", "autogun", "p1");
    assert.equal(result, "slaughterer");
  });

  it("strips the _parent suffix", () => {
    const result = extractConceptSuffix("weapon_trait_bespoke_autogun_p1_slaughterer_parent", "autogun", "p1");
    assert.equal(result, "slaughterer");
  });

  it("handles ogryn compound family", () => {
    const result = extractConceptSuffix("weapon_trait_bespoke_ogryn_gauntlet_power_p1_decimator", "ogryn_gauntlet_power", "p1");
    assert.equal(result, "decimator");
  });
});

// --- Task 2: Slot detection + entity ID builders ---

describe("detectSlot", () => {
  it("detects melee from keywords", () => {
    assert.equal(detectSlot('keywords = { "melee", "one_handed" }'), "melee");
  });

  it("detects ranged from keywords", () => {
    assert.equal(detectSlot('keywords = { "ranged", "autogun" }'), "ranged");
  });

  it("detects ranged from ammo_template fallback", () => {
    assert.equal(detectSlot('ammo_template = "autogun_p1_m1"'), "ranged");
  });

  it("detects melee from no_ammo fallback", () => {
    assert.equal(detectSlot('ammo_template = "no_ammo"'), "melee");
  });

  it("detects ranged from multi-line keywords block", () => {
    const lua = `weapon_template.keywords = {\n  "ranged",\n  "autogun",\n}`;
    assert.equal(detectSlot(lua), "ranged");
  });

  it("defaults to melee when no signals", () => {
    assert.equal(detectSlot("-- no weapon signals here"), "melee");
  });
});

describe("weaponEntityId", () => {
  it("builds the correct ID", () => {
    assert.equal(weaponEntityId("autogun_p1_m1"), "shared.weapon.autogun_p1_m1");
  });
});

describe("traitEntityId", () => {
  it("builds the correct ID", () => {
    assert.equal(traitEntityId("weapon_trait_bespoke_autogun_p1_slaughterer"), "shared.weapon_trait.weapon_trait_bespoke_autogun_p1_slaughterer");
  });
});

describe("perkEntityId", () => {
  it("builds the correct ID with slot", () => {
    assert.equal(perkEntityId("autogun_p1_base_stats", "ranged"), "shared.weapon_perk.ranged.autogun_p1_base_stats");
  });
});

describe("gadgetTraitEntityId", () => {
  it("builds the correct ID", () => {
    assert.equal(gadgetTraitEntityId("gadget_innate_max_wounds_increase"), "shared.gadget_trait.gadget_innate_max_wounds_increase");
  });
});

describe("nameFamilyEntityId", () => {
  it("builds the correct ID", () => {
    assert.equal(nameFamilyEntityId("slaughterer"), "shared.name_family.blessing.slaughterer");
  });
});

// --- Task 3: Entity record factories ---

describe("makeWeaponEntity", () => {
  it("produces correct id, kind, attributes, refs, status, calc", () => {
    const e = makeWeaponEntity("autogun_p1_m1", "autogun", "p1", "ranged", "scripts/settings/equipment/weapons/autogun_p1_m1.lua", "snap-abc");
    assert.equal(e.id, "shared.weapon.autogun_p1_m1");
    assert.equal(e.kind, "weapon");
    assert.equal(e.status, "source_backed");
    assert.deepEqual(e.attributes, { weapon_family: "autogun_p1", slot: "ranged" });
    assert.deepEqual(e.refs, [{ path: "scripts/settings/equipment/weapons/autogun_p1_m1.lua", line: 1 }]);
    assert.deepEqual(e.calc, {});
  });
});

describe("makeTraitEntity", () => {
  it("produces correct id, kind, attributes, refs, status, calc", () => {
    const e = makeTraitEntity("weapon_trait_bespoke_autogun_p1_slaughterer", "autogun", "p1", "ranged", "scripts/settings/equipment/weapon_traits/bespoke/autogun_p1.lua", 42, "snap-abc");
    assert.equal(e.id, "shared.weapon_trait.weapon_trait_bespoke_autogun_p1_slaughterer");
    assert.equal(e.kind, "weapon_trait");
    assert.equal(e.status, "source_backed");
    assert.deepEqual(e.attributes, { weapon_family: "autogun_p1", slot: "ranged" });
    assert.deepEqual(e.refs, [{ path: "scripts/settings/equipment/weapon_traits/bespoke/autogun_p1.lua", line: 42 }]);
    assert.deepEqual(e.calc, {});
  });
});

describe("makePerkEntity", () => {
  it("produces correct id, kind, attributes, refs, status, calc", () => {
    const e = makePerkEntity("autogun_p1_base_stats", "ranged", "scripts/settings/equipment/weapon_perks/autogun_p1.lua", 10, "snap-abc");
    assert.equal(e.id, "shared.weapon_perk.ranged.autogun_p1_base_stats");
    assert.equal(e.kind, "weapon_perk");
    assert.equal(e.status, "source_backed");
    assert.deepEqual(e.attributes, { slot: "ranged" });
    assert.deepEqual(e.refs, [{ path: "scripts/settings/equipment/weapon_perks/autogun_p1.lua", line: 10 }]);
    assert.deepEqual(e.calc, {});
  });
});

describe("makeGadgetTraitEntity", () => {
  it("produces correct id, kind, attributes, refs, status, calc", () => {
    const e = makeGadgetTraitEntity("gadget_innate_max_wounds_increase", "scripts/settings/equipment/gadget_traits/gadget_traits_common.lua", 110, "snap-abc");
    assert.equal(e.id, "shared.gadget_trait.gadget_innate_max_wounds_increase");
    assert.equal(e.kind, "gadget_trait");
    assert.equal(e.status, "source_backed");
    assert.deepEqual(e.attributes, { slot: "curio" });
    assert.deepEqual(e.refs, [{ path: "scripts/settings/equipment/gadget_traits/gadget_traits_common.lua", line: 110 }]);
    assert.deepEqual(e.calc, {});
  });
});

describe("makeNameFamilyEntity", () => {
  it("produces correct id, kind, attributes, refs, status, calc", () => {
    const e = makeNameFamilyEntity("slaughterer", "scripts/settings/equipment/weapon_traits/bespoke/autogun_p1.lua", 5, "snap-abc");
    assert.equal(e.id, "shared.name_family.blessing.slaughterer");
    assert.equal(e.kind, "name_family");
    assert.equal(e.status, "partially_resolved");
    assert.equal(e.internal_name, null);
    assert.deepEqual(e.attributes, { family_type: "blessing" });
    assert.deepEqual(e.refs, [{ path: "scripts/settings/equipment/weapon_traits/bespoke/autogun_p1.lua", line: 5 }]);
    assert.deepEqual(e.calc, {});
  });
});

// --- Task 4: Edge record factories ---

describe("makeInstanceOfEdge", () => {
  it("produces correct edge shape, IDs, conditions fields", () => {
    const edge = makeInstanceOfEdge(
      "shared.weapon_trait.weapon_trait_bespoke_autogun_p1_slaughterer",
      "shared.name_family.blessing.slaughterer",
      "weapon_trait_bespoke_autogun_p1_slaughterer",
      "snap-abc",
    );
    assert.equal(edge.id, "shared.edge.instance_of.weapon_trait_bespoke_autogun_p1_slaughterer");
    assert.equal(edge.type, "instance_of");
    assert.equal(edge.from_entity_id, "shared.weapon_trait.weapon_trait_bespoke_autogun_p1_slaughterer");
    assert.equal(edge.to_entity_id, "shared.name_family.blessing.slaughterer");
    assert.equal(edge.source_snapshot_id, "snap-abc");
    assert.deepEqual(edge.conditions, { predicates: [], aggregation: "additive", stacking_mode: "binary", exclusive_scope: null });
    assert.deepEqual(edge.calc, {});
    assert.deepEqual(edge.evidence_ids, []);
  });
});

describe("makeWeaponHasTraitPoolEdge", () => {
  it("produces correct edge shape, IDs, conditions fields", () => {
    const edge = makeWeaponHasTraitPoolEdge(
      "shared.weapon.autogun_p1_m1",
      "shared.weapon_trait.weapon_trait_bespoke_autogun_p1_slaughterer",
      "autogun_p1_m1",
      "weapon_trait_bespoke_autogun_p1_slaughterer",
      "snap-abc",
    );
    assert.equal(edge.id, "shared.edge.weapon_has_trait_pool.autogun_p1_m1.weapon_trait_bespoke_autogun_p1_slaughterer");
    assert.equal(edge.type, "weapon_has_trait_pool");
    assert.equal(edge.from_entity_id, "shared.weapon.autogun_p1_m1");
    assert.equal(edge.to_entity_id, "shared.weapon_trait.weapon_trait_bespoke_autogun_p1_slaughterer");
    assert.equal(edge.source_snapshot_id, "snap-abc");
    assert.deepEqual(edge.conditions, { predicates: [], aggregation: "additive", stacking_mode: "binary", exclusive_scope: null });
    assert.deepEqual(edge.calc, {});
    assert.deepEqual(edge.evidence_ids, []);
  });
});

// --- Task 5: Concept-suffix map builder ---

describe("buildConceptFamilyMap", () => {
  const entities = [
    {
      id: "shared.weapon_trait.weapon_trait_bespoke_autogun_p1_slaughterer",
      kind: "weapon_trait",
      internal_name: "weapon_trait_bespoke_autogun_p1_slaughterer",
    },
    {
      id: "shared.weapon_trait.weapon_trait_bespoke_autogun_p1_slaughterer_parent",
      kind: "weapon_trait",
      internal_name: "weapon_trait_bespoke_autogun_p1_slaughterer_parent",
    },
    {
      id: "shared.weapon_trait.weapon_trait_bespoke_chainsword_2h_p1_bloodthirsty",
      kind: "weapon_trait",
      internal_name: "weapon_trait_bespoke_chainsword_2h_p1_bloodthirsty",
    },
  ];

  const entityMap = new Map(entities.map((e) => [e.id, e]));

  const edges = [
    {
      type: "instance_of",
      from_entity_id: "shared.weapon_trait.weapon_trait_bespoke_autogun_p1_slaughterer",
      to_entity_id: "shared.name_family.blessing.slaughterer",
    },
    {
      type: "instance_of",
      from_entity_id: "shared.weapon_trait.weapon_trait_bespoke_autogun_p1_slaughterer_parent",
      to_entity_id: "shared.name_family.blessing.slaughterer",
    },
    {
      type: "instance_of",
      from_entity_id: "shared.weapon_trait.weapon_trait_bespoke_chainsword_2h_p1_bloodthirsty",
      to_entity_id: "shared.name_family.blessing.bloodthirsty",
    },
    {
      type: "weapon_has_trait_pool",
      from_entity_id: "shared.weapon.autogun_p1_m1",
      to_entity_id: "shared.weapon_trait.weapon_trait_bespoke_autogun_p1_slaughterer",
    },
  ];

  it("maps concept suffix to family slug", () => {
    const map = buildConceptFamilyMap(edges, entityMap);
    assert.equal(map.get("slaughterer"), "slaughterer");
    assert.equal(map.get("bloodthirsty"), "bloodthirsty");
  });

  it("ignores non-instance_of edges", () => {
    const map = buildConceptFamilyMap(edges, entityMap);
    // weapon_has_trait_pool edge should not add entries
    // The weapon entity isn't in entityMap so it wouldn't match anyway,
    // but we also verify only instance_of edges are processed
    assert.equal(map.has("autogun_p1_m1"), false);
  });

  it("parent suffix is stripped before mapping", () => {
    const map = buildConceptFamilyMap(edges, entityMap);
    // Both the parent and non-parent variants map to the same slug
    assert.equal(map.get("slaughterer"), "slaughterer");
    // There should not be a "slaughterer_parent" key
    assert.equal(map.has("slaughterer_parent"), false);
  });
});

// --- Task 6: Source scanners (source-gated) ---

const sourceRoot = (() => {
  try { return readFileSync(".source-root", "utf8").trim(); }
  catch { return null; }
})();
const skipNoSource = { skip: !sourceRoot };

describe("scanWeaponMarks (source-gated)", skipNoSource, () => {
  it("discovers all weapon marks from Lua source", () => {
    const results = scanWeaponMarks(sourceRoot);
    assert.ok(results.length >= 100, `Expected >=100 marks, got ${results.length}`);
    const first = results[0];
    assert.ok(first.internalName);
    assert.ok(first.family);
    assert.ok(first.pSeries);
    assert.ok(first.slot === "melee" || first.slot === "ranged");
    assert.ok(first.refPath);
  });
});

describe("scanBespokeTraits (source-gated)", skipNoSource, () => {
  it("discovers all bespoke trait definitions", () => {
    const marks = scanWeaponMarks(sourceRoot);
    const results = scanBespokeTraits(sourceRoot, marks);
    assert.ok(results.length >= 400, `Expected >=400 traits, got ${results.length}`);
    const first = results[0];
    assert.ok(first.internalName);
    assert.ok(first.family);
    assert.ok(first.pSeries);
    assert.ok(first.refPath);
    assert.ok(typeof first.refLine === "number");
  });
});

describe("scanPerks (source-gated)", skipNoSource, () => {
  it("discovers all weapon perks", () => {
    const results = scanPerks(sourceRoot);
    assert.ok(results.length >= 30, `Expected >=30 perks, got ${results.length}`);
    const first = results[0];
    assert.ok(first.internalName);
    assert.ok(first.slot === "melee" || first.slot === "ranged");
  });
});

describe("scanGadgetTraits (source-gated)", skipNoSource, () => {
  it("discovers all gadget traits", () => {
    const results = scanGadgetTraits(sourceRoot);
    assert.ok(results.length >= 20, `Expected >=20 gadget traits, got ${results.length}`);
    const first = results[0];
    assert.ok(first.internalName);
    assert.ok(first.refPath);
  });
});
