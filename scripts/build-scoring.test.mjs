// scripts/build-scoring.test.mjs
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { scoreFromSynergy } from "./ground-truth/lib/build-scoring.mjs";

describe("build-scoring", () => {
  describe("talent_coherence", () => {
    it("scores high for dense talent-talent edges", () => {
      const synergy = makeSynergyOutput({
        talentIds: ["t.talent.a", "t.talent.b", "t.talent.c", "t.talent.d", "t.talent.e"],
        blessingIds: ["shared.name_family.blessing.x"],
        talentEdges: 10,
        blessingEdges: 3,
        orphans: [],
        concentration: 0.08,
        familyCount: 8,
        coverageGaps: [],
        slotBalance: { melee: 5, ranged: 5 },
      });
      const result = scoreFromSynergy(synergy);
      assert.ok(result.talent_coherence.score >= 4);
    });

    it("penalizes graph-isolated talents", () => {
      const synergy = makeSynergyOutput({
        talentIds: ["t.talent.a", "t.talent.b", "t.talent.c", "t.talent.d", "t.talent.e"],
        blessingIds: ["shared.name_family.blessing.x"],
        talentEdges: 3,
        talentEdgeParticipants: ["t.talent.a", "t.talent.b", "t.talent.c"],
        blessingEdges: 1,
        orphans: [],
        concentration: 0.03,
        familyCount: 6,
        coverageGaps: [],
        slotBalance: { melee: 3, ranged: 3 },
      });
      const result = scoreFromSynergy(synergy);
      assert.ok(result.talent_coherence.breakdown.graph_isolated_count === 2);
    });

    it("counts trigger_target edges in talent synergy", () => {
      const synergy = makeSynergyOutput({
        talentIds: ["t.talent.a", "t.talent.b", "t.talent.c"],
        blessingIds: [],
        talentEdges: 2,
        talentTriggerEdges: 2,
        blessingEdges: 0,
        orphans: [],
        concentration: 0.05,
        familyCount: 6,
        coverageGaps: [],
        slotBalance: { melee: 3, ranged: 3 },
      });
      const result = scoreFromSynergy(synergy);
      assert.equal(result.talent_coherence.breakdown.talent_edges, 4);
    });

    it("includes abilities and talent_modifiers in talent count", () => {
      const synergy = makeSynergyOutput({
        talentIds: ["t.talent.a", "t.ability.b", "t.talent_modifier.c"],
        blessingIds: [],
        talentEdges: 2,
        blessingEdges: 0,
        orphans: [],
        concentration: 0.05,
        familyCount: 5,
        coverageGaps: [],
        slotBalance: { melee: 2, ranged: 2 },
      });
      const result = scoreFromSynergy(synergy);
      assert.equal(result.talent_coherence.breakdown.talent_count, 3);
    });
  });
});

function makeSynergyOutput({
  talentIds = [],
  blessingIds = [],
  talentEdges = 0,
  talentEdgeParticipants = null,
  talentTriggerEdges = 0,
  blessingEdges = 0,
  blessingBlessingEdges = 0,
  orphans = [],
  concentration = 0.05,
  familyCount = 8,
  coverageGaps = [],
  slotBalance = { melee: 5, ranged: 5 },
}) {
  const synergy_edges = [];

  const tParticipants = talentEdgeParticipants || talentIds;
  for (let i = 0; i < talentEdges; i++) {
    const a = tParticipants[i % tParticipants.length];
    const b = tParticipants[(i + 1) % tParticipants.length];
    synergy_edges.push({
      type: "stat_alignment",
      selections: [a, b],
      families: ["general_offense"],
      strength: 3,
      explanation: `test edge ${i}`,
    });
  }

  for (let i = 0; i < talentTriggerEdges; i++) {
    const a = tParticipants[i % tParticipants.length];
    const b = tParticipants[(i + 1) % tParticipants.length];
    synergy_edges.push({
      type: "trigger_target",
      selections: [a, b],
      families: [],
      strength: 2,
      explanation: `Both activate on test_trigger`,
    });
  }

  if (blessingIds.length > 0) {
    for (let i = 0; i < blessingEdges; i++) {
      const bl = blessingIds[i % blessingIds.length];
      const t = talentIds[i % (talentIds.length || 1)];
      if (bl && t) {
        synergy_edges.push({
          type: "stat_alignment",
          selections: [bl, t],
          families: ["general_offense"],
          strength: 3,
          explanation: `blessing-talent edge ${i}`,
        });
      }
    }
  }

  if (blessingIds.length >= 2) {
    for (let i = 0; i < blessingBlessingEdges; i++) {
      const a = blessingIds[i % blessingIds.length];
      const b = blessingIds[(i + 1) % blessingIds.length];
      synergy_edges.push({
        type: "stat_alignment",
        selections: [a, b],
        families: ["general_offense"],
        strength: 3,
        explanation: `blessing-blessing edge ${i}`,
      });
    }
  }

  const families = [
    "melee_offense", "ranged_offense", "general_offense", "crit",
    "toughness", "damage_reduction", "mobility", "warp_resource",
    "grenade", "stamina", "utility",
  ];
  const family_profile = {};
  for (let i = 0; i < familyCount && i < families.length; i++) {
    family_profile[families[i]] = { count: 2, total_magnitude: 0.1, selections: [] };
  }

  return {
    build: "test build",
    class: "test",
    synergy_edges,
    anti_synergies: [],
    orphans,
    coverage: {
      family_profile,
      slot_balance: {
        melee: { families: [], strength: slotBalance.melee },
        ranged: { families: [], strength: slotBalance.ranged },
      },
      build_identity: Object.keys(family_profile).slice(0, 3),
      coverage_gaps: coverageGaps,
      concentration,
    },
    metadata: {
      entities_analyzed: talentIds.length + blessingIds.length,
      unique_entities_with_calc: talentIds.length + blessingIds.length,
      entities_without_calc: 0,
      opaque_conditions: 0,
      calc_coverage_pct: 1.0,
    },
    _talentSideIds: talentIds,
  };
}
