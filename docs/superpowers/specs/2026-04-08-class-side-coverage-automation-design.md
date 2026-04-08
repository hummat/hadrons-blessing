# Class-Side Coverage Automation — Design Spec

**Issue:** #19 — Automate full class-side entity and Games Lantern alias coverage
**Date:** 2026-04-08
**Scope:** Class-side selectable node coverage only: `ability`, `blitz`, `aura`, `keystone`, `talent`, `talent_modifier`. Shared weapons, perks, gadget traits, and blessing families are out of scope.

## Motivation

The current repo claims more class-side coverage than it actually enforces. Shared domains are mostly automated, but class-side domains still depend on manual shards and sampled GamesLantern labels. That is why `Ranged Fusilade` broke resolution twice: first the canonical entity was missing, then the real GL label still resolved `unresolved` because alias coverage was not mechanically enforced.

This is not a data-entry problem. It is a pipeline problem. Source-backed class nodes and user-facing GL labels are different inputs with different failure modes, and the repo currently treats both as if sampled fixture coverage were enough.

## Current State

### What already exists

- `src/lib/lua-tree-parser.ts` parses `*_tree.lua` layout files into node inventory and topology.
- `src/lib/tree-edge-generator.ts` already knows how to turn parsed tree nodes into `tree_node` entities and structural edges.
- `src/cli/extract-buff-effects.ts` already loads class talent settings via `loadAllTalentSettings()` and uses class-side `internal_name` values as stable join keys for calc extraction.
- `src/lib/build-classification-registry.ts` already encodes GL slug-to-slot/kind knowledge for canonicalization.
- `src/cli/extract-build.ts` already contains the DOM extraction logic for GL talent nodes and their slugs.

### What is missing

- `src/cli/expand-entity-coverage.ts` does not generate class-side canonical entities.
- `src/cli/enrich-entity-names.ts` does not generate class-side GL aliases.
- Tests in `src/lib/ground-truth.test.ts` still prove sampled labels, not full-tree completeness.
- There is no generated manifest that says, for a given class, which source-backed selectable nodes must exist and which GL labels are expected to resolve.

## Rejected Approaches

### A. Audit-only

Add tests over the current manual alias shards and stop there.

Rejected because it preserves the real problem: class-side entities remain partially hand-maintained. It catches regressions but does not reduce the amount of silent manual work.

### B. Full live scraping in CI

Generate entities and aliases by scraping GamesLantern during `npm run check`.

Rejected because it ties correctness to network access, DOM drift, rate limits, and cookie behavior. CI must stay deterministic and offline against checked-in artifacts plus the pinned Darktide source root.

### C. Monolithic generator that mixes source and GL concerns

One script reads Darktide source, scrapes GL, and rewrites all entities and aliases in one pass.

Rejected because source-backed entity coverage and GL label coverage fail independently. Coupling them makes debugging and review worse.

## Recommended Architecture

Use a hybrid pipeline with two independent generators and one strict audit layer.

1. **Source-backed class manifest**
   Build a complete per-class inventory of selectable class-side nodes from the pinned Darktide source.
2. **GL label manifest**
   Build a per-class inventory of observed GamesLantern class-side labels from a checked-in scrape artifact, not from live scraping during verification.
3. **Strict completeness audits**
   Verify that checked-in canonical entities and alias shards cover both manifests. Missing coverage fails tests before merge.

This keeps the contract deterministic:

- Darktide source defines what class-side nodes exist.
- Checked-in GL scrape artifacts define what GL labels must resolve.
- Ground-truth shards remain the canonical checked-in data surface.
- Tests verify that the shards are complete relative to those manifests.

## Data Model

Add one generated artifact for source-backed class coverage and one for GL alias coverage.

### 1. `data/ground-truth/generated/class-tree-manifest.json`

Purpose: complete source-backed inventory for every supported class.

Per class, each entry should include:

- `class`
- `widget_name`
- `tree_type`
- `slot`
- `kind`
- `internal_name`
- `entity_id`
- `layout_ref` (`path`, `line`)
- optional `talent_settings_ref` when resolvable

