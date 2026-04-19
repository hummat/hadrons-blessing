import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BuildSummary } from "./types.ts";
import { buildDetailRecord } from "../../scripts/generate-data.ts";

describe("buildDetailRecord", () => {
  it("packages the generated detail payload with the summary, analysis, and structure blocks", () => {
    const summary: BuildSummary = {
      file: "17-arbites-busted.json",
      title: "BUSTED - Havoc 40",
      class: "arbites",
      ability: "Castigators Stance",
      keystone: "Execution Order",
      weapons: [
        { name: "Shock Maul", slot: "melee", family: "powermaul_p2" },
      ],
      scores: {
        composite: 28,
        grade: "A",
        perk_optimality: 5,
        curio_efficiency: 4,
        talent_coherence: 1,
        blessing_synergy: 5,
        role_coverage: 4,
        breakpoint_relevance: 5,
        difficulty_scaling: 4,
      },
    };

    const scorecard = { title: "BUSTED - Havoc 40" };
    const synergy = {
      synergy_edges: [],
      anti_synergies: [],
      orphans: [],
      metadata: {
        calc_coverage_pct: 0.5,
        linked_coverage_pct: 0.9,
        unique_entities_with_calc: 5,
        unique_entities_with_linked_source: 9,
        entities_analyzed: 10,
        entities_without_calc: 5,
        opaque_conditions: 0,
      },
    };
    const breakpoints = { weapons: [], metadata: { quality: 0.8 } };
    const structure = {
      slots: {
        ability: { id: "arbites.ability.castigators_stance", name: "Castigators Stance" },
        blitz: { id: null, name: null },
        aura: { id: null, name: null },
        keystone: { id: "arbites.keystone.execution_order", name: "Execution Order" },
      },
      talents: [{ id: "shared.stat_node.toughness_boost", name: "Toughness Boost 4" }],
      weapons: [
        {
          id: "shared.weapon.powermaul_p2_m1",
          name: "Shock Maul",
          slot: "melee",
          family: "powermaul_p2",
          blessings: [{ id: null, name: "Unstable Power" }],
        },
      ],
      curio_perks: [{ id: "shared.gadget_trait.gadget_toughness_increase", name: "+17% Toughness" }],
    };

    assert.deepEqual(buildDetailRecord(summary, scorecard, synergy, breakpoints, structure), {
      slug: "17-arbites-busted",
      summary,
      scorecard,
      synergy,
      breakpoints,
      structure,
    });
  });
});
