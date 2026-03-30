// @ts-nocheck
// scripts/build-scoring.test.mjs
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { scoreFromSynergy, scoreFromCalculator } from "./build-scoring.js";
import { scoreBreakpointRelevance, scoreDifficultyScaling } from "./breakpoint-checklist.js";
import { generateScorecard } from "./score-build.js";
import { analyzeBuild, loadIndex } from "./synergy-model.js";

const HAS_SOURCE = !!process.env.GROUND_TRUTH_SOURCE_ROOT;

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

  describe("blessing_synergy", () => {
    it("scores high for many blessing-talent edges", () => {
      const synergy = makeSynergyOutput({
        talentIds: ["t.talent.a", "t.talent.b", "t.talent.c"],
        blessingIds: ["shared.name_family.blessing.x", "shared.name_family.blessing.y"],
        talentEdges: 3,
        blessingEdges: 8,
        blessingBlessingEdges: 1,
        orphans: [],
        concentration: 0.05,
        familyCount: 8,
        coverageGaps: [],
        slotBalance: { melee: 5, ranged: 5 },
      });
      const result = scoreFromSynergy(synergy);
      assert.ok(result.blessing_synergy.score >= 4);
    });

    it("penalizes graph-isolated blessings", () => {
      const synergy = makeSynergyOutput({
        talentIds: ["t.talent.a"],
        blessingIds: ["shared.name_family.blessing.x", "shared.name_family.blessing.y"],
        talentEdges: 0,
        blessingEdges: 0,
        blessingBlessingEdges: 0,
        orphans: [],
        concentration: 0.05,
        familyCount: 8,
        coverageGaps: [],
        slotBalance: { melee: 5, ranged: 5 },
      });
      // Manually add edges only for blessing.x, leaving blessing.y isolated
      synergy.synergy_edges.push(
        { type: "stat_alignment", selections: ["shared.name_family.blessing.x", "t.talent.a"], families: ["general_offense"], strength: 3, explanation: "test" },
        { type: "stat_alignment", selections: ["shared.name_family.blessing.x", "t.talent.a"], families: ["crit"], strength: 2, explanation: "test" },
      );
      const result = scoreFromSynergy(synergy);
      assert.equal(result.blessing_synergy.breakdown.orphaned_blessings, 1);
    });

    it("gives bonus for blessing-blessing edges", () => {
      const withBB = makeSynergyOutput({
        talentIds: ["t.talent.a"],
        blessingIds: ["shared.name_family.blessing.x", "shared.name_family.blessing.y"],
        talentEdges: 0,
        blessingEdges: 4,
        blessingBlessingEdges: 1,
        orphans: [],
        concentration: 0.05,
        familyCount: 8,
        coverageGaps: [],
        slotBalance: { melee: 5, ranged: 5 },
      });
      const withoutBB = makeSynergyOutput({
        talentIds: ["t.talent.a"],
        blessingIds: ["shared.name_family.blessing.x", "shared.name_family.blessing.y"],
        talentEdges: 0,
        blessingEdges: 4,
        blessingBlessingEdges: 0,
        orphans: [],
        concentration: 0.05,
        familyCount: 8,
        coverageGaps: [],
        slotBalance: { melee: 5, ranged: 5 },
      });
      const resultWith = scoreFromSynergy(withBB);
      const resultWithout = scoreFromSynergy(withoutBB);
      assert.ok(resultWith.blessing_synergy.score >= resultWithout.blessing_synergy.score);
    });

    it("scores 1 when no blessings present", () => {
      const synergy = makeSynergyOutput({
        talentIds: ["t.talent.a"],
        blessingIds: [],
        talentEdges: 0,
        blessingEdges: 0,
        orphans: [],
        concentration: 0.05,
        familyCount: 8,
        coverageGaps: [],
        slotBalance: { melee: 5, ranged: 5 },
      });
      const result = scoreFromSynergy(synergy);
      assert.equal(result.blessing_synergy.score, 1);
    });
  });

  describe("role_coverage", () => {
    it("scores 5 for 9+ active families with no gaps", () => {
      const synergy = makeSynergyOutput({
        talentIds: ["t.talent.a"],
        blessingIds: [],
        talentEdges: 0,
        blessingEdges: 0,
        orphans: [],
        concentration: 0.03,
        familyCount: 9,
        coverageGaps: [],
        slotBalance: { melee: 5, ranged: 5 },
      });
      const result = scoreFromSynergy(synergy);
      assert.equal(result.role_coverage.score, 5);
    });

    it("penalizes coverage gaps", () => {
      const synergy = makeSynergyOutput({
        talentIds: ["t.talent.a"],
        blessingIds: [],
        talentEdges: 0,
        blessingEdges: 0,
        orphans: [],
        concentration: 0.03,
        familyCount: 9,
        coverageGaps: ["survivability"],
        slotBalance: { melee: 5, ranged: 5 },
      });
      const result = scoreFromSynergy(synergy);
      assert.equal(result.role_coverage.score, 4);  // 5 - 1 gap
    });

    it("penalizes severe slot imbalance", () => {
      const synergy = makeSynergyOutput({
        talentIds: ["t.talent.a"],
        blessingIds: [],
        talentEdges: 0,
        blessingEdges: 0,
        orphans: [],
        concentration: 0.03,
        familyCount: 9,
        coverageGaps: [],
        slotBalance: { melee: 10, ranged: 1 },  // ratio 0.1 < 0.3
      });
      const result = scoreFromSynergy(synergy);
      assert.equal(result.role_coverage.score, 4);  // 5 - 1 imbalance
    });

    it("treats zero/zero slot balance as neutral (0.5) not perfect", () => {
      const synergy = makeSynergyOutput({
        talentIds: ["t.talent.a"],
        blessingIds: [],
        talentEdges: 0,
        blessingEdges: 0,
        orphans: [],
        concentration: 0.03,
        familyCount: 9,
        coverageGaps: [],
        slotBalance: { melee: 0, ranged: 0 },
      });
      const result = scoreFromSynergy(synergy);
      assert.equal(result.role_coverage.breakdown.slot_balance_ratio, 0.5);
    });

    it("scores low for few families", () => {
      const synergy = makeSynergyOutput({
        talentIds: ["t.talent.a"],
        blessingIds: [],
        talentEdges: 0,
        blessingEdges: 0,
        orphans: [],
        concentration: 0.03,
        familyCount: 3,
        coverageGaps: [],
        slotBalance: { melee: 2, ranged: 2 },
      });
      const result = scoreFromSynergy(synergy);
      assert.equal(result.role_coverage.score, 2);
    });
  });
});

