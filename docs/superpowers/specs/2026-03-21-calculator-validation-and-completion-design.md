# Calculator Validation and Completion Design

Issues: #11, #12, #13

## Problem

The damage calculator (#5) implements a 13-stage pipeline from the attacker perspective and is in production use across 22/23 builds. However, three gaps remain:

1. **Validation gap:** The pipeline has never been systematically smoke-tested for suspicious values across all builds. Known bugs (Build 14 shield crash, lerp factor hardcode, difficulty_health fallback ambiguity) are documented but unfixed.
2. **Unused extracted data:** `profiles:build` already extracts `power_distribution.impact`, `stagger_category`, and `cleave_distribution` on every profile, but the calculator only consumes `power_distribution.attack`. This data is ready to power stagger (#12) and cleave (#13) calculators.
3. **Missing defender-side:** Stages 10/12/13 (force field, toughness/health split, final application) are deferred no-ops. Toughness/survivability (#11) needs new data extraction.

## Decision Record

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Approach | Validation-gated extension | Smoke test first to assess data quality; extend only where data is ready; evidence-based scoping |
| Extension order | #12 stagger → #13 cleave → #11 toughness | Ordered by data readiness: impact/stagger data already extracted, cleave needs only hit_mass, toughness needs most new extraction |
| Scoring integration | Stagger + cleave yes, toughness deferred | Stagger/cleave map to natural checklist entries; toughness needs a new `survivability` dimension that requires its own design |
| Completion bar | Core computation + CLI for all three; scoring for #12 and #13 | Matches existing `calc` CLI pattern; toughness scoring deferred to website phase |

## Architecture Overview

```
Phase 1: Validation & Data Quality Report
  calculator-validation.test.mjs     ← structured smoke test + data audit
  Output: pass/fail per field category (damage, impact, cleave)

Phase 2: Foundation Fixes
  damage-calculator.mjs              ← fix known bugs (Build 14, lerp, difficulty_health)
  Re-freeze calc snapshots

Phase 3: Extensions (gated by Phase 1 results)
  #12  stagger-calculator.mjs        ← impact pipeline + stagger thresholds
       extract-breed-data.mjs        ← extend: stagger resistance per breed
       New extraction: stagger_settings.lua → stagger threshold tables
  #13  cleave-calculator.mjs         ← cleave budget simulation
       extract-breed-data.mjs        ← extend: hit_mass per breed
  #11  toughness-calculator.mjs      ← defender-side stages 10/12/13
       New extraction: class base stats (HP, toughness, wounds)

CLI (all three):
  npm run stagger  -- <build.json> [--text|--json]
  npm run cleave   -- <build.json> [--text|--json]
  npm run toughness -- <build.json> [--text|--json]
```

## Phase 1: Validation & Data Quality Report

### Test Structure

New test file `calculator-validation.test.mjs` with four audit categories:

**1. Damage pipeline sanity (all 23 builds):**
- No NaN or negative damage values in `computeBreakpoints` output
- No unexpected Infinity HTK — distinguish "data missing" (breed lacks difficulty_health) from "damage negated" (ADM = 0)
- Every weapon in a build resolves to an action map with at least one profile
- Every breed in the breakpoint checklist has valid difficulty_health for all 5 difficulty levels
- HTK values are plausible (1–200 range)
- Build 14 specifically: characterize the shield weapon failure mode

**2. Impact/stagger data audit (field-level, not computation):**
- Every profile with `power_distribution.attack` also has `power_distribution.impact` (or explicitly zero)
- `stagger_category` is present and is a known enum value on every profile
- Impact values are positive numbers, not NaN
- Report: count of profiles with impact data, count without

**3. Cleave data audit:**
- Every profile has `cleave_distribution.{attack, impact}`
- Cleave preset references all resolve to known presets (no dangling references)
- Report: whether `hit_mass` exists in breed data (expected: no — confirms extraction gap for #13)

**4. Known bug surface:**
- Build 14: capture the specific error and affected weapon/action
- Lerp factor audit: count of `lerped_stat_buff` effects across all 23 builds; list which lerp variables are referenced
- difficulty_health coverage: breed × difficulty matrix, flag any gaps

### Output

Test results serve as the data quality report. Per category:
- Green → data is ready for that extension
- Failures → specific items to fix in Phase 2, or blockers for Phase 3

## Phase 2: Foundation Fixes

### Fix 1: Build 14 Shield Weapon Crash

**Root cause:** Action map for `shotpistol_shield_p1_m1` contains null profile references. `computeBreakpoints` attempts to resolve the profile and throws.

**Fix:** In `computeBreakpoints`, skip null/undefined profile references with a warning in the result metadata (analogous to how unresolved weapons are already skipped). The weapon still appears in output but with `{ skipped: true, reason: "null profile reference" }` on affected actions.

**Test:** Build 14 gets a golden snapshot. The `calc:freeze` skip logic is removed.

### Fix 2: difficulty_health Fallback Ambiguity

**Root cause:** `difficulty_health?.[difficulty] ?? 0` produces `hitsToKill = Infinity` for both "breed lacks data for this difficulty" and "damage is zero/negated."

**Fix:** Separate the two cases:
- Missing difficulty_health → `hitsToKill: null` (data absent, not computable)
- Damage ≤ 0 or HP > 0 with zero effective damage → `hitsToKill: Infinity` (genuinely unkillable)

Downstream consumers (`summarizeBreakpoints`, `breakpoint-checklist.mjs`, scoring) treat `null` as "excluded from analysis" rather than penalizing.

### Fix 3: Lerp Factor Hardcode

**Assessment:** Audit Phase 1 results to determine which lerp variables exist. If `warp_charge` is the only lerp variable in practice across all 23 builds, document as intentional and add a comment. If others exist (e.g., `peril`, `charge_level`), resolve the lerp factor from the buff template's condition field rather than hardcoding.

### Fix 4: Stage 5 Finesse (Conditional)

**Assessment:** Check whether any profile in the 23 builds uses non-default `boost_curve_multiplier_finesse`. If none do, document as deferred with no practical impact. If some do, implement the missing finesse buff multiplier path.

### Fix 5: Stage 8 Target-Side Buffs

**Decision:** Document as intentional limitation. Static analysis models the attacker's build — there is no "target build" to query for target-side armor-type buffs. This is correct behavior for breakpoint analysis.

### Snapshot Refresh

After all fixes, re-freeze calc snapshots (`npm run calc:freeze`) and update golden tests. Build 14 now included.

## Phase 3: Calculator Extensions

### #12 Stagger Calculator

**Purpose:** Given a weapon action, determine whether it can stagger specific enemies and to what tier (light/medium/heavy/stun). Answers "can this weapon interrupt a Crusher overhead?"

**Data extraction — new:**
- `stagger_settings.lua` → stagger threshold tables: per stagger type, the impact comparison value required
- `breed stagger resistance` → per breed, the stagger resistance modifier (from breed definitions)

**Data extraction — extend `breeds:build`:**
- Add `stagger_resistance` field to each breed record in `breed-data.json`

**Computation (`stagger-calculator.mjs`):**
1. Compute impact power: same scaling curve as `powerLevelToDamage` but using `power_distribution.impact` instead of `.attack`
2. Apply impact buff multipliers from buff stack (analogous to stage 2 for damage)
3. Look up `stagger_strength_output[armor_type]` from constants to get stagger strength
4. Apply rending's 2× stagger strength modifier if applicable
5. Compare stagger strength against breed thresholds (adjusted by breed stagger resistance)
6. Classify result: none / light / medium / heavy / stun

**Output shape:**
```json
{
  "weapon": "...",
  "actions": {
    "light_1": {
      "stagger_results": {
        "renegade_berzerker": { "tier": "medium", "strength": 4.2, "threshold": 3.0 },
        "chaos_ogryn_executor": { "tier": "none", "strength": 4.2, "threshold": 8.0 }
      }
    }
  }
}
```

**CLI:** `npm run stagger -- <build.json> [--text|--json|--batch]`

**Scoring integration:** Add stagger checklist entries to `breakpoint-checklist.json`:
- "Stagger Crusher overhead" (high weight) — the marquee melee breakpoint
- "Stagger Rager attack" (medium weight)
- "Stagger Mauler heavy" (medium weight)

These feed into `breakpoint_relevance` as a stagger sub-category, or into a new `stagger_utility` dimension if the checklist grows large enough to warrant separation.

**Tests:** Unit tests for the impact pipeline stages. Golden snapshots for all 23 builds. Integration with scoring tests.

### #13 Cleave Multi-Target Simulation

**Purpose:** Given a weapon's melee sweep, determine how many enemies it hits and kills in a single swing against realistic horde compositions. Answers "how efficient is this weapon at horde clear?"

**Data extraction — extend `breeds:build`:**
- Add `hit_mass` per breed from `minion_difficulty_settings.lua` (flat lookup table mapping breed category to hit mass values per difficulty level)

**Computation (`cleave-calculator.mjs`):**
1. Resolve cleave budget: lerp `cleave_distribution.attack` by quality (same as damage profile quality lerp)
2. For each target in composition (ordered by hit mass, lightest first — game processes front-to-back):
   a. Subtract target's hit mass from remaining cleave budget
   b. If budget exhausted, stop — remaining targets not hit
   c. Compute per-target damage using `targets[n]` override from damage profile (different power distribution and ADM for subsequent targets), falling back to primary target stats
   d. Compare damage to target HP → killed yes/no
3. Output: targets hit, targets killed, damage per target

**Horde compositions:** Defined as arrays of breed IDs representing realistic Darktide horde spawns. Sourced from `minion_difficulty_settings.lua` horde composition tables if available, otherwise assembled from the breed categories present in the game's horde spawn logic. Faction-appropriate mixes (renegade melee/ranged mix, chaos mix with groaners, poxwalkers, etc.).

**Output shape:**
```json
{
  "weapon": "...",
  "actions": {
    "heavy_1": {
      "cleave_budget": 5.2,
      "compositions": {
        "mixed_renegade_horde": {
          "targets_hit": 4,
          "targets_killed": 3,
          "per_target": [
            { "breed": "renegade_melee", "hit_mass": 1.0, "damage": 450, "hp": 380, "killed": true },
            { "breed": "renegade_melee", "hit_mass": 1.0, "damage": 320, "hp": 380, "killed": false }
          ]
        }
      }
    }
  }
}
```

**CLI:** `npm run cleave -- <build.json> [--text|--json|--batch]`

**Scoring integration:** Horde efficiency entries in the breakpoint checklist:
- "Heavy sweep kills N in mixed horde" — targets killed count against a standard composition
- Could fold into `breakpoint_relevance` as a cleave sub-category

**Tests:** Unit tests for cleave budget consumption and per-target damage falloff. Golden snapshots for builds with melee weapons. Integration with scoring.

### #11 Toughness & Survivability Calculator

**Purpose:** Given a build's defensive buffs, calculate effective toughness pool, damage reduction breakdown, and effective HP. Answers "how tanky is this build?"

**Data extraction — new:**
- Per-class base stats: HP, toughness, wounds (from archetype definitions in decompiled source, cross-referenced with BetterBots `build-knowledge.md`)
- Coherency toughness regen rates (from toughness settings)

**Computation (`toughness-calculator.mjs`):**

Implements stages 10, 12, and 13 of the damage pipeline:

1. **Toughness damage absorption (stage 10/12):**
   - `toughness_damage = raw_damage × state_modifier × toughness_multiplier × weapon_modifier × buff_multipliers`
   - State modifiers: dodge TDR (zealot/psyker/adamant 0.5, vet/ogryn 1.0), sprint TDR (zealot 0.5)
   - Buff multipliers from build's defensive talents/blessings/curio perks

2. **Melee bleedthrough:**
   - `bleedthrough = lerp(damage, 0, toughness_percent × spillover_mod)`
   - Only applies to melee damage when toughness is partially depleted

3. **Ranged spillover:**
   - Full remaining damage passes through when toughness breaks from ranged hit

4. **Toughness regeneration:**
   - Coherency-based: 0/50/100% at 0/1/3+ allies, base rate from settings
   - Buff-modified regen rate

5. **Effective HP rollup:**
   - `effective_hp = (base_hp × wounds) + (toughness_pool × toughness_DR_multiplier)`
   - DR breakdown: which talents/blessings/perks contribute how much

**Output shape:**
```json
{
  "class": "zealot",
  "base_hp": 200,
  "wounds": 3,
  "base_toughness": 200,
  "effective_toughness": 285,
  "toughness_dr_sources": [
    { "source": "zealot.talent.some_dr_talent", "contribution": 0.15 }
  ],
  "effective_hp": 885,
  "dodge_tdr_modifier": 0.5,
  "toughness_regen_rate": { "solo": 0, "1_ally": 2.5, "3_allies": 5.0 }
}
```

**CLI:** `npm run toughness -- <build.json> [--text|--json|--batch]`

**Scoring:** Deferred. A `survivability` dimension requires its own design — it is qualitatively different from attacker-side dimensions (no breakpoint checklist analog, no obvious 1–5 scale without community-calibrated thresholds). The computation exists and is callable via CLI, but does not feed the scorecard.

**Tests:** Unit tests for toughness formulas. Integration tests against builds with known defensive loadouts. Golden snapshots.

## Phase Gating

Phase 1 results determine Phase 3 scope:

| Phase 1 Result | Consequence |
|----------------|-------------|
| Impact data clean (positive numbers, present on all profiles) | #12 proceeds as designed |
| Impact data has gaps or quality issues | #12 pauses; fix extraction first |
| Cleave data clean | #13 proceeds; only hit_mass extraction needed |
| Cleave presets have dangling references | Fix in Phase 2 before #13 |
| hit_mass absent from breed data | Expected — extraction added in #13 |
| Multiple lerp variables found | Resolve in Phase 2 before proceeding |

## File Layout

```
scripts/ground-truth/lib/
  damage-calculator.mjs          ← existing, fixes in Phase 2
  stagger-calculator.mjs         ← new (#12)
  cleave-calculator.mjs          ← new (#13)
  toughness-calculator.mjs       ← new (#11)
  breakpoint-checklist.mjs       ← extended with stagger + cleave entries

scripts/ground-truth/
  extract-breed-data.mjs         ← extended: stagger_resistance, hit_mass
  stagger-build.mjs              ← CLI entry point
  cleave-build.mjs               ← CLI entry point
  toughness-build.mjs            ← CLI entry point

data/ground-truth/
  breakpoint-checklist.json      ← extended with stagger + cleave entries
  generated/breed-data.json      ← extended with stagger_resistance, hit_mass

tests/ground-truth/
  calculator-validation.test.mjs ← new (Phase 1)
  stagger-calculator.test.mjs    ← new (#12)
  cleave-calculator.test.mjs     ← new (#13)
  toughness-calculator.test.mjs  ← new (#11)

tests/fixtures/ground-truth/
  stagger/                       ← frozen stagger snapshots
  cleave/                        ← frozen cleave snapshots
  toughness/                     ← frozen toughness snapshots
```
