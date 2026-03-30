# TypeScript Migration Design Spec

**Issue:** #1
**Date:** 2026-03-29
**Status:** Draft

## Goal

Migrate the entire hadrons-blessing codebase from plain Node ESM JavaScript to strict TypeScript. The migration must complete before #6 (website) begins so the website builds on typed foundations from day one.

## Decisions

- **Strict from the start** — `strict: true`, no `any` escape hatches
- **Schemas stay authoritative** — TS types generated from the 23 existing JSON schemas via `json-schema-to-typescript`; `ajv` continues runtime validation at system boundaries
- **Compile to JS** — `tsc` emits to `dist/`; `node` runs compiled output; zero runtime TS dependencies
- **Layer-by-layer migration** — 4 PRs in dependency order, each strict-passing before the next starts

## Project Structure

### Before

```
scripts/
  *.mjs                      # CLI entry points + extractors (30+ files)
  builds/                    # 23 canonical build JSON fixtures
  ground-truth/
    lib/                     # library modules (33 files)
data/
  ground-truth/
    entities/, aliases/, edges/, evidence/, non-canonical/
    schemas/                 # 23 JSON schemas
    generated/               # gitignored build artifacts
  exports/
tests/
  fixtures/
```

### After

```
src/
  lib/                       # from scripts/ground-truth/lib/*.mjs -> *.ts
  cli/                       # from scripts/*.mjs (CLI entry points) -> *.ts
  generated/                 # schema-derived TS types (gitignored)
    schema-types.ts
dist/                        # tsc output (gitignored)
  lib/
  cli/
scripts/
  generate-schema-types.mjs  # type generation tooling (stays as JS)
data/
  builds/                   # moved from scripts/builds/ (data, not code)
  ground-truth/              # unchanged
  exports/                   # unchanged
tests/
  fixtures/                  # unchanged (test data)
```

Key changes:
- `scripts/ground-truth/lib/` -> `src/lib/`
- `scripts/*.mjs` (CLI/extractors) -> `src/cli/`
- `scripts/*.test.mjs` -> co-located `src/**/*.test.ts` (next to their source)
- `scripts/builds/` -> `data/builds/` (data belongs with data)
- `scripts/` retained only for build tooling (`generate-schema-types.mjs`)
- `src/generated/` for generated schema types (gitignored)
- `dist/` for compiled output (gitignored)

Test files are co-located with source (e.g. `src/lib/damage-calculator.test.ts` next to `src/lib/damage-calculator.ts`). Test fixtures stay in `tests/fixtures/`.

## TypeScript Configuration

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2024",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- **`target: ES2024`** — Node 25 supports all ES2024 features natively
- **`module: Node16`** — enforces explicit `.js` extensions in imports (matches Node ESM resolution)
- **`declaration: true`** — emits `.d.ts` for downstream consumers (website, BetterBots)
- **`resolveJsonModule`** — enables typed JSON imports for data files

### Test Configuration

