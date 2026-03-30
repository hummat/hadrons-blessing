# TypeScript Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the entire hadrons-blessing codebase from plain Node ESM JavaScript (.mjs) to strict TypeScript (.ts), preserving all existing behavior.

**Architecture:** Big-move approach — all files move to `src/` and rename to `.ts` with `@ts-nocheck` upfront, then types are added layer-by-layer (bottom-up in the dependency graph). Uses `tsx` as the runner during migration; switches to `tsc` + `node` at completion.

**Tech Stack:** TypeScript (strict), json-schema-to-typescript, tsx, node:test

**Spec:** `docs/superpowers/specs/2026-03-29-typescript-migration-design.md`

**Deviation from spec:** The spec describes 4 PRs with files migrating layer-by-layer while unmigrated files import from `dist/`. This plan uses a simpler approach: move ALL files at once, add `@ts-nocheck`, then remove it layer-by-layer. This avoids messy cross-boundary import rewrites during the transition. Group tasks into PRs as desired — the commit points are the natural boundaries.

---

## File Structure

### New files to create

```
tsconfig.json
tsconfig.test.json
src/lib/paths.ts                    — centralized repo root + data path resolution
src/generated/.gitkeep              — directory for generated schema types
scripts/generate-schema-types.mjs   — builds src/generated/schema-types.ts from JSON schemas
```

### Files to move (all bulk-moved in Task 2)

```
scripts/ground-truth/lib/*.mjs  →  src/lib/*.ts          (33 files)
scripts/*.mjs (CLI/extractors)  →  src/cli/*.ts           (30 files)
scripts/*.test.mjs              →  src/lib/*.test.ts or src/cli/*.test.ts  (34 files, co-located)
scripts/builds/                 →  data/builds/           (directory move)
scripts/build-scoring-data.json →  data/build-scoring-data.json
scripts/sample-build.json       →  data/sample-build.json
```

### Cross-boundary refactoring (Task 5)

Three files that mix CLI and library logic need splitting:

| Current file | Library exports | Split into |
|---|---|---|
| `scripts/score-build.mjs` | `parsePerkString`, `scorePerk`, `scoreWeaponPerks`, `scoreBlessings`, `scoreCurios`, `generateScorecard` | `src/lib/score-build.ts` (exports) + `src/cli/score-build.ts` (CLI) |
| `scripts/build-ground-truth-index.mjs` | `buildIndex` | `src/lib/ground-truth-index.ts` (export) + `src/cli/build-ground-truth-index.ts` (CLI) |
| `scripts/audit-build-names.mjs` | `auditBuildFile` | `src/lib/audit-build-file.ts` (export) + `src/cli/audit-build-names.ts` (CLI) |

These splits resolve lib→scripts import violations: `resolve.ts` imports `buildIndex`, `build-canonicalize.ts` imports `parsePerkString`, `build-report.ts` imports `auditBuildFile` and `generateScorecard`, `build-recommendations.ts` imports `generateScorecard`.

---

## Task 1: Infrastructure Setup

**Files:**
- Create: `tsconfig.json`, `tsconfig.test.json`, `src/lib/paths.ts`, `src/generated/.gitkeep`, `scripts/generate-schema-types.mjs`
- Modify: `package.json`, `.gitignore`

- [ ] **Step 1: Install dev dependencies**

```bash
npm install --save-dev typescript @types/node json-schema-to-typescript tsx
```

- [ ] **Step 2: Create tsconfig.json**

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2024",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts"]
}
```

- [ ] **Step 3: Create tsconfig.test.json**

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist-test",
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Create src/lib/paths.ts**

This replaces every scattered `__dirname` + relative path pattern. Walk up from the compiled output location to find the repo root (where `package.json` lives), then derive all data paths.

```typescript
// @ts-nocheck — will be typed properly in Task 4
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, "package.json"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("Could not find repo root (no package.json found)");
    }
    dir = parent;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = findRepoRoot(__dirname);

// Data paths
export const DATA_ROOT = join(REPO_ROOT, "data");
export const GROUND_TRUTH_ROOT = join(DATA_ROOT, "ground-truth");
export const ENTITIES_ROOT = join(GROUND_TRUTH_ROOT, "entities");
export const ALIASES_ROOT = join(GROUND_TRUTH_ROOT, "aliases");
export const EDGES_ROOT = join(GROUND_TRUTH_ROOT, "edges");
export const EVIDENCE_ROOT = join(GROUND_TRUTH_ROOT, "evidence");
export const NON_CANONICAL_ROOT = join(GROUND_TRUTH_ROOT, "non-canonical");
export const GENERATED_ROOT = join(GROUND_TRUTH_ROOT, "generated");
export const GENERATED_INDEX_PATH = join(GENERATED_ROOT, "index.json");
export const GENERATED_META_PATH = join(GENERATED_ROOT, "meta.json");
export const SCHEMAS_ROOT = join(GROUND_TRUTH_ROOT, "schemas");
export const ENTITY_KINDS_ROOT = join(SCHEMAS_ROOT, "entity-kinds");
export const SOURCE_SNAPSHOT_MANIFEST_PATH = join(
  GROUND_TRUTH_ROOT,
  "source-snapshots",
  "manifest.json",
);
export const BUILDS_ROOT = join(DATA_ROOT, "builds");
export const EXPORTS_ROOT = join(DATA_ROOT, "exports");
export const SCORING_DATA_PATH = join(DATA_ROOT, "build-scoring-data.json");
export const BREAKPOINT_CHECKLIST_PATH = join(GROUND_TRUTH_ROOT, "breakpoint-checklist.json");
export const CLASS_BASE_STATS_PATH = join(GROUND_TRUTH_ROOT, "class-base-stats.json");

