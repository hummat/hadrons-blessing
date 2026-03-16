# Buff Semantic Extraction Design

**Issue:** #7
**Date:** 2026-03-16
**Status:** Draft

## Problem

Entity records know *what exists* (identity) but not *what it does* (semantics). The `calc` field on every entity is `{}`. Answering "is this build optimal?" or "what breaks if I swap this weapon?" requires structured effect data extracted from the decompiled Lua buff system.

This is the foundation for synergy modeling (#8), build scoring (#9), and modification recommendations (#10).

## Background: Darktide's 3-layer buff architecture

1. **Talent definition** (`*_talents.lua`): display metadata + `passive.buff_template_name` pointer(s). No magnitudes.
2. **Buff template** (`archetype_buff_templates/*.lua`, `weapon_traits_buff_templates/*.lua`): runtime behavior — `stat_buffs`, `conditional_stat_buffs`, `proc_events`, `max_stacks`, `duration`, `keywords`, `class_name`. Magnitudes usually indirected through `TalentSettings.*`.
3. **Talent settings** (`talent_settings_*.lua`): named numeric constants. Single authoritative magnitude source for talents.

Blessings skip layer 3: magnitudes are inline in the weapon trait definition as 4-element arrays indexed by rarity tier.

## Approach

**Two-phase structured block parser** (Approach 2 from brainstorming). We parse Lua *data literals* (tables, numbers, strings, enums, function blocks as opaque values), not Lua *code*. This handles all observed patterns — `table.clone`, `table.merge`, post-construction patches, bracket-subscript keys, inline functions — without building a full Lua parser.

### Alternatives considered

1. **Extended line-by-line regex** (like `lua-tree-parser.mjs`): Handles ~85% of templates but accumulates special-case hacks for clone chains, computed magnitudes, and nested structures. Maintenance cost grows linearly with Lua pattern diversity.
2. **Full Lua grammar parser** (luaparse port / tree-sitter): Handles any syntax correctly but is overkill for structured data extraction and adds a runtime dependency to a zero-dependency project.

## Architecture

### New modules

```
scripts/ground-truth/lib/
  lua-data-reader.mjs           # Generic Lua data literal reader
  talent-settings-parser.mjs    # TalentSettings lookup table builder
  buff-semantic-parser.mjs      # Darktide-specific effect extractor
```

### Module responsibilities

**`lua-data-reader.mjs`** — Generic, Darktide-agnostic. Reads Lua source text and extracts:
- Named block definitions: `templates.X = { ... }`
- Clone statements: `templates.X = table.clone(templates.Y)`
- Merge statements: `templates.X = table.merge(a, b)`
- Post-construction patches: `templates.X.field = value`
- Table literals into JS objects with:
  - `[enum.member]` bracket keys → `{ $ref: "enum.member" }` symbolic nodes
  - Numbers, strings, booleans → JS primitives
  - `function(...) ... end` → `{ $func: "<source text>" }` opaque nodes
  - Arithmetic expressions → `{ $expr: "a - b", operands: [...] }` deferred nodes

**`talent-settings-parser.mjs`** — Reads `talent_settings_*.lua` files (pure nested data — no functions, no enums, no clones). Returns `Map<string, number>` keyed by dotted path, e.g. `"psyker_2.passive_1.on_hit_proc_chance" → 1`.

Also handles the alias convention used in buff template files: `local talent_settings = TalentSettings.psyker` means `talent_settings.X.Y` resolves to `psyker.X.Y` in the lookup table. The parser maps `talent_settings`, `talent_settings_2`, `talent_settings_3` aliases to their respective namespace roots.

**`buff-semantic-parser.mjs`** — Darktide-specific. Orchestrates the extraction:
1. Loads TalentSettings lookup via `talent-settings-parser.mjs`
2. Reads buff template files via `lua-data-reader.mjs`
3. Resolves `table.clone`/`table.merge` chains to produce materialized template objects
4. Resolves `stat_buffs.X` → stat key `"X"`, `proc_events.Y` → trigger `"Y"`
5. Resolves TalentSettings magnitude references → concrete numbers
6. Evaluates simple arithmetic expressions (`a - b`, `a * b`, `1 - a`) on resolved operands
7. Tags conditions from `conditional_stat_buffs_func` and `check_proc_func` references
8. Produces structured effect records

## Data model: `calc` schema

The `calc` sub-schema to be added to `data/ground-truth/schemas/`:

```json
{
  "calc": {
    "effects": [
      {
        "stat": "toughness",
        "magnitude": 0.15,
        "magnitude_expr": null,
        "condition": null,
        "trigger": null,
        "type": "stat_buff"
      }
    ],
    "tier_scaling": [
      {
        "stat": "melee_power_level_modifier",
        "values": [0.24, 0.28, 0.32, 0.36]
      }
    ],
    "max_stacks": 1,
    "duration": null,
    "active_duration": null,
    "keywords": ["stun_immune"],
    "class_name": "buff",
    "buff_template_name": "veteran_combat_ability_extra_charge"
  }
}
```

### Field definitions

**`effects[]`** — Array of stat modifications this entity grants.
- `stat` (string, required): The stat key from `stat_buffs.*` (e.g. `"toughness"`, `"ranged_damage"`, `"critical_strike_chance"`)
- `magnitude` (number | null): Resolved numeric value. Null when the expression couldn't be resolved statically.
- `magnitude_expr` (string | null): Symbolic expression when magnitude is unresolved (e.g. `"talent_settings_2.combat_ability.ranged_weakspot_damage - talent_settings_2.combat_ability_base.ranged_weakspot_damage"`). Null when magnitude is resolved.
- `condition` (string | null): Semantic tag from the conditional function. Null for unconditional effects.
- `trigger` (string | null): Proc event tag (e.g. `"on_kill"`, `"on_hit"`). Null for non-proc effects.
- `type` (enum): One of `"stat_buff"`, `"conditional_stat_buff"`, `"proc_stat_buff"`

**`tier_scaling[]`** — Blessing-only. Per-tier magnitude arrays.
- `stat` (string, required): The stat key
- `values` (array of 4 numbers): Magnitudes for tiers 1–4

**`max_stacks`** (integer | null): Maximum stack count from buff template.
**`duration`** (number | null): Duration in seconds.
**`active_duration`** (number | null): Active/proc duration in seconds.
**`keywords`** (string[]): Keyword tags from buff template (e.g. `"stun_immune"`, `"deterministic_recoil"`).
**`class_name`** (string | null): Buff class name (e.g. `"buff"`, `"proc_buff"`, `"psyker_passive_buff"`).
**`buff_template_name`** (string | null): The buff template this entity's calc was extracted from.

### Invariants

- `magnitude` and `magnitude_expr` are mutually exclusive: exactly one is non-null per effect, or both are null (magnitude not applicable, e.g. keyword-only buffs).
- `tier_scaling` is only present on weapon trait entities (blessings). Never on talent entities.
- `effects` is always present and non-empty when `calc` is populated.
- An entity with no extractable buff data retains `calc: {}`.

## Pipeline: `npm run effects:build`

### Flow

```
Read talent_settings_*.lua  ──→  TalentSettings lookup table
        │
Read archetype_buff_templates/*.lua  ──→  Parsed + resolved buff templates
Read weapon_traits_buff_templates/*.lua
        │
Read *_talents.lua  ──→  talent internal_name → buff_template_name map
Read weapon_traits_bespoke_*.lua  ──→  trait → tier arrays map
        │
Match buff templates to existing entities by internal_name
        │
Write populated calc fields into entity JSON files (in-place)
Write grants_buff edges into edge JSON files
        │
Report summary: entities populated, unresolved expressions, unknown conditions
```

### Entity matching

For talents: the `passive.buff_template_name` in `*_talents.lua` links a talent's `internal_name` to a buff template name. The pipeline looks up the entity by `{domain}.talent.{internal_name}`, finds the corresponding buff template, and populates `calc`.

For blessings/weapon traits: the entity `internal_name` matches the weapon trait template name directly. Tier arrays from `weapon_traits_bespoke_*.lua` are merged with buff template data from `weapon_traits_buff_templates/*.lua`.

For stat nodes: the `attributes.family` field on stat node entities maps to buff template families in `player_buff_templates.lua`.

### Edge generation

`grants_buff` edges link talent entities to the buff template entities they reference via `passive.buff_template_name`. Both the `grants_buff` edge type and `buff` entity kind already exist in the schema — zero records are populated today.

### Integration

- New `package.json` script: `"effects:build"` pointing to `scripts/extract-buff-effects.mjs`
- Added to `make check` after `edges:build` and before `npm run check`
- Generated `calc` fields are written to the checked-in entity JSON files (not to `data/ground-truth/generated/`)
- `npm run index:build` validates calc fields against the new calc sub-schema

## Condition tagging

A lookup table maps known Lua function references to semantic condition tags:

### ConditionalFunctions (for `conditional_stat_buffs_func`)

| Lua reference | Tag |
|---|---|
| `ConditionalFunctions.is_item_slot_wielded` | `"wielded"` |
| `ConditionalFunctions.is_item_slot_not_wielded` | `"not_wielded"` |
| `ConditionalFunctions.is_sprinting` | `"sprinting"` |
| `ConditionalFunctions.is_blocking` | `"blocking"` |
| `ConditionalFunctions.is_lunging` | `"lunging"` |
| `ConditionalFunctions.is_reloading` | `"reloading"` |
| `ConditionalFunctions.is_alternative_fire` | `"alt_fire"` |
| `ConditionalFunctions.has_full_toughness` | `"full_toughness"` |
| `ConditionalFunctions.has_stamina` | `"has_stamina"` |
| `ConditionalFunctions.has_empty_clip` | `"empty_clip"` |
| `ConditionalFunctions.has_high_warp_charge` | `"high_warp_charge"` |
| `ConditionalFunctions.has_high_overheat` | `"high_overheat"` |
| `ConditionalFunctions.at_max_stacks` | `"max_stacks"` |
| `ConditionalFunctions.melee_weapon_special_active` | `"weapon_special"` |
| `ConditionalFunctions.is_weapon_using_magazine` | `"magazine_weapon"` |
| `ConditionalFunctions.all(A, B)` | `"all:tagA+tagB"` |
| `ConditionalFunctions.any(A, B)` | `"any:tagA+tagB"` |
| Inline function (unrecognized) | `"unknown_condition"` |

### CheckProcFunctions (for `check_proc_func`)

| Lua reference | Tag |
|---|---|
| `CheckProcFunctions.on_kill` | `"on_kill"` |
| `CheckProcFunctions.on_melee_kill` | `"on_melee_kill"` |
| `CheckProcFunctions.on_ranged_kill` | `"on_ranged_kill"` |
| `CheckProcFunctions.on_weakspot_kill` | `"on_weakspot_kill"` |
| `CheckProcFunctions.on_elite_or_special_kill` | `"on_elite_or_special_kill"` |
| `CheckProcFunctions.on_crit` | `"on_crit"` |
| `CheckProcFunctions.on_melee_hit` | `"on_melee_hit"` |
| `CheckProcFunctions.on_ranged_hit` | `"on_ranged_hit"` |
| `CheckProcFunctions.on_item_match` | `"on_item_match"` |
| `CheckProcFunctions.on_melee_weapon_special_hit` | `"on_weapon_special_hit"` |
| `CheckProcFunctions.always` | `"always"` |
| `CheckProcFunctions.all(A, B)` | `"all:tagA+tagB"` |
| `CheckProcFunctions.any(A, B)` | `"any:tagA+tagB"` |
| (other named functions) | Mapped by stripping prefix: `CheckProcFunctions.on_X` → `"on_X"` |

### Inline function heuristics

For inline `conditional_stat_buffs_func` bodies, scan for known patterns:
- `template_data.active` → `"active"` (buff is currently active)
- `wielded_slot` checks → `"slot_primary"` / `"slot_secondary"`
- `has_weapon_keyword_from_slot(..., "keyword")` → `"weapon_keyword:keyword"`
- Threshold checks on ammo/health/peril → `"threshold:stat:value"`

Target: <10% `unknown_condition` rate across all conditional buffs.

## Testing strategy

### Golden-file tests

Representative samples covering each pattern:
1. Flat `stat_buffs` — simple numeric literal magnitudes
2. `conditional_stat_buffs` — TalentSettings magnitude resolution + condition tag
3. `proc_events` + `proc_stat_buffs` — trigger tag + active duration
4. `table.clone` chain — inherited fields from cloned template
5. `table.merge` — override merging
6. Post-construction patch — `templates.X.field = value` after clone
7. Blessing tier arrays — 4-tier `tier_scaling` extraction
8. Compound conditions — `CheckProcFunctions.all(A, B)` → `"all:tagA+tagB"`
9. Inline function heuristic — `conditional_stat_buffs_func` body pattern matching
10. Unresolvable magnitude — `magnitude: null`, `magnitude_expr: "..."` fallback

### Integration tests

- Full pipeline run on real source files → verify entity JSON files are updated with non-empty `calc`
- `make check` passes with populated calc fields
- `unknown_condition` rate metric is below 10%

### Unit tests

- `lua-data-reader.mjs`: table parsing, nested structures, bracket keys, function skipping, arithmetic expressions
- `talent-settings-parser.mjs`: nested key resolution, alias mapping
- `buff-semantic-parser.mjs`: clone resolution, merge resolution, condition tagging

## Acceptance criteria

1. Every talent/blessing entity with a `buff_template_name` has a non-empty `calc.effects[]`
2. Blessing entities have `calc.tier_scaling` with 4-tier magnitudes
3. `unknown_condition` rate is tracked and reported — target <10% of conditional buffs
4. `make check` passes with populated `calc` fields
5. No runtime dependencies added
6. Concrete magnitude resolution via TalentSettings two-pass lookup, with simple expression evaluation (`a - b`, `a * b`, `1 - a`)

## Out of scope

- Full Lua evaluation or runtime simulation
- Damage formula computation (that's #5)
- Synergy/interaction analysis (that's #8)
- Scoring (that's #9)
- `format_values` extraction (display-only, not semantic)

## Deliverables

1. `scripts/ground-truth/lib/lua-data-reader.mjs` — generic Lua data literal reader
2. `scripts/ground-truth/lib/talent-settings-parser.mjs` — TalentSettings lookup builder
3. `scripts/ground-truth/lib/buff-semantic-parser.mjs` — Darktide-specific effect extractor
4. `scripts/extract-buff-effects.mjs` — CLI entry point for `npm run effects:build`
5. `data/ground-truth/schemas/calc.schema.json` — calc sub-schema
6. `grants_buff` edge records linking talents → buffs
7. Tests: golden-file, integration, and unit tests
8. Integration into `make check`
