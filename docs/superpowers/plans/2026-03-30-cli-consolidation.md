# CLI Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `src/cli/` from 31 to 24 files by merging 4 calculator CLIs into one, deleting 3 dead maintenance scripts, and absorbing `freeze-scores.ts` into `score-build.ts`.

**Architecture:** A unified `calc-build.ts` uses a `ModeConfig` dispatch table to select compute function + text formatter per `--mode` flag. The shared harness (arg parsing, file/dir iteration, freeze writes) is written once. `score-build.ts` gains directory iteration and `--freeze` support matching the calculator pattern.

**Tech Stack:** TypeScript (strict), Node.js ESM, `node:util` parseArgs

---

## File Map

**Modified:**
- `src/cli/calc-build.ts` — rewritten: unified calculator with `--mode damage|stagger|cleave|toughness`
- `src/cli/score-build.ts` — add directory iteration, `--freeze` flag, `runCliMain` wrapper
- `package.json` — update npm script aliases
- `src/lib/cli.ts` — add setup hints for new modes
- `CLAUDE.md` — update commands section

**Deleted:**
- `src/cli/stagger-build.ts`
- `src/cli/cleave-build.ts`
- `src/cli/toughness-build.ts`
- `src/cli/freeze-scores.ts`
- `src/cli/fix-malformed-slugs.ts`
- `src/cli/migrate-build-fixtures.ts`
- `src/cli/generate-missing-entities.ts`
- `src/lib/fix-malformed-slugs.test.ts`

---

### Task 1: Delete dead maintenance scripts

**Files:**
- Delete: `src/cli/fix-malformed-slugs.ts`
- Delete: `src/cli/migrate-build-fixtures.ts`
- Delete: `src/cli/generate-missing-entities.ts`
- Delete: `src/lib/fix-malformed-slugs.test.ts`
- Modify: `package.json` (remove `entities:fix-slugs` script)

- [ ] **Step 1: Remove the npm script alias**

In `package.json`, delete the line:
```json
"entities:fix-slugs": "node dist/cli/fix-malformed-slugs.js",
```

- [ ] **Step 2: Delete the 4 files**

```bash
rm src/cli/fix-malformed-slugs.ts src/cli/migrate-build-fixtures.ts src/cli/generate-missing-entities.ts src/lib/fix-malformed-slugs.test.ts
```

- [ ] **Step 3: Run tests to verify nothing breaks**

```bash
npm test
```

Expected: all tests pass. No other file imports from these modules.

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "chore: delete dead maintenance scripts (#18)

Remove fix-malformed-slugs, migrate-build-fixtures, generate-missing-entities
and their tests. All were one-off scripts that completed their work."
```

---

### Task 2: Unify calculator CLIs into single entry point

**Files:**
- Rewrite: `src/cli/calc-build.ts`
- Delete: `src/cli/stagger-build.ts`
- Delete: `src/cli/cleave-build.ts`
- Delete: `src/cli/toughness-build.ts`
- Modify: `src/lib/cli.ts` (add setup hints for stagger/cleave/toughness modes)
- Modify: `package.json` (update aliases)

- [ ] **Step 1: Update `src/lib/cli.ts` setup hints**

Add entries for the new modes so error messages show helpful usage:

```typescript
stagger:
  "GROUND_TRUTH_SOURCE_ROOT=/path/to/Darktide-Source-Code npm run stagger -- data/builds/08-gandalf-melee-wizard.json",
cleave:
  "GROUND_TRUTH_SOURCE_ROOT=/path/to/Darktide-Source-Code npm run cleave -- data/builds/08-gandalf-melee-wizard.json",
toughness:
  "GROUND_TRUTH_SOURCE_ROOT=/path/to/Darktide-Source-Code npm run toughness -- data/builds/08-gandalf-melee-wizard.json",