```jsonc
// tsconfig.test.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

Tests run via `tsx` (fast TS executor for `node:test`), not compiled to `dist/`. This avoids polluting the build output with test code.

## New Dependencies (dev only)

| Package | Purpose |
|---------|---------|
| `typescript` | Compiler |
| `json-schema-to-typescript` | Generate TS interfaces from JSON schemas |
| `@types/node` | Node.js type definitions |
| `tsx` | Run test files directly without compilation |

Zero new runtime dependencies. The project stays dependency-free at runtime.

## Type Generation from Schemas

The 23 JSON schemas in `data/ground-truth/schemas/` are the source of truth. A build script generates TypeScript interfaces from them:

```bash
npm run build:types   # generates src/generated/schema-types.ts
```

Example output for `build-selection.schema.json`:

```typescript
export interface BuildSelection {
  raw_label: string;
  canonical_entity_id: string | null;
  resolution_status: "resolved" | "unresolved" | "non_canonical";
  value?: {
    min: number;
    max: number;
    unit: string;
  };
}
```

Conditional schema logic (`allOf` + `if/then`) produces discriminated unions — code that switches on `resolution_status` gets compile-time exhaustiveness checking.

Generated file: `src/generated/schema-types.ts` (gitignored, rebuilt before each compile).

## Path Resolution

### Problem

Every file that resolves paths to `data/` currently uses:

```javascript
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "..", "..", "data", "ground-truth");
```

After compilation, JS runs from `dist/`, so these relative paths break.

### Solution

A single `src/lib/paths.ts` module resolves the repo root once (by walking up to find `package.json`) and exports all data paths:

```typescript
export const REPO_ROOT: string;
export const DATA_ROOT: string;
export const GROUND_TRUTH_ROOT: string;
export const ENTITIES_ROOT: string;
export const SCHEMAS_ROOT: string;
export const BUILDS_ROOT: string;
// ... etc
```

All modules import from `paths.ts` instead of computing `__dirname`-relative paths. This eliminates the scattered path computation and makes the codebase location-independent.

## Package.json Changes

```jsonc
{
  "main": "dist/lib/index.js",      // library entry point (new)
  "types": "dist/lib/index.d.ts",   // type declarations
  "scripts": {
    "build": "npm run build:types && tsc",
    "build:types": "node scripts/generate-schema-types.mjs",
    "clean": "rm -rf dist",
    "prebuild": "npm run clean",
    "test": "tsx --test src/**/*.test.ts",
    "check": "npm run build && npm run index:build && npm test && npm run index:check",
    "resolve": "node dist/cli/resolve-ground-truth.js",
    "audit": "node dist/cli/audit-build-names.js",
    "calc": "node dist/cli/calc-build.js",
    "// note": "all other npm run commands similarly updated to point at dist/cli/"
  }
}
```

Note: `build:types` is a plain JS script (not TS) since it runs before the TS compiler and generates input for it.

## Makefile Changes

All targets updated to run `npm run build` first (or depend on a `build` target). The `check` target becomes:

```makefile
build:
	npm run build

check: require-source-root build edges-build effects-build breeds-build profiles-build stagger-build
	GROUND_TRUTH_SOURCE_ROOT="$(GROUND_TRUTH_SOURCE_ROOT)" npm run check
