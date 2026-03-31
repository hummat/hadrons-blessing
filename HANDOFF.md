# Handoff

**From:** Claude Opus 4.6 (Claude Code CLI)
**Date:** 2026-03-31

## Task
Source migration to Darktide v1.11.3 + full build fixture refresh. Complete, committed, not pushed.

## In-Flight Work
None. Clean working tree.

## What Changed This Session

### Source migration (commit `2295d8f`)
- Pinned ground-truth to `f63d836` (game v1.11.3, 2026-03-27)
- Updated `data/ground-truth/source-snapshots/manifest.json` with new SHA + game version
- Bulk-replaced 6290 `source_snapshot_id` references across 29 JSON files
- Regenerated all built artifacts: `edges:build`, `effects:build`, `breeds:build`, `profiles:build`, `stagger:build`
- Added `damage_taken_by_chaos_armored_hound_multiplier` to `synergy-stat-families.ts` (new breed)
- Re-froze all 7 snapshot types (audit, synergy, score, calc, stagger, cleave, toughness)
- 104 files changed, 1003 tests passing

### Build fixture refresh (commit `fd54e23`)
- Replaced 23 pre-patch builds with 24 freshly scraped Havoc 40 meta builds from GamesLantern
- 4 builds per class, selected for keystone/weapon/playstyle diversity
- All Hive Scum builds post-1.11.0 tree rework (old builds used removed talent `broker_passive_punk_grit`)
- Updated all hardcoded build references across ~15 source/test files
- Updated content-specific test assertions (weapon labels, perk names, blessing families)
- Regenerated `data/exports/bot-weapon-recommendations.json`
- 186 files changed, 1007 tests passing

### Docs update (commit `300ebb6`)
- AGENTS.md updated for 24-build count and resolution stats

## Session Context
- `CLAUDE.md` is a symlink to `AGENTS.md` — edit `AGENTS.md`, git tracks the symlink
- v1.11.0 (2026-03-17) completely restructured the Hive Scum (broker) tree — version 13→15, massive node rearrangement, 6 talents removed, 6 new ones added
- Psyker: `shield_extra_charge` ↔ `shield_stun_passive` swapped tree nodes (talents still exist, just moved)
- Veteran: `movement_bonuses_on_toughness_broken` replaced by `increased_ranged_cleave` at one node
- Adamant: `terminus_warrant_ranged` → `terminus_warrant_cdr`, `terminus_warrant_melee` → `terminus_warrant_support`, plus 2 more TW talents removed
- New breed `chaos_armored_hound` + `chaos_ogryn_houndmaster` in the source
- 611 damage profiles (was 592), 47 breeds in breed-data.json
- Psyker builds all use Warp Siphon keystone — reflects actual Havoc 40 meta, not a diversity gap
- `export-bot-weapons.ts` has hardcoded `source_builds` arrays — these were updated but are still a manual mapping

## Next Steps
1. **Push to origin** — 3 commits ahead of remote
2. **#6 (Website architecture)** — main remaining feature work. `BuildSummary` and `BuildDiff` types are the data contracts for the web layer.
3. **#16 (Weapon mark mappings)** — independent data quality work

## Pipeline Reference
```
npm run build              # build:types + tsc -> dist/
npm run check              # build + index:build + test + index:check
make check                 # full quality gate (edges + effects + breeds + profiles + stagger + check)
npm test                   # tsx --test src/**/*.test.ts
npm run list [--class X] [--weapon X] [--grade X] [--sort X] [--reverse] [--json]
npm run diff -- <a> <b> [--detailed] [--json]
```