describe("golden score snapshots", { skip: !HAS_SOURCE && "requires GROUND_TRUTH_SOURCE_ROOT" }, () => {
  const SCORES_DIR = "tests/fixtures/ground-truth/scores";
  const files = readdirSync(SCORES_DIR).filter(f => f.endsWith(".score.json"));
  const index = loadIndex();

  for (const file of files) {
    const prefix = file.replace(".score.json", "");
    it(`matches snapshot for build ${prefix}`, () => {
      const expected = JSON.parse(readFileSync(`${SCORES_DIR}/${file}`, "utf-8"));
      const buildFile = readdirSync("data/builds").find(f => f.startsWith(prefix) && f.endsWith(".json"));
      const build = JSON.parse(readFileSync(`data/builds/${buildFile}`, "utf-8"));
      const synergy = analyzeBuild(build, index);
      const actual = generateScorecard(build, synergy);

      // Compare qualitative scores
      assert.equal(actual.qualitative.talent_coherence.score, expected.qualitative.talent_coherence.score);
      assert.equal(actual.qualitative.blessing_synergy.score, expected.qualitative.blessing_synergy.score);
      assert.equal(actual.qualitative.role_coverage.score, expected.qualitative.role_coverage.score);
      assert.equal(actual.composite_score, expected.composite_score);
      assert.equal(actual.letter_grade, expected.letter_grade);

      // Mechanical scores unchanged
      assert.equal(actual.perk_optimality, expected.perk_optimality);
      assert.equal(actual.curio_efficiency, expected.curio_efficiency);
    });
  }
});

// ── Breakpoint checklist tests ──────────────────────────────────────

