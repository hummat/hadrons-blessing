# Entity Name Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich weapon perk, gadget trait, and blessing name_family entities with display names so GL build text resolves to them.

**Architecture:** New script `scripts/enrich-entity-names.mjs` reads `build-scoring-data.json` as the display-name source. It generates alias records for weapon perks (need slot context constraints) and sets `ui_name` directly on gadget traits and name_families (no collision risk). Registered as `npm run entities:enrich`.

**Tech Stack:** Node.js ESM, `node:fs`, `node:path`. Project's `normalizeText()` from `scripts/ground-truth/lib/normalize.mjs`.

**Spec:** `docs/superpowers/specs/2026-03-26-entity-name-enrichment-design.md`

---

### Task 1: Lookup tables and core enrichment logic

**Files:**
- Create: `scripts/enrich-entity-names.mjs`
- Create: `scripts/enrich-entity-names.test.mjs`

This task builds the hardcoded lookup tables and the three enrichment functions (perk aliases, gadget ui_name, blessing ui_name), plus their tests. No file I/O yet — pure data transforms.

- [ ] **Step 1: Write failing tests for the perk lookup**

```js
// scripts/enrich-entity-names.test.mjs
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  MELEE_PERK_NAMES,
  RANGED_PERK_NAMES,
  GADGET_TRAIT_NAMES,
  buildPerkAliasRecord,
} from "./enrich-entity-names.mjs";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/enrich-entity-names.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the lookup tables**

```js
// scripts/enrich-entity-names.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeText } from "./ground-truth/lib/normalize.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Hardcoded lookup tables ---
// Derived from scripts/build-scoring-data.json.
// Keys: entity internal_name. Values: display name from scoring data.

const MELEE_PERK_NAMES = new Map([
  ["weapon_trait_melee_common_wield_increased_unarmored_damage", "Damage (Unarmoured)"],
  ["weapon_trait_melee_common_wield_increased_armored_damage", "Damage (Flak Armoured)"],
  ["weapon_trait_melee_common_wield_increased_resistant_damage", "Damage (Unyielding)"],
  ["weapon_trait_melee_common_wield_increased_berserker_damage", "Damage (Maniacs)"],
  ["weapon_trait_melee_common_wield_increased_super_armor_damage", "Damage (Carapace)"],
  ["weapon_trait_melee_common_wield_increased_disgustingly_resilient_damage", "Damage (Infested)"],
  ["weapon_trait_increase_crit_chance", "Critical Hit Chance"],
  ["weapon_trait_increase_crit_damage", "Critical Hit Damage"],
  ["weapon_trait_increase_stamina", "Stamina"],
  ["weapon_trait_increase_weakspot_damage", "Weakspot Damage"],
  ["weapon_trait_increase_damage", "Damage (flat)"],
  ["weapon_trait_increase_finesse", "Finesse"],
  ["weapon_trait_increase_power", "Power Level"],
  ["weapon_trait_increase_impact", "Impact"],
  ["weapon_trait_reduced_block_cost", "Block Efficiency"],
  ["weapon_trait_increase_damage_elites", "Damage (Elites)"],
  ["weapon_trait_increase_damage_hordes", "Damage (Hordes)"],
  ["weapon_trait_increase_damage_specials", "Damage (Specialists)"],
  ["weapon_trait_reduce_sprint_cost", "Sprint Efficiency"],
]);

const RANGED_PERK_NAMES = new Map([
  ["weapon_trait_ranged_common_wield_increased_unarmored_damage", "Damage (Unarmoured)"],
  ["weapon_trait_ranged_common_wield_increased_armored_damage", "Damage (Flak Armoured)"],
  ["weapon_trait_ranged_common_wield_increased_resistant_damage", "Damage (Unyielding)"],
  ["weapon_trait_ranged_common_wield_increased_berserker_damage", "Damage (Maniacs)"],
  ["weapon_trait_ranged_common_wield_increased_super_armor_damage", "Damage (Carapace)"],
  ["weapon_trait_ranged_common_wield_increased_disgustingly_resilient_damage", "Damage (Infested)"],
  ["weapon_trait_ranged_increase_crit_chance", "Critical Hit Chance"],
  ["weapon_trait_ranged_increase_crit_damage", "Critical Hit Damage"],
  ["weapon_trait_ranged_increase_stamina", "Stamina (while active)"],
  ["weapon_trait_ranged_increase_weakspot_damage", "Weakspot Damage"],
  ["weapon_trait_ranged_increase_damage", "Damage (flat)"],
  ["weapon_trait_ranged_increase_finesse", "Finesse"],
  ["weapon_trait_ranged_increase_power", "Power Level"],
  ["weapon_trait_ranged_increase_damage_elites", "Damage (Elites)"],
  ["weapon_trait_ranged_increase_damage_hordes", "Damage (Hordes)"],
  ["weapon_trait_ranged_increase_damage_specials", "Damage (Specialists)"],
  ["weapon_trait_ranged_increased_reload_speed", "Reload Speed"],
]);

