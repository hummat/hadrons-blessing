# GL Alias Corpus Automation

**Issue:** #21 — Expand GL alias coverage beyond the canonical fixture set
**Date:** 2026-04-10
**Scope:** Full Games Lantern alias corpus for weapons, perks, blessings, and class-side talent labels, with high-confidence alias generation into the existing resolver shards.

## Problem

The canonical 24-build fixture set is clean, but that is not the same thing as broad Games Lantern coverage. Fresh live GL samples still expose a residual alias tail outside the curated fixture set.

Today the project has three separate GL-facing paths:

- class-side labels from build-page talent trees
- weapon names from the GL weapons catalog plus a curated mark mapping
- a small set of manually added GL label aliases for perks and blessings

That split leaves the backend with uneven coverage. New GL-facing labels can still surface as `unresolved` even when the source-backed entity graph already contains enough information to match them.

The issue is not “make one more sample pass.” The issue is that there is no single, reviewable, generated GL corpus that the alias layer can be derived from.

## Goal

Build one proper GL corpus and one proper alias-generation pipeline now.

The output should let the project:

- scrape and check in a broad GL corpus for weapons, perks, blessings, and class-side labels
- derive aliases from that corpus using the existing source-backed graph
- auto-write only high-confidence aliases into the existing alias shards
- emit a review artifact for ambiguous or unmatched corpus entries
- measure corpus coverage directly in tests

This is a backend coverage task. It should not introduce a second resolver or a parallel matching engine at runtime.

## Non-Goals

- Replacing the existing resolver scoring model
- Replacing hand-curated manual aliases that cover cases the corpus cannot prove
- Solving unrelated entity gaps outside GL-facing names
- Scraping arbitrary GL build pages as the primary corpus source
- Auto-merging ambiguous within-family weapon mark mappings without review

## Existing Constraints

The design must preserve these repository realities:

- The resolver already consumes alias shards under `data/ground-truth/aliases/`
- `talents` already have a class-side GL scrape path via `gl-class-tree-labels.json`
- `weapons` already have a GL catalog scrape plus mark-mapping path
- `perks` already have partial enrichment, but not full GL-formatted coverage
- `blessings` are the largest remaining gap because they need both GL text and source-backed weapon-family context
- The entity graph in `data/ground-truth/edges/*.json` is the authoritative structure for `weapon_has_trait_pool` and `instance_of`

No part of this design is allowed to bypass the source-backed graph with loose text-only matching.

## Corpus Model

Introduce a generated GL corpus with explicit domain-specific artifacts plus a normalized union artifact.

### Generated artifacts

All generated files live in `data/ground-truth/generated/`.

1. `gl-weapons.json`
   Contains the current GL weapons catalog plus page-level metadata that can be scraped reliably.

2. `gl-perks.json`
   Contains the full GL perk catalog, including the exact GL display string, slot (`melee` or `ranged`), and normalized variants used by alias generation.

3. `gl-blessings.json`
   Contains blessing index entries plus per-blessing detail-page data:
   - exact GL blessing name
   - description/effect text
   - source URL
   - any discoverable weapon-page usage or weapon-type references

4. `gl-class-tree-labels.json`
   Existing class-side output stays, but becomes part of the corpus contract rather than a separate special case.

5. `gl-alias-corpus.json`
   Normalized union artifact used by matching and coverage tests. Each record has:
   - `domain`: `weapon` | `weapon_perk` | `weapon_trait` | `talent`
   - `raw_label`
   - `normalized_label`
   - `source_url`
   - `source_kind`
   - optional `slot`
   - optional `class`
   - optional `weapon_type_labels`
   - optional `weapon_family_candidates`
   - optional `description`
   - optional `metadata`

The domain-specific artifacts are for inspection and debugging. `gl-alias-corpus.json` is the stable contract for matching and coverage measurement.

## Scrape Surface

### Weapons

Source:

- existing `/api/weapons` capture via Playwright-backed browser session
- weapon detail pages when additional metadata is useful and stable

Collected fields:

- GL ID
- display name
- URL slug
- detail page URL
- class unlock metadata
- any stable weapon-type text visible on the page

Weapon scraping remains the source of truth for GL-facing weapon labels.

