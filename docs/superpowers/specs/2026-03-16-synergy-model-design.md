# Synergy Model Design

**Issue:** #8
**Date:** 2026-03-16
**Status:** Implemented

## Problem

The buff semantic extraction (#7) populated `calc.effects` on 435 entities with 551 structured effects. The next question is: "do these talents/blessings/weapons work well together?" There is no synergy analysis anywhere in the codebase — `score-build.mjs` has null stubs for `blessing_synergy`, `talent_coherence`, `role_coverage`, and other qualitative scores.

This model bridges raw buff data (#7) and user-facing scoring (#9) / recommendations (#10).

## Background: available signals

| Signal | Count | Source |
|--------|-------|--------|
| Entities with `calc.effects` | 435 of 1735 | `data/ground-truth/entities/` |
| Top-level effects | 551 | across 4 populated effect types |
| Unique stat names | 144 | `calc.effects[].stat` (including tier effects) |
| Unique triggers | 13 | `calc.effects[].trigger` |
| `grants_buff` edges | 385 | `data/ground-truth/edges/` |
| Weapon traits with tiers | 44 (31 with non-empty tier effects) | `shared-weapons.json` |
| Buff keywords | 8 unique values | `calc.keywords` |

**Effect types in use:** `stat_buff` (332), `conditional_stat_buff` (100), `proc_stat_buff` (79), `lerped_stat_buff` (40). Two schema-declared types (`stepped_stat_buff`, `conditional_lerped_stat_buff`) have zero instances.

## Coverage reality

Calc coverage varies dramatically by entity kind. The synergy model must be honest about what it can and cannot see.

### Per-kind calc coverage

| Entity kind | With calc | Total | Rate |
|-------------|-----------|-------|------|
| Talent (stat-node `base_*`) | 44 | 44 | 100% |
| Talent (named gameplay) | 135 | 284 | 48% |
| Buff | 198 | 388 | 51% |
| Weapon trait (top-level effects) | 10 | 54 | 19% |
| Weapon trait (non-empty tier effects) | 31 | 44 w/ tiers | 70% |
| Gadget trait | 14 | 14 | 100% |
| Ability | 5 | 38 | 13% |
| Keystone | 6 | 21 | 29% |
| Aura | 1 | 19 | 5% |
| Talent modifier | 19 | 136 | 14% |
| Weapon perk | 3 | 15 | 20% |
| Weapon | 0 | 48 | 0% |
| Name family (blessing label) | 0 | 46 | 0% |
| Stat node (family-level) | 0 | 14 | 0% |

Notable: gadget traits have 100% calc coverage. Named gameplay talents are at 48% — better than expected, though the other half includes important proc-based talents.

### Per-build effective coverage

For build 08 (psyker, 52 resolved selections): **21 selections (40%) have usable calc.effects.** Composition by field:

| Field | With calc | Without calc |
|-------|-----------|-------------|
| ability + blitz | 2 | 0 |
| aura + keystone | 0 | 2 |
| talents | 7 | 19 |
| blessings (name_family) | 0 | 4 |
| weapon names | 0 | 2 |
| weapon perks | 0 | 4 |
| curio perks (gadget_trait) | 12 | 0 |

The 21 include: 12 curio perks (gadget_traits, 100% coverage), 7 talents (mix of base_* stat nodes and named gameplay talents with calc), ability, and blitz. The 31 without calc are primarily named gameplay talents (19), blessings (4), weapon entities, and weapon perks.

### Edge traversal adds nothing

Investigation confirmed that `grants_buff` edges are dead-ends for calc discovery:
- Stat-node `base_*` buffs have effects that are **identical** to the talent's own calc — traversal adds no new data.
- Named talent → buff chains terminate at buff entities with **empty calc** — the extraction pipeline didn't parse their complex Lua patterns.

Blessing traversal (`name_family` ← `instance_of` ← `weapon_trait`) coverage depends on whether tier effects are included:
- Top-level `calc.effects` only: 8 of 46 name_families (17%)
- Including `calc.tiers` with non-empty tier effects: 27 of 46 name_families (59%)

Since the model treats tier effects as valid calc data (see per-kind table), blessing traversal is a viable path for 59% of blessing families. Build 08 specifically: 1 of 4 blessings reachable (the others' weapon_trait instances lack both top-level and tier effects).

### Stat-node family resolution gap

Builds store family-level IDs (`shared.stat_node.toughness_boost`) but calc lives on per-class instances (`psyker.talent.base_toughness_node_buff_medium_4`). The synergy model resolves families by looking up per-class talent entities whose `attributes.family` matches the stat_node's family identifier. This retrieves representative magnitudes for stat-node selections that would otherwise appear as dead-ends.

### Implication for design

The model operates on ~40% of build selections directly. This breaks into two categories:
1. **Gadget traits and base_* stat-node talents** — high-coverage entity kinds that define the build's numerical stat profile (toughness, damage, crit, etc.)
2. **Named gameplay talents with calc** — about half of named talents have extracted effects, covering simpler proc and stat-buff behaviors

The stat-node family resolution strategy (above) fills in stat-node family IDs that would otherwise be dead-ends, improving effective coverage for the stat aggregator.

Named gameplay talents without calc (the other ~52%) are primarily complex proc-based talents whose Lua patterns the extraction pipeline couldn't fully parse. The model reports these honestly via metadata and does not guess at their effects.

All analysis outputs include `metadata.entities_with_calc`, `metadata.entities_without_calc`, and `metadata.calc_coverage_pct` so downstream consumers know the confidence level.

### Duplicate selection handling

Builds may contain the same entity ID multiple times (e.g., the same gadget_trait across 3 curios). The model **deduplicates by entity ID** before running rules and aggregation — a trait appearing on 3 curios represents one distinct effect source, not three. The metadata reports both `entities_analyzed` (pre-dedup) and `unique_entities_with_calc` (post-dedup).

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
  synergy-rules.mjs          # 5 rule implementations (pure functions)
  synergy-stat-families.mjs  # STAT_FAMILIES map + family lookup helpers
scripts/
  analyze-synergy.mjs        # CLI entry point
```

### Module responsibilities

**`synergy-stat-families.mjs`** — Static mapping of all 144 known stat names to 11 stat families. Each stat maps to a set of family names. Stats can belong to multiple families (multi-membership). Unmapped stats are flagged as `uncategorized`.

**`synergy-rules.mjs`** — Five rule implementations, each a pure function: `(selections, index) → edges[]`. Rules run independently, no rule depends on another's output.

**`synergy-model.mjs`** — Orchestrates:
1. Loads build + index (entities, edges)
2. Resolves selections to entities
3. For stat_node family IDs, resolves to per-class instances to retrieve calc data (see "Stat-node family resolution gap")
4. For blessing selections (name_family entities), traverses `instance_of` edges to weapon_trait instances and uses tier-4 effects as representative calc values (59% of blessing families reachable)
5. For all other entities, uses direct `calc.effects` — `grants_buff` traversal is skipped (adds nothing, see above)
6. Runs all rules, runs stat aggregation, assembles output

**`analyze-synergy.mjs`** — CLI: `npm run synergy -- <build.json> [--json]`. Default human-readable text output. `--json` for structured output. Supports batch mode on directories.

## Stat Family Taxonomy

11 families grouping all 144 known stat names by combat role:

| Family | Representative stats | Purpose |
|--------|---------------------|---------|
| `melee_offense` | `melee_damage`, `melee_attack_speed`, `melee_heavy_damage`, `melee_weakspot_damage`, `melee_power_level_modifier` | Melee damage output |
| `ranged_offense` | `ranged_damage`, `ranged_attack_speed`, `reload_speed`, `recoil_modifier`, `spread_modifier`, `ammo_reserve_capacity`, `clip_size_modifier` | Ranged damage output |
| `general_offense` | `damage`, `power_level_modifier`, `rending_multiplier`, `damage_near`, `damage_vs_ogryn_and_monsters` | Slot-agnostic damage amplification |
| `crit` | `critical_strike_chance`, `critical_strike_damage`, `melee_critical_strike_chance`, `ranged_critical_strike_chance` | Critical hit scaling |
| `toughness` | `toughness`, `toughness_damage_taken_modifier`, `toughness_damage_taken_multiplier`, `toughness_replenish_modifier`, `toughness_regen_delay` | Toughness pool and recovery |
| `damage_reduction` | `damage_taken_multiplier`, `corruption_taken_multiplier`, `block_cost_multiplier`, `push_cost_modifier` | Incoming damage mitigation |
| `mobility` | `movement_speed`, `sprint_speed`, `dodge_speed`, `extra_consecutive_dodges` | Movement and positioning |
| `warp_resource` | `warp_charge_amount`, `warp_charge_block_cost`, `peril_*`, `smite_*` | Psyker warp charge economy |
| `grenade` | `extra_max_amount_of_grenades`, `grenade_*` | Grenade capacity and cooldown |
| `stamina` | `stamina_modifier`, `stamina_*` | Stamina pool and costs |
| `utility` | `coherency_radius_modifier`, `wield_speed`, `suppression_dealt`, `stagger_*` | Misc tactical utility |

**Multi-membership:** Stats can belong to multiple families. `critical_strike_chance` is in both `crit` and `general_offense`. `block_cost_multiplier` is in both `stamina` and `damage_reduction`. This is intentional — it means a crit chance buff synergizes with both crit damage talents and general offense builds.

**Slot affinity:** `melee_offense` and `ranged_offense` are slot-specific families. `general_offense` stats amplify whichever weapon the player uses — treated as universal amplifiers. `slot_balance` (see Stat Aggregator) only counts `melee_offense` and `ranged_offense` in their respective slots; `general_offense` contributes to both; `crit` contributes to both; other families (`toughness`, `mobility`, etc.) are slot-independent and not counted in slot balance.

## Synergy Rules

Five declarative rules. Rule 4 (keyword affinity) from the issue is deferred — see "Deferred: Keyword affinity" below.

### Rule 1: Stat-family alignment

**Input:** Two selections with `calc.effects`.
**Signal:** Both have effects in the same stat family.
**Output:** Synergy edge with strength:
- **strong (3):** Same stat family, same effect category. Categories: "persistent" (`stat_buff`, `conditional_stat_buff`) and "dynamic" (`proc_stat_buff`, `lerped_stat_buff`). Two persistent buffs on the same family = strong.
- **moderate (2):** Same stat family, different effect categories (one persistent, one dynamic).
- **weak (1):** Overlapping families via multi-membership only (e.g., `damage` ↔ `melee_damage` connected through `general_offense`)

### Rule 2: Slot coverage

**Input:** All selections.
**Signal:** `melee_offense` vs `ranged_offense` family presence per weapon slot.
**Output:** Coverage metric per slot — which families support it, total strength. Identifies unbuffed slots and slot imbalance.

### Rule 3: Trigger-target chain

**Input:** Two selections with `calc.effects`.
**Signal:** A's trigger (e.g., `on_kill`) produces an action that B's condition requires, or vice versa. For example, "on melee kill → +ranged damage" + a ranged weapon.
**Output:** Synergy edge describing the chain.

**Feasibility note:** The current condition vocabulary is sparse — only `wielded`, `slot_secondary`, and `threshold:*` variants are resolved; the remaining 68 are opaque. Productive trigger→condition pairings in v1 are limited:
- `threshold:warp_charge` conditions pair with any trigger that co-occurs with `warp_charge_amount` stat effects (producer triggers)
- `slot_secondary` condition pairs with selections that reference the secondary weapon slot
- `wielded` is always-true when the weapon is held — no trigger pairing needed

Beyond these, this rule will primarily detect **trigger co-occurrence** (two selections sharing the same trigger type, suggesting they activate in the same gameplay moment) rather than formal trigger→condition chains. Full chain analysis requires enriching condition semantics in a future extraction pass.

### Rule 4: Resource flow

**Input:** All selections.
**Signal:** Producer effects (warp charge generation, grenade regen) vs consumer effects (warp charge spending, grenade use). Resource types: `warp_charge`, `grenade`, `stamina`.
**Classification:** Effects are classified by stat name prefix and magnitude sign. Positive magnitude on a resource stat (e.g., `warp_charge_amount: +0.25`) = producer/capacity increase. Negative magnitude or cost-type stats (e.g., `warp_charge_block_cost`) = consumer. Stats are mapped to resource types by prefix: `warp_charge_*` → `warp_charge`, `grenade_*` / `extra_max_amount_of_grenades` → `grenade`, `stamina_*` → `stamina`.
**Output:** Flow analysis: producers, consumers, and orphaned consumers with no producer. Resource orphans are routed to the `orphans[]` output array (not `anti_synergies[]`).

### Rule 5: Orphan detection

**Input:** A selection + full build context.
**Signal:** Selection's condition or trigger has no possible activator in the build.
**Output:** Orphan entry with reason. Opaque conditions (`unknown_condition`) are reported as `{ reason: "unresolvable_condition" }` rather than guessed.

### Deferred: Keyword affinity (issue #8 Rule 4)

The issue describes weapon-proficiency keyword matching (`bolter_proficiency` ↔ `bolter`). Investigation revealed:
- The 8 existing `calc.keywords` are mechanical behavior flags (`allow_backstabbing`, `stun_immune`, etc.), not weapon-family proficiency markers.
- Zero entities contain "proficiency" in any field.
- No `weapon_affinity` attribute or edge type exists in the data.

This rule requires new data modeling work: either explicit proficiency→weapon_family mappings in ground-truth data, or investigation of the decompiled source for how proficiency talents are encoded. Deferred to a follow-up.

## Stat Aggregator

Build-wide coverage analysis. Not pairwise — operates over the full selection set.

**Output structure:**

```json
{
  "family_profile": {
    "<family>": { "count": 5, "total_magnitude": 1.8, "selections": ["entity.id", "..."] }
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

**Family profile:** Per-family selection count, summed magnitude (where numeric magnitude is available), and contributing selection IDs.

**Slot balance:** Counts `melee_offense` contributions in `melee`, `ranged_offense` in `ranged`. `general_offense` and `crit` contribute to both slots. Other families are slot-independent and excluded from slot_balance. The `strength` value is the count of unique selections contributing to that slot via the listed families.

**Build identity:** Top 2-3 families by selection count, forming a human-readable build archetype label.

**Coverage gaps:** Families the build should care about but doesn't. Defined as predicates:
- **Missing survivability:** `build_identity` includes `melee_offense` as top family AND `family_profile.toughness.count == 0` AND `family_profile.damage_reduction.count == 0` → gap: `"toughness"` or `"damage_reduction"`
- **Missing crit source:** `family_profile.crit.count > 0` AND no selection has `critical_strike_chance` stat → gap: `"crit_chance_source"`
- **Missing resource producer:** `warp_resource` consumers present (effects with `warp_charge` stat that decrease it or conditions requiring it) AND no warp_charge producers → gap: `"warp_charge_producer"`

Gaps are flags, not penalties. The scoring layer (#9) decides weighting.

**Concentration:** Normalized Herfindahl–Hirschman Index (NHHI) over family selection counts.

Formula: `NHHI = (HHI - 1/N) / (1 - 1/N)` where `HHI = Σ(count_i / total)²` and N = number of families with at least one selection.

Multi-membership: a selection contributing effects to K families is counted once in each of those K families. `total` is the sum of all family counts (not the number of unique selections).

Range: 0 (maximally spread) to 1 (all effects in one family). Neither extreme is inherently good or bad.

## Output Schema

Full synergy analysis output:

```json
{
  "build": "<filename>",
  "class": "<class>",
  "synergy_edges": [
    {
      "type": "stat_alignment | trigger_target",
      "selections": ["<entity_id>", "<entity_id>"],
      "families": ["<family>"],
      "strength": 1,
      "explanation": "<human-readable>"
    }
  ],
  "anti_synergies": [
    {
      "type": "slot_imbalance",
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
    "unique_entities_with_calc": 0,
    "entities_without_calc": 0,
    "opaque_conditions": 0,
    "calc_coverage_pct": 0.0
  }
}
```

Selection IDs are canonical entity IDs from the ground-truth index, not raw labels.

**Routing rule:** Resource orphans (from Rule 4: resource flow) go in `orphans[]`. `anti_synergies[]` is reserved for structural conflicts where selections are present and conflicting (e.g., slot imbalance — heavy melee buffing with an unbuffed ranged weapon the build relies on).

## Mapping to scorecard stubs

| Scorecard field | Synergy model source | Status |
|----------------|---------------------|--------|
| `talent_coherence` | `coverage.concentration` + synergy edge density among talent selections | **Achievable** — stat-node talents have calc |
| `role_coverage` | `coverage.build_identity` + `coverage.coverage_gaps` | **Achievable** — family profile from available calc |
| `blessing_synergy` | Synergy edges between blessing effects and talent effects, via `instance_of` → weapon_trait tier traversal | **Partial** — 27/46 blessing families (59%) reachable via tier effects. The model traverses `instance_of` edges from name_family to weapon_trait instances and uses tier-4 effects as representative values. Remaining 41% of blessings have no extractable effects. |
| `breakpoint_relevance` | Requires numeric damage math | **Deferred** to #5 (calculator layer) |
| `difficulty_scaling` | Requires enemy data | **Deferred** — not in scope |

The model does not produce a top-level "overall coherence score." That synthesis is the responsibility of #9 (build scoring), which combines synergy signals with other factors. This model provides the raw signals: edges, orphans, coverage metrics.

## CLI interface

```bash
npm run synergy -- scripts/builds/08-gandalf-melee-wizard.json          # human-readable
npm run synergy -- scripts/builds/08-gandalf-melee-wizard.json --json   # structured JSON
npm run synergy -- scripts/builds/                                       # batch, all builds
```

## Testing strategy

1. **Unit tests per rule:** Synthetic selections with known calc data, verify edge output. Cover each of the 5 rules plus orphan detection.
2. **Golden output tests:** Full synergy analysis for 3-5 builds from `scripts/builds/` covering each synergy type. Frozen snapshots, re-frozen when model changes.
3. **Stat family coverage test:** Verify all 138 known stats are mapped. Fail on unmapped stats appearing in entity data.

## Requirements traceability

Issue #8 acceptance criteria vs spec coverage:

| Criterion | Status | Spec coverage |
|-----------|--------|--------------|
| Identify stat-family alignment between any two selections | **Met** | Rule 1 (stat-family alignment) |
| Detect orphaned talents (condition can never fire) | **Met** | Rule 5 (orphan detection) |
| Detect weapon keyword mismatches | **Deferred** | Keyword affinity rule dropped from v1 — no proficiency data in current index (see Deferred section) |
| Structured output consumable by #9 and #10 | **Met** | Output schema with typed edges, orphans, coverage metrics |

## Dependencies

- **Depends on:** #7 (buff semantic extraction — `calc.effects` data)
- **Blocks:** #9 (build scoring — consumes synergy edges + coverage), #10 (modification recommendations — consumes synergy analysis for swap evaluation)

## Out of scope

- Numeric damage calculation (that's #5)
- Build quality scoring (that's #9 — consumes this model)
- User-facing recommendations (that's #10)
- PvP or difficulty-specific weighting
- Resolving the 68 opaque conditions (separate extraction improvement)
- Weapon-proficiency keyword affinity (requires data modeling work — see Deferred section)
