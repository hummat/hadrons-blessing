# Canonical Build Shape Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current scrape-oriented build JSON format with the approved canonical build shape and update extractor, audit, score, fixtures, and re-resolution tooling to use it end-to-end.

**Architecture:** Split the work into five chunks. First add explicit schemas and low-level selection helpers, then introduce a canonicalization stage that transforms scrape output into the new shape, then migrate the checked-in build fixtures, then update audit/score consumers to operate on persisted canonical build data, and finally add a batch re-resolution command for null-ID entries. Keep raw scrape concerns out of the canonical format and keep every stage test-first.

**Tech Stack:** Node.js ESM, `node:test`, existing resolver/audit/score scripts, JSON schema validation via Ajv, checked-in build fixtures under `scripts/builds/`.

---

## File Map

### Existing files to modify

- `scripts/extract-build.mjs`
  - Keep as the scrape entrypoint, but stop treating its current JSON as the canonical build contract.
- `scripts/audit-build-names.mjs`
  - Switch from first-pass name extraction over raw fields to canonical-build validation and drift reporting.
- `scripts/score-build.mjs`
  - Prefer canonical IDs and structured perk value payloads from canonical builds.
- `scripts/ground-truth.test.mjs`
  - Update integration tests for canonical build fixtures and new audit semantics.
- `scripts/score-build.test.mjs`
  - Update/extend tests for canonical build input and structured perk values.
- `README.md`
  - Update build format examples and command expectations once implementation lands.
- `package.json`
  - Expose any new command such as batch re-resolution.

### Existing files likely to be replaced or heavily rewritten

- `scripts/builds/*.json`
  - Migrate all 20 checked-in fixtures to the canonical build shape.

### New files to create

- `data/ground-truth/schemas/build-selection.schema.json`
  - Schema for the base selection object plus optional quantified value payload.
- `data/ground-truth/schemas/canonical-build.schema.json`
  - Top-level schema for canonical builds.
- `scripts/ground-truth/lib/build-shape.mjs`
  - Shared build-shape helpers: validation, selection invariants, slot checks.
- `scripts/ground-truth/lib/build-canonicalize.mjs`
  - Canonicalization logic from extracted scrape result to canonical build JSON.
- `scripts/canonicalize-build.mjs`
  - Browser-independent CLI entry point for converting an existing scraped/raw build JSON into the canonical build shape.
- `scripts/ground-truth/lib/build-classification-registry.mjs`
  - Maintained source-backed mapping from Games Lantern slugs to canonical class-side slot roles.
- `scripts/ground-truth/lib/build-audit.mjs`
  - Canonical-build-specific audit helpers if `audit-build-names.mjs` grows too large.
- `scripts/reresolve-builds.mjs`
  - Batch re-resolution command for unresolved/non-canonical build entries where applicable.
- `scripts/canonical-build.test.mjs`
  - Focused tests for schema validation and canonicalization behavior.
- `scripts/reresolve-builds.test.mjs`
  - Focused tests for the batch re-resolution command.

### Existing docs/specs to reference while implementing

- `docs/superpowers/specs/2026-03-13-canonical-build-shape-design.md`
- `docs/superpowers/specs/2026-03-13-cli-contract-design.md`
- `docs/plans/2026-03-13-real-input-evaluation.md`

## Chunk 1: Schemas And Selection Helpers

### Task 1: Add failing tests for canonical selection and build validation

**Files:**
- Create: `scripts/canonical-build.test.mjs`
- Reference: `docs/superpowers/specs/2026-03-13-canonical-build-shape-design.md`

- [ ] **Step 1: Write the failing tests for the selection object invariants**

Add tests that assert:
- `resolved` requires non-null `canonical_entity_id`
- `unresolved` requires `canonical_entity_id: null`
- `non_canonical` requires `canonical_entity_id: null`
- quantified `value` payload is accepted for perk-like entries

- [ ] **Step 2: Write the failing tests for canonical build top-level structure**