```

- [ ] **Step 2: Rewrite `src/cli/calc-build.ts`**

The new file must:
1. Define a `ModeConfig` interface with fields: `compute`, `formatText`, `freezeDir`, `snapshotSuffix`, `label`
2. Import compute functions from all 4 library modules
3. Define text formatters for each mode (ported from the deleted files)
4. Build a `MODES` record mapping `"damage" | "stagger" | "cleave" | "toughness"` to their configs
5. Parse `--mode` (default `"damage"`), `--json`, `--text`, `--freeze`, `--compare`
6. Validate `--compare` only with `--mode damage`
7. Use a single shared harness for file/dir iteration, freeze writes, JSON output

Key structural decisions:
- Each mode's `compute` function has a different signature (stagger needs `staggerSettings`, toughness doesn't need `calcData`). The harness loads all data upfront and each compute wrapper picks what it needs.
- The `formatText` function signature is `(result: AnyRecord, build: AnyRecord) => string` — uniform across modes. For damage mode, `result` is the breakpoint matrix. For others, it's whatever their compute function returns.
- The compare feature (damage-only) stays as a special case inside the CLI, not in the mode config.

The full file structure:

```typescript
// Unified calculator CLI — run damage/stagger/cleave/toughness analysis on a build or directory.
// Usage: npm run calc -- <build|dir> [--mode damage|stagger|cleave|toughness] [--json|--text] [--freeze] [--compare <file>]

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { parseArgs } from "node:util";
import { runCliMain } from "../lib/cli.js";
import { loadIndex } from "../lib/synergy-model.js";
import { loadCalculatorData, computeBreakpoints, summarizeBreakpoints } from "../lib/damage-calculator.js";
import { computeStaggerMatrix, loadStaggerSettings } from "../lib/stagger-calculator.js";
import { computeCleaveMatrix } from "../lib/cleave-calculator.js";
import { computeSurvivability } from "../lib/toughness-calculator.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

// ── Shared helpers ───────────────────────────────────────────────────

function selectionLabel(value: unknown): string {
  if (typeof value === "string") return value;
  if (value != null && typeof value === "object" && typeof (value as AnyRecord).raw_label === "string") {
    return (value as AnyRecord).raw_label as string;
  }
  return "";
}

/** JSON replacer that preserves Infinity as the string "Infinity". */
function calcReplacer(_key: string, value: unknown): unknown {
  if (value === Infinity) return "Infinity";
  return value;
}

// ── Shared display data ──────────────────────────────────────────────

const CHECKLIST_BREEDS = [
  "renegade_berzerker", "chaos_ogryn_executor", "chaos_poxwalker",
  "renegade_executor", "chaos_ogryn_bulwark", "renegade_netgunner",
  "chaos_hound", "chaos_poxwalker_bomber", "renegade_sniper",
];

const BREED_DISPLAY: Record<string, { name: string; armor: string | null }> = {
  renegade_berzerker: { name: "Rager", armor: "Flak" },
  chaos_ogryn_executor: { name: "Crusher", armor: "Carapace" },
  chaos_poxwalker: { name: "Poxwalker", armor: null },
  renegade_executor: { name: "Mauler", armor: "Flak" },
  chaos_ogryn_bulwark: { name: "Bulwark", armor: "Carapace" },
  renegade_netgunner: { name: "Trapper", armor: "Flak" },
  chaos_hound: { name: "Hound", armor: null },
  chaos_poxwalker_bomber: { name: "Bomber", armor: null },
  renegade_sniper: { name: "Sniper", armor: "Flak" },
};

// ── Damage mode formatter ────────────────────────────────────────────
// (Port formatCalcText, extractChecklistBreakpoints, formatHitsToKill,
//  formatCompare from current calc-build.ts — identical logic)

// ... SCENARIO_DISPLAY, formatHitsToKill, extractChecklistBreakpoints,
// ... formatCalcText, formatCompare — copy verbatim from current calc-build.ts

// ── Stagger mode formatter ───────────────────────────────────────────
// (Port formatStaggerText, extractChecklistStagger, collectActionTypes
//  from current stagger-build.ts — identical logic)

// ── Cleave mode formatter ────────────────────────────────────────────
// (Port formatCleaveText from current cleave-build.ts — identical logic)

// ── Toughness mode formatter ─────────────────────────────────────────
// (Port formatToughnessText, formatDRValue from current toughness-build.ts
//  — identical logic)

// ── Mode configuration ──────────────────────────────────────────────

