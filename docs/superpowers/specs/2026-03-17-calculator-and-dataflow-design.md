# Calculator and Dataflow Layer Design

Issue: #5

## Problem

hadrons-blessing has 435 entities with extracted stat modifiers (talents, blessings, perks, gadget traits) but cannot compute actual damage numbers. The scoring model has two null dimensions (`breakpoint_relevance`, `difficulty_scaling`) blocked on this. Community calculators (Wartide) model only weapon + perks (stages 1–5 of 13); nobody accounts for the full talent/blessing buff stack. Players resort to "test in the Psykanium" for conditional buff evaluation.

## Decision Record

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | JS/ESM (future TS via #1) | Integrates with existing scoring/synergy/recs; runs natively in SvelteKit website; damage calc is ~20 multiplications per hit — Rust/WASM performance irrelevant |
| Existing tools | Not using [dtmath-wit](https://github.com/manshanko/dtmath-wit) | Archived March 2025, partial coverage, data baked into opaque WASM binary — can't extend with our 435-entity buff stack |
| Pipeline scope | Full 13-stage damage pipeline | Stages 9–13 rarely matter for breakpoints but cost little to implement and enable future survivability/toughness work |
| Data strategy | Build-time extraction (Option A) | Matches `effects:build` / `edges:build` pattern; source-root is build-time only, not runtime; generated JSON ships to website |
| Conditional buffs | Flag-based engine + scoring-layer-composed scenarios | Avoids baking combat assumptions into the engine; scoring defines "sustained", "aimed", "burst" from toggleable flags |
| Attack granularity | All actions extracted, consumers summarize (Option B) | Engine has full fidelity; CLI/scoring report best-light, best-heavy, special per weapon |
| Breakpoint scoring | General engine (B) + fixed checklist (A) + population-relative (C) | Engine computes full matrix; checklist fills `breakpoint_relevance`; population comparison fills `difficulty_scaling` |

## Architecture Overview

```
Build-time extraction (npm run):
  profiles:build  → generated/damage-profiles.json   (200–400 profiles, est. ~200KB)
  breeds:build    → generated/breed-data.json         (~30 breeds, ~30KB)

Prerequisite:
  condition-tagger.mjs  → ~10 new patterns for currently-opaque conditions

Runtime modules:
  lib/damage-calculator.mjs     ← core engine (pure functions)
  lib/breakpoint-checklist.mjs  ← scoring policy (which breakpoints matter)
  lib/build-scoring.mjs         ← updated: breakpoint_relevance + difficulty_scaling

CLI:
  npm run calc -- <build.json> [--text|--json]
  npm run calc -- <build.json> --compare <other-build.json>
```

## Component 1: Data Extraction Pipelines

### `profiles:build` — Weapon Damage Profile Extraction

**Source paths:** Damage profiles are aggregated from two locations:
1. Per-weapon family: `scripts/settings/equipment/weapon_templates/{family}/settings_templates/*_damage_profile_templates.lua` (~40 weapon families with `settings_templates/` subdirectories out of ~60 total weapon template directories)
2. Archetype/role-based: `scripts/settings/damage/damage_profiles/` (shared profiles like `linesman_`, `smiter_`, `ninjafencer_` used across weapon families)

The pipeline must follow the same aggregation as the source's `damage_profile_templates.lua` which imports from both locations.

**Lerp resolution:** ADM values in damage profiles reference named pairs from `scripts/settings/damage/damage_profile_settings.lua` (e.g. `lerp_0_75` → `{ min: 0, max: 0.75 }`). The pipeline loads this lookup table first, then resolves all `damage_lerp_values.lerp_X` references during extraction. The resolved `[min, max]` pairs represent item quality range — the calculator lerps between them using a quality parameter (0–1, default 0.8).

**Implementation:** Reuses `lua-data-reader.mjs` for parsing.

**Action-to-profile mapping:** The indirection chain from user input to damage profile is:
1. `action_inputs` (e.g. `light_attack`) → action name chain
2. `actions[action_name]` → action definition with `fire_configuration` (ranged) or `damage_profile` (melee)
3. For ranged: `fire_configuration.hit_scan_template` → `HitScanTemplates` → `damage.impact.damage_profile = DamageProfileTemplates.<name>`
4. For melee: `damage_profile = DamageProfileTemplates.<name>` directly on the action

The pipeline resolves this chain to produce a flat action → profile mapping per weapon.

**Output shape per profile:**

Melee and ranged profiles have different ADM structures:

```jsonc
// Melee profile
{
  "id": "thunderhammer_2h_p1_m1_heavy",
  "weapon_template": "thunderhammer_2h_p1_m1",
  "damage_type": "blunt_thunder",
  "power_distribution": { "attack": 100, "impact": 60 },
  "armor_damage_modifier": {
    "attack": { "unarmored": [1.0, 1.2], "armored": [0.8, 1.0], "...": "..." },
    "impact": { "unarmored": [1.0, 1.0], "armored": [0.5, 0.7], "...": "..." }
  },
  "cleave_distribution": { "attack": [2.5, 5.0], "impact": [2.5, 5.0] },
  "finesse_boost": { "unarmored": 0.5, "armored": 0.5, "...": "..." },
  "crit_boost": 0.5,
  "boost_curve": null,
  "melee_attack_strength": "heavy",
  "charge_level_scaler": null,
  "stagger_category": "killshot",
  "targets": [{ "...": "per-target overrides (power_distribution, ADM, boost_curve)" }]
}

// Ranged profile
{
  "id": "autogun_p1_m1_default",
  "weapon_template": "autogun_p1_m1",
  "damage_type": "auto_bullet",
  "power_distribution": { "attack": 50, "impact": 15 },
  "armor_damage_modifier_ranged": {
    "near": {
      "attack": { "unarmored": [1.0, 1.2], "armored": [0.5, 0.8], "...": "..." },
      "impact": { "unarmored": [1.0, 1.0], "armored": [0.3, 0.5], "...": "..." }
    },
    "far": {
      "attack": { "unarmored": [0.8, 1.0], "armored": [0.3, 0.5], "...": "..." },
      "impact": { "unarmored": [0.8, 0.8], "armored": [0.2, 0.3], "...": "..." }
    }
  },
  "cleave_distribution": { "attack": [0.001, 0.001], "impact": [0.001, 0.001] },
  "finesse_boost": { "unarmored": 0.5, "armored": 0.5, "...": "..." },
  "crit_boost": 0.5,
  "boost_curve": null,
  "melee_attack_strength": null,
  "charge_level_scaler": null,
  "stagger_category": "killshot",
  "targets": [{ "...": "per-target overrides" }]
}
```

Note: `power_distribution.attack` and `.impact` are flat numbers (not min/max pairs). The `[min, max]` pairs are only in ADM values (lerped by item quality). All example values are illustrative — actual values are extracted from the source.

**Action map output shape:**

```jsonc
{
  "weapon_template": "autogun_p1_m1",
  "actions": {
    "light_attack": ["autogun_p1_m1_default", "autogun_p1_m1_default"],
    "heavy_attack": ["autogun_p1_m1_aimed"],
    "weapon_special": null
  }
}
```

### `breeds:build` — Enemy Breed Data Extraction

**Source:** `scripts/settings/breed/breeds/{faction}/{breed_name}_breed.lua` + `scripts/settings/difficulty/minion_difficulty_settings.lua` + hitzone data from breed definitions.

**Hitzone armor overrides:** Many breeds have `hitzone_armor_override` that changes the armor type for specific body parts. For example, `renegade_berzerker` (Rager) has base `armor_type = armored` (Flak) but overrides `torso` and `center_mass` to `super_armor` (Carapace). The breed data must capture these overrides per-hitzone, as they critically affect damage calculations — a body shot on a Rager hits Carapace armor, not Flak.

**Hitzone model:** The source defines 9+ hit zones per breed (head, torso, upper_left_arm, lower_left_arm, upper_right_arm, lower_right_arm, upper_left_leg, lower_left_leg, upper_right_leg, lower_right_leg, center_mass, afro). Each has per-attack-type damage multipliers (`hitzone_damage_multiplier.ranged/melee`) and optional armor type overrides. The extraction preserves the full hitzone set. The calculator API groups them for convenience but the underlying data is complete.

**Output shape per breed:**

```jsonc
{
  "id": "renegade_berzerker",
  "display_name": "Rager",
  "base_armor_type": "armored",
  "community_armor_name": "Flak",
  "tags": ["elite", "melee"],
  "hit_zones": {
    "head":        { "armor_type": "unarmored",  "multiplier": { "melee": 2.0, "ranged": 2.0 } },
    "torso":       { "armor_type": "super_armor", "multiplier": { "melee": 1.0, "ranged": 1.0 } },
    "center_mass": { "armor_type": "super_armor", "multiplier": { "melee": 1.0, "ranged": 1.0 } },
    "upper_left_arm":  { "armor_type": "armored", "multiplier": { "melee": 0.8, "ranged": 0.8 } },
    "lower_left_arm":  { "armor_type": "armored", "multiplier": { "melee": 0.5, "ranged": 0.5 } },
    "...": "..."
  },
  "difficulty_health": {
    "uprising":    850,
    "malice":     1000,
    "heresy":     1250,
    "damnation":  1875,
    "auric":      2500
  }
}
```

Note: there is no `base_health` field — health is entirely determined by `minion_difficulty_settings.lua` per breed per difficulty. The `difficulty_health` map captures the resolved values directly. Health values vary per-breed; some use shared step arrays (e.g. `_elite_health_steps`) while others have custom arrays.

**Community armor name mapping:**

| Internal armor type | Community name |
|---|---|
| unarmored | Unarmored |
| armored | Flak |
| berserker | Maniac |
| super_armor | Carapace |
| resistant | Unyielding |
| disgustingly_resilient | Infested |
| void_shield | Void Shield |

`player` armor type is irrelevant for this calculator (PvE only).

### `make check` Integration

Both pipelines added to the Makefile alongside `edges:build` and `effects:build`. Estimated combined runtime: < 2 seconds (based on existing pipeline benchmarks — `effects:build` parses 2013 templates in 0.7s, `edges:build` does 1494 edges in 0.2s).

## Component 2: Condition Tagger Expansion

**Problem:** 68 effects (48% of all conditional effects) have `unknown_condition` or `active_and_unknown` because the condition tagger lacks patterns for common gameplay states.

**New patterns (~10):**

| Pattern | Condition tag | Affected talents (examples) |
|---------|--------------|----------------------------|
| ADS / aim-down-sights | `ads_active` | veteran_ads_drain_stamina |
| Out-of-melee range | `out_of_melee` | veteran_ranged_power_out_of_melee |
| High toughness (>75%) | `threshold:toughness_high` | veteran_tdr_on_high_toughness |
| High stamina | `threshold:stamina_high` | ogryn_damage_reduction_on_high_stamina |
| Low health (<50%) | `threshold:health_low` | zealot_fanatic_rage (Martyrdom) |
| During heavy attack | `during_heavy` | zealot_uninterruptible_no_slow_heavies |
| During melee windup | `during_windup` | ogryn_windup_reduces_damage_taken |
| Full stamina | `threshold:stamina_full` | broker_passive_improved_dodges_at_full_stamina |
| During reload | `during_reload` | broker_passive_reduced_toughness_damage_during_reload |
| Combat ability active | `ability_active` | psyker_combat_ability_stance (Scrier's Gaze) |

These make the conditions flag-addressable by the calculator's scenario system. Some residual `unknown_condition` effects will remain — those are truly opaque Lua closures and get excluded from calculation (documented as known gaps).

## Component 3: Calculator Engine

### Module: `scripts/ground-truth/lib/damage-calculator.mjs`

Pure functions, no side effects, no source-root dependency. Loads generated JSON at initialization.

### API

```js
// Initialize — loads generated data files
loadCalculatorData() → { profiles, breeds, index }

// Single hit calculation — the core 13-stage pipeline
computeHit({
  profile,          // damage profile object (from profiles.json)
  hitZone,          // full hitzone name (e.g. "head", "torso", "upper_left_arm")
  breed,            // breed object (from breeds.json)
  difficulty,       // "uprising" | "malice" | "heresy" | "damnation" | "auric"
  flags,            // scenario flags (see below)
  buffStack,        // aggregated stat_buffs map (from assembleBuildBuffStack)
  quality,          // weapon quality 0–1, default 0.8
  distance,         // meters, default 0 (melee)
  chargeLevel,      // 0–1, default 1
}) → {
  damage,                    // final damage number
  hitsToKill,                // ceil(enemy_hp / damage)
  baseDamage,                // stage 1 output
  buffMultiplier,            // stage 2 output
  armorDamageModifier,       // stage 3 ADM used (resolved per-hitzone armor type)
  rendingApplied,            // stage 4 rending amount
  finesseBoost,              // stage 5 finesse multiplier
  hitZoneMultiplier,         // stage 7 multiplier
  effectiveArmorType,        // resolved armor type for this hitzone (may differ from base)
  damageEfficiency,          // "full" | "reduced" | "negated"
  stagesApplied: [1..13],    // which stages contributed
}

// Buff stack assembly — collects effects from a build, filters by flags
assembleBuildBuffStack(build, index, flags) → statBuffsMap

// Full breakpoint matrix for a build
computeBreakpoints(build, index, profiles, breeds) → {
  weapons: [{
    entityId,
    slot,
    actions: [{
      type,             // "light_attack" | "heavy_attack" | "weapon_special"
      profileId,
      scenarios: {
        sustained: { breeds: [{ id, difficulty, hitsToKill, hitZone }...] },
        aimed:     { ... },
        burst:     { ... },
      }
    }],
    summary: {
      bestLight:   { ... },
      bestHeavy:   { ... },
      special:     { ... },
    }
  }],
  metadata: { quality, flagsUsed, timestamp }
}

// Condensed summary for scoring
summarizeBreakpoints(matrix) → per-weapon best-case hits-to-kill for key enemies
```

### `assembleBuildBuffStack` — Buff Stack Assembly

This function bridges the entity/effects model (435 entities with extracted `calc.effects`) to the flat `stat_buffs` map consumed by the 13-stage pipeline.

**Algorithm:**
1. Iterate all resolved selections in the build (talents, blessings, perks, gadget traits)
2. For each selection, look up `calc.effects` from the index
3. Filter effects by scenario flags using the condition-to-flag mapping:
   - `stat_buff` type: always included (unconditional)
   - `conditional_stat_buff` type: include if the effect's `condition` matches an active flag
   - `proc_stat_buff` type: include if `flags.proc_stacks > 0`; scale magnitude by `min(flags.proc_stacks, max_stacks)` if stacking
   - `lerped_stat_buff` type: scale magnitude by the corresponding flag value (e.g. `warp_charge: 0.7` → 70% of max magnitude)
4. Accumulate per-stat:
   - **Additive stats** (the majority): each `(value - 1)` added to a running sum starting at 1. This matches the source's `damage_stat_buffs = 1 + (stat_buffs.X or 1) - 1 + ...` pattern.
   - **Multiplicative stats** (`smite_damage_multiplier`, `companion_damage_multiplier`, and all `damage_taken_*_multiplier` target-side buffs): multiplied into a separate product, applied after the additive sum.
5. Output: flat `{ stat_name: accumulated_value, ... }` map matching the shape `_calculate_damage_buff` expects.

**Condition-to-flag mapping:**

| Condition tag | Flag field | Match logic |
|---|---|---|
| `threshold:health_low` | `health_state` | active when `"low"` |
| `threshold:toughness_high` | `health_state` | active when `"full"` |
| `threshold:warp_charge` | `warp_charge` | lerp magnitude by value 0–1 |
| `threshold:stamina_high` | (always true in calc) | conservative: assume stamina available |
| `ads_active` | `ads_active` | direct flag match |
| `ability_active` | `ability_active` | direct flag match |
| `during_heavy` | derived from action type | active for heavy attack profiles |
| `during_reload` | `during_reload` | direct flag match |
| `wielded` | (always true for that weapon's slot) | self-sufficient condition |
| `slot_secondary` | (active when computing secondary weapon) | self-sufficient condition |

### Scenario Flags

The engine accepts a flat flags object. The scoring layer composes named scenarios from these.

```js
const FLAGS = {
  is_crit: false,
  is_weakspot: false,
  is_backstab: false,
  is_flanking: false,
  target_staggered: false,
  target_heavy_staggered: false,
  proc_stacks: 0,           // 0 = none, Infinity = max
  health_state: "full",     // "full" | "low" (below 50%)
  warp_charge: 0,           // 0–1 for lerped buffs
  target_status: [],        // ["burning", "bleeding", "electrocuted"]
  ads_active: false,
  ability_active: false,
  during_reload: false,
}
```

**Named scenario presets** (defined in the scoring layer, not the engine):

| Name | Flags | Use case |
|------|-------|----------|
| `sustained` | All defaults (no crit, no weakspot, no procs, full health) | Horde breakpoints — worst realistic case |
| `aimed` | `is_weakspot: true` | Special/elite breakpoints — competent play, headshotting |
| `burst` | `is_crit: true, is_weakspot: true, proc_stacks: Infinity, health_state: "low"` | Conditional ceiling — peak damage with everything active |

### 13-Stage Pipeline Implementation

Direct port of `damage_calculation.lua` to JS. All stages implemented as individual pure functions composed in sequence:

1. **Power Level → Base Damage**: `powerLevel × powerDistribution[attack]` → clamp 0–10000 → map to 0–20 via damage output table per armor type
2. **Buff Multiplier Stack**: See detailed breakdown below. ~40 additive terms summed, then multiplicative terms applied separately. Target-side multipliers (additive modifiers × multiplicative multipliers) applied to final buff.
3. **Armor Damage Modifier (ADM)**: Per armor type scalar from damage profile, **using the hitzone's resolved armor type** (not the breed's base type). Ranged weapons lerp near/far ADM by `√(dropoff_scalar)`. Quality lerps within `[min, max]`.
4. **Rending**: Sum all rending sources from buff stack, multiply by `rending_armor_type_multiplier[armor_type]` (1.0 for armored/super_armor/resistant/berserker, 0 for others). Overdamage past ADM=1.0 at `overdamage_rending_multiplier[armor_type]` efficiency (0.25 for armored/super_armor/resistant/berserker, 0 for unarmored/disgustingly_resilient/void_shield).
5. **Finesse Boost**: Weakspot and/or crit bonus through boost curve (default `[0, 0.3, 0.6, 0.8, 1]`). Crit boost is a flat 0.5 (`default_crit_boost_amount`). Finesse (weakspot) boost is **per-armor-type** (`default_finesse_boost_amount[armor_type]`). Combined finesse amount clamped to 1.0 before curve lookup. Crit minimum ADM of 0.25 vs all armor types.
6. **Positional**: `backstab_damage` + `flanking_damage` (additive to damage).
7. **Hitzone Multiplier**: Per-breed per-hitzone per-attack-type multiplier from breed data. Uses the full hitzone name, not the simplified 3-zone model.
8. **Armor-Type Stat Buffs**: `unarmored_damage`, `armored_damage`, `resistant_damage`, `berserker_damage`, `super_armor_damage`, `disgustingly_resilient_damage` from both attacker and target stat buffs.
9. **Diminishing Returns**: Only if breed sets `diminishing_returns_damage`. easeInCubic of health%.
10. **Force Field Short-Circuit**: Force field targets → base damage only. (Static calc: skip — no force fields in breakpoint analysis.)
11. **Damage Efficiency**: UI classification (negated/reduced/full) based on ADM thresholds.
12. **Toughness/Health Split**: Toughness absorption, shield gate, bleedthrough. (Computed but not primary — breakpoints use raw health damage.)
13. **Final Application**: Leech, resist_death, death/knockdown resolution. (Computed for completeness; breakpoints use pre-stage-13 damage.)

#### Stage 2 Stat Buff Categories

The `_calculate_damage_buff` function in the source accumulates ~40 terms. The calculator must handle all of them, categorized as:

**Attacker-side additive** (each `(value - 1)` added to running sum starting at 1):
- Generic: `damage`
- Weapon type: `melee_damage`, `ranged_damage`, `melee_heavy_damage`, `melee_fully_charged_damage`, `first_target_melee_damage_modifier`
- Distance: `damage_near`, `damage_far`, `ranged_damage_far` (lerped by √distance)
- Crit conversion: `critical_strike_chance_to_damage_convert × crit_chance × critical_strike_damage`
- Target category: `damage_vs_elites`, `damage_vs_specials`, `damage_vs_horde`, `damage_vs_ogryn`, `damage_vs_ogryn_and_monsters`, `damage_vs_monsters`, `damage_vs_captains`
- Target state: `damage_vs_staggered`, `damage_vs_heavy_staggered`, `damage_vs_medium_staggered`, `damage_vs_electrocuted`, `damage_vs_burning`, `damage_vs_bleeding`, `damage_vs_healthy`, `damage_vs_unaggroed`, `damage_vs_nonthreat`, `damage_vs_suppressed`
- Weapon-specific: `force_weapon_damage`, `psyker_throwing_knives_damage_multiplier`, `force_staff_single_target_damage`, `force_staff_secondary_damage`, `force_staff_melee_damage`, `shout_damage`, `smite_damage`, `chain_lightning_damage`, `warp_damage`, `finesse_ability_multiplier`
- Stagger count: `stagger_count_damage × clamp(stagger_count, 0, 7)`
- Companion: `companion_damage_modifier`, `companion_damage_vs_elites`, `companion_damage_vs_special`, `companion_damage_vs_ranged`, `companion_damage_vs_melee`
- From damage profile: `damage_profile.stat_buffs[]` (arbitrary additional stat names per profile)

**Attacker-side multiplicative** (multiplied into separate `damage_multiplier` product):
- `smite_damage_multiplier`
- `companion_damage_multiplier`

**Target-side additive modifiers** (summed into `damage_taken_modifiers`):
- `damage_taken_modifier`, `melee_damage_taken_modifier`

**Target-side multiplicative** (multiplied into `damage_taken_multipliers` product):
- `damage_taken_multiplier`, `ranged_damage_taken_multiplier`, `melee_damage_taken_multiplier`
- `monster_damage_taken_multiplier`, `ogryn_damage_taken_multiplier`
- `warp_damage_taken_multiplier`, `non_warp_damage_taken_multiplier`
- `damage_taken_from_toxic_gas_multiplier`
- `damage_taken_by_{breed}_multiplier` (per-breed)
- `damage_taken_from_explosions`, `damage_taken_from_burning`, `damage_taken_from_toxin`, `damage_taken_from_bleeding`, `damage_taken_from_electrocution`, `damage_taken_from_kinetic`
- `damage_taken_vs_taunted`

**Final assembly:** `buff_damage = base_damage × (additive_sum × damage_multiplier × (target_additive_modifiers × target_multiplicative)) - 1)`

**Key constants** (from `power_level_settings.lua`, `armor_settings.lua`, `damage_settings.lua`):

| Constant | Value | Source |
|----------|-------|--------|
| Default power level | 500 | `PowerLevelSettings.default_power_level` |
| Damage output range | 0–20 (all armor types) | `PowerLevelSettings.damage_output[armor].{min,max}` |
| Default crit boost | 0.5 (flat) | `PowerLevelSettings.default_crit_boost_amount` |
| Default finesse (weakspot) boost | Per armor type | `PowerLevelSettings.default_finesse_boost_amount[armor]` |
| Min crit ADM | 0.25 | `PowerLevelSettings.min_crit_armor_damage_modifier` |
| Overdamage rending multiplier | Per armor type (0.25 for armored/super_armor/resistant/berserker, 0 for others) | `ArmorSettings.overdamage_rending_multiplier[armor]` |
| Rending armor type multiplier | Per armor type (1.0 for armored/super_armor/resistant/berserker, 0 for others) | `ArmorSettings.rending_armor_type_multiplier[armor]` |
| Close range | 12.5m | `DamageSettings.ranged_close` |
| Far range | 30m | `DamageSettings.ranged_far` |
| Default boost curve | `[0, 0.3, 0.6, 0.8, 1]` | `PowerLevelSettings.boost_curves.default` |

These are extracted as constants at build time alongside the damage profiles.

## Component 4: Scoring Integration

### `breakpoint_relevance` (1–5)

Fixed checklist approach. Evaluates the build's weapons against ~10 critical breakpoints on Damnation under the "sustained" and "aimed" scenarios:

| Breakpoint | Enemy | Difficulty | Hits | Scenario | Weight |
|-----------|-------|------------|------|----------|--------|
| One-shot Rager head | renegade_berzerker | Damnation | 1 | aimed | High |
| Two-hit Rager body | renegade_berzerker | Damnation | 2 | sustained | High |
| Two-hit Crusher | chaos_ogryn_executor | Damnation | 2 | aimed | High |
| One-shot Trapper | renegade_netgunner | Damnation | 1 | aimed | Medium |
| One-shot Hound | chaos_hound | Damnation | 1 | aimed | Medium |
| One-shot Bomber body | chaos_poxwalker_bomber | Damnation | 1 | sustained | Medium |
| Horde one-shot body | poxwalker | Damnation | 1 | sustained | Medium |
| Three-hit Mauler | renegade_executor | Damnation | 3 | aimed | Low |
| Two-hit Bulwark | chaos_ogryn_bulwark | Damnation | 2 | aimed | Low |
| One-shot Sniper | renegade_sniper | Damnation | 1 | aimed | Low |

Note: Breed IDs in the checklist will be verified against the extracted breed data during implementation. The checklist is defined in a separate data file (`breakpoint-checklist.json`) so entries and weights can be tuned without code changes.

Scoring: weighted sum of breakpoints hit by the build's best weapon action for each scenario, normalized to 1–5 scale. A build with no weapon data scores null (graceful degradation).

### `difficulty_scaling` (1–5)

Population-relative scoring. Computes the breakpoint matrix for all 23 reference builds. For the current build, measures how hits-to-kill degrades across Heresy → Damnation → Auric for key enemies compared to the population median.

- Score 5: Build maintains all key breakpoints through Auric
- Score 3: Build maintains breakpoints through Damnation but loses some at Auric
- Score 1: Build loses key breakpoints at Damnation

The population baseline is computed lazily and cached. It updates when reference builds change or `score:freeze` runs.

### Composite Score Recalibration

With `breakpoint_relevance` and `difficulty_scaling` now scored, the composite uses 5/7 dimensions (was 3/7: talent_coherence, blessing_synergy, role_coverage). The existing 2 mechanical dimensions (`perk_optimality`, `curio_efficiency`) were already scored, making this 5 qualitative+mechanical out of 7 total. The remaining 2 dimensions (`breakpoint_relevance_mechanical`, `difficulty_scaling_mechanical`) are blocked on this work — wait, those ARE the two new ones. So: 3 existing qualitative + 2 existing mechanical + 2 new from this work = 7/7. All dimensions scored.

Letter grade thresholds will need recalibration — re-evaluate after running across all 23 builds. `score:freeze` regenerates golden snapshots.

## Component 5: CLI — `npm run calc`

### Usage

```bash
npm run calc -- <build.json> [--text|--json]
npm run calc -- <build.json> --compare <other-build.json> [--text|--json]
npm run calc -- scripts/builds/                          # batch mode
```

### Text Output (default)

Per-weapon summary table. Shows hits-to-kill for key enemies at Damnation across the three named scenarios. Uses community armor names alongside internal names.

```
═══ Kantrael MG XIIa (ranged) ═══

                      Sustained    Aimed (head)    Burst
  Rager (Flak)            3            1             1    ✓ aimed breakpoint
  Crusher (Carapace)      8            4             2    ✓ burst breakpoint
  Trapper (Maniac)        3            1             1    ✓ aimed breakpoint
  Hound (Infested)        2            1             1    ✓ aimed breakpoint
  Poxwalker (Infested)    1            1             1    ✓ sustained breakpoint
  Mauler (Flak)           5            3             2

  Breakpoints hit: 5/10 (aimed: 4, sustained: 1)
```

Note: Rager displays as "Flak" (its base armor type), though body shots hit Carapace due to hitzone overrides — the detailed `--json` output shows per-hitzone breakdown.

### JSON Output

Full breakpoint matrix: every weapon × action × breed × difficulty × scenario, plus metadata (quality, flags, timestamp). Consumed by BetterBots agents, website, and programmatic tools.

### Compare Mode

Shows breakpoint deltas between two builds. Highlights gained/lost breakpoints. Useful for recommendation swap evaluation: "swapping talent X for Y gains Crusher 2-hit on burst, loses Rager 1-shot on sustained."

## Deferred / Out of Scope

| Item | Issue | Reason |
|------|-------|--------|
| Toughness/survivability calculator | #11 | Separate concern (defender-side stages 12–13). Different consumers and inputs. |
| Stagger calculator | #12 | Parallel to damage (uses `impact` power distribution). Same pipeline shape but different output. |
| Cleave multi-target simulation | #13 | Data is extracted (cleave budgets + hit mass) but modeling "how many poxwalkers per heavy?" is combinatorial. |
| `suggest-improvement` v1.1 | #10 | Brute-force breakpoint optimization uses the calculator but is a recommendations feature. |
| Weapon quality UI slider | Website feature (#6). Engine accepts quality parameter; CLI defaults to 0.8. |
| Per-class scenario presets | E.g. Psyker scenarios auto-include `warp_charge` flag. Nice-to-have, not blocking. |

## Validation Strategy

1. **Cross-reference Wartide**: Pick 5 weapon × enemy × difficulty combinations from the [Wartide calculator](https://dt.wartide.net/calc/) and verify our engine produces matching base damage and hits-to-kill (without talent buffs, since Wartide doesn't model those).
2. **Golden snapshots**: `npm run calc:freeze` generates baseline snapshots for all 23 builds. CI regression catches drift.
3. **Unit tests per pipeline stage**: Each of the 13 stages gets isolated test cases with known inputs/outputs from `damage_calculation.lua`.
4. **Buff stack assembly tests**: Verify that `assembleBuildBuffStack()` for a known build produces the expected `stat_buffs` map by comparing against manually computed values from the decompiled buff templates.
5. **Scoring dimension tests**: Verify `breakpoint_relevance` and `difficulty_scaling` produce non-null values for all 23 builds and that the grade distribution shifts appropriately.