// Source root resolution
const SOURCE_ROOT_FILE = join(REPO_ROOT, ".source-root");

export function resolveSourceRoot(explicit?: string): string | null {
  if (explicit) {
    return resolve(explicit);
  }
  if (process.env.GROUND_TRUTH_SOURCE_ROOT) {
    return resolve(process.env.GROUND_TRUTH_SOURCE_ROOT);
  }
  if (existsSync(SOURCE_ROOT_FILE)) {
    const content = readFileSync(SOURCE_ROOT_FILE, "utf8").trim();
    if (content) {
      return resolve(content);
    }
  }
  return null;
}
```

- [ ] **Step 5: Create scripts/generate-schema-types.mjs**

This stays as plain JS because it runs before `tsc` and generates TS input.

```javascript
#!/usr/bin/env node
// Generate TypeScript interfaces from JSON Schema files.
// Output: src/generated/schema-types.ts

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const SCHEMAS_DIR = join(REPO_ROOT, "data", "ground-truth", "schemas");
const ENTITY_KINDS_DIR = join(SCHEMAS_DIR, "entity-kinds");
const OUTPUT_DIR = join(REPO_ROOT, "src", "generated");
const OUTPUT_FILE = join(OUTPUT_DIR, "schema-types.ts");

const SCHEMA_FILES = [
  "alias.schema.json",
  "build-selection.schema.json",
  "canonical-build.schema.json",
  "calc.schema.json",
  "condition.schema.json",
  "edge.schema.json",
  "entity-base.schema.json",
  "evidence.schema.json",
  "known-unresolved.schema.json",
  "query-context.schema.json",
];

const ENTITY_KIND_FILES = [
  "ability.schema.json",
  "aura.schema.json",
  "buff.schema.json",
  "class.schema.json",
  "gadget-trait.schema.json",
  "keystone.schema.json",
  "name-family.schema.json",
  "talent-modifier.schema.json",
  "talent.schema.json",
  "tree-node.schema.json",
  "weapon-perk.schema.json",
  "weapon-trait.schema.json",
  "weapon.schema.json",
];

async function generateTypes() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const parts = [
    "// Auto-generated from data/ground-truth/schemas/ — do not edit manually.",
    "// Regenerate with: npm run build:types",
    "",
  ];

  const compileOpts = {
    additionalProperties: false,
    bannerComment: "",
    strictIndexSignatures: true,
    cwd: SCHEMAS_DIR,
  };

  for (const file of SCHEMA_FILES) {
    const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, file), "utf8"));
    const ts = await compile(schema, schema.$id || basename(file, ".schema.json"), compileOpts);
    parts.push(ts);
  }

  for (const file of ENTITY_KIND_FILES) {
    const schema = JSON.parse(readFileSync(join(ENTITY_KINDS_DIR, file), "utf8"));
    const ts = await compile(schema, schema.$id || basename(file, ".schema.json"), {
      ...compileOpts,
      cwd: ENTITY_KINDS_DIR,
    });
    parts.push(ts);
  }

  writeFileSync(OUTPUT_FILE, parts.join("\n"));
  console.log(`Generated ${OUTPUT_FILE}`);
}

generateTypes().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

- [ ] **Step 6: Update .gitignore**

Add these entries:

```
dist/
dist-test/
src/generated/schema-types.ts
```

- [ ] **Step 7: Verify infrastructure**

```bash
npx tsc --version
node scripts/generate-schema-types.mjs
```

Expected: tsc version prints, schema types generate to `src/generated/schema-types.ts`.

- [ ] **Step 8: Commit**

```bash
git add tsconfig.json tsconfig.test.json src/lib/paths.ts src/generated/.gitkeep \
  scripts/generate-schema-types.mjs .gitignore package.json package-lock.json
git commit -m "chore: add TypeScript infrastructure (#1)

tsconfig, paths.ts, schema type generator, tsx/typescript deps."
```

---

## Task 2: Big Move — Restructure All Files

Move all source, CLI, and test files to `src/`. Rename `.mjs` → `.ts`. Add `@ts-nocheck` to every file. Update all import paths. Verify the project still works via `tsx`.

**Files:**
- Move: all 63 source `.mjs` + 34 test `.mjs` files
- Move: `scripts/builds/` → `data/builds/`, `scripts/build-scoring-data.json` → `data/`, `scripts/sample-build.json` → `data/`
- Modify: `package.json` (all script commands), `Makefile`

- [ ] **Step 1: Move library files**

```bash
mkdir -p src/lib
# Move all lib modules (rename .mjs → .ts)
for f in scripts/ground-truth/lib/*.mjs; do
  mv "$f" "src/lib/$(basename "${f%.mjs}.ts")"
done
```

- [ ] **Step 2: Move CLI and extractor files**

```bash
mkdir -p src/cli
# Move CLI entry points (rename .mjs → .ts)
for f in scripts/*.mjs; do
  # Skip test files — handled separately
  [[ "$f" == *.test.mjs ]] && continue
  mv "$f" "src/cli/$(basename "${f%.mjs}.ts")"
done
```

- [ ] **Step 3: Move test files (co-locate with source)**

Map each test to its source location. Most test files test lib modules, some test CLI scripts. Co-locate each test next to the file it tests.

```bash
# Tests for lib modules → src/lib/
# Tests for CLI scripts → src/cli/
# Check each test's imports to determine correct location
```

Mapping — co-locate each test with the primary module it tests:

