# Build Browse and Compare Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `list` and `diff` CLI commands for browsing and comparing builds, backed by library modules exported for website consumption.

**Architecture:** Two library modules (`build-list.ts`, `build-diff.ts`) handle data assembly, filtering, sorting, and diffing. Two thin CLI entry points (`list-builds.ts`, `diff-builds.ts`) parse args and format output. Both library modules are exported from `index.ts` for #6.

**Tech Stack:** TypeScript (strict), Node.js ESM, `node:util/parseArgs` for CLI arg parsing, existing `generateScorecard()` / `analyzeBuild()` / `computeBreakpoints()` for data.

---

### Task 0: Shared scorecard deps helper

**Files:**
- Create: `src/lib/scorecard-deps.ts`

Both `build-list.ts` and `build-diff.ts` need to load synergy/calc data with graceful degradation. This shared helper avoids duplicating the loading logic.

- [ ] **Step 1: Create `scorecard-deps.ts`**

```ts
// src/lib/scorecard-deps.ts
// Shared scorecard dependency loading for build-list and build-diff.
// Static imports + try-catch at call site (not dynamic require — this is ESM).

import { loadIndex, analyzeBuild } from "./synergy-model.js";
import { loadCalculatorData, computeBreakpoints } from "./damage-calculator.js";
import { generateScorecard } from "./score-build.js";

type AnyRecord = Record<string, unknown>;

export interface ScorecardDeps {
  analyzeBuild: ((build: AnyRecord, index: AnyRecord) => AnyRecord) | null;
  computeBreakpoints: ((build: AnyRecord, index: AnyRecord, calcData: AnyRecord) => AnyRecord) | null;
  index: AnyRecord | null;
  calcData: AnyRecord | null;
}

let _cached: ScorecardDeps | null = null;

export function loadScorecardDeps(): ScorecardDeps {
  if (_cached) return _cached;

  const deps: ScorecardDeps = {
    analyzeBuild: null,
    computeBreakpoints: null,
    index: null,
    calcData: null,
  };

  try {
    deps.index = loadIndex() as unknown as AnyRecord;
    deps.analyzeBuild = analyzeBuild as unknown as ScorecardDeps["analyzeBuild"];
  } catch {
    // Synergy data unavailable (e.g. missing generated index)
  }

  try {
    if (!deps.index) {
      deps.index = loadIndex() as unknown as AnyRecord;
    }
    deps.calcData = loadCalculatorData() as unknown as AnyRecord;
    deps.computeBreakpoints = computeBreakpoints as unknown as ScorecardDeps["computeBreakpoints"];
  } catch {
    // Calculator data unavailable
  }

  _cached = deps;
  return deps;
}

export function buildScorecard(build: AnyRecord, deps: ScorecardDeps): AnyRecord {
  let synergyOutput: AnyRecord | null = null;
  if (deps.analyzeBuild && deps.index) {
    try { synergyOutput = deps.analyzeBuild(build, deps.index); } catch { /* skip */ }
  }

  let calcOutput: { matrix: AnyRecord } | null = null;
  if (deps.computeBreakpoints && deps.index && deps.calcData) {
    try { calcOutput = { matrix: deps.computeBreakpoints(build, deps.index, deps.calcData) }; } catch { /* skip */ }
  }

  return generateScorecard(build, synergyOutput, calcOutput) as unknown as AnyRecord;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/lib/scorecard-deps.ts`
Expected: No errors (or only errors about missing upstream types — acceptable at this stage)

- [ ] **Step 3: Commit**

```bash
git add src/lib/scorecard-deps.ts
git commit -m "feat: add shared scorecard-deps helper for build-list and build-diff (#3)"
```

---

### Task 1: `build-list.ts` library module — types and core `listBuilds` function

**Files:**
- Create: `src/lib/build-list.ts`
- Test: `src/lib/build-list.test.ts`

This task creates the library module that loads builds from a directory and produces `BuildSummary[]`. The scorecard integration uses the same graceful degradation pattern as `src/cli/score-build.ts` — try-catch around synergy/calc data loading.

- [ ] **Step 1: Write the failing test — `listBuilds` returns all 23 builds**

```ts
// src/lib/build-list.test.ts
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { listBuilds } from "./build-list.js";

const BUILDS_DIR = "data/builds";

describe("build-list", () => {
  describe("listBuilds", () => {
    it("loads all 23 builds with valid summaries", () => {
      const results = listBuilds(BUILDS_DIR);
      assert.equal(results.length, 23);

      for (const r of results) {
        assert.ok(r.file.endsWith(".json"), `file should end with .json: ${r.file}`);
        assert.ok(r.title.length > 0, `title should be non-empty: ${r.file}`);
        assert.ok(["veteran", "zealot", "psyker", "ogryn", "arbites"].includes(r.class), `unknown class: ${r.class}`);
        assert.ok(typeof r.scores.composite === "number", `composite should be number: ${r.file}`);
        assert.ok(["S", "A", "B", "C", "D"].includes(r.scores.grade), `invalid grade: ${r.scores.grade}`);
        assert.ok(r.scores.perk_optimality >= 1 && r.scores.perk_optimality <= 5, `perk_optimality out of range: ${r.file}`);
        assert.ok(r.scores.curio_efficiency >= 1 && r.scores.curio_efficiency <= 5, `curio_efficiency out of range: ${r.file}`);
        assert.ok(r.weapons.length > 0, `weapons should be non-empty: ${r.file}`);
      }
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test src/lib/build-list.test.ts`
Expected: FAIL — `Cannot find module './build-list.js'`