Add tests that assert:
- `schema_version`, `title`, `class`, `provenance`, `ability`, `blitz`, `aura`, `keystone`, `talents`, `weapons`, and `curios` are validated
- `ability`, `blitz`, and `aura` must be non-null
- `keystone` may be null
- `weapons` must contain exactly one `melee` and one `ranged` entry

- [ ] **Step 3: Run the new canonical-build tests and verify failure**

Run:

```bash
node --test scripts/canonical-build.test.mjs
```

Expected:
- FAIL because the schemas/helpers do not exist yet

- [ ] **Step 4: Create the schema files**

Create:
- `data/ground-truth/schemas/build-selection.schema.json`
- `data/ground-truth/schemas/canonical-build.schema.json`

Include:
- selection enum and ID invariants
- optional `value: { min, max, unit }`
- fixed top-level canonical build fields
- weapon slot enum with exactly one `melee` and one `ranged`

- [ ] **Step 5: Create shared validation helpers**

Create `scripts/ground-truth/lib/build-shape.mjs` with:
- build-schema loading helpers
- `validateCanonicalBuild(build)`
- `assertValidCanonicalBuild(build)`
- slot uniqueness helper for weapons

- [ ] **Step 6: Re-run the canonical-build tests and verify pass**

Run:

```bash
node --test scripts/canonical-build.test.mjs
```

Expected:
- PASS

- [ ] **Step 7: Commit**

```bash
git add data/ground-truth/schemas/build-selection.schema.json data/ground-truth/schemas/canonical-build.schema.json scripts/ground-truth/lib/build-shape.mjs scripts/canonical-build.test.mjs
git commit -m "Add canonical build schemas"
```

## Chunk 2: Canonicalization Stage

### Task 2: Add failing tests for scrape-to-canonical transformation

**Files:**
- Modify: `scripts/canonical-build.test.mjs`
- Create: `scripts/ground-truth/lib/build-canonicalize.mjs`
- Create: `scripts/ground-truth/lib/build-classification.mjs`
- Create: `scripts/ground-truth/lib/build-classification-registry.mjs`
- Create: `scripts/canonicalize-build.mjs`
- Reference: `scripts/extract-build.mjs`

- [ ] **Step 1: Add failing tests for canonicalizing a scrape-shaped build**

Use a small inline fixture based on the current extractor shape. Assert that canonicalization:
- produces `class` as a selection object
- splits fixed class decisions into `ability`, `blitz`, `aura`, `keystone`, `talents[]`
- produces weapon/curio sub-items as selection objects
- writes blessing selections at the approved family/UI identity level (`shared.name_family.blessing.*`) rather than concrete `weapon_trait` ids
- includes minimal `provenance`
- drops prose/raw scrape-only fields from the canonical output

- [ ] **Step 2: Add failing tests for class-side role mapping**

Add tests for the classification rule:
- one primary ability becomes `ability`
- modifiers stay in `talents[]`
- one primary blitz becomes `blitz`
- one primary aura becomes `aura`
- keystone is nullable

- [ ] **Step 3: Add failing tests for browser-independent canonicalization**

Add tests that assert:
- an already-scraped/raw build JSON can be canonicalized without Playwright
- `extract-build.mjs` is not the only entry point into canonicalization

- [ ] **Step 4: Run the canonical-build tests and verify failure**

Run:

```bash
node --test scripts/canonical-build.test.mjs
```

Expected:
- FAIL because canonicalization logic does not exist yet

- [ ] **Step 5: Implement canonicalization helper**

Create `scripts/ground-truth/lib/build-canonicalize.mjs` with small focused functions:
- `toSelection(rawLabel, queryContext)`
- `canonicalizeWeapon(rawWeapon, slot)`
- `canonicalizeCurio(rawCurio)`
- `classifySelectedNodes(rawBuild)`
- `canonicalizeScrapedBuild(rawBuild, options)`

Implementation requirements:
- use `resolveQuery` / non-canonical classification where applicable
- store `resolved`, `unresolved`, or `non_canonical` only
- parse quantified perk values into `value`
- keep raw labels alongside IDs
- canonicalize blessing selections to blessing family IDs only

- [ ] **Step 6: Create the class-side classification registry**