**To `src/lib/`:**
`canonical-build.test.ts`, `ground-truth.test.ts`, `coverage.test.ts`, `inspect.test.ts`, `tree-edges.test.ts`, `report-formatter.test.ts`, `lua-data-reader.test.ts`, `talent-settings-parser.test.ts`, `condition-tagger.test.ts`, `buff-semantic-parser.test.ts`, `extract-buff-effects.test.ts`, `synergy-model.test.ts`, `build-scoring.test.ts`, `build-recommendations.test.ts`, `build-report.test.ts`, `damage-calculator.test.ts`, `calculator-validation.test.ts`, `stagger-calculator.test.ts`, `cleave-calculator.test.ts`, `class-base-stats.test.ts`, `toughness-calculator.test.ts`, `calc-build.test.ts`, `score-build.test.ts`, `reresolve-builds.test.ts`, `extract-breed-data.test.ts`, `extract-damage-profiles.test.ts`, `expand-entity-coverage.test.ts`, `enrich-entity-names.test.ts`, `fix-malformed-slugs.test.ts`, `scrape-gl-catalog.test.ts`, `generate-weapon-name-mapping.test.ts`, `extract-build.test.ts`, `export-bot-weapons.test.ts`

**To `src/cli/`:**
`cli-contract.test.ts`

Read each test file's imports to verify — if a test primarily exercises a CLI script's argument parsing/output formatting, put it in `src/cli/`. If it tests library logic, put it in `src/lib/`.

- [ ] **Step 4: Move data files**

```bash
mv scripts/builds data/builds
mv scripts/build-scoring-data.json data/
mv scripts/sample-build.json data/
```

- [ ] **Step 5: Add `@ts-nocheck` to all moved .ts files**

```bash
for f in src/lib/*.ts src/cli/*.ts; do
  # Skip paths.ts (already typed)
  [[ "$f" == *paths.ts ]] && continue
  # Prepend @ts-nocheck
  sed -i '1s/^/\/\/ @ts-nocheck\n/' "$f"
done
```

- [ ] **Step 6: Update all import extensions `.mjs` → `.js`**

With `module: "Node16"`, TypeScript requires `.js` extensions in import specifiers (referring to compiled output). Replace all local import extensions:

```bash
# In src/lib/ and src/cli/, replace .mjs imports with .js
find src -name '*.ts' -exec sed -i 's/from "\(\..*\)\.mjs"/from "\1.js"/g' {} +
find src -name '*.ts' -exec sed -i "s/from '\(\..*\)\.mjs'/from '\1.js'/g" {} +
```

- [ ] **Step 7: Update import paths for restructured directory layout**

The old import paths assumed `scripts/ground-truth/lib/` nesting. Now everything in `src/lib/` is flat. Update cross-references:

- **In `src/lib/` files:** Change `from "./foo.js"` (already correct — these were in the same directory before)
- **In `src/cli/` files:** Change `from "./ground-truth/lib/foo.js"` → `from "../lib/foo.js"` and `from "./foo.js"` (for peer CLI imports) — verify each file
- **Cross-boundary imports** (lib importing from CLI scripts): These will be refactored in Task 5. For now, update the paths so they compile with `@ts-nocheck`.

The key pattern: old `../../scripts/foo.mjs` or `./ground-truth/lib/foo.mjs` becomes `../lib/foo.js` or `./foo.js` depending on relative position.

- [ ] **Step 8: Update data file references**

Files that load JSON data (like `build-scoring-data.json`, build fixtures) need path updates. These should now import from `paths.ts` or use updated relative paths. For now (with `@ts-nocheck`), update the relative paths to work from the new locations. Full `paths.ts` integration happens in Task 4.

- [ ] **Step 9: Update package.json scripts**

Replace all `node scripts/...` with `tsx src/cli/...` commands. Replace `node --test scripts/...` with `tsx --test`. Add build scripts.

Key changes:
```jsonc
{
  "main": "dist/lib/index.js",
  "types": "dist/lib/index.d.ts",
  "scripts": {
    "build": "npm run build:types && tsc",
    "build:types": "node scripts/generate-schema-types.mjs",
    "clean": "rm -rf dist dist-test",
    "test": "tsx --test src/**/*.test.ts",
    "resolve": "tsx src/cli/resolve-ground-truth.ts",
    "audit": "tsx src/cli/audit-build-names.ts",
    "canonicalize": "tsx src/cli/canonicalize-build.ts",
    "reresolve": "tsx src/cli/reresolve-builds.ts",
    "coverage": "tsx src/cli/coverage-ground-truth.ts",
    "inspect": "tsx src/cli/inspect-ground-truth.ts",
    "index:build": "tsx src/cli/build-ground-truth-index.ts",
    "index:check": "tsx src/cli/build-ground-truth-index.ts --check",
    "edges:build": "tsx src/cli/extract-tree-edges.ts",
    "effects:build": "tsx src/cli/extract-buff-effects.ts",
    "breeds:build": "tsx src/cli/extract-breed-data.ts",
    "profiles:build": "tsx src/cli/extract-damage-profiles.ts",
    "stagger:build": "tsx src/cli/extract-stagger-settings.ts",
    "report": "tsx src/cli/report-build.ts",
    "export:bot-weapons": "tsx src/cli/export-bot-weapons.ts",
    "synergy": "tsx src/cli/analyze-synergy.ts",
    "score": "tsx src/cli/score-build.ts",
    "recommend": "tsx src/cli/recommend-build.ts",
    "calc": "tsx src/cli/calc-build.ts",
    "stagger": "tsx src/cli/stagger-build.ts",
    "cleave": "tsx src/cli/cleave-build.ts",
    "toughness": "tsx src/cli/toughness-build.ts",
    "calc:freeze": "tsx src/cli/calc-build.ts data/builds/ --json --freeze",
    "stagger:freeze": "tsx src/cli/stagger-build.ts data/builds/ --json --freeze",
    "cleave:freeze": "tsx src/cli/cleave-build.ts data/builds/ --json --freeze",
    "toughness:freeze": "tsx src/cli/toughness-build.ts data/builds/ --json --freeze",
    "check": "npm run index:build && npm test && npm run index:check",
    "entities:expand": "tsx src/cli/expand-entity-coverage.ts",
    "entities:enrich": "tsx src/cli/enrich-entity-names.ts",
    "entities:fix-slugs": "tsx src/cli/fix-malformed-slugs.ts",
    "gl:scrape": "tsx src/cli/scrape-gl-catalog.ts",
    "entities:gen-mapping": "tsx src/cli/generate-weapon-name-mapping.ts",
    "audit:freeze": "for f in tests/fixtures/ground-truth/audits/*.audit.json; do b=$(basename \"$f\" .audit.json); tsx src/cli/audit-build-names.ts \"data/builds/${b}.json\" > \"$f\"; done",
    "synergy:freeze": "for f in tests/fixtures/ground-truth/synergy/*.synergy.json; do b=$(basename \"$f\" .synergy.json); tsx src/cli/analyze-synergy.ts \"data/builds/${b}-\"*.json --json > \"$f\"; done",
    "score:freeze": "tsx src/cli/freeze-scores.ts"
  }
}
```

