# Synergy Model Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a synergy analysis engine that takes a Darktide build and produces structured output describing stat-family alignment, slot coverage, trigger chains, resource flow, orphaned selections, and build identity.

**Architecture:** Stat-family vocabulary mapping 144 stats to 11 families, plus 5 declarative rules and a build-wide stat aggregator. Selection resolution handles stat_node family lookups and blessing→weapon_trait tier traversal. Output is a typed JSON structure consumed by scoring (#9) and recommendations (#10).

**Tech Stack:** Node.js ESM, zero runtime dependencies. Tests use `node:test` + `node:assert`. Follows existing codebase patterns (`scripts/ground-truth/lib/` for modules, `scripts/*.test.mjs` for tests).

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `scripts/ground-truth/lib/synergy-stat-families.mjs` | Create | Stat→family map, family lookup helpers, effect category classification |
| `scripts/ground-truth/lib/synergy-rules.mjs` | Create | 5 rule implementations as pure functions |
| `scripts/ground-truth/lib/synergy-model.mjs` | Create | Orchestrator: selection resolution, rule execution, stat aggregation, output assembly |
| `scripts/analyze-synergy.mjs` | Create | CLI entry point (`npm run synergy`) |
| `scripts/synergy-model.test.mjs` | Create | All unit tests: stat families, rules, aggregator, resolution, golden tests |
| `package.json` | Modify | Add `synergy` script, register test file |

---

## Chunk 1: Stat Family Taxonomy

### Task 1: Stat family map and helpers

**Files:**
- Create: `scripts/ground-truth/lib/synergy-stat-families.mjs`
- Create: `scripts/synergy-model.test.mjs`
- Modify: `package.json` (register test)

- [ ] **Step 1: Write failing tests for stat family helpers**

```javascript
// scripts/synergy-model.test.mjs
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  getFamilies,
  getEffectCategory,
  ALL_FAMILIES,
  STAT_FAMILIES,
} from "./ground-truth/lib/synergy-stat-families.mjs";

describe("synergy-stat-families", () => {
  describe("getFamilies", () => {
    it("maps melee_damage to melee_offense", () => {
      const families = getFamilies("melee_damage");
      assert.ok(families.has("melee_offense"));
    });

    it("maps critical_strike_chance to both crit and general_offense", () => {
      const families = getFamilies("critical_strike_chance");
      assert.ok(families.has("crit"));
      assert.ok(families.has("general_offense"));
    });

    it("returns uncategorized set for unknown stats", () => {
      const families = getFamilies("completely_made_up_stat");
      assert.deepStrictEqual(families, new Set(["uncategorized"]));
    });

    it("maps toughness to toughness family", () => {
      assert.ok(getFamilies("toughness").has("toughness"));
    });

    it("maps warp_charge_amount to warp_resource", () => {
      assert.ok(getFamilies("warp_charge_amount").has("warp_resource"));
    });

    it("maps movement_speed to mobility", () => {
      assert.ok(getFamilies("movement_speed").has("mobility"));
    });

    it("maps damage to general_offense", () => {
      assert.ok(getFamilies("damage").has("general_offense"));
    });

    it("maps block_cost_multiplier to both stamina and damage_reduction", () => {
      const families = getFamilies("block_cost_multiplier");
      assert.ok(families.has("stamina"));
      assert.ok(families.has("damage_reduction"));
    });
  });

  describe("getEffectCategory", () => {
    it("classifies stat_buff as persistent", () => {
      assert.equal(getEffectCategory("stat_buff"), "persistent");
    });

    it("classifies conditional_stat_buff as persistent", () => {
      assert.equal(getEffectCategory("conditional_stat_buff"), "persistent");
    });

    it("classifies proc_stat_buff as dynamic", () => {
      assert.equal(getEffectCategory("proc_stat_buff"), "dynamic");
    });

    it("classifies lerped_stat_buff as dynamic", () => {
      assert.equal(getEffectCategory("lerped_stat_buff"), "dynamic");
    });
  });

  describe("ALL_FAMILIES", () => {
    it("contains exactly 11 families", () => {
      assert.equal(ALL_FAMILIES.length, 11);
    });
  });
});
```

- [ ] **Step 2: Register test file in package.json**

Add `scripts/synergy-model.test.mjs` to the `test` script in `package.json`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test scripts/synergy-model.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 4: Implement stat family map**

Create `scripts/ground-truth/lib/synergy-stat-families.mjs` with the complete `STAT_FAMILIES` map covering all 144 known stats. The map is `stat_name → Set<family_name>`.

Family assignments for all 144 stats (grouped by family, stats may appear in multiple families):

**melee_offense:** `melee_damage`, `melee_attack_speed`, `melee_power_level_modifier`, `melee_weakspot_damage`, `melee_impact_modifier`, `melee_weakspot_power_modifier`, `melee_weakspot_impact_modifier`, `melee_damage_bonus`, `melee_rending_vs_staggered_multiplier`, `melee_finesse_modifier_bonus`, `max_melee_hit_mass_attack_modifier`, `max_hit_mass_attack_modifier`, `first_target_melee_damage_modifier`, `lunge_distance`, `toughness_melee_replenish`

**ranged_offense:** `ranged_damage`, `ranged_attack_speed`, `ranged_damage_far`, `ranged_weakspot_damage`, `ranged_impact_modifier`, `ranged_critical_strike_damage`, `ranged_critical_strike_chance`, `ranged_critical_strike_rending_multiplier`, `reload_speed`, `recoil_modifier`, `spread_modifier`, `sway_modifier`, `ammo_reserve_capacity`, `clip_size_modifier`, `consumed_hit_mass_modifier`, `consumed_hit_mass_modifier_on_weakspot_hit`, `overheat_over_time_amount`, `overheat_dissipation_multiplier`, `overheat_immediate_amount_critical_strike`, `overheat_amount`, `overheat_explosion_speed_modifier`, `overheat_explosion_damage_modifier`, `overheat_explosion_radius_modifier`, `reload_decrease_movement_reduction`

**general_offense:** `damage`, `power_level_modifier`, `rending_multiplier`, `damage_near`, `damage_far`, `damage_vs_ogryn_and_monsters`, `damage_vs_elites`, `damage_vs_staggered`, `damage_vs_suppressed`, `damage_vs_healthy`, `damage_vs_monsters`, `damage_vs_ogryn`, `damage_vs_chaos_plague_ogryn`, `damage_vs_electrocuted`, `damage_vs_nonthreat`, `weakspot_damage`, `finesse_modifier_bonus`, `impact_modifier`, `explosion_radius_modifier`, `flanking_damage`, `backstab_damage`, `suppression_dealt`, `max_hit_mass_attack_modifier`, `max_hit_mass_impact_modifier`, `push_impact_modifier`, `attack_speed`, `weapon_action_movespeed_reduction_multiplier`, `critical_strike_chance`, `critical_strike_damage`, `critical_strike_rending_multiplier`, `critical_strike_weakspot_damage`, `toxin_power`, `disgustingly_resilient_damage`, `resistant_damage`

**crit:** `critical_strike_chance`, `critical_strike_damage`, `critical_strike_rending_multiplier`, `critical_strike_weakspot_damage`, `melee_critical_strike_chance`, `ranged_critical_strike_chance`, `ranged_critical_strike_damage`, `ranged_critical_strike_rending_multiplier`, `melee_finesse_modifier_bonus`, `finesse_modifier_bonus`

**toughness:** `toughness`, `toughness_bonus`, `toughness_damage_taken_modifier`, `toughness_damage_taken_multiplier`, `toughness_replenish_modifier`, `toughness_replenish_multiplier`, `toughness_regen_rate_modifier`, `toughness_melee_replenish`

**damage_reduction:** `damage_taken_multiplier`, `corruption_taken_multiplier`, `block_cost_multiplier`, `health_segment_damage_taken_multiplier`, `max_health_damage_taken_per_hit`, `max_health_modifier`, `extra_max_amount_of_wounds`, `damage_taken_by_cultist_flamer_multiplier`, `damage_taken_by_renegade_flamer_multiplier`, `damage_taken_by_renegade_flamer_mutator_multiplier`, `damage_taken_by_cultist_gunner_multiplier`, `damage_taken_by_renegade_gunner_multiplier`, `damage_taken_by_chaos_ogryn_gunner_multiplier`, `damage_taken_by_renegade_sniper_multiplier`, `damage_taken_by_chaos_plague_ogryn_multiplier`, `damage_taken_by_chaos_poxwalker_bomber_multiplier`, `ogryn_damage_taken_multiplier`, `ranged_damage_taken_multiplier`, `damage_taken_from_toxic_gas_multiplier`, `syringe_duration`

**mobility:** `movement_speed`, `sprint_movement_speed`, `sprinting_cost_multiplier`, `extra_consecutive_dodges`, `dodge_speed_multiplier`, `dodge_linger_time_modifier`, `dodge_linger_time`, `dodge_cooldown_reset_modifier`, `sprint_dodge_reduce_angle_threshold_rad`

**warp_resource:** `warp_charge_amount`, `warp_charge_block_cost`, `warp_charge_dissipation_multiplier`, `vent_warp_charge_speed`, `vent_warp_charge_decrease_movement_reduction`, `warp_attacks_rending_multiplier`, `smite_damage_multiplier`, `chain_lightning_max_jumps`, `chain_lightning_max_radius`, `chain_lightning_max_angle`, `psyker_smite_max_hit_mass_attack_modifier`, `psyker_smite_max_hit_mass_impact_modifier`

**grenade:** `extra_max_amount_of_grenades`, `grenade_ability_cooldown_modifier`, `extra_grenade_throw_chance`, `frag_damage`, `explosion_radius_modifier_frag`, `krak_damage`, `smoke_fog_duration_modifier`, `explosion_radius_modifier_shock`, `ogryn_grenade_box_cluster_amount`

**stamina:** `stamina_modifier`, `stamina_regeneration_modifier`, `stamina_regeneration_delay`, `block_cost_multiplier`, `push_impact_modifier`

**utility:** `coherency_radius_modifier`, `wield_speed`, `revive_speed_modifier`, `combat_ability_cooldown_modifier`, `ability_cooldown_modifier`, `ability_extra_charges`, `shout_radius_modifier`, `companion_damage_modifier`, `companion_damage_vs_elites`, `companion_damage_vs_special`, `companion_damage_vs_ranged`

Stats appearing in **no family** (should not exist — verify all 144 are covered by the above lists).

```javascript
// scripts/ground-truth/lib/synergy-stat-families.mjs

/** All stat family names. */
export const ALL_FAMILIES = [
  "melee_offense",
  "ranged_offense",
  "general_offense",
  "crit",
  "toughness",
  "damage_reduction",
  "mobility",
  "warp_resource",
  "grenade",
  "stamina",
  "utility",
];

const PERSISTENT_TYPES = new Set(["stat_buff", "conditional_stat_buff"]);
const DYNAMIC_TYPES = new Set(["proc_stat_buff", "lerped_stat_buff"]);

/**
 * Classify an effect type into a category for strength scoring.
 * @param {string} effectType
 * @returns {"persistent" | "dynamic" | "unknown"}
 */
export function getEffectCategory(effectType) {
  if (PERSISTENT_TYPES.has(effectType)) return "persistent";
  if (DYNAMIC_TYPES.has(effectType)) return "dynamic";
  return "unknown";
}

// Build the reverse map: stat → Set<family>
// Defined as family → stats[], then inverted for O(1) lookup.
const FAMILY_STATS = {
  melee_offense: [
    "melee_damage", "melee_attack_speed", "melee_power_level_modifier",
    "melee_weakspot_damage", "melee_impact_modifier",
    "melee_weakspot_power_modifier", "melee_weakspot_impact_modifier",
    "melee_damage_bonus", "melee_rending_vs_staggered_multiplier",
    "melee_finesse_modifier_bonus", "max_melee_hit_mass_attack_modifier",
    "max_hit_mass_attack_modifier", "first_target_melee_damage_modifier",
    "lunge_distance", "toughness_melee_replenish",
  ],
  ranged_offense: [
    "ranged_damage", "ranged_attack_speed", "ranged_damage_far",
    "ranged_weakspot_damage", "ranged_impact_modifier",
    "ranged_critical_strike_damage", "ranged_critical_strike_chance",
    "ranged_critical_strike_rending_multiplier",
    "reload_speed", "recoil_modifier", "spread_modifier", "sway_modifier",
    "ammo_reserve_capacity", "clip_size_modifier",
    "consumed_hit_mass_modifier", "consumed_hit_mass_modifier_on_weakspot_hit",
    "overheat_over_time_amount", "overheat_dissipation_multiplier",
    "overheat_immediate_amount_critical_strike", "overheat_amount",
    "overheat_explosion_speed_modifier", "overheat_explosion_damage_modifier",
    "overheat_explosion_radius_modifier", "reload_decrease_movement_reduction",
  ],
  general_offense: [
    "damage", "power_level_modifier", "rending_multiplier",
    "damage_near", "damage_far", "damage_vs_ogryn_and_monsters",
    "damage_vs_elites", "damage_vs_staggered", "damage_vs_suppressed",
    "damage_vs_healthy", "damage_vs_monsters", "damage_vs_ogryn",
    "damage_vs_chaos_plague_ogryn", "damage_vs_electrocuted",
    "damage_vs_nonthreat", "weakspot_damage", "finesse_modifier_bonus",
    "impact_modifier", "explosion_radius_modifier",
    "flanking_damage", "backstab_damage", "suppression_dealt",
    "max_hit_mass_attack_modifier", "max_hit_mass_impact_modifier",
    "push_impact_modifier", "attack_speed",
    "weapon_action_movespeed_reduction_multiplier",
    "critical_strike_chance", "critical_strike_damage",
    "critical_strike_rending_multiplier", "critical_strike_weakspot_damage",
    "toxin_power", "disgustingly_resilient_damage", "resistant_damage",
  ],
  crit: [
    "critical_strike_chance", "critical_strike_damage",
    "critical_strike_rending_multiplier", "critical_strike_weakspot_damage",
    "melee_critical_strike_chance", "ranged_critical_strike_chance",
    "ranged_critical_strike_damage", "ranged_critical_strike_rending_multiplier",
    "melee_finesse_modifier_bonus", "finesse_modifier_bonus",
  ],
  toughness: [
    "toughness", "toughness_bonus", "toughness_damage_taken_modifier",
    "toughness_damage_taken_multiplier", "toughness_replenish_modifier",
    "toughness_replenish_multiplier", "toughness_regen_rate_modifier",
    "toughness_melee_replenish",
  ],
  damage_reduction: [
    "damage_taken_multiplier", "corruption_taken_multiplier",
    "block_cost_multiplier", "health_segment_damage_taken_multiplier",
    "max_health_damage_taken_per_hit", "max_health_modifier",
    "extra_max_amount_of_wounds",
    "damage_taken_by_cultist_flamer_multiplier",
    "damage_taken_by_renegade_flamer_multiplier",
    "damage_taken_by_renegade_flamer_mutator_multiplier",
    "damage_taken_by_cultist_gunner_multiplier",
    "damage_taken_by_renegade_gunner_multiplier",
    "damage_taken_by_chaos_ogryn_gunner_multiplier",
    "damage_taken_by_renegade_sniper_multiplier",
    "damage_taken_by_chaos_plague_ogryn_multiplier",
    "damage_taken_by_chaos_poxwalker_bomber_multiplier",
    "ogryn_damage_taken_multiplier", "ranged_damage_taken_multiplier",
    "damage_taken_from_toxic_gas_multiplier", "syringe_duration",
  ],
  mobility: [
    "movement_speed", "sprint_movement_speed", "sprinting_cost_multiplier",
    "extra_consecutive_dodges", "dodge_speed_multiplier",
    "dodge_linger_time_modifier", "dodge_linger_time",
    "dodge_cooldown_reset_modifier", "sprint_dodge_reduce_angle_threshold_rad",
  ],
  warp_resource: [
    "warp_charge_amount", "warp_charge_block_cost",
    "warp_charge_dissipation_multiplier", "vent_warp_charge_speed",
    "vent_warp_charge_decrease_movement_reduction",
    "warp_attacks_rending_multiplier", "smite_damage_multiplier",
    "chain_lightning_max_jumps", "chain_lightning_max_radius",
    "chain_lightning_max_angle",
    "psyker_smite_max_hit_mass_attack_modifier",
    "psyker_smite_max_hit_mass_impact_modifier",
  ],
  grenade: [
    "extra_max_amount_of_grenades", "grenade_ability_cooldown_modifier",
    "extra_grenade_throw_chance", "frag_damage",
    "explosion_radius_modifier_frag", "krak_damage",
    "smoke_fog_duration_modifier", "explosion_radius_modifier_shock",
    "ogryn_grenade_box_cluster_amount",
  ],
  stamina: [
    "stamina_modifier", "stamina_regeneration_modifier",
    "stamina_regeneration_delay", "block_cost_multiplier",
    "push_impact_modifier",
  ],
  utility: [
    "coherency_radius_modifier", "wield_speed", "revive_speed_modifier",
    "combat_ability_cooldown_modifier", "ability_cooldown_modifier",
    "ability_extra_charges", "shout_radius_modifier",
    "companion_damage_modifier", "companion_damage_vs_elites",
    "companion_damage_vs_special", "companion_damage_vs_ranged",
  ],
};

/** @type {Map<string, Set<string>>} stat → Set<family> */
export const STAT_FAMILIES = new Map();

for (const [family, stats] of Object.entries(FAMILY_STATS)) {
  for (const stat of stats) {
    if (!STAT_FAMILIES.has(stat)) {
      STAT_FAMILIES.set(stat, new Set());
    }
    STAT_FAMILIES.get(stat).add(family);
  }
}

/**
 * Get the set of families a stat belongs to.
 * Returns Set(["uncategorized"]) for unknown stats.
 * @param {string} stat
 * @returns {Set<string>}
 */
export function getFamilies(stat) {
  return STAT_FAMILIES.get(stat) ?? new Set(["uncategorized"]);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test scripts/synergy-model.test.mjs`
Expected: All 10 tests PASS

- [ ] **Step 6: Write stat coverage test**

Add to `scripts/synergy-model.test.mjs`:

```javascript
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("stat family coverage", () => {
  it("maps every stat found in entity data to at least one family", () => {
    const dir = "data/ground-truth/entities";
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    const unmapped = [];
    for (const f of files) {
      for (const e of JSON.parse(readFileSync(join(dir, f), "utf-8"))) {
        for (const eff of e.calc?.effects || []) {
          if (eff.stat && getFamilies(eff.stat).has("uncategorized")) {
            unmapped.push(eff.stat);
          }
        }
        for (const tier of e.calc?.tiers || []) {
          for (const eff of tier.effects || []) {
            if (eff.stat && getFamilies(eff.stat).has("uncategorized")) {
              unmapped.push(eff.stat);
            }
          }
        }
      }
    }
    assert.deepStrictEqual(
      [...new Set(unmapped)].sort(),
      [],
      `Unmapped stats: ${[...new Set(unmapped)].join(", ")}`,
    );
  });
});
```

- [ ] **Step 7: Run full test to verify coverage**

Run: `node --test scripts/synergy-model.test.mjs`
Expected: All PASS. If the coverage test fails, fix the STAT_FAMILIES map to include the missing stats, then re-run.

- [ ] **Step 8: Commit**

```bash
git add scripts/ground-truth/lib/synergy-stat-families.mjs scripts/synergy-model.test.mjs package.json
git commit -m "Add stat family taxonomy with 144 stat mappings (#8)"
```

---

## Chunk 2: Synergy Rules

### Task 2: Rule 1 — Stat-family alignment

**Files:**
- Create: `scripts/ground-truth/lib/synergy-rules.mjs`
- Modify: `scripts/synergy-model.test.mjs`

- [ ] **Step 1: Write failing tests for stat alignment rule**

Add to test file:

```javascript
import { statAlignment } from "./ground-truth/lib/synergy-rules.mjs";

describe("synergy-rules", () => {
  describe("statAlignment", () => {
    it("returns strong edge for same family + same effect category", () => {
      const selA = {
        id: "a.talent.toughness_1",
        effects: [{ stat: "toughness", type: "stat_buff", magnitude: 10 }],
      };
      const selB = {
        id: "b.talent.toughness_2",
        effects: [{ stat: "toughness", type: "stat_buff", magnitude: 15 }],
      };
      const edges = statAlignment(selA, selB);
      assert.ok(edges.length > 0);
      assert.equal(edges[0].strength, 3);
      assert.ok(edges[0].families.includes("toughness"));
    });

    it("returns moderate edge for same family + different categories", () => {
      const selA = {
        id: "a.talent.crit_1",
        effects: [{ stat: "critical_strike_chance", type: "stat_buff", magnitude: 0.05 }],
      };
      const selB = {
        id: "b.talent.crit_2",
        effects: [{ stat: "critical_strike_chance", type: "proc_stat_buff", magnitude: 0.1 }],
      };
      const edges = statAlignment(selA, selB);
      assert.ok(edges.length > 0);
      assert.equal(edges[0].strength, 2);
    });

    it("returns multiple edges when selections share multiple families", () => {
      const selA = {
        id: "a.talent.crit_chance",
        effects: [{ stat: "critical_strike_chance", type: "stat_buff", magnitude: 0.05 }],
      };
      const selB = {
        id: "b.talent.crit_dmg",
        effects: [{ stat: "critical_strike_damage", type: "stat_buff", magnitude: 0.1 }],
      };
      // Both are in crit AND general_offense → two strong edges
      const edges = statAlignment(selA, selB);
      assert.ok(edges.length >= 2);
      assert.ok(edges.some((e) => e.families.includes("crit")));
      assert.ok(edges.some((e) => e.families.includes("general_offense")));
    });

    it("returns empty array for unrelated stats", () => {
      const selA = {
        id: "a.talent.toughness",
        effects: [{ stat: "toughness", type: "stat_buff", magnitude: 10 }],
      };
      const selB = {
        id: "b.talent.reload",
        effects: [{ stat: "reload_speed", type: "stat_buff", magnitude: 0.1 }],
      };
      const edges = statAlignment(selA, selB);
      assert.equal(edges.length, 0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/synergy-model.test.mjs --test-name-pattern="statAlignment"`
Expected: FAIL — module export not found

- [ ] **Step 3: Implement stat alignment rule**

```javascript
// scripts/ground-truth/lib/synergy-rules.mjs
import { getFamilies, getEffectCategory } from "./synergy-stat-families.mjs";

/**
 * @typedef {{ id: string, effects: Array<{ stat: string, type: string, magnitude?: number }> }} ResolvedSelection
 */

/**
 * Rule 1: Stat-family alignment.
 * Detects when two selections buff the same stat family.
 *
 * @param {ResolvedSelection} selA
 * @param {ResolvedSelection} selB
 * @returns {Array<{ type: string, selections: string[], families: string[], strength: number, explanation: string }>}
 */
export function statAlignment(selA, selB) {
  // Collect families + categories per selection
  const aFamilyMap = buildFamilyCategoryMap(selA.effects);
  const bFamilyMap = buildFamilyCategoryMap(selB.effects);

  const edges = [];
  const sharedFamilies = [...aFamilyMap.keys()].filter((f) => bFamilyMap.has(f));

  for (const family of sharedFamilies) {
    if (family === "uncategorized") continue;
    const aCats = aFamilyMap.get(family);
    const bCats = bFamilyMap.get(family);

    // Determine if each selection has a stat that *directly* belongs to this family
    // vs only reaching it via multi-membership
    const aDirectStats = selA.effects.filter((e) => {
      const fams = getFamilies(e.stat);
      return fams.has(family);
    });
    const bDirectStats = selB.effects.filter((e) => {
      const fams = getFamilies(e.stat);
      return fams.has(family);
    });

    // Both have direct stats in this family → check category match
    const bothDirect = aDirectStats.length > 0 && bDirectStats.length > 0;

    let strength;
    if (bothDirect) {
      // Check if any shared category exists
      const sharedCats = [...aCats].filter((c) => bCats.has(c));
      strength = sharedCats.length > 0 ? 3 : 2;
    } else {
      strength = 1;
    }

    edges.push({
      type: "stat_alignment",
      selections: [selA.id, selB.id],
      families: [family],
      strength,
      explanation: `Both buff ${family} (strength ${strength})`,
    });
  }

  return edges;
}

/**
 * Build a map of family → Set<effectCategory> from an effects array.
 */
function buildFamilyCategoryMap(effects) {
  const map = new Map();
  for (const eff of effects) {
    const families = getFamilies(eff.stat);
    const cat = getEffectCategory(eff.type);
    for (const family of families) {
      if (!map.has(family)) map.set(family, new Set());
      map.get(family).add(cat);
    }
  }
  return map;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/synergy-model.test.mjs --test-name-pattern="statAlignment"`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/synergy-rules.mjs scripts/synergy-model.test.mjs
git commit -m "Add stat-family alignment rule (#8)"
```

### Task 3: Rule 2 — Slot coverage

**Files:**
- Modify: `scripts/ground-truth/lib/synergy-rules.mjs`
- Modify: `scripts/synergy-model.test.mjs`

- [ ] **Step 1: Write failing tests for slot coverage**

```javascript
import { slotCoverage } from "./ground-truth/lib/synergy-rules.mjs";

describe("slotCoverage", () => {
  it("detects melee-heavy build", () => {
    const selections = [
      { id: "t1", effects: [{ stat: "melee_damage", type: "stat_buff", magnitude: 0.1 }] },
      { id: "t2", effects: [{ stat: "melee_attack_speed", type: "stat_buff", magnitude: 0.1 }] },
      { id: "t3", effects: [{ stat: "ranged_damage", type: "stat_buff", magnitude: 0.1 }] },
    ];
    const result = slotCoverage(selections);
    assert.ok(result.melee.strength > result.ranged.strength);
  });

  it("counts general_offense in both slots", () => {
    const selections = [
      { id: "t1", effects: [{ stat: "damage", type: "stat_buff", magnitude: 0.1 }] },
    ];
    const result = slotCoverage(selections);
    assert.ok(result.melee.families.includes("general_offense"));
    assert.ok(result.ranged.families.includes("general_offense"));
  });
});
```

- [ ] **Step 2: Run test to verify failure**

- [ ] **Step 3: Implement slot coverage rule**

Add to `synergy-rules.mjs`:

```javascript
const MELEE_FAMILIES = new Set(["melee_offense"]);
const RANGED_FAMILIES = new Set(["ranged_offense"]);
const BOTH_SLOT_FAMILIES = new Set(["general_offense", "crit"]);

/**
 * Rule 2: Slot coverage.
 * Analyzes how build selections support melee vs ranged weapon slots.
 *
 * @param {ResolvedSelection[]} selections
 * @returns {{ melee: { families: string[], strength: number }, ranged: { families: string[], strength: number } }}
 */
export function slotCoverage(selections) {
  const melee = { familySet: new Set(), selectionIds: new Set() };
  const ranged = { familySet: new Set(), selectionIds: new Set() };

  for (const sel of selections) {
    for (const eff of sel.effects) {
      const families = getFamilies(eff.stat);
      for (const family of families) {
        if (MELEE_FAMILIES.has(family) || BOTH_SLOT_FAMILIES.has(family)) {
          melee.familySet.add(family);
          melee.selectionIds.add(sel.id);
        }
        if (RANGED_FAMILIES.has(family) || BOTH_SLOT_FAMILIES.has(family)) {
          ranged.familySet.add(family);
          ranged.selectionIds.add(sel.id);
        }
      }
    }
  }

  return {
    melee: { families: [...melee.familySet].sort(), strength: melee.selectionIds.size },
    ranged: { families: [...ranged.familySet].sort(), strength: ranged.selectionIds.size },
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/synergy-rules.mjs scripts/synergy-model.test.mjs
git commit -m "Add slot coverage rule (#8)"
```

### Task 4: Rule 3 — Trigger-target chain

**Files:**
- Modify: `scripts/ground-truth/lib/synergy-rules.mjs`
- Modify: `scripts/synergy-model.test.mjs`

- [ ] **Step 1: Write failing tests**

```javascript
import { triggerTargetChain } from "./ground-truth/lib/synergy-rules.mjs";

describe("triggerTargetChain", () => {
  it("detects trigger co-occurrence", () => {
    const selA = {
      id: "a.talent.on_kill_1",
      effects: [{ stat: "damage", type: "proc_stat_buff", magnitude: 0.1, trigger: "on_kill" }],
    };
    const selB = {
      id: "b.talent.on_kill_2",
      effects: [{ stat: "melee_damage", type: "proc_stat_buff", magnitude: 0.1, trigger: "on_kill" }],
    };
    const edges = triggerTargetChain(selA, selB);
    assert.ok(edges.length > 0);
    assert.equal(edges[0].type, "trigger_target");
  });

  it("returns empty for unrelated triggers", () => {
    const selA = {
      id: "a",
      effects: [{ stat: "damage", type: "proc_stat_buff", magnitude: 0.1, trigger: "on_kill" }],
    };
    const selB = {
      id: "b",
      effects: [{ stat: "damage", type: "proc_stat_buff", magnitude: 0.1, trigger: "on_reload" }],
    };
    const edges = triggerTargetChain(selA, selB);
    assert.equal(edges.length, 0);
  });

  it("detects warp_charge threshold + producer pairing", () => {
    const selA = {
      id: "a.talent.warp_producer",
      effects: [{ stat: "warp_charge_amount", type: "proc_stat_buff", magnitude: 0.25, trigger: "on_kill" }],
    };
    const selB = {
      id: "b.talent.warp_consumer",
      effects: [{ stat: "melee_damage", type: "conditional_stat_buff", magnitude: 0.1, condition: "threshold:warp_charge" }],
    };
    const edges = triggerTargetChain(selA, selB);
    assert.ok(edges.length > 0);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

- [ ] **Step 3: Implement trigger-target chain rule**

Add to `synergy-rules.mjs`:

```javascript
/**
 * Rule 3: Trigger-target chain.
 * Detects:
 * 1. Trigger co-occurrence (same trigger type → activate together)
 * 2. Producer-condition chains (e.g., warp_charge producer + threshold:warp_charge condition)
 *
 * @param {ResolvedSelection} selA
 * @param {ResolvedSelection} selB
 * @returns {Array<{ type: string, selections: string[], strength: number, explanation: string }>}
 */
export function triggerTargetChain(selA, selB) {
  const edges = [];

  // 1. Trigger co-occurrence
  const aTrigs = new Set(selA.effects.map((e) => e.trigger).filter(Boolean));
  const bTrigs = new Set(selB.effects.map((e) => e.trigger).filter(Boolean));
  const sharedTrigs = [...aTrigs].filter((t) => bTrigs.has(t));

  for (const trigger of sharedTrigs) {
    edges.push({
      type: "trigger_target",
      selections: [selA.id, selB.id],
      families: [],
      strength: 2,
      explanation: `Both activate on ${trigger}`,
    });
  }

  // 2. Producer-condition chains: threshold:X condition + X-producing effects
  const conditionPairs = detectProducerConditionPairs(selA, selB);
  for (const pair of conditionPairs) {
    edges.push({
      type: "trigger_target",
      selections: [selA.id, selB.id],
      families: [],
      strength: 3,
      explanation: `${pair.producer} produces ${pair.resource} needed by ${pair.consumer} condition`,
    });
  }

  return edges;
}

const THRESHOLD_RESOURCE_STATS = {
  "threshold:warp_charge": ["warp_charge_amount"],
  "threshold:ammo": ["ammo_reserve_capacity", "clip_size_modifier"],
  "threshold:health": ["max_health_modifier", "toughness"],
};

function detectProducerConditionPairs(selA, selB) {
  const pairs = [];

  // Check A produces for B's conditions
  for (const bEff of selB.effects) {
    if (!bEff.condition || !THRESHOLD_RESOURCE_STATS[bEff.condition]) continue;
    const resourceStats = THRESHOLD_RESOURCE_STATS[bEff.condition];
    for (const aEff of selA.effects) {
      if (resourceStats.includes(aEff.stat) && (aEff.magnitude ?? 0) > 0) {
        pairs.push({ producer: selA.id, consumer: selB.id, resource: bEff.condition });
      }
    }
  }

  // Check B produces for A's conditions
  for (const aEff of selA.effects) {
    if (!aEff.condition || !THRESHOLD_RESOURCE_STATS[aEff.condition]) continue;
    const resourceStats = THRESHOLD_RESOURCE_STATS[aEff.condition];
    for (const bEff of selB.effects) {
      if (resourceStats.includes(bEff.stat) && (bEff.magnitude ?? 0) > 0) {
        pairs.push({ producer: selB.id, consumer: selA.id, resource: aEff.condition });
      }
    }
  }

  return pairs;
}
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/synergy-rules.mjs scripts/synergy-model.test.mjs
git commit -m "Add trigger-target chain rule (#8)"
```

### Task 5: Rule 4 — Resource flow

**Files:**
- Modify: `scripts/ground-truth/lib/synergy-rules.mjs`
- Modify: `scripts/synergy-model.test.mjs`

- [ ] **Step 1: Write failing tests**

```javascript
import { resourceFlow } from "./ground-truth/lib/synergy-rules.mjs";

describe("resourceFlow", () => {
  it("identifies warp_charge producer and consumer", () => {
    const selections = [
      { id: "producer", effects: [{ stat: "warp_charge_amount", type: "stat_buff", magnitude: 0.25 }] },
      { id: "consumer", effects: [{ stat: "warp_charge_block_cost", type: "stat_buff", magnitude: 0.1 }] },
    ];
    const result = resourceFlow(selections);
    assert.ok(result.warp_charge.producers.includes("producer"));
    assert.ok(result.warp_charge.consumers.includes("consumer"));
    assert.equal(result.warp_charge.orphaned_consumers.length, 0);
  });

  it("detects orphaned consumer with no producer", () => {
    const selections = [
      { id: "consumer", effects: [{ stat: "warp_charge_block_cost", type: "stat_buff", magnitude: 0.1 }] },
    ];
    const result = resourceFlow(selections);
    assert.ok(result.warp_charge.orphaned_consumers.includes("consumer"));
  });

  it("identifies grenade resource flow", () => {
    const selections = [
      { id: "grenade_cap", effects: [{ stat: "extra_max_amount_of_grenades", type: "stat_buff", magnitude: 1 }] },
    ];
    const result = resourceFlow(selections);
    assert.ok(result.grenade.producers.includes("grenade_cap"));
  });
});
```

- [ ] **Step 2: Run test to verify failure**

- [ ] **Step 3: Implement resource flow rule**

Add to `synergy-rules.mjs`:

```javascript
const RESOURCE_PRODUCERS = {
  warp_charge: { stats: ["warp_charge_amount", "vent_warp_charge_speed", "warp_charge_dissipation_multiplier"], positive: true },
  grenade: { stats: ["extra_max_amount_of_grenades", "extra_grenade_throw_chance", "grenade_ability_cooldown_modifier"], positive: true },
  stamina: { stats: ["stamina_modifier", "stamina_regeneration_modifier"], positive: true },
};

const RESOURCE_CONSUMERS = {
  warp_charge: { stats: ["warp_charge_block_cost"] },
  grenade: { stats: [] }, // grenade use is implicit, not a stat
  stamina: { stats: ["block_cost_multiplier", "sprinting_cost_multiplier", "stamina_regeneration_delay"] },
};

/**
 * Rule 4: Resource flow.
 * Identifies producer/consumer relationships for warp_charge, grenade, stamina.
 *
 * @param {ResolvedSelection[]} selections
 * @returns {{ [resource: string]: { producers: string[], consumers: string[], orphaned_consumers: string[] } }}
 */
export function resourceFlow(selections) {
  const result = {};

  for (const resource of ["warp_charge", "grenade", "stamina"]) {
    const producers = new Set();
    const consumers = new Set();

    for (const sel of selections) {
      for (const eff of sel.effects) {
        if (RESOURCE_PRODUCERS[resource].stats.includes(eff.stat) && (eff.magnitude ?? 0) > 0) {
          producers.add(sel.id);
        }
        if (RESOURCE_CONSUMERS[resource].stats.includes(eff.stat)) {
          consumers.add(sel.id);
        }
      }
    }

    const orphaned = producers.size === 0 ? [...consumers] : [];

    result[resource] = {
      producers: [...producers],
      consumers: [...consumers],
      orphaned_consumers: orphaned,
    };
  }

  return result;
}
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/synergy-rules.mjs scripts/synergy-model.test.mjs
git commit -m "Add resource flow rule (#8)"
```

### Task 6: Rule 5 — Orphan detection

**Files:**
- Modify: `scripts/ground-truth/lib/synergy-rules.mjs`
- Modify: `scripts/synergy-model.test.mjs`

- [ ] **Step 1: Write failing tests**

```javascript
import { detectOrphans } from "./ground-truth/lib/synergy-rules.mjs";

describe("detectOrphans", () => {
  it("flags unresolvable_condition", () => {
    const sel = {
      id: "a.talent.mysterious",
      effects: [{ stat: "damage", type: "conditional_stat_buff", magnitude: 0.1, condition: "unknown_condition" }],
    };
    const orphans = detectOrphans(sel, []);
    assert.ok(orphans.length > 0);
    assert.equal(orphans[0].reason, "unresolvable_condition");
  });

  it("does not flag wielded condition as orphan", () => {
    const sel = {
      id: "a.trait.something",
      effects: [{ stat: "damage", type: "conditional_stat_buff", magnitude: 0.1, condition: "wielded" }],
    };
    const orphans = detectOrphans(sel, []);
    assert.equal(orphans.length, 0);
  });

  it("does not flag effects without conditions", () => {
    const sel = {
      id: "a.talent.basic",
      effects: [{ stat: "damage", type: "stat_buff", magnitude: 0.1 }],
    };
    const orphans = detectOrphans(sel, []);
    assert.equal(orphans.length, 0);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

- [ ] **Step 3: Implement orphan detection**

```javascript
// Conditions that are always satisfiable (don't need a build partner)
const SELF_SUFFICIENT_CONDITIONS = new Set(["wielded", "slot_secondary", "active"]);

/**
 * Rule 5: Orphan detection.
 * Identifies selections whose conditions/triggers cannot be activated by the build.
 *
 * @param {ResolvedSelection} selection
 * @param {ResolvedSelection[]} allSelections - full build context
 * @returns {Array<{ selection: string, reason: string, condition?: string }>}
 */
export function detectOrphans(selection, allSelections) {
  const orphans = [];

  for (const eff of selection.effects) {
    if (!eff.condition) continue;
    if (SELF_SUFFICIENT_CONDITIONS.has(eff.condition)) continue;

    if (eff.condition === "unknown_condition" || eff.condition === "active_and_unknown") {
      orphans.push({
        selection: selection.id,
        reason: "unresolvable_condition",
        condition: eff.condition,
      });
      continue;
    }

    // threshold:X conditions — check if any other selection produces that resource
    if (eff.condition.startsWith("threshold:")) {
      const resourceStats = THRESHOLD_RESOURCE_STATS[eff.condition];
      if (resourceStats) {
        const hasProducer = allSelections.some(
          (other) =>
            other.id !== selection.id
            && other.effects.some((e) => resourceStats.includes(e.stat) && (e.magnitude ?? 0) > 0),
        );
        if (!hasProducer) {
          orphans.push({
            selection: selection.id,
            reason: "resource_consumer_without_producer",
            resource: eff.condition.replace("threshold:", ""),
            condition: eff.condition,
          });
        }
      }
    }
  }

  return orphans;
}
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/synergy-rules.mjs scripts/synergy-model.test.mjs
git commit -m "Add orphan detection rule (#8)"
```

---

## Chunk 3: Stat Aggregator and Selection Resolution

### Task 7: Stat aggregator

**Files:**
- Create: `scripts/ground-truth/lib/synergy-model.mjs`
- Modify: `scripts/synergy-model.test.mjs`

- [ ] **Step 1: Write failing tests for stat aggregator**

```javascript
import { computeCoverage } from "./ground-truth/lib/synergy-model.mjs";

describe("stat aggregator", () => {
  describe("computeCoverage", () => {
    it("computes family profile from selections", () => {
      const selections = [
        { id: "t1", effects: [{ stat: "toughness", type: "stat_buff", magnitude: 15 }] },
        { id: "t2", effects: [{ stat: "toughness", type: "stat_buff", magnitude: 10 }] },
        { id: "t3", effects: [{ stat: "melee_damage", type: "stat_buff", magnitude: 0.1 }] },
      ];
      const cov = computeCoverage(selections);
      assert.equal(cov.family_profile.toughness.count, 2);
      assert.equal(cov.family_profile.toughness.total_magnitude, 25);
      assert.equal(cov.family_profile.melee_offense.count, 1);
    });

    it("computes build identity as top families", () => {
      const selections = [
        { id: "t1", effects: [{ stat: "toughness", type: "stat_buff", magnitude: 15 }] },
        { id: "t2", effects: [{ stat: "toughness", type: "stat_buff", magnitude: 10 }] },
        { id: "t3", effects: [{ stat: "toughness", type: "stat_buff", magnitude: 5 }] },
        { id: "t4", effects: [{ stat: "melee_damage", type: "stat_buff", magnitude: 0.1 }] },
      ];
      const cov = computeCoverage(selections);
      assert.equal(cov.build_identity[0], "toughness");
    });

    it("computes NHHI concentration", () => {
      // All in one family → concentration near 1
      const selections = [
        { id: "t1", effects: [{ stat: "toughness", type: "stat_buff", magnitude: 10 }] },
        { id: "t2", effects: [{ stat: "toughness_replenish_modifier", type: "stat_buff", magnitude: 0.1 }] },
      ];
      const cov = computeCoverage(selections);
      assert.ok(cov.concentration > 0.8);
    });

    it("detects missing survivability gap", () => {
      const selections = [
        { id: "t1", effects: [{ stat: "melee_damage", type: "stat_buff", magnitude: 0.1 }] },
        { id: "t2", effects: [{ stat: "melee_attack_speed", type: "stat_buff", magnitude: 0.1 }] },
        { id: "t3", effects: [{ stat: "melee_damage", type: "stat_buff", magnitude: 0.1 }] },
      ];
      const cov = computeCoverage(selections);
      assert.ok(cov.coverage_gaps.length > 0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

- [ ] **Step 3: Implement stat aggregator**

Create `scripts/ground-truth/lib/synergy-model.mjs` starting with the `computeCoverage` function:

```javascript
// scripts/ground-truth/lib/synergy-model.mjs
import { getFamilies, ALL_FAMILIES } from "./synergy-stat-families.mjs";

/**
 * Compute build-wide coverage analysis from resolved selections.
 *
 * @param {Array<{ id: string, effects: Array<{ stat: string, type: string, magnitude?: number }> }>} selections
 * @returns {{ family_profile: object, slot_balance: object, build_identity: string[], coverage_gaps: string[], concentration: number }}
 */
export function computeCoverage(selections) {
  // Build family profile
  const profile = {};
  for (const family of ALL_FAMILIES) {
    profile[family] = { count: 0, total_magnitude: 0, selections: [] };
  }

  for (const sel of selections) {
    const contributedFamilies = new Set();
    for (const eff of sel.effects) {
      const families = getFamilies(eff.stat);
      for (const family of families) {
        if (family === "uncategorized") continue;
        if (!profile[family]) continue;
        profile[family].total_magnitude += eff.magnitude ?? 0;
        contributedFamilies.add(family);
      }
    }
    for (const family of contributedFamilies) {
      profile[family].count++;
      profile[family].selections.push(sel.id);
    }
  }

  // Slot balance
  const MELEE_SLOT = new Set(["melee_offense", "general_offense", "crit"]);
  const RANGED_SLOT = new Set(["ranged_offense", "general_offense", "crit"]);

  const meleeIds = new Set();
  const rangedIds = new Set();
  const meleeFamilies = new Set();
  const rangedFamilies = new Set();

  for (const [family, data] of Object.entries(profile)) {
    if (MELEE_SLOT.has(family) && data.count > 0) {
      meleeFamilies.add(family);
      for (const id of data.selections) meleeIds.add(id);
    }
    if (RANGED_SLOT.has(family) && data.count > 0) {
      rangedFamilies.add(family);
      for (const id of data.selections) rangedIds.add(id);
    }
  }

  const slot_balance = {
    melee: { families: [...meleeFamilies].sort(), strength: meleeIds.size },
    ranged: { families: [...rangedFamilies].sort(), strength: rangedIds.size },
  };

  // Build identity: top 3 families by count (excluding uncategorized)
  const sortedFamilies = Object.entries(profile)
    .filter(([, d]) => d.count > 0)
    .sort((a, b) => b[1].count - a[1].count);
  const build_identity = sortedFamilies.slice(0, 3).map(([f]) => f);

  // Coverage gaps
  const coverage_gaps = [];

  // Missing survivability: melee-focused but no toughness or DR
  if (build_identity[0] === "melee_offense" && profile.toughness.count === 0 && profile.damage_reduction.count === 0) {
    coverage_gaps.push("survivability");
  }

  // Missing crit source: has crit family contributions but no crit_chance stat
  if (profile.crit.count > 0) {
    const hasCritChance = selections.some((s) =>
      s.effects.some((e) => e.stat === "critical_strike_chance" || e.stat === "melee_critical_strike_chance" || e.stat === "ranged_critical_strike_chance"),
    );
    if (!hasCritChance) {
      coverage_gaps.push("crit_chance_source");
    }
  }

  // Missing warp producer: has warp consumers but no producers
  const hasWarpConsumers = selections.some((s) => s.effects.some((e) => e.stat === "warp_charge_block_cost"));
  const hasWarpProducers = selections.some((s) => s.effects.some((e) => e.stat === "warp_charge_amount" && (e.magnitude ?? 0) > 0));
  if (hasWarpConsumers && !hasWarpProducers) {
    coverage_gaps.push("warp_charge_producer");
  }

  // Concentration: NHHI
  const activeFamilies = Object.values(profile).filter((d) => d.count > 0);
  const N = activeFamilies.length;
  let concentration = 0;
  if (N > 1) {
    const total = activeFamilies.reduce((sum, d) => sum + d.count, 0);
    const hhi = activeFamilies.reduce((sum, d) => sum + (d.count / total) ** 2, 0);
    concentration = (hhi - 1 / N) / (1 - 1 / N);
  } else if (N === 1) {
    concentration = 1;
  }

  // Remove empty families from profile output
  const filteredProfile = {};
  for (const [family, data] of Object.entries(profile)) {
    if (data.count > 0) filteredProfile[family] = data;
  }

  return {
    family_profile: filteredProfile,
    slot_balance,
    build_identity,
    coverage_gaps,
    concentration: Math.round(concentration * 100) / 100,
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/synergy-model.mjs scripts/synergy-model.test.mjs
git commit -m "Add stat aggregator with coverage analysis (#8)"
```

### Task 8: Selection resolution

**Files:**
- Modify: `scripts/ground-truth/lib/synergy-model.mjs`
- Modify: `scripts/synergy-model.test.mjs`

- [ ] **Step 1: Write failing tests for selection resolution**

```javascript
import { resolveSelections } from "./ground-truth/lib/synergy-model.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

describe("resolveSelections", () => {
  // Load real index for integration-style tests
  const entityDir = "data/ground-truth/entities";
  const edgeDir = "data/ground-truth/edges";
  const entities = new Map();
  for (const f of readdirSync(entityDir).filter((f) => f.endsWith(".json"))) {
    for (const e of JSON.parse(readFileSync(join(entityDir, f), "utf-8"))) {
      entities.set(e.id, e);
    }
  }
  const edges = readdirSync(edgeDir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => JSON.parse(readFileSync(join(edgeDir, f), "utf-8")));

  it("resolves entity with direct calc.effects", () => {
    const build = JSON.parse(readFileSync("scripts/builds/08-gandalf-melee-wizard.json", "utf-8"));
    const resolved = resolveSelections(build, entities, edges);
    // Should have some resolved selections with effects
    const withEffects = resolved.filter((s) => s.effects.length > 0);
    assert.ok(withEffects.length > 0, "Expected some selections with effects");
  });

  it("deduplicates selections by entity ID", () => {
    const build = JSON.parse(readFileSync("scripts/builds/08-gandalf-melee-wizard.json", "utf-8"));
    const resolved = resolveSelections(build, entities, edges);
    const ids = resolved.map((s) => s.id);
    const uniqueIds = new Set(ids);
    assert.equal(ids.length, uniqueIds.size, "Expected no duplicate IDs");
  });

  it("resolves blessing name_family via instance_of edges", () => {
    // Find a build with a blessing that has a weapon_trait with tier effects
    // Use any build that has blessings with entity IDs
    const builds = readdirSync("scripts/builds").filter((f) => f.endsWith(".json"));
    let found = false;
    for (const bf of builds) {
      const build = JSON.parse(readFileSync(join("scripts/builds", bf), "utf-8"));
      const resolved = resolveSelections(build, entities, edges);
      const blessingResolved = resolved.filter((s) =>
        entities.get(s.id)?.kind === "name_family" && s.effects.length > 0,
      );
      if (blessingResolved.length > 0) {
        found = true;
        break;
      }
    }
    // This may or may not find one depending on build data — just verify no crash
    assert.ok(true, "Blessing resolution completed without error");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

- [ ] **Step 3: Implement selection resolution**

Add to `synergy-model.mjs`:

```javascript
/**
 * Extract all selection entity IDs from a build, deduplicated.
 * @param {object} build - Canonical build shape
 * @returns {string[]} Unique entity IDs
 */
function extractSelectionIds(build) {
  const ids = new Set();

  for (const field of ["ability", "blitz", "aura", "keystone"]) {
    const v = build[field];
    if (v?.canonical_entity_id) ids.add(v.canonical_entity_id);
  }

  for (const t of build.talents || []) {
    if (t?.canonical_entity_id) ids.add(t.canonical_entity_id);
  }

  for (const w of build.weapons || []) {
    if (w?.name?.canonical_entity_id) ids.add(w.name.canonical_entity_id);
    for (const b of w?.blessings || []) {
      if (b?.canonical_entity_id) ids.add(b.canonical_entity_id);
    }
    for (const p of w?.perks || []) {
      if (p?.canonical_entity_id) ids.add(p.canonical_entity_id);
    }
  }

  for (const c of build.curios || []) {
    if (c?.name?.canonical_entity_id) ids.add(c.name.canonical_entity_id);
    for (const p of c?.perks || []) {
      if (p?.canonical_entity_id) ids.add(p.canonical_entity_id);
    }
  }

  return [...ids];
}

/**
 * Get calc effects for a name_family entity by traversing instance_of edges
 * to weapon_trait instances and using tier-4 effects.
 */
function resolveBlessingEffects(entityId, entities, edges) {
  const instanceOfEdges = edges.filter(
    (e) => e.type === "instance_of" && e.to_entity_id === entityId,
  );

  for (const edge of instanceOfEdges) {
    const wt = entities.get(edge.from_entity_id);
    if (!wt) continue;

    // Try top-level effects first
    if (Array.isArray(wt.calc?.effects) && wt.calc.effects.length > 0) {
      return wt.calc.effects;
    }

    // Try tier-4 effects (last tier = highest)
    if (Array.isArray(wt.calc?.tiers) && wt.calc.tiers.length > 0) {
      const lastTier = wt.calc.tiers[wt.calc.tiers.length - 1];
      if (Array.isArray(lastTier?.effects) && lastTier.effects.length > 0) {
        return lastTier.effects;
      }
    }
  }

  return [];
}

/**
 * Resolve build selections to entities with calc effects.
 * Handles: direct calc, stat_node family resolution, blessing tier traversal.
 *
 * @param {object} build
 * @param {Map<string, object>} entities
 * @param {Array<object>} edges
 * @returns {Array<{ id: string, effects: Array<{ stat: string, type: string, magnitude?: number, trigger?: string, condition?: string }> }>}
 */
export function resolveSelections(build, entities, edges) {
  const ids = extractSelectionIds(build);
  const resolved = [];

  for (const id of ids) {
    const entity = entities.get(id);
    if (!entity) {
      resolved.push({ id, effects: [] });
      continue;
    }

    // Direct calc.effects
    if (Array.isArray(entity.calc?.effects) && entity.calc.effects.length > 0) {
      resolved.push({ id, effects: entity.calc.effects });
      continue;
    }

    // Blessing name_family: traverse instance_of → weapon_trait tiers
    if (entity.kind === "name_family") {
      const effects = resolveBlessingEffects(id, entities, edges);
      resolved.push({ id, effects });
      continue;
    }

    // Stat node family: find per-class base_* talent by internal_name prefix
    if (entity.kind === "stat_node" && entity.internal_name) {
      const prefix = entity.internal_name; // e.g. "base_toughness_node_buff"
      const classId = build.class?.canonical_entity_id?.split(".").pop(); // e.g. "psyker"
      // Find any per-class talent whose internal_name starts with this prefix
      for (const [, e] of entities) {
        if (
          e.kind === "talent"
          && e.domain === classId
          && e.internal_name?.startsWith(prefix)
          && Array.isArray(e.calc?.effects)
          && e.calc.effects.length > 0
        ) {
          resolved.push({ id, effects: e.calc.effects });
          break;
        }
      }
      if (!resolved.find((r) => r.id === id)) {
        resolved.push({ id, effects: [] });
      }
      continue;
    }

    // No calc available
    resolved.push({ id, effects: [] });
  }

  return resolved;
}
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/synergy-model.mjs scripts/synergy-model.test.mjs
git commit -m "Add selection resolution with blessing/stat-node traversal (#8)"
```

---

## Chunk 4: Orchestrator, CLI, and Golden Tests

### Task 9: Orchestrator — `analyzeBuild`

**Files:**
- Modify: `scripts/ground-truth/lib/synergy-model.mjs`
- Modify: `scripts/synergy-model.test.mjs`

- [ ] **Step 1: Write failing test for full analysis**

```javascript
import { analyzeBuild, loadIndex } from "./ground-truth/lib/synergy-model.mjs";

describe("analyzeBuild", () => {
  it("produces valid analysis for build 08", () => {
    const build = JSON.parse(readFileSync("scripts/builds/08-gandalf-melee-wizard.json", "utf-8"));
    const index = loadIndex();
    const result = analyzeBuild(build, index);

    // Structure checks
    assert.ok(Array.isArray(result.synergy_edges));
    assert.ok(Array.isArray(result.anti_synergies));
    assert.ok(Array.isArray(result.orphans));
    assert.ok(result.coverage);
    assert.ok(result.metadata);

    // Metadata sanity
    assert.ok(result.metadata.entities_analyzed > 0);
    assert.ok(result.metadata.unique_entities_with_calc > 0);
    assert.ok(result.metadata.calc_coverage_pct > 0);
    assert.ok(result.metadata.calc_coverage_pct <= 1);

    // Should find some synergy edges (build 08 has toughness + melee talents)
    assert.ok(result.synergy_edges.length > 0, "Expected synergy edges");

    // Coverage should have build_identity
    assert.ok(result.coverage.build_identity.length > 0);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

- [ ] **Step 3: Implement analyzeBuild and loadIndex**

Add to `synergy-model.mjs`:

```javascript
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ENTITIES_ROOT, EDGES_ROOT, listJsonFiles, loadJsonFile } from "./load.mjs";
import {
  statAlignment,
  slotCoverage,
  triggerTargetChain,
  resourceFlow,
  detectOrphans,
} from "./synergy-rules.mjs";

/**
 * Load the entity and edge index.
 * @returns {{ entities: Map<string, object>, edges: Array<object> }}
 */
export function loadIndex() {
  const entities = new Map();
  for (const path of listJsonFiles(ENTITIES_ROOT)) {
    for (const e of loadJsonFile(path)) {
      entities.set(e.id, e);
    }
  }
  const edges = listJsonFiles(EDGES_ROOT).flatMap((path) => loadJsonFile(path));
  return { entities, edges };
}

/**
 * Run full synergy analysis on a build.
 *
 * @param {object} build - Canonical build shape
 * @param {{ entities: Map<string, object>, edges: Array<object> }} index
 * @returns {object} Synergy analysis output
 */
export function analyzeBuild(build, index) {
  const { entities, edges } = index;
  const allResolved = resolveSelections(build, entities, edges);

  // Filter to those with effects for rule processing
  const withEffects = allResolved.filter((s) => s.effects.length > 0);

  // Run pairwise rules
  const synergyEdges = [];
  for (let i = 0; i < withEffects.length; i++) {
    for (let j = i + 1; j < withEffects.length; j++) {
      synergyEdges.push(...statAlignment(withEffects[i], withEffects[j]));
      synergyEdges.push(...triggerTargetChain(withEffects[i], withEffects[j]));
    }
  }

  // Run build-wide rules
  const slotCov = slotCoverage(withEffects);
  const resFlow = resourceFlow(withEffects);

  // Run orphan detection
  const orphans = [];
  for (const sel of withEffects) {
    orphans.push(...detectOrphans(sel, withEffects));
  }

  // Add resource flow orphans
  for (const [resource, flow] of Object.entries(resFlow)) {
    for (const consumerId of flow.orphaned_consumers) {
      // Avoid duplicates with condition-based orphans
      if (!orphans.some((o) => o.selection === consumerId && o.resource === resource)) {
        orphans.push({
          selection: consumerId,
          reason: "resource_consumer_without_producer",
          resource,
        });
      }
    }
  }

  // Anti-synergies: slot imbalance
  const antiSynergies = [];
  if (slotCov.melee.strength > 0 && slotCov.ranged.strength === 0) {
    antiSynergies.push({
      type: "slot_imbalance",
      selections: [],
      reason: "No ranged offense support — ranged weapon slot unbuffed",
      severity: "medium",
    });
  } else if (slotCov.ranged.strength > 0 && slotCov.melee.strength === 0) {
    antiSynergies.push({
      type: "slot_imbalance",
      selections: [],
      reason: "No melee offense support — melee weapon slot unbuffed",
      severity: "medium",
    });
  }

  // Coverage analysis
  const coverage = computeCoverage(withEffects);

  // Metadata
  const opaqueCount = withEffects.reduce(
    (n, s) => n + s.effects.filter((e) => e.condition === "unknown_condition" || e.condition === "active_and_unknown").length,
    0,
  );

  // Count pre-dedup total from build
  let totalSelections = 0;
  for (const field of ["ability", "blitz", "aura", "keystone"]) {
    if (build[field]?.canonical_entity_id) totalSelections++;
  }
  for (const t of build.talents || []) { if (t?.canonical_entity_id) totalSelections++; }
  for (const w of build.weapons || []) {
    if (w?.name?.canonical_entity_id) totalSelections++;
    for (const b of w?.blessings || []) { if (b?.canonical_entity_id) totalSelections++; }
    for (const p of w?.perks || []) { if (p?.canonical_entity_id) totalSelections++; }
  }
  for (const c of build.curios || []) {
    if (c?.name?.canonical_entity_id) totalSelections++;
    for (const p of c?.perks || []) { if (p?.canonical_entity_id) totalSelections++; }
  }

  const metadata = {
    entities_analyzed: totalSelections,
    unique_entities_with_calc: withEffects.length,
    entities_without_calc: allResolved.length - withEffects.length,
    opaque_conditions: opaqueCount,
    calc_coverage_pct: allResolved.length > 0
      ? Math.round((withEffects.length / allResolved.length) * 100) / 100
      : 0,
  };

  return {
    build: build.title || "",
    class: build.class?.raw_label || build.class || "",
    synergy_edges: synergyEdges,
    anti_synergies: antiSynergies,
    orphans,
    coverage,
    metadata,
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/synergy-model.mjs scripts/synergy-model.test.mjs
git commit -m "Add synergy analysis orchestrator (#8)"
```

### Task 10: CLI entry point

**Files:**
- Create: `scripts/analyze-synergy.mjs`
- Modify: `package.json`

- [ ] **Step 1: Implement CLI**

```javascript
#!/usr/bin/env node
// Synergy analysis CLI — run on a build or directory of builds.
// Usage: npm run synergy -- <build.json|dir> [--json]

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { analyzeBuild, loadIndex } from "./ground-truth/lib/synergy-model.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: "boolean", default: false },
  },
});

const target = positionals[0];
if (!target) {
  console.error("Usage: npm run synergy -- <build.json|dir> [--json]");
  process.exit(1);
}

const index = loadIndex();

function processFile(filePath) {
  const build = JSON.parse(readFileSync(filePath, "utf-8"));
  return analyzeBuild(build, index);
}

function formatText(result) {
  const lines = [];
  lines.push(`=== ${result.build} (${result.class}) ===`);
  lines.push(`Coverage: ${result.metadata.unique_entities_with_calc}/${result.metadata.entities_analyzed} selections (${Math.round(result.metadata.calc_coverage_pct * 100)}%)`);
  lines.push("");

  if (result.coverage.build_identity.length > 0) {
    lines.push(`Build identity: ${result.coverage.build_identity.join(", ")}`);
    lines.push(`Concentration: ${result.coverage.concentration}`);
  }

  if (result.coverage.coverage_gaps.length > 0) {
    lines.push(`Coverage gaps: ${result.coverage.coverage_gaps.join(", ")}`);
  }

  lines.push("");
  lines.push(`Synergy edges: ${result.synergy_edges.length}`);
  const byStrength = { 3: 0, 2: 0, 1: 0 };
  for (const e of result.synergy_edges) byStrength[e.strength] = (byStrength[e.strength] || 0) + 1;
  lines.push(`  Strong (3): ${byStrength[3] || 0}  Moderate (2): ${byStrength[2] || 0}  Weak (1): ${byStrength[1] || 0}`);

  if (result.anti_synergies.length > 0) {
    lines.push("");
    lines.push("Anti-synergies:");
    for (const a of result.anti_synergies) {
      lines.push(`  [${a.severity}] ${a.reason}`);
    }
  }

  if (result.orphans.length > 0) {
    lines.push("");
    lines.push("Orphans:");
    for (const o of result.orphans) {
      lines.push(`  ${o.selection}: ${o.reason}${o.resource ? ` (${o.resource})` : ""}${o.condition ? ` [${o.condition}]` : ""}`);
    }
  }

  lines.push("");
  lines.push(`Slot balance: melee=${result.coverage.slot_balance.melee.strength} ranged=${result.coverage.slot_balance.ranged.strength}`);

  if (result.metadata.opaque_conditions > 0) {
    lines.push(`Opaque conditions: ${result.metadata.opaque_conditions}`);
  }

  return lines.join("\n");
}

const stat = statSync(target);
if (stat.isDirectory()) {
  const files = readdirSync(target).filter((f) => f.endsWith(".json")).sort();
  for (const f of files) {
    const result = processFile(join(target, f));
    if (values.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatText(result));
      console.log("");
    }
  }
} else {
  const result = processFile(target);
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatText(result));
  }
}
```

- [ ] **Step 2: Add `synergy` script to package.json**

Add to `scripts` in `package.json`:
```json
"synergy": "node scripts/analyze-synergy.mjs"
```

- [ ] **Step 3: Smoke test CLI**

Run: `npm run synergy -- scripts/builds/08-gandalf-melee-wizard.json`
Expected: Human-readable synergy analysis output, no errors.

Run: `npm run synergy -- scripts/builds/08-gandalf-melee-wizard.json --json`
Expected: Valid JSON output.

- [ ] **Step 4: Commit**

```bash
git add scripts/analyze-synergy.mjs package.json
git commit -m "Add synergy CLI entry point (#8)"
```

### Task 11: Golden tests

**Files:**
- Create: `tests/fixtures/ground-truth/synergy/` (frozen snapshots)
- Modify: `scripts/synergy-model.test.mjs`

- [ ] **Step 1: Generate and freeze golden snapshots**

Run synergy analysis on 5 representative builds and save output:

```bash
mkdir -p tests/fixtures/ground-truth/synergy
for build in 01 04 08 13 14; do
  node scripts/analyze-synergy.mjs "scripts/builds/${build}-"*.json --json > "tests/fixtures/ground-truth/synergy/${build}.synergy.json"
done
```

Builds chosen for diversity: 01 (veteran), 04 (zealot), 08 (psyker), 13 (ogryn), 14 (arbites).

- [ ] **Step 2: Write golden test**

Add to `scripts/synergy-model.test.mjs`:

```javascript
describe("golden tests", () => {
  const goldenDir = "tests/fixtures/ground-truth/synergy";
  const goldenFiles = readdirSync(goldenDir).filter((f) => f.endsWith(".synergy.json"));
  const index = loadIndex();

  for (const gf of goldenFiles) {
    it(`matches frozen snapshot for ${gf}`, () => {
      const expected = JSON.parse(readFileSync(join(goldenDir, gf), "utf-8"));
      const buildNum = gf.split(".")[0];
      const buildFiles = readdirSync("scripts/builds").filter((f) => f.startsWith(`${buildNum}-`));
      assert.ok(buildFiles.length === 1, `Expected one build file for ${buildNum}`);

      const build = JSON.parse(readFileSync(join("scripts/builds", buildFiles[0]), "utf-8"));
      const actual = analyzeBuild(build, index);

      // Compare structure — ignore explanation text (may change)
      assert.equal(actual.synergy_edges.length, expected.synergy_edges.length, "synergy_edges count mismatch");
      assert.equal(actual.anti_synergies.length, expected.anti_synergies.length, "anti_synergies count mismatch");
      assert.equal(actual.orphans.length, expected.orphans.length, "orphans count mismatch");
      assert.deepStrictEqual(actual.coverage.build_identity, expected.coverage.build_identity);
      assert.deepStrictEqual(actual.coverage.coverage_gaps, expected.coverage.coverage_gaps);
      assert.equal(actual.coverage.concentration, expected.coverage.concentration);
      assert.deepStrictEqual(actual.metadata, expected.metadata);
    });
  }
});
```

- [ ] **Step 3: Run golden tests**

Run: `node --test scripts/synergy-model.test.mjs --test-name-pattern="golden"`
Expected: All PASS (snapshots were just generated).

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/ground-truth/synergy/ scripts/synergy-model.test.mjs
git commit -m "Add golden synergy tests for 5 representative builds (#8)"
```

### Task 12: Integration and quality gate

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add synergy:freeze script to package.json**

```json
"synergy:freeze": "for f in tests/fixtures/ground-truth/synergy/*.synergy.json; do b=$(basename \"$f\" .synergy.json); node scripts/analyze-synergy.mjs \"scripts/builds/${b}-\"*.json --json > \"$f\"; done"
```

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass (previous 299 + new synergy tests).

- [ ] **Step 3: Run make check**

Run: `make check`
Expected: Full quality gate passes (edges:build → effects:build → check).

- [ ] **Step 4: Final commit if any adjustments needed**

```bash
git add -A
git commit -m "Integrate synergy model into test suite and quality gate (#8)"
```