This file is generated only from the pinned Darktide source and existing in-repo parsing/classification logic.

### 2. `data/ground-truth/generated/gl-class-tree-labels.json`

Purpose: complete external label inventory for class-side GL names.

Per class, each entry should include:

- `class`
- `slug`
- `slot`
- `kind`
- `display_name`
- `normalized_text`
- `source`
- `observed_on`

`source` is the provenance of the checked-in scrape artifact, not a vague note. `observed_on` should record the class route or seed URL used to obtain the label.

This file is generated from a checked-in browser scrape path. It is not fetched in CI.

## Pipeline Design

### Phase 1: Generate class-side source manifest

Add a new generator that:

- scans all supported class layout files under `scripts/ui/views/talent_builder_view/layouts/`
- parses them with `parseLuaTree()`
- classifies each selectable node into `slot` and canonical `kind`
- resolves the canonical entity id that should exist for that node
- writes the manifest to `data/ground-truth/generated/class-tree-manifest.json`

The generator must reuse existing mapping rules instead of inventing new ones:

- tree node parsing from `src/lib/lua-tree-parser.ts`
- type-to-kind logic from `src/lib/tree-edge-generator.ts`
- slot routing from `src/lib/build-classification-registry.ts`

The output of this phase is the authoritative list of source-backed class-side entity ids that must exist.

### Phase 2: Generate canonical entities from source manifest

Extend class-side entity coverage generation so that every source-backed selectable node in the manifest has a canonical entity record in the checked-in domain shard.

Rules:

- `ability`, `blitz`, `aura`, `keystone`, `talent`, and `talent_modifier` are generated from source.
- `tree_node` entities remain generated from tree layouts as they already are.
- refs must point to real source lines.
- generated entities must preserve existing checked-in `calc`, `ui_name`, `loc_key`, and evidence-compatible fields where already present.
- generation must be idempotent and must not delete hand-curated fields that still matter.

This phase does not depend on GL.

### Phase 3: Generate GL class-side label manifest

Add a separate generator for class-side GL labels.

The scraper should reuse the DOM extraction logic already present in `src/cli/extract-build.ts`:

- talent node extraction
- slug parsing
- frame-based tier interpretation
- slug normalization

The scraper should write a checked-in raw artifact or a direct normalized manifest, but verification must consume a local file, not a live site.

Preferred acquisition order:

1. scrape deterministic class tree pages if GamesLantern exposes them reliably
2. otherwise scrape one maintained seed page per class that exposes the full tree
3. if neither is reliable, keep a checked-in harvested artifact and treat refreshing it as explicit maintenance work

The design does not assume that live GL scraping is always available. The checked-in manifest is the contract.

### Phase 4: Generate or audit class-side aliases

Do not treat handwritten alias shards as the primary source anymore.

Instead:

- generate alias candidates from `gl-class-tree-labels.json`
- write them into per-class alias shards or merge them into those shards deterministically
- keep context constraints strict: `class` and `kind`
- keep provenance explicit, e.g. `gl-class-tree`

If some labels still require manual overrides, those overrides must live in the checked-in alias shards but must be merged on top of the generated alias set, not replace it.

### Phase 5: Enforce completeness

Replace sample-only confidence with manifest-based tests.

The tests should verify:

- every manifest `entity_id` exists in checked-in entities
- every GL label manifest entry resolves to the expected entity under `{ class, kind }`
- every alias emitted from the generator is either present in the checked-in shard or explicitly suppressed with a documented reason
- `canonicalize` and `reresolve` round-trip representative GL-derived inputs without degrading resolved class-side selections

## Classifying Source Nodes

There is one subtlety here: the tree layout `type` is not enough to decide final slot/kind behavior in all cases.

Examples already present in the repo:

- `tactical` should map to `blitz`, not generic `ability`
- some `keystone`-typed Arbites companion-focus nodes are intentionally routed into `talents` to avoid duplicate keystone slots
- `ability_modifier`, `tactical_modifier`, and `keystone_modifier` all become `talent_modifier` entities but still belong to different structural branches