- [ ] **Step 10: Update Makefile**

Update all targets to use the new script names. No structural changes needed — `npm run` commands are the interface.

- [ ] **Step 11: Verify everything works via tsx**

```bash
npm test
```

Expected: all 872+ tests pass. Tests run via `tsx` which handles `@ts-nocheck` .ts files transparently.

If tests fail, debug import path issues. The most common problems will be:
- Incorrect relative path depth after restructuring
- Data file paths not updated — builds moved from `scripts/builds/` to `data/builds/`, scoring data from `scripts/build-scoring-data.json` to `data/build-scoring-data.json`
- Test files that load builds via relative paths (e.g. `../../scripts/builds/`) need updating to the new `data/builds/` location
- Test fixture paths in `tests/fixtures/` are unchanged

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "refactor: restructure project for TypeScript migration (#1)

Move all source to src/lib/ and src/cli/, rename .mjs to .ts,
add @ts-nocheck, update all import paths, move builds to data/."
```

---

## Task 3: Generate and Verify Schema Types

**Files:**
- Generate: `src/generated/schema-types.ts`

- [ ] **Step 1: Run the schema type generator**

```bash
npm run build:types
```

- [ ] **Step 2: Read and verify generated types**

Open `src/generated/schema-types.ts` and verify:
- `BuildSelection` interface has `resolution_status` as string literal union
- `CanonicalBuild` interface has correct required fields
- Entity kind interfaces are present for all 13 entity types
- Conditional schema logic (`if/then`) produces correct union types

- [ ] **Step 3: Verify tsc can see the generated types**

```bash
npx tsc --noEmit 2>&1 | head -5
```

Expected: errors only from `@ts-nocheck` files (or none — tsc skips `@ts-nocheck` files).

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-schema-types.mjs
git commit -m "feat: add schema type generation (#1)

Generates TypeScript interfaces from 23 JSON schemas."
```

---

## Task 4: Type Foundation Modules (Layer 1)

Remove `@ts-nocheck` from leaf dependency modules and add proper TypeScript types. These are the modules that everything else imports from.

**Files:**
- Type: `src/lib/paths.ts` (verify/finalize), `src/lib/load.ts`, `src/lib/normalize.ts`, `src/lib/cli.ts`
- Type: `src/lib/validate.ts` (depends on load), `src/lib/registry.ts` (depends on load), `src/lib/build-shape.ts` (depends on load), `src/lib/non-canonical.ts` (depends on normalize, validate)

**Conversion pattern:**

For each file:
1. Remove the `// @ts-nocheck` line
2. Convert JSDoc `@param`/`@returns` annotations to TS parameter and return types
3. Add types for local variables where inference is insufficient
4. Use generated schema types from `src/generated/schema-types.ts` for data shapes
5. Replace `__dirname`-relative path computation with imports from `./paths.js`
6. Run `npx tsc --noEmit` and fix any errors

**Example — converting `normalize.ts`:**

Before (`@ts-nocheck`, untyped):
```typescript
// @ts-nocheck
const ALLOWED_QUERY_CONTEXT_KEYS = new Set(["domain", "kind", "class", ...]);

function normalizeText(input) {
  return input.normalize("NFKC").toLowerCase()...
}

function assertAllowedQueryContext(context) {
  if (context == null) return {};
  ...
}
```

After (typed):
```typescript
export const ALLOWED_QUERY_CONTEXT_KEYS = new Set([
  "domain", "kind", "class", "weapon_family", "slot", "source",
] as const);

export type QueryContextKey = typeof ALLOWED_QUERY_CONTEXT_KEYS extends Set<infer T> ? T : never;

export type QueryContext = Partial<Record<QueryContextKey, string>>;

export function normalizeText(input: string): string {
  return input.normalize("NFKC").toLowerCase()...
}

export function assertAllowedQueryContext(context: unknown): QueryContext {
  if (context == null) return {};
  ...
}
```

**Example — converting path resolution in `load.ts`:**

Before:
```typescript
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const GROUND_TRUTH_ROOT = join(REPO_ROOT, "data", "ground-truth");
const ENTITIES_ROOT = join(GROUND_TRUTH_ROOT, "entities");
```

After:
```typescript
import {
  REPO_ROOT, GROUND_TRUTH_ROOT, ENTITIES_ROOT, ALIASES_ROOT,
  EDGES_ROOT, EVIDENCE_ROOT, SCHEMAS_ROOT, ENTITY_KINDS_ROOT,
  SOURCE_SNAPSHOT_MANIFEST_PATH, resolveSourceRoot,
} from "./paths.js";

// Re-export for existing consumers
export {
  REPO_ROOT, ENTITIES_ROOT, ALIASES_ROOT, EDGES_ROOT,
  EVIDENCE_ROOT, SCHEMAS_ROOT, ENTITY_KINDS_ROOT,
  resolveSourceRoot,
};
```