const GADGET_TRAIT_NAMES = new Map([
  ["gadget_block_cost_reduction", "Block Efficiency"],
  ["gadget_cooldown_reduction", "Combat Ability Regen"],
  ["gadget_corruption_resistance", "Corruption Resistance"],
  ["gadget_damage_reduction_vs_bombers", "DR vs Bombers"],
  ["gadget_damage_reduction_vs_flamers", "DR vs Flamers"],
  ["gadget_damage_reduction_vs_gunners", "DR vs Gunners"],
  ["gadget_damage_reduction_vs_hounds", "DR vs Pox Hounds"],
  ["gadget_damage_reduction_vs_mutants", "DR vs Mutants"],
  ["gadget_damage_reduction_vs_snipers", "DR vs Snipers"],
  ["gadget_health_increase", "Health"],
  ["gadget_mission_credits_increase", "Ordo Dockets"],
  ["gadget_mission_reward_gear_instead_of_weapon_increase", "Curio Drop Chance"],
  ["gadget_mission_xp_increase", "Experience"],
  ["gadget_revive_speed_increase", "Revive Speed"],
  ["gadget_sprint_cost_reduction", "Sprint Efficiency"],
  ["gadget_stamina_increase", "Max Stamina"],
  ["gadget_stamina_regeneration", "Stamina Regeneration"],
  ["gadget_toughness_increase", "Toughness"],
  ["gadget_toughness_regen_delay", "Toughness Regen Speed"],
]);

// 10 unambiguous concept_suffix → community_name mappings from scoring data.
// Only suffixes that map to exactly one community name across all weapons.
const BLESSING_NAMES = new Map([
  ["allow_flanking_and_increased_damage_when_flanking", "Flanking Fire"],
  ["bleed_on_non_weakspot_hit", "Lacerate"],
  ["chance_to_explode_elites_on_kill", "Soulfire"],
  ["charge_level_increases_critical_strike_chance", "Charge Crit"],
  ["extended_activation_duration_on_chained_attacks", "Cycler"],
  ["faster_reload_on_empty_clip", "Charmed Reload"],
  ["increased_weakspot_damage_against_bleeding", "Flesh Tearer"],
  ["power_bonus_on_first_attack", "Haymaker"],
  ["toughness_on_elite_kills", "Gloryhunter"],
  ["warp_charge_power_bonus", "Blazing Spirit"],
]);

export {
  MELEE_PERK_NAMES,
  RANGED_PERK_NAMES,
  GADGET_TRAIT_NAMES,
  BLESSING_NAMES,
};
```

- [ ] **Step 4: Run tests to verify lookup table tests pass**

Run: `node --test scripts/enrich-entity-names.test.mjs`
Expected: Lookup table tests PASS. Remaining tests for `buildBlessingNameMap`, `buildPerkAliasRecord`, etc. FAIL (not yet exported).

- [ ] **Step 5: Write failing tests for buildPerkAliasRecord**

Add to `scripts/enrich-entity-names.test.mjs`:

```js
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
```

- [ ] **Step 6: Implement buildPerkAliasRecord**

Add to `scripts/enrich-entity-names.mjs`:

```js
function buildPerkAliasRecord(entityId, displayName, slot) {
  return {
    text: displayName,
    normalized_text: normalizeText(displayName),
    candidate_entity_id: entityId,
    alias_kind: "community_name",
    match_mode: "fuzzy_allowed",
    provenance: "build-scoring-data",
    confidence: "high",
    context_constraints: {
      require_all: [{ key: "slot", value: slot }],
      prefer: [],
    },
    rank_weight: 150,
    notes: "",
  };
}

export {
  MELEE_PERK_NAMES,
  RANGED_PERK_NAMES,
  GADGET_TRAIT_NAMES,
  BLESSING_NAMES,
  buildPerkAliasRecord,
};
```

- [ ] **Step 7: Run tests to verify buildPerkAliasRecord passes**

Run: `node --test scripts/enrich-entity-names.test.mjs`
Expected: All buildPerkAliasRecord tests PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/enrich-entity-names.mjs scripts/enrich-entity-names.test.mjs
git commit -m "feat(enrich): add lookup tables and perk alias record builder"
```

