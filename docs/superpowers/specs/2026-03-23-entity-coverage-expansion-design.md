# Entity Coverage Expansion Design

**Issue:** #14 — Full entity coverage for website readiness
**Date:** 2026-03-23

## Problem

The entity index covers 94% of selections in the 23 curated builds but drops significantly for arbitrary user builds. 73 of 111 weapon marks with damage profiles have no entity, ~557 blessings lack entity records, 21 weapon perks and 10 gadget traits are missing. Calculators silently skip unresolved items, producing incomplete results invisible to the user.

## Approach: Two-Step Pipeline

1. **New script** (`expand-entity-coverage.mjs`) generates entity shells, name_family entities, and edges by reading the Darktide source.
2. **Existing pipeline** (`npm run effects:build` / `extract-buff-effects.mjs`) fills `calc` tier data on all new entities by matching `internal_name` against Lua buff templates.

This reuses the existing extraction infrastructure. `extract-buff-effects.mjs` already iterates all entities in the JSON shards and enriches any entity whose `internal_name` matches a resolved buff template — no changes needed.

## Script: `expand-entity-coverage.mjs`

Entry point: `npm run entities:expand`. Reads the Darktide source (path from `.source-root`), existing entity/edge/name_family shards, and the source snapshot manifest.

### Internal Phases

#### Phase 1 — Inventory

Load existing state:
- All entities from `data/ground-truth/entities/*.json` → `existingEntities` map (keyed by `id`)
- All edges from `data/ground-truth/edges/shared.json` → `existingEdges`
- Name_family entities from `shared-names.json` → `existingFamilies`
- Source snapshot ID from `data/ground-truth/source-snapshots/manifest.json`

Build the **concept-suffix → name_family** lookup from existing `instance_of` edges:
- For each `instance_of` edge, extract the concept suffix from the `from_entity_id`'s `internal_name` by stripping the `weapon_trait_bespoke_{family}_{p-series}_` prefix.
- Map that suffix to the `to_entity_id`'s name_family slug.
- Example: `weapon_trait_bespoke_chainsword_2h_p1_guaranteed_melee_crit_on_activated_kill` → suffix `guaranteed_melee_crit_on_activated_kill` → family `bloodthirsty`.

Scan Darktide source to discover the full universe:
- Weapon marks: glob `scripts/settings/equipment/weapon_templates/**/*_m[0-9]*.lua` (122 files)
- Bespoke traits: glob `scripts/settings/equipment/weapon_traits/weapon_traits_bespoke_*.lua` (59 files), extract all template keys per file
- Weapon perks: read `weapon_perks_melee.lua` (19) + `weapon_perks_ranged.lua` (17)
- Gadget traits: read `gadget_traits_common.lua` (24)

#### Phase 2 — Generate Entity Shells

For each source definition not already in `existingEntities`, create an entity record:

```json
{
  "id": "<see ID rules below>",
  "kind": "<weapon|weapon_trait|weapon_perk|gadget_trait>",
  "domain": "shared",
  "internal_name": "<internal_name>",
  "loc_key": null,
  "ui_name": null,
  "status": "source_backed",
  "refs": [{ "path": "<relative-lua-path>", "line": <1-indexed> }],
  "source_snapshot_id": "<from manifest>",
  "attributes": { ... },
  "calc": {}
}
```

Attribute rules:
- **weapon**: `{ "weapon_family": "<family>", "slot": "<melee|ranged>" }`. Family extracted from the **weapon template filename** by stripping `_p\d+_m\d+$` (e.g., `combataxe_p1_m1.lua` → `combataxe`). Note: some existing entities include the p-series in `weapon_family` (e.g., `forcestaff_p3`, `lasgun_p2`) while others don't (e.g., `bolter`, `ogryn_powermaul`). New entities should follow the existing convention: include p-series in `weapon_family` only when multiple p-series exist for the same base family with different slot types or fundamentally different weapon behavior. Slot determined by checking for `ammo_template` (ranged) vs `"no_ammo"` (melee) — or by the presence of `weapon_template.keywords` containing `"melee"` or `"ranged"`.
- **weapon_trait**: `{ "weapon_family": "<family>", "slot": "<melee|ranged>" }`. Family and slot inherited from the bespoke file's weapon family association.
- **weapon_perk**: `{ "slot": "<melee|ranged>" }`. Slot from filename (`weapon_perks_melee.lua` vs `weapon_perks_ranged.lua`).
- **gadget_trait**: `{ "slot": "curio" }`.