describe("breakpoint_relevance", () => {
  it("scores higher when more checklist breakpoints are hit", () => {
    // Matrix where all weapons hit all breakpoints (1 hit for everything)
    const goodMatrix = makeMatrix({
      hitsToKill: 1,
      breeds: ["renegade_berzerker", "chaos_ogryn_executor", "renegade_netgunner",
        "chaos_hound", "chaos_poxwalker_bomber", "chaos_poxwalker",
        "renegade_executor", "chaos_ogryn_bulwark", "renegade_sniper"],
    });
    // Matrix where no weapon hits any breakpoint
    const badMatrix = makeMatrix({
      hitsToKill: 99,
      breeds: ["renegade_berzerker", "chaos_ogryn_executor", "renegade_netgunner",
        "chaos_hound", "chaos_poxwalker_bomber", "chaos_poxwalker",
        "renegade_executor", "chaos_ogryn_bulwark", "renegade_sniper"],
    });

    const good = scoreBreakpointRelevance(goodMatrix);
    const bad = scoreBreakpointRelevance(badMatrix);
    assert.ok(good.score > bad.score, `good ${good.score} should be > bad ${bad.score}`);
    assert.ok(good.score >= 4);
    assert.equal(bad.score, 1);
  });

  it("scores in 1-5 range", () => {
    const matrix = makeMatrix({
      hitsToKill: 2,
      breeds: ["renegade_berzerker", "chaos_ogryn_executor", "renegade_netgunner",
        "chaos_hound", "chaos_poxwalker_bomber", "chaos_poxwalker",
        "renegade_executor", "chaos_ogryn_bulwark", "renegade_sniper"],
    });
    const result = scoreBreakpointRelevance(matrix);
    assert.ok(result.score >= 1 && result.score <= 5);
  });

  it("returns null when matrix has no weapons", () => {
    const result = scoreBreakpointRelevance({ weapons: [], metadata: { scenarios: ["sustained", "aimed", "burst"] } });
    assert.equal(result, null);
  });

  it("returns null for null matrix", () => {
    assert.equal(scoreBreakpointRelevance(null), null);
  });
});

describe("difficulty_scaling", () => {
  it("scores higher when breakpoints hold at auric", () => {
    // Weapon hits everything at both damnation and auric
    const resilient = makeMatrix({
      hitsToKill: 1,
      breeds: ["renegade_berzerker", "chaos_ogryn_executor"],
      difficulties: ["damnation", "auric"],
    });
    // Weapon hits at damnation but not auric
    const degraded = makeMatrixWithDifficulties({
      breeds: ["renegade_berzerker", "chaos_ogryn_executor"],
      damnationHTK: 1,
      auricHTK: 99,
    });

    const rScore = scoreDifficultyScaling(resilient);
    const dScore = scoreDifficultyScaling(degraded);
    assert.ok(rScore.score > dScore.score, `resilient ${rScore.score} should > degraded ${dScore.score}`);
  });

  it("scores lower when breakpoints lost at damnation", () => {
    const bad = makeMatrix({
      hitsToKill: 99,
      breeds: ["renegade_berzerker", "chaos_ogryn_executor"],
      difficulties: ["damnation", "auric"],
    });
    const result = scoreDifficultyScaling(bad);
    assert.equal(result.score, 1);
  });

  it("returns null when matrix has no weapons", () => {
    const result = scoreDifficultyScaling({ weapons: [], metadata: { scenarios: ["sustained", "aimed", "burst"] } });
    assert.equal(result, null);
  });
});

describe("generateScorecard with calcOutput", () => {
  it("includes breakpoint_relevance when calcOutput provided", () => {
    const build = makeMinimalBuild();
    const matrix = makeMatrix({
      hitsToKill: 1,
      breeds: ["renegade_berzerker", "chaos_ogryn_executor", "renegade_netgunner",
        "chaos_hound", "chaos_poxwalker_bomber", "chaos_poxwalker",
        "renegade_executor", "chaos_ogryn_bulwark", "renegade_sniper"],
    });
    const card = generateScorecard(build, null, { matrix });
    assert.ok(card.qualitative.breakpoint_relevance != null);
    assert.ok(card.qualitative.breakpoint_relevance.score >= 1);
    assert.ok(card.qualitative.breakpoint_relevance.score <= 5);
    assert.ok(card.qualitative.difficulty_scaling != null);
    assert.ok(card.qualitative.difficulty_scaling.score >= 1);
    assert.ok(card.qualitative.difficulty_scaling.score <= 5);
  });

  it("gracefully degrades when calcOutput is null", () => {
    const build = makeMinimalBuild();
    const card = generateScorecard(build, null, null);
    assert.equal(card.qualitative.breakpoint_relevance, null);
    assert.equal(card.qualitative.difficulty_scaling, null);
  });

  it("still works with only 2 args (backward compat)", () => {
    const build = makeMinimalBuild();
    const card = generateScorecard(build);
    assert.equal(card.qualitative.breakpoint_relevance, null);
    assert.equal(card.qualitative.difficulty_scaling, null);
  });
});