So the manifest builder must compose two sources:

- raw tree node type from the source layout
- slot routing exceptions from `build-classification-registry.ts`

The registry should become the single slot-routing authority for GL-facing class-side nodes. If its current format is awkward for source generation, refactor the registry shape once and reuse it in both canonicalization and coverage generation.

## Boundaries Between Generated and Curated Data

### Generated

- class-side source manifest
- GL class-side label manifest
- generated class-side alias candidates
- generated completeness expectations used by tests

### Curated

- canonical entity shards in `data/ground-truth/entities/*.json`
- alias shards in `data/ground-truth/aliases/*.json`
- evidence records for non-obvious mappings
- explicit suppressions for impossible or intentionally unsupported labels

The repo should continue to review and commit canonical JSON shards, not hide the truth inside transient generated state. The difference is that generation now proves completeness instead of leaving it to memory.

## Verification Strategy

Add manifest-based tests to `src/lib/ground-truth.test.ts` or a dedicated adjacent test module.

Required checks:

1. `class-tree-manifest.json` is internally consistent.
2. Every manifest entity id exists in the built index.
3. Every `gl-class-tree-labels.json` entry resolves under the expected `{ class, kind }`.
4. Missing alias coverage fails with the exact class, label, kind, and expected entity id.
5. Missing class-side entities fail with the exact source node and entity id.
6. `canonicalize` and `reresolve` remain stable for fixture inputs derived from GL labels.

Failure output must be targeted. A failed audit should tell the developer exactly which node or label is missing, not force manual diff spelunking.

## CLI and Makefile Integration

Add explicit build steps for the new generated artifacts, then wire them into existing quality gates.

Expected commands:

- `npm run class-tree:build` for source-backed class manifest generation
- `npm run gl-class-tree:build` for GL label manifest generation
- `npm run check` should validate the manifests and fail on incompleteness

Live browser scraping, if required to refresh the GL manifest, should remain an explicit maintenance command and should not run inside normal `check`.

## Risks

### GL scrape instability

GamesLantern is external and DOM-driven. The answer is not to ignore it; the answer is to isolate it behind a checked-in artifact and deterministic tests.

### Registry drift

If `build-classification-registry.ts` remains manual and the source manifest depends on it, the registry itself becomes a coverage surface. That is acceptable only if tests fail whenever source-backed nodes are unclassified.

### Overwriting curated data

Entity and alias generators must merge idempotently. Blind regeneration that drops curated notes, evidence links, or existing fields is unacceptable.

### False confidence from slug-based name synthesis

Do not generate GL alias text from slug title-casing alone. Use actual observed GL labels from the scrape artifact. Slug synthesis is acceptable only as a fallback diagnostic, not as canonical alias input.

## Implementation Sequence

1. Add the source-backed class manifest generator.
2. Add failing completeness tests against the source manifest.
3. Extend entity coverage generation until those tests pass.
4. Add the GL class-side label manifest generator or checked-in artifact normalizer.
5. Add failing alias completeness tests against the GL manifest.
6. Extend alias generation/merge until those tests pass.
7. Add round-trip regression coverage for `canonicalize` and `reresolve`.

This order is deliberate. Source-backed entity completeness is local and deterministic. It should land first. GL alias completeness is second because it depends on external scrape input and will need a clearer artifact boundary.

## Deferred

- Full elimination of manual evidence records
- Any attempt to infer GL display names from localization keys without observed GL text
- Website work in `#6`
- Curio cosmetic item-name coverage

## Acceptance Criteria

- All source-backed class-side selectable nodes for all supported classes exist as canonical entities.
- A generated source manifest proves that completeness.
- All known GL-exposed class-side labels are represented in a checked-in manifest and resolve under the correct `{ class, kind }`, or they are explicitly suppressed with documented rationale.
- `npm run check` fails on missing class-side entity coverage or alias coverage before merge.
- `canonicalize` and `reresolve` preserve resolved class-side labels for GL-derived inputs without one-off manual alias fixes.
