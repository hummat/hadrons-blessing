# Build Browse and Compare — Design Spec

**Issue:** #3 — Add build-oriented commands for browsing and comparing builds
**Date:** 2026-03-31
**Scope:** `list` and `diff` commands. Import/export deferred (existing CLIs cover import; export is a #6 concern).

## Motivation

The CLI pipeline can score, audit, and analyze individual builds, but has no cross-build operations. There's no way to rank builds against each other, filter by class/weapon, or structurally compare two builds. These operations are prerequisites for #6 (website), where list and detail/compare views are core UX.

Building as library modules first (not just CLI wrappers) locks in the data contracts that the website will consume directly via `index.ts`.

## Architecture: Approach B — New Library Modules + Thin CLIs

Two new library modules in `src/lib/`, two thin CLI entry points in `src/cli/`, both exported from `src/lib/index.ts`.

Rationale: Approach A (CLI-only logic) would bury data shapes in formatting code, requiring the website to reimplement. Approach C (extending `build-report.ts`) conflates single-build reporting with cross-build operations. Approach B keeps the library surface clean and testable.

## Module 1: `build-list.ts`

### Purpose

Load all builds from a directory, generate scorecards, return a filterable/sortable array of build summaries.

### `BuildSummary` type

```ts
interface BuildSummary {
  file: string;                  // basename, e.g. "08-gandalf-melee-wizard.json"
  title: string;
  class: string;                 // "psyker", "veteran", etc.
  ability: string | null;        // raw_label
  keystone: string | null;       // raw_label
  weapons: { name: string; slot: string | null; family: string | null }[];
  scores: {
    composite: number;           // /35
    grade: string;               // S/A/B/C/D
    perk_optimality: number;     // /5
    curio_efficiency: number;
    talent_coherence: number | null;
    blessing_synergy: number | null;
    role_coverage: number | null;
    breakpoint_relevance: number | null;
    difficulty_scaling: number | null;
  };
}
```

Intentionally flat — no nested audit/synergy data. This is the "table row" shape. The website renders this as a `<tr>`, the CLI renders it as a formatted line.

### Functions

```ts
function listBuilds(dir: string, options?: ListOptions): BuildSummary[]

interface ListOptions {
  class?: string;           // filter by class name (exact match, case-insensitive)
  weapon?: string;          // filter by weapon name/family (substring match, case-insensitive)
  minGrade?: string;        // filter by minimum letter grade (S > A > B > C > D)
  sort?: string;            // dimension key, default "composite"
  reverse?: boolean;        // ascending instead of descending
}
```

### Scorecard integration

`listBuilds` calls `generateScorecard()` per build with synergy + calc data when available, using the same graceful degradation pattern as `score-build.ts` (try-catch around synergy/calc imports, proceed without qualitative/calculator scores if unavailable).

Filtering and sorting are pure functions on the resulting `BuildSummary[]`.

### Sort keys

Valid sort keys: `composite`, `perk_optimality`, `curio_efficiency`, `talent_coherence`, `blessing_synergy`, `role_coverage`, `breakpoint_relevance`, `difficulty_scaling`. Null dimension scores sort last.

## Module 2: `build-diff.ts`

### Purpose

Compare two builds. Produce score deltas + structural diff. Optionally include analytical diff (synergy edges, breakpoints).

### Types

```ts
interface ScoreDelta {
  dimension: string;
  a: number | null;
  b: number | null;
  delta: number | null;       // b - a, null if either side missing
}

interface StructuralDiff {
  class_match: boolean;       // same class? cross-class diff is valid but flagged
  talents: { only_a: string[]; only_b: string[]; shared: string[] };
  weapons: { only_a: string[]; only_b: string[]; shared: string[] };
  blessings: { only_a: string[]; only_b: string[]; shared: string[] };
  curio_perks: { only_a: string[]; only_b: string[]; shared: string[] };
  ability: { a: string | null; b: string | null; changed: boolean };
  blitz: { a: string | null; b: string | null; changed: boolean };
  aura: { a: string | null; b: string | null; changed: boolean };
  keystone: { a: string | null; b: string | null; changed: boolean };
}

interface AnalyticalDiff {
  synergy_edges: { only_a: string[]; only_b: string[]; shared: string[] };
  breakpoints: {
    label: string;
    a_htk: number | null;
    b_htk: number | null;
    delta: number | null;
  }[];
}

interface BuildDiff {
  a: { file: string; title: string; class: string };
  b: { file: string; title: string; class: string };
  score_deltas: ScoreDelta[];
  structural: StructuralDiff;
  analytical: AnalyticalDiff | null;  // null unless detailed mode
}
```

### Functions

```ts
function diffBuilds(pathA: string, pathB: string, options?: DiffOptions): BuildDiff

interface DiffOptions {
  detailed?: boolean;  // include analytical diff (synergy + breakpoints)
}
```

### Structural diff mechanics

- Uses `canonical_entity_id` for set operations, not raw labels.
- `only_a` / `only_b` / `shared` triple for each category.
- Raw labels preserved for display via lookup from the build JSON.
- Cross-class diff is allowed but flagged via `class_match: false`.

### Analytical diff mechanics

- Synergy edges: runs `analyzeBuild()` on both builds, diffs the edge sets by edge key.
- Breakpoints: runs `computeBreakpoints()` on both builds, compares hits-to-kill for checklist entries (the community-standard breakpoints from `breakpoint-checklist.json`). Full matrix comparison is too noisy — checklist entries are the actionable subset.
- Graceful degradation: if synergy or calc data is unavailable, `analytical` is null.

## CLI 1: `list-builds.ts`

```
npm run list [dir] [--class X] [--weapon X] [--grade X] [--sort X] [--reverse] [--json]
```

- `dir` defaults to `data/builds/`.
- Text output: formatted table — columns: file, class, title (truncated), grade, composite, 7 dimension scores. Null dimensions shown as `-`.
- JSON output: `BuildSummary[]`.
- Uses `runCliMain()` from `cli.ts`.

## CLI 2: `diff-builds.ts`

```
npm run diff -- <build-a> <build-b> [--detailed] [--json]
```

- Text output: header identifying both builds, then score delta table (+/- with sign), then structural diff sections (talents, weapons, blessings, curio perks — each showing added/removed/shared).
- With `--detailed`: appends synergy edge diff and breakpoint comparison.
- JSON output: `BuildDiff`.
- Uses `runCliMain()` from `cli.ts`.

## Library exports

Both modules exported from `src/lib/index.ts`:

```ts
export { listBuilds } from "./build-list.js";
export type { BuildSummary, ListOptions } from "./build-list.js";
export { diffBuilds } from "./build-diff.js";
export type { BuildDiff, DiffOptions } from "./build-diff.js";
```

## Testing

### `build-list.test.ts`

- Unit tests: filtering by class, weapon, grade; sort order; reverse sort; null-dimension sort-last behavior.
- Integration test: `listBuilds("data/builds/")` returns 23 entries, all have valid composite scores and letter grades.
- Graceful degradation: verify list works without source root (qualitative/calc scores null).

### `build-diff.test.ts`

- Unit tests: same-build diff (all deltas zero, everything in `shared`), cross-class diff (flagged), known structural differences between specific build pairs.
- Integration test: diff two known builds, verify key structural differences and score delta signs.
- Detailed mode: verify analytical diff populates when data is available.

### CLI contract

New entries in existing `cli-contract.test.ts` for both `list` and `diff`.

### No frozen snapshots

Output is derived from score snapshots that already have their own regression tests. Adding snapshot tests here would create double-maintenance burden with no additional coverage.

## Deferred

- `build show` (single-build detail view) — `report` already covers this use case.
- `build import` / `build export` — existing CLIs (`extract-build`, `canonicalize-build`, `export-bot-weapons`) handle file-level import/export. Website-specific import/export is a #6 concern.
- Interactive/TUI browse — out of scope for CLI, natural fit for the website.
