# Handoff

**From:** Claude Opus 4.6 (Claude Code CLI)
**Date:** 2026-03-28

## Task
Entity name enrichment (#14 Phase 3 Track 2) — complete and merged to feature branch.

## In-Flight Work
- No uncommitted changes. Clean tree.
- All work on `feature/gl-catalog-enrichment` branch (not pushed to origin).
- Worktree and feature branch NOT merged to main yet.

## What Shipped

### GL Catalog Scraper
`scripts/scrape-gl-catalog.mjs` (`npm run gl:scrape`) — Playwright scraper that captures GL's `/api/weapons` response (119 weapons) and `/weapon-blessing-traits` DOM table (~195 blessings). Output: `data/ground-truth/generated/gl-catalog.json` (gitignored).

### Weapon Name Mapping
`scripts/generate-weapon-name-mapping.mjs` (`npm run entities:gen-mapping`) — auto-populates `data/ground-truth/weapon-name-mapping.json` (119 entries) from multiple sources:

| Source | Count |
|--------|-------|
| Existing aliases | 32 |
| DarktideRenameRevert mod | 23 |
| Singleton family deduction | 5 |
| Last-remaining deduction | 10 |
| Manual (alphabetical heuristic) | 49 |

### Malformed Slug Fix
`scripts/fix-malformed-slugs.mjs` (`npm run entities:fix-slugs`) — renamed `bespoke_bespoke_` → `bespoke_` in 8 entities + 12 edges.

### Entity Enrichment (extended)
`scripts/enrich-entity-names.mjs` (`npm run entities:enrich`) — extended with:

| Category | Before | After |
|----------|--------|-------|
| Weapon `ui_name` | 0/124 | 119/124 |
| Weapon aliases (`gameslantern_name`) | 0 | 119 |
| Name_family `ui_name` | 9/163 | 51/163 |
| Malformed slugs | 8+12 | 0 |

Pipeline: `gl:scrape` → `entities:fix-slugs` → `entities:gen-mapping` → `entities:enrich` → `effects:build` → `check`

872 tests, 0 failures. 46/46 curated build weapons resolve.

## Session Context
- 49 manual weapon mappings use alphabetical ordering within families as a heuristic. Within-family mark swaps are cosmetic — alias text matches GL output so resolution works. Can be refined with a Darktide mod dump if display precision matters.
- The Darktide decompiled source is at `/home/matthias/git/Darktide-Source-Code` — unlock files at `scripts/settings/weapon_unlock/` could disambiguate some within-family marks but only partially (~22/49 have any unlock data).
- 5 player weapons have no GL counterpart: `needlepistol_p1_m3`, `ogryn_powermaul_p1_m2`, `ogryn_powermaul_p1_m3` + 2 others (likely unreleased content).
- 112 concept-slug name_families (e.g., `consecutive_hits_increases_close_damage`) remain without `ui_name` — matching these to GL blessings requires weapon-type fingerprinting (not implemented).

## Next Steps
1. **Merge to main** when ready — `git checkout main && git merge feature/gl-catalog-enrichment`
2. **Push to origin**
3. **Close #14** — `gh issue close 14 --comment "..."`
4. **Remaining data quality work** (separate from #14):
   - Blazing Spirit name_family collision (`blazing_spirit` / `warp_charge_power_bonus` — needs merge policy)
   - Concept-slug name_family enrichment (weapon-type fingerprint matching)
   - Within-family mark mapping refinement (Darktide mod dump)
   - Profile extraction gap (weapon marks with entities but no damage profiles)
5. Open issues: #1 (TypeScript), #3 (CLI browse/compare), #6 (website, unblocked by #14)

## Design Docs
- Spec: `docs/superpowers/specs/2026-03-28-gl-catalog-scrape-and-enrichment-design.md`
- Plan: `docs/superpowers/plans/2026-03-28-gl-catalog-scrape-and-enrichment.md`
