import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MELEE_PERK_NAMES,
  RANGED_PERK_NAMES,
  GADGET_TRAIT_NAMES,
  buildPerkAliasRecord,
  generatePerkAliases,
  enrichGadgetTraits,
  enrichNameFamilies,
  enrichBlessingNamesFromSlugs,
  mergeAliases,
  enrichWeaponNames,
  generateWeaponAliases,
} from "../cli/enrich-entity-names.js";

describe("MELEE_PERK_NAMES", () => {
  it("maps weapon_trait_increase_crit_chance to Critical Hit Chance", () => {
    assert.equal(MELEE_PERK_NAMES.get("weapon_trait_increase_crit_chance"), "Critical Hit Chance");
  });

  it("maps weapon_trait_melee_common_wield_increased_armored_damage to Damage (Flak Armoured)", () => {
    assert.equal(
      MELEE_PERK_NAMES.get("weapon_trait_melee_common_wield_increased_armored_damage"),
      "Damage (Flak Armoured)",
    );
  });

  it("maps weapon_trait_reduced_block_cost to Block Efficiency", () => {
    assert.equal(MELEE_PERK_NAMES.get("weapon_trait_reduced_block_cost"), "Block Efficiency");
  });

  it("has 19 entries", () => {
    assert.equal(MELEE_PERK_NAMES.size, 19);
  });
});

describe("RANGED_PERK_NAMES", () => {
  it("maps weapon_trait_ranged_increase_crit_chance to Critical Hit Chance", () => {
    assert.equal(RANGED_PERK_NAMES.get("weapon_trait_ranged_increase_crit_chance"), "Critical Hit Chance");
  });

  it("maps weapon_trait_ranged_increased_reload_speed to Reload Speed", () => {
    assert.equal(RANGED_PERK_NAMES.get("weapon_trait_ranged_increased_reload_speed"), "Reload Speed");
  });

  it("has 17 entries", () => {
    assert.equal(RANGED_PERK_NAMES.size, 17);
  });
});

describe("GADGET_TRAIT_NAMES", () => {
  it("maps gadget_block_cost_reduction to Block Efficiency", () => {
    assert.equal(GADGET_TRAIT_NAMES.get("gadget_block_cost_reduction"), "Block Efficiency");
  });

  it("maps gadget_toughness_regen_delay to Toughness Regen Speed", () => {
    assert.equal(GADGET_TRAIT_NAMES.get("gadget_toughness_regen_delay"), "Toughness Regen Speed");
  });

  it("has 19 entries", () => {
    assert.equal(GADGET_TRAIT_NAMES.size, 19);
  });

  it("excludes innate gadget stats", () => {
    assert.equal(GADGET_TRAIT_NAMES.has("gadget_innate_health_increase"), false);
    assert.equal(GADGET_TRAIT_NAMES.has("gadget_innate_max_wounds_increase"), false);
    assert.equal(GADGET_TRAIT_NAMES.has("gadget_innate_toughness_increase"), false);
  });

  it("excludes unmapped gadget traits", () => {
    assert.equal(GADGET_TRAIT_NAMES.has("gadget_damage_reduction_vs_grenadiers"), false);
    assert.equal(GADGET_TRAIT_NAMES.has("gadget_permanent_damage_resistance"), false);
  });
});

describe("buildPerkAliasRecord", () => {
  it("builds a melee perk alias record with correct fields", () => {
    const record = buildPerkAliasRecord(
      "shared.weapon_perk.melee.weapon_trait_increase_crit_chance",
      "Critical Hit Chance",
      "melee",
    );
    assert.equal(record.text, "Critical Hit Chance");
    assert.equal(record.normalized_text, "critical hit chance");
    assert.equal(record.candidate_entity_id, "shared.weapon_perk.melee.weapon_trait_increase_crit_chance");
    assert.equal(record.alias_kind, "community_name");
    assert.equal(record.match_mode, "fuzzy_allowed");
    assert.equal(record.provenance, "build-scoring-data");
    assert.equal(record.confidence, "high");
    assert.equal(record.rank_weight, 150);
    assert.equal(record.notes, "");
    assert.deepEqual(record.context_constraints, {
      require_all: [{ key: "slot", value: "melee" }],
      prefer: [],
    });
  });

  it("builds a ranged perk alias record", () => {
    const record = buildPerkAliasRecord(
      "shared.weapon_perk.ranged.weapon_trait_ranged_increased_reload_speed",
      "Reload Speed",
      "ranged",
    );
    assert.deepEqual(record.context_constraints.require_all, [{ key: "slot", value: "ranged" }]);
  });
});