interface ModeConfig {
  compute: (build: AnyRecord, deps: ComputeDeps) => AnyRecord;
  formatText: (result: AnyRecord, build: AnyRecord) => string;
  freezeDir: string;
  snapshotSuffix: string;
  label: string;
}

interface ComputeDeps {
  index: AnyRecord;
  calcData: AnyRecord;
  staggerSettings: AnyRecord;
}

const MODES: Record<string, ModeConfig> = {
  damage: {
    compute: (build, deps) => computeBreakpoints(build, deps.index, deps.calcData),
    formatText: formatCalcText,
    freezeDir: "tests/fixtures/ground-truth/calc",
    snapshotSuffix: ".calc.json",
    label: "Breakpoint Calculator",
  },
  stagger: {
    compute: (build, deps) => computeStaggerMatrix(build, deps.index, deps.calcData, deps.staggerSettings),
    formatText: formatStaggerText,
    freezeDir: "tests/fixtures/ground-truth/stagger",
    snapshotSuffix: ".stagger.json",
    label: "Stagger Analysis",
  },
  cleave: {
    compute: (build, deps) => computeCleaveMatrix(build, deps.index, deps.calcData),
    formatText: formatCleaveText,
    freezeDir: "tests/fixtures/ground-truth/cleave",
    snapshotSuffix: ".cleave.json",
    label: "Cleave Analysis",
  },
  toughness: {
    compute: (build, deps) => computeSurvivability(build, deps.index),
    formatText: formatToughnessText,
    freezeDir: "tests/fixtures/ground-truth/toughness",
    snapshotSuffix: ".toughness.json",
    label: "Survivability Analysis",
  },
};

// ── CLI ──────────────────────────────────────────────────────────────