This preserves the existing API surface — modules importing from `load.ts` continue to work without changes.

- [ ] **Step 1: Type `normalize.ts`**

Remove `@ts-nocheck`, add parameter types, return types, and the `QueryContext` type. This is a small file (~38 lines).

- [ ] **Step 2: Type `load.ts`**

Remove `@ts-nocheck`. Replace the `__dirname`-relative path block with imports from `paths.ts`. Add return types to `loadJsonFile`, `listJsonFiles`, `resolveSourceRoot`, `loadSourceSnapshotManifest`. Re-export path constants for backward compatibility.

- [ ] **Step 3: Type `cli.ts`**

Remove `@ts-nocheck`. Add parameter types to `formatCliError(commandName: string, error: unknown): string` and `runCliMain(commandName: string, fn: () => Promise<void>): Promise<void>`. Type the `SETUP_HINTS` as `Record<string, string>`.

- [ ] **Step 4: Type `validate.ts`**

Remove `@ts-nocheck`. This file uses `ajv` for schema validation — add types for validator functions. Import schema types from `src/generated/schema-types.ts` where applicable. Key functions: `validateEntityRecord`, `validateAliasRecord`, `validateEdgeRecord`, `validateEvidenceRecord`, `validateSourceSnapshot`, `validateKnownUnresolvedRecord`.

- [ ] **Step 5: Type `registry.ts`**

Remove `@ts-nocheck`. Type the ground truth registry data structure and its loader. Uses `load.ts` imports.

- [ ] **Step 6: Type `build-shape.ts`**

Remove `@ts-nocheck`. Uses `ajv` for build schema validation. Import `CanonicalBuild` from generated types. Type `assertValidCanonicalBuild`.

- [ ] **Step 7: Type `non-canonical.ts`**

Remove `@ts-nocheck`. Depends on `normalize.ts` and `validate.ts`. Type `classifyKnownUnresolved` and its return shape.

- [ ] **Step 8: Verify compilation**

```bash
npx tsc --noEmit
```

Expected: zero errors from the typed files. `@ts-nocheck` files are skipped.

- [ ] **Step 9: Verify tests pass**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/lib/paths.ts src/lib/load.ts src/lib/normalize.ts src/lib/cli.ts \
  src/lib/validate.ts src/lib/registry.ts src/lib/build-shape.ts src/lib/non-canonical.ts
git commit -m "feat: type foundation modules — load, normalize, validate, cli (#1)"
```

---

## Task 5: Cross-Boundary Refactoring

Split three files that mix CLI and library concerns. This must happen before typing the upper library modules that import from them.

**Files:**
- Split: `src/cli/score-build.ts` → `src/lib/score-build.ts` + `src/cli/score-build.ts`
- Split: `src/cli/build-ground-truth-index.ts` → `src/lib/ground-truth-index.ts` + `src/cli/build-ground-truth-index.ts`
- Split: `src/cli/audit-build-names.ts` → `src/lib/audit-build-file.ts` + `src/cli/audit-build-names.ts`
- Update: all files that import the shared functions

- [ ] **Step 1: Split score-build**

Extract all exported library functions from `src/cli/score-build.ts` into `src/lib/score-build.ts`:
- `parsePerkString`, `scorePerk`, `scoreWeaponPerks`, `scoreBlessings`, `scoreCurios`, `generateScorecard`
- Also move the `PROVISIONAL_WEAPON_FAMILY_MATCHES` data and any helper functions they depend on
- Leave CLI logic (`parseArgs`, `main`, console output) in `src/cli/score-build.ts`
- `src/cli/score-build.ts` imports from `../lib/score-build.js`

Both files keep `@ts-nocheck` for now.

- [ ] **Step 2: Split build-ground-truth-index**

Extract `buildIndex` and its helper functions into `src/lib/ground-truth-index.ts`:
- `buildIndex`, `readShardDirectory`, and internal helpers
- Leave CLI logic (main function, `--check` flag handling) in `src/cli/build-ground-truth-index.ts`
- `src/cli/build-ground-truth-index.ts` imports `buildIndex` from `../lib/ground-truth-index.js`

Both files keep `@ts-nocheck` for now.

- [ ] **Step 3: Split audit-build-names**

Extract `auditBuildFile` into `src/lib/audit-build-file.ts`:
- `auditBuildFile` and `auditLegacyBuild` (its helper)
- Leave CLI entry point in `src/cli/audit-build-names.ts`
- `src/cli/audit-build-names.ts` imports from `../lib/audit-build-file.js`

Both files keep `@ts-nocheck` for now.

- [ ] **Step 4: Update consumers**

Update import paths in files that consume the extracted functions:
- `src/lib/resolve.ts`: change `buildIndex` import to `./ground-truth-index.js`
- `src/lib/build-audit.ts`: change `buildIndex` import to `./ground-truth-index.js`
- `src/lib/build-canonicalize.ts`: change `parsePerkString` import to `./score-build.js`
- `src/lib/build-report.ts`: change `auditBuildFile` import to `./audit-build-file.js`, `generateScorecard` import to `./score-build.js`
- `src/lib/build-recommendations.ts`: change `generateScorecard` import to `./score-build.js`

- [ ] **Step 5: Verify tests pass**

```bash
npm test
```

Expected: all tests pass — behavior unchanged, only import paths changed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/score-build.ts src/lib/ground-truth-index.ts src/lib/audit-build-file.ts \
  src/cli/score-build.ts src/cli/build-ground-truth-index.ts src/cli/audit-build-names.ts \
  src/lib/resolve.ts src/lib/build-audit.ts src/lib/build-canonicalize.ts \
  src/lib/build-report.ts src/lib/build-recommendations.ts
git commit -m "refactor: split lib/cli concerns for score-build, index, audit (#1)

Extract shared library functions from CLI scripts into src/lib/
to eliminate lib→cli import violations."
```