describe("generatePerkAliases", () => {
  const entities = [
    {
      id: "shared.weapon_perk.melee.weapon_trait_increase_crit_chance",
      kind: "weapon_perk",
      internal_name: "weapon_trait_increase_crit_chance",
      ui_name: null,
    },
    {
      id: "shared.weapon_perk.ranged.weapon_trait_ranged_increased_reload_speed",
      kind: "weapon_perk",
      internal_name: "weapon_trait_ranged_increased_reload_speed",
      ui_name: null,
    },
    {
      id: "shared.weapon.combataxe_p1_m1",
      kind: "weapon",
      internal_name: "combataxe_p1_m1",
      ui_name: null,
    },
  ];

  it("generates alias records only for weapon_perk entities", () => {
    const aliases = generatePerkAliases(entities);
    assert.equal(aliases.length, 2);
  });

  it("assigns correct slot from entity id", () => {
    const aliases = generatePerkAliases(entities);
    const melee = aliases.find((a) => a.text === "Critical Hit Chance");
    const ranged = aliases.find((a) => a.text === "Reload Speed");
    assert.deepEqual(melee.context_constraints.require_all, [{ key: "slot", value: "melee" }]);
    assert.deepEqual(ranged.context_constraints.require_all, [{ key: "slot", value: "ranged" }]);
  });

  it("skips weapon_perk entities not in lookup tables", () => {
    const unknownEntities = [
      {
        id: "shared.weapon_perk.melee.weapon_trait_unknown",
        kind: "weapon_perk",
        internal_name: "weapon_trait_unknown",
        ui_name: null,
      },
    ];
    const aliases = generatePerkAliases(unknownEntities);
    assert.equal(aliases.length, 0);
  });
});

describe("enrichGadgetTraits", () => {
  it("sets ui_name on matched gadget_trait entities", () => {
    const entities = [
      {
        id: "shared.gadget_trait.gadget_block_cost_reduction",
        kind: "gadget_trait",
        internal_name: "gadget_block_cost_reduction",
        ui_name: null,
      },
      {
        id: "shared.gadget_trait.gadget_innate_health_increase",
        kind: "gadget_trait",
        internal_name: "gadget_innate_health_increase",
        ui_name: null,
      },
    ];
    const count = enrichGadgetTraits(entities);
    assert.equal(count, 1);
    assert.equal(entities[0].ui_name, "Block Efficiency");
    assert.equal(entities[1].ui_name, null);
  });

  it("preserves existing ui_name values", () => {
    const entities = [
      {
        id: "shared.gadget_trait.gadget_toughness_increase",
        kind: "gadget_trait",
        internal_name: "gadget_toughness_increase",
        ui_name: "Already Set",
      },
    ];
    const count = enrichGadgetTraits(entities);
    assert.equal(count, 0);
    assert.equal(entities[0].ui_name, "Already Set");
  });
});

describe("enrichNameFamilies", () => {
  it("sets ui_name on matched name_family entities", () => {
    const entities = [
      {
        id: "shared.name_family.blessing.toughness_on_elite_kills",
        kind: "name_family",
        ui_name: null,
        attributes: { family_type: "blessing" },
      },
      {
        id: "shared.name_family.blessing.bloodthirsty",
        kind: "name_family",
        ui_name: null,
        attributes: { family_type: "blessing" },
      },
    ];
    const count = enrichNameFamilies(entities);
    assert.equal(count, 1);
    assert.equal(entities[0].ui_name, "Gloryhunter");
    assert.equal(entities[1].ui_name, null);
  });

  it("extracts concept suffix from name_family ID", () => {
    const entities = [
      {
        id: "shared.name_family.blessing.toughness_on_elite_kills",
        kind: "name_family",
        ui_name: null,
        attributes: { family_type: "blessing" },
      },
    ];
    enrichNameFamilies(entities);
    assert.equal(entities[0].ui_name, "Gloryhunter");
  });

  it("preserves existing ui_name values", () => {
    const entities = [
      {
        id: "shared.name_family.blessing.toughness_on_elite_kills",
        kind: "name_family",
        ui_name: "Already Set",
        attributes: { family_type: "blessing" },
      },
    ];
    const count = enrichNameFamilies(entities);
    assert.equal(count, 0);
    assert.equal(entities[0].ui_name, "Already Set");
  });
});

