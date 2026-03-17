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
  profiles:build  → generated/damage-profiles.json   (~108 profiles, ~150KB)
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

**Source:** `scripts/settings/equipment/weapon_templates/{family}/settings_templates/*_damage_profile_templates.lua` (28 weapon families) + `scripts/settings/damage/damage_profile_settings.lua` (lerp lookup tables, cleave presets, crit/finesse tables).

**Implementation:** Reuses `lua-data-reader.mjs`. First loads the lerp lookup table from `damage_profile_settings.lua` to resolve `lerp_X` references (e.g. `lerp_0_75` → `{ min: 0, max: 0.75 }`), then parses each family's damage profile templates.

**Action mapping:** Each weapon template's `action_inputs` table maps input sequences (`light_attack`, `heavy_attack`, `weapon_special`) to chains of actions, each referencing a named damage profile. The pipeline extracts this mapping so the calculator knows which profiles apply to which attack types.

**Output shape per profile:**

```jsonc
{
  "id": "autogun_p1_m1_default",
  "weapon_template": "autogun_p1_m1",
  "damage_type": "auto_bullet",
  "power_distribution": {
    "attack": { "min": 30, "max": 70 },
    "impact": { "min": 5, "max": 15 }
  },
  "armor_damage_modifier": {
    "attack": {
      "near": { "unarmored": [1.0, 1.2], "armored": [0.5, 0.8], "...": "..." },
      "far":  { "unarmored": [0.8, 1.0], "armored": [0.3, 0.5], "...": "..." }
    }
  },
  "cleave_distribution": {
    "attack": { "min": 2.5, "max": 5.0 },
    "impact": { "min": 2.5, "max": 5.0 }
  },
  "finesse_boost": { "unarmored": 0.5, "armored": 0.5, "...": "..." },
  "crit_boost": 0.5,
  "boost_curve": [0, 0.3, 0.6, 0.8, 1],
  "melee_attack_strength": "heavy",
  "charge_level_scaler": null,
  "stagger_category": "killshot",
  "targets": [{ "...": "per-target overrides" }]
}
```

ADM values are `[min_quality, max_quality]` pairs. The calculator accepts a quality parameter (0–1, default 0.8 for typical max-level gear) and lerps between them.

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

**Source:** `scripts/settings/breed/breeds/{breed_name}.lua` + `scripts/settings/difficulty/minion_difficulty_settings.lua` + hitzone data from breed definitions.

**Output shape per breed:**

```jsonc
{
  "id": "renegade_berzerker",
  "display_name": "Rager",
  "community_armor_name": "Maniac",
  "base_health": 350,
  "armor_type": "berserker",
  "tags": ["elite", "melee"],
  "hit_zones": {
    "head": { "type": "unarmored", "multiplier": { "melee": 2.0, "ranged": 2.0 } },
    "body": { "type": "berserker", "multiplier": { "melee": 1.0, "ranged": 1.0 } }
  },
  "difficulty_health": {
    "sedition": 350,
    "malice": 525,
    "heresy": 700,
    "damnation": 1050,
    "auric": 1400
  }
}
```

