# Entity Name Enrichment — Track 1 of Phase 3 Alias Curation

**Date:** 2026-03-26
**Issue:** #14 (Phase 3)
**Scope:** Auto-derivable `ui_name` enrichment for weapon perks, gadget traits, and unambiguous blessing name families.

## Problem

Phase 2 generated 662 entities, all with `ui_name: null` because the Darktide Lua source contains no English display strings. Without `ui_name`, the index builder cannot materialize synthetic aliases, so GL build text (e.g., `"10-25% Damage (Flak Armoured)"`) fails to resolve to these entities.

The alias system already handles this: `build-ground-truth-index.mjs` auto-generates fuzzy aliases from entity `ui_name` fields at index build time. Setting `ui_name` is sufficient for entities whose display name is unambiguous — no hand-authored alias records needed.

## Data Source

`scripts/build-scoring-data.json` contains human-curated display name mappings:

| Section | Entries | Join key |
|---------|---------|----------|
| `melee_perks` | 18 | `stat` field → entity `internal_name` substring |
| `ranged_perks` | 16 | `stat` field → entity `internal_name` substring |
| `curio_perks` | 21 | `stat` field → entity `internal_name` substring |
| `weapons[*].blessings` | per-weapon | `internal` field (concept suffix) → name_family ID slug |

## Scope

### In scope

1. **Weapon perks — 36/36 entities.** Every weapon_perk entity maps to exactly one scoring data entry via stat name. Split: 19 melee, 17 ranged.

2. **Gadget traits — 19/24 entities.** 19 selectable curio traits map to scoring data. Excluded:
   - 3 `innate_*` entities (`gadget_innate_health_increase`, `gadget_innate_max_wounds_increase`, `gadget_innate_toughness_increase`) — base gadget stats, not selectable traits, no display name in scoring data.
   - `gadget_damage_reduction_vs_grenadiers` — no scoring data entry (possibly game-removed or merged with bombers).
   - `gadget_permanent_damage_resistance` — no scoring data entry.

3. **Blessing name_families — 10 unambiguous names.** These concept suffixes map to exactly one community name across all weapons in the scoring data:
   - Flanking Fire → `allow_flanking_and_increased_damage_when_flanking`
   - Lacerate → `bleed_on_non_weakspot_hit`
   - Soulfire → `chance_to_explode_elites_on_kill`
   - Charge Crit → `charge_level_increases_critical_strike_chance`
   - Cycler → `extended_activation_duration_on_chained_attacks`
   - Charmed Reload → `faster_reload_on_empty_clip`
   - Flesh Tearer → `increased_weakspot_damage_against_bleeding`
   - Haymaker → `power_bonus_on_first_attack`
   - Gloryhunter → `toughness_on_elite_kills`
   - Blazing Spirit → `warp_charge_power_bonus`

4. **Malformed name_family slug fix — 6 entities.** These have bad ID slugs from prefix-stripping failures in the expand script:
   - 4× `bespoke_bespoke_powersword_2h_p1_*` (doubled prefix)
   - 2× `heavystubber_p1_*` (legacy naming, should be `ogryn_heavystubber_p1_*`)
   - Fix: correct entity IDs, update `instance_of` edges referencing them.

### Out of scope (Track 2)

- Ambiguous blessing names (Headtaker maps to 3 different concept suffixes across weapons — needs alias records with `weapon_family` context constraints)
- Remaining ~105 unmapped name_families (need GL scrape)
- Weapon mark display names (~90 unmapped, need GL scrape)
- The 2 unmatched gadget traits and 3 innate entities

## Architecture

### New script: `scripts/enrich-entity-names.mjs`

**Pipeline position:** `entities:expand` → **`enrich-entity-names`** → `effects:build`

**Input:**
- `scripts/build-scoring-data.json` — display name mappings
- `data/ground-truth/entities/shared-weapons.json` — perk, gadget trait, name_family entities
- `data/ground-truth/edges/shared.json` — for malformed slug edge updates
- `data/ground-truth/aliases/shared-guides.json` — for writing perk alias records