---

## Task 6: Type Leaf Calculators & Parsers

These are large files with zero project dependencies (only node: builtins). They have extensive JSDoc that converts directly to TS types. This is the highest-volume typing task.

**Files (all `src/lib/`):**
- `damage-calculator.ts` (1433 LOC, 106 JSDoc annotations — the biggest file)
- `stagger-calculator.ts` (593 LOC)
- `cleave-calculator.ts` (435 LOC)
- `toughness-calculator.ts` (657 LOC)
- `breakpoint-checklist.ts` (481 LOC)
- `lua-data-reader.ts` (749 LOC)
- `lua-tree-parser.ts`
- `tree-edge-generator.ts`
- `talent-settings-parser.ts`
- `condition-tagger.ts`
- `synergy-stat-families.ts`
- `build-classification-registry.ts`
- `recommend-formatter.ts`
- `report-formatter.ts`

**Conversion pattern for calculator modules:**

These files have parameter objects documented with JSDoc `@param {object} params` + nested `@param {number} params.powerLevel`. Convert to TS interfaces:

Before:
```typescript
/**
 * @param {object} params
 * @param {number} [params.powerLevel]
 * @param {object} params.powerDistribution
 * @param {string} params.armorType
 * @param {object} params.constants
 * @param {boolean} [params.isRanged]
 * @returns {number}
 */
export function powerLevelToDamage({ powerLevel, powerDistribution, ... }) {
```

After:
```typescript
export interface PowerLevelToDamageParams {
  powerLevel?: number;
  powerDistribution: { attack: number };
  armorType: string;
  constants: DamageConstants;
  isRanged?: boolean;
  dropoffScalar?: number;
}

export function powerLevelToDamage({
  powerLevel, powerDistribution, armorType, constants, isRanged, dropoffScalar,
}: PowerLevelToDamageParams): number {
```

**Path resolution:** Each calculator loads JSON data via `__dirname`-relative paths. Replace with imports from `paths.ts`:

Before:
```typescript
const __dirname = dirname(fileURLToPath(import.meta.url));
const GENERATED_DIR = join(__dirname, "..", "..", "..", "data", "ground-truth", "generated");
```

After:
```typescript
import { GENERATED_ROOT } from "./paths.js";
// Then use GENERATED_ROOT directly where GENERATED_DIR was used
```

- [ ] **Step 1: Type `damage-calculator.ts`**

The largest and most complex file. 13 pipeline stage functions + `computeHit` orchestrator + breakpoint matrix. Convert all 106 JSDoc annotations to TS interfaces and parameter types. Define interfaces for `DamageConstants`, `PowerDistribution`, `DamageProfile`, `BreakpointResult`, `HitResult`, etc. Replace `__dirname` path resolution with `paths.ts` imports.

- [ ] **Step 2: Type `stagger-calculator.ts` and `cleave-calculator.ts`**

Both depend on damage-calculator patterns. Define `StaggerResult`, `StaggerTier`, `CleaveResult`, `HordeComposition` interfaces.

- [ ] **Step 3: Type `toughness-calculator.ts`**

Define `ToughnessProfile`, `DamageReductionSource`, `SurvivabilityResult` interfaces.

- [ ] **Step 4: Type `breakpoint-checklist.ts`**

Define `ChecklistEntry`, `ChecklistScore` interfaces.

- [ ] **Step 5: Type `lua-data-reader.ts` and `lua-tree-parser.ts`**

Lua parsing functions — define return types for parsed Lua tables. Key: `parseLuaTable` return type, `extractTemplateBlocks` return type.

- [ ] **Step 6: Type remaining leaf modules**

`talent-settings-parser.ts`, `condition-tagger.ts`, `synergy-stat-families.ts`, `build-classification-registry.ts`, `recommend-formatter.ts`, `report-formatter.ts`, `tree-edge-generator.ts`.

- [ ] **Step 7: Verify compilation**

```bash
npx tsc --noEmit
```

Expected: zero errors from typed files.

- [ ] **Step 8: Verify tests pass**

```bash
npm test
```

- [ ] **Step 9: Commit**

```bash
git add src/lib/damage-calculator.ts src/lib/stagger-calculator.ts \
  src/lib/cleave-calculator.ts src/lib/toughness-calculator.ts \
  src/lib/breakpoint-checklist.ts src/lib/lua-data-reader.ts \
  src/lib/lua-tree-parser.ts src/lib/tree-edge-generator.ts \
  src/lib/talent-settings-parser.ts src/lib/condition-tagger.ts \
  src/lib/synergy-stat-families.ts src/lib/build-classification-registry.ts \
  src/lib/recommend-formatter.ts src/lib/report-formatter.ts
git commit -m "feat: type calculators, parsers, and leaf modules (#1)"
```

---

## Task 7: Type Mid-Level Library Modules

Modules that import from the leaves typed in Tasks 4 and 6.

**Files (all `src/lib/`):**
- `synergy-rules.ts` (depends on synergy-stat-families)
- `synergy-model.ts` (depends on synergy-stat-families, load)
- `build-scoring.ts` (depends on breakpoint-checklist)
- `buff-semantic-parser.ts` (depends on condition-tagger, lua-data-reader)
- `build-classification.ts` (depends on build-classification-registry, normalize)