Includes a `community_armor_name` field mapping internal armor types to community terminology (armored → Flak, berserker → Maniac, super_armor → Carapace, resistant → Unyielding, disgustingly_resilient → Infested) since players use these names universally.

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
  hitZone,          // "head" | "body" | "limb"
  breed,            // breed object (from breeds.json)
  difficulty,       // "sedition" | "malice" | "heresy" | "damnation" | "auric"
  flags,            // scenario flags (see below)
  buffStack,        // aggregated stat_buffs map
  quality,          // weapon quality 0–1, default 0.8
  distance,         // meters, default 0 (melee)
  chargeLevel,      // 0–1, default 1
}) → {
  damage,                    // final damage number
  hitsToKill,                // ceil(enemy_hp / damage)
  baseDamage,                // stage 1 output
  buffMultiplier,            // stage 2 output
  armorDamageModifier,       // stage 3 ADM used
  rendingApplied,            // stage 4 rending amount
  finesseBoost,              // stage 5 finesse multiplier
  hitZoneMultiplier,         // stage 7 multiplier
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

1. **Power Level → Base Damage**: `powerLevel × powerDistribution[attack]` → clamp 0–10000 → map to 0–20 via damage output table
2. **Buff Multiplier Stack**: Sum all applicable `stat_buffs` from `assembleBuildBuffStack()` (40+ additive terms), then multiply by multiplicative terms. Target-side multipliers applied separately.
3. **Armor Damage Modifier (ADM)**: Per armor type scalar from damage profile. Ranged weapons lerp near/far ADM by `√(dropoff_scalar)`. Quality lerps within `[min, max]`.
4. **Rending**: Sum all rending sources from buff stack, multiply by `rending_armor_type_multiplier[armor_type]`. Overdamage past ADM=1.0 at 25% efficiency.
5. **Finesse Boost**: Weakspot and/or crit bonus through boost curve `{0, 0.3, 0.6, 0.8, 1}`. Crit minimum ADM of 0.25 vs all armor types.
6. **Positional**: `backstab_damage` + `flanking_damage` (additive).
7. **Hitzone Multiplier**: Per-breed per-body-part per-attack-type multiplier from breed data.
8. **Armor-Type Stat Buffs**: `unarmored_damage`, `armored_damage`, etc. from attacker + target buffs.
9. **Diminishing Returns**: Only if breed sets `diminishing_returns_damage`. easeInCubic of health%.
10. **Force Field Short-Circuit**: Force field targets → base damage only. (Static calc: skip — no force fields in breakpoint analysis.)
11. **Damage Efficiency**: UI classification (negated/reduced/full) based on ADM thresholds.
12. **Toughness/Health Split**: Toughness absorption, shield gate, bleedthrough. (Computed but not primary — breakpoints use raw health damage.)
13. **Final Application**: Leech, resist_death, death/knockdown resolution. (Computed for completeness; breakpoints use pre-stage-13 damage.)

**Key constants** (from `power_level_settings.lua`, `armor_settings.lua`, `damage_settings.lua`):

| Constant | Value | Source |
|----------|-------|--------|
| Default power level | 500 | `PowerLevelSettings.default_power_level` |
| Damage output range | 0–20 (all armor types) | `PowerLevelSettings.damage_output[armor].{min,max}` |
| Default crit/weakspot boost | 0.5 each | `PowerLevelSettings.default_crit_boost_amount`, `default_finesse_boost_amount` |
| Min crit ADM | 0.25 | `PowerLevelSettings.min_crit_armor_damage_modifier` |
| Overdamage rending multiplier | 0.25 | `ArmorSettings.overdamage_rending_multiplier` |
| Close range | 12.5m | `DamageSettings.ranged_close` |
| Far range | 30m | `DamageSettings.ranged_far` |
| Default boost curve | `[0, 0.3, 0.6, 0.8, 1]` | `PowerLevelSettings.boost_curves.default` |

These are extracted as constants at build time alongside the damage profiles.

## Component 4: Scoring Integration

### `breakpoint_relevance` (1–5)

Fixed checklist approach. Evaluates the build's weapons against ~10 critical breakpoints on Damnation under the "sustained" and "aimed" scenarios:

| Breakpoint | Enemy | Difficulty | Hits | Scenario | Weight |
|-----------|-------|------------|------|----------|--------|
| One-shot Rager body | renegade_berzerker | Damnation | 1 | sustained | High |
| One-shot Rager head | renegade_berzerker | Damnation | 1 | aimed | High |
| Two-hit Crusher | chaos_ogryn_executor | Damnation | 2 | aimed | High |
| One-shot Trapper | chaos_poxwalker_trapper | Damnation | 1 | aimed | Medium |
| One-shot Hound | chaos_hound | Damnation | 1 | aimed | Medium |
| One-shot Bomber body | chaos_poxwalker_bomber | Damnation | 1 | sustained | Medium |
| Horde one-shot body | poxwalker | Damnation | 1 | sustained | Medium |
| Three-hit Mauler | renegade_executor | Damnation | 3 | aimed | Low |
| Two-hit Bulwark | chaos_ogryn_bulwark | Damnation | 2 | aimed | Low |
| One-shot Sniper | renegade_sniper | Damnation | 1 | aimed | Low |

Scoring: weighted sum of breakpoints hit by the build's best weapon action for each scenario, normalized to 1–5 scale. A build with no weapon data scores null (graceful degradation).

The specific checklist entries and weights are defined in a separate data file (`breakpoint-checklist.json`) so they can be tuned without code changes.

### `difficulty_scaling` (1–5)

Population-relative scoring. Computes the breakpoint matrix for all 23 reference builds. For the current build, measures how hits-to-kill degrades across Heresy → Damnation → Auric for key enemies compared to the population median.

- Score 5: Build maintains all key breakpoints through Auric
- Score 3: Build maintains breakpoints through Damnation but loses some at Auric
- Score 1: Build loses key breakpoints at Damnation

The population baseline is computed lazily and cached. It updates when reference builds change or `score:freeze` runs.

### Composite Score Recalibration

With 5/7 dimensions now scored (was 3/7), the composite maximum rises from an effective /25 to /35 (true maximum when #5 damage calculator is complete but `breakpoint_relevance` and `difficulty_scaling` are blocked on this work). Letter grade thresholds may shift — re-evaluate after running across all 23 builds. `score:freeze` regenerates golden snapshots.

## Component 5: CLI — `npm run calc`

### Usage

```bash
npm run calc -- <build.json> [--text|--json]
npm run calc -- <build.json> --compare <other-build.json> [--text|--json]
npm run calc -- scripts/builds/                          # batch mode
```

### Text Output (default)

Per-weapon summary table. Shows hits-to-kill for key enemies at Damnation across the three named scenarios. Uses community armor names (Flak, Maniac, Carapace, Unyielding, Infested) alongside internal names.

```
═══ Kantrael MG XIIa (ranged) ═══

                    Sustained    Aimed (head)    Burst
  Rager (Maniac)        2            1             1    ✓ aimed breakpoint
  Crusher (Carapace)    8            4             2    ✓ burst breakpoint
  Trapper (Maniac)      3            1             1    ✓ aimed breakpoint
  Hound (Infested)      2            1             1    ✓ aimed breakpoint
  Poxwalker (Infested)  1            1             1    ✓ sustained breakpoint
  Mauler (Flak)         5            3             2

  Breakpoints hit: 5/10 (aimed: 4, sustained: 1)
```

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
