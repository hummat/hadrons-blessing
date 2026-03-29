# GL Catalog Scrape & Entity Name Enrichment (Phase 3 Track 2)

**Issue:** #14 — Full entity coverage for website readiness
**Date:** 2026-03-28
**Scope:** Weapon display names, blessing community names, malformed slug fix

## Problem

131 weapon entities (124 player + 7 bot) have `ui_name: null`. 154 of 163 name_family entities lack `ui_name`. 4 entities and 12 edges have malformed `bespoke_bespoke_` IDs. GL builds referencing unnamed weapons resolve by canonical ID only — the GL display name → entity path is broken without alias records.

Track 1 (shipped 2026-03-26) enriched 36 weapon perk aliases, 19 gadget trait `ui_name` values, and 9 blessing name_family `ui_name` values. This track completes the remaining gaps.

## Data Sources

### GL Weapons API

`GET /api/weapons?page=1` (requires browser session — returns 401 without cookies).

Returns 119 weapon entries:
```json
{
  "id": "uuid",
  "name": "Agripinaa Mk VIII Braced Autogun",
  "type": "Ranged",
  "url": "https://darktide.gameslantern.com/weapons/braced-autogun/agripinaa-mk-viii-braced-autogun",
  "classes": [{ "name": "Veteran", "unlock_level": 7 }, ...],
  "icon": "/storage/...",
  "description": "..."
}
```

The URL encodes a weapon type slug (e.g., `braced-autogun`) that groups marks within a family.

### GL Blessings Page

`/weapon-blessing-traits` renders a table with 193 blessing entries: name, effect text, and applicable weapon types. No API endpoint — must be scraped from rendered DOM.

### Mapping Challenge

