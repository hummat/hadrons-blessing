import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BuildDetailData, BuildSummary } from "./types.ts";
import {
  computeBreakpointDiff,
  computeScoreDeltas,
  computeSetDiff,
  computeSlotDiff,
  computeSynergyEdgeDiff,
  curioPerkEntries,
  talentEntries,
  weaponEntries,
} from "./compare.ts";

function makeSummary(overrides: Partial<BuildSummary> = {}): BuildSummary {
  return {
    file: "09-psyker-2026.json",
    title: "Psyker Build 2026",
    class: "psyker",
    ability: "Scrier's Gaze",
    keystone: "Warp Siphon",
    weapons: [
      { name: "Covenant Mk VI Blaze Force Greatsword", slot: "melee", family: "forcesword_2h" },
      { name: "Rifthaven Mk II Inferno Force Staff", slot: "ranged", family: "forcestaff_p2" },
    ],
    scores: {
      composite: 27,
      grade: "A",
      perk_optimality: 5,
      curio_efficiency: 3,
      talent_coherence: 1,
      blessing_synergy: 5,
      role_coverage: 4,
      breakpoint_relevance: 5,
      difficulty_scaling: 4,
    },
    ...overrides,
  };
}

function makeDetail(): BuildDetailData {
  return {
    slug: "09-psyker-2026",
    summary: makeSummary(),
    scorecard: {
      title: "Psyker Build 2026",
      class: "psyker",
      perk_optimality: 5,
      curio_efficiency: 3,
      composite_score: 27,
      letter_grade: "A",
      weapons: [
        {
          name: "Covenant Mk VI Blaze Force Greatsword",
          slot: "melee",
          canonical_entity_id: "shared.weapon.forcesword_2h_p1_m1",
          internal_name: "forcesword_2h_p1_m1",
          weapon_family: "forcesword_2h",
          resolution_source: "ground_truth",
          perks: { score: 5, perks: [] },
          blessings: { valid: null, blessings: [] },
        },
        {
          name: "Rifthaven Mk II Inferno Force Staff",
          slot: "ranged",
          canonical_entity_id: "shared.weapon.forcestaff_p2_m1",
          internal_name: "forcestaff_p2_m1",
          weapon_family: "forcestaff_p2",
          resolution_source: "ground_truth",
          perks: { score: 5, perks: [] },
          blessings: { valid: null, blessings: [] },
        },
      ],
      curios: { score: 3, perks: [] },
      qualitative: {
        blessing_synergy: { score: 5, breakdown: {}, explanations: [] },
        talent_coherence: { score: 1, breakdown: {}, explanations: [] },
        breakpoint_relevance: { score: 5, breakdown: {}, explanations: [] },
        role_coverage: { score: 4, breakdown: {}, explanations: [] },
        difficulty_scaling: { score: 4, breakdown: {}, explanations: [] },
      },
      bot_flags: [],
    },
    synergy: {
      build: "Psyker Build 2026",
      class: "psyker",
      synergy_edges: [],
      anti_synergies: [],
      orphans: [],
      coverage: {
        family_profile: {},
        slot_balance: {
          melee: { families: [], strength: 0 },
          ranged: { families: [], strength: 0 },
        },
        build_identity: [],
        coverage_gaps: [],
        concentration: 0,
      },
      _resolvedIds: [],
      metadata: {
        entities_analyzed: 0,
        unique_entities_with_calc: 0,
        entities_without_calc: 0,
        opaque_conditions: 0,
        calc_coverage_pct: 0,
      },
    },
    breakpoints: {
      weapons: [
        {
          entityId: "shared.weapon.forcesword_2h_p1_m1",
          slot: 1,
          actions: [
            {
              type: "light_attack",
              profileId: "melee-light",
              scenarios: {
                sustained: {
                  breeds: [
                    {
                      breed_id: "chaos_ogryn_bulwark",
                      difficulty: "damnation",
                      hitsToKill: 3,
                      damage: 0,
                      hitZone: "torso",
                      effectiveArmorType: "armored",
                      damageEfficiency: "normal",
                    },
                  ],
                },
              },
            },
            {
              type: "push",
              profileId: "melee-push",
              scenarios: {
                sustained: {
                  breeds: [
                    {
                      breed_id: "chaos_ogryn_bulwark",
                      difficulty: "damnation",
                      hitsToKill: 7,
                      damage: 0,
                      hitZone: "torso",
                      effectiveArmorType: "armored",
                      damageEfficiency: "normal",
                    },
                  ],
                },
              },
            },
          ],
          summary: { bestLight: null, bestHeavy: null, bestSpecial: null },
        },
      ],
      metadata: {
        quality: 0.8,
        scenarios: ["sustained"],
        timestamp: "2026-04-09T00:00:00.000Z",
      },
    },
    structure: {
      slots: {
        ability: { id: "psyker.ability.psyker_combat_ability_stance", name: "Scrier's Gaze" },
        blitz: { id: "psyker.ability.psyker_brain_burst_improved", name: "Brain Rupture" },
        aura: { id: "psyker.aura.psyker_cooldown_aura_improved", name: "Seers Presence" },
        keystone: { id: "psyker.keystone.psyker_passive_souls_from_elite_kills", name: "Warp Siphon" },
      },
      talents: [
        { id: "shared.stat_node.toughness_boost", name: "Toughness Boost 4" },
        { id: "shared.stat_node.toughness_boost", name: "Toughness Boost 5" },
      ],
      weapons: [
        {
          id: "shared.weapon.forcesword_2h_p1_m1",
          name: "Covenant Mk VI Blaze Force Greatsword",
          slot: "melee",
          family: "forcesword_2h",
          blessings: [
            { id: "shared.name_family.blessing.wrath", name: "Wrath" },
            { id: null, name: "Unstable Power" },
          ],
        },
        {
          id: "shared.weapon.forcestaff_p2_m1",
          name: "Rifthaven Mk II Inferno Force Staff",
          slot: "ranged",
          family: "forcestaff_p2",
          blessings: [
            { id: "shared.name_family.blessing.blaze_away", name: "Blaze Away" },
            { id: "shared.name_family.blessing.warp_nexus", name: "Warp Nexus" },
          ],
        },
      ],
      curio_perks: [
        { id: "shared.gadget_trait.gadget_toughness_increase", name: "+17% Toughness" },
        { id: "shared.gadget_trait.gadget_toughness_increase", name: "+5% Toughness" },
      ],
    },
  };
}

