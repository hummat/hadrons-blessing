# Synergy Model Design

**Issue:** #8
**Date:** 2026-03-16
**Status:** Draft

## Problem

The buff semantic extraction (#7) populated `calc.effects` on 435 entities with 551 structured effects. The next question is: "do these talents/blessings/weapons work well together?" There is no synergy analysis anywhere in the codebase — `score-build.mjs` has null stubs for `blessing_synergy`, `talent_coherence`, `role_coverage`, and other qualitative scores.

This model bridges raw buff data (#7) and user-facing scoring (#9) / recommendations (#10).

## Background: available signals

| Signal | Count | Source |
|--------|-------|--------|
| Entities with `calc.effects` | 435 of 1735 | `data/ground-truth/entities/` |
| Top-level effects | 551 | across 6 effect types |
| Unique stat names | 156 | `calc.effects[].stat` |
| Unique triggers | 13 | `calc.effects[].trigger` |
| `grants_buff` edges | 385 | `data/ground-truth/edges/` |
| Weapon traits with tier data | 44 | `shared-weapons.json` |
| Buff keywords | 8 unique values | `calc.keywords` |

**Known gaps:** 68 effects have opaque conditions (`unknown_condition` or `active_and_unknown`). 14 `stat_node` entities have empty `calc`. These are accepted limitations — the model operates at ~85% effect visibility and reports gaps honestly via metadata.

## Approach

**Stat-family vocabulary + declarative rules.** Two subsystems with distinct responsibilities:

1. **Rule engine** — declarative rules that detect specific synergy/anti-synergy patterns between selection pairs. Answers "do A and B synergize?"
2. **Stat aggregator** — build-wide coverage analysis over stat families. Answers "does this build have a coherent identity?"

### Alternatives considered

1. **Flat pairwise rule table only:** Simple and testable, but treats everything as pairwise. Misses n-ary patterns like "3 crit-dependent talents but no crit source." Stat aggregation fills this gap.
2. **Full graph analysis:** Build a bipartite graph (selections → effects → stats), run connected-component / reachability analysis. Naturally handles n-ary but harder to explain individual synergies to users and heavier to implement. Overkill for v1.

## Architecture

### New modules

```
scripts/ground-truth/lib/
  synergy-model.mjs          # Main entry: analyzeBuild(build, index) → analysis
  synergy-rules.mjs          # 6 rule implementations (pure functions)
  synergy-stat-families.mjs  # STAT_FAMILIES map + family lookup helpers
scripts/
  analyze-synergy.mjs        # CLI entry point
```

### Module responsibilities

**`synergy-stat-families.mjs`** — Static mapping of 156 stat names to 11 stat families. Stats can belong to multiple families (multi-membership). Unmapped stats are flagged as `uncategorized`.

**`synergy-rules.mjs`** — Six rule implementations, each a pure function: `(selections, index) → edges[]`. Rules run independently, no rule depends on another's output.

**`synergy-model.mjs`** — Orchestrates: loads build + index, resolves selections to entities with calc data, runs all rules, runs stat aggregation, assembles output.

**`analyze-synergy.mjs`** — CLI: `npm run synergy -- <build.json> [--json]`. Default human-readable text output. `--json` for structured output. Supports batch mode on directories.

## Stat Family Taxonomy

11 families grouping 156 stat names by combat role:

| Family | Representative stats | Purpose |
|--------|---------------------|---------|
| `melee_offense` | `melee_damage`, `melee_attack_speed`, `melee_heavy_damage`, `melee_weakspot_damage`, `melee_power_level_modifier` | Melee damage output |
| `ranged_offense` | `ranged_damage`, `ranged_attack_speed`, `reload_speed`, `recoil_modifier`, `spread_modifier`, `ammo_reserve_capacity`, `clip_size_modifier` | Ranged damage output |
| `general_offense` | `damage`, `power_level_modifier`, `rending_multiplier`, `damage_near`, `damage_vs_ogryn_and_monsters` | Slot-agnostic damage amplification |
| `crit` | `critical_strike_chance`, `critical_strike_damage`, `melee_critical_strike_chance`, `ranged_critical_strike_chance` | Critical hit scaling |
| `toughness` | `toughness`, `toughness_damage_taken_modifier`, `toughness_damage_taken_multiplier`, `toughness_replenish_modifier`, `toughness_regen_delay` | Toughness pool and recovery |
| `damage_reduction` | `damage_taken_multiplier`, `corruption_taken_multiplier`, `block_cost_modifier`, `push_cost_modifier` | Incoming damage mitigation |
| `mobility` | `movement_speed`, `sprint_speed`, `dodge_speed`, `extra_consecutive_dodges` | Movement and positioning |
| `warp_resource` | `warp_charge_amount`, `warp_charge_block_cost`, `peril_*`, `smite_*` | Psyker warp charge economy |
| `grenade` | `extra_max_amount_of_grenades`, `grenade_*` | Grenade capacity and cooldown |
| `stamina` | `stamina_modifier`, `stamina_*` | Stamina pool and costs |
| `utility` | `coherency_radius_modifier`, `wield_speed`, `suppression_dealt`, `stagger_*` | Misc tactical utility |

**Multi-membership:** Stats can belong to multiple families. `critical_strike_chance` is in both `crit` and `general_offense`. `block_cost_modifier` is in both `stamina` and `damage_reduction`. This is intentional — it means a crit chance buff synergizes with both crit damage talents and general offense builds.

**Slot affinity:** `melee_offense` stats only matter if the build uses its melee weapon offensively. `general_offense` stats amplify whichever weapon the player uses — treated as universal amplifiers that align with either slot.

## Synergy Rules

Six declarative rules matching the issue spec:

### Rule 1: Stat-family alignment

**Input:** Two selections with `calc.effects`.
**Signal:** Both have effects in the same stat family.
**Output:** Synergy edge with strength:
- **strong (3):** Same stat family, same effect type (e.g., both `stat_buff` on `crit`)
- **moderate (2):** Same stat family, different effect types (one `stat_buff`, one `proc_stat_buff`)
- **weak (1):** Overlapping families via multi-membership only (e.g., `damage` ↔ `melee_damage` connected through `general_offense`)

### Rule 2: Slot coverage

**Input:** All selections.
**Signal:** `melee_offense` vs `ranged_offense` family presence per weapon slot.
**Output:** Coverage metric per slot — which families support it, total strength. Identifies unbuffed slots.

### Rule 3: Trigger-target chain

**Input:** Two selections with `calc.effects`.
**Signal:** A's trigger (e.g., `on_kill`) produces an action that B's condition requires, or vice versa. For example, "on melee kill → +ranged damage" + a ranged weapon.
**Output:** Synergy edge describing the chain.

### Rule 4: Keyword affinity

**Input:** A talent/buff and a weapon.
**Signal:** Talent buff's `calc.keywords` or weapon proficiency pattern matches equipped weapon's template family.
**Output:** Synergy edge (match) or anti-synergy (proficiency talent with no matching weapon).

### Rule 5: Resource flow

**Input:** All selections.
**Signal:** Producer effects (warp charge generation, grenade regen) vs consumer effects (warp charge spending, grenade use).
**Output:** Flow analysis: producers, consumers, and orphaned consumers with no producer.

### Rule 6: Orphan detection

**Input:** A selection + full build context.
**Signal:** Selection's condition or trigger has no possible activator in the build.
**Output:** Orphan entry with reason. Opaque conditions (`unknown_condition`) are reported as `unresolvable_condition` rather than guessed.

## Stat Aggregator

Build-wide coverage analysis. Not pairwise — operates over the full selection set.

**Output structure:**

```json
{
  "family_profile": {
    "<family>": { "count": 5, "total_magnitude": 1.8, "selections": ["entity.id", ...] }
  },
  "slot_balance": {
    "melee": { "families": ["melee_offense", "crit"], "strength": 8 },
    "ranged": { "families": ["general_offense"], "strength": 1 }
  },
  "build_identity": ["melee_offense", "warp_resource", "crit"],
  "coverage_gaps": ["damage_reduction"],
  "concentration": 0.72
}
```

**Family profile:** Per-family selection count, summed magnitude, and contributing selection IDs.

**Slot balance:** Partition melee vs ranged family contributions. A build with 8 melee talents and 1 ranged talent is melee-focused — the ranged weapon is a utility slot.

**Build identity:** Top 2-3 families by selection count.

**Coverage gaps:** Families the build should care about but doesn't. Heuristic rules:
- Melee-focused build → needs `toughness` or `damage_reduction`
- Warp resource consumers present → needs warp resource producers
- Crit damage buffs present → needs crit chance source

Gaps are flags, not penalties. The scoring layer (#9) decides weighting.

**Concentration:** Normalized Herfindahl index over family selection counts. High = focused build, low = spread build. Neither is inherently good or bad.

## Output Schema

Full synergy analysis output:

```json
{
  "build": "<filename>",
  "class": "<class>",
  "synergy_edges": [
    {
      "type": "stat_alignment | trigger_target | keyword_affinity",
      "selections": ["<entity_id>", "<entity_id>"],
      "families": ["<family>"],
      "strength": 1-3,
      "explanation": "<human-readable>"
    }
  ],
  "anti_synergies": [
    {
      "type": "keyword_mismatch | slot_imbalance | resource_orphan",
      "selections": ["<entity_id>"],
      "reason": "<human-readable>",
      "severity": "high | medium | low"
    }
  ],
  "orphans": [
    {
      "selection": "<entity_id>",
      "reason": "resource_consumer_without_producer | unresolvable_condition | no_trigger_source",
      "resource": "<resource_type>",
      "condition": "<condition_string>"
    }
  ],
  "coverage": {
    "family_profile": {},
    "slot_balance": {},
    "build_identity": [],
    "coverage_gaps": [],
    "concentration": 0.0
  },
  "metadata": {
    "entities_analyzed": 0,
    "entities_with_calc": 0,
    "entities_without_calc": 0,
    "opaque_conditions": 0
  }
}
```

Selection IDs are canonical entity IDs from the ground-truth index, not raw labels.

## Mapping to scorecard stubs

| Scorecard field | Synergy model source |
|----------------|---------------------|
| `blessing_synergy` | Synergy edges of type `stat_alignment` and `keyword_affinity` between weapon blessings and talents |
| `talent_coherence` | `coverage.concentration` + synergy edge density among talents |
| `role_coverage` | `coverage.build_identity` + `coverage.coverage_gaps` |
| `breakpoint_relevance` | Deferred to #5 (calculator layer) — requires numeric damage math |
| `difficulty_scaling` | Deferred — requires enemy data not in scope |

## CLI interface

```bash
npm run synergy -- scripts/builds/08-gandalf-melee-wizard.json          # human-readable
npm run synergy -- scripts/builds/08-gandalf-melee-wizard.json --json   # structured JSON
npm run synergy -- scripts/builds/                                       # batch, all builds
```

## Testing strategy

1. **Unit tests per rule:** Synthetic selections with known calc data, verify edge output. Cover each of the 6 rules.
2. **Golden output tests:** Full synergy analysis for 3-5 builds from `scripts/builds/` covering each synergy type. Frozen snapshots, re-frozen when model changes.
3. **Stat family coverage test:** Verify all 156 known stats are mapped. Fail on unmapped stats appearing in entity data.

## Dependencies

- **Depends on:** #7 (buff semantic extraction — `calc.effects` data)
- **Blocks:** #9 (build scoring — consumes synergy edges + coverage), #10 (modification recommendations — consumes synergy analysis for swap evaluation)

## Out of scope

- Numeric damage calculation (that's #5)
- Build quality scoring (that's #9 — consumes this model)
- User-facing recommendations (that's #10)
- PvP or difficulty-specific weighting
- Resolving the 68 opaque conditions (separate extraction improvement)
