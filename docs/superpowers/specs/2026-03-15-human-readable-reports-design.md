# Human-Readable Build Reports — Design Spec

**Issue:** #2
**Date:** 2026-03-15
**Status:** Approved

## Motivation

Every CLI command in hadrons-blessing outputs raw JSON. The audit pipeline answers "is every name in this build resolved?" but the answer is a 200-line JSON blob. This spec adds a human-readable report layer that joins audit results, build metadata, and scoring into scannable output for terminals, markdown consumers, and downstream tools.

## Goals

1. Single command (`npm run report`) that produces a complete build report
2. Three output formats: terminal text (default), markdown (for website/sharing), JSON (for piping)
3. Batch mode: directory input produces a summary table + per-build details
4. Extension point for future scoring dimensions (#7–#9) without structural changes

## Non-Goals

- Refactoring existing CLI commands or `score-build.mjs`
- Adding scoring dimensions beyond what exists today (perk optimality, curio efficiency)
- Talent list display (noise until synergy model makes it meaningful)
- Interactive/TUI output

## Architecture

### Approach: Report library + thin CLI wrapper

Three new files:

```
scripts/
  report-build.mjs                    # CLI entry point (thin)
  ground-truth/lib/
    build-report.mjs                  # Data assembly: build + audit + score → BuildReport
    report-formatter.mjs              # Rendering: BuildReport → text | markdown | json
```

Separation rationale: the report logic is importable by the future website (#6). The formatter is the piece that gets extended when new scoring data arrives. The CLI is just flag parsing + stdout.

### Data Flow

```
build.json ──→ build metadata (title, class, provenance)
     │
     ├──→ auditBuildFile()  ──→ audit result (resolution buckets + warnings)
     │
     └──→ generateScorecard() ──→ scorecard (perk/curio ratings)
                                        │
                             ┌──────────┘
                             ▼
                      BuildReport
                             │
                     ┌───────┼───────┐
                     ▼       ▼       ▼
                   text   markdown   json
```

## Data Model: BuildReport

```js
{
  // Header
  title: string,
  class: string,
  provenance: { source_url, author, scraped_at },

  // Summary counts
  summary: {
    total: number,
    resolved: number,
    unresolved: number,
    non_canonical: number,
    warnings: string[],
  },

  // Structural slots (ability, blitz, aura, keystone)
  slots: [{ slot, label, entity_id, status }],

  // Talents (flat list, resolved names only)
  talents: [{ label, entity_id, status }],

  // Weapons with scoring
  weapons: [{
    slot: "melee" | "ranged",
    name: string,
    entity_id: string | null,
    perks: [{ label, tier, rating }],
    blessings: [{ label, known: boolean }],
    perk_score: number | null,
  }],

  // Curios with scoring
  curios: [{
    name: string,
    perks: [{ label, tier, rating }],
  }],
  curio_score: number | null,

  // Problems (the actionable part)
  unresolved: [{ field, label, reason }],
  non_canonical: [{ field, label, kind, notes }],
}
```

Assembled in `build-report.mjs` from audit result + build file + scorecard. Formatters never touch raw audit data.

## File Specifications

### `build-report.mjs` (library)

Two exports:

```js
generateReport(buildPath, { index }) → BuildReport
generateBatchReport(dirPath, { index }) → { summary, reports: BuildReport[] }
```

- Calls `auditBuildFile()` (from `build-audit.mjs`) and `generateScorecard()` (from `score-build.mjs`) internally
- Reads build JSON for metadata (title, class, provenance)
- Merges into BuildReport shape
- `generateBatchReport` globs `*.json` in directory, calls `generateReport` for each, computes aggregate summary

### `report-formatter.mjs` (library)

Six exports:

```js
formatText(report) → string
formatMarkdown(report) → string
formatJson(report) → string

formatBatchText(batchReport) → string
formatBatchMarkdown(batchReport) → string
formatBatchJson(batchReport) → string
```

Section order (shared constant across all formats): header → summary → slots → weapons → scores → curios → problems → warnings.

#### Text format

```
══════════════════════════════════════════════════
  Gandalf: Melee Wizard (Updated for Bound by Duty)
  Psyker · by nomalarkey · gameslantern
══════════════════════════════════════════════════

  Summary: 49 resolved · 3 unresolved · 0 non-canonical

  SLOTS
    Ability:   Scrier's Gaze
    Blitz:     Brain Rupture
    Aura:      Prescience
    Keystone:  Disrupt Destiny

  WEAPONS
    [melee] Darktide Mk IV Force Sword
      Perks:     +Damage (Flak) T3 ✓, +Crit Chance T4 ✓
      Blessings: Riposte ✓, Warp Unleashed ✓
    [ranged] Equinox Mk IV Voidstrike Force Staff
      Perks:     +Warp Resist T2 ✓, +Charge Speed T3 ✓
      Blessings: Surge ✓, Warp Nexus ✓

  SCORES
    Perk Optimality:   3.8/5
    Curio Efficiency:  4.2/5

  CURIOS
    Blessed Bullet: +Toughness T3 ✓ optimal, +Combat Ability Regen T2 ✓ good
    Blessed Bullet: +Health T4 ✓ optimal, +Stamina Regen T1 ✓ good
    Blessed Bullet: +Toughness T3 ✓ optimal, +Damage Resist T3 ✓ optimal

  PROBLEMS (3)
    curios[0].name  "Blessed Bullet"  — no match (backend-only item catalog)
    curios[1].name  "Blessed Bullet"  — no match (backend-only item catalog)
    curios[2].name  "Blessed Bullet"  — no match (backend-only item catalog)

  ⚠ Warnings: persisted_unresolved_selection
══════════════════════════════════════════════════
```

#### Markdown format

Same sections using `##` headers, tables for weapons/curios, inline emphasis for status. Renders in GitHub, SvelteKit, or any markdown viewer.

#### Batch text format

Summary table first, then per-build reports:

```
BUILD SUMMARY (23 builds)
  Build                              Class     Resolved  Unresolved  Perks  Curios
  01-block-and-flak-zealot           Zealot    51        3           4.1    3.8
  02-knife-zealot                    Zealot    48        3           3.5    4.2
  ...

  Totals: 1150 resolved · 70 unresolved · 2 non-canonical

[per-build details follow]
```

### `report-build.mjs` (CLI)

```
npm run report -- <build-or-dir> [--format text|md|json]
```

- Detects file vs. directory input
- Loads ground-truth index once via `loadGroundTruthIndex()`
- Calls `generateReport` or `generateBatchReport`
- Calls appropriate formatter
- Writes to stdout
- Uses `parseArgs` from `node:util` (matches `score-build.mjs` pattern)
- Wraps in `runCliMain` from `cli.mjs` for error handling

### package.json addition

```json
"report": "node scripts/report-build.mjs"
```

## Testing

- **Golden output tests**: freeze text/markdown/json output for 2-3 representative builds (one clean, one with unresolved entries, one with non-canonical). Assert exact match.
- **Batch test**: run against `scripts/builds/`, assert summary counts match known totals (1220 resolved, 70 unresolved, 2 non-canonical).
- **Regression**: existing audit and score tests unchanged.

## Extension Point for #7–#9

When buff semantics and scoring land:
1. `build-report.mjs` adds new fields to `BuildReport` (scoring dimensions, synergy data)
2. `report-formatter.mjs` adds new sections to each format function
3. Section order constant updated to include new sections
4. No structural changes to the architecture

## Dependencies

- Depends on: existing `build-audit.mjs`, `score-build.mjs` (as library imports)
- No new runtime dependencies
- Blocks: nothing directly, but provides the presentation layer for #9 scoring output

## Acceptance Criteria

1. `npm run report -- scripts/builds/08-gandalf-melee-wizard.json` produces readable text output
2. `--format md` produces valid markdown with the same information
3. `--format json` produces the BuildReport object
4. `npm run report -- scripts/builds/` produces batch summary + per-build details
5. Golden output tests pass for all three formats
6. Existing `npm test` and `make check` unaffected
7. No runtime dependencies added
