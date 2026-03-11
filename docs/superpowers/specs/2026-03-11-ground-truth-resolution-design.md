# Design: Ground-Truth Entity Resolution And Build Verification

## Summary

Add a machine-readable ground-truth registry plus a resolver for mapping human input to exact Darktide entities with code-backed evidence. The immediate goal is reliable Q&A, lookup, and verification of community build descriptions against decompiled source. The first rollout is a Psyker pilot that validates the approach against the exact failure mode already observed in community build analysis.

## Problem

Community guides, GamesLantern builds, scraped data, repo docs, and in-game names do not consistently use the same labels as the decompiled source. This causes three recurring failure modes:

1. A human/community name is mapped to the wrong internal talent, buff, blessing, or modifier.
2. A correct entity is reported as “unverified” because the analysis cannot bridge from UI text to internal identifiers.
3. Optimization advice is built on top of a bad entity mapping, so later reasoning is wrong even when the numeric/mechanical facts are sourced correctly.

The system needs to answer one narrow question well:

> Given human input, what exact game entity does this most likely refer to, and what source proves that?

## Goals

- Provide a canonical, source-backed registry for game entities used in build analysis.
- Resolve human input to an explicit `resolved`, `ambiguous`, or `unresolved` outcome using deterministic ranking.
- Keep alias/inference data separate from canonical facts.
- Attach exact source references to every canonical claim.
- Support later calculator work without requiring a schema rewrite.
- Prove the approach with a Psyker pilot before rolling it out repo-wide.

## Non-Goals

- Full build optimizer or DPS calculator in v1.
- Natural-language Darktide QA beyond entity resolution and evidence-backed lookup.
- Perfect UI-name recovery where the current source clone does not expose English localization payloads.
- Fully automated alias ingestion from arbitrary guide text in v1.

## Use Cases

### Primary

- Verify a community build description against decompiled source.
- Map a guide/build name like `Warp Rider` or `Brain Rupture` to the exact internal entity.
- Audit a scraped build JSON for unresolved, ambiguous, or suspicious names.
- Answer lookup questions with code-backed evidence instead of memory or doc drift.

### Secondary

- Normalize entity names used in repo docs.
- Feed future calculator or scoring tools with stable IDs and typed relationships.
- Support guided cleanup of stale community or GamesLantern naming.

## Design Principles

1. Canonical facts must be source-backed.
2. Fuzzy matching is allowed only in the alias layer.
3. The resolver may propose one best candidate, but only `resolved` outcomes are authoritative.
4. False negatives are better than silently corrupting canonical data.
5. Query context is first-class and participates in ranking.
6. Shared naming problems are modeled once, not re-solved per class.

## Architecture

The design uses three functional layers over one shared dataset:

1. **Canonical entity registry**
   - Source-backed entities only.
   - Contains internal IDs, loc keys, exact source refs, typed attributes, and graph edges.
2. **Alias registry**
   - Human-facing, community, GamesLantern, guide, shorthand, and stale names.
   - One alias text may map to multiple candidates through multiple alias records, each with context constraints and confidence.
3. **Resolver**
   - Normalizes input, applies query context, attempts exact/normalized/fuzzy matching against the alias index, and returns an explicit resolution state plus evidence.

Consumers:

- `scripts/audit-build-names.mjs` for build-guide verification
- future Q&A/lookup tools
- future calculator pipeline

## Data Model

### 1. Entity Records

Canonical source-of-truth nodes.

Required fields:

- `id`: stable repo ID, e.g. `psyker.talent.psyker_damage_based_on_warp_charge`
- `kind`: `talent`, `ability`, `aura`, `keystone`, `weapon`, `weapon_trait`, `buff`, `damage_profile`, `talent_modifier`, `tree_node`, `name_family`
- `domain`: `psyker`, `veteran`, `shared_weapons`, `shared_buffs`, etc.
- `internal_name`: nullable for abstract canonical nodes without a unique engine symbol
- `loc_key`: nullable for structural entities without a display string
- `ui_name`: nullable if English display text is not source-resolved
- `status`: `source_backed`, `partially_resolved`
- `refs`: exact file/line references
- `source_snapshot_id`
- `attributes`: kind-scoped typed query/display fields
- `calc`: kind-scoped typed calculator fields

Notes:

- `ui_name` is optional in v1. Missing localization is represented honestly instead of guessed.
- Inferred display text does not belong in canonical entities. If a name is not source-backed, it belongs in alias records with explicit provenance, not in `ui_name`.
- Canonical entities never depend on alias data.
- `attributes` is not a free-form dump. Each `kind` gets a schema-defined attribute subset.
- `calc` is not a generic bag. It is validated by kind-specific schemas.
- Display-bearing kinds must carry a real `loc_key` when one exists in source. Structural kinds such as `damage_profile` and `tree_node` may set `loc_key = null`.
- `name_family` is a canonical abstract node used for shared UI concepts such as blessing families. It is backed by source-backed member instances and `instance_of` evidence, not by a unique runtime `internal_name`.

### 2. Alias Records

Human-input resolution layer.

Required fields:

- `text`
- `normalized_text`
- `candidate_entity_id`
- `alias_kind`: `ui_name`, `internal_name`, `loc_key`, `community_name`, `gameslantern_name`, `guide_name`, `stale_name`, `shorthand`
- `match_mode`: `exact_only` or `fuzzy_allowed`
- `provenance`
- `confidence`
- `context_constraints`
- `rank_weight`
- `notes`

Rules:

- Every alias record declares whether it participates in fuzzy matching.
- Synthetic aliases derived from canonical `internal_name`, `loc_key`, or other generator-produced fallback strings are always `exact_only`.
- Only verified `ui_name` aliases and curated human/community aliases may be `fuzzy_allowed`.
- Alias bugs are isolated to alias records and do not contaminate canonical data.
- Multiple alias records may share the same `text`.
- Context-free aliases are allowed, but context-constrained aliases rank above them when the query context matches.
- `context_constraints` is not a free-form bag. It uses the exact dimensions defined in the query-context schema below.
- `normalized_text` is derived by the generator, not trusted as free-form shard input. The build recomputes it and fails on mismatch.

Normalization contract:

1. Unicode casefold
2. replace `_`, `-`, and `/` with spaces
3. strip punctuation other than alphanumerics and spaces
4. collapse repeated whitespace
5. trim leading and trailing whitespace

### 3. Edge Records

Typed relationships between entities.

Required fields:

- `id`
- `type`
- `from_entity_id`
- `to_entity_id`
- `source_snapshot_id`
- `conditions`
- `calc`
- `evidence_ids`

Initial edge types:

- `grants_buff`
- `modifies`
- `uses_damage_profile`
- `belongs_to_tree_node`
- `exclusive_with`
- `parent_of`
- `requires`
- `instance_of`
- `weapon_has_trait_pool`
- `trait_applies_buff`

These edges are required for future calculator work and for non-trivial verification queries.

Condition contract:

- `conditions` is validated against `condition.schema.json`
- `conditions.predicates` is an array of explicit clauses
- each predicate has:
  - `field`
  - `operator`: `eq`, `neq`, `in`, `gte`, `lte`, `contains`
  - `value`
  - `value_type`
- `conditions.aggregation`: `additive`, `multiplicative`, `override`, `max`, `min`, `exclusive`
- `conditions.stacking_mode`: `binary`, `per_stack`, `capped`
- `conditions.exclusive_scope`: nullable string for mutually exclusive effects

This keeps later calculator logic typed and auditable instead of embedding ad-hoc rule text in code.

### 4. Evidence Records

Explicit claims with supporting source refs.

Required fields:

- `id`
- `subject_type`: `entity` or `edge`
- `subject_id`
- `predicate`
- `value`
- `value_type`
- `source_snapshot_id`
- `refs`
- `confidence`
- `source_kind`

Use this when the entity or edge record alone does not capture the audit trail cleanly.

### 5. Query Context

Resolver inputs may carry optional `query_context`, validated against `query-context.schema.json`.

Allowed keys:

- `domain`
- `kind`
- `class`
- `weapon_family`
- `slot`
- `source`

Context semantics:

- `context_constraints.require_all` is a set of exact-match requirements over the allowed keys above. Any mismatch or missing key removes the candidate from consideration.
- `context_constraints.prefer` is a set of soft preferences over the same keys. Matches do not force selection, but they add deterministic ranking boosts.
- No other context keys are allowed in v1. New dimensions require a schema change, not ad-hoc JSON.