### Perks

Source:

- `/weapon-perks`

Collected fields:

- exact GL perk label
- slot (`melee` or `ranged`)
- source URL

Normalization rules are generated, not handwritten:

- strip numeric ranges for secondary normalized variants
- normalize `Weak Spot` and `Weakspot`
- preserve the exact original GL label for alias text

### Blessings

Source:

- `/weapon-blessing-traits` overview table
- each blessing detail page under `/blessings/<slug>`

Collected fields:

- exact GL blessing name
- blessing detail URL
- exact GL description/effect text
- any listed or inferable weapon-type labels from overview/detail pages

The blessing detail page text is required because blessing names alone are not reliable enough to match families safely.

### Talents

Source:

- existing build-page talent tree scrape seeded from checked-in GL build fixtures

This design does not replace the talent scrape. It makes its output part of the same corpus model and coverage accounting.

## Matching Rules

The corpus matcher is graph-first and conservative.

### Talents

Use only class-scoped exact GL labels from the class-tree corpus.

Rules:

- exact label to entity only
- constrained by `class` and `kind`
- no fuzzy expansion beyond the existing class-side logic

### Weapons

Use exact GL weapon display names plus the existing mark-mapping flow.

Rules:

- exact GL weapon name becomes alias text
- template mapping remains family-aware
- ambiguous within-family mark assignments stay manual/reviewed
- no fuzzy weapon-name generation beyond existing patterns

### Perks

Use the GL perk corpus to generate exact GL-facing aliases for existing perk entities.

Rules:

- constrain by `kind=weapon_perk` and `slot`
- generate aliases for the exact GL display string
- generate deterministic normalized siblings only when they are clearly formatting variants of the same GL label
- do not use description similarity because the GL perk page does not expose per-perk descriptions

This closes variants such as `4-10% Ranged Weak Spot Damage` without turning perks into free-form fuzzy matching.

### Blessings

Blessing matching is the core of `#21`.

Rules:

1. Start from the GL blessing corpus entry.
2. Narrow candidate source-backed families by weapon-family context:
   - derive candidate internal weapon families from GL weapon-type labels and scraped weapon usage
   - traverse `weapon_has_trait_pool` edges
   - traverse `instance_of` edges to blessing `name_family`
3. Compare the GL description text to the source-backed trait family already reachable through that graph.
4. Emit an alias only if exactly one blessing family remains plausible.

The text comparison is not generic embedding or vague similarity. It is deterministic heuristic scoring over:

- normalized key terms
- stack counts
- duration values
- named mechanics (`suppression`, `weakspot`, `ammo`, `overheat`, `warp`, `crit`, `power`)
- weapon-family compatibility

If graph narrowing does not produce a unique family, the alias is not written.

## Confidence Policy

Every corpus entry ends in one of three states:

1. `high_confidence_match`
   Safe to write into alias shards automatically.

2. `review_required`
   Plausible candidates exist, but the match is not unique enough.

3. `unmatched`
   No defensible graph-backed match exists.

Only `high_confidence_match` entries may modify alias shards.

This is non-negotiable. The point of the corpus is not to maximize alias count. The point is to maximize trustworthy coverage.

## Output Integration

Do not create a parallel runtime database.

Instead, extend the existing generation/enrichment path so the corpus writes into the same checked-in files the resolver already consumes:

- `data/ground-truth/aliases/shared-guides.json`
- class alias shards for class-side GL labels
- `data/ground-truth/entities/shared-weapons.json` for `ui_name` enrichment where appropriate
- `data/ground-truth/entities/shared-names.json` for `ui_name` enrichment where appropriate

Add one generated review artifact:

- `data/ground-truth/generated/gl-alias-review.json`

It contains:

- corpus entries that were matched with high confidence
- entries requiring review, with candidate families/entities and reasons
- unmatched entries, with exact labels and source URLs

This file is the debugging and maintenance surface for future GL changes.

## CLI / Pipeline Changes

### New or extended commands

1. `npm run gl:scrape`
   Scrapes and writes:
   - `gl-weapons.json`
   - `gl-perks.json`
   - `gl-blessings.json`

2. `npm run gl:corpus:build`
   Reads all GL scrape outputs plus `gl-class-tree-labels.json` and writes:
   - `gl-alias-corpus.json`