---

### Task 2: Enrichment functions that operate on entity arrays

**Files:**
- Modify: `scripts/enrich-entity-names.mjs`
- Modify: `scripts/enrich-entity-names.test.mjs`

This task adds the three functions that take entity arrays and return enriched results: `generatePerkAliases`, `enrichGadgetTraits`, `enrichNameFamilies`.

- [ ] **Step 1: Write failing tests for generatePerkAliases**

Add to `scripts/enrich-entity-names.test.mjs`:

```js
import {
  MELEE_PERK_NAMES,
  RANGED_PERK_NAMES,
  GADGET_TRAIT_NAMES,
  BLESSING_NAMES,
  buildPerkAliasRecord,
  generatePerkAliases,
  enrichGadgetTraits,
  enrichNameFamilies,
} from "./enrich-entity-names.mjs";

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
    const entities = [
      {
        id: "shared.weapon_perk.melee.weapon_trait_unknown",
        kind: "weapon_perk",
        internal_name: "weapon_trait_unknown",
        ui_name: null,
      },
    ];
    const aliases = generatePerkAliases(entities);
    assert.equal(aliases.length, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/enrich-entity-names.test.mjs`
Expected: FAIL — `generatePerkAliases` is not exported

- [ ] **Step 3: Implement generatePerkAliases**

Add to `scripts/enrich-entity-names.mjs`:

```js
function slotFromEntityId(entityId) {
  if (entityId.includes(".melee.")) return "melee";
  if (entityId.includes(".ranged.")) return "ranged";
  return null;
}

function generatePerkAliases(entities) {
  const aliases = [];
  for (const entity of entities) {
    if (entity.kind !== "weapon_perk") continue;
    const slot = slotFromEntityId(entity.id);
    if (!slot) continue;
    const lookupTable = slot === "melee" ? MELEE_PERK_NAMES : RANGED_PERK_NAMES;
    const displayName = lookupTable.get(entity.internal_name);
    if (!displayName) continue;
    aliases.push(buildPerkAliasRecord(entity.id, displayName, slot));
  }
  return aliases;
}
```

Update the export block to include `generatePerkAliases`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/enrich-entity-names.test.mjs`
Expected: PASS

- [ ] **Step 5: Write failing tests for enrichGadgetTraits**

Add to `scripts/enrich-entity-names.test.mjs`:

```js
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
```

- [ ] **Step 6: Implement enrichGadgetTraits**

Add to `scripts/enrich-entity-names.mjs`:

```js
function enrichGadgetTraits(entities) {
  let count = 0;
  for (const entity of entities) {
    if (entity.kind !== "gadget_trait") continue;
    if (entity.ui_name != null) continue;
    const displayName = GADGET_TRAIT_NAMES.get(entity.internal_name);
    if (!displayName) continue;
    entity.ui_name = displayName;
    count++;
  }
  return count;
}
```

Update the export block to include `enrichGadgetTraits`.

- [ ] **Step 7: Run test to verify it passes**

Run: `node --test scripts/enrich-entity-names.test.mjs`
Expected: PASS

- [ ] **Step 8: Write failing tests for enrichNameFamilies**

Add to `scripts/enrich-entity-names.test.mjs`:

```js
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
        id: "shared.name_family.blessing.warp_charge_power_bonus",
        kind: "name_family",
        ui_name: null,
        attributes: { family_type: "blessing" },
      },
    ];
    enrichNameFamilies(entities);
    assert.equal(entities[0].ui_name, "Blazing Spirit");
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
```

- [ ] **Step 9: Implement enrichNameFamilies**

Add to `scripts/enrich-entity-names.mjs`:

```js
const NAME_FAMILY_PREFIX = "shared.name_family.blessing.";