- [ ] **Step 3: Write the `build-list.ts` module with types and `listBuilds`**

```ts
// src/lib/build-list.ts
import { readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { generateScorecard } from "./score-build.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WeaponSummary {
  name: string;
  slot: string | null;
  family: string | null;
}

export interface BuildScores {
  composite: number;
  grade: string;
  perk_optimality: number;
  curio_efficiency: number;
  talent_coherence: number | null;
  blessing_synergy: number | null;
  role_coverage: number | null;
  breakpoint_relevance: number | null;
  difficulty_scaling: number | null;
}

export interface BuildSummary {
  file: string;
  title: string;
  class: string;
  ability: string | null;
  keystone: string | null;
  weapons: WeaponSummary[];
  scores: BuildScores;
}

export interface ListOptions {
  class?: string;
  weapon?: string;
  minGrade?: string;
  sort?: string;
  reverse?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function selectionLabel(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && typeof (value as Record<string, unknown>).raw_label === "string") {
    return (value as Record<string, unknown>).raw_label as string;
  }
  return null;
}

const GRADE_RANK: Record<string, number> = { S: 5, A: 4, B: 3, C: 2, D: 1 };

const VALID_SORT_KEYS = new Set([
  "composite", "perk_optimality", "curio_efficiency",
  "talent_coherence", "blessing_synergy", "role_coverage",
  "breakpoint_relevance", "difficulty_scaling",
]);

function scoreDimension(scores: BuildScores, key: string): number | null {
  if (key === "composite") return scores.composite;
  return scores[key as keyof BuildScores] as number | null;
}

// ---------------------------------------------------------------------------
// Scorecard data loading (shared helper — see scorecard-deps.ts)
// ---------------------------------------------------------------------------

import { loadScorecardDeps, buildScorecard } from "./scorecard-deps.js";

// ---------------------------------------------------------------------------
// Build → Summary extraction
// ---------------------------------------------------------------------------

function extractSummary(file: string, build: Record<string, unknown>, scorecard: Record<string, unknown>): BuildSummary {
  const weapons: WeaponSummary[] = ((scorecard.weapons ?? []) as Array<Record<string, unknown>>).map((w) => ({
    name: w.name as string,
    slot: (w.slot as string) ?? null,
    family: (w.weapon_family as string) ?? null,
  }));

  const qualitative = (scorecard.qualitative ?? {}) as Record<string, Record<string, unknown> | null>;

  return {
    file,
    title: build.title as string,
    class: selectionLabel(build.class) ?? "unknown",
    ability: selectionLabel(build.ability),
    keystone: selectionLabel(build.keystone),
    weapons,
    scores: {
      composite: scorecard.composite_score as number,
      grade: scorecard.letter_grade as string,
      perk_optimality: scorecard.perk_optimality as number,
      curio_efficiency: scorecard.curio_efficiency as number,
      talent_coherence: (qualitative.talent_coherence?.score as number) ?? null,
      blessing_synergy: (qualitative.blessing_synergy?.score as number) ?? null,
      role_coverage: (qualitative.role_coverage?.score as number) ?? null,
      breakpoint_relevance: (qualitative.breakpoint_relevance?.score as number) ?? null,
      difficulty_scaling: (qualitative.difficulty_scaling?.score as number) ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function listBuilds(dir: string, options: ListOptions = {}): BuildSummary[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const deps = loadScorecardDeps();

  let summaries: BuildSummary[] = files.map((file) => {
    const build = JSON.parse(readFileSync(join(dir, file), "utf-8")) as Record<string, unknown>;
    const scorecard = buildScorecard(build, deps);
    return extractSummary(file, build, scorecard);
  });

  // Filter
  if (options.class) {
    const cls = options.class.toLowerCase();
    summaries = summaries.filter((s) => s.class.toLowerCase() === cls);
  }
  if (options.weapon) {
    const w = options.weapon.toLowerCase();
    summaries = summaries.filter((s) =>
      s.weapons.some((wp) =>
        wp.name.toLowerCase().includes(w) ||
        (wp.family && wp.family.toLowerCase().includes(w))
      )
    );
  }
  if (options.minGrade) {
    const minRank = GRADE_RANK[options.minGrade.toUpperCase()] ?? 0;
    summaries = summaries.filter((s) => (GRADE_RANK[s.scores.grade] ?? 0) >= minRank);
  }

  // Sort
  const sortKey = options.sort ?? "composite";
  if (!VALID_SORT_KEYS.has(sortKey)) {
    throw new Error(`Invalid sort key "${sortKey}". Valid: ${[...VALID_SORT_KEYS].join(", ")}`);
  }
  const direction = options.reverse ? 1 : -1; // default descending
  summaries.sort((a, b) => {
    const va = scoreDimension(a.scores, sortKey);
    const vb = scoreDimension(b.scores, sortKey);
    // Nulls sort last regardless of direction
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va - vb) * direction;
  });

  return summaries;
}
```

