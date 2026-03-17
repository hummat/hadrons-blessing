# Build Quality Scoring (#9) and Modification Recommendations (#10)

## Overview

Two modules that answer "is this build good?" and "what should I change?" Both consume the synergy model output from #8.

**#9** fills three of five qualitative null stubs in `generateScorecard()` with synergy-backed 1–5 scores. Two dimensions (`breakpoint_relevance`, `difficulty_scaling`) remain null until #5 provides damage formulas.

**#10** adds three recommendation operations: gap analysis, talent swap, and weapon swap. Each produces structured JSON with a formatter layer for text/markdown output. A fourth operation (`suggest-improvement`, brute-force candidate enumeration) is deferred to v1.1.

## Design Decisions

- **7 original rubric dimensions preserved.** Issue #9 mentioned `weapon_talent_fit` as a potential 4th dimension, but investigation showed weapon entities have zero `calc.effects` — the weapon-talent signal is entirely captured by blessing-talent synergy edges and slot balance. Adding a separate dimension would double-count.
- **Three dimensions partition the signal space cleanly.** Blessing-involved edges are ~96% offense families; talent-only edges split between defense and offense. No overlap or double-counting.
- **Scoring in a separate module from `score-build.mjs`.** The existing file (843 lines) mixes mechanical scoring with weapon resolution. Synergy-based scoring has different inputs (synergy output, not perk tier tables). New module keeps each file under 500 lines.
- **Recommendations import scoring as a library.** One-directional dependency: recommendations → scoring. Scoring has no knowledge of recommendations. Each recommendation function internally runs the full synergy → scoring → diff pipeline.
- **Structured JSON core + formatter layer.** Same pattern as `report-build.mjs` + `report-formatter.mjs`. Serves both CLI users and future website (#6).

## #9 — Build Quality Scoring

### Module

`scripts/ground-truth/lib/build-scoring.mjs`

### API

```js
/**
 * @param {object} synergyOutput — return value of analyzeBuild()
 * @returns {{
 *   talent_coherence:  { score: number, breakdown: object, explanations: string[] },
 *   blessing_synergy:  { score: number, breakdown: object, explanations: string[] },
 *   role_coverage:     { score: number, breakdown: object, explanations: string[] },
 * }}
 */
export function scoreFromSynergy(synergyOutput) { ... }
```

### Scoring Formulas

#### `talent_coherence` (1–5) — internal talent tree consistency

Primary signal: talent-talent synergy edge density.

- Count synergy edges where both participants are talents or stat_nodes (not blessings, not gadget traits).
- Compute `edges_per_talent = talent_edges / talent_count`.
- Map to 1–5 via thresholds calibrated from the 23-build corpus (range: 1–23 talent-talent edges, median ~10).
- Penalty: each orphaned talent costs 0.5 points.
- Bonus: concentration (NHHI) > 0.06 adds 0.5 — rewards focused archetypes.
- Clamp to [1, 5], round to nearest integer.

Breakdown: `{ talent_edges, talent_count, edges_per_talent, orphan_count, concentration, penalties, bonuses }`.

Explanations reference specific entity names: "psyker_warp_charge_reduces_toughness_damage_taken and psyker_combat_ability_stance both contribute to toughness family".

#### `blessing_synergy` (1–5) — weapon loadout alignment with archetype

Primary signal: blessing-X synergy edge density.

- Count synergy edges where at least one participant is a blessing.
- Compute `edges_per_blessing = blessing_edges / blessing_count`.
- Typical builds have 4 blessings; range across 23 builds is 2–16 blessing edges.
- Bonus: blessing-blessing edges exist (+0.5) — blessings amplify each other.
- Penalty: orphaned blessings with zero synergy edges (-1 each).
- Clamp to [1, 5].

Breakdown: `{ blessing_edges, blessing_count, edges_per_blessing, blessing_blessing_edges, orphaned_blessings }`.

#### `role_coverage` (1–5) — offense/defense/utility spread

Primary signal: active stat family count out of 11.

- Map family count to base score: 9+ → 5, 7–8 → 4, 5–6 → 3, 3–4 → 2, <3 → 1.
- Penalty: each `coverage_gap` costs 1 point.
- Penalty: severe slot imbalance (min/max ratio < 0.3) costs 1 point.
- Clamp to [1, 5].

Breakdown: `{ active_families, total_families, coverage_gaps, slot_balance_ratio }`.

### Integration with `score-build.mjs`

`generateScorecard()` gains an optional second parameter for pre-computed synergy output. If not provided, it runs `analyzeBuild()` internally. The three `qualitative` fields get populated. `breakpoint_relevance` and `difficulty_scaling` remain null.

Composite score = sum of all non-null dimensions. Letter grade computed from the sum, scaled proportionally to /35 (i.e., if only 5 of 7 dimensions are scored, the /25 sum is mapped to the /35 grade scale).

## #10 — Modification Recommendations

### Module

`scripts/ground-truth/lib/build-recommendations.mjs`

### Operations

#### `analyzeGaps(build, index)` — "What's missing from this build?"

Reads the synergy model's coverage data. Reports which defensive/offensive/utility families are absent or weak, and what the slot balance looks like.

Output:
```js
{
  gaps: [
    { type: "survivability",
      reason: "melee-primary with no toughness/DR investment",
      suggested_families: ["toughness", "damage_reduction"] },
    { type: "slot_imbalance",
      reason: "ranged slot unbuffed (mel=11, rng=2)",
      suggested_families: ["ranged_offense"] },
  ],
  underinvested_families: ["stamina"],  // active but <=1 selection
  scorecard: { ... }
}
```

No tree traversal needed — read-only analysis of the existing build.

#### `swapTalent(build, index, oldId, newId)` — "What happens if I swap talent A for talent B?"

Pipeline: clone build → validate tree reachability → replace talent → re-run synergy → re-score → diff.

Tree reachability validation:
1. Find the new talent's tree node via `belongs_to_tree_node` edges.
2. Walk `parent_of` edges upward — every ancestor must either be in the build or be the root.
3. Check `exclusive_with` edges — new talent can't conflict with remaining selections.
4. If unreachable, return `{ valid: false, reason: "..." }`.

Output when valid:
```js
{
  valid: true,
  score_delta: { talent_coherence: +1, blessing_synergy: 0, role_coverage: 0, composite: +1 },
  gained_edges: [ ... ],
  lost_edges: [ ... ],
  resolved_orphans: ["psyker.talent.psyker_block_costs_warp_charge"],
  new_orphans: [],
}
```

#### `swapWeapon(build, index, oldId, newId)` — "What happens if I swap this weapon for that one?"

Same pipeline as `swapTalent`, but the modification cascades:
1. Replace weapon entity ID.
2. Clear old blessings (they belong to the old weapon's trait pool).
3. Carry over blessings if the new weapon shares the same trait pool (`weapon_has_trait_pool` edges in shared.json) — otherwise mark blessings as removed.
4. Re-run synergy → re-score → diff.

Output adds `blessing_impact`:
```js
{
  valid: true,
  score_delta: { ... },
  blessing_impact: {
    retained: ["shared.name_family.blessing.brutal_momentum"],
    removed: ["shared.name_family.blessing.skullcrusher"],
    available: [...]  // new weapon's full trait pool
  },
  gained_edges: [...],
  lost_edges: [...],
}
```

No tree reachability check needed — weapons are not constrained by the talent tree.

### Formatter

`scripts/ground-truth/lib/recommend-formatter.mjs` — text/markdown/json output modes, same pattern as `report-formatter.mjs`.

## File Layout

### New files
- `scripts/ground-truth/lib/build-scoring.mjs` — scoring logic
- `scripts/ground-truth/lib/build-recommendations.mjs` — gap analysis + swap operations
- `scripts/ground-truth/lib/recommend-formatter.mjs` — output formatting
- `scripts/recommend-build.mjs` — CLI entry point

### Modified files
- `scripts/score-build.mjs` — imports `build-scoring.mjs`, fills qualitative stubs

## CLI Surface

```bash
npm run score -- <build.json> [--json]                                    # enhanced with qualitative scores
npm run recommend -- analyze-gaps <build.json>                            # coverage gap diagnosis
npm run recommend -- swap-talent <build.json> --from <id> --to <id>       # talent swap delta
npm run recommend -- swap-weapon <build.json> --from <id> --to <id>       # weapon swap delta
```

All commands support `--json` for structured output, default is human-readable text.

## Test Plan

- Golden score outputs for 5+ builds (frozen snapshots, same pattern as synergy tests)
- Regression tests confirming existing perk_optimality and curio_efficiency scores unchanged
- Talent swap tests: 3+ scenarios with known expected deltas
- Weapon swap tests: 2+ scenarios including blessing cascade
- Tree reachability validation: valid swap, unreachable parent, exclusivity conflict
- `make check` passes

## Deferred

- `suggest-improvement` operation (brute-force candidate enumeration) — v1.1
- `breakpoint_relevance` and `difficulty_scaling` scoring — blocked on #5
- Scoring threshold tuning — initial thresholds from 23-build corpus, refine with user feedback
- Per-class weight adjustments (rubric documents class-specific emphasis) — future enhancement

## Dependencies

- Depends on: #8 (synergy model), #7 (buff semantics)
- Blocks: none (scoring + recommendations are leaf features)
- Related: #3 (CLI can surface scores/recommendations), #6 (website consumes JSON output)
