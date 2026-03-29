import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { fixMalformedSlugs } from "./fix-malformed-slugs.mjs";

describe("fixMalformedSlugs", () => {
  it("renames bespoke_bespoke_ to bespoke_ in entity id and internal_name", () => {
    const entities = [
      {
        id: "shared.weapon_trait.weapon_trait_bespoke_bespoke_powersword_p1_foo",
        kind: "weapon_trait",
        internal_name: "weapon_trait_bespoke_bespoke_powersword_p1_foo",
      },
    ];
    const { entitiesFixed } = fixMalformedSlugs(entities, []);
    assert.equal(entitiesFixed, 1);
    assert.equal(entities[0].id, "shared.weapon_trait.weapon_trait_bespoke_powersword_p1_foo");
    assert.equal(entities[0].internal_name, "weapon_trait_bespoke_powersword_p1_foo");
  });

  it("renames bespoke_bespoke_ in edge id, from_entity_id, to_entity_id", () => {
    const edges = [
      {
        id: "shared.edge.weapon_has_trait_pool.powersword_p1_m1.weapon_trait_bespoke_bespoke_powersword_p1_foo",
        type: "weapon_has_trait_pool",
        from_entity_id: "shared.weapon.powersword_p1_m1",
        to_entity_id: "shared.weapon_trait.weapon_trait_bespoke_bespoke_powersword_p1_foo",
      },
      {
        id: "shared.edge.instance_of.weapon_trait_bespoke_bespoke_powersword_p1_foo",
        type: "instance_of",
        from_entity_id: "shared.weapon_trait.weapon_trait_bespoke_bespoke_powersword_p1_foo",
        to_entity_id: "shared.name_family.blessing.weapon_trait_bespoke_bespoke_powersword_p1_foo",
      },
    ];
    const { edgesFixed } = fixMalformedSlugs([], edges);
    assert.equal(edgesFixed, 2);
    assert.equal(
      edges[0].id,
      "shared.edge.weapon_has_trait_pool.powersword_p1_m1.weapon_trait_bespoke_powersword_p1_foo",
    );
    assert.equal(edges[0].to_entity_id, "shared.weapon_trait.weapon_trait_bespoke_powersword_p1_foo");
    assert.equal(
      edges[1].id,
      "shared.edge.instance_of.weapon_trait_bespoke_powersword_p1_foo",
    );
    assert.equal(
      edges[1].from_entity_id,
      "shared.weapon_trait.weapon_trait_bespoke_powersword_p1_foo",
    );
    assert.equal(
      edges[1].to_entity_id,
      "shared.name_family.blessing.weapon_trait_bespoke_powersword_p1_foo",
    );
  });

  it("throws on collision when fixed entity id already exists", () => {
    const entities = [
      {
        id: "shared.weapon_trait.weapon_trait_bespoke_bespoke_powersword_p1_foo",
        kind: "weapon_trait",
        internal_name: "weapon_trait_bespoke_bespoke_powersword_p1_foo",
      },
      {
        id: "shared.weapon_trait.weapon_trait_bespoke_powersword_p1_foo",
        kind: "weapon_trait",
        internal_name: "weapon_trait_bespoke_powersword_p1_foo",
      },
    ];
    assert.throws(
      () => fixMalformedSlugs(entities, []),
      /collision.*shared\.weapon_trait\.weapon_trait_bespoke_powersword_p1_foo/i,
    );
  });

  it("is idempotent — no-ops when no bad slugs found", () => {
    const entities = [
      {
        id: "shared.weapon_trait.weapon_trait_bespoke_powersword_p1_foo",
        kind: "weapon_trait",
        internal_name: "weapon_trait_bespoke_powersword_p1_foo",
      },
    ];
    const edges = [
      {
        id: "shared.edge.weapon_has_trait_pool.powersword_p1_m1.weapon_trait_bespoke_powersword_p1_foo",
        type: "weapon_has_trait_pool",
        from_entity_id: "shared.weapon.powersword_p1_m1",
        to_entity_id: "shared.weapon_trait.weapon_trait_bespoke_powersword_p1_foo",
      },
    ];
    const { entitiesFixed, edgesFixed } = fixMalformedSlugs(entities, edges);
    assert.equal(entitiesFixed, 0);
    assert.equal(edgesFixed, 0);
    assert.equal(entities[0].id, "shared.weapon_trait.weapon_trait_bespoke_powersword_p1_foo");
    assert.equal(edges[0].id, "shared.edge.weapon_has_trait_pool.powersword_p1_m1.weapon_trait_bespoke_powersword_p1_foo");
  });

  it("fixes multiple entities and counts them all", () => {
    const entities = [
      {
        id: "shared.weapon_trait.weapon_trait_bespoke_bespoke_a",
        kind: "weapon_trait",
        internal_name: "weapon_trait_bespoke_bespoke_a",
      },
      {
        id: "shared.weapon_trait.weapon_trait_bespoke_bespoke_b",
        kind: "weapon_trait",
        internal_name: "weapon_trait_bespoke_bespoke_b",
      },
      {
        id: "shared.weapon_trait.weapon_trait_bespoke_c",
        kind: "weapon_trait",
        internal_name: "weapon_trait_bespoke_c",
      },
    ];
    const { entitiesFixed } = fixMalformedSlugs(entities, []);
    assert.equal(entitiesFixed, 2);
  });

  it("does not modify edges with no bespoke_bespoke_ occurrences", () => {
    const edges = [
      {
        id: "shared.edge.weapon_has_trait_pool.powersword_p1_m1.weapon_trait_bespoke_foo",
        type: "weapon_has_trait_pool",
        from_entity_id: "shared.weapon.powersword_p1_m1",
        to_entity_id: "shared.weapon_trait.weapon_trait_bespoke_foo",
      },
    ];
    const { edgesFixed } = fixMalformedSlugs([], edges);
    assert.equal(edgesFixed, 0);
  });
});
