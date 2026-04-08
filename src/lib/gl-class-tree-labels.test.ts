import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildGlClassTreeLabelEntry,
  buildClassSideAliasRecord,
  dedupeGlClassTreeLabelEntries,
  entityKindFromAssetUrl,
  internalNameFromScrapedNode,
} from "./gl-class-tree-labels.js";

describe("entityKindFromAssetUrl", () => {
  it("maps tactical assets to ability entities", () => {
    assert.equal(
      entityKindFromAssetUrl("https://gameslantern.com/storage/sites/darktide/exporter/talents/adamant/tactical/adamant_whistle.webp"),
      "ability",
    );
  });

  it("maps ability modifier assets to talent_modifier entities", () => {
    assert.equal(
      entityKindFromAssetUrl("https://gameslantern.com/storage/sites/darktide/exporter/talents/veteran/ability_modifier/veteran_increased_close_damage_after_combat_ability.webp"),
      "talent_modifier",
    );
  });

  it("maps ability assets to ability entities", () => {
    assert.equal(
      entityKindFromAssetUrl("https://gameslantern.com/storage/sites/darktide/exporter/talents/veteran/ability/veteran_ranger_ability.webp"),
      "ability",
    );
  });

  it("maps aura assets to aura entities", () => {
    assert.equal(
      entityKindFromAssetUrl("https://gameslantern.com/storage/sites/darktide/exporter/talents/psyker/aura/psyker_aura_reduce_warp.webp"),
      "aura",
    );
  });

  it("maps keystone assets to keystone entities", () => {
    assert.equal(
      entityKindFromAssetUrl("https://gameslantern.com/storage/sites/darktide/exporter/talents/veteran/keystone/veteran_improved_tag.webp"),
      "keystone",
    );
  });

  it("maps default assets to talent entities", () => {
    assert.equal(
      entityKindFromAssetUrl("https://gameslantern.com/storage/sites/darktide/exporter/talents/psyker/default/psyker_warp_charge_on_kill.webp"),
      "talent",
    );
  });

  it("returns null for undefined input", () => {
    assert.equal(entityKindFromAssetUrl(undefined), null);
  });

  it("returns null for frame-only stat nodes", () => {
    assert.equal(
      entityKindFromAssetUrl("/images/sites/darktide/talents/frames/circular_small_frame.webp"),
      null,
    );
  });
});

describe("internalNameFromScrapedNode", () => {
  it("extracts the internal name from the icon URL when present", () => {
    assert.equal(
      internalNameFromScrapedNode({
        slug: "castigators-stance",
        icon: "https://gameslantern.com/storage/sites/darktide/exporter/talents/adamant/ability/adamant_stance.webp",
        frame: "/images/sites/darktide/talents/frames/hex_frame.webp",
      }),
      "adamant_stance",
    );
  });

  it("falls back to frame when inactive nodes store the asset there", () => {
    assert.equal(
      internalNameFromScrapedNode({
        slug: "terminus-warrant",
        frame: "https://gameslantern.com/storage/sites/darktide/exporter/talents/adamant/keystone/adamant_terminus_warrant.webp",
      }),
      "adamant_terminus_warrant",
    );
  });
});

describe("buildClassSideAliasRecord", () => {
  it("builds a class-scoped GamesLantern alias record", () => {
    const alias = buildClassSideAliasRecord({
      class: "arbites",
      kind: "keystone",
      display_name: "Execution Order",
      normalized_text: "execution order",
      entity_id: "arbites.keystone.adamant_execution_order",
    });

    assert.equal(alias.alias_kind, "gameslantern_name");
    assert.equal(alias.provenance, "gl-class-tree");
    assert.deepEqual(alias.context_constraints.require_all, [
      { key: "class", value: "arbites" },
      { key: "kind", value: "keystone" },
    ]);
  });
});

describe("buildGlClassTreeLabelEntry", () => {
  it("uses blitz as the resolver kind for tactical assets while keeping ability entity ids", () => {
    const entry = buildGlClassTreeLabelEntry(
      "veteran",
      {
        slug: "shredder-frag-grenade",
        name: "Shredder Frag Grenade",
        icon: "https://gameslantern.com/storage/sites/darktide/exporter/talents/veteran/tactical/veteran_grenade_apply_bleed.webp",
        frame: "/images/sites/darktide/talents/frames/square_frame.webp",
      },
      "https://darktide.gameslantern.com/builds/example",
    );

    assert.equal(entry?.kind, "blitz");
    assert.equal(entry?.entity_id, "veteran.ability.veteran_grenade_apply_bleed");
  });

  it("respects registry overrides for Arbites companion-focus nodes", () => {
    const entry = buildGlClassTreeLabelEntry(
      "arbites",
      {
        slug: "go-get-em",
        name: "Go Get Em",
        icon: "https://gameslantern.com/storage/sites/darktide/exporter/talents/adamant/keystone/adamant_companion_focus_ranged.webp",
        frame: "/images/sites/darktide/talents/frames/hex_frame.webp",
      },
      "https://darktide.gameslantern.com/builds/example",
    );

    assert.equal(entry?.kind, "talent");
    assert.equal(entry?.entity_id, "arbites.keystone.adamant_companion_focus_ranged");
  });
});

describe("dedupeGlClassTreeLabelEntries", () => {
  it("keeps distinct GamesLantern labels when only punctuation differs", () => {
    const deduped = dedupeGlClassTreeLabelEntries([
      {
        class: "veteran",
        kind: "keystone",
        internal_name: "veteran_improved_tag",
        entity_id: "veteran.keystone.veteran_improved_tag",
        display_name: "Focus Target!",
        normalized_text: "focus target",
        source_url: "https://darktide.gameslantern.com/builds/a",
        asset_url: "https://gameslantern.com/storage/sites/darktide/exporter/talents/veteran/keystone/veteran_improved_tag.webp",
        slug: "focus-target",
      },
      {
        class: "veteran",
        kind: "keystone",
        internal_name: "veteran_improved_tag",
        entity_id: "veteran.keystone.veteran_improved_tag",
        display_name: "Focus Target",
        normalized_text: "focus target",
        source_url: "https://darktide.gameslantern.com/builds/b",
        asset_url: "https://gameslantern.com/storage/sites/darktide/exporter/talents/veteran/keystone/veteran_improved_tag.webp",
        slug: "focus-target",
      },
    ]);

    assert.equal(deduped.length, 2);
  });
});