These fields are optional for lookup, but they are mandatory for high-quality disambiguation and later calculator/query consumers.

## Repeated Name Handling

Some UI/blessing names represent a concept family rather than one unique internal ID.

Example:

- family: `blessing.precognition`
- specific instance: `weapon_trait_bespoke_forcesword_2h_p1_dodge_grants_critical_strike_chance`

The system models this with `instance_of` edges. This prevents “same UI name, many internal IDs” collisions from collapsing into one unsafe canonical node.

This is not sufficient on its own. Ambiguous human names are handled through multiple alias records plus query context and explicit `ambiguous` outcomes.

Family-resolution rule:

- if a shared-name family entity exists and zero specific instances remain viable after `context_constraints.require_all`, the bare shared name resolves to the family entity
- if a shared-name family entity exists and more than one specific instance remains viable, the resolver still resolves to the family entity unless one specific instance wins uniquely on the full ranking pass
- if exactly one specific instance remains viable and wins uniquely with a `resolved` outcome, the resolver prefers the instance alias record
- if a shared-name family entity exists and no specific instance reaches an authoritative `resolved` outcome, the resolver falls back to the family entity
- if no family entity exists and multiple specific instances remain viable, the result is `ambiguous`

## Resolver Behavior

Canonical `internal_name`, `loc_key`, and verified `ui_name` values are materialized into synthetic high-confidence alias records during index generation. This keeps matching logic confined to the alias index instead of matching directly against canonical entity bags.

Synthetic alias rules:

- synthetic aliases for `internal_name` and `loc_key` are `exact_only`
- synthetic aliases for verified `ui_name` values may be `fuzzy_allowed`
- no synthetic alias may be created from inferred or guessed display text

Input:

- `query`
- optional `query_context`

Resolution order:

1. Exact match on canonical ID
2. Exact match on alias text
3. Normalized exact match
4. Fuzzy match over alias records with `match_mode = fuzzy_allowed` only

Output fields:

- `query`
- `query_context`
- `resolution_state`: `resolved`, `ambiguous`, `unresolved`
- `resolved_entity_id`: nullable, set only for authoritative resolutions
- `proposed_entity_id`: nullable, set when there is a best candidate but it is not authoritative
- `entity`: nullable, mirrors `resolved_entity_id` only
- `proposed_entity`
- `match_type`
- `score`
- `score_margin`
- `confidence`
- `why_this_match`
- `candidate_trace`
- `refs`
- `warnings`

Resolver policy:

- Always rank candidates and retain one best candidate internally.
- Exact canonical-ID matches bypass score thresholds and are always `resolved`.
- Shared-name family fallback is authoritative when a `name_family` entity exists and no specific instance reaches an authoritative `resolved` outcome.
- Only `resolved` outcomes expose a non-null `resolved_entity_id`.
- `ambiguous` outcomes may expose `proposed_entity_id`, but strict consumers must not treat it as authoritative.
- `unresolved` outcomes expose neither resolved nor proposed entity IDs.
- Prefer deterministic ranking rules over heuristics hidden in code.
- Surface warnings for stale/ambiguous/inferred mappings.
- Do not silently upgrade alias inference into canonical truth.
- `candidate_trace` must include the top competing candidates, their scores, and the context-match explanation used to rank them.

Deterministic resolution thresholds:

- `resolved`: best score exceeds the resolution threshold and the score margin exceeds the ambiguity threshold
- `ambiguous`: best score exists but threshold or margin is not sufficient
- `unresolved`: no candidate clears the minimum proposal threshold

## Repository Layout

```text
data/ground-truth/
  schemas/
    entity-base.schema.json
    alias.schema.json
    edge.schema.json
    evidence.schema.json
    query-context.schema.json
    condition.schema.json
    entity-kinds/
      talent.schema.json
      ability.schema.json
      weapon.schema.json
      weapon-trait.schema.json
      buff.schema.json
  entities/
    psyker.json
    veteran.json
    zealot.json
    ogryn.json
    arbites.json
    hive-scum.json
    shared-weapons.json
    shared-buffs.json
  aliases/
    psyker.json
    shared-guides.json
    gameslantern.json
  source-snapshots/
    manifest.json
scripts/
  build-ground-truth-index.mjs
  resolve-ground-truth.mjs
  audit-build-names.mjs
  ground-truth.test.mjs
```