**Note:** The `loadScorecardDeps` and `buildScorecard` functions live in the shared `scorecard-deps.ts` helper created in Task 0.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test src/lib/build-list.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/build-list.ts src/lib/build-list.test.ts
git commit -m "feat(list): add build-list library module with listBuilds (#3)"
```

---

### Task 2: `build-list.ts` — filtering and sorting tests

**Files:**
- Modify: `src/lib/build-list.test.ts`

- [ ] **Step 1: Add filtering and sorting tests**

```ts
// Append to the describe("listBuilds") block in src/lib/build-list.test.ts

    it("filters by class", () => {
      const results = listBuilds(BUILDS_DIR, { class: "psyker" });
      assert.ok(results.length > 0, "should have psyker builds");
      assert.ok(results.every((r) => r.class === "psyker"), "all should be psyker");
    });

    it("filters by class case-insensitively", () => {
      const lower = listBuilds(BUILDS_DIR, { class: "psyker" });
      const upper = listBuilds(BUILDS_DIR, { class: "Psyker" });
      assert.equal(lower.length, upper.length);
    });

    it("filters by weapon name substring", () => {
      const results = listBuilds(BUILDS_DIR, { weapon: "bolter" });
      assert.ok(results.length > 0, "should have bolter builds");
      assert.ok(
        results.every((r) => r.weapons.some((w) =>
          w.name.toLowerCase().includes("bolter") ||
          (w.family && w.family.toLowerCase().includes("bolter"))
        )),
        "all should have a bolter weapon",
      );
    });

    it("filters by minimum grade", () => {
      const results = listBuilds(BUILDS_DIR, { minGrade: "A" });
      assert.ok(results.length > 0, "should have A+ builds");
      assert.ok(results.every((r) => ["S", "A"].includes(r.scores.grade)), "all should be A or S");
    });

    it("sorts by composite descending by default", () => {
      const results = listBuilds(BUILDS_DIR);
      for (let i = 1; i < results.length; i++) {
        assert.ok(
          results[i - 1].scores.composite >= results[i].scores.composite,
          `should be descending: ${results[i - 1].scores.composite} >= ${results[i].scores.composite}`,
        );
      }
    });

    it("sorts ascending with reverse flag", () => {
      const results = listBuilds(BUILDS_DIR, { reverse: true });
      for (let i = 1; i < results.length; i++) {
        assert.ok(
          results[i - 1].scores.composite <= results[i].scores.composite,
          `should be ascending: ${results[i - 1].scores.composite} <= ${results[i].scores.composite}`,
        );
      }
    });

    it("sorts by a specific dimension", () => {
      const results = listBuilds(BUILDS_DIR, { sort: "perk_optimality" });
      for (let i = 1; i < results.length; i++) {
        assert.ok(
          results[i - 1].scores.perk_optimality >= results[i].scores.perk_optimality,
          "should sort by perk_optimality descending",
        );
      }
    });

    it("rejects invalid sort key", () => {
      assert.throws(
        () => listBuilds(BUILDS_DIR, { sort: "nonexistent" }),
        /Invalid sort key/,
      );
    });

    it("returns empty array when no builds match filter", () => {
      const results = listBuilds(BUILDS_DIR, { class: "nonexistent_class" });
      assert.equal(results.length, 0);
    });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx tsx --test src/lib/build-list.test.ts`
Expected: All PASS (the implementation from Task 1 already covers filtering/sorting)

- [ ] **Step 3: Commit**

```bash
git add src/lib/build-list.test.ts
git commit -m "test(list): add filtering and sorting tests for build-list (#3)"
```

---

### Task 3: `list-builds.ts` CLI entry point

**Files:**
- Create: `src/cli/list-builds.ts`
- Modify: `package.json` (add `"list"` script)

- [ ] **Step 1: Write the CLI entry point**

```ts
// src/cli/list-builds.ts
import { parseArgs } from "node:util";
import { runCliMain } from "../lib/cli.js";
import { listBuilds } from "../lib/build-list.js";
import type { BuildSummary } from "../lib/build-list.js";

function formatTable(summaries: BuildSummary[]): string {
  const lines: string[] = [];

  // Header
  const hdr = [
    "Grade".padEnd(6),
    "Score".padEnd(6),
    "Class".padEnd(8),
    "PO".padEnd(4),
    "CE".padEnd(4),
    "TC".padEnd(4),
    "BS".padEnd(4),
    "RC".padEnd(4),
    "BR".padEnd(4),
    "DS".padEnd(4),
    "Title",
  ];
  lines.push(hdr.join(""));
  lines.push("-".repeat(72));

  for (const s of summaries) {
    const dim = (v: number | null) => v != null ? String(v).padEnd(4) : "-".padEnd(4);
    const row = [
      s.scores.grade.padEnd(6),
      String(s.scores.composite).padEnd(6),
      s.class.padEnd(8),
      dim(s.scores.perk_optimality),
      dim(s.scores.curio_efficiency),
      dim(s.scores.talent_coherence),
      dim(s.scores.blessing_synergy),
      dim(s.scores.role_coverage),
      dim(s.scores.breakpoint_relevance),
      dim(s.scores.difficulty_scaling),
      s.title.length > 40 ? s.title.slice(0, 37) + "..." : s.title,
    ];
    lines.push(row.join(""));
  }

  lines.push("");
  lines.push(`${summaries.length} build(s)`);

  return lines.join("\n");
}