**Entity ID rules:**
- **weapon**: `shared.weapon.<internal_name>` (e.g., `shared.weapon.combataxe_p1_m1`)
- **weapon_trait**: `shared.weapon_trait.<internal_name>` (e.g., `shared.weapon_trait.weapon_trait_bespoke_combataxe_p1_chained_hits_increases_power`)
- **weapon_perk**: `shared.weapon_perk.<slot>.<internal_name>` (e.g., `shared.weapon_perk.melee.weapon_trait_melee_common_wield_increased_armored_damage`) — note the `<slot>` segment, matching existing convention
- **gadget_trait**: `shared.gadget_trait.<internal_name>` (e.g., `shared.gadget_trait.gadget_toughness_increase`)

**`_parent` suffix handling for weapon_traits:**
Some existing weapon_trait entities use a `_parent` suffix (e.g., `weapon_trait_bespoke_dual_shivs_p1_stacking_rending_on_weakspot_parent`). This occurs when the bespoke Lua definition has multiple buff entries (parent + child) and `extract-buff-effects.mjs` resolves the trait's calc data via the parent buff template. The expansion script must:
1. Extract top-level template keys from bespoke files (these are the canonical trait names, without `_parent`).
2. During dedup, check for existing entities both with and without `_parent` suffix.
3. New entities use the **top-level template key** (no `_parent`). The `_parent` suffix is an artifact of how `effects:build` names buff sub-entries, not the canonical trait identity.
4. If an existing entity uses `_parent`, do NOT create a duplicate without it — treat it as already covered.

**Refs population:**
- **weapon**: `refs: [{ path: "<relative-lua-path>", line: 1 }]` (file start, matching existing convention)
- **weapon_trait**: `refs: [{ path: "<relative-bespoke-lua-path>", line: <line of templates.NAME = {> }]`
- **weapon_perk**: `refs: [{ path: "<relative-perk-lua-path>", line: <line of NAME = {> }]`
- **gadget_trait**: `refs: [{ path: "<relative-gadget-lua-path>", line: <line of NAME = {> }]`

Append new entities to `shared-weapons.json`.

#### Phase 3 — Generate Name_Family Entities

For each concept suffix found in new weapon_traits that is NOT in the existing concept→family map:
1. Create a new `name_family` entity with a temporary slug derived from the concept suffix.
2. `status: "partially_resolved"`, `internal_name: null`, `loc_key: null`, `ui_name: null`.
3. `attributes: { "family_type": "blessing" }`.
4. `refs`: point to the bespoke file where the concept suffix was first encountered.
5. Append to `shared-names.json`.

These temporary-slug families need manual community-name assignment later. The script outputs a report listing them.

#### Phase 4 — Generate Edges

**`weapon_has_trait_pool`** edges:
- Each bespoke file `weapon_traits_bespoke_{family}_{p-series}.lua` defines traits for all marks in that p-series.
- For every weapon entity `shared.weapon.{family}_{p-series}_m{N}`, create an edge to every `weapon_trait` entity defined in the corresponding bespoke file.
- Edge ID: `shared.edge.weapon_has_trait_pool.{weapon_internal_name}.{trait_internal_name}`
- Skip edges that already exist.

**`instance_of`** edges:
- For each new `weapon_trait` entity, extract the concept suffix.
- Look up the concept→family map (bootstrapped from existing edges + any new families from Phase 3).
- Create `instance_of` edge from the weapon_trait to the name_family.
- Edge ID: `shared.edge.instance_of.{trait_internal_name}`
- For unmapped suffixes: the Phase 3 temporary family is used, and the suffix is flagged in the report.

Edge shape (both types):
```json
{
  "id": "<edge_id>",
  "type": "<instance_of|weapon_has_trait_pool>",
  "from_entity_id": "<entity_id>",
  "to_entity_id": "<entity_id>",
  "source_snapshot_id": "<from manifest>",
  "conditions": { "predicates": [], "aggregation": "additive", "stacking_mode": "binary", "exclusive_scope": null },
  "calc": {},
  "evidence_ids": []
}
```

Append new edges to `shared.json`.

#### Phase 5 — Report

Print to stdout:
- Entities generated per kind (weapon, weapon_trait, weapon_perk, gadget_trait, name_family)
- Edges generated per type (weapon_has_trait_pool, instance_of)
- Unmapped concept suffixes requiring manual name_family assignment
- Weapons with no damage profiles in `generated/damage-profiles.json` (profile gap)
- Total entity/edge counts before and after

### Slot Detection

Weapon slot (`melee` vs `ranged`) is determined by inspecting the weapon template Lua:
- If `weapon_template.keywords` contains `"ranged"` → ranged
- If `weapon_template.keywords` contains `"melee"` → melee
- Fallback: if `ammo_template` field exists and is not `"no_ammo"` → ranged, else melee