Create:
- `scripts/ground-truth/lib/build-classification.mjs`
- `scripts/ground-truth/lib/build-classification-registry.mjs`

It must own the maintained mapping from selected scrape nodes to canonical build slots:
- primary combat ability -> `ability`
- primary blitz -> `blitz`
- primary aura -> `aura`
- primary keystone -> `keystone`
- all remaining selected class-side nodes -> `talents[]`

Registry contract:

- map from Games Lantern talent-node slug to slot role metadata
- do not rely on frame shape alone
- keep the mapping outside `extract-build.mjs` and outside ad-hoc conditionals in the canonicalizer

If a selected slug has no classification entry, canonicalization must fail
explicitly or produce a deliberately unresolved class-side output according to
the test cases written above. Do not silently guess.

- [ ] **Step 7: Add a browser-independent canonicalization CLI**

Create `scripts/canonicalize-build.mjs` as a separate entry point that:
- reads an existing scraped/raw build JSON
- runs canonicalization without Playwright
- writes canonical JSON to stdout or file

This CLI is the migration path for existing checked-in fixtures.

- [ ] **Step 8: Wire canonicalization into `extract-build.mjs`**

Change `scripts/extract-build.mjs` so:
- raw page scraping remains one stage
- canonicalization is invoked as a separate importable step
- canonical JSON output becomes the default machine-readable build output
- markdown mode renders from canonicalized build decisions, not the old scrape shape

- [ ] **Step 9: Re-run targeted tests and verify pass**

Run:

```bash
node --test scripts/canonical-build.test.mjs
```

Expected:
- PASS

- [ ] **Step 10: Commit**

```bash
git add scripts/extract-build.mjs scripts/canonicalize-build.mjs scripts/ground-truth/lib/build-canonicalize.mjs scripts/ground-truth/lib/build-classification.mjs scripts/ground-truth/lib/build-classification-registry.mjs scripts/canonical-build.test.mjs
git commit -m "Canonicalize extracted builds"
```

## Chunk 3: Fixture Migration

### Task 3: Migrate checked-in build fixtures to the canonical shape

**Files:**
- Modify: `scripts/builds/*.json`
- Modify: `scripts/canonical-build.test.mjs`
- Reference: `docs/plans/2026-03-13-real-input-evaluation.md`

- [ ] **Step 1: Add failing canonical-fixture assertions**

Update `scripts/canonical-build.test.mjs` to assert that each checked-in fixture:
- validates against the canonical build schema
- contains fixed class slots
- contains selection objects for weapon names, perks, blessings, and curio perks
- stores blessing selections as `shared.name_family.blessing.*` IDs where resolved

- [ ] **Step 2: Add provenance recovery/backfill rules to the migration plan**

Before rewriting fixtures, define and implement how mandatory provenance is supplied for existing checked-in builds:
- recover `source_url` where it already exists in sidecar/sample data or repo docs
- recover `author` where already known
- backfill `source_kind = "gameslantern"` for these fixtures
- choose one explicit policy for `scraped_at` on legacy fixtures:
  - recover from existing scrape metadata if available, or
  - set a deterministic migration timestamp / imported-at timestamp and document that it is migration-time provenance rather than original scrape-time provenance

- [ ] **Step 2.5: Acknowledge the current empty-talent-data limitation**

Document in the migration notes and tests:
- the current checked-in fixtures do not preserve real class-side talent data
- migrated fixtures may therefore carry unresolved `ability` / `blitz` / `aura`
  and empty `talents[]`
- meaningful real-data validation of class-side slot machinery requires
  re-extraction from source pages with talent data present

- [ ] **Step 3: Run the canonical-build tests and verify failure**

Run:

```bash
node --test scripts/canonical-build.test.mjs
```

Expected:
- FAIL because the checked-in fixtures are still in the old shape

- [ ] **Step 4: Write or reuse a migration helper**

Prefer a small repo script over manual hand-editing. The helper should:
- read each existing fixture
- canonicalize it through `scripts/canonicalize-build.mjs` or the same importable
  canonicalization path
- inject the required provenance block according to the chosen backfill policy
- rewrite the file in canonical form

