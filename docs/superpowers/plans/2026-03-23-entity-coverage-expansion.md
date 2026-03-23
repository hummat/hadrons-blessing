# Entity Coverage Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate entity records, name_family entities, and edges for all missing weapons, blessings, perks, and gadget traits so that arbitrary GL builds resolve and compute correctly.

**Architecture:** New script `expand-entity-coverage.mjs` reads the Darktide Lua source to discover all definitions, generates entity shells + edges into existing JSON shards, then the existing `effects:build` pipeline fills `calc` tier data. Two-step: expand → enrich.

**Tech Stack:** Node.js (ESM), `node:test` / `node:assert`, existing Lua parsing libs (`lua-data-reader.mjs`), existing validation (`validate.mjs`), existing loading (`load.mjs`).

**Spec:** `docs/superpowers/specs/2026-03-23-entity-coverage-expansion-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `scripts/expand-entity-coverage.mjs` | Main script: inventory, scan, generate, write |
| Create | `scripts/expand-entity-coverage.test.mjs` | Unit tests (inline Lua fixtures) + source-gated integration |
| Modify | `package.json` | Add `entities:expand` npm script |
| Modify | `data/ground-truth/entities/shared-weapons.json` | Append new weapon/trait/perk/gadget_trait entities |
| Modify | `data/ground-truth/entities/shared-names.json` | Append new name_family entities |
| Modify | `data/ground-truth/edges/shared.json` | Append new instance_of + weapon_has_trait_pool edges |

---

### Task 1: Scaffold Script + Pure Parsing Helpers

**Files:**
- Create: `scripts/expand-entity-coverage.mjs`
- Create: `scripts/expand-entity-coverage.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write tests for filename parsing helpers**

`scripts/expand-entity-coverage.test.mjs`:
```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseWeaponFilename,
  parseBespokeFilename,
  extractConceptSuffix,
} from "./expand-entity-coverage.mjs";

describe("parseWeaponFilename", () => {
  it("extracts family, pSeries, mark from standard name", () => {
    const r = parseWeaponFilename("combataxe_p1_m1.lua");
    assert.deepStrictEqual(r, { family: "combataxe", pSeries: "p1", mark: "m1", internalName: "combataxe_p1_m1" });
  });

  it("handles 2h family names", () => {
    const r = parseWeaponFilename("chainsword_2h_p1_m2.lua");
    assert.deepStrictEqual(r, { family: "chainsword_2h", pSeries: "p1", mark: "m2", internalName: "chainsword_2h_p1_m2" });
  });

  it("handles ogryn compound family names", () => {
    const r = parseWeaponFilename("ogryn_powermaul_slabshield_p1_m1.lua");
    assert.deepStrictEqual(r, { family: "ogryn_powermaul_slabshield", pSeries: "p1", mark: "m1", internalName: "ogryn_powermaul_slabshield_p1_m1" });
  });

  it("returns null for non-mark files", () => {
    assert.strictEqual(parseWeaponFilename("weapon_templates.lua"), null);
    assert.strictEqual(parseWeaponFilename("base_template_settings.lua"), null);
  });
});

describe("parseBespokeFilename", () => {
  it("extracts family and pSeries from bespoke filename", () => {
    const r = parseBespokeFilename("weapon_traits_bespoke_combataxe_p1.lua");
    assert.deepStrictEqual(r, { family: "combataxe", pSeries: "p1" });
  });

  it("handles 2h family names", () => {
    const r = parseBespokeFilename("weapon_traits_bespoke_chainsword_2h_p1.lua");
    assert.deepStrictEqual(r, { family: "chainsword_2h", pSeries: "p1" });
  });

  it("handles ogryn compound names", () => {
    const r = parseBespokeFilename("weapon_traits_bespoke_ogryn_heavystubber_p2.lua");
    assert.deepStrictEqual(r, { family: "ogryn_heavystubber", pSeries: "p2" });
  });
});

describe("extractConceptSuffix", () => {
  it("strips weapon_trait_bespoke_{family}_{pSeries}_ prefix", () => {
    const suffix = extractConceptSuffix(
      "weapon_trait_bespoke_combataxe_p1_chained_hits_increases_power",
      "combataxe", "p1"
    );
    assert.strictEqual(suffix, "chained_hits_increases_power");
  });

  it("strips _parent suffix when present", () => {
    const suffix = extractConceptSuffix(
      "weapon_trait_bespoke_dual_shivs_p1_stacking_rending_on_weakspot_parent",
      "dual_shivs", "p1"
    );
    assert.strictEqual(suffix, "stacking_rending_on_weakspot");
  });

  it("handles ogryn compound family", () => {
    const suffix = extractConceptSuffix(
      "weapon_trait_bespoke_ogryn_heavystubber_p2_power_bonus_on_continuous_fire",
      "ogryn_heavystubber", "p2"
    );
    assert.strictEqual(suffix, "power_bonus_on_continuous_fire");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/expand-entity-coverage.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement parsing helpers**

`scripts/expand-entity-coverage.mjs`:
```js
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, basename, relative } from "node:path";
import { validateSourceSnapshot } from "./ground-truth/lib/validate.mjs";
import { ENTITIES_ROOT, EDGES_ROOT, listJsonFiles } from "./ground-truth/lib/load.mjs";
import { runCliMain } from "./ground-truth/lib/cli.mjs";

// --- Filename parsing ---

/**
 * Parse a weapon mark filename like "combataxe_p1_m1.lua".
 * Returns { family, pSeries, mark, internalName } or null.
 */
export function parseWeaponFilename(filename) {
  const base = filename.replace(/\.lua$/, "");
  const match = base.match(/^(.+)_(p\d+)_(m\d+)$/);
  if (!match) return null;
  return { family: match[1], pSeries: match[2], mark: match[3], internalName: base };
}

/**
 * Parse a bespoke trait filename like "weapon_traits_bespoke_combataxe_p1.lua".
 * Returns { family, pSeries } or null.
 */
export function parseBespokeFilename(filename) {
  const base = filename.replace(/\.lua$/, "");
  const match = base.match(/^weapon_traits_bespoke_(.+)_(p\d+)$/);
  if (!match) return null;
  return { family: match[1], pSeries: match[2] };
}