describe("mergeAliases", () => {
  it("appends new aliases", () => {
    const existing = [
      { candidate_entity_id: "a", alias_kind: "guide_name", text: "old" },
    ];
    const newAliases = [
      { candidate_entity_id: "b", alias_kind: "community_name", text: "new" },
    ];
    const { merged, added, updated } = mergeAliases(existing, newAliases);
    assert.equal(merged.length, 2);
    assert.equal(added, 1);
    assert.equal(updated, 0);
  });

  it("updates existing aliases with matching entity+kind+text", () => {
    const existing = [
      { candidate_entity_id: "a", alias_kind: "community_name", text: "same" },
    ];
    const newAliases = [
      { candidate_entity_id: "a", alias_kind: "community_name", text: "same", notes: "updated" },
    ];
    const { merged, added, updated } = mergeAliases(existing, newAliases);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].notes, "updated");
    assert.equal(added, 0);
    assert.equal(updated, 1);
  });

  it("does not overwrite aliases with different kind", () => {
    const existing = [
      { candidate_entity_id: "a", alias_kind: "guide_name", text: "guide" },
    ];
    const newAliases = [
      { candidate_entity_id: "a", alias_kind: "community_name", text: "community" },
    ];
    const { merged, added, updated } = mergeAliases(existing, newAliases);
    assert.equal(merged.length, 2);
    assert.equal(added, 1);
    assert.equal(updated, 0);
  });

  it("keeps distinct GamesLantern labels for the same entity", () => {
    const existing = [
      {
        candidate_entity_id: "veteran.keystone.veteran_improved_tag",
        alias_kind: "gameslantern_name",
        text: "Focus Target!",
        normalized_text: "focus target",
      },
    ];
    const newAliases = [
      {
        candidate_entity_id: "veteran.keystone.veteran_improved_tag",
        alias_kind: "gameslantern_name",
        text: "Focus Target",
        normalized_text: "focus target",
      },
    ];

    const { merged } = mergeAliases(existing, newAliases);
    assert.equal(merged.length, 2);
  });
});

describe("enrichWeaponNames", () => {
  const mapping = [
    { gl_name: "Catachan Mk I Combat Blade", template_id: "combatknife_p1_m1", source: "manual" },
    { gl_name: "Rashad Mk X Combat Axe", template_id: "combataxe_p1_m1", source: "manual" },
  ];

  it("sets ui_name on matching weapon entity", () => {
    const entities = [
      {
        id: "shared.weapon.combatknife_p1_m1",
        kind: "weapon",
        internal_name: "combatknife_p1_m1",
        ui_name: null,
        attributes: { slot: "melee" },
      },
    ];
    const count = enrichWeaponNames(entities, mapping);
    assert.equal(count, 1);
    assert.equal(entities[0].ui_name, "Catachan Mk I Combat Blade");
  });

  it("preserves existing ui_name", () => {
    const entities = [
      {
        id: "shared.weapon.combatknife_p1_m1",
        kind: "weapon",
        internal_name: "combatknife_p1_m1",
        ui_name: "Already Set",
        attributes: { slot: "melee" },
      },
    ];
    const count = enrichWeaponNames(entities, mapping);
    assert.equal(count, 0);
    assert.equal(entities[0].ui_name, "Already Set");
  });

  it("skips non-weapon entities", () => {
    const entities = [
      {
        id: "shared.weapon_perk.melee.weapon_trait_increase_crit_chance",
        kind: "weapon_perk",
        internal_name: "combatknife_p1_m1",
        ui_name: null,
        attributes: { slot: "melee" },
      },
    ];
    const count = enrichWeaponNames(entities, mapping);
    assert.equal(count, 0);
    assert.equal(entities[0].ui_name, null);
  });

  it("returns count of updated entities", () => {
    const entities = [
      {
        id: "shared.weapon.combatknife_p1_m1",
        kind: "weapon",
        internal_name: "combatknife_p1_m1",
        ui_name: null,
        attributes: { slot: "melee" },
      },
      {
        id: "shared.weapon.combataxe_p1_m1",
        kind: "weapon",
        internal_name: "combataxe_p1_m1",
        ui_name: null,
        attributes: { slot: "melee" },
      },
      {
        id: "shared.weapon.unknown_weapon",
        kind: "weapon",
        internal_name: "unknown_weapon",
        ui_name: null,
        attributes: { slot: "melee" },
      },
    ];
    const count = enrichWeaponNames(entities, mapping);
    assert.equal(count, 2);
  });
});