Runtime requirement:

- canonical migration requires resolver access
- executing agents must run it with
  `GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code`
  or an equivalent valid source root

- [ ] **Step 5: Migrate all 20 checked-in build fixtures**

Rewrite:
- `scripts/builds/01-veteran-squad-leader.json`
- `scripts/builds/02-assault-veteran.json`
- `scripts/builds/03-slinking-veteran.json`
- `scripts/builds/04-spicy-meta-zealot.json`
- `scripts/builds/05-fatmangus-zealot-stealth.json`
- `scripts/builds/06-holy-gains-zealot.json`
- `scripts/builds/07-zealot-infodump.json`
- `scripts/builds/08-gandalf-melee-wizard.json`
- `scripts/builds/09-electrodominance-psyker.json`
- `scripts/builds/10-electro-shriek-psyker.json`
- `scripts/builds/11-explodegryn.json`
- `scripts/builds/12-ogryn-shield-tank.json`
- `scripts/builds/13-shovel-ogryn.json`
- `scripts/builds/14-arbites-nuncio-aquila.json`
- `scripts/builds/15-arbites-melee-meta.json`
- `scripts/builds/16-arbites-busted.json`
- `scripts/builds/17-crackhead-john-wick.json`
- `scripts/builds/18-reginald-melee.json`
- `scripts/builds/19-the-chemist.json`
- `scripts/builds/20-stimmtec-blender.json`

- [ ] **Step 6: Re-run targeted canonical-build tests**

Run:

```bash
node --test scripts/canonical-build.test.mjs
```

