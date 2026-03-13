# Canonical Build Shape Design

> Created 2026-03-13. Defines the normalized machine-readable build JSON shape that `extract`, `audit`, `score`, and future website flows should share.

## 1. Decision

`hadrons-blessing` will use one shared canonical build JSON shape.

This shape is:

- decision-data only
- machine-oriented
- resolver-aware
- independent of Games Lantern page layout
- suitable for `audit`, `score`, CLI workflows, BetterBots-side engineering work, and future website flows

It is not:

- a raw scrape dump
- a prose/guide archive
- a copy of the full talent tree
- a transport for resolver ambiguity internals

Backward compatibility with the current build JSON shape is not required.

## 2. Problem

The current extracted build JSON shape is too weak for the next stage of the project.

Current problems:

- class-side decisions are not preserved in a normalized machine-consumable form
- `talents.active` / `talents.inactive` reflects scrape structure instead of build semantics
- build files do not consistently carry baked resolution results
- weapon/curio/build decisions are mixed with scrape-oriented assumptions
- future consumers would need ad-hoc per-command adapters

The result is that real scraped builds can be audited for item names, but not yet used as a strong canonical input for deeper build reasoning.

## 3. Goals

- define one canonical build JSON shape for the repo
- store build decisions, not scrape noise
- keep raw labels and canonical IDs together for traceability
- make unresolved and non-canonical outcomes explicit without re-running the resolver
- preserve only minimal provenance in the canonical build file
- make validation cheap and obvious
- support batch re-resolution when coverage expands

## 4. Non-Goals

- storing author prose or guide commentary in canonical build files
- storing raw HTML, markdown, selector metadata, or parser internals in canonical build files
- copying the full talent tree or unselected options into every build
- representing resolver ambiguity as a persistent build state
- preserving the current build JSON shape for compatibility

## 5. Approaches Considered

### Approach A: Keep the current scrape-oriented build shape and adapt each consumer

Pros:

- smallest immediate migration
- low short-term friction

Cons:

- every consumer would need custom extraction logic
- the canonical meaning of the file would remain unclear
- class-side build decisions would stay under-modeled

Verdict:

- rejected

### Approach B: One normalized canonical build shape

Pros:

- one contract for CLI, website, and downstream engineering
- clear separation between decision data and scrape sidecars
- validation and re-resolution become straightforward

Cons:

- requires one-time fixture migration
- extractor and audit pipeline both need updates

Verdict:

- recommended

### Approach C: Keep raw scrape output and add a second normalized artifact beside it

Pros:

- easier incremental rollout

Cons:

- introduces dual truth immediately
- guarantees drift between the scrape file and the canonical file
- forces every consumer to choose between competing formats

Verdict:

- rejected

## 6. Design Principles

1. Canonical build files represent committed build decisions, not extraction internals.
2. Every selected build element keeps both human traceability and canonical identity.
3. Resolver outcomes are persisted in the build file so downstream tools do not need to re-resolve by default.
4. Unselected options belong to the tree/entity database, not to build instances.
5. Prose and scrape internals live in sidecars, not in canonical build files.
6. Fixed structural class decisions should remain fixed structural fields.

## 7. Canonical Top-Level Shape

Canonical build JSON:

