# Buff Semantic Extraction Design

**Issue:** #7
**Date:** 2026-03-16
**Status:** Draft

## Problem

Entity records know *what exists* (identity) but not *what it does* (semantics). The `calc` field on every entity is `{}`. Answering "is this build optimal?" or "what breaks if I swap this weapon?" requires structured effect data extracted from the decompiled Lua buff system.

This is the foundation for synergy modeling (#8), build scoring (#9), and modification recommendations (#10).

## Background: Darktide's 3-layer buff architecture

1. **Talent definition** (`*_talents.lua`): display metadata + `passive.buff_template_name` pointer(s). No magnitudes.
2. **Buff template** (`scripts/settings/buff/archetype_buff_templates/*.lua`, `scripts/settings/buff/weapon_traits_buff_templates/*.lua`, `scripts/settings/buff/gadget_buff_templates.lua`, `scripts/settings/buff/player_buff_templates.lua`): runtime behavior — `stat_buffs`, `conditional_stat_buffs`, `lerped_stat_buffs`, `conditional_lerped_stat_buffs`, `proc_events`, `proc_stat_buffs`, `max_stacks`, `duration`, `keywords`, `class_name`. Magnitudes usually indirected through `TalentSettings.*`.
3. **Talent settings** (`scripts/settings/talent/talent_settings_*.lua`): named numeric constants. Single authoritative magnitude source for talents.

Blessings skip layer 3: magnitudes are inline in the weapon trait definition (`scripts/settings/equipment/weapon_traits/weapon_traits_bespoke_*.lua`) as 4-element tier arrays — each tier is a table object that can contain `stat_buffs`, `conditional_stat_buffs`, `active_duration`, and other fields. Tier objects patch the base buff template; absent fields inherit from the base.

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
- Merge statements: `templates.X = table.merge(dest, source)` — second arg (source) overwrites first arg (dest) on key collision, per the engine's `table.merge` implementation at `scripts/foundation/utilities/table.lua:143-148`. In practice, `table.merge({inline_overrides}, BaseTemplate)` means the BaseTemplate wins on collision.
- Post-construction patches: `templates.X.field = value`
- `table.make_unique(templates)` calls are ignored — this is a runtime debug assertion that ensures no shared table references, irrelevant for static extraction
- Table literals into JS objects with:
  - `[enum.member]` bracket keys → `{ $ref: "enum.member" }` symbolic nodes
  - Numbers, strings, booleans → JS primitives
  - `function(...) ... end` → `{ $func: "<source text>" }` opaque nodes
  - Arithmetic expressions → `{ $expr: "a - b", operands: [...] }` deferred nodes

**`talent-settings-parser.mjs`** — Reads `talent_settings_*.lua` files (pure nested data — no functions, no enums, no clones). Returns `Map<string, number>` keyed by dotted path, e.g. `"psyker_2.passive_1.on_hit_proc_chance" → 1`.

Also handles the alias convention used in buff template files. Each file declares local aliases like `local talent_settings = TalentSettings.psyker`, `local talent_settings_2 = TalentSettings.psyker_2`, etc. The alias variable names vary across classes (e.g. `stimm_talent_settings` for broker, `talent_settings_shared` for ogryn). The parser dynamically scans for all `local <var> = TalentSettings.<namespace>` bindings in each file and builds the alias map accordingly — no hardcoded variable names.

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
      },
      {
        "stat": "damage",
        "magnitude": null,
        "magnitude_expr": null,
        "magnitude_min": 0.05,
        "magnitude_max": 0.25,
        "condition": null,
        "trigger": null,
        "type": "lerped_stat_buff"
      }
    ],
    "tiers": [
      {
        "effects": [
          { "stat": "power_level_modifier", "magnitude": 0.05, "type": "stat_buff" }
        ],
        "child_duration": 3.5
      },
      {
        "effects": [
          { "stat": "power_level_modifier", "magnitude": 0.055, "type": "stat_buff" }
        ],
        "child_duration": 3.5
      },
      {
        "effects": [
          { "stat": "power_level_modifier", "magnitude": 0.06, "type": "stat_buff" }
        ],
        "child_duration": 3.5
      },
      {
        "effects": [
          { "stat": "power_level_modifier", "magnitude": 0.065, "type": "stat_buff" }
        ],
        "child_duration": 3.5
      }
    ],
    "max_stacks": 1,
    "duration": null,
    "active_duration": null,
    "keywords": ["stun_immune"],
    "class_name": "buff",
    "buff_template_names": ["veteran_combat_ability_extra_charge"]
  }
}
```

### Field definitions

**`effects[]`** — Array of stat modifications this entity grants (from the base buff template, or merged from all referenced buff templates for multi-buff talents).
- `stat` (string, required): The stat key from `stat_buffs.*` (e.g. `"toughness"`, `"ranged_damage"`, `"critical_strike_chance"`)
- `magnitude` (number | null): Resolved numeric value. Null when the expression couldn't be resolved statically or when using min/max range.
- `magnitude_expr` (string | null): Symbolic expression when magnitude is unresolved (e.g. `"talent_settings_2.combat_ability.ranged_weakspot_damage - talent_settings_2.combat_ability_base.ranged_weakspot_damage"`). Null when magnitude is resolved.
- `magnitude_min` (number | null): Lower bound for lerped stats. Null for non-lerped effects.
- `magnitude_max` (number | null): Upper bound for lerped stats. Null for non-lerped effects.
- `condition` (string | null): Semantic tag from the conditional function. Null for unconditional effects.
- `trigger` (string | null): Proc event tag (e.g. `"on_kill"`, `"on_hit"`). Null for non-proc effects.
- `type` (enum): One of `"stat_buff"`, `"conditional_stat_buff"`, `"proc_stat_buff"`, `"lerped_stat_buff"`, `"conditional_lerped_stat_buff"`, `"stepped_stat_buff"`

**`tiers[]`** — Blessing/weapon-trait-only. Array of exactly 4 tier objects, each representing one rarity tier. Each tier is a full override snapshot — it can contain different stat keys, different effect types, and different metadata than other tiers. This mirrors the actual Lua structure where each tier is a table object patched onto the base buff template.
- `effects[]` (array): Same shape as top-level `effects[]`, specific to this tier
- Plus any per-tier metadata fields: `active_duration`, `child_duration`, `max_stacks`, etc.

**`stepped_stat_buffs`** — Used by the `stepped_stat_buff` class (~15 weapon trait buff templates in the "continuous fire" family, inherited via `table.merge` from `base_weapon_trait_buff_templates.lua`). These buffs have per-step magnitude values controlled by `conditional_stepped_stat_buffs_func`. Extracted as effects with `type: "stepped_stat_buff"` — the magnitude represents the per-step value. The step function is tagged using the same inline heuristic system as conditional functions.

**`max_stacks`** (integer | null): Maximum stack count from buff template.
**`duration`** (number | null): Duration in seconds.
**`active_duration`** (number | null): Active/proc duration in seconds.
**`keywords`** (string[]): Keyword tags from buff template (e.g. `"stun_immune"`, `"deterministic_recoil"`).
**`class_name`** (string | null): Buff class name (e.g. `"buff"`, `"proc_buff"`, `"psyker_passive_buff"`).
**`buff_template_names`** (string[]): The buff template name(s) this entity's calc was extracted from. Array because talents can reference multiple buff templates via `passive.buff_template_name` (17 talents across 5 classes have arrays). When multiple templates are referenced, effects from all templates are merged into a single `effects[]` array.

### Invariants

- For fixed-magnitude effects: exactly one of `magnitude` or `magnitude_expr` is non-null, and both `magnitude_min`/`magnitude_max` are null.
- For lerped effects: `magnitude_min` and `magnitude_max` are both non-null, and `magnitude` is null.
- `tiers` is only present on weapon trait entities (blessings/perks). Never on talent entities. Always exactly 4 elements.
- `effects` is always present and non-empty when `calc` is populated.
- An entity with no extractable buff data retains `calc: {}`.
- `buff_template_names` is always a non-empty array when `calc` is populated.

## Pipeline: `npm run effects:build`

### Flow

```
Read scripts/settings/talent/talent_settings_*.lua
  ──→  TalentSettings lookup table (Map<dotted.path, number>)
        │
