import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BuildSummary } from "./types.ts";
import { buildDetailRecord } from "../../scripts/generate-data.ts";

describe("buildDetailRecord", () => {
  it("packages the generated detail payload with the summary and analysis blocks", () => {
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
    const synergy = { synergy_edges: [], anti_synergies: [], orphans: [] };
    const breakpoints = { weapons: [], metadata: { quality: 0.8 } };

    assert.deepEqual(buildDetailRecord(summary, scorecard, synergy, breakpoints), {
      slug: "17-arbites-busted",
      summary,
      scorecard,
      synergy,
      breakpoints,
    });
  });
});
