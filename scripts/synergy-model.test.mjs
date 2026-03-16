import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

import {
  statAlignment,
  slotCoverage,
  triggerTargetChain,
  resourceFlow,
  detectOrphans,
} from "./ground-truth/lib/synergy-rules.mjs";

describe("synergy-rules", () => {
  describe("statAlignment", () => {
    it("returns strong edge for same family + same effect category", () => {
      const selA = { id: "a.talent.toughness_1", effects: [{ stat: "toughness", type: "stat_buff", magnitude: 10 }] };
      const selB = { id: "b.talent.toughness_2", effects: [{ stat: "toughness", type: "stat_buff", magnitude: 15 }] };
      const edges = statAlignment(selA, selB);
      assert.ok(edges.length > 0);
      assert.equal(edges[0].strength, 3);
      assert.ok(edges[0].families.includes("toughness"));
    });

    it("returns moderate edge for same family + different categories", () => {
      const selA = { id: "a", effects: [{ stat: "critical_strike_chance", type: "stat_buff", magnitude: 0.05 }] };
      const selB = { id: "b", effects: [{ stat: "critical_strike_chance", type: "proc_stat_buff", magnitude: 0.1 }] };
      const edges = statAlignment(selA, selB);
      assert.ok(edges.length > 0);
      assert.equal(edges[0].strength, 2);
    });

    it("returns multiple edges when selections share multiple families", () => {
      const selA = { id: "a", effects: [{ stat: "critical_strike_chance", type: "stat_buff", magnitude: 0.05 }] };
      const selB = { id: "b", effects: [{ stat: "critical_strike_damage", type: "stat_buff", magnitude: 0.1 }] };
      const edges = statAlignment(selA, selB);
      assert.ok(edges.length >= 2);
      assert.ok(edges.some((e) => e.families.includes("crit")));
      assert.ok(edges.some((e) => e.families.includes("general_offense")));
    });

    it("returns empty array for unrelated stats", () => {
      const selA = { id: "a", effects: [{ stat: "toughness", type: "stat_buff", magnitude: 10 }] };
      const selB = { id: "b", effects: [{ stat: "reload_speed", type: "stat_buff", magnitude: 0.1 }] };
      assert.equal(statAlignment(selA, selB).length, 0);
    });
  });

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

  describe("triggerTargetChain", () => {
    it("detects trigger co-occurrence", () => {
      const selA = { id: "a", effects: [{ stat: "damage", type: "proc_stat_buff", magnitude: 0.1, trigger: "on_kill" }] };
      const selB = { id: "b", effects: [{ stat: "melee_damage", type: "proc_stat_buff", magnitude: 0.1, trigger: "on_kill" }] };
      const edges = triggerTargetChain(selA, selB);
      assert.ok(edges.length > 0);
      assert.equal(edges[0].type, "trigger_target");
    });

    it("returns empty for unrelated triggers", () => {
      const selA = { id: "a", effects: [{ stat: "damage", type: "proc_stat_buff", magnitude: 0.1, trigger: "on_kill" }] };
      const selB = { id: "b", effects: [{ stat: "damage", type: "proc_stat_buff", magnitude: 0.1, trigger: "on_reload" }] };
      assert.equal(triggerTargetChain(selA, selB).length, 0);
    });

    it("detects warp_charge threshold + producer pairing", () => {
      const selA = { id: "a", effects: [{ stat: "warp_charge_amount", type: "proc_stat_buff", magnitude: 0.25, trigger: "on_kill" }] };
      const selB = { id: "b", effects: [{ stat: "melee_damage", type: "conditional_stat_buff", magnitude: 0.1, condition: "threshold:warp_charge" }] };
      const edges = triggerTargetChain(selA, selB);
      assert.ok(edges.length > 0);
    });
  });

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

  describe("detectOrphans", () => {
    it("flags unresolvable_condition", () => {
      const sel = { id: "a", effects: [{ stat: "damage", type: "conditional_stat_buff", magnitude: 0.1, condition: "unknown_condition" }] };
      const orphans = detectOrphans(sel, []);
      assert.ok(orphans.length > 0);
      assert.equal(orphans[0].reason, "unresolvable_condition");
    });

    it("does not flag wielded condition as orphan", () => {
      const sel = { id: "a", effects: [{ stat: "damage", type: "conditional_stat_buff", magnitude: 0.1, condition: "wielded" }] };
      assert.equal(detectOrphans(sel, []).length, 0);
    });

    it("does not flag effects without conditions", () => {
      const sel = { id: "a", effects: [{ stat: "damage", type: "stat_buff", magnitude: 0.1 }] };
      assert.equal(detectOrphans(sel, []).length, 0);
    });
  });
});

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

import { computeCoverage, resolveSelections, analyzeBuild, loadIndex } from "./ground-truth/lib/synergy-model.mjs";

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
      const selections = [
        { id: "t1", effects: [{ stat: "toughness", type: "stat_buff", magnitude: 10 }] },
        { id: "t2", effects: [{ stat: "toughness_replenish_modifier", type: "stat_buff", magnitude: 0.1 }] },
      ];
      const cov = computeCoverage(selections);
      assert.ok(cov.concentration > 0.8, `Expected high concentration, got ${cov.concentration}`);
    });

    it("detects missing survivability gap", () => {
      const selections = [
        { id: "t1", effects: [{ stat: "melee_damage", type: "stat_buff", magnitude: 0.1 }] },
        { id: "t2", effects: [{ stat: "melee_attack_speed", type: "stat_buff", magnitude: 0.1 }] },
        { id: "t3", effects: [{ stat: "melee_damage", type: "stat_buff", magnitude: 0.1 }] },
      ];
      const cov = computeCoverage(selections);
      assert.ok(cov.coverage_gaps.includes("survivability"));
    });
  });
});

describe("resolveSelections", () => {
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
});

describe("analyzeBuild", () => {
  it("produces valid analysis for build 08", () => {
    const build = JSON.parse(readFileSync("scripts/builds/08-gandalf-melee-wizard.json", "utf-8"));
    const index = loadIndex();
    const result = analyzeBuild(build, index);

    assert.ok(Array.isArray(result.synergy_edges));
    assert.ok(Array.isArray(result.anti_synergies));
    assert.ok(Array.isArray(result.orphans));
    assert.ok(result.coverage);
    assert.ok(result.metadata);

    assert.ok(result.metadata.entities_analyzed > 0);
    assert.ok(result.metadata.unique_entities_with_calc > 0);
    assert.ok(result.metadata.calc_coverage_pct > 0);
    assert.ok(result.metadata.calc_coverage_pct <= 1);
    assert.ok(result.synergy_edges.length > 0, "Expected synergy edges");
    assert.ok(result.coverage.build_identity.length > 0);
  });
});