```

## Migration Layers

### Layer 1: Foundation (~10 files)

Establishes the type system and migrates leaf dependencies that everything else imports.

Files:
- `src/lib/paths.ts` — new: centralized path resolution
- `src/lib/load.ts` — from `scripts/ground-truth/lib/load.mjs`
- `src/lib/normalize.ts` — from `scripts/ground-truth/lib/normalize.mjs`
- `src/lib/validate.ts` — from `scripts/ground-truth/lib/validate.mjs`
- `src/lib/registry.ts` — from `scripts/ground-truth/lib/registry.mjs`
- `src/lib/build-shape.ts` — from `scripts/ground-truth/lib/build-shape.mjs`
- `src/lib/non-canonical.ts` — from `scripts/ground-truth/lib/non-canonical.mjs`
- `src/lib/cli.ts` — from `scripts/ground-truth/lib/cli.mjs`
- `src/generated/schema-types.ts` — generated from JSON schemas
- `scripts/generate-schema-types.mjs` — type generation script (stays as JS)
- `tsconfig.json`, `tsconfig.test.json`

Also in this PR:
- Move `scripts/builds/` to `data/builds/`
- Update `.gitignore` for `dist/` and `src/generated/`
- Install dev dependencies
- Update package.json structure

**Gate:** `tsc` passes with `strict: true`. Existing JS files can still import from `dist/`.

### Layer 2: Resolution & Classification (~8 files)

Migrates the entity resolution pipeline and build classification system.

Files:
- `src/lib/resolve.ts`
- `src/lib/build-classification.ts`
- `src/lib/build-classification-registry.ts`
- `src/lib/build-canonicalize.ts`
- `src/lib/build-audit.ts`
- `src/lib/inspect.ts`
- `src/lib/coverage.ts`
- `src/cli/build-ground-truth-index.ts`

**Gate:** `tsc` passes. Resolution and audit commands work against `dist/`.

### Layer 3: Calculators & Models (~18 files)

The computational core — damage pipeline, stagger, cleave, toughness, synergy, scoring, recommendations, and Lua parsing.

Files:
- `src/lib/damage-calculator.ts`
- `src/lib/stagger-calculator.ts`
- `src/lib/cleave-calculator.ts`
- `src/lib/toughness-calculator.ts`
- `src/lib/breakpoint-checklist.ts`
- `src/lib/synergy-model.ts`
- `src/lib/synergy-rules.ts`
- `src/lib/synergy-stat-families.ts`
- `src/lib/build-scoring.ts`
- `src/lib/build-recommendations.ts`
- `src/lib/recommend-formatter.ts`
- `src/lib/report-formatter.ts`
- `src/lib/build-report.ts`
- `src/lib/lua-data-reader.ts`
- `src/lib/lua-tree-parser.ts`
- `src/lib/talent-settings-parser.ts`
- `src/lib/condition-tagger.ts`
- `src/lib/buff-semantic-parser.ts`

**Gate:** `tsc` passes. All calculator CLIs produce identical output to pre-migration baselines.

### Layer 4: CLI & Extractors + Tests (~27 + 34 files)

All remaining CLI entry points, extractor scripts, and test files.

CLI files (`src/cli/`):
- `calc-build.ts`, `stagger-build.ts`, `cleave-build.ts`, `toughness-build.ts`
- `score-build.ts`, `recommend-build.ts`, `report-build.ts`
- `analyze-synergy.ts`, `audit-build-names.ts`, `canonicalize-build.ts`
- `resolve-ground-truth.ts`, `reresolve-builds.ts`, `inspect-ground-truth.ts`
- `coverage-ground-truth.ts`, `export-bot-weapons.ts`, `freeze-scores.ts`
- `extract-build.ts`, `extract-buff-effects.ts`, `extract-breed-data.ts`
- `extract-damage-profiles.ts`, `extract-stagger-settings.ts`, `extract-tree-edges.ts`
- `expand-entity-coverage.ts`, `enrich-entity-names.ts`, `fix-malformed-slugs.ts`
- `scrape-gl-catalog.ts`, `generate-weapon-name-mapping.ts`
- `generate-missing-entities.ts`, `migrate-build-fixtures.ts`

Test files: all 34 `.test.mjs` files become `.test.ts`, co-located with their source in `src/lib/` and `src/cli/`. Run via `tsx --test`.

**Gate:** `tsc` passes. `npm test` passes (all 872+ tests). `make check` passes. No `.mjs` source files remain (only `scripts/generate-schema-types.mjs`).

## Verification Strategy

Each layer verifies:
1. **`tsc` compiles clean** — zero errors with `strict: true`
2. **All existing tests pass** — `npm test` green
3. **CLI output unchanged** — spot-check key commands against pre-migration output
4. **Frozen snapshots match** — calc, stagger, cleave, toughness, score, synergy snapshots unchanged (proves numerical correctness preserved)

Final verification after Layer 4:
- `make check` passes (full quality gate)
- No `.mjs` source files remain (only `scripts/generate-schema-types.mjs` which is tooling)
- `npm run build` produces clean `dist/` output

## Out of Scope

- Website architecture (#6) — separate issue, builds on this migration
- Runtime dependency additions — stays zero runtime deps
- Refactoring logic — pure type migration, no behavioral changes
- Test coverage improvements — tests migrate as-is
- Library entry point API design (`src/lib/index.ts` exports) — stub in Layer 1, flesh out when website needs arise