3. `npm run gl:aliases:build`
   Reads the corpus plus ground-truth entities/edges and:
   - writes high-confidence aliases into the existing alias shards
   - writes `gl-alias-review.json`

4. `npm run entities:enrich`
   Either subsumes the alias-writing step above or delegates to it, but there must be one obvious supported path in the repo docs.

### Pipeline order

Full coverage-refresh path:

```bash
npm run gl:scrape
npm run gl:corpus:build
npm run gl:aliases:build
npm run check
```

The implementation may fold steps 2 and 3 into existing commands if that keeps the code simpler, but the artifact boundaries above must remain explicit.

## Testing Strategy

This work is not done without corpus-level tests.

### Unit tests

Add tests for:

- perk row parsing and slot extraction
- blessing detail-page parsing
- corpus record normalization
- blessing candidate narrowing from weapon-family context
- deterministic match scoring
- “review required” and “unmatched” classification

### Integration tests

Add tests that assert:

- the corpus build succeeds on checked-in scrape fixtures
- high-confidence matches are written into the correct alias shards
- exact GL perk strings like `4-10% Ranged Weak Spot Damage` resolve correctly
- known blessing labels from the live-sample tail resolve correctly once covered

### Coverage tests

Add a corpus coverage test that reads `gl-alias-corpus.json` and enforces:

- all talent corpus entries resolve
- all weapon corpus entries resolve or are explicitly documented as manual/review-only
- all perk corpus entries resolve
- blessing corpus entries are either resolved, review-required, or unmatched with exact accounting

The test output must report counts by domain and state. Silent drift is unacceptable.

## Acceptance Criteria

`#21` is complete when all of the following are true:

1. A checked-in GL corpus exists for weapons, perks, blessings, and class-side labels.
2. Alias generation from that corpus is automated and graph-backed.
3. The four currently known unresolved tail cases are covered:
   - `Overpressure`
   - `Overwhelming Fire`
   - `Murderous Tranquility`
   - `4-10% Ranged Weak Spot Damage`
4. At least one additional live sample outside the canonical 24 resolves cleanly except the known curio `non_canonical` labels.
5. Any remaining unresolved GL corpus entries are emitted in `gl-alias-review.json` with exact labels and cause classification.
6. `npm run check` passes.

## Risks

1. GL page structure can change.
   The scraper should isolate parsing logic per page type and keep raw scrape fixtures for tests.

2. Blessing detail pages may not expose enough weapon usage context directly.
   The design tolerates this by using overview-table weapon-type labels, weapon-page occurrence scraping when useful, and the source-backed edge graph as the primary narrowing mechanism.

3. Some weapon mark mappings remain inherently manual.
   That is acceptable as long as the corpus surfaces them explicitly instead of hiding them in unresolved runtime behavior.

4. “Full corpus” can sprawl into a second resolver.
   Prevent this by keeping runtime behavior unchanged and limiting the new logic to generation-time alias derivation and review artifacts.

## Key Files

| File | Role |
|---|---|
| `src/cli/scrape-gl-catalog.ts` | Extend or split to scrape weapons, perks, and blessing detail pages |
| `src/cli/build-gl-class-tree-labels.ts` | Existing talent-label corpus source |
| `src/lib/*` | New parsing, normalization, corpus, and matching helpers |
| `data/ground-truth/generated/gl-weapons.json` | Generated weapon corpus |
| `data/ground-truth/generated/gl-perks.json` | Generated perk corpus |
| `data/ground-truth/generated/gl-blessings.json` | Generated blessing corpus |
| `data/ground-truth/generated/gl-alias-corpus.json` | Unified normalized corpus |
| `data/ground-truth/generated/gl-alias-review.json` | Review / unmatched report |
| `data/ground-truth/aliases/shared-guides.json` | Alias output surface for shared GL aliases |

## Recommended Implementation Order

1. Perk corpus and exact GL perk alias generation
2. Blessing detail scrape and corpus artifact
3. Blessing graph-backed matching with review artifact
4. Unified corpus coverage tests
5. Live-sample verification pass

That order closes the easy deterministic tail first and keeps the harder blessing work isolated.
