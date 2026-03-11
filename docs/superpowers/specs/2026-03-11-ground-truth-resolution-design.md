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
- Resolve human input to one best candidate using deterministic ranking.
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
3. The resolver returns one best candidate, but the system keeps enough evidence and scoring data to audit wrong picks.
4. False negatives are better than silently corrupting canonical data.
5. Shared naming problems are modeled once, not re-solved per class.

## Architecture

The design uses three functional layers over one shared dataset:

1. **Canonical entity registry**
   - Source-backed entities only.
   - Contains internal IDs, loc keys, exact source refs, typed attributes, and graph edges.
2. **Alias registry**
   - Human-facing, community, GamesLantern, guide, shorthand, and stale names.
   - Each alias points to one canonical entity and carries provenance plus confidence.
3. **Resolver**
   - Normalizes input, attempts exact/normalized/fuzzy matching, and returns one best candidate with evidence.

Consumers:

- `scripts/audit-build-names.mjs` for build-guide verification
- future Q&A/lookup tools
- future calculator pipeline

## Data Model

### 1. Entity Records

Canonical source-of-truth nodes.

Required fields:

- `id`: stable repo ID, e.g. `psyker.talent.psyker_damage_based_on_warp_charge`
- `kind`: `talent`, `ability`, `aura`, `keystone`, `weapon`, `weapon_trait`, `buff`, `damage_profile`, `talent_modifier`, `tree_node`
- `domain`: `psyker`, `veteran`, `shared_weapons`, `shared_buffs`, etc.
- `internal_name`
- `loc_key`
- `ui_name`: nullable if English display text is not source-resolved
- `status`: `source_backed`, `partially_resolved`, `inferred_ui_name`
- `refs`: exact file/line references
- `attributes`: typed facts relevant to the entity
- `calc`: reserved object for later calculator-oriented fields

Notes:

- `ui_name` is optional in v1. Missing localization is represented honestly instead of guessed.
- Canonical entities never depend on alias data.

### 2. Alias Records

Human-input resolution layer.

Required fields:

- `text`
- `normalized_text`
- `target_entity_id`
- `alias_kind`: `ui_name`, `community_name`, `gameslantern_name`, `guide_name`, `stale_name`, `shorthand`
- `provenance`
- `confidence`
- `notes`

Rules:

- Aliases may be fuzzy or inferred.
- Alias bugs are isolated to alias records and do not contaminate canonical data.

### 3. Edge Records

Typed relationships between entities.

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

### 4. Evidence Records

Explicit claims with supporting source refs.

Required fields:

- `subject_id`
- `claim`
- `claim_type`
- `refs`
- `confidence`
- `source_kind`

Use this when the entity record alone does not capture the audit trail cleanly.

## Repeated Name Handling

Some UI/blessing names represent a concept family rather than one unique internal ID.

Example:

- family: `blessing.precognition`
- specific instance: `weapon_trait_bespoke_forcesword_2h_p1_dodge_grants_critical_strike_chance`

The system models this with `instance_of` edges. This prevents “same UI name, many internal IDs” collisions from collapsing into one unsafe canonical node.

## Resolver Behavior

Input resolution order:

1. Exact match on canonical ID
2. Exact match on canonical `ui_name`
3. Exact match on alias text
4. Normalized exact match
5. Fuzzy match over canonical names plus aliases

Output fields:

- `query`
- `resolved_entity_id`
- `entity`
- `match_type`
- `score`
- `confidence`
- `why_this_match`
- `refs`
- `warnings`

Resolver policy:

- Return one best candidate only.
- Prefer deterministic ranking rules over heuristics hidden in code.
- Surface warnings for stale/ambiguous/inferred mappings.
- Do not silently upgrade alias inference into canonical truth.

## Repository Layout

```text
data/ground-truth/
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
  generated/
    index.json
    entities-by-id.json
    aliases-by-normalized-text.json
    graph.json
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
- merge canonical entities and aliases
- build normalized lookup tables
- validate graph edges
- detect duplicate IDs
- detect alias collisions
- emit generated artifacts

Strictness rules:

- canonical entities must have source refs
- alias records must have provenance and confidence
- unsafe collisions fail the build
- nullable `ui_name` is allowed

### `scripts/resolve-ground-truth.mjs`

Responsibilities:

- load generated artifacts
- normalize input
- run deterministic match/rank pipeline
- return one best candidate with evidence

### `scripts/audit-build-names.mjs`

Responsibilities:

- resolve names from build JSONs or free-text guide content
- report unresolved or low-confidence mappings
- flag suspicious canonical/alias mismatches
- emit machine-readable audit output for later tooling

## Psyker Pilot

The pilot is intentionally narrow and adversarial. It should validate the design against the existing community-build verification failures before any repo-wide rollout.

### In Scope

- Psyker talents, keystones, auras, abilities, tree modifiers
- Psyker-relevant shared weapons and blessings needed to audit current Psyker builds
- alias coverage for known Psyker build JSONs
- audit coverage for the “Gandalf: Melee Wizard” analysis and similar Psyker builds

### Explicitly Out Of Scope

- all-class rollout
- calculator logic
- generalized ingestion for every build source

### Pilot Acceptance Criteria

- known problematic Psyker names resolve to the correct canonical entity or are flagged as inferred/unsafe
- audit tool can scan a Psyker build JSON or text analysis and report unresolved/suspicious names
- schema supports `calc` fields and graph edges without redesign
- build/test pipeline catches missing refs and unsafe alias collisions

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

- chosen entity ID
- match type
- confidence tier
- warning state

### Build Audits

Run audit tests against:

- `scripts/builds/08-gandalf-melee-wizard.json`
- `scripts/builds/09-electrodominance-psyker.json`
- `scripts/builds/10-electro-shriek-psyker.json`

### Schema/Integrity Tests

- duplicate entity IDs
- missing refs on canonical entities
- alias records without provenance
- unresolved `instance_of` targets
- unsafe same-name collisions

## Future Calculator Support

The registry is not a calculator, but it must support one later.

Reserved `calc` fields may include:

- on buffs: `stat_buffs`, `duration`, `proc_events`
- on traits: `max_stacks`, `cooldown`, `proc_condition`
- on abilities: `cooldown`, `charge_behavior`, `resource_cost`
- on tree nodes: `exclusive_group`, `parents`, `children`
- on edges: typed modifier payloads

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

After the pilot proves the model:

- one worker per class for class-specific canonical entities
- one worker for shared weapons
- one worker for blessing families and weapon-specific trait instances
- one worker for shared buffs/damage profiles and future calculator edges
- one worker for alias curation and guide/GamesLantern ingestion

The main thread owns:

- schema changes
- resolver ranking policy
- collision resolution
- merge discipline

## Risks

1. **Localization gap**
   - Some English UI names are not directly source-backed in the current clone.
   - Mitigation: keep `ui_name` nullable; store `loc_key` and refs as the verified truth.

2. **Alias overreach**
   - Aggressive fuzzy matching can create confident wrong answers.
   - Mitigation: conservative ranking, warnings, and golden tests for known bad cases.

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
6. audit the Psyker build JSONs

Do not start repo-wide ingestion until the Psyker pilot passes its audit cases cleanly.