describe("computeSetDiff", () => {
  it("preserves same-id different-name entries as distinct items", () => {
    const diff = computeSetDiff(
      talentEntries(makeDetail()),
      [{
        compare_key: "shared.stat_node.toughness_boost::Toughness Boost 5",
        id: "shared.stat_node.toughness_boost",
        name: "Toughness Boost 5",
      }],
    );

    assert.deepEqual(
      diff.shared.map((entry) => entry.name),
      ["Toughness Boost 5"],
    );
    assert.deepEqual(
      diff.only_a.map((entry) => entry.name),
      ["Toughness Boost 4"],
    );
  });

  it("keeps unresolved blessing entries in the diffable structure", () => {
    const entries = weaponEntries(makeDetail());
    assert.equal(entries[0].blessings[1].compare_key, "unresolved::Unstable Power");
  });

  it("preserves duplicate curio perks with different labels", () => {
    const entries = curioPerkEntries(makeDetail());
    assert.deepEqual(
      entries.map((entry) => entry.compare_key),
      [
        "shared.gadget_trait.gadget_toughness_increase::+17% Toughness",
        "shared.gadget_trait.gadget_toughness_increase::+5% Toughness",
      ],
    );
  });
});

describe("computeBreakpointDiff", () => {
  it("includes weapon attribution and push rows", () => {
    const a = makeDetail();
    const b = makeDetail();
    b.breakpoints.weapons[0].actions[0].scenarios.sustained.breeds[0].hitsToKill = 2;
    b.breakpoints.weapons[0].actions[1].scenarios.sustained.breeds[0].hitsToKill = 6;

    const diff = computeBreakpointDiff(a.breakpoints, b.breakpoints, "sustained", "damnation", a.scorecard.weapons, b.scorecard.weapons);

    assert.ok(diff.some((row) => row.action_category === "light" && row.a_weapon === "Covenant Mk VI Blaze Force Greatsword"));
    assert.ok(diff.some((row) => row.action_category === "push"));
  });
});

describe("compare overview helpers", () => {
  it("computes score deltas from scorecard and qualitative sections", () => {
    const a = makeDetail();
    const b = makeDetail();
    b.scorecard.composite_score = 29;
    b.scorecard.qualitative.role_coverage!.score = 5;

    const deltas = computeScoreDeltas(a, b);

    assert.equal(deltas[0].dimension, "composite_score");
    assert.equal(deltas[0].delta, 2);
    assert.equal(deltas.find((row) => row.dimension === "role_coverage")?.delta, 1);
  });

  it("computes slot changes from structure data", () => {
    const a = makeDetail();
    const b = makeDetail();
    b.structure.slots.blitz = { id: "psyker.ability.smite", name: "Smite" };

    const rows = computeSlotDiff(a.structure, b.structure);

    assert.equal(rows.find((row) => row.key === "blitz")?.changed, true);
    assert.equal(rows.find((row) => row.key === "ability")?.changed, false);
  });

  it("keeps synergy edges with the same selections but different families distinct", () => {
    const a = makeDetail();
    const b = makeDetail();
    a.synergy.synergy_edges = [
      {
        type: "stat_alignment",
        selections: ["Warp Rider", "Warp Nexus"],
        families: ["crit"],
        strength: 2,
        explanation: "crit alignment",
      },
    ];
    b.synergy.synergy_edges = [
      {
        type: "stat_alignment",
        selections: ["Warp Rider", "Warp Nexus"],
        families: ["toughness"],
        strength: 2,
        explanation: "toughness alignment",
      },
    ];

    const diff = computeSynergyEdgeDiff(a.synergy, b.synergy);

    assert.equal(diff.shared.length, 0);
    assert.equal(diff.only_a[0].families[0], "crit");
    assert.equal(diff.only_b[0].families[0], "toughness");
  });
});