```json
{
  "schema_version": 1,
  "title": "Gandalf: Melee Wizard",
  "class": {
    "raw_label": "psyker",
    "canonical_entity_id": "shared.class.psyker",
    "resolution_status": "resolved"
  },
  "provenance": {
    "source_kind": "gameslantern",
    "source_url": "https://darktide.gameslantern.com/builds/...",
    "author": "nomalarkey",
    "scraped_at": "2026-03-13T12:34:56Z"
  },
  "ability": {
    "raw_label": "Venting Shriek",
    "canonical_entity_id": "psyker.ability.psyker_shout_vent_warp_charge",
    "resolution_status": "resolved"
  },
  "blitz": {
    "raw_label": "Brain Rupture",
    "canonical_entity_id": null,
    "resolution_status": "unresolved"
  },
  "aura": {
    "raw_label": "Psykinetic's Aura",
    "canonical_entity_id": null,
    "resolution_status": "unresolved"
  },
  "keystone": {
    "raw_label": "Warp Siphon",
    "canonical_entity_id": "psyker.keystone.psyker_warp_siphon",
    "resolution_status": "resolved"
  },
  "talents": [
    {
      "raw_label": "Warp Rider",
      "canonical_entity_id": "psyker.talent.psyker_damage_based_on_warp_charge",
      "resolution_status": "resolved"
    }
  ],
  "weapons": [
    {
      "slot": "melee",
      "name": {
        "raw_label": "Covenant Mk VI Blaze Force Greatsword",
        "canonical_entity_id": "shared.weapon.forcesword_2h_p1_m1",
        "resolution_status": "resolved"
      },
      "perks": [
        {
          "raw_label": "20-25% Damage (Carapace)",
          "canonical_entity_id": "shared.weapon_perk.melee.weapon_trait_melee_common_wield_increased_carapace_damage",
          "resolution_status": "resolved"
        }
      ],
      "blessings": [
        {
          "raw_label": "Blazing Spirit",
          "canonical_entity_id": "shared.name_family.blessing.blazing_spirit",
          "resolution_status": "resolved"
        }
      ]
    },
    {
      "slot": "ranged",
      "name": {
        "raw_label": "Equinox Mk III Voidblast Force Staff",
        "canonical_entity_id": "shared.weapon.forcestaff_p3_m1",
        "resolution_status": "resolved"
      },
      "perks": [],
      "blessings": []
    }
  ],
  "curios": [
    {
      "name": {
        "raw_label": "Blessed Bullet",
        "canonical_entity_id": null,
        "resolution_status": "non_canonical"
      },
      "perks": [
        {
          "raw_label": "+3-4% Combat Ability Regen",
          "canonical_entity_id": "shared.gadget_trait.gadget_cooldown_reduction",
          "resolution_status": "resolved"
        }
      ]
    }
  ]
}
```

## 8. Selection Object Contract

All selected build decisions use the same base selection object:

```json
{
  "raw_label": "Warp Rider",
  "canonical_entity_id": "psyker.talent.psyker_damage_based_on_warp_charge",
  "resolution_status": "resolved"
}
```

Quantified entries such as weapon perks and curio perks may carry an optional
value block:

```json
{
  "raw_label": "20-25% Damage (Carapace)",
  "canonical_entity_id": "shared.weapon_perk.melee.weapon_trait_melee_common_wield_increased_carapace_damage",
  "resolution_status": "resolved",
  "value": {
    "min": 0.2,
    "max": 0.25,
    "unit": "percent"
  }
}
```

### 8.1 Required fields

- `raw_label`
- `canonical_entity_id`
- `resolution_status`

### 8.2 Resolution status enum

Allowed values:

- `resolved`
- `unresolved`
- `non_canonical`

### 8.3 Invariants

- `resolved` requires `canonical_entity_id` to be a non-null string
- `unresolved` requires `canonical_entity_id = null`
- `non_canonical` requires `canonical_entity_id = null`

Illegal examples:

- `{"resolution_status":"resolved","canonical_entity_id":null}`
- `{"resolution_status":"unresolved","canonical_entity_id":"shared.weapon.plasmagun_p1_m1"}`

### 8.4 Meaning

- `resolved`: authoritative canonical ID is known and should be used by downstream consumers
- `unresolved`: resolution was attempted but no authoritative mapping was committed
- `non_canonical`: the label is intentionally retained as a known display-only or known-unresolved label and should not be mapped to a canonical entity

### 8.5 Explicitly excluded states

`ambiguous` is not persisted in canonical build files.

Reason:

- a canonical build file should not commit a speculative candidate
- ambiguity is a transient resolver outcome, not a stable build decision
- if ingestion cannot commit to one entity, the build should persist `unresolved`

### 8.6 Optional quantified value payload

Some selected build entries are not just identifiers. They also carry numeric
roll values extracted from the source build.

Initial use:

- weapon perks
- curio perks

Optional field:

- `value`

Value block shape:

- `min`
- `max`
- `unit`

Rules:

- `value` is optional on the base selection object
- when present, it must be parseable without re-reading the original scrape text
- `score` should prefer this parsed value block over reparsing `raw_label`

## 9. Top-Level Field Semantics

### 9.1 `schema_version`

- required integer
- starts at `1`
- increments only when the canonical build contract changes incompatibly

### 9.2 `title`

- required string
- human-readable build title
- may originate from Games Lantern or future sources