describe("scoreFromCalculator", () => {
  it("returns both dimensions from matrix", () => {
    const matrix = makeMatrix({
      hitsToKill: 1,
      breeds: ["renegade_berzerker", "chaos_ogryn_executor", "renegade_netgunner",
        "chaos_hound", "chaos_poxwalker_bomber", "chaos_poxwalker",
        "renegade_executor", "chaos_ogryn_bulwark", "renegade_sniper"],
    });
    const result = scoreFromCalculator({ matrix });
    assert.ok(result.breakpoint_relevance != null);
    assert.ok(result.difficulty_scaling != null);
  });

  it("returns null dimensions for empty matrix", () => {
    const result = scoreFromCalculator({ matrix: { weapons: [] } });
    assert.equal(result.breakpoint_relevance, null);
    assert.equal(result.difficulty_scaling, null);
  });
});

// ── Matrix test helpers ────────────────────────────────────────────

function makeMinimalBuild() {
  return {
    title: "Test Build",
    class: "veteran",
    weapons: [],
    curios: [],
    talents: [],
  };
}

/**
 * Creates a mock breakpoint matrix with uniform hitsToKill for all
 * breed/difficulty/scenario combinations.
 */
function makeMatrix({ hitsToKill, breeds, difficulties = ["damnation", "auric"] }) {
  const scenarios = ["sustained", "aimed", "burst"];
  const hitZoneMap = { sustained: "torso", aimed: "head", burst: "head" };

  const breedResults = {};
  for (const scenario of scenarios) {
    const entries = [];
    for (const breedId of breeds) {
      for (const diff of difficulties) {
        entries.push({
          breed_id: breedId,
          difficulty: diff,
          hitsToKill,
          damage: 100,
          hitZone: hitZoneMap[scenario],
          effectiveArmorType: "unarmored",
          damageEfficiency: 1.0,
        });
      }
    }
    breedResults[scenario] = { breeds: entries };
  }

  return {
    weapons: [{
      entityId: "shared.weapon.test_weapon_m1",
      slot: 0,
      actions: [{
        type: "light_attack",
        profileId: "test_profile",
        scenarios: breedResults,
      }],
      summary: { bestLight: null, bestHeavy: null, bestSpecial: null },
    }],
    metadata: { quality: 0.8, scenarios, timestamp: "2026-01-01T00:00:00Z" },
  };
}

/**
 * Creates a mock matrix with different HTK at damnation vs auric.
 */
function makeMatrixWithDifficulties({ breeds, damnationHTK, auricHTK }) {
  const scenarios = ["sustained", "aimed", "burst"];
  const hitZoneMap = { sustained: "torso", aimed: "head", burst: "head" };

  const breedResults = {};
  for (const scenario of scenarios) {
    const entries = [];
    for (const breedId of breeds) {
      entries.push({
        breed_id: breedId,
        difficulty: "damnation",
        hitsToKill: damnationHTK,
        damage: 100,
        hitZone: hitZoneMap[scenario],
        effectiveArmorType: "unarmored",
        damageEfficiency: 1.0,
      });
      entries.push({
        breed_id: breedId,
        difficulty: "auric",
        hitsToKill: auricHTK,
        damage: 50,
        hitZone: hitZoneMap[scenario],
        effectiveArmorType: "unarmored",
        damageEfficiency: 0.5,
      });
    }
    breedResults[scenario] = { breeds: entries };
  }

  return {
    weapons: [{
      entityId: "shared.weapon.test_weapon_m1",
      slot: 0,
      actions: [{
        type: "light_attack",
        profileId: "test_profile",
        scenarios: breedResults,
      }],
      summary: { bestLight: null, bestHeavy: null, bestSpecial: null },
    }],
    metadata: { quality: 0.8, scenarios, timestamp: "2026-01-01T00:00:00Z" },
  };
}

// ── Synergy test helpers ───────────────────────────────────────────

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
    _resolvedIds: [...talentIds, ...blessingIds],
  };
}