## Generation Pipeline

### `scripts/build-ground-truth-index.mjs`

Responsibilities:

- validate shard schemas
- validate source snapshot metadata
- merge canonical entities and aliases
- build normalized lookup tables
- validate graph edges
- detect duplicate IDs
- detect alias collisions
- emit generated artifacts
- emit synthetic alias records from canonical names
- support `--check` freshness mode

Strictness rules:

- canonical entities must have source refs
- alias records must have provenance and confidence
- unsafe collisions fail the build
- nullable `ui_name` is allowed
- generated artifacts are build outputs, not committed source files
- freshness checks compare shard inputs plus `source_snapshot_id` against generated output metadata

Collision safety policy:

- safe: duplicate alias text is split by non-overlapping `context_constraints.require_all`
- safe: duplicate alias text mixes one or more `exact_only` synthetic aliases with curated aliases, as long as fuzzy ranking cannot select between conflicting synthetic targets
- unsafe: two or more `fuzzy_allowed` alias records with overlapping `context_constraints.require_all` target different canonical entities
- unsafe: any duplicate alias set that would require hidden code heuristics instead of declared context/ranking rules

Unsafe sets fail generation and CI.

Generated artifact policy:

- `data/ground-truth/generated/` is ignored by git
- consumers must build the index before use
- CI and `make check` must run the freshness/build checks so this does not become a manual step

### `scripts/resolve-ground-truth.mjs`

Responsibilities:

- load generated artifacts
- normalize input
- apply query context
- run deterministic match/rank pipeline
- return `resolved`, `ambiguous`, or `unresolved` plus evidence

### `scripts/audit-build-names.mjs`

Responsibilities:

- resolve names from structured build JSONs and pre-extracted token lists in v1
- report unresolved or low-confidence mappings
- flag suspicious canonical/alias mismatches
- emit machine-readable audit output for later tooling

### Repo Gating

The pilot is not complete until the new checks are wired into the repo’s actual validation path:

- `package.json` gets real test/build scripts for the ground-truth toolchain
- `make check` includes the ground-truth freshness checks plus frozen resolver/audit fixture tests
- CI runs that updated check path, including the frozen pilot build-audit fixtures

Without this, the pilot is not considered accepted.

## Source Snapshots And Ref Stability

Line references are only meaningful relative to a pinned source snapshot.

The dataset therefore carries a `source_snapshot_id`, and `data/ground-truth/source-snapshots/manifest.json` records:

- Darktide game version
- `../Darktide-Source-Code` git revision
- snapshot creation time
- optional notes on localization availability

Source provisioning contract:

- tooling must read the decompiled-source root from an explicit input such as `GROUND_TRUTH_SOURCE_ROOT`
- local developer tooling may default that input to `../Darktide-Source-Code` for convenience
- repo validation is not allowed to assume an implicit sibling checkout
- CI must provision the pinned decompiled-source snapshot explicitly, either as a checkout or a cached artifact, before running source-backed freshness checks

Freshness behavior:

- if the current decompiled-source revision differs from the pinned snapshot, `build-ground-truth-index.mjs --check` fails with an explicit stale-state error
- canonical refs are regenerated only against the pinned snapshot
- evidence claims must reference the same snapshot ID as their subject
- if source-backed checks are requested and `GROUND_TRUTH_SOURCE_ROOT` is missing, validation fails with a setup error rather than degrading to warnings or partial success

## Psyker Pilot

The pilot is intentionally narrow and adversarial. It should validate the design against the existing community-build verification failures before any repo-wide rollout.

### In Scope

- Psyker talents, keystones, auras, abilities, tree modifiers
- shared entities in the transitive closure of the pilot fixtures and golden terms only
- alias coverage for known Psyker build JSONs
- audit coverage for the exact pilot fixtures defined below

### Explicitly Out Of Scope

- all-class rollout
- calculator logic
- generalized free-text extraction/tokenization
- shared entities not referenced by the pilot fixtures or golden terms

### Pilot Acceptance Criteria

- known problematic Psyker names resolve to the correct canonical entity or explicit `ambiguous` / `unresolved` outcome
- audit tool can scan pilot build JSONs and produce outputs that match approved fixture snapshots
- schema supports `calc` fields and graph edges without redesign
- build/test pipeline catches missing refs, stale source snapshots, and unsafe alias collisions
- repo validation path runs the ground-truth checks in `package.json`, `make check`, and CI