/**
 * Extract the concept suffix from a bespoke trait internal_name.
 * Strips "weapon_trait_bespoke_{family}_{pSeries}_" prefix and trailing "_parent".
 */
export function extractConceptSuffix(internalName, family, pSeries) {
  const prefix = `weapon_trait_bespoke_${family}_${pSeries}_`;
  let suffix = internalName.startsWith(prefix) ? internalName.slice(prefix.length) : internalName;
  if (suffix.endsWith("_parent")) suffix = suffix.slice(0, -7);
  return suffix;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/expand-entity-coverage.test.mjs`
Expected: PASS — all 9 assertions

- [ ] **Step 5: Commit**

```bash
git add scripts/expand-entity-coverage.mjs scripts/expand-entity-coverage.test.mjs
git commit -m "feat(entities:expand): scaffold script with filename parsing helpers"
```

---

### Task 2: Slot Detection + Entity ID Builders

**Files:**
- Modify: `scripts/expand-entity-coverage.mjs`
- Modify: `scripts/expand-entity-coverage.test.mjs`

- [ ] **Step 1: Write tests for slot detection and entity ID generation**

Append to `scripts/expand-entity-coverage.test.mjs`:
```js
import {
  detectSlot,
  weaponEntityId,
  traitEntityId,
  perkEntityId,
  gadgetTraitEntityId,
  nameFamilyEntityId,
} from "./expand-entity-coverage.mjs";

describe("detectSlot", () => {
  it("detects melee from keywords", () => {
    const lua = `weapon_template.keywords = { "melee", "combat_axe", "p1" }`;
    assert.strictEqual(detectSlot(lua), "melee");
  });

  it("detects ranged from keywords", () => {
    const lua = `weapon_template.keywords = { "ranged", "lasgun", "p1" }`;
    assert.strictEqual(detectSlot(lua), "ranged");
  });

  it("falls back to ammo_template", () => {
    const lua = `weapon_template.ammo_template = "lasgun_ammo"`;
    assert.strictEqual(detectSlot(lua), "ranged");
  });

  it("falls back to melee when ammo is no_ammo", () => {
    const lua = `weapon_template.ammo_template = "no_ammo"`;
    assert.strictEqual(detectSlot(lua), "melee");
  });

  it("defaults to melee when no signal found", () => {
    assert.strictEqual(detectSlot(""), "melee");
  });
});

describe("entity ID builders", () => {
  it("builds weapon entity ID", () => {
    assert.strictEqual(weaponEntityId("combataxe_p1_m1"), "shared.weapon.combataxe_p1_m1");
  });

  it("builds trait entity ID", () => {
    assert.strictEqual(
      traitEntityId("weapon_trait_bespoke_combataxe_p1_chained_hits"),
      "shared.weapon_trait.weapon_trait_bespoke_combataxe_p1_chained_hits"
    );
  });

  it("builds perk entity ID with slot", () => {
    assert.strictEqual(
      perkEntityId("weapon_trait_melee_common_wield_increased_armored_damage", "melee"),
      "shared.weapon_perk.melee.weapon_trait_melee_common_wield_increased_armored_damage"
    );
  });

  it("builds gadget_trait entity ID", () => {
    assert.strictEqual(
      gadgetTraitEntityId("gadget_toughness_increase"),
      "shared.gadget_trait.gadget_toughness_increase"
    );
  });

  it("builds name_family entity ID", () => {
    assert.strictEqual(
      nameFamilyEntityId("bloodthirsty"),
      "shared.name_family.blessing.bloodthirsty"
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/expand-entity-coverage.test.mjs`
Expected: FAIL — functions not exported

- [ ] **Step 3: Implement slot detection and ID builders**

Append to `scripts/expand-entity-coverage.mjs`:
```js
// --- Slot detection ---

/**
 * Detect weapon slot (melee/ranged) from weapon template Lua source.
 * Checks keywords first, then ammo_template as fallback.
 */
export function detectSlot(luaSource) {
  if (/keywords\s*=\s*\{[^}]*"ranged"/.test(luaSource)) return "ranged";
  if (/keywords\s*=\s*\{[^}]*"melee"/.test(luaSource)) return "melee";
  const ammoMatch = luaSource.match(/ammo_template\s*=\s*"([^"]+)"/);
  if (ammoMatch) return ammoMatch[1] === "no_ammo" ? "melee" : "ranged";
  return "melee";
}

// --- Entity ID builders ---

export function weaponEntityId(internalName) {
  return `shared.weapon.${internalName}`;
}

export function traitEntityId(internalName) {
  return `shared.weapon_trait.${internalName}`;
}

export function perkEntityId(internalName, slot) {
  return `shared.weapon_perk.${slot}.${internalName}`;
}

export function gadgetTraitEntityId(internalName) {
  return `shared.gadget_trait.${internalName}`;
}

export function nameFamilyEntityId(slug) {
  return `shared.name_family.blessing.${slug}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/expand-entity-coverage.test.mjs`
Expected: PASS — all assertions

- [ ] **Step 5: Commit**

```bash
git add scripts/expand-entity-coverage.mjs scripts/expand-entity-coverage.test.mjs
git commit -m "feat(entities:expand): add slot detection and entity ID builders"
```

---

### Task 3: Entity Record Factories

**Files:**
- Modify: `scripts/expand-entity-coverage.mjs`
- Modify: `scripts/expand-entity-coverage.test.mjs`

- [ ] **Step 1: Write tests for entity record factory functions**

Append to `scripts/expand-entity-coverage.test.mjs`:
```js
import {
  makeWeaponEntity,
  makeTraitEntity,
  makePerkEntity,
  makeGadgetTraitEntity,
  makeNameFamilyEntity,
} from "./expand-entity-coverage.mjs";

const SNAPSHOT_ID = "darktide-source.dbe7035";

describe("makeWeaponEntity", () => {
  it("creates a well-formed weapon entity with family_pSeries in weapon_family", () => {
    const e = makeWeaponEntity("combataxe_p1_m1", "combataxe", "p1", "melee",
      "scripts/settings/equipment/weapon_templates/combat_axes/combataxe_p1_m1.lua", SNAPSHOT_ID);
    assert.strictEqual(e.id, "shared.weapon.combataxe_p1_m1");
    assert.strictEqual(e.kind, "weapon");
    assert.strictEqual(e.domain, "shared");
    assert.strictEqual(e.internal_name, "combataxe_p1_m1");
    assert.strictEqual(e.status, "source_backed");
    assert.deepStrictEqual(e.attributes, { weapon_family: "combataxe_p1", slot: "melee" });
    assert.deepStrictEqual(e.calc, {});
    assert.strictEqual(e.refs[0].line, 1);
    assert.strictEqual(e.source_snapshot_id, SNAPSHOT_ID);
  });
});

describe("makeTraitEntity", () => {
  it("creates a well-formed weapon_trait entity with family_pSeries", () => {
    const e = makeTraitEntity(
      "weapon_trait_bespoke_combataxe_p1_chained_hits_increases_power",
      "combataxe", "p1", "melee",
      "scripts/settings/equipment/weapon_traits/weapon_traits_bespoke_combataxe_p1.lua",
      42, SNAPSHOT_ID
    );
    assert.strictEqual(e.id, "shared.weapon_trait.weapon_trait_bespoke_combataxe_p1_chained_hits_increases_power");
    assert.strictEqual(e.kind, "weapon_trait");
    assert.deepStrictEqual(e.attributes, { weapon_family: "combataxe_p1", slot: "melee" });
    assert.strictEqual(e.refs[0].line, 42);
  });
});

describe("makePerkEntity", () => {
  it("creates a well-formed weapon_perk entity with slot in ID", () => {
    const e = makePerkEntity(
      "weapon_trait_melee_common_wield_increased_armored_damage", "melee",
      "scripts/settings/equipment/weapon_traits/weapon_perks_melee.lua",
      10, SNAPSHOT_ID
    );
    assert.strictEqual(e.id, "shared.weapon_perk.melee.weapon_trait_melee_common_wield_increased_armored_damage");
    assert.strictEqual(e.kind, "weapon_perk");
    assert.deepStrictEqual(e.attributes, { slot: "melee" });
  });
});

describe("makeGadgetTraitEntity", () => {
  it("creates a well-formed gadget_trait entity", () => {
    const e = makeGadgetTraitEntity(
      "gadget_toughness_increase",
      "scripts/settings/equipment/gadget_traits/gadget_traits_common.lua",
      5, SNAPSHOT_ID
    );
    assert.strictEqual(e.id, "shared.gadget_trait.gadget_toughness_increase");
    assert.strictEqual(e.kind, "gadget_trait");
    assert.deepStrictEqual(e.attributes, { slot: "curio" });
  });
});

describe("makeNameFamilyEntity", () => {
  it("creates a partially_resolved name_family entity", () => {
    const e = makeNameFamilyEntity(
      "chained_hits_increases_power",
      "scripts/settings/equipment/weapon_traits/weapon_traits_bespoke_combataxe_p1.lua",
      42, SNAPSHOT_ID
    );
    assert.strictEqual(e.id, "shared.name_family.blessing.chained_hits_increases_power");
    assert.strictEqual(e.kind, "name_family");
    assert.strictEqual(e.status, "partially_resolved");
    assert.strictEqual(e.internal_name, null);
    assert.deepStrictEqual(e.attributes, { family_type: "blessing" });
    assert.strictEqual(e.refs[0].line, 42);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/expand-entity-coverage.test.mjs`
Expected: FAIL — functions not exported

- [ ] **Step 3: Implement entity record factories**

Append to `scripts/expand-entity-coverage.mjs`:
```js
// --- Entity record factories ---

function makeBaseEntity(id, kind, internalName, refPath, refLine, snapshotId, attributes) {
  return {
    id,
    kind,
    domain: "shared",
    internal_name: internalName,
    loc_key: null,
    ui_name: null,
    status: "source_backed",
    refs: [{ path: refPath, line: refLine }],
    source_snapshot_id: snapshotId,
    attributes,
    calc: {},
  };
}

export function makeWeaponEntity(internalName, family, pSeries, slot, refPath, snapshotId) {
  return makeBaseEntity(
    weaponEntityId(internalName), "weapon", internalName,
    refPath, 1, snapshotId, { weapon_family: `${family}_${pSeries}`, slot }
  );
}

export function makeTraitEntity(internalName, family, pSeries, slot, refPath, refLine, snapshotId) {
  return makeBaseEntity(
    traitEntityId(internalName), "weapon_trait", internalName,
    refPath, refLine, snapshotId, { weapon_family: `${family}_${pSeries}`, slot }
  );
}

export function makePerkEntity(internalName, slot, refPath, refLine, snapshotId) {
  return makeBaseEntity(
    perkEntityId(internalName, slot), "weapon_perk", internalName,
    refPath, refLine, snapshotId, { slot }
  );
}

export function makeGadgetTraitEntity(internalName, refPath, refLine, snapshotId) {
  return makeBaseEntity(
    gadgetTraitEntityId(internalName), "gadget_trait", internalName,
    refPath, refLine, snapshotId, { slot: "curio" }
  );
}

export function makeNameFamilyEntity(slug, refPath, refLine, snapshotId) {
  return {
    id: nameFamilyEntityId(slug),
    kind: "name_family",
    domain: "shared",
    internal_name: null,
    loc_key: null,
    ui_name: null,
    status: "partially_resolved",
    refs: [{ path: refPath, line: refLine }],
    source_snapshot_id: snapshotId,
    attributes: { family_type: "blessing" },
    calc: {},
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/expand-entity-coverage.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/expand-entity-coverage.mjs scripts/expand-entity-coverage.test.mjs
git commit -m "feat(entities:expand): add entity and name_family record factories"
```

---

### Task 4: Edge Record Factories

**Files:**
- Modify: `scripts/expand-entity-coverage.mjs`
- Modify: `scripts/expand-entity-coverage.test.mjs`

- [ ] **Step 1: Write tests for edge factories**

Append to `scripts/expand-entity-coverage.test.mjs`:
```js
import {
  makeInstanceOfEdge,
  makeWeaponHasTraitPoolEdge,
} from "./expand-entity-coverage.mjs";

describe("makeInstanceOfEdge", () => {
  it("creates a well-formed instance_of edge", () => {
    const e = makeInstanceOfEdge(
      "shared.weapon_trait.weapon_trait_bespoke_combataxe_p1_chained_hits",
      "shared.name_family.blessing.bloodthirsty",
      "weapon_trait_bespoke_combataxe_p1_chained_hits",
      SNAPSHOT_ID
    );
    assert.strictEqual(e.id, "shared.edge.instance_of.weapon_trait_bespoke_combataxe_p1_chained_hits");
    assert.strictEqual(e.type, "instance_of");
    assert.strictEqual(e.from_entity_id, "shared.weapon_trait.weapon_trait_bespoke_combataxe_p1_chained_hits");
    assert.strictEqual(e.to_entity_id, "shared.name_family.blessing.bloodthirsty");
    assert.deepStrictEqual(e.conditions.predicates, []);
    assert.strictEqual(e.conditions.aggregation, "additive");
    assert.strictEqual(e.conditions.stacking_mode, "binary");
    assert.deepStrictEqual(e.calc, {});
    assert.deepStrictEqual(e.evidence_ids, []);
  });
});

describe("makeWeaponHasTraitPoolEdge", () => {
  it("creates a well-formed weapon_has_trait_pool edge", () => {
    const e = makeWeaponHasTraitPoolEdge(
      "shared.weapon.combataxe_p1_m1",
      "shared.weapon_trait.weapon_trait_bespoke_combataxe_p1_chained_hits",
      "combataxe_p1_m1",
      "weapon_trait_bespoke_combataxe_p1_chained_hits",
      SNAPSHOT_ID
    );
    assert.strictEqual(e.id, "shared.edge.weapon_has_trait_pool.combataxe_p1_m1.weapon_trait_bespoke_combataxe_p1_chained_hits");
    assert.strictEqual(e.type, "weapon_has_trait_pool");
    assert.strictEqual(e.from_entity_id, "shared.weapon.combataxe_p1_m1");
    assert.strictEqual(e.to_entity_id, "shared.weapon_trait.weapon_trait_bespoke_combataxe_p1_chained_hits");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/expand-entity-coverage.test.mjs`
Expected: FAIL — functions not exported

- [ ] **Step 3: Implement edge factories**

Append to `scripts/expand-entity-coverage.mjs`:
```js
// --- Edge record factories ---

function makeBaseEdge(id, type, fromEntityId, toEntityId, snapshotId) {
  return {
    id,
    type,
    from_entity_id: fromEntityId,
    to_entity_id: toEntityId,
    source_snapshot_id: snapshotId,
    conditions: {
      predicates: [],
      aggregation: "additive",
      stacking_mode: "binary",
      exclusive_scope: null,
    },
    calc: {},
    evidence_ids: [],
  };
}

export function makeInstanceOfEdge(traitEntityId, familyEntityId, traitInternalName, snapshotId) {
  return makeBaseEdge(
    `shared.edge.instance_of.${traitInternalName}`,
    "instance_of", traitEntityId, familyEntityId, snapshotId
  );
}

export function makeWeaponHasTraitPoolEdge(weaponEntityId, traitEntityId, weaponInternalName, traitInternalName, snapshotId) {
  return makeBaseEdge(
    `shared.edge.weapon_has_trait_pool.${weaponInternalName}.${traitInternalName}`,
    "weapon_has_trait_pool", weaponEntityId, traitEntityId, snapshotId
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/expand-entity-coverage.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/expand-entity-coverage.mjs scripts/expand-entity-coverage.test.mjs
git commit -m "feat(entities:expand): add instance_of and weapon_has_trait_pool edge factories"
```

---

### Task 5: Concept-Suffix Map Builder

**Files:**
- Modify: `scripts/expand-entity-coverage.mjs`
- Modify: `scripts/expand-entity-coverage.test.mjs`

- [ ] **Step 1: Write tests for concept map building**

Append to `scripts/expand-entity-coverage.test.mjs`:
```js
import { buildConceptFamilyMap } from "./expand-entity-coverage.mjs";

describe("buildConceptFamilyMap", () => {
  const entities = new Map([
    ["shared.weapon_trait.weapon_trait_bespoke_chainsword_2h_p1_guaranteed_melee_crit_on_activated_kill", {
      id: "shared.weapon_trait.weapon_trait_bespoke_chainsword_2h_p1_guaranteed_melee_crit_on_activated_kill",
      internal_name: "weapon_trait_bespoke_chainsword_2h_p1_guaranteed_melee_crit_on_activated_kill",
      kind: "weapon_trait",
      attributes: { weapon_family: "chainsword_2h", slot: "melee" },
    }],
    ["shared.weapon_trait.weapon_trait_bespoke_bolter_p1_power_bonus_on_continuous_fire", {
      id: "shared.weapon_trait.weapon_trait_bespoke_bolter_p1_power_bonus_on_continuous_fire",
      internal_name: "weapon_trait_bespoke_bolter_p1_power_bonus_on_continuous_fire",
      kind: "weapon_trait",
      attributes: { weapon_family: "bolter", slot: "ranged" },
    }],
  ]);

  const edges = [
    {
      type: "instance_of",
      from_entity_id: "shared.weapon_trait.weapon_trait_bespoke_chainsword_2h_p1_guaranteed_melee_crit_on_activated_kill",
      to_entity_id: "shared.name_family.blessing.bloodthirsty",
    },
    {
      type: "instance_of",
      from_entity_id: "shared.weapon_trait.weapon_trait_bespoke_bolter_p1_power_bonus_on_continuous_fire",
      to_entity_id: "shared.name_family.blessing.blaze_away",
    },
    { type: "weapon_has_trait_pool", from_entity_id: "x", to_entity_id: "y" },
  ];

  it("builds concept suffix → name_family slug map", () => {
    const map = buildConceptFamilyMap(edges, entities);
    assert.strictEqual(map.get("guaranteed_melee_crit_on_activated_kill"), "bloodthirsty");
    assert.strictEqual(map.get("power_bonus_on_continuous_fire"), "blaze_away");
  });

  it("ignores non-instance_of edges", () => {
    const map = buildConceptFamilyMap(edges, entities);
    assert.strictEqual(map.size, 2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/expand-entity-coverage.test.mjs`
Expected: FAIL

- [ ] **Step 3: Implement concept map builder**

Append to `scripts/expand-entity-coverage.mjs`:
```js
// --- Concept-suffix → name_family map ---

/**
 * Build a Map<conceptSuffix, familySlug> from existing instance_of edges.
 * @param {Array} edges - All edge records from shared.json
 * @param {Map} entityMap - Map<entityId, entity>
 */
export function buildConceptFamilyMap(edges, entityMap) {
  const map = new Map();
  for (const edge of edges) {
    if (edge.type !== "instance_of") continue;
    const fromEntity = entityMap.get(edge.from_entity_id);
    if (!fromEntity || fromEntity.kind !== "weapon_trait") continue;

    const family = fromEntity.attributes.weapon_family;
    // Derive pSeries from the internal_name: weapon_trait_bespoke_{family}_{pSeries}_...
    const afterBespoke = fromEntity.internal_name.slice(`weapon_trait_bespoke_${family}_`.length);
    const pMatch = afterBespoke.match(/^(p\d+)_/);
    if (!pMatch) continue;
    const pSeries = pMatch[1];

    const suffix = extractConceptSuffix(fromEntity.internal_name, family, pSeries);
    // Extract family slug from to_entity_id: "shared.name_family.blessing.<slug>"
    const familySlug = edge.to_entity_id.split(".").pop();
    map.set(suffix, familySlug);
  }
  return map;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/expand-entity-coverage.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/expand-entity-coverage.mjs scripts/expand-entity-coverage.test.mjs
git commit -m "feat(entities:expand): add concept-suffix to name_family map builder"
```

---

### Task 6: Source Scanners (Weapons, Traits, Perks, Gadgets)

**Files:**
- Modify: `scripts/expand-entity-coverage.mjs`
- Modify: `scripts/expand-entity-coverage.test.mjs`

- [ ] **Step 1: Write source-gated integration tests for scanners**

These tests require the Darktide source and are skipped when unavailable. Append to `scripts/expand-entity-coverage.test.mjs`:
```js
import { existsSync } from "node:fs";

const sourceRoot = (() => {
  try { return readFileSync(".source-root", "utf8").trim(); }
  catch { return null; }
})();
const skipNoSource = { skip: !sourceRoot };

describe("scanWeaponMarks (source-gated)", skipNoSource, () => {
  it("discovers all weapon marks from Lua source", () => {
    const results = scanWeaponMarks(sourceRoot);
    // Issue #14 says 122 mark files
    assert.ok(results.length >= 100, `Expected >=100 marks, got ${results.length}`);
    // Each result has required fields
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
    // Should be hundreds of traits across 59 files
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
```

Add the import at top of test file:
```js
import { readFileSync } from "node:fs";
import {
  scanWeaponMarks,
  scanBespokeTraits,
  scanPerks,
  scanGadgetTraits,
} from "./expand-entity-coverage.mjs";
```

- [ ] **Step 2: Run tests to verify they fail (or skip if no source)**

Run: `node --test scripts/expand-entity-coverage.test.mjs`
Expected: FAIL (functions not exported) or SKIP (no source root)

- [ ] **Step 3: Implement weapon mark scanner**

Append to `scripts/expand-entity-coverage.mjs`:
```js
// --- Source scanners ---

const WEAPON_TEMPLATES_DIR = "scripts/settings/equipment/weapon_templates";
const BESPOKE_TRAITS_DIR = "scripts/settings/equipment/weapon_traits";
const GADGET_TRAITS_FILE = "scripts/settings/equipment/gadget_traits/gadget_traits_common.lua";

/**
 * Scan all weapon mark Lua files. Returns array of
 * { internalName, family, pSeries, mark, slot, refPath }.
 */
export function scanWeaponMarks(sourceRoot) {
  const results = [];
  const templatesDir = join(sourceRoot, WEAPON_TEMPLATES_DIR);
  const familyDirs = readdirSync(templatesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const dirName of familyDirs) {
    const dirPath = join(templatesDir, dirName);
    const files = readdirSync(dirPath).filter(f => f.endsWith(".lua")).sort();
    for (const file of files) {
      const parsed = parseWeaponFilename(file);
      if (!parsed) continue;
      const fullPath = join(dirPath, file);
      const luaSource = readFileSync(fullPath, "utf8");
      const slot = detectSlot(luaSource);
      const refPath = join(WEAPON_TEMPLATES_DIR, dirName, file);
      results.push({ ...parsed, slot, refPath });
    }
  }
  return results;
}
```

- [ ] **Step 4: Implement bespoke trait scanner**

Append to `scripts/expand-entity-coverage.mjs`:
```js
/**
 * Scan all bespoke trait files. Returns array of
 * { internalName, family, pSeries, slot, refPath, refLine }.
 * Slot is determined by checking if any weapon mark in the same family is ranged.
 */
export function scanBespokeTraits(sourceRoot, weaponMarks) {
  const results = [];
  const traitsDir = join(sourceRoot, BESPOKE_TRAITS_DIR);
  const bespokeFiles = readdirSync(traitsDir)
    .filter(f => f.startsWith("weapon_traits_bespoke_") && f.endsWith(".lua"))
    .sort();

  // Build weapon slot lookup: family_pSeries → slot
  const familySlotMap = new Map();
  if (weaponMarks) {
    for (const w of weaponMarks) {
      familySlotMap.set(`${w.family}_${w.pSeries}`, w.slot);
    }
  }

  for (const file of bespokeFiles) {
    const parsed = parseBespokeFilename(file);
    if (!parsed) continue;
    const { family, pSeries } = parsed;
    const slot = familySlotMap.get(`${family}_${pSeries}`) || "melee";
    const fullPath = join(traitsDir, file);
    const luaSource = readFileSync(fullPath, "utf8");
    const refPath = join(BESPOKE_TRAITS_DIR, file);

    // Extract template keys and their line numbers
    const lines = luaSource.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^\s*(?:templates|[\w]+)\.(weapon_trait_bespoke_\w+)\s*=/);
      if (match) {
        results.push({
          internalName: match[1],
          family, pSeries, slot,
          refPath, refLine: i + 1,
        });
      }
    }
  }
  return results;
}
```

- [ ] **Step 5: Implement perk and gadget trait scanners**

Append to `scripts/expand-entity-coverage.mjs`:
```js
/**
 * Scan weapon perk files. Returns array of
 * { internalName, slot, refPath, refLine }.
 * Perk names vary: weapon_trait_melee_common_*, weapon_trait_increase_*,
 * weapon_trait_reduced_*, weapon_trait_ranged_*, etc. We match any
 * assignment to the table variable, relying on file-level slot distinction.
 */
export function scanPerks(sourceRoot) {
  const results = [];
  const perkFiles = [
    { file: "weapon_perks_melee.lua", slot: "melee" },
    { file: "weapon_perks_ranged.lua", slot: "ranged" },
  ];
  for (const { file, slot } of perkFiles) {
    const fullPath = join(sourceRoot, BESPOKE_TRAITS_DIR, file);
    const luaSource = readFileSync(fullPath, "utf8");
    const refPath = join(BESPOKE_TRAITS_DIR, file);
    const lines = luaSource.split("\n");
    for (let i = 0; i < lines.length; i++) {
      // Match any "tableVar.perk_name = {" assignment with format_values or buffs
      const match = lines[i].match(/^\s*[\w]+\.(weapon_trait_\w+)\s*=\s*\{/);
      if (match) {
        results.push({ internalName: match[1], slot, refPath, refLine: i + 1 });
      }
    }
  }
  return results;
}

/**
 * Scan gadget trait file. Returns array of
 * { internalName, refPath, refLine }.
 */
export function scanGadgetTraits(sourceRoot) {
  const results = [];
  const fullPath = join(sourceRoot, GADGET_TRAITS_FILE);
  const luaSource = readFileSync(fullPath, "utf8");
  const refPath = GADGET_TRAITS_FILE;
  const lines = luaSource.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s*[\w]+\.(gadget_\w+)\s*=/);
    if (match) {
      results.push({ internalName: match[1], refPath, refLine: i + 1 });
    }
  }
  return results;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test scripts/expand-entity-coverage.test.mjs`
Expected: PASS (source-gated tests pass if source available, skip otherwise)

- [ ] **Step 7: Commit**

```bash
git add scripts/expand-entity-coverage.mjs scripts/expand-entity-coverage.test.mjs
git commit -m "feat(entities:expand): add source scanners for weapons, traits, perks, gadgets"
```

---

### Task 7: Main Orchestrator — Inventory + Generation + Write-back

**Files:**
- Modify: `scripts/expand-entity-coverage.mjs`
- Modify: `package.json`

- [ ] **Step 1: Implement the main orchestrator function**

Append to `scripts/expand-entity-coverage.mjs`:
```js
// --- Main orchestrator ---

const SHARED_WEAPONS_FILE = join(ENTITIES_ROOT, "shared-weapons.json");
const SHARED_NAMES_FILE = join(ENTITIES_ROOT, "shared-names.json");
const SHARED_EDGES_FILE = join(EDGES_ROOT, "shared.json");

export async function expandEntityCoverage() {
  // --- Phase 1: Inventory ---
  const snapshot = validateSourceSnapshot();
  const sourceRoot = snapshot.source_root;
  const snapshotId = snapshot.id;

  // Load existing entities
  const existingEntities = new Map();
  for (const filePath of listJsonFiles(ENTITIES_ROOT)) {
    const records = JSON.parse(readFileSync(filePath, "utf8"));
    for (const r of records) existingEntities.set(r.id, r);
  }

  // Load existing edges
  const existingEdges = JSON.parse(readFileSync(SHARED_EDGES_FILE, "utf8"));
  const existingEdgeIds = new Set(existingEdges.map(e => e.id));

  // Build concept → family map
  const conceptFamilyMap = buildConceptFamilyMap(existingEdges, existingEntities);
  console.log(`  Concept→family map: ${conceptFamilyMap.size} known mappings`);

  // --- Source scanning ---
  const weaponMarks = scanWeaponMarks(sourceRoot);
  const bespokeTraits = scanBespokeTraits(sourceRoot, weaponMarks);
  const perks = scanPerks(sourceRoot);
  const gadgetTraits = scanGadgetTraits(sourceRoot);
  console.log(`  Source scan: ${weaponMarks.length} weapons, ${bespokeTraits.length} traits, ${perks.length} perks, ${gadgetTraits.length} gadget traits`);

  // --- Phase 2: Generate entity shells ---
  const newWeaponEntities = [];
  const newTraitEntities = [];
  const newPerkEntities = [];
  const newGadgetEntities = [];

  for (const w of weaponMarks) {
    const id = weaponEntityId(w.internalName);
    if (existingEntities.has(id)) continue;
    const entity = makeWeaponEntity(w.internalName, w.family, w.pSeries, w.slot, w.refPath, snapshotId);
    newWeaponEntities.push(entity);
    existingEntities.set(id, entity);
  }

  for (const t of bespokeTraits) {
    const id = traitEntityId(t.internalName);
    // Dedup: also check for _parent variant
    const parentId = traitEntityId(t.internalName + "_parent");
    if (existingEntities.has(id) || existingEntities.has(parentId)) continue;
    const entity = makeTraitEntity(t.internalName, t.family, t.pSeries, t.slot, t.refPath, t.refLine, snapshotId);
    newTraitEntities.push(entity);
    existingEntities.set(id, entity);
  }

  for (const p of perks) {
    const id = perkEntityId(p.internalName, p.slot);
    if (existingEntities.has(id)) continue;
    const entity = makePerkEntity(p.internalName, p.slot, p.refPath, p.refLine, snapshotId);
    newPerkEntities.push(entity);
    existingEntities.set(id, entity);
  }

  for (const g of gadgetTraits) {
    const id = gadgetTraitEntityId(g.internalName);
    if (existingEntities.has(id)) continue;
    const entity = makeGadgetTraitEntity(g.internalName, g.refPath, g.refLine, snapshotId);
    newGadgetEntities.push(entity);
    existingEntities.set(id, entity);
  }

  // --- Phase 3: Generate name_family entities ---
  const newNameFamilies = [];
  const unmappedSuffixes = [];

  // Build bespoke trait grouping: family_pSeries → [trait, ...]
  const bespokeByFamilyP = new Map();
  for (const t of bespokeTraits) {
    const key = `${t.family}_${t.pSeries}`;
    if (!bespokeByFamilyP.has(key)) bespokeByFamilyP.set(key, []);
    bespokeByFamilyP.get(key).push(t);
  }

  for (const t of bespokeTraits) {
    const suffix = extractConceptSuffix(t.internalName, t.family, t.pSeries);
    if (conceptFamilyMap.has(suffix)) continue;
    // Check if name_family already exists with this suffix as slug
    if (existingEntities.has(nameFamilyEntityId(suffix))) {
      conceptFamilyMap.set(suffix, suffix);
      continue;
    }
    // Create new name_family with concept suffix as temporary slug
    const entity = makeNameFamilyEntity(suffix, t.refPath, t.refLine, snapshotId);
    newNameFamilies.push(entity);
    existingEntities.set(entity.id, entity);
    conceptFamilyMap.set(suffix, suffix);
    unmappedSuffixes.push(suffix);
  }

  // --- Phase 4: Generate edges ---
  const newEdges = [];

  // weapon_has_trait_pool: each weapon → all traits in its bespoke file
  for (const w of weaponMarks) {
    const wId = weaponEntityId(w.internalName);
    if (!existingEntities.has(wId)) continue;
    const key = `${w.family}_${w.pSeries}`;
    const traits = bespokeByFamilyP.get(key) || [];
    for (const t of traits) {
      // Resolve trait entity ID (check _parent variant too)
      let tId = traitEntityId(t.internalName);
      if (!existingEntities.has(tId)) {
        const parentId = traitEntityId(t.internalName + "_parent");
        if (existingEntities.has(parentId)) tId = parentId;
        else continue;
      }
      const tInternalName = existingEntities.get(tId).internal_name;
      const edgeId = `shared.edge.weapon_has_trait_pool.${w.internalName}.${tInternalName}`;
      if (existingEdgeIds.has(edgeId)) continue;
      const edge = makeWeaponHasTraitPoolEdge(wId, tId, w.internalName, tInternalName, snapshotId);
      newEdges.push(edge);
      existingEdgeIds.add(edgeId);
    }
  }

  // instance_of: each trait → its name_family
  for (const t of bespokeTraits) {
    let tId = traitEntityId(t.internalName);
    if (!existingEntities.has(tId)) {
      const parentId = traitEntityId(t.internalName + "_parent");
      if (existingEntities.has(parentId)) tId = parentId;
      else continue;
    }
    const tInternalName = existingEntities.get(tId).internal_name;
    const edgeId = `shared.edge.instance_of.${tInternalName}`;
    if (existingEdgeIds.has(edgeId)) continue;

    const suffix = extractConceptSuffix(t.internalName, t.family, t.pSeries);
    const familySlug = conceptFamilyMap.get(suffix);
    if (!familySlug) continue;
    const familyId = nameFamilyEntityId(familySlug);
    if (!existingEntities.has(familyId)) continue;

    const edge = makeInstanceOfEdge(tId, familyId, tInternalName, snapshotId);
    newEdges.push(edge);
    existingEdgeIds.add(edgeId);
  }

  // --- Write-back ---
  const allNewEntities = [...newWeaponEntities, ...newTraitEntities, ...newPerkEntities, ...newGadgetEntities];
  if (allNewEntities.length > 0) {
    const weapons = JSON.parse(readFileSync(SHARED_WEAPONS_FILE, "utf8"));
    weapons.push(...allNewEntities);
    writeFileSync(SHARED_WEAPONS_FILE, JSON.stringify(weapons, null, 2) + "\n");
  }

  if (newNameFamilies.length > 0) {
    const names = JSON.parse(readFileSync(SHARED_NAMES_FILE, "utf8"));
    names.push(...newNameFamilies);
    writeFileSync(SHARED_NAMES_FILE, JSON.stringify(names, null, 2) + "\n");
  }

  if (newEdges.length > 0) {
    existingEdges.push(...newEdges);
    writeFileSync(SHARED_EDGES_FILE, JSON.stringify(existingEdges, null, 2) + "\n");
  }

  // --- Phase 5: Report ---
  console.log("\n=== Entity Coverage Expansion Report ===\n");
  console.log(`Entities generated:`);
  console.log(`  weapon:       ${newWeaponEntities.length}`);
  console.log(`  weapon_trait:  ${newTraitEntities.length}`);
  console.log(`  weapon_perk:   ${newPerkEntities.length}`);
  console.log(`  gadget_trait:  ${newGadgetEntities.length}`);
  console.log(`  name_family:   ${newNameFamilies.length}`);
  console.log(`\nEdges generated:`);
  const wtpEdges = newEdges.filter(e => e.type === "weapon_has_trait_pool");
  const ioEdges = newEdges.filter(e => e.type === "instance_of");
  console.log(`  weapon_has_trait_pool: ${wtpEdges.length}`);
  console.log(`  instance_of:          ${ioEdges.length}`);

  if (unmappedSuffixes.length > 0) {
    console.log(`\nUnmapped concept suffixes (need manual name_family assignment):`);
    for (const s of unmappedSuffixes.sort()) console.log(`  - ${s}`);
  }

  // Bespoke files with no matching weapon marks
  const orphanBespoke = [];
  for (const file of readdirSync(join(sourceRoot, BESPOKE_TRAITS_DIR)).filter(f => f.startsWith("weapon_traits_bespoke_")).sort()) {
    const parsed = parseBespokeFilename(file);
    if (!parsed) continue;
    const key = `${parsed.family}_${parsed.pSeries}`;
    const hasWeapon = weaponMarks.some(w => w.family === parsed.family && w.pSeries === parsed.pSeries);
    if (!hasWeapon) orphanBespoke.push(file);
  }
  if (orphanBespoke.length > 0) {
    console.log(`\nBespoke files with no weapon marks (orphan p-series):`);
    for (const f of orphanBespoke) console.log(`  - ${f}`);
  }

  // Damage profile gap: weapons with entities but no profiles
  const PROFILES_FILE = join(ENTITIES_ROOT, "..", "generated", "damage-profiles.json");
  try {
    const profiles = JSON.parse(readFileSync(PROFILES_FILE, "utf8"));
    const profileWeapons = new Set(profiles.map(p => p.source_file).filter(Boolean));
    const missingProfiles = weaponMarks
      .filter(w => !profileWeapons.has(w.internalName) && existingEntities.has(weaponEntityId(w.internalName)))
      .map(w => w.internalName);
    if (missingProfiles.length > 0) {
      console.log(`\nWeapons with no damage profiles (profile gap):`);
      for (const w of missingProfiles.sort()) console.log(`  - ${w}`);
    }
  } catch { /* profiles file may not exist */ }

  const totalEntities = existingEntities.size;
  const totalEdges = existingEdges.length;
  console.log(`\nTotals: ${totalEntities} entities, ${totalEdges} edges`);

  return {
    newWeaponEntities, newTraitEntities, newPerkEntities, newGadgetEntities,
    newNameFamilies, newEdges, unmappedSuffixes, orphanBespoke,
  };
}
```

- [ ] **Step 2: Add CLI entry point at bottom of file**

Append to `scripts/expand-entity-coverage.mjs`:
```js
// --- CLI ---
runCliMain("entities:expand", async () => {
  await expandEntityCoverage();
});
```

- [ ] **Step 3: Add npm script to package.json**

Add to `"scripts"` in `package.json`:
```json
"entities:expand": "node scripts/expand-entity-coverage.mjs"
```

- [ ] **Step 4: Commit**

```bash
git add scripts/expand-entity-coverage.mjs package.json
git commit -m "feat(entities:expand): implement main orchestrator with inventory, generation, and write-back"
```

---

### Task 8: Integration Test — Full Expansion Pipeline

**Files:**
- Modify: `scripts/expand-entity-coverage.test.mjs`

- [ ] **Step 1: Write source-gated integration test**

Append to `scripts/expand-entity-coverage.test.mjs`:
```js
import { spawnSync } from "node:child_process";

describe("entities:expand integration (source-gated)", skipNoSource, () => {
  it("runs without error and generates entities", () => {
    // Run in dry-run mode on a copy — but since this is a test,
    // we just verify the script exits cleanly by importing and calling
    const result = spawnSync("node", ["scripts/expand-entity-coverage.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.strictEqual(result.status, 0, `Script failed: ${result.stderr}`);
    assert.ok(result.stdout.includes("Entity Coverage Expansion Report"), "Missing report output");
    assert.ok(result.stdout.includes("Entities generated:"), "Missing entity counts");
  });
});
```

Note: This test modifies the actual JSON shards. It should be run once to generate the data, then the data is committed. Subsequent runs are idempotent (0 new entities/edges).

- [ ] **Step 2: Run the expansion script**

Run: `npm run entities:expand`
Expected: Report showing new entities and edges generated. Review output for warnings.

- [ ] **Step 3: Run effects:build to fill calc data**

Run: `npm run effects:build`
Expected: Script enriches new weapon_trait/weapon_perk/gadget_trait entities with `calc.tiers` / `calc.effects`.

- [ ] **Step 4: Run index:build to validate referential integrity**

Run: `npm run index:build`
Expected: PASS — no schema violations, no dangling references, no alias collisions.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: All tests pass. If snapshot tests fail, review diffs and update snapshots.

- [ ] **Step 6: Verify idempotency**

Run: `npm run entities:expand` (second time)
Expected: Report shows 0 new entities, 0 new edges.

- [ ] **Step 7: Commit all generated data**

```bash
git add data/ground-truth/entities/shared-weapons.json \
        data/ground-truth/entities/shared-names.json \
        data/ground-truth/edges/shared.json \
        generated/
git commit -m "data: expand entity coverage — weapons, traits, perks, gadget traits, edges"
```

---

### Task 9: Snapshot Freeze + Test Registration

**Files:**
- Modify: `package.json` (add test file to test script)
- Possibly update snapshot golden files

- [ ] **Step 1: Add test file to the npm test script**

In `package.json`, append `scripts/expand-entity-coverage.test.mjs` to the `test` script's file list.

- [ ] **Step 2: Run full check to verify everything**

Run: `npm run check`
Expected: PASS — `index:build` succeeds, all tests pass, `index:check` confirms generated index matches.

- [ ] **Step 3: Review the expansion report for action items**

Check the report output for:
- Unmapped concept suffixes → create a follow-up issue or note in #14 for manual name_family assignment
- Orphan bespoke files → document as known (e.g., `ogryn_thumper_p2`)
- Weapons with no damage profiles → document for Phase 4 follow-up

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: register expand-entity-coverage test in npm test suite"
```

---

### Task 10: Update Issue and Docs

**Files:**
- Modify: `HANDOFF.md`
- Comment on GitHub issue #14

- [ ] **Step 1: Update HANDOFF.md with current state**

Update `HANDOFF.md` to reflect:
- Phases 1-2 of #14 complete (entity expansion + calc enrichment)
- Phase 3 (alias curation) remains — list unmapped suffixes and weapon alias needs
- Phase 4 (profile gap) remains — list affected weapons
- Link to the expansion report output

- [ ] **Step 2: Comment on issue #14 with progress**

```bash
gh issue comment 14 --body "Phases 1-2 complete: entity shells + edges generated, calc data enriched via effects:build. Remaining: Phase 3 (alias curation) and Phase 4 (profile extraction gap)."
```

- [ ] **Step 3: Commit docs update**

```bash
git add HANDOFF.md
git commit -m "docs: update handoff with entity coverage expansion progress"
```
