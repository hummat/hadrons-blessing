# CLI Consolidation Design (#18)

## Problem

`src/cli/` has 31 TypeScript files. Many are near-identical calculator shells or one-off maintenance scripts that ran once and are no longer needed. This inflates file count without adding value.

## Changes

### 1. Unified calculator CLI

Replace `calc-build.ts`, `stagger-build.ts`, `cleave-build.ts`, `toughness-build.ts` with a single `calc-build.ts` that uses a `--mode` flag.

```
npm run calc -- <build|dir> [--mode damage|stagger|cleave|toughness] [--json|--text] [--freeze] [--compare <file>]
```

**Mode dispatch:** A `ModeConfig` record maps each mode string to:
- `computeFn` — the library compute function (`computeBreakpoints`, `computeStaggerMatrix`, `computeCleaveMatrix`, `computeSurvivability`)
- `formatText` — mode-specific text formatter function
- `freezeDir` — snapshot output directory (`tests/fixtures/ground-truth/{calc,stagger,cleave,toughness}/`)
- `snapshotSuffix` — file extension for frozen snapshots (`.calc.json`, `.stagger.json`, etc.)
- `needsCalcData` — whether `loadCalculatorData()` is required (all except toughness)
- `needsStaggerSettings` — whether `loadStaggerSettings()` is required (stagger only)

**Defaults:** `--mode` defaults to `damage`, preserving current `npm run calc` behavior. `--compare` is only valid with `--mode damage`.

**Shared harness:** Arg parsing, file/directory iteration, freeze writes, and JSON output are identical across modes and handled once. Each mode contributes only its formatter (~50-80 lines).

**npm scripts:** Convenience aliases preserved:
- `"stagger": "node dist/cli/calc-build.js --mode stagger"` (positional build path appended by user)
- `"cleave": "node dist/cli/calc-build.js --mode cleave"`
- `"toughness": "node dist/cli/calc-build.js --mode toughness"`
- `"calc": "node dist/cli/calc-build.js"` (unchanged, defaults to damage)
- All 4 freeze scripts become: `"calc:freeze": "node dist/cli/calc-build.js data/builds/ --json --freeze"`, etc.

### 2. Delete dead maintenance scripts

Remove from `src/cli/`:
- `fix-malformed-slugs.ts` — one-off slug fix, no live importers
- `migrate-build-fixtures.ts` — one-off v0→v1 migration, complete
- `generate-missing-entities.ts` — one-off entity generation, complete

Remove from `src/lib/`:
- `fix-malformed-slugs.test.ts` — tests the deleted function

Remove npm scripts: `entities:fix-slugs`.

All are recoverable from git history.

### 3. Absorb freeze-scores into score-build

Add `--freeze` flag and directory/batch support to `score-build.ts`, consistent with every other calculator CLI. Currently `score-build.ts` only handles single files and uses a bare `process.argv[1]` guard instead of `runCliMain`. This change:

- Wraps the CLI in `runCliMain("score", ...)` for consistent error handling
- Adds directory iteration (same pattern as calc-build)
- Adds `--freeze` flag that writes scorecards to `tests/fixtures/ground-truth/scores/`
- Freezes all builds in directory (not just the hardcoded 5 in current `freeze-scores.ts`)

This increases golden snapshots from 5 to 23, improving regression coverage.

Updated npm script: `"score:freeze": "node dist/cli/score-build.js data/builds/ --json --freeze"`

Delete `freeze-scores.ts`.

### 4. Out of scope

- Entity pipeline scripts (`expand-entity-coverage.ts`, `enrich-entity-names.ts`, `generate-weapon-name-mapping.ts`) — rarely used, already namespaced via npm scripts, share no internal structure worth unifying
- `export-bot-weapons.ts` — single-consumer utility, not worth moving
- All other CLI entry points

## Net result

| Metric | Before | After |
|--------|--------|-------|
| CLI files | 31 | 24 |
| Test files | 34 | 33 |
| npm scripts | 36 | 33 |

All existing `npm run` commands continue to work. Frozen snapshot format is unchanged — regression tests pass without re-freezing.

## Test plan

- `npm test` passes (existing calculator regression tests unchanged)
- `npm run calc -- data/builds/08-gandalf-melee-wizard.json` (damage, default mode)
- `npm run calc -- data/builds/08-gandalf-melee-wizard.json --mode stagger`
- `npm run calc -- data/builds/08-gandalf-melee-wizard.json --mode cleave`
- `npm run calc -- data/builds/08-gandalf-melee-wizard.json --mode toughness`
- `npm run calc -- data/builds/ --mode stagger --freeze` (batch freeze)
- `npm run score -- data/builds/ --freeze` (new freeze flag)
- `npm run stagger -- data/builds/08-gandalf-melee-wizard.json` (alias still works)
- `make check` passes