Expected:
- PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/builds/*.json scripts/canonical-build.test.mjs
git commit -m "Migrate checked-in builds to canonical shape"
```

## Chunk 4: Audit And Score Consumer Updates

### Task 4: Update audit to consume canonical builds directly

**Files:**
- Modify: `scripts/audit-build-names.mjs`
- Create or Modify: `scripts/ground-truth/lib/build-audit.mjs`
- Modify: `scripts/ground-truth.test.mjs`

- [ ] **Step 1: Add failing tests for canonical-build audit behavior**

Add tests that assert:
- audit validates persisted `resolution_status` / `canonical_entity_id` invariants
- audit reports stale/missing canonical IDs
- audit re-resolves unresolved selections and reports newly resolvable entries
- audit covers `ability`, `blitz`, `aura`, `keystone`, and `talents[]`

- [ ] **Step 2: Run the ground-truth tests and verify failure**

Run:

```bash
GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code node --test scripts/ground-truth.test.mjs
```

Expected:
- FAIL because audit still assumes the old raw build field layout

- [ ] **Step 3: Refactor audit over canonical build structure**

Implement:
- traversal over canonical selection objects
- drift/stale-ID reporting
- validation of persisted statuses
- optional re-resolution for unresolved entries
- blessing handling at the approved family/UI identity level only (`shared.name_family.blessing.*`)
- class-side audit coverage for `ability`, `blitz`, `aura`, `keystone`, and `talents[]`

Existence check contract:

- “resolved canonical IDs still exist” means they resolve against the current
  generated/indexed ground-truth entity set built from checked-in data under the
  active source snapshot
- use the same resolver/index path as other ground-truth commands; do not invent
  a separate ad-hoc file scan

- [ ] **Step 4: Re-run audit-focused tests and verify pass**

Run:

```bash
GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code node --test scripts/ground-truth.test.mjs
```

Expected:
- PASS

- [ ] **Step 4.5: Re-freeze affected audit snapshots**

Update:
- `tests/fixtures/ground-truth/audits/08-gandalf-melee-wizard.audit.json`
- `tests/fixtures/ground-truth/audits/09-electrodominance-psyker.audit.json`
- `tests/fixtures/ground-truth/audits/10-electro-shriek-psyker.audit.json`

Use the canonical-build-aware audit output and ensure the snapshots match the
new build shape and audit semantics.

- [ ] **Step 5: Commit**

```bash
git add scripts/audit-build-names.mjs scripts/ground-truth/lib/build-audit.mjs scripts/ground-truth.test.mjs
git commit -m "Audit canonical build files"
```

### Task 5: Update score to use canonical builds and structured perk values

**Files:**
- Modify: `scripts/score-build.mjs`
- Modify: `scripts/score-build.test.mjs`

- [ ] **Step 1: Add failing tests for scoring canonical perk values**

Add tests that assert:
- score uses `value.max` from canonical perk entries instead of reparsing `raw_label`
- score still falls back sensibly when `value` is absent
- weapon lookup prefers canonical IDs when present

- [ ] **Step 2: Run the score tests and verify failure**

Run:

```bash
node --test scripts/score-build.test.mjs
```

Expected:
- FAIL because score still depends on legacy string parsing for the main path

- [ ] **Step 3: Implement canonical-build-aware scoring**

Update `scripts/score-build.mjs` so:
- canonical build input is the first-class path
- structured perk values are preferred
- canonical weapon IDs/slot metadata are used directly when present
- blessing expectations continue to key on the approved blessing family identity level, not concrete weapon-trait instance ids
- legacy string parsing remains only as a fallback where necessary

- [ ] **Step 4: Re-run score tests and verify pass**

Run:

```bash
node --test scripts/score-build.test.mjs
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/score-build.mjs scripts/score-build.test.mjs
git commit -m "Score canonical build files"
```

## Chunk 5: Batch Re-Resolution And Docs

### Task 6: Add batch re-resolution for canonical builds

**Files:**
- Create: `scripts/reresolve-builds.mjs`
- Create: `scripts/reresolve-builds.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add failing tests for batch re-resolution**

Add tests that assert:
- the command walks canonical build files
- unresolved entries are re-resolved when possible
- already resolved entries are preserved by default
- the command exits non-zero on schema-invalid build files

- [ ] **Step 2: Run the new re-resolution tests and verify failure**

Run:

```bash
node --test scripts/reresolve-builds.test.mjs
```

Expected:
- FAIL because the command does not exist yet

- [ ] **Step 3: Implement the batch re-resolution command**

Create `scripts/reresolve-builds.mjs` with:
- file discovery for canonical build fixtures
- canonical build validation
- targeted updates for unresolved/non-canonical entries
- overwrite mode for rewriting files in place

- [ ] **Step 4: Expose the command in `package.json`**

Add an `npm run` script for batch re-resolution.

- [ ] **Step 5: Re-run re-resolution tests and verify pass**

Run:

```bash
node --test scripts/reresolve-builds.test.mjs
```

Expected:
- PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/reresolve-builds.mjs scripts/reresolve-builds.test.mjs package.json
git commit -m "Add canonical build re-resolution command"
```

### Task 7: Update docs and run full verification

**Files:**
- Modify: `README.md`
- Modify: `docs/plans/2026-03-13-real-input-evaluation.md`
- Modify: `package.json` if the default test workflow needs new test files

- [ ] **Step 1: Update README examples to show the canonical build shape**

Document:
- canonical build intent
- extractor/canonicalizer expectation
- audit/score expectations on canonical builds
- re-resolution command

- [ ] **Step 2: Update the real-input evaluation doc if the measured outcomes change**

Do not treat this as conditional. Re-run the evaluation end-to-end after
migration and rewrite the metrics/caveats accordingly, because the canonical
shape adds class-side entries and changes what audit/score are measuring.

- [ ] **Step 3: Fold new tests into the default test workflow**

Ensure `npm test` includes:
- `scripts/canonical-build.test.mjs`
- `scripts/reresolve-builds.test.mjs`

- [ ] **Step 4: Run the full verification flow**

Run:

```bash
GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code npm test
```

Expected:
- PASS

- [ ] **Step 5: Run the full repo check if still applicable**

Run:

```bash
GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code make check
```

Expected:
- PASS

- [ ] **Step 6: Commit**

```bash
git add README.md docs/plans/2026-03-13-real-input-evaluation.md package.json
git commit -m "Document canonical build workflow"
```

Plan complete and saved to `docs/superpowers/plans/2026-03-13-canonical-build-shape-implementation.md`. Ready to execute?