- [ ] **Step 1: Type `synergy-rules.ts`**

5 pure-function rules. Define `SynergyEdge`, `SynergyRule` interfaces. Type all rule functions.

- [ ] **Step 2: Type `synergy-model.ts`**

Orchestrator module. Define `SynergyOutput`, `SynergySelection`, `StatAggregation` interfaces. Uses `load.ts` exports and `synergy-stat-families.ts` types.

- [ ] **Step 3: Type `build-scoring.ts`**

Define `Scorecard`, `ScorecardDimension` interfaces. Depends on breakpoint-checklist types.

- [ ] **Step 4: Type `buff-semantic-parser.ts`**

Define `ParsedBuff`, `BuffEffect` interfaces. 43 JSDoc annotations to convert.

- [ ] **Step 5: Type `build-classification.ts`**

Define `ClassificationResult`, `SlugRole` types. Depends on registry and normalize.

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit
npm test
git add src/lib/synergy-rules.ts src/lib/synergy-model.ts src/lib/build-scoring.ts \
  src/lib/buff-semantic-parser.ts src/lib/build-classification.ts
git commit -m "feat: type synergy, scoring, and classification modules (#1)"
```

---

## Task 8: Type Upper Library Modules

Modules at the top of the lib dependency graph. These depend on everything typed so far.

**Files (all `src/lib/`):**
- `ground-truth-index.ts` (extracted in Task 5, depends on load, normalize, validate)
- `resolve.ts` (depends on ground-truth-index, normalize)
- `coverage.ts` (depends on registry)
- `inspect.ts` (depends on registry)
- `score-build.ts` (extracted in Task 5, depends on load, normalize, build-scoring)
- `audit-build-file.ts` (extracted in Task 5)
- `build-audit.ts` (depends on ground-truth-index, build-shape, non-canonical, resolve)
- `build-canonicalize.ts` (depends on load, non-canonical, resolve, build-shape, build-classification, score-build)
- `build-recommendations.ts` (depends on synergy-model, build-scoring, score-build)
- `build-report.ts` (depends on load, audit-build-file, score-build)

- [ ] **Step 1: Type `ground-truth-index.ts`**

Define `GroundTruthIndex` interface — the central index shape with entities, aliases, edges, evidence. Type `buildIndex()` return type.

- [ ] **Step 2: Type `resolve.ts`**

Define `ResolveResult`, `ResolveCandidate` interfaces. Type `resolveQuery()`.

- [ ] **Step 3: Type `coverage.ts` and `inspect.ts`**

Small modules. Type their public functions.

- [ ] **Step 4: Type `score-build.ts` (lib portion)**

Type `parsePerkString`, `generateScorecard`, and all scoring functions. Define `PerkParseResult`, `ScorecardOutput` interfaces.

- [ ] **Step 5: Type `audit-build-file.ts`**

Type `auditBuildFile`. Define `AuditResult` interface.

- [ ] **Step 6: Type `build-audit.ts`**

Type audit pipeline functions. Uses `GroundTruthIndex`, `CanonicalBuild` types.

- [ ] **Step 7: Type `build-canonicalize.ts`**

Type the canonicalization pipeline. This is the most complex — it orchestrates resolution, classification, and validation. Uses many types from other modules.

- [ ] **Step 8: Type `build-recommendations.ts` and `build-report.ts`**

Type recommendation and report generation. Uses synergy and scoring types.

- [ ] **Step 9: Verify and commit**

```bash
npx tsc --noEmit
npm test
git add src/lib/ground-truth-index.ts src/lib/resolve.ts src/lib/coverage.ts \
  src/lib/inspect.ts src/lib/score-build.ts src/lib/audit-build-file.ts \
  src/lib/build-audit.ts src/lib/build-canonicalize.ts \
  src/lib/build-recommendations.ts src/lib/build-report.ts
git commit -m "feat: type resolution, canonicalization, and upper library (#1)"
```

---

## Task 9: Type CLI Entry Points

All CLI scripts in `src/cli/`. These are thin wrappers: parse args, call lib functions, format output. Typing is mostly about parameter parsing and import types.

**Files:** all remaining `@ts-nocheck` files in `src/cli/` (~27 files)

**Pattern:** Each CLI file follows the same structure:

```typescript
import { parseArgs } from "node:util";
import { runCliMain } from "../lib/cli.js";
import { someLibFunction } from "../lib/some-module.js";

runCliMain("command-name", async () => {
  const { values, positionals } = parseArgs({
    options: { json: { type: "boolean" }, /* ... */ },
    allowPositionals: true,
  });
  // Call lib functions, format output
});
```

Typing approach:
1. Remove `@ts-nocheck`
2. Type the `parseArgs` options (TypeScript infers the parsed shape)
3. Add types for any local data structures
4. Ensure all lib imports use typed interfaces

- [ ] **Step 1: Type calculator CLI files**

`calc-build.ts`, `stagger-build.ts`, `cleave-build.ts`, `toughness-build.ts` — all follow the same pattern of loading builds, running calculators, formatting output.

- [ ] **Step 2: Type scoring and analysis CLI files**

`score-build.ts` (CLI portion), `analyze-synergy.ts`, `recommend-build.ts`, `report-build.ts`, `freeze-scores.ts`

- [ ] **Step 3: Type resolution and audit CLI files**

`resolve-ground-truth.ts`, `audit-build-names.ts`, `canonicalize-build.ts`, `reresolve-builds.ts`, `inspect-ground-truth.ts`, `coverage-ground-truth.ts`, `build-ground-truth-index.ts` (CLI portion), `export-bot-weapons.ts`

- [ ] **Step 4: Type extractor CLI files**

`extract-build.ts`, `extract-buff-effects.ts`, `extract-breed-data.ts`, `extract-damage-profiles.ts`, `extract-stagger-settings.ts`, `extract-tree-edges.ts`

- [ ] **Step 5: Type entity management CLI files**

`expand-entity-coverage.ts`, `enrich-entity-names.ts`, `fix-malformed-slugs.ts`, `scrape-gl-catalog.ts`, `generate-weapon-name-mapping.ts`, `generate-missing-entities.ts`, `migrate-build-fixtures.ts`

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit
npm test
git add src/cli/
git commit -m "feat: type all CLI entry points (#1)"
```

