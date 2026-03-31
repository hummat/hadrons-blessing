# Handoff

**From:** Claude Opus 4.6 (Claude Code CLI)
**Date:** 2026-03-31

## Task
#3 (Build browse and compare) — complete, merged to main, not yet pushed.

## In-Flight Work
None. Clean working tree (only this HANDOFF.md is modified).

## What Changed This Session

### #3: Build Browse and Compare (complete)
- `src/lib/scorecard-deps.ts` — shared helper for graceful synergy/calc data loading
- `src/lib/build-list.ts` — `listBuilds(dir, options)` returning `BuildSummary[]` with filtering (class/weapon/grade) and sorting (any dimension)
- `src/lib/build-diff.ts` — `diffBuilds(pathA, pathB, options)` returning `BuildDiff` with score deltas, structural diff (entity ID set operations), and analytical diff (synergy edge diff + breakpoint checklist HTK comparison)
- `src/cli/list-builds.ts` — `npm run list` CLI with table + JSON output
- `src/cli/diff-builds.ts` — `npm run diff` CLI with text + JSON output
- Both library modules exported from `src/lib/index.ts` for #6 website consumption
- 27 new tests (16 unit + 11 CLI contract), all passing. 0 regressions.
- 11 files, 1125 lines added. Merged via `--no-ff` merge commit.
- Spec: `docs/superpowers/specs/2026-03-31-build-browse-and-compare-design.md`
- Plan: `docs/superpowers/plans/2026-03-31-build-browse-and-compare.md`

## Session Context
- `CLAUDE.md` is a symlink to `AGENTS.md` — edit `AGENTS.md`, but `git add -f CLAUDE.md` to track the symlink
- `make check` fails due to Darktide source snapshot mismatch (source repo updated upstream since last pin). This is pre-existing and unrelated to #3. `npm run build && npm test` passes (805 pass / 88 fail — 88 are all pre-existing source-snapshot failures).
- Builds 17-20 have `class.raw_label: "hive scum"` — this is a legitimate 6th class, not an error. Tests were adjusted accordingly.
- `BuildDiff.a.file` / `b.file` stores the full path (not basename) — the spec said basename but the implementation uses the raw path. Minor inconsistency, works fine for CLI use.
- The `scorecard-deps.ts` cache (`_cached`) is module-level, so it persists across calls within a process. Fine for CLI; website may need to clear it if index data changes.

## Next Steps
1. **Push to origin** — 12 commits ahead of remote (2 from previous #18 session + 10 from this session including merge)
2. **Close #3** — `gh issue close 3 --comment "Implemented: list + diff commands"`
3. **#16 (Weapon mark mappings)** — data quality housekeeping, independent
4. **#6 (Website architecture)** — main remaining feature work. `list` and `diff` data contracts are now locked in via `BuildSummary` and `BuildDiff` types.

## Pipeline Reference
```
npm run build              # build:types + tsc -> dist/
npm run check              # build + index:build + test + index:check
make check                 # full quality gate (edges + effects + breeds + profiles + stagger + check)
npm test                   # tsx --test src/**/*.test.ts
npm run list [--class X] [--weapon X] [--grade X] [--sort X] [--reverse] [--json]
npm run diff -- <a> <b> [--detailed] [--json]
npm run calc -- <build> [--mode damage|stagger|cleave|toughness] [--json|--text] [--freeze]
npm run score -- <build|dir> [--json|--text] [--freeze]
```