## Verification Strategy

### Golden Cases

Add resolver tests for known difficult names:

- `Warp Rider`
- `Brain Rupture`
- `Prescience`
- `Kinetic Deflection`
- `Blazing Spirit`
- `Shred`
- `Precognition`

Each case should assert:

- resolution state
- resolved or proposed entity ID as appropriate
- query-context behavior when relevant
- match type
- confidence tier
- warning state

### Build Audits

Pilot fixtures:

- `scripts/builds/08-gandalf-melee-wizard.json`
- `scripts/builds/09-electrodominance-psyker.json`
- `scripts/builds/10-electro-shriek-psyker.json`

Pass condition:

- approved frozen audit snapshots for the three fixtures
- zero unresolved names in structured fixture fields
- expected ambiguous/proposed outcomes only where explicitly approved in the snapshot

### Schema/Integrity Tests

- duplicate entity IDs
- missing refs on canonical entities
- alias records without provenance
- unresolved `instance_of` targets
- unsafe same-name collisions
- stale source snapshot mismatch
- generated artifact freshness

## Future Calculator Support

The registry is not a calculator, but it must support one later through typed, stable fields.

Reserved `calc` fields may include:

- on buffs: `stat_buffs`, `duration`, `proc_events`
- on traits: `max_stacks`, `cooldown`, `proc_condition`
- on abilities: `cooldown`, `charge_behavior`, `resource_cost`
- on tree nodes: `exclusive_group`, `parents`, `children`
- on edges: typed modifier payloads, conditions, and units

This keeps later calculator work additive instead of requiring a schema migration.

## Parallelization Plan

### Psyker Pilot

Do **not** split by class at the pilot stage.

Recommended split:

1. schema + generator + resolver skeleton
2. Psyker canonical entity extraction
3. alias ingestion for Psyker docs/builds/community names
4. main-thread integration and test design

This avoids duplicating cross-cutting logic for shared blessings, weapon-trait instances, and resolver ranking.

### Repo-Wide Rollout

After the pilot proves the model, freeze the base schemas, ranking rules, and shared-family ownership before parallel ingestion starts.

Recommended order:

1. shared families and shared-domain contracts
2. class-specific canonical shards
3. alias shards for already-landed canonical IDs
4. audit fixtures and ranking refinements

Worker ownership:

- one worker per class for class-specific canonical entities
- one worker for shared weapons
- one worker for blessing families and weapon-specific trait instances
- one worker for shared buffs/damage profiles and future calculator edges
- one worker for alias curation for already-landed canonical IDs only

The main thread owns:

- schema changes
- resolver ranking policy
- shared-family ownership rules
- source snapshot bumps and `source-snapshots/manifest.json`
- collision resolution
- merge discipline

Merge contract:

- class workers cannot invent shared-family entities
- alias workers cannot create aliases for entities not yet present in canonical shards
- shared workers land before dependent class/alias shards
- resolver ranking changes require updated golden tests

## Risks

1. **Localization gap**
   - Some English UI names are not directly source-backed in the current clone.
   - Mitigation: keep `ui_name` nullable; store `loc_key` and refs as the verified truth.

2. **Alias overreach**
   - Aggressive fuzzy matching can create confident wrong answers.
   - Mitigation: alias-only fuzzy matching, context-aware ranking, and explicit `ambiguous` / `unresolved` states.

3. **Shared-name collisions**
   - Blessing/UI families can map to many internal IDs.
   - Mitigation: `instance_of` modeling plus generated collision checks.

4. **Premature repo-wide rollout**
   - Scaling a bad schema across all classes multiplies cleanup cost.
   - Mitigation: stop after Psyker pilot if the model exposes structural flaws.

## Recommended Next Step

Implement the Psyker pilot only:

1. define shard schema
2. add Psyker canonical entities
3. add Psyker/shared pilot aliases
4. build generated index
5. add resolver tests
6. freeze fixture snapshots for the three Psyker build audits
7. wire the new checks into `package.json`, `make check`, and CI

Do not start repo-wide ingestion until the Psyker pilot passes its audit cases cleanly.