function enrichNameFamilies(entities) {
  let count = 0;
  for (const entity of entities) {
    if (entity.kind !== "name_family") continue;
    if (entity.ui_name != null) continue;
    if (!entity.id.startsWith(NAME_FAMILY_PREFIX)) continue;
    const slug = entity.id.slice(NAME_FAMILY_PREFIX.length);
    const displayName = BLESSING_NAMES.get(slug);
    if (!displayName) continue;
    entity.ui_name = displayName;
    count++;
  }
  return count;
}
```

Update the export block to include `enrichNameFamilies`.

- [ ] **Step 10: Run all tests to verify they pass**

Run: `node --test scripts/enrich-entity-names.test.mjs`
Expected: All tests PASS.

- [ ] **Step 11: Commit**

```bash
git add scripts/enrich-entity-names.mjs scripts/enrich-entity-names.test.mjs
git commit -m "feat(enrich): add perk alias generator, gadget/blessing ui_name enrichers"
```

---

### Task 3: File I/O orchestrator and npm script registration

**Files:**
- Modify: `scripts/enrich-entity-names.mjs`
- Modify: `package.json`

This task adds the main orchestrator that reads entity/alias JSON files, calls the enrichment functions, writes results back, and reports counts. Plus the npm script registration.

- [ ] **Step 1: Write the main orchestrator**

Add to `scripts/enrich-entity-names.mjs`, after the enrichment functions:

```js
function mergeAliases(existingAliases, newAliases) {
  const existingByEntity = new Map();
  for (let i = 0; i < existingAliases.length; i++) {
    const key = existingAliases[i].candidate_entity_id + "|" + existingAliases[i].alias_kind;
    existingByEntity.set(key, i);
  }

  const merged = [...existingAliases];
  let added = 0;
  let updated = 0;
  for (const alias of newAliases) {
    const key = alias.candidate_entity_id + "|" + alias.alias_kind;
    const existingIndex = existingByEntity.get(key);
    if (existingIndex != null) {
      merged[existingIndex] = alias;
      updated++;
    } else {
      merged.push(alias);
      added++;
    }
  }
  return { merged, added, updated };
}

function main() {
  const ENTITIES_ROOT = resolve(__dirname, "..", "data", "ground-truth", "entities");
  const ALIASES_ROOT = resolve(__dirname, "..", "data", "ground-truth", "aliases");

  // Read inputs
  const weaponsPath = resolve(ENTITIES_ROOT, "shared-weapons.json");
  const namesPath = resolve(ENTITIES_ROOT, "shared-names.json");
  const aliasesPath = resolve(ALIASES_ROOT, "shared-guides.json");

  const weaponEntities = JSON.parse(readFileSync(weaponsPath, "utf8"));
  const nameEntities = JSON.parse(readFileSync(namesPath, "utf8"));
  const existingAliases = JSON.parse(readFileSync(aliasesPath, "utf8"));

  // 1. Generate perk alias records
  const perkAliases = generatePerkAliases(weaponEntities);

  // 2. Enrich gadget trait ui_names (mutates in place)
  const gadgetCount = enrichGadgetTraits(weaponEntities);

  // 3. Enrich name_family ui_names (mutates in place)
  const blessingCount = enrichNameFamilies(nameEntities);

  // 4. Merge perk aliases into existing alias file
  const { merged, added, updated } = mergeAliases(existingAliases, perkAliases);

  // Write outputs
  writeFileSync(weaponsPath, JSON.stringify(weaponEntities, null, 2) + "\n");
  writeFileSync(namesPath, JSON.stringify(nameEntities, null, 2) + "\n");
  writeFileSync(aliasesPath, JSON.stringify(merged, null, 2) + "\n");

  // Report
  console.log(`Perk aliases: ${added} added, ${updated} updated (${perkAliases.length} total)`);
  console.log(`Gadget traits: ${gadgetCount} ui_name set`);
  console.log(`Name families: ${blessingCount} ui_name set`);
}

export { mergeAliases };

// Run if executed directly
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
```

- [ ] **Step 2: Write test for mergeAliases**

Add to `scripts/enrich-entity-names.test.mjs`:

```js
import {
  MELEE_PERK_NAMES,
  RANGED_PERK_NAMES,
  GADGET_TRAIT_NAMES,
  BLESSING_NAMES,
  buildPerkAliasRecord,
  generatePerkAliases,
  enrichGadgetTraits,
  enrichNameFamilies,
  mergeAliases,
} from "./enrich-entity-names.mjs";

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

  it("updates existing aliases with matching entity+kind", () => {
    const existing = [
      { candidate_entity_id: "a", alias_kind: "community_name", text: "old" },
    ];
    const newAliases = [
      { candidate_entity_id: "a", alias_kind: "community_name", text: "updated" },
    ];
    const { merged, added, updated } = mergeAliases(existing, newAliases);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].text, "updated");
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
});
```

- [ ] **Step 3: Run tests to verify mergeAliases passes**

Run: `node --test scripts/enrich-entity-names.test.mjs`
Expected: All tests PASS.

- [ ] **Step 4: Register npm script in package.json**

Add to `package.json` `scripts` section:

```json
"entities:enrich": "node scripts/enrich-entity-names.mjs"
```

- [ ] **Step 5: Commit**

```bash
git add scripts/enrich-entity-names.mjs scripts/enrich-entity-names.test.mjs package.json
git commit -m "feat(enrich): add file I/O orchestrator and npm script"
```

---

### Task 4: Integration test and full-suite validation

**Files:**
- Modify: `scripts/enrich-entity-names.test.mjs`
- Modify: `package.json` (test registration)

This task adds an integration test that runs against the real data files (read-only — asserts counts without writing) and registers the test in the npm test suite.

- [ ] **Step 1: Write integration test**

Add to `scripts/enrich-entity-names.test.mjs`:

```js
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __test_dirname = dirname(fileURLToPath(import.meta.url));