describe("generateWeaponAliases", () => {
  const meleeEntity = {
    id: "shared.weapon.combatknife_p1_m1",
    kind: "weapon",
    internal_name: "combatknife_p1_m1",
    ui_name: "Catachan Mk I Combat Blade",
    attributes: { slot: "melee" },
  };
  const rangedEntity = {
    id: "shared.weapon.autogun_p1_m1",
    kind: "weapon",
    internal_name: "autogun_p1_m1",
    ui_name: "Agripinaa Mk I Infantry Autogun",
    attributes: { slot: "ranged" },
  };
  const mapping = [
    { gl_name: "Catachan Mk I Combat Blade", template_id: "combatknife_p1_m1", source: "manual" },
    { gl_name: "Agripinaa Mk I Infantry Autogun", template_id: "autogun_p1_m1", source: "manual" },
    { gl_name: "Orphaned Entry", template_id: "nonexistent_weapon", source: "manual" },
  ];
  const entities = [meleeEntity, rangedEntity];

  it("generates alias with correct shape (gameslantern_name alias_kind, gl-catalog provenance, rank_weight 120)", () => {
    const aliases = generateWeaponAliases(mapping, entities);
    const alias = aliases.find((a) => a.candidate_entity_id === "shared.weapon.combatknife_p1_m1");
    assert.ok(alias, "alias for combatknife_p1_m1 not found");
    assert.equal(alias.text, "Catachan Mk I Combat Blade");
    assert.equal(alias.normalized_text, "catachan mk i combat blade");
    assert.equal(alias.alias_kind, "gameslantern_name");
    assert.equal(alias.match_mode, "fuzzy_allowed");
    assert.equal(alias.provenance, "gl-catalog");
    assert.equal(alias.confidence, "high");
    assert.equal(alias.rank_weight, 120);
    assert.equal(alias.notes, "");
  });

  it("uses melee slot constraint for melee weapons", () => {
    const aliases = generateWeaponAliases(mapping, entities);
    const alias = aliases.find((a) => a.candidate_entity_id === "shared.weapon.combatknife_p1_m1");
    assert.deepEqual(alias.context_constraints, {
      require_all: [{ key: "slot", value: "melee" }],
      prefer: [],
    });
  });

  it("uses ranged slot constraint for ranged weapons", () => {
    const aliases = generateWeaponAliases(mapping, entities);
    const alias = aliases.find((a) => a.candidate_entity_id === "shared.weapon.autogun_p1_m1");
    assert.deepEqual(alias.context_constraints, {
      require_all: [{ key: "slot", value: "ranged" }],
      prefer: [],
    });
  });

  it("skips mapping entries with no matching entity", () => {
    const aliases = generateWeaponAliases(mapping, entities);
    const orphaned = aliases.find((a) => a.text === "Orphaned Entry");
    assert.equal(orphaned, undefined);
    assert.equal(aliases.length, 2);
  });
});