### 9.3 `class`

- required selection object
- canonical target should be a `shared.class.*` entity when resolved

### 9.4 `provenance`

Minimal source-attribution block only.

Required fields:

- `source_kind`
- `source_url`
- `author`
- `scraped_at`

Notes:

- this is enough to answer where the build came from and when it was ingested
- extractor internals such as selectors, parser version, or raw scrape metadata do not belong here

### 9.5 `ability`

- required non-null selection object
- represents the chosen class combat ability

### 9.6 `blitz`

- required non-null selection object
- represents the chosen blitz / grenade / equivalent offensive slot

### 9.7 `aura`

- required non-null selection object
- represents the chosen aura / team passive slot

### 9.8 `keystone`

- nullable selection object
- may legitimately be `null` if the build does not take a keystone

### 9.9 `talents`

- required array of selection objects
- selected talents only
- no inactive or unselected talent nodes
- no tree topology duplicated here

### 9.10 Class-side slot mapping rule

The canonical build shape stores fixed class decisions in fixed slots, but the
current scrape source does not provide them in that shape directly.

Canonicalization therefore requires a source-specific classification step.

For Games Lantern input:

- exactly one selected node classified as the primary combat ability becomes `ability`
- exactly one selected node classified as the primary blitz becomes `blitz`
- exactly one selected node classified as the primary aura becomes `aura`
- zero or one selected node classified as the primary keystone becomes `keystone`
- every other selected node becomes an entry in `talents[]`

Important:

- frame shape alone is not sufficient
- the current extractor’s generic `ability` bucket is not the canonical mapping rule
- the implementation needs a maintained classification registry or equivalent source-backed mapping for class-side node roles
- ability modifiers and similar selected supporting nodes are stored in `talents[]`, not mixed into the top-level `ability` slot

## 10. Weapons And Curios

### 10.1 Weapon shape

Each weapon entry:

```json
{
  "slot": "melee",
  "name": { "...selection..." },
  "perks": [{ "...selection..." }],
  "blessings": [{ "...selection..." }]
}
```

Required fields:

- `slot`
- `name`
- `perks`
- `blessings`

Notes:

- `slot` is a required enum: `melee` or `ranged`
- `name` uses the same selection object contract
- perks and blessings use the same selection object contract
- downstream tools should key on canonical IDs when available, not raw labels
- perk entries should carry the optional quantified `value` block when parseable

### 10.2 Weapon count

Current canonical expectation:

- exactly two weapon entries
- one `melee` entry and one `ranged` entry

Reason:

- blessing and perk resolution depend on slot context
- an unresolved weapon name still needs stable melee/ranged identity
- relying on array order alone is brittle and unnecessary

### 10.3 Curio shape

Each curio entry:

```json
{
  "name": { "...selection..." },
  "perks": [{ "...selection..." }]
}
```

Required fields:

- `name`
- `perks`

Notes:

- curio `name` may intentionally be `non_canonical` for labels such as `Blessed Bullet`
- curio perks use the same selection object contract as all other decisions
- curio perk entries should carry the optional quantified `value` block when parseable

### 10.4 Blessing identity level

Canonical build files commit blessing identity at the family/UI level, not at
the concrete weapon-trait instance level.

That means a build blessing should resolve to entities such as:

- `shared.name_family.blessing.blazing_spirit`

not directly to:

- `shared.weapon_trait.weapon_trait_bespoke_...`

Reason:

- source build labels identify blessing families, not weapon-specific trait instance ids
- current build audit already treats blessing resolution at the family level
- downstream validation can still join blessing families to weapon-specific trait pools when needed

Concrete trait instance identity belongs in the entity graph and evidence layer,
not in the canonical build file.

## 11. What Is Explicitly Not Stored

Canonical build files must not store:

- guide prose or commentary
- raw HTML
- markdown exports
- extractor selector metadata
- full talent tree contents
- inactive talent choices
- “available but not selected” build options
- speculative resolver candidates

Those belong in sidecars, the entity graph, or extractor internals.

## 12. Sidecar Model

The extractor may emit separate sidecars, but they are not part of the canonical build contract.

Examples:

- raw scrape artifact
- author prose / guide commentary
- markdown summary
- extractor debug output

The canonical build file should be joinable with these by source URL or filename convention, but it must remain useful on its own.