await runCliMain("list", async () => {
  const { values, positionals } = parseArgs({
    options: {
      class: { type: "string" },
      weapon: { type: "string" },
      grade: { type: "string" },
      sort: { type: "string" },
      reverse: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const dir = positionals[0] ?? "data/builds";

  const summaries = listBuilds(dir, {
    class: values.class as string | undefined,
    weapon: values.weapon as string | undefined,
    minGrade: values.grade as string | undefined,
    sort: values.sort as string | undefined,
    reverse: values.reverse as boolean | undefined,
  });

  if (values.json) {
    console.log(JSON.stringify(summaries, null, 2));
  } else {
    console.log(formatTable(summaries));
  }
});
```

- [ ] **Step 2: Add `list` script to `package.json`**

Add this entry to the `"scripts"` object in `package.json`:

```json
"list": "node dist/cli/list-builds.js",
```

- [ ] **Step 3: Build and test the CLI manually**

Run: `npm run build && npm run list`
Expected: Table of 23 builds sorted by composite score descending.

Run: `npm run list -- --class psyker`
Expected: Only psyker builds shown.

Run: `npm run list -- --json | head -20`
Expected: JSON array of `BuildSummary` objects.

- [ ] **Step 4: Commit**

```bash
git add src/cli/list-builds.ts package.json
git commit -m "feat(list): add list-builds CLI with table and JSON output (#3)"
```

---

### Task 4: `build-diff.ts` library module — structural diff

**Files:**
- Create: `src/lib/build-diff.ts`
- Test: `src/lib/build-diff.test.ts`

This task creates the core diff module. Structural diff is the default; analytical diff (Task 5) is behind a flag.

- [ ] **Step 1: Write the failing test — same-build diff**

```ts
// src/lib/build-diff.test.ts
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { diffBuilds } from "./build-diff.js";

const BUILD_08 = "data/builds/08-gandalf-melee-wizard.json";
const BUILD_01 = "data/builds/01-veteran-squad-leader.json";

describe("build-diff", () => {
  describe("diffBuilds", () => {
    it("same-build diff has zero score deltas and everything shared", () => {
      const diff = diffBuilds(BUILD_08, BUILD_08);
      assert.ok(diff.structural.class_match, "same class should match");
      assert.equal(diff.structural.ability.changed, false);
      assert.equal(diff.structural.blitz.changed, false);
      assert.equal(diff.structural.aura.changed, false);
      assert.equal(diff.structural.keystone.changed, false);
      assert.equal(diff.structural.talents.only_a.length, 0);
      assert.equal(diff.structural.talents.only_b.length, 0);
      assert.ok(diff.structural.talents.shared.length > 0, "should have shared talents");
      assert.equal(diff.structural.weapons.only_a.length, 0);
      assert.equal(diff.structural.weapons.only_b.length, 0);

      for (const d of diff.score_deltas) {
        if (d.delta != null) {
          assert.equal(d.delta, 0, `${d.dimension} delta should be 0`);
        }
      }
    });

    it("cross-class diff is flagged", () => {
      const diff = diffBuilds(BUILD_08, BUILD_01);
      assert.equal(diff.structural.class_match, false);
    });

    it("cross-class diff has structural differences", () => {
      const diff = diffBuilds(BUILD_08, BUILD_01);
      assert.ok(diff.structural.ability.changed, "different classes should have different abilities");
      assert.ok(diff.structural.talents.only_a.length > 0, "should have talents only in build A");
      assert.ok(diff.structural.talents.only_b.length > 0, "should have talents only in build B");
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test src/lib/build-diff.test.ts`
Expected: FAIL — `Cannot find module './build-diff.js'`

- [ ] **Step 3: Write the `build-diff.ts` module**

```ts
// src/lib/build-diff.ts
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { loadScorecardDeps, buildScorecard } from "./scorecard-deps.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScoreDelta {
  dimension: string;
  a: number | null;
  b: number | null;
  delta: number | null;
}

interface SetDiff {
  only_a: string[];
  only_b: string[];
  shared: string[];
}

interface SlotDiff {
  a: string | null;
  b: string | null;
  changed: boolean;
}

export interface StructuralDiff {
  class_match: boolean;
  talents: SetDiff;
  weapons: SetDiff;
  blessings: SetDiff;
  curio_perks: SetDiff;
  ability: SlotDiff;
  blitz: SlotDiff;
  aura: SlotDiff;
  keystone: SlotDiff;
}

export interface BreakpointDelta {
  label: string;
  a_htk: number | null;
  b_htk: number | null;
  delta: number | null;
}

export interface AnalyticalDiff {
  synergy_edges: SetDiff;
  breakpoints: BreakpointDelta[];
}

export interface BuildDiff {
  a: { file: string; title: string; class: string };
  b: { file: string; title: string; class: string };
  score_deltas: ScoreDelta[];
  structural: StructuralDiff;
  analytical: AnalyticalDiff | null;
}

export interface DiffOptions {
  detailed?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AnyRecord = Record<string, unknown>;

function selectionLabel(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && typeof (value as AnyRecord).raw_label === "string") {
    return (value as AnyRecord).raw_label as string;
  }
  return null;
}

function selectionEntityId(value: unknown): string | null {
  if (value != null && typeof value === "object" && typeof (value as AnyRecord).canonical_entity_id === "string") {
    return (value as AnyRecord).canonical_entity_id as string;
  }
  return null;
}

function computeSetDiff(idsA: string[], idsB: string[]): SetDiff {
  const setA = new Set(idsA);
  const setB = new Set(idsB);
  return {
    only_a: idsA.filter((id) => !setB.has(id)),
    only_b: idsB.filter((id) => !setA.has(id)),
    shared: idsA.filter((id) => setB.has(id)),
  };
}

function slotDiff(a: unknown, b: unknown): SlotDiff {
  const idA = selectionEntityId(a);
  const idB = selectionEntityId(b);
  return { a: selectionLabel(a), b: selectionLabel(b), changed: idA !== idB };
}

function collectEntityIds(selections: unknown[]): string[] {
  return selections
    .map((s) => selectionEntityId(s))
    .filter((id): id is string => id != null);
}

function collectBlessingIds(build: AnyRecord): string[] {
  const weapons = (build.weapons ?? []) as Array<AnyRecord>;
  return weapons.flatMap((w) =>
    ((w.blessings ?? []) as Array<AnyRecord>)
      .map((b) => selectionEntityId(b))
      .filter((id): id is string => id != null)
  );
}

function collectCurioPerkLabels(build: AnyRecord): string[] {
  const curios = (build.curios ?? []) as Array<AnyRecord>;
  return curios.flatMap((c) =>
    ((c.perks ?? []) as Array<unknown>).map((p) => {
      if (typeof p === "string") return p;
      if (p != null && typeof p === "object") {
        return selectionEntityId(p) ?? (p as AnyRecord).raw_label as string ?? String(p);
      }
      return String(p);
    })
  );
}

// ---------------------------------------------------------------------------
// Score delta computation
// ---------------------------------------------------------------------------

const DIMENSIONS = [
  "composite_score", "perk_optimality", "curio_efficiency",
  "talent_coherence", "blessing_synergy", "role_coverage",
  "breakpoint_relevance", "difficulty_scaling",
] as const;

const DIMENSION_DISPLAY: Record<string, string> = {
  composite_score: "composite",
  perk_optimality: "perk_optimality",
  curio_efficiency: "curio_efficiency",
  talent_coherence: "talent_coherence",
  blessing_synergy: "blessing_synergy",
  role_coverage: "role_coverage",
  breakpoint_relevance: "breakpoint_relevance",
  difficulty_scaling: "difficulty_scaling",
};

function extractScore(scorecard: AnyRecord, dimension: string): number | null {
  if (dimension === "composite_score") return scorecard.composite_score as number;
  if (dimension === "perk_optimality") return scorecard.perk_optimality as number;
  if (dimension === "curio_efficiency") return scorecard.curio_efficiency as number;
  const qual = (scorecard.qualitative ?? {}) as Record<string, AnyRecord | null>;
  return (qual[dimension]?.score as number) ?? null;
}

function computeScoreDeltas(scorecardA: AnyRecord, scorecardB: AnyRecord): ScoreDelta[] {
  return DIMENSIONS.map((dim) => {
    const a = extractScore(scorecardA, dim);
    const b = extractScore(scorecardB, dim);
    return {
      dimension: DIMENSION_DISPLAY[dim] ?? dim,
      a,
      b,
      delta: a != null && b != null ? b - a : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function diffBuilds(pathA: string, pathB: string, options: DiffOptions = {}): BuildDiff {
  const buildA = JSON.parse(readFileSync(pathA, "utf-8")) as AnyRecord;
  const buildB = JSON.parse(readFileSync(pathB, "utf-8")) as AnyRecord;

  const deps = loadScorecardDeps();
  const scorecardA = buildScorecard(buildA, deps);
  const scorecardB = buildScorecard(buildB, deps);

  const classA = selectionLabel(buildA.class) ?? "unknown";
  const classB = selectionLabel(buildB.class) ?? "unknown";

  // Structural diff
  const talentIdsA = collectEntityIds((buildA.talents ?? []) as unknown[]);
  const talentIdsB = collectEntityIds((buildB.talents ?? []) as unknown[]);

  const weaponIdsA = ((buildA.weapons ?? []) as AnyRecord[]).map((w) => selectionEntityId(w.name)).filter((id): id is string => id != null);
  const weaponIdsB = ((buildB.weapons ?? []) as AnyRecord[]).map((w) => selectionEntityId(w.name)).filter((id): id is string => id != null);

  const structural: StructuralDiff = {
    class_match: classA.toLowerCase() === classB.toLowerCase(),
    talents: computeSetDiff(talentIdsA, talentIdsB),
    weapons: computeSetDiff(weaponIdsA, weaponIdsB),
    blessings: computeSetDiff(collectBlessingIds(buildA), collectBlessingIds(buildB)),
    curio_perks: computeSetDiff(collectCurioPerkLabels(buildA), collectCurioPerkLabels(buildB)),
    ability: slotDiff(buildA.ability, buildB.ability),
    blitz: slotDiff(buildA.blitz, buildB.blitz),
    aura: slotDiff(buildA.aura, buildB.aura),
    keystone: slotDiff(buildA.keystone, buildB.keystone),
  };

  // Analytical diff (deferred to Task 5)
  let analytical: AnalyticalDiff | null = null;
  if (options.detailed) {
    analytical = computeAnalyticalDiff(buildA, buildB);
  }

  return {
    a: { file: basename(pathA), title: buildA.title as string, class: classA },
    b: { file: basename(pathB), title: buildB.title as string, class: classB },
    score_deltas: computeScoreDeltas(scorecardA, scorecardB),
    structural,
    analytical,
  };
}

// Stub for Task 5 — analytical diff
function computeAnalyticalDiff(_buildA: AnyRecord, _buildB: AnyRecord): AnalyticalDiff | null {
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test src/lib/build-diff.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/build-diff.ts src/lib/build-diff.test.ts
git commit -m "feat(diff): add build-diff library module with structural diff (#3)"
```

---

### Task 5: `build-diff.ts` — analytical diff (detailed mode)

**Files:**
- Modify: `src/lib/build-diff.ts` (replace `computeAnalyticalDiff` stub)
- Modify: `src/lib/build-diff.test.ts`

This task fills in the `--detailed` path: synergy edge diff and breakpoint checklist comparison.

- [ ] **Step 1: Add analytical diff tests**

```ts
// Append to describe("diffBuilds") in src/lib/build-diff.test.ts

    it("analytical diff is null by default", () => {
      const diff = diffBuilds(BUILD_08, BUILD_01);
      assert.equal(diff.analytical, null);
    });

    it("detailed mode produces analytical diff when data is available", () => {
      const diff = diffBuilds(BUILD_08, BUILD_01, { detailed: true });
      // analytical may be null if synergy/calc data unavailable — test shape when present
      if (diff.analytical) {
        assert.ok(Array.isArray(diff.analytical.synergy_edges.only_a));
        assert.ok(Array.isArray(diff.analytical.synergy_edges.only_b));
        assert.ok(Array.isArray(diff.analytical.synergy_edges.shared));
        assert.ok(Array.isArray(diff.analytical.breakpoints));

        for (const bp of diff.analytical.breakpoints) {
          assert.ok(typeof bp.label === "string");
          assert.ok(bp.a_htk === null || typeof bp.a_htk === "number");
          assert.ok(bp.b_htk === null || typeof bp.b_htk === "number");
        }
      }
    });

    it("same-build detailed diff has all synergy edges shared", () => {
      const diff = diffBuilds(BUILD_08, BUILD_08, { detailed: true });
      if (diff.analytical) {
        assert.equal(diff.analytical.synergy_edges.only_a.length, 0);
        assert.equal(diff.analytical.synergy_edges.only_b.length, 0);
        for (const bp of diff.analytical.breakpoints) {
          if (bp.delta != null) {
            assert.equal(bp.delta, 0, `breakpoint ${bp.label} delta should be 0`);
          }
        }
      }
    });
```

- [ ] **Step 2: Run tests to see the analytical tests pass vacuously (null path)**

Run: `npx tsx --test src/lib/build-diff.test.ts`
Expected: PASS (analytical is null from stub, conditional tests skip)

- [ ] **Step 3: Implement `computeAnalyticalDiff`**

Replace the stub `computeAnalyticalDiff` in `src/lib/build-diff.ts` with the real implementation. The function should:

1. **Synergy edge diff:** Call `deps.analyzeBuild` on both builds. Extract `synergy_edges` arrays. Create a string key for each edge (e.g. `"${edge.type}:${edge.selections.sort().join(',')}"`). Run `computeSetDiff` on the key arrays.

2. **Breakpoint diff:** Call `deps.computeBreakpoints` on both builds. Load the breakpoint checklist from `data/ground-truth/breakpoint-checklist.json`. For each checklist entry, find the best (lowest) hits-to-kill from each build's matrix at damnation difficulty. Return `BreakpointDelta[]`.

The implementing agent should read `src/lib/breakpoint-checklist.ts` (the `loadChecklist()` function and `scoreBreakpointRelevance` logic, lines 183-256) to understand how checklist entries map to matrix data. The key fields are: `checklist[].breed`, `checklist[].hitzone`, `checklist[].action_category`, `checklist[].max_htk`.

If synergy or calc data is unavailable, return `null`.

- [ ] **Step 4: Run the full test suite**

Run: `npx tsx --test src/lib/build-diff.test.ts`
Expected: All PASS (including analytical diff tests when data is available)

- [ ] **Step 5: Commit**

```bash
git add src/lib/build-diff.ts src/lib/build-diff.test.ts
git commit -m "feat(diff): add analytical diff with synergy edges and breakpoints (#3)"
```

---

### Task 6: `diff-builds.ts` CLI entry point

**Files:**
- Create: `src/cli/diff-builds.ts`
- Modify: `package.json` (add `"diff"` script)

- [ ] **Step 1: Write the CLI entry point**

```ts
// src/cli/diff-builds.ts
import { parseArgs } from "node:util";
import { runCliMain } from "../lib/cli.js";
import { diffBuilds } from "../lib/build-diff.js";
import type { BuildDiff, ScoreDelta, StructuralDiff } from "../lib/build-diff.js";

function formatScoreDeltas(deltas: ScoreDelta[]): string {
  const lines: string[] = [];
  lines.push("SCORE COMPARISON:");

  const nameWidth = 22;
  lines.push(
    "  " + "Dimension".padEnd(nameWidth) + "A".padEnd(6) + "B".padEnd(6) + "Delta",
  );
  lines.push("  " + "-".repeat(42));

  for (const d of deltas) {
    const aStr = d.a != null ? String(d.a) : "-";
    const bStr = d.b != null ? String(d.b) : "-";
    let deltaStr = "-";
    if (d.delta != null) {
      const sign = d.delta > 0 ? "+" : "";
      deltaStr = `${sign}${d.delta}`;
    }
    lines.push(
      "  " + d.dimension.padEnd(nameWidth) + aStr.padEnd(6) + bStr.padEnd(6) + deltaStr,
    );
  }

  return lines.join("\n");
}

function formatSetDiff(label: string, diff: { only_a: string[]; only_b: string[]; shared: string[] }): string {
  const lines: string[] = [];
  lines.push(`${label}:`);
  if (diff.only_a.length > 0) lines.push(`  Only A: ${diff.only_a.join(", ")}`);
  if (diff.only_b.length > 0) lines.push(`  Only B: ${diff.only_b.join(", ")}`);
  lines.push(`  Shared: ${diff.shared.length} item(s)`);
  return lines.join("\n");
}

function formatStructuralDiff(s: StructuralDiff): string {
  const lines: string[] = [];
  lines.push("STRUCTURAL DIFF:");

  if (!s.class_match) {
    lines.push("  WARNING: Cross-class comparison");
  }

  const slots = [
    { name: "Ability", slot: s.ability },
    { name: "Blitz", slot: s.blitz },
    { name: "Aura", slot: s.aura },
    { name: "Keystone", slot: s.keystone },
  ];
  for (const { name, slot } of slots) {
    if (slot.changed) {
      lines.push(`  ${name}: ${slot.a ?? "(none)"} -> ${slot.b ?? "(none)"}`);
    }
  }

  lines.push("");
  lines.push("  " + formatSetDiff("Talents", s.talents).replace(/\n/g, "\n  "));
  lines.push("  " + formatSetDiff("Weapons", s.weapons).replace(/\n/g, "\n  "));
  lines.push("  " + formatSetDiff("Blessings", s.blessings).replace(/\n/g, "\n  "));
  lines.push("  " + formatSetDiff("Curio Perks", s.curio_perks).replace(/\n/g, "\n  "));

  return lines.join("\n");
}

function formatDiffText(diff: BuildDiff): string {
  const lines: string[] = [];
  lines.push(`=== DIFF: ${diff.a.title} (${diff.a.class}) vs ${diff.b.title} (${diff.b.class}) ===`);
  lines.push("");
  lines.push(formatScoreDeltas(diff.score_deltas));
  lines.push("");
  lines.push(formatStructuralDiff(diff.structural));

  if (diff.analytical) {
    lines.push("");
    lines.push("ANALYTICAL DIFF:");
    lines.push("  " + formatSetDiff("Synergy Edges", diff.analytical.synergy_edges).replace(/\n/g, "\n  "));

    if (diff.analytical.breakpoints.length > 0) {
      lines.push("");
      lines.push("  Breakpoints:");
      for (const bp of diff.analytical.breakpoints) {
        const aStr = bp.a_htk != null ? String(bp.a_htk) : "-";
        const bStr = bp.b_htk != null ? String(bp.b_htk) : "-";
        let deltaStr = "";
        if (bp.delta != null && bp.delta !== 0) {
          const sign = bp.delta > 0 ? "+" : "";
          deltaStr = ` (${sign}${bp.delta})`;
        }
        lines.push(`    ${bp.label}: ${aStr} -> ${bStr}${deltaStr}`);
      }
    }
  }

  return lines.join("\n");
}

await runCliMain("diff", async () => {
  const { values, positionals } = parseArgs({
    options: {
      detailed: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  if (positionals.length < 2) {
    throw new Error("Usage: npm run diff -- <build-a.json> <build-b.json> [--detailed] [--json]");
  }

  const diff = diffBuilds(positionals[0], positionals[1], {
    detailed: values.detailed as boolean,
  });

  if (values.json) {
    console.log(JSON.stringify(diff, null, 2));
  } else {
    console.log(formatDiffText(diff));
  }
});
```

- [ ] **Step 2: Add `diff` script to `package.json`**

Add this entry to the `"scripts"` object in `package.json`:

```json
"diff": "node dist/cli/diff-builds.js",
```

- [ ] **Step 3: Build and test the CLI manually**

Run: `npm run build && npm run diff -- data/builds/08-gandalf-melee-wizard.json data/builds/01-veteran-squad-leader.json`
Expected: Score comparison table + structural diff showing cross-class differences.

Run: `npm run diff -- data/builds/08-gandalf-melee-wizard.json data/builds/09-electrodominance-psyker.json`
Expected: Same-class comparison with shared talents/weapons highlighted.

- [ ] **Step 4: Commit**

```bash
git add src/cli/diff-builds.ts package.json
git commit -m "feat(diff): add diff-builds CLI with text and JSON output (#3)"
```

---

### Task 7: Library exports and CLI contract tests

**Files:**
- Modify: `src/lib/index.ts`
- Modify: `src/cli/cli-contract.test.ts`

- [ ] **Step 1: Add exports to `index.ts`**

Append to `src/lib/index.ts`:

```ts
// Browse & compare
export { listBuilds } from "./build-list.js";
export type { BuildSummary, ListOptions, BuildScores, WeaponSummary } from "./build-list.js";
export { diffBuilds } from "./build-diff.js";
export type { BuildDiff, DiffOptions, ScoreDelta, StructuralDiff, AnalyticalDiff, BreakpointDelta } from "./build-diff.js";
```

- [ ] **Step 2: Add CLI contract tests**

Append to `src/cli/cli-contract.test.ts`:

```ts
describe("CLI contract — list and diff", () => {
  it("list exits zero with default args", () => {
    const result = runCli("src/cli/list-builds.ts", ["data/builds"]);
    // May fail if source root is required — check for non-crash at minimum
    // The list command uses graceful degradation, so it should work without source root
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes("build(s)"), "should show build count");
  });

  it("list --json exits zero and produces valid JSON", () => {
    const result = runCli("src/cli/list-builds.ts", ["data/builds", "--json"]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.ok(Array.isArray(parsed), "should produce an array");
    assert.equal(parsed.length, 23);
  });

  it("diff exits zero with two builds", () => {
    const result = runCli("src/cli/diff-builds.ts", [
      "data/builds/08-gandalf-melee-wizard.json",
      "data/builds/01-veteran-squad-leader.json",
    ]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes("DIFF:"), "should show diff header");
  });

  it("diff --json exits zero and produces valid JSON", () => {
    const result = runCli("src/cli/diff-builds.ts", [
      "data/builds/08-gandalf-melee-wizard.json",
      "data/builds/01-veteran-squad-leader.json",
      "--json",
    ]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.a, "should have build A metadata");
    assert.ok(parsed.b, "should have build B metadata");
    assert.ok(Array.isArray(parsed.score_deltas), "should have score deltas");
  });

  it("diff exits non-zero with missing arguments", () => {
    const result = runCli("src/cli/diff-builds.ts", []);
    assert.notEqual(result.status, 0);
  });
});
```

**Note:** The `runCli` helper in `cli-contract.test.ts` sets `GROUND_TRUTH_SOURCE_ROOT=/nonexistent/source-root`. The `list` and `diff` commands use graceful degradation, so they should succeed (qualitative scores will be null). If the existing `runCli` helper causes issues because the nonexistent source root triggers errors in the synergy/calc loading path, the implementing agent may need to set `GROUND_TRUTH_SOURCE_ROOT=` (empty) instead, or adjust the graceful degradation to handle this case. Check the actual error behavior.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: All tests pass, including the new CLI contract tests.

- [ ] **Step 4: Commit**

```bash
git add src/lib/index.ts src/cli/cli-contract.test.ts
git commit -m "feat: export list/diff from library, add CLI contract tests (#3)"
```

---

### Task 8: Full quality gate and CLAUDE.md update

**Files:**
- Modify: `CLAUDE.md` (update commands section and completed issues)

- [ ] **Step 1: Run the full quality gate**

Run: `make check`
Expected: All pass (edges + effects + breeds + profiles + stagger + check). This validates that the new modules don't break any existing tests.

- [ ] **Step 2: Update `CLAUDE.md`**

Add the new CLI commands to the Commands section:

```bash
npm run list [dir] [--class X] [--weapon X] [--grade X] [--sort X] [--reverse] [--json]
npm run diff -- <build-a> <build-b> [--detailed] [--json]
```

Move `#3` from Open Issues to Completed Issues. Add a brief description:

```
- `#3` Build-oriented CLI commands (browse/compare: `list` filterable build table with 7-dimension scores, `diff` structural + analytical build comparison)
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for list and diff commands (#3)"
```

- [ ] **Step 4: Close the issue**

Run: `gh issue close 3 --comment "Implemented in main: list (filterable/sortable build table) and diff (structural + analytical comparison). Library modules exported from index.ts for #6 website consumption."`