describe("enrichBlessingNamesFromSlugs", () => {
  it("title-cases community-named slug as ui_name when matched in GL", () => {
    const entities = [
      { id: "shared.name_family.blessing.bloodthirsty", kind: "name_family", ui_name: null },
      { id: "shared.name_family.blessing.blaze_away", kind: "name_family", ui_name: null },
      { id: "shared.name_family.blessing.brutal_momentum", kind: "name_family", ui_name: null },
    ];
    const glBlessings = [
      { display_name: "Bloodthirsty", effect: "...", weapon_types: [] },
      { display_name: "Blaze Away", effect: "...", weapon_types: [] },
      { display_name: "Brutal Momentum", effect: "...", weapon_types: [] },
    ];
    const count = enrichBlessingNamesFromSlugs(entities, glBlessings);
    assert.equal(count, 3);
    assert.equal(entities[0].ui_name, "Bloodthirsty");
    assert.equal(entities[1].ui_name, "Blaze Away");
    assert.equal(entities[2].ui_name, "Brutal Momentum");
  });

  it("does not set ui_name for concept slugs with no GL match", () => {
    const entities = [
      { id: "shared.name_family.blessing.consecutive_hits_increases_close_damage", kind: "name_family", ui_name: null },
    ];
    const glBlessings = [
      { display_name: "Bloodthirsty", effect: "...", weapon_types: [] },
    ];
    const count = enrichBlessingNamesFromSlugs(entities, glBlessings);
    assert.equal(count, 0);
    assert.equal(entities[0].ui_name, null);
  });

  it("preserves existing ui_name", () => {
    const entities = [
      { id: "shared.name_family.blessing.bloodthirsty", kind: "name_family", ui_name: "Already Set" },
    ];
    const glBlessings = [
      { display_name: "Bloodthirsty", effect: "...", weapon_types: [] },
    ];
    const count = enrichBlessingNamesFromSlugs(entities, glBlessings);
    assert.equal(count, 0);
    assert.equal(entities[0].ui_name, "Already Set");
  });

  it("handles multi-word slugs with articles correctly", () => {
    const entities = [
      { id: "shared.name_family.blessing.all_or_nothing", kind: "name_family", ui_name: null },
    ];
    const glBlessings = [
      { display_name: "All or Nothing", effect: "...", weapon_types: [] },
    ];
    const count = enrichBlessingNamesFromSlugs(entities, glBlessings);
    assert.equal(count, 1);
    assert.equal(entities[0].ui_name, "All or Nothing");
  });
});

const __test_dirname = dirname(fileURLToPath(import.meta.url));

describe("integration: real data coverage", () => {
  const ENTITIES_ROOT = resolve(__test_dirname, "..", "..", "data", "ground-truth", "entities");
  const weaponEntities = JSON.parse(readFileSync(resolve(ENTITIES_ROOT, "shared-weapons.json"), "utf8"));
  const nameEntities = JSON.parse(readFileSync(resolve(ENTITIES_ROOT, "shared-names.json"), "utf8"));

  it("generatePerkAliases produces 36 alias records from real entities", () => {
    const aliases = generatePerkAliases(weaponEntities);
    assert.equal(aliases.length, 36, `Expected 36 perk aliases, got ${aliases.length}`);
  });

  it("all perk aliases have valid normalized_text", () => {
    const aliases = generatePerkAliases(weaponEntities);
    for (const alias of aliases) {
      assert.ok(alias.normalized_text.length > 0, `Empty normalized_text for ${alias.candidate_entity_id}`);
      assert.ok(
        !alias.normalized_text.includes("(") && !alias.normalized_text.includes(")"),
        `normalized_text should strip parens: ${alias.normalized_text}`,
      );
    }
  });

  it("enrichGadgetTraits matches 19 entities from real data", () => {
    // Reset ui_name to null so enrichment runs regardless of prior state
    const copy = JSON.parse(JSON.stringify(weaponEntities));
    for (const e of copy) {
      if (e.kind === "gadget_trait") e.ui_name = null;
    }
    const count = enrichGadgetTraits(copy);
    assert.equal(count, 19, `Expected 19 gadget traits enriched, got ${count}`);
  });

  it("enrichNameFamilies matches 9 entities from real data", () => {
    const copy = JSON.parse(JSON.stringify(nameEntities));
    for (const e of copy) {
      if (e.kind === "name_family") e.ui_name = null;
    }
    const count = enrichNameFamilies(copy);
    assert.equal(count, 9, `Expected 9 name families enriched, got ${count}`);
  });

  it("enrichBlessingNamesFromSlugs enriches 40+ name_families from real GL data", () => {
    const catalogPath = resolve(__test_dirname, "..", "..", "data", "ground-truth", "generated", "gl-catalog.json");
    if (!existsSync(catalogPath)) {
      return;
    }
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
    const copy = JSON.parse(JSON.stringify(nameEntities));
    for (const e of copy) {
      if (e.kind === "name_family") e.ui_name = null;
    }
    const count = enrichBlessingNamesFromSlugs(copy, catalog.blessings);
    assert.ok(count >= 40, `Expected at least 40 slug-enriched name families, got ${count}`);
  });
});