GL does not expose internal weapon template IDs (like `autogun_p2_m1`). The Darktide source has `loc_` keys but not the actual localized strings (those live in binary bundle files fetched from Fatshark's backend at runtime).

**Known mapping sources:**
- 32 existing weapon aliases in `shared-guides.json`
- 27 entries from the [DarktideRenameRevert](https://github.com/Backup158/DarktideRenameRevert) mod (maps `loc_weapon_family_*` keys containing template IDs to display names)
- 32 singleton families (1 internal mark ↔ 1 GL weapon) — trivially mapped
- ~6 more deducible by last-remaining elimination within a family

**Remaining gap:** ~20-30 weapons in multi-mark families where the within-family mark assignment (which GL Mk number = which internal `_m#`) requires manual curation from community knowledge.

Unlock levels do not disambiguate marks within a family — all marks in a family share the same per-class unlock levels on GL.

## Architecture

### 1. GL Catalog Scraper

**File:** `scripts/scrape-gl-catalog.mjs`
**NPM script:** `npm run gl:scrape`
**Output:** `data/ground-truth/generated/gl-catalog.json`

Process:
1. Launch Playwright Chromium, navigate to `/weapons`, capture `/api/weapons?page=1` response
2. Navigate to `/weapon-blessing-traits`, wait for table render, extract via `page.evaluate()`
3. Write combined output to `gl-catalog.json`

Output shape:
```json
{
  "scraped_at": "2026-03-28T...",
  "source": "darktide.gameslantern.com",
  "weapons": [{
    "gl_id": "uuid",
    "display_name": "Agripinaa Mk VIII Braced Autogun",
    "type": "Ranged",
    "url_slug": "braced-autogun",
    "classes": [{ "name": "Veteran", "unlock_level": 7 }]
  }],
  "blessings": [{
    "display_name": "Bloodthirsty",
    "effect": "+100% Critical Chance on your next Melee Attack after Special Attack Kill.",
    "weapon_types": ["Assault Chainsword", "Blaze Force Sword", ...]
  }]
}
```

Single browser instance reused across both pages. Cookie consent dismissal reuses the pattern from `extract-build.mjs`. Idempotent — re-running overwrites the generated file.

### 2. Weapon Name Mapping Table

**File:** `data/ground-truth/weapon-name-mapping.json`
**Nature:** Hand-curated, version-controlled

Flat array mapping every GL weapon display name to its internal template ID:
```json
[
  { "gl_name": "Agripinaa Mk VIII Braced Autogun", "template_id": "autogun_p2_m1", "source": "existing_alias" },
  { "gl_name": "Graia Mk IV Braced Autogun", "template_id": "autogun_p2_m2", "source": "manual" },
  ...
]
```

The `source` field tracks provenance: `existing_alias`, `rename_revert_mod`, `singleton_family`, `last_remaining`, or `manual`.

**Population strategy:**
1. Auto-populate from existing aliases (32 weapons)
2. Auto-populate from RenameRevert mod data (27 weapons, ~15 net new after dedup)
3. Singleton family matching: map GL type slug → internal family for families with 1 mark (32 families)
4. Last-remaining deduction: within a family, if all but one mark is mapped, the remaining mark maps to the remaining GL weapon (6 more)
5. Manual curation for remaining ~20-30 ambiguous marks (community wikis, Steam guides)

A generation script (`scripts/generate-weapon-name-mapping.mjs`) auto-populates steps 1-4 and emits TODOs for step 5. Manual entries are preserved across re-runs.

### 3. Enrichment Extension

Extend `scripts/enrich-entity-names.mjs` to consume the new data:

**Weapon `ui_name` + aliases:**
- Read `gl-catalog.json` + `weapon-name-mapping.json`
- For each mapping entry: set `ui_name` on the matching weapon entity in `shared-weapons.json`
- Generate alias records in `shared-guides.json` (same shape as existing weapon aliases: `alias_kind: "guide_name"`, `match_mode: "fuzzy_allowed"`, `confidence: "high"`, slot-appropriate `context_constraints`)

**Blessing name_family `ui_name`:**
- Read `gl-catalog.json` blessings
- Match GL blessing names to name_family entities via: GL blessing name → find `instance_of` edges where the blessing's weapon types match the `weapon_has_trait_pool` edges → derive the `name_family` target
- For name_families that already have a recognizable community name in their ID (e.g., `shared.name_family.blessing.bloodthirsty` → "Bloodthirsty"), use title-cased ID suffix as `ui_name` directly
- For concept-slug name_families (e.g., `shared.name_family.blessing.chained_hits_increases_power`), match to GL blessings by comparing the set of weapon types the name_family's weapon_traits are linked to (via `weapon_has_trait_pool` edges) against the GL blessing's `weapon_types` list

### 4. Malformed Slug Fix

**File:** `scripts/fix-malformed-slugs.mjs`
**NPM script:** `npm run entities:fix-slugs`

Target: 4 entities with `bespoke_bespoke_` doubled prefix + 12 edges referencing them.

| Current ID fragment | Fixed ID fragment |
|---|---|
| `weapon_trait_bespoke_bespoke_powersword_2h_p1_*` | `weapon_trait_bespoke_powersword_2h_p1_*` |
| `weapon_trait_bespoke_bespoke_powersword_p2_*` | `weapon_trait_bespoke_powersword_p2_*` |

Process:
1. Read `shared-weapons.json` and `shared.json` (edges)
2. Find all records with `bespoke_bespoke_` in any ID field
3. Replace `bespoke_bespoke_` → `bespoke_` in entity IDs, edge IDs, edge `from_entity_id`, edge `to_entity_id`
4. Check for collision with existing IDs (abort if found)
5. Write back
6. Idempotent — no-ops if already fixed

**Blazing Spirit collision:** The existing `blazing_spirit` / `warp_charge_power_bonus` duplicate name_family issue (flagged in Track 1) is out of scope — it requires a merge policy decision and is not a malformed-slug problem.

### 5. Pipeline & Verification

**Pipeline order:**
```
npm run gl:scrape
npm run entities:fix-slugs
npm run entities:enrich        # extended to handle weapons + blessings
npm run effects:build
npm run check                  # index build + tests + integrity gate
```

**Verification criteria:**
- `npm run check` passes (820+ tests, 0 failures)
- All 124 player weapon entities have `ui_name` set (7 bot weapons excluded)
- Weapon alias count increases from 36 to ~119+
- Name_family `ui_name` coverage increases from 9/163 to ~130+/163
- No `bespoke_bespoke_` strings remain in any entity or edge shard
- Smoke test: `node scripts/extract-build.mjs <url> --json` on 3+ GL builds with previously-unresolved weapons shows `resolution_status: "resolved"` for all weapons

## Out of Scope

- **Blazing Spirit name_family collision** (`blazing_spirit` / `warp_charge_power_bonus`): needs merge policy, tracked separately
- **Profile extraction gap**: weapon marks with entities but no damage profiles — separate investigation
- **TypeScript migration** (#1), CLI browse/compare (#3), website (#6)

## Key Files

| File | Role |
|---|---|
| `scripts/scrape-gl-catalog.mjs` | New: GL catalog scraper |
| `scripts/generate-weapon-name-mapping.mjs` | New: auto-populates mapping table |
| `scripts/fix-malformed-slugs.mjs` | New: renames bespoke_bespoke_ IDs |
| `scripts/enrich-entity-names.mjs` | Extended: weapons + blessings |
| `data/ground-truth/generated/gl-catalog.json` | Generated: GL scrape output |
| `data/ground-truth/weapon-name-mapping.json` | Curated: GL name → template ID |
| `data/ground-truth/entities/shared-weapons.json` | Modified: ui_name set |
| `data/ground-truth/entities/shared-names.json` | Modified: ui_name set |
| `data/ground-truth/aliases/shared-guides.json` | Modified: weapon aliases added |
| `data/ground-truth/edges/shared.json` | Modified: slug fix |

## Risks

1. **GL page structure changes**: The scraper depends on GL's current DOM structure and API. If GL updates, the scraper breaks. Mitigation: `gl-catalog.json` is a generated artifact — the scraper only needs to run once per GL data update.
2. **Incomplete weapon mapping**: ~20-30 marks need manual curation. If some are wrong, the weapon gets the wrong display name but resolution still works (the alias text matches what GL builds produce). Mitigation: verify against known aliases.
3. **Blessing name matching**: concept-slug name_families may not match GL blessings cleanly. Mitigation: match by weapon-type fingerprint, report unmatched for manual review.