## 13. Consumer Rules

### 13.1 Audit

`audit` should consume canonical build JSON directly.

That means:

- it should not need to rediscover build structure from scrape artifacts
- it should validate stored `resolution_status` / `canonical_entity_id` invariants
- it should verify that resolved canonical IDs still exist
- it may re-resolve `raw_label` in context to detect drift or newly covered entries
- its default job becomes validation and reporting over explicit stored decisions rather than first-pass structural extraction

Default drift behavior:

- if a stored `resolved` entry re-resolves to the same canonical ID, audit reports it as valid
- if a stored `resolved` entry re-resolves differently or the ID no longer exists, audit reports a drift or stale-id finding
- if a stored `unresolved` entry now resolves cleanly, audit reports it as newly resolvable
- if a stored `non_canonical` entry remains intentionally non-canonical, audit reports it as valid

### 13.2 Score

`score` should consume canonical build JSON directly.

That means:

- it can use canonical weapon/perk/blessing IDs when present
- it can fall back to raw labels only where provisional scoring still requires it

### 13.3 BetterBots engineering workflows

Downstream agents should:

- use `canonical_entity_id` when non-null
- treat `raw_label` as debugging and traceability data
- branch on `resolution_status` when `canonical_entity_id` is null

### 13.4 Website flows

The website can render from the canonical build file and optionally join prose sidecars later.

## 14. Extraction And Ingestion Implications

The extraction pipeline now has two distinct responsibilities:

1. scrape raw source data from Games Lantern or another source
2. transform that scrape into canonical build JSON

The canonical build shape is not extractor-native page structure.

It is an ingestion output.

### 14.1 Extraction stage

Responsible for:

- retrieving the source page
- collecting raw labels
- collecting minimal provenance
- optionally writing raw/prose sidecars

### 14.2 Canonicalization stage

Responsible for:

- mapping raw labels into structured fixed slots
- classifying selected class-side nodes into `ability`, `blitz`, `aura`, `keystone`, and `talents[]`
- resolving every selected decision into `resolved` / `unresolved` / `non_canonical`
- parsing quantified perk values into structured `value` blocks
- writing canonical build JSON

## 15. Migration From Current Build Files

Current `scripts/builds/*.json` files need one-time migration.

Migration work:

1. replace raw `class` string with a selection object
2. replace raw weapon names with `name` selection objects
3. replace raw perk/blessing strings with selection objects
4. replace raw curio name/perk strings with selection objects
5. replace `talents.active` / `talents.inactive` with:
   - `ability`
   - `blitz`
   - `aura`
   - `keystone`
   - `talents[]`
6. add `schema_version`
7. add `provenance`
8. remove prose or scrape-only fields from the canonical file

Backward compatibility is intentionally not required.

## 16. Re-Resolution Workflow

Because canonical build files persist resolver outcomes, the repo needs an explicit re-resolution path.

That path should:

1. walk canonical build files
2. revisit entries with `canonical_entity_id = null`
3. re-run resolver logic against current entity coverage
4. update `canonical_entity_id` and `resolution_status` when the result improves
5. leave already resolved entries alone unless explicitly forced

This is required for sane iteration as entity coverage expands.

## 17. Validation Rules

The schema should enforce at least:

- top-level required fields exist
- `ability`, `blitz`, `aura` are non-null
- `keystone` is either null or a valid selection object
- `talents` is an array of valid selection objects
- every selection object obeys the `resolution_status` / `canonical_entity_id` invariant
- `weapons` has exactly two entries
- weapon slots are exactly one `melee` and one `ranged`
- every weapon and curio sub-item uses the same selection object contract

## 18. Acceptance Criteria

This design is successful when:

1. one canonical build file shape exists for extractor output, audit input, score input, and future website consumption
2. a build file can be understood mechanically without scrape sidecars
3. unresolved and non-canonical decisions are explicit without rerunning the resolver
4. downstream tooling never has to infer fixed class slots from a generic array
5. author prose can evolve independently without touching machine-readable build files

## 19. Recommended Next Step

Write an implementation plan that:

1. introduces schemas for canonical build and selection objects
2. rewrites `extract-build.mjs` into scrape + canonicalization stages
3. migrates `scripts/builds/*.json`
4. updates `audit` to consume the canonical shape
5. adds a re-resolution command for canonical builds