**Output:**
- Patched `shared-weapons.json` with `ui_name` set on gadget traits and name_families
- Patched `shared-guides.json` with new alias records for weapon perks
- Patched `shared.json` edges for malformed slug fixes

### Why perks need alias records, not `ui_name`

~15 perk display names are shared between melee and ranged variants (e.g., "Damage (Flak Armoured)" exists as both `weapon_trait_melee_common_wield_increased_armored_damage` and `weapon_trait_ranged_common_wield_increased_armored_damage`). The index builder's `materializeSyntheticAliases` generates aliases with **empty context constraints** from `ui_name`. The collision detector (`detectUnsafeAliasCollisions`) throws when two fuzzy aliases share `normalized_text` + `context_constraints` + `rank_weight` but point at different entities.

Solution: generate hand-authored alias records with `slot` context constraint (`"melee"` or `"ranged"`) for all 36 perks. This disambiguates correctly and matches how `build-canonicalize.mjs` already passes `{ slot }` context during resolution.

Gadget traits and name_families have no collision risk (unique display names across all entities of their kind), so `ui_name` works for them.

### Matching strategy

1. **Weapon perks (36 alias records):** Build a hardcoded `entity_internal_name → display_name` lookup from scoring data. For each entity, emit an alias record with `alias_kind: "community_name"`, `match_mode: "fuzzy_allowed"`, `provenance: "build-scoring-data"`, and `context_constraints: { require_all: [{ key: "slot", value: "melee"|"ranged" }], prefer: [] }`. The slot is determined by whether the internal_name contains `_melee_` or `_ranged_` (or neither — shared perks like `weapon_trait_increase_crit_chance` are melee-only in the entity set).

2. **Gadget traits (19 `ui_name` updates):** Hardcoded `entity_internal_name → display_name` lookup. Set `ui_name` on the entity directly.

3. **Blessing name_families (10 `ui_name` updates):** Invert the scoring data weapons section to build `concept_suffix → community_name`. For each name_family entity whose ID slug matches a concept suffix, set `ui_name` to the community name. Skip suffixes that map to multiple community names (ambiguous).

**Idempotency:** Re-running produces the same output. Alias records are matched by `candidate_entity_id` to avoid duplicates. Entity `ui_name` is overwritten with the same value. Does not clear existing values set by other means.

### Malformed slug fix

Same script or a dedicated function within it:

1. Read `shared-weapons.json` and `data/ground-truth/edges/shared.json`
2. Identify entities with malformed ID patterns
3. Compute corrected IDs (strip doubled prefix, fix family name)
4. Check for collisions with existing entities
5. Rename entity IDs and update all edge `source`/`target` references

### npm script

Register as `npm run entities:enrich` in `package.json`.

## Verification

1. Run `npm run entities:enrich` — should report counts (e.g., "Added 36 weapon_perk aliases, set ui_name on 19 gadget_traits and 10 name_families. Fixed 6 malformed slugs.")
2. Run `npm run gt:build` — index builder should materialize ~29 new synthetic aliases (from ui_name) + incorporate 36 hand-authored perk aliases, with no collision errors
3. Run `npm test` — all existing tests pass
4. Spot-check: resolve `"Damage (Flak Armoured)"` with context `{ kind: "weapon_perk", slot: "melee" }` — should hit the melee perk entity via the new alias record
5. Verify the 6 renamed name_family entities have correct `instance_of` edges

## Success Criteria

- 36 alias records generated for weapon_perks (with slot context constraints)
- 19/24 gadget_trait entities have `ui_name` set (5 excluded with documented reasons)
- 10 name_family entities have `ui_name` set
- 6 malformed name_family slugs are corrected
- Index builds cleanly with no alias collisions
- All tests pass
- `enrich-entity-names` is idempotent on re-run