await runCliMain("calc", async () => {
  const { values, positionals } = parseArgs({
    options: {
      mode: { type: "string", default: "damage" },
      json: { type: "boolean", default: false },
      text: { type: "boolean", default: false },
      compare: { type: "string" },
      freeze: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const modeName = values.mode as string;
  const modeConfig = MODES[modeName];
  if (!modeConfig) {
    throw new Error(`Unknown mode: ${modeName}. Valid modes: ${Object.keys(MODES).join(", ")}`);
  }

  if (values.compare && modeName !== "damage") {
    throw new Error("--compare is only supported with --mode damage");
  }

  const target = positionals[0];
  if (!target) {
    throw new Error(`Usage: npm run calc -- <build.json|dir> [--mode ${Object.keys(MODES).join("|")}] [--json|--text] [--freeze] [--compare <file>]`);
  }

  const index = loadIndex();
  const calcData = loadCalculatorData();
  const staggerSettings = modeName === "stagger" ? loadStaggerSettings() : {};
  const deps = { index, calcData, staggerSettings } as ComputeDeps;

  function processFile(filePath: string) {
    const build = JSON.parse(readFileSync(filePath, "utf-8")) as AnyRecord;
    const result = modeConfig.compute(build, deps) as AnyRecord;
    return { build, result };
  }

  // Compare mode (damage only)
  if (values.compare) {
    const { build: buildA, result: matrixA } = processFile(target);
    const { build: buildB, result: matrixB } = processFile(values.compare as string);
    if (values.json) {
      console.log(JSON.stringify({ buildA: matrixA, buildB: matrixB }, null, 2));
    } else {
      console.log(formatCompare(matrixA, buildA, matrixB, buildB));
    }
    return;
  }

  const stat = statSync(target);

  if (stat.isDirectory()) {
    const files = readdirSync(target).filter((f) => f.endsWith(".json")).sort();
    let failures = 0;

    if (values.freeze) {
      mkdirSync(modeConfig.freezeDir, { recursive: true });
      for (const f of files) {
        try {
          const { result } = processFile(join(target, f));
          const prefix = basename(f, ".json");
          writeFileSync(
            join(modeConfig.freezeDir, `${prefix}${modeConfig.snapshotSuffix}`),
            JSON.stringify(result, calcReplacer, 2) + "\n",
          );
          console.log(`Frozen: ${prefix}`);
        } catch (err) {
          console.error(`SKIP ${f}: ${(err as Error).message}`);
          failures++;
        }
      }
      if (failures > 0) console.error(`${failures} build(s) skipped due to errors.`);
      return;
    }

    for (const f of files) {
      try {
        const { build, result } = processFile(join(target, f));
        if (values.json) {
          console.log(JSON.stringify(result, calcReplacer, 2));
        } else {
          console.log(modeConfig.formatText(result, build));
          console.log("");
        }
      } catch (err) {
        console.error(`SKIP ${f}: ${(err as Error).message}`);
        failures++;
      }
    }
    if (failures > 0) console.error(`${failures} build(s) skipped due to errors.`);
  } else {
    const { build, result } = processFile(target);
    if (values.json) {
      console.log(JSON.stringify(result, calcReplacer, 2));
    } else {
      console.log(modeConfig.formatText(result, build));
    }
  }
});
```

The formatter functions are copied verbatim from the existing files. The stagger formatter uses a `BREED_DISPLAY` that maps to plain strings (not `{name, armor}` objects) — use a local `STAGGER_BREED_DISPLAY` or just index into the shared `BREED_DISPLAY[id].name`.

- [ ] **Step 3: Delete the old files**

```bash
rm src/cli/stagger-build.ts src/cli/cleave-build.ts src/cli/toughness-build.ts
```

- [ ] **Step 4: Update `package.json` npm scripts**

Replace the calculator-related scripts:

```json
"stagger": "node dist/cli/calc-build.js --mode stagger",
"cleave": "node dist/cli/calc-build.js --mode cleave",
"toughness": "node dist/cli/calc-build.js --mode toughness",
"calc": "node dist/cli/calc-build.js",
"calc:freeze": "node dist/cli/calc-build.js data/builds/ --json --freeze",
"stagger:freeze": "node dist/cli/calc-build.js --mode stagger data/builds/ --json --freeze",
"cleave:freeze": "node dist/cli/calc-build.js --mode cleave data/builds/ --json --freeze",
"toughness:freeze": "node dist/cli/calc-build.js --mode toughness data/builds/ --json --freeze",
```

- [ ] **Step 5: Build and verify**

```bash
npm run build
```

Expected: clean compilation, no errors.

- [ ] **Step 6: Run existing regression tests**

```bash
npm test
```

Expected: all tests pass. The regression tests in `damage-calculator.test.ts`, `stagger-calculator.test.ts`, `cleave-calculator.test.ts`, `toughness-calculator.test.ts` test the library functions, not the CLI wrappers, so they should be unaffected.

- [ ] **Step 7: Smoke test all modes**

```bash
npm run calc -- data/builds/08-gandalf-melee-wizard.json
npm run calc -- data/builds/08-gandalf-melee-wizard.json --mode stagger
npm run calc -- data/builds/08-gandalf-melee-wizard.json --mode cleave
npm run calc -- data/builds/08-gandalf-melee-wizard.json --mode toughness
npm run calc -- data/builds/08-gandalf-melee-wizard.json --mode damage --json
npm run stagger -- data/builds/08-gandalf-melee-wizard.json
npm run calc -- data/builds/08-gandalf-melee-wizard.json --compare data/builds/01-veteran-squad-leader.json
```

Expected: each produces output matching the old CLI behavior.

- [ ] **Step 8: Re-freeze all snapshots to verify byte-identical output**

```bash
npm run calc:freeze
npm run stagger:freeze
npm run cleave:freeze
npm run toughness:freeze
git diff tests/fixtures/ground-truth/
```

Expected: no diff (or only whitespace/ordering changes if any).

- [ ] **Step 9: Commit**

```bash
git add -u
git commit -m "feat: unify calculator CLIs into single --mode dispatch (#18)

Merge stagger-build.ts, cleave-build.ts, toughness-build.ts into calc-build.ts.
New --mode flag (damage|stagger|cleave|toughness), defaults to damage.
All npm run aliases preserved."
```

---

### Task 3: Absorb freeze-scores into score-build

**Files:**
- Modify: `src/cli/score-build.ts`
- Delete: `src/cli/freeze-scores.ts`
- Modify: `package.json`

- [ ] **Step 1: Rewrite `src/cli/score-build.ts` CLI section**

Replace the `if (process.argv[1] === ...)` block with `runCliMain("score", async () => { ... })`. The new CLI:

1. Uses `runCliMain` wrapper (import from `../lib/cli.js`)
2. Parses `--json`, `--text`, `--freeze` flags
3. Accepts a file or directory positional
4. Directory mode: iterates `.json` files, generates scorecard for each
5. Freeze mode: writes to `tests/fixtures/ground-truth/scores/` with `{prefix}.score.json` naming
6. Single file mode: unchanged behavior

Key: the dynamic imports of `synergy-model` and `damage-calculator` (lines 129-153 of current file) must be hoisted out of the per-file loop — load once, reuse for each build. Wrap in try/catch for graceful degradation (matching current behavior).

```typescript
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { parseArgs } from "node:util";
import { runCliMain } from "../lib/cli.js";
import {
  parsePerkString,
  scorePerk,
  scoreWeaponPerks,
  scoreBlessings,
  scoreCurios,
  generateScorecard,
} from "../lib/score-build.js";

// ... AnyRecord type, formatScorecardText function unchanged ...

// ── CLI ──────────────────────────────────────────────────────────────

await runCliMain("score", async () => {
  const { values, positionals } = parseArgs({
    options: {
      json: { type: "boolean", default: false },
      text: { type: "boolean", default: false },
      freeze: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const target = positionals[0];
  if (!target) {
    throw new Error("Usage: npm run score -- <build.json|dir> [--json|--text] [--freeze]");
  }

  // Load synergy + calculator data once (graceful degradation)
  let index: AnyRecord | null = null;
  let synergyAvailable = false;
  let calcAvailable = false;
  let analyzeBuildFn: ((b: AnyRecord, i: AnyRecord) => AnyRecord) | null = null;
  let computeBreakpointsFn: ((b: AnyRecord, i: AnyRecord, c: AnyRecord) => AnyRecord) | null = null;
  let calcData: AnyRecord | null = null;

  try {
    const synMod = await import("../lib/synergy-model.js");
    index = synMod.loadIndex();
    analyzeBuildFn = synMod.analyzeBuild;
    synergyAvailable = true;
  } catch { /* synergy unavailable */ }

  try {
    const calcMod = await import("../lib/damage-calculator.js");
    if (!index) {
      const synMod = await import("../lib/synergy-model.js");
      index = synMod.loadIndex();
    }
    calcData = calcMod.loadCalculatorData();
    computeBreakpointsFn = calcMod.computeBreakpoints;
    calcAvailable = true;
  } catch { /* calculator unavailable */ }

  function processFile(filePath: string) {
    const build = JSON.parse(readFileSync(filePath, "utf-8")) as AnyRecord;
    const synergy = synergyAvailable && analyzeBuildFn && index
      ? analyzeBuildFn(build, index) : null;
    const calcOutput = calcAvailable && computeBreakpointsFn && index && calcData
      ? { matrix: computeBreakpointsFn(build, index, calcData) } : null;
    const card = generateScorecard(build, synergy, calcOutput);
    return { build, card };
  }

  const stat = statSync(target);

  if (stat.isDirectory()) {
    const files = readdirSync(target).filter((f) => f.endsWith(".json")).sort();
    let failures = 0;

    if (values.freeze) {
      const outDir = "tests/fixtures/ground-truth/scores";
      mkdirSync(outDir, { recursive: true });
      for (const f of files) {
        try {
          const { card } = processFile(join(target, f));
          const prefix = basename(f, ".json");
          writeFileSync(join(outDir, `${prefix}.score.json`), JSON.stringify(card, null, 2) + "\n");
          console.log(`Frozen: ${prefix} → ${card.letter_grade} (${card.composite_score})`);
        } catch (err) {
          console.error(`SKIP ${f}: ${(err as Error).message}`);
          failures++;
        }
      }
      if (failures > 0) console.error(`${failures} build(s) skipped due to errors.`);
      return;
    }

    for (const f of files) {
      try {
        const { card } = processFile(join(target, f));
        if (values.text) {
          console.log(formatScorecardText(card));
          console.log("");
        } else {
          console.log(JSON.stringify(card, null, 2));
        }
      } catch (err) {
        console.error(`SKIP ${f}: ${(err as Error).message}`);
        failures++;
      }
    }
    if (failures > 0) console.error(`${failures} build(s) skipped due to errors.`);
  } else {
    const { card } = processFile(target);
    if (values.text) {
      console.log(formatScorecardText(card));
    } else {
      console.log(JSON.stringify(card, null, 2));
    }
  }
});

export { parsePerkString, scorePerk, scoreWeaponPerks, scoreBlessings, scoreCurios, generateScorecard };
```

- [ ] **Step 2: Delete freeze-scores.ts**

```bash
rm src/cli/freeze-scores.ts
```

- [ ] **Step 3: Update `package.json`**

Change:
```json
"score:freeze": "node dist/cli/score-build.js data/builds/ --json --freeze"
```

- [ ] **Step 4: Build and test**

```bash
npm run build && npm test
```

Expected: all tests pass.

- [ ] **Step 5: Smoke test**

```bash
npm run score -- data/builds/08-gandalf-melee-wizard.json --text
npm run score -- data/builds/08-gandalf-melee-wizard.json --json
npm run score -- data/builds/
```

Expected: output matches old single-file behavior; directory mode produces all 23 scorecards.

- [ ] **Step 6: Re-freeze score snapshots**

```bash
npm run score:freeze
```

Expected: 23 snapshot files written to `tests/fixtures/ground-truth/scores/` (up from 5). Existing 5 snapshots should have unchanged scores.

- [ ] **Step 7: Update the score snapshot regression test**

The test in `src/lib/build-scoring.test.ts:251` reads all `.score.json` files from the scores directory and compares them. With 23 snapshots instead of 5, this test will now cover all builds automatically — no code change needed, but verify it passes:

```bash
GROUND_TRUTH_SOURCE_ROOT=$(cat .source-root) npm test
```

- [ ] **Step 8: Commit**

```bash
git add -u src/cli/score-build.ts package.json tests/fixtures/ground-truth/scores/
git commit -m "feat: add --freeze and directory support to score-build (#18)

Absorb freeze-scores.ts into score-build.ts with runCliMain wrapper.
Score snapshots now cover all 23 builds (up from 5)."
```

---

### Task 4: Update docs and run full quality gate

**Files:**
- Modify: `CLAUDE.md` (update commands section)

- [ ] **Step 1: Update CLAUDE.md commands**

In the `## Commands` section, update the calculator commands to reflect the new `--mode` interface. Add `--mode` examples:

```bash
npm run calc -- data/builds/08-gandalf-melee-wizard.json                          # breakpoint calculator (damage, default)
npm run calc -- data/builds/08-gandalf-melee-wizard.json --json                   # breakpoint calculator (JSON)
npm run calc -- data/builds/08-gandalf-melee-wizard.json --compare data/builds/01-veteran-squad-leader.json  # compare two builds
npm run calc -- data/builds/                                                      # batch calc (all builds)
npm run calc -- data/builds/08-gandalf-melee-wizard.json --mode stagger           # stagger analysis
npm run calc -- data/builds/08-gandalf-melee-wizard.json --mode cleave            # cleave analysis
npm run calc -- data/builds/08-gandalf-melee-wizard.json --mode toughness         # survivability analysis
npm run stagger -- data/builds/08-gandalf-melee-wizard.json                       # stagger (alias)
npm run cleave -- data/builds/08-gandalf-melee-wizard.json                        # cleave (alias)
npm run toughness -- data/builds/08-gandalf-melee-wizard.json                     # toughness (alias)
npm run calc:freeze                                                               # regenerate golden calc snapshots
npm run stagger:freeze                                                            # regenerate golden stagger snapshots
npm run cleave:freeze                                                             # regenerate golden cleave snapshots
npm run toughness:freeze                                                          # regenerate golden toughness snapshots
npm run score:freeze                                                              # regenerate golden score snapshots
```

Remove the separate `npm run stagger/cleave/toughness` standalone entries (they're now listed as aliases above). Remove `entities:fix-slugs`.

- [ ] **Step 2: Run `make check`**

```bash
make check
```

Expected: full quality gate passes (edges:build + effects:build + breeds:build + profiles:build + check).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for CLI consolidation (#18)"
```