Read scripts/settings/buff/archetype_buff_templates/*.lua
Read scripts/settings/buff/weapon_traits_buff_templates/*.lua  (includes weapon perk buff templates)
Read scripts/settings/buff/gadget_buff_templates.lua
Read scripts/settings/buff/player_buff_templates.lua
Read scripts/settings/buff/common_buff_templates.lua
  ──→  Parsed + resolved buff templates (with clone/merge chains materialized)
        │
Read scripts/settings/ability/archetype_talents/talents/*_talents.lua
  ──→  talent internal_name → buff_template_name(s) map (1:N — some talents reference arrays)
Read scripts/settings/equipment/weapon_traits/weapon_traits_bespoke_*.lua
  ──→  trait → tier arrays map
        │
Match buff templates to existing entities by internal_name
        │
Write populated calc fields into entity JSON files (in-place)
Write grants_buff edges into edge JSON files
        │
Report summary: entities populated, unresolved expressions, unknown conditions
```

### Entity matching

For talents: the `passive.buff_template_name` in `*_talents.lua` links a talent's `internal_name` to one or more buff template names (17 talents have arrays). The pipeline looks up the entity by `{domain}.talent.{internal_name}`, finds all corresponding buff templates, merges their effects into a single `calc.effects[]`, and generates one `grants_buff` edge per buff template.

For blessings/weapon traits: the entity `internal_name` matches the weapon trait template name directly. Tier arrays from `weapon_traits_bespoke_*.lua` are merged with buff template data from `weapon_traits_buff_templates/*.lua`.

For weapon perks: entity `internal_name` matches perk buff template names from `weapon_perks_melee_buff_templates.lua` and `weapon_perks_ranged_buff_templates.lua`.

For stat nodes: the `attributes.family` field on stat node entities maps to buff template families in `player_buff_templates.lua`.

For gadget traits: entity `internal_name` matches buff template names from `gadget_buff_templates.lua`.

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

The `check_proc_func` field uses `CheckProcFunctions.*` named references heavily. There are ~46 distinct functions in the source. Rather than maintaining an exhaustive hardcoded table, the parser uses a general rule:

- **Named references** (`CheckProcFunctions.X`): strip prefix → tag `"X"` (e.g. `on_kill`, `on_melee_hit`, `on_crit`, `always`, `on_weakspot_kill`, `on_elite_or_special_kill`, `on_heavy_hit`, `on_push_hit`, `on_close_kill`, `on_warp_kill`, etc.)
- **N-ary combinators** (`CheckProcFunctions.all(A, B, ...)` or `.any(A, B, ...)`): recursively tag each argument, join with `+` → `"all:tagA+tagB+tagC"`. Arguments can be named refs, other combinators, or inline functions.
- **Inline functions within combinators** (`all(function(...) ... end, named_ref)`): tag the inline function using inline heuristics (see below), use `"unknown_condition"` as fallback.

### Local function variable references

Buff template files sometimes assign functions to file-local variables (e.g. `local _psyker_passive_conditional_stat_buffs = function(...) ... end`) and then reference them by variable name in `conditional_stat_buffs_func`. The parser handles these by:

1. Pre-scanning the file for `local <name> = function(...)` assignments
2. Storing the function body text keyed by variable name
3. When a `conditional_stat_buffs_func` value is a bare identifier (not `ConditionalFunctions.*`, not `function(...)`), looking it up in the local function map and applying inline heuristics to the stored body

### Inline function heuristics

The majority of `conditional_stat_buffs_func` values in archetype buff templates (~96%) are inline functions or local function variable references, not named `ConditionalFunctions.*` calls. The parser scans the function body text for known patterns (ordered by expected frequency):

| Pattern in function body | Tag | Example |
|---|---|---|
| `template_data.active` (only check) | `"active"` | Buff is currently active |
| `template_data.active` + additional checks | `"active_and_unknown"` | Active with extra conditions |
| `wielded_slot` or `slot_primary`/`slot_secondary` | `"slot_primary"` / `"slot_secondary"` | Slot-specific conditional |
| `has_weapon_keyword_from_slot(..., "keyword")` | `"weapon_keyword:keyword"` | Weapon keyword check |
| `current_health` / `health_percent` threshold | `"threshold:health:value"` | Health-based conditional |
| `current_warp_charge` / `warp_charge` threshold | `"threshold:warp_charge:value"` | Warp charge threshold |
| `ammo` / `clip` threshold | `"threshold:ammo:value"` | Ammo-based conditional |
| `coherency` / `num_units` check | `"coherency"` | Coherency-based |
| Unrecognized body | `"unknown_condition"` | Fallback |

**Condition rate targets:** tracked separately for archetype buffs vs. weapon trait buffs:
- Weapon trait buffs (predominantly `ConditionalFunctions.*`): target <5% unknown
- Archetype buffs (predominantly inline): target <15% unknown — more realistic given the diversity of inline patterns. The inline heuristic list will be expanded iteratively based on the initial pipeline run.

## Testing strategy

### Golden-file tests

Representative samples covering each pattern:
1. Flat `stat_buffs` — simple numeric literal magnitudes
2. `conditional_stat_buffs` — TalentSettings magnitude resolution + condition tag
3. `lerped_stat_buffs` — min/max magnitude range extraction
4. `conditional_lerped_stat_buffs` — lerped range + condition tag
5. `proc_events` + `proc_stat_buffs` — trigger tag + active duration
6. `table.clone` chain — inherited fields from cloned template
7. `table.merge` — override merging
8. Post-construction patch — `templates.X.field = value` after clone
9. Blessing tier objects — 4-tier `tiers[]` extraction with per-tier effects
10. Compound conditions — `CheckProcFunctions.all(A, B, C)` → `"all:tagA+tagB+tagC"`
11. Inline function heuristic — `conditional_stat_buffs_func` body pattern matching
12. Local function variable reference — file-local named function lookup + heuristic tagging
13. Multi-buff talent — `buff_template_name` array → merged effects + multiple edges
14. Stepped stat buff — `stepped_stat_buff` class with per-step magnitudes
15. Unresolvable magnitude — `magnitude: null`, `magnitude_expr: "..."` fallback

### Integration tests

- Full pipeline run on real source files → verify entity JSON files are updated with non-empty `calc`
- `make check` passes with populated calc fields
- `unknown_condition` rate metric is below 10%

### Unit tests

- `lua-data-reader.mjs`: table parsing, nested structures, bracket keys, function skipping, arithmetic expressions
- `talent-settings-parser.mjs`: nested key resolution, alias mapping
- `buff-semantic-parser.mjs`: clone resolution, merge resolution, condition tagging

## Acceptance criteria

1. Every talent/blessing/perk entity with a `buff_template_name` has a non-empty `calc.effects[]`
2. Blessing entities have `calc.tiers` with exactly 4 tier objects, each with its own `effects[]`
3. `unknown_condition` rate is tracked and reported — target <5% for weapon trait buffs, <15% for archetype buffs
4. `make check` passes with populated `calc` fields
5. No runtime dependencies added
6. Concrete magnitude resolution via TalentSettings two-pass lookup, with simple expression evaluation (`a - b`, `a * b`, `1 - a`)
7. Pipeline is idempotent: running `effects:build` twice produces identical output (stable field ordering, deterministic JSON serialization)
8. Coverage metrics reported: entities populated, entities with partial extraction (some magnitudes unresolved), entities with zero extraction despite having a buff_template_name

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