---

## Task 10: Type Test Files

All `.test.ts` files. Remove `@ts-nocheck`, add types for test fixtures and assertions.

**Files:** all 34 test files in `src/lib/*.test.ts` and `src/cli/*.test.ts`

**Pattern:**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { someFunction } from "./some-module.js";

describe("someFunction", () => {
  it("should handle typical input", () => {
    const result = someFunction(input);
    assert.deepStrictEqual(result, expected);
  });
});
```

Tests mostly need typing for:
- Imported fixture data (type as the generated schema interfaces)
- Mock objects (use `Partial<SomeInterface>` or build proper fixtures)
- Assertion inputs

- [ ] **Step 1: Type lib test files**

Remove `@ts-nocheck` from all `src/lib/*.test.ts` files. Fix type errors.

- [ ] **Step 2: Type CLI test files**

Remove `@ts-nocheck` from all `src/cli/*.test.ts` files. Fix type errors.

- [ ] **Step 3: Verify all tests pass with type checking**

```bash
npx tsc -p tsconfig.test.json --noEmit
npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "feat: type all test files (#1)"
```

---

## Task 11: Final Verification & Cleanup

Switch from `tsx` to compiled `tsc` + `node` for production. Verify the full pipeline.

**Files:**
- Modify: `package.json` (switch scripts from `tsx` to `node dist/`)
- Modify: `Makefile` (add build dependency)
- Modify: `AGENTS.md` (update tech stack, file paths)
- Modify: `HANDOFF.md`

- [ ] **Step 1: Verify no `@ts-nocheck` remains**

```bash
grep -r "@ts-nocheck" src/
```

Expected: zero matches.

- [ ] **Step 2: Full compilation**

```bash
npm run build
```

Expected: `tsc` compiles all files to `dist/` with zero errors.

- [ ] **Step 3: Switch package.json scripts from tsx to node dist/**

Replace `tsx src/cli/foo.ts` with `node dist/cli/foo.js` in all script commands. Keep `tsx --test` for the test command (tests don't compile to dist).

```jsonc
{
  "scripts": {
    "build": "npm run build:types && tsc",
    "test": "tsx --test src/**/*.test.ts",
    "resolve": "node dist/cli/resolve-ground-truth.js",
    "audit": "node dist/cli/audit-build-names.js",
    // ... etc, all CLI commands use node dist/cli/
    "check": "npm run build && npm run index:build && npm test && npm run index:check"
  }
}
```

Note: `check` now includes `npm run build` before running commands.

- [ ] **Step 4: Update Makefile**

Add `build` as a dependency for targets that run compiled code:

```makefile
build:
	npm run build

check: require-source-root build edges-build effects-build breeds-build profiles-build stagger-build
	GROUND_TRUTH_SOURCE_ROOT="$(GROUND_TRUTH_SOURCE_ROOT)" npm run check
```

- [ ] **Step 5: Run full quality gate**

```bash
make check
```

Expected: all edges/effects/breeds/profiles/stagger build steps succeed, index builds, all tests pass, index check passes.

- [ ] **Step 6: Verify frozen snapshots are unchanged**

```bash
git diff tests/fixtures/
```

Expected: no changes. The migration should not alter any computed output.

- [ ] **Step 7: Create library entry point**

Create `src/lib/index.ts` with re-exports for the public API surface (what the website will import):

```typescript
// Core types
export type { CanonicalBuild, BuildSelection } from "../generated/schema-types.js";

// Resolution
export { resolveQuery } from "./resolve.js";
export { buildIndex } from "./ground-truth-index.js";

// Calculators
export { computeBreakpoints, summarizeBreakpoints } from "./damage-calculator.js";
export { computeStagger } from "./stagger-calculator.js";
export { computeCleave } from "./cleave-calculator.js";
export { computeToughness } from "./toughness-calculator.js";

// Scoring & analysis
export { generateScorecard } from "./score-build.js";
export { analyzeSynergy } from "./synergy-model.js";
```

This is a stub — expand as website needs arise.

- [ ] **Step 8: Update AGENTS.md**

Update:
- Tech Stack section: "TypeScript (strict), Node.js ESM" instead of "Node.js ESM JavaScript"
- File paths in Data Architecture section
- Commands section (if any paths changed)
- Remove `#1` from Open Issues, add to Completed Issues

- [ ] **Step 9: Final commit**

```bash
git add -A
git commit -m "feat: complete TypeScript migration (#1)

Switch from tsx to compiled tsc+node, add library entry point,
update AGENTS.md and Makefile. All 97 files typed strict."
```

---

## Verification Summary

After all tasks complete:

| Check | Command | Expected |
|---|---|---|
| No `@ts-nocheck` | `grep -r "@ts-nocheck" src/` | 0 matches |
| No `.mjs` source files | `find src -name "*.mjs"` | 0 matches |
| tsc compiles clean | `npm run build` | Exit 0, zero errors |
| All tests pass | `npm test` | 872+ tests pass |
| Full quality gate | `make check` | Exit 0 |
| Snapshots unchanged | `git diff tests/fixtures/` | No changes |
| Type checking tests | `npx tsc -p tsconfig.test.json --noEmit` | Exit 0 |
