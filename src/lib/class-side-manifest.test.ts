import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildClassSideManifest,
  classifyClassSideNode,
  expectedEntityIdForNode,
} from "./class-side-manifest.js";

const sourceRoot = process.env.GROUND_TRUTH_SOURCE_ROOT;

describe("class-side manifest classification", () => {
  it("routes tactical nodes to blitz slot while preserving current ability entity IDs", () => {
    const classified = classifyClassSideNode("veteran", {
      widget_name: "node_frag",
      talent: "veteran_grenade_apply_bleed",
      type: "tactical",
      group_name: null,
      children: [],
      parents: [],
      line: 1279,
    });

    assert.equal(classified.slot, "blitz");
    assert.equal(classified.kind, "ability");
    assert.equal(
      expectedEntityIdForNode("veteran", classified, "veteran_grenade_apply_bleed"),
      "veteran.ability.veteran_grenade_apply_bleed",
    );
  });

  it("routes arbites companion-focus keystones into talents", () => {
    const classified = classifyClassSideNode("arbites", {
      widget_name: "node_dog",
      talent: "go_get_em",
      type: "keystone",
      group_name: "dog_1",
      children: [],
      parents: [],
      line: 900,
    });

    assert.equal(classified.slot, "talents");
    assert.equal(classified.kind, "keystone");
  });

  it("routes ability nodes to ability slot", () => {
    const classified = classifyClassSideNode("psyker", {
      talent: "some_ability",
      type: "ability",
    });

    assert.equal(classified.slot, "ability");
    assert.equal(classified.kind, "ability");
  });

  it("routes aura nodes to aura slot", () => {
    const classified = classifyClassSideNode("psyker", {
      talent: "some_aura",
      type: "aura",
    });

    assert.equal(classified.slot, "aura");
    assert.equal(classified.kind, "aura");
  });

  it("routes keystone nodes to keystone slot", () => {
    const classified = classifyClassSideNode("psyker", {
      talent: "some_keystone",
      type: "keystone",
    });

    assert.equal(classified.slot, "keystone");
    assert.equal(classified.kind, "keystone");
  });

  it("routes ability_modifier nodes to talents slot as talent_modifier", () => {
    const classified = classifyClassSideNode("psyker", {
      talent: "some_mod",
      type: "ability_modifier",
    });

    assert.equal(classified.slot, "talents");
    assert.equal(classified.kind, "talent_modifier");
  });

  it("routes tactical_modifier nodes to talents slot as talent_modifier", () => {
    const classified = classifyClassSideNode("psyker", {
      talent: "some_tac_mod",
      type: "tactical_modifier",
    });

    assert.equal(classified.slot, "talents");
    assert.equal(classified.kind, "talent_modifier");
  });

  it("routes keystone_modifier nodes to talents slot as talent_modifier", () => {
    const classified = classifyClassSideNode("psyker", {
      talent: "some_ks_mod",
      type: "keystone_modifier",
    });

    assert.equal(classified.slot, "talents");
    assert.equal(classified.kind, "talent_modifier");
  });

  it("routes unknown types to talents slot as talent (default)", () => {
    const classified = classifyClassSideNode("psyker", {
      talent: "some_talent",
      type: "default",
    });

    assert.equal(classified.slot, "talents");
    assert.equal(classified.kind, "talent");
  });
});

describe("buildClassSideManifest", () => {
  it("builds entries for every supported class layout", { skip: !sourceRoot }, () => {
    const manifest = buildClassSideManifest(sourceRoot!);
    const classes = new Set(manifest.map((entry) => entry.class));

    assert.deepEqual(
      [...classes].sort(),
      ["arbites", "hive_scum", "ogryn", "psyker", "veteran", "zealot"],
    );
    assert.equal(
      manifest.some((entry) => entry.entity_id === "veteran.ability.veteran_grenade_apply_bleed"),
      true,
    );
  });
});