For traits/perks, slot is inherited from the weapon family or perk file name.

### Lua Parsing Strategy

Reuse existing `lua-data-reader.mjs` infrastructure where possible:
- `extractTemplateBlocks` for reading bespoke trait definitions (already used by `extract-buff-effects.mjs`)
- For weapon template files: lightweight regex-based extraction of `keywords`, `ammo_template`, and trait references — full Lua eval is unnecessary for these fields

For perk and gadget trait files: `extractTemplateBlocks` should work since they follow the same `templates.{name} = { ... }` pattern as bespoke traits.

### Bespoke File → Weapon Family Mapping

The bespoke filename encodes the weapon family and p-series: `weapon_traits_bespoke_{family}_{p-series}.lua`. To map this to weapon marks:
- Parse the filename to extract `{family}` and `{p-series}`
- All weapon entities matching `{family}_{p-series}_m*` share this trait pool

Edge case: some bespoke files have no corresponding weapon marks (e.g., `ogryn_thumper_p2` has a bespoke file but no mark templates). The script validates by checking that at least one weapon entity exists for each bespoke file's family/p-series combination. Mismatches are logged as warnings (weapon_trait entities are still generated, but no `weapon_has_trait_pool` edges).

### Idempotency

The script is **create-only** — it never modifies existing entities or edges. On re-run:
- Entities already in `existingEntities` (by ID) are skipped.
- Edges already in `existingEdges` (by ID) are skipped.
- The concept→family map is rebuilt from scratch each run, so new `instance_of` edges created by earlier runs are incorporated.
- To fix an existing entity, edit it directly in the JSON shard. The expansion script does not upsert.

## Post-Expansion: `npm run effects:build`

After `entities:expand`, run `npm run effects:build`. This:
1. Loads all entities (including new shells with `calc: {}`)
2. Resolves Lua buff templates from `weapon_traits_buff_templates/` and bespoke tier data
3. Matches each entity by `internal_name` → fills `calc.tiers` for weapon_traits, `calc.effects` for gadget_traits
4. Writes updated entities back to the JSON shards

No changes to `extract-buff-effects.mjs` are needed.

## Alias Generation (Separate Step, Not Blocking)

Aliases are needed for the website's GL build import flow, not for calculator functionality. Calculators use entity IDs directly.

- **Perk aliases**: auto-derivable from `format_values` display strings in the perk Lua files. A follow-up script can generate these.
- **Gadget trait aliases**: same approach as perks.
- **Weapon aliases**: require GL display names (e.g., "Antax Mk V Combat Axe" → `combataxe_p1_m1`). These are not in the Darktide source — they must be sourced from GamesLantern weapon catalog pages or community data. Partially manual.
- **Blessing aliases**: not needed. Blessings resolve through `instance_of` → `name_family` → existing name_family aliases.

## Profile Extraction Gap (10 Weapons)

10 weapon marks have source template files but no action maps in `damage-profiles.json`. These need investigation:
- Some may share profiles with family peers (e.g., `combataxe_p1_m2` reusing `combataxe_p1_m1`'s profiles)
- Some may have profiles the extractor doesn't handle (e.g., unusual attack chain structure)
- The expansion script flags these in its report; resolution is a follow-up task

## Testing Strategy

1. **Referential integrity**: `npm run index:build` validates all new entities, edges, name_families. This catches ID mismatches, missing refs, schema violations, and dangling edge references.
2. **Snapshot tests**: golden output of the expansion script's report (entity/edge counts, unmapped suffixes).
3. **Regression**: full existing test suite (`npm test`) passes after expansion + effects:build.
4. **Smoke test**: run calculators (damage, stagger, cleave) on 2-3 GL builds that previously failed due to missing entities. Verify they now resolve and produce results.

## Success Criteria

- Every weapon mark in `damage-profiles.json` has a `shared.weapon.*` entity
- Every bespoke trait definition has a `weapon_trait` entity with `calc.tiers` populated
- Every weapon perk has a `weapon_perk` entity
- Every gadget trait has a `gadget_trait` entity
- All weapons have `weapon_has_trait_pool` edges to their blessing pool
- All weapon_traits have `instance_of` edges to a name_family (some may be temporary-slug families pending manual naming)
- `npm run index:build` succeeds (referential integrity)
- `npm test` passes with zero failures

## Out of Scope

- Alias curation for website import (follow-up)
- Profile extraction gap resolution (follow-up)
- Toughness scoring dimension design (separate issue)
- `talent_coherence` scoring recalibration (separate issue)