describe("integration: real data coverage", () => {
  const ENTITIES_ROOT = resolve(__test_dirname, "..", "data", "ground-truth", "entities");
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
    // Work on a deep copy to avoid mutating shared test state
    const copy = JSON.parse(JSON.stringify(weaponEntities));
    const count = enrichGadgetTraits(copy);
    assert.equal(count, 19, `Expected 19 gadget traits enriched, got ${count}`);
  });

  it("enrichNameFamilies matches 10 entities from real data", () => {
    const copy = JSON.parse(JSON.stringify(nameEntities));
    const count = enrichNameFamilies(copy);
    assert.equal(count, 10, `Expected 10 name families enriched, got ${count}`);
  });
});
```

- [ ] **Step 2: Run integration test to verify it passes**

Run: `node --test scripts/enrich-entity-names.test.mjs`
Expected: All tests PASS (36 perks, 19 gadget traits, 10 name families).

- [ ] **Step 3: Register test in npm test suite**

Add `scripts/enrich-entity-names.test.mjs` to the `test` script in `package.json`, appending it to the existing list.

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: All tests pass (existing 791+ plus new enrichment tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/enrich-entity-names.test.mjs package.json
git commit -m "test: add integration tests for entity name enrichment"
```

---

### Task 5: Run enrichment and validate index build

**Files:**
- Modify: `data/ground-truth/entities/shared-weapons.json` (ui_name set on gadget traits)
- Modify: `data/ground-truth/entities/shared-names.json` (ui_name set on name families)
- Modify: `data/ground-truth/aliases/shared-guides.json` (36 new alias records)

This task actually runs the enrichment, rebuilds the index, and validates everything works end-to-end.

- [ ] **Step 1: Run the enrichment script**

Run: `npm run entities:enrich`
Expected output (approximate):
```
Perk aliases: 36 added, 0 updated (36 total)
Gadget traits: 19 ui_name set
Name families: 10 ui_name set
```

- [ ] **Step 2: Verify the data changes look correct**

Run: `git diff --stat`
Expected: 3 files changed — `shared-weapons.json`, `shared-names.json`, `shared-guides.json`.

Run spot-checks:
```bash
node -e "const d=JSON.parse(require('fs').readFileSync('data/ground-truth/entities/shared-weapons.json','utf8')); const g=d.filter(e=>e.kind==='gadget_trait'&&e.ui_name!==null); console.log('Gadget traits with ui_name:', g.length); g.slice(0,3).forEach(e=>console.log(' ',e.internal_name,'=>',e.ui_name));"
```

```bash
node -e "const d=JSON.parse(require('fs').readFileSync('data/ground-truth/entities/shared-names.json','utf8')); const n=d.filter(e=>e.ui_name!==null); console.log('Name families with ui_name:', n.length); n.forEach(e=>console.log(' ',e.id.split('.').pop(),'=>',e.ui_name));"
```

```bash
node -e "const d=JSON.parse(require('fs').readFileSync('data/ground-truth/aliases/shared-guides.json','utf8')); const c=d.filter(a=>a.alias_kind==='community_name'); console.log('community_name aliases:', c.length); c.slice(0,3).forEach(a=>console.log(' ',a.text,'=>',a.candidate_entity_id));"
```

- [ ] **Step 3: Rebuild the ground-truth index**

Run: `npm run index:build`
Expected: Builds cleanly with no collision errors, no warnings about the new aliases.

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 5: Verify idempotency**

Run: `npm run entities:enrich`
Expected output:
```
Perk aliases: 0 added, 36 updated (36 total)
Gadget traits: 0 ui_name set
Name families: 0 ui_name set
```

Run: `git diff`
Expected: No changes (idempotent).

- [ ] **Step 6: Commit enriched data**

```bash
git add data/ground-truth/entities/shared-weapons.json data/ground-truth/entities/shared-names.json data/ground-truth/aliases/shared-guides.json
git commit -m "data: enrich entity names — 36 perk aliases, 19 gadget ui_names, 10 blessing ui_names"
```

- [ ] **Step 7: Run npm run check for full validation**

Run: `npm run check`
Expected: Index builds, all tests pass, index integrity check passes.
