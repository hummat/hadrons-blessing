import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { analyzeGaps, validateTreeReachability, swapTalent, swapWeapon } from "./build-recommendations.js";
import { loadIndex, analyzeBuild } from "./synergy-model.js";
import { generateScorecard } from "./score-build.js";
import { loadCalculatorData, computeBreakpoints } from "./damage-calculator.js";
import { computeSurvivability } from "./toughness-calculator.js";

const HAS_SOURCE = !!process.env.GROUND_TRUTH_SOURCE_ROOT;

describe("build-recommendations", { skip: !HAS_SOURCE && "requires GROUND_TRUTH_SOURCE_ROOT" }, () => {
  let index;
  let calcData;
  function getIndex() {
    if (!index) index = loadIndex();
    return index;
  }
  function getCalcData() {
    if (!calcData) calcData = loadCalculatorData();
    return calcData;
  }
  function scoreVector(scorecard) {
    return {
      perk_optimality: scorecard.perk_optimality,
      curio_efficiency: scorecard.curio_efficiency,
      talent_coherence: scorecard.qualitative.talent_coherence?.score ?? null,
      blessing_synergy: scorecard.qualitative.blessing_synergy?.score ?? null,
      role_coverage: scorecard.qualitative.role_coverage?.score ?? null,
      breakpoint_relevance: scorecard.qualitative.breakpoint_relevance?.score ?? null,
      difficulty_scaling: scorecard.qualitative.difficulty_scaling?.score ?? null,
      survivability: scorecard.qualitative.survivability?.score ?? null,
      composite: scorecard.composite_score,
      bot_flags: scorecard.bot_flags ?? [],
    };
  }
  function buildScorecard(build) {
    const idx = getIndex();
    const synergy = analyzeBuild(build, idx);
    const matrix = computeBreakpoints(build, idx, getCalcData());
    const survivability =
      build.class && typeof build.class === "object"
        ? {
            profile: computeSurvivability(build, idx, { difficulty: "damnation" }),
            baseline: computeSurvivability(
              {
                class: build.class,
                ability: null,
                blitz: null,
                aura: null,
                keystone: null,
                talents: [],
                weapons: [],
                curios: [],
              },
              idx,
              { difficulty: "damnation" },
            ),
          }
        : null;
    return generateScorecard(build, synergy, { matrix }, survivability);
  }
  function scoreDeltaVector(before, after) {
    const original = scoreVector(before);
    const modified = scoreVector(after);
    return {
      perk_optimality: modified.perk_optimality - original.perk_optimality,
      curio_efficiency: modified.curio_efficiency - original.curio_efficiency,
      talent_coherence: modified.talent_coherence - original.talent_coherence,
      blessing_synergy: modified.blessing_synergy - original.blessing_synergy,
      role_coverage: modified.role_coverage - original.role_coverage,
      breakpoint_relevance: modified.breakpoint_relevance - original.breakpoint_relevance,
      difficulty_scaling: modified.difficulty_scaling - original.difficulty_scaling,
      survivability: modified.survivability - original.survivability,
      composite: modified.composite - original.composite,
    };
  }
  function botFlagDelta(before, after) {
    const beforeFlags = new Set(before.bot_flags ?? []);
    const afterFlags = new Set(after.bot_flags ?? []);
    return {
      added: [...afterFlags].filter((flag) => !beforeFlags.has(flag)),
      removed: [...beforeFlags].filter((flag) => !afterFlags.has(flag)),
    };
  }

  describe("analyzeGaps", () => {
    it("returns gap analysis for a real build", () => {
      const build = JSON.parse(readFileSync("data/builds/09-psyker-2026.json", "utf-8"));
      const result = analyzeGaps(build, getIndex());
      assert.ok(Array.isArray(result.gaps));
      assert.ok(Array.isArray(result.underinvested_families));
      assert.ok(result.scorecard !== undefined);
      assert.ok(typeof result.scorecard.composite_score === "number");
    });

    it("identifies underinvested families", () => {
      const build = JSON.parse(readFileSync("data/builds/09-psyker-2026.json", "utf-8"));
      const result = analyzeGaps(build, getIndex());
      for (const fam of result.underinvested_families) {
        assert.ok(typeof fam === "string");
      }
    });

    it("returns structured gap entries with type and suggested_families", () => {
      const build = JSON.parse(readFileSync("data/builds/05-zealot-meta-havoc40.json", "utf-8"));
      const result = analyzeGaps(build, getIndex());
      for (const gap of result.gaps) {
        assert.ok(typeof gap.type === "string");
        assert.ok(typeof gap.reason === "string");
        assert.ok(Array.isArray(gap.suggested_families));
      }
    });

    it("includes full scorecard with perk and qualitative scores", () => {
      const build = JSON.parse(readFileSync("data/builds/09-psyker-2026.json", "utf-8"));
      const result = analyzeGaps(build, getIndex());
      assert.ok(typeof result.scorecard.perk_optimality === "number");
      assert.ok(typeof result.scorecard.letter_grade === "string");
    });

    it("accepts precomputed synergy and scorecard", () => {
      const build = JSON.parse(readFileSync("data/builds/09-psyker-2026.json", "utf-8"));
      const idx = getIndex();
      const synergy = analyzeBuild(build, idx);
      const scorecard = generateScorecard(build, synergy);

      const result = analyzeGaps(build, idx, { synergy, scorecard });
      assert.ok(result.scorecard === scorecard); // same reference, not recomputed
    });

    it("matches calculator-backed scorecard output for a live zealot build", () => {
      const build = JSON.parse(readFileSync("data/builds/05-zealot-meta-havoc40.json", "utf-8"));

      const result = analyzeGaps(build, getIndex());
      const expected = buildScorecard(build);

      assert.deepEqual(scoreVector(result.scorecard), scoreVector(expected));
    });

    it("matches calculator-backed scorecard output for a synced BetterBots build", () => {
      const build = JSON.parse(readFileSync("data/builds/bot/bot-veteran.json", "utf-8"));

      const result = analyzeGaps(build, getIndex());
      const expected = buildScorecard(build);

      assert.deepEqual(scoreVector(result.scorecard), scoreVector(expected));
    });
  });

  describe("validateTreeReachability", () => {
    it("validates a reachable talent (parent in build)", () => {
      // psyker_ability_increase_brain_burst_speed's parent is psyker_brain_burst_improved (in Gandalf build)
      const build = JSON.parse(readFileSync("data/builds/09-psyker-2026.json", "utf-8"));
      const result = validateTreeReachability(
        build, getIndex(),
        "psyker.talent_modifier.psyker_ability_increase_brain_burst_speed"
      );
      assert.equal(result.reachable, true);
      assert.equal(result.reason, "parent selected in build");
    });

    it("rejects unreachable talent (parent not in build)", () => {
      // psyker_chain_lightning_heavy_attacks's parent is psyker_grenade_chain_lightning (NOT in build 09)
      const build = JSON.parse(readFileSync("data/builds/09-psyker-2026.json", "utf-8"));
      const result = validateTreeReachability(
        build, getIndex(),
        "psyker.talent_modifier.psyker_chain_lightning_heavy_attacks"
      );
      assert.equal(result.reachable, false);
      assert.ok(result.reason.includes("parent not in build"));
      assert.ok(result.reason.includes("psyker.ability.psyker_grenade_chain_lightning"));
    });

    it("rejects unreachable talent on empty build", () => {
      // Deep talent with no parents selected
      const emptyBuild = {
        class: { canonical_entity_id: "shared.class.psyker", raw_label: "psyker", resolution_status: "resolved" },
        talents: [], ability: null, blitz: null, aura: null, keystone: null,
        weapons: [], curios: [],
      };
      const result = validateTreeReachability(
        emptyBuild, getIndex(),
        "psyker.talent_modifier.psyker_ability_increase_brain_burst_speed"
      );
      assert.equal(result.reachable, false);
      assert.ok(result.reason.includes("parent not in build"));
    });

    it("treats root-adjacent talents as always reachable", () => {
      // psyker_toughness_on_warp_kill is a direct child of the structural root (no talent on root)
      // Use empty build — should still be reachable since parent is structural root
      const emptyBuild = {
        class: { canonical_entity_id: "shared.class.psyker", raw_label: "psyker", resolution_status: "resolved" },
        talents: [], ability: null, blitz: null, aura: null, keystone: null,
        weapons: [], curios: [],
      };
      const result = validateTreeReachability(
        emptyBuild, getIndex(),
        "psyker.talent.psyker_toughness_on_warp_kill"
      );
      assert.equal(result.reachable, true);
      assert.equal(result.reason, "parent is structural root");
    });

    it("rejects talent with exclusive_with conflict", () => {
      // Build with psyker_crits_regen_toughness_movement_speed selected;
      // psyker_toughness_on_vent is exclusive_with it
      const build = {
        class: { canonical_entity_id: "shared.class.psyker", raw_label: "psyker", resolution_status: "resolved" },
        talents: [{
          canonical_entity_id: "psyker.talent.psyker_crits_regen_toughness_movement_speed",
          raw_label: "Crits Regen Toughness",
          resolution_status: "resolved",
        }],
        ability: null, blitz: null, aura: null, keystone: null,
        weapons: [], curios: [],
      };
      const result = validateTreeReachability(
        build, getIndex(),
        "psyker.talent.psyker_toughness_on_vent"
      );
      assert.equal(result.reachable, false);
      assert.ok(result.reason.includes("exclusive_with conflict"));
      assert.ok(result.reason.includes("psyker.talent.psyker_crits_regen_toughness_movement_speed"));
    });

    it("returns reachable for talent with no tree mapping", () => {
      const build = JSON.parse(readFileSync("data/builds/09-psyker-2026.json", "utf-8"));
      const result = validateTreeReachability(
        build, getIndex(),
        "psyker.talent.nonexistent_xyz"
      );
      assert.equal(result.reachable, true);
      assert.equal(result.reason, "no tree mapping for talent");
    });
  });

  describe("swapTalent", () => {
    it("returns valid delta for a legal talent swap", () => {
      const build = JSON.parse(readFileSync("data/builds/09-psyker-2026.json", "utf-8"));
      // psyker_crits_empower_next_attack and base_toughness_node_buff_medium_5 are siblings
      const result = swapTalent(
        build, getIndex(),
        "psyker.talent.psyker_crits_empower_next_attack",
        "psyker.talent.base_toughness_node_buff_medium_5"
      );
      assert.equal(result.valid, true);
      assert.ok(typeof result.score_delta.talent_coherence === "number");
      assert.ok(typeof result.score_delta.blessing_synergy === "number");
      assert.ok(typeof result.score_delta.role_coverage === "number");
      assert.ok(typeof result.score_delta.survivability === "number");
      assert.ok(typeof result.score_delta.composite === "number");
      assert.ok(Array.isArray(result.gained_edges));
      assert.ok(Array.isArray(result.lost_edges));
      assert.ok(Array.isArray(result.resolved_orphans));
      assert.ok(Array.isArray(result.new_orphans));
    });

    it("returns full calculator-backed score deltas for a legal talent swap", () => {
      const build = JSON.parse(readFileSync("data/builds/09-psyker-2026.json", "utf-8"));
      const modifiedBuild = JSON.parse(JSON.stringify(build));
      const swapIndex = modifiedBuild.talents.findIndex(
        (talent) => talent.canonical_entity_id === "psyker.talent.psyker_crits_empower_next_attack"
      );
      modifiedBuild.talents[swapIndex] = {
        canonical_entity_id: "psyker.talent.base_toughness_node_buff_medium_5",
        raw_label: "psyker.talent.base_toughness_node_buff_medium_5",
        resolution_status: "resolved",
      };

      const result = swapTalent(
        build, getIndex(),
        "psyker.talent.psyker_crits_empower_next_attack",
        "psyker.talent.base_toughness_node_buff_medium_5"
      );

      assert.deepEqual(result.score_delta, scoreDeltaVector(buildScorecard(build), buildScorecard(modifiedBuild)));
    });

    it("reports bot flag deltas for a talent swap", () => {
      const build = {
        title: "Talent Bot Flag Delta",
        class: { canonical_entity_id: "shared.class.zealot", raw_label: "zealot", resolution_status: "resolved" },
        ability: { raw_label: "Fury Of The Faithful", canonical_entity_id: "zealot.ability.zealot_dash", resolution_status: "resolved" },
        blitz: { raw_label: "Throwing Knives", canonical_entity_id: "zealot.ability.zealot_throwing_knives", resolution_status: "resolved" },
        aura: { raw_label: "Benediction", canonical_entity_id: "zealot.aura.zealot_toughness_damage_reduction_coherency_improved", resolution_status: "resolved" },
        keystone: null,
        talents: [
          {
            raw_label: "Dance Of Death",
            canonical_entity_id: "zealot.talent.zealot_stacking_melee_damage_after_dodge",
            resolution_status: "resolved",
          },
        ],
        weapons: [],
        curios: [],
      };
      const modifiedBuild = JSON.parse(JSON.stringify(build));
      modifiedBuild.talents[0] = {
        raw_label: "Toughness Boost",
        canonical_entity_id: "shared.stat_node.toughness_boost",
        resolution_status: "resolved",
      };

      const result = swapTalent(
        build,
        getIndex(),
        "zealot.talent.zealot_stacking_melee_damage_after_dodge",
        "shared.stat_node.toughness_boost"
      );

      assert.equal(result.valid, true);
      assert.deepEqual(result.bot_flag_delta, botFlagDelta(buildScorecard(build), buildScorecard(modifiedBuild)));
    });

    it("returns invalid for talent not in build", () => {
      const build = JSON.parse(readFileSync("data/builds/09-psyker-2026.json", "utf-8"));
      const result = swapTalent(
        build, getIndex(),
        "psyker.talent.not_in_this_build",
        "psyker.talent.base_toughness_node_buff_medium_5"
      );
      assert.equal(result.valid, false);
      assert.ok(result.reason.includes("not found"));
    });

    it("returns invalid for unreachable new talent", () => {
      const build = JSON.parse(readFileSync("data/builds/09-psyker-2026.json", "utf-8"));
      // psyker_chain_lightning_heavy_attacks's parent (psyker_grenade_chain_lightning) is not in the build
      const result = swapTalent(
        build, getIndex(),
        "psyker.talent.psyker_crits_empower_next_attack",
        "psyker.talent_modifier.psyker_chain_lightning_heavy_attacks"
      );
      assert.equal(result.valid, false);
    });
  });

  describe("swapWeapon", () => {
    it("returns delta with blessing impact for same-family swap", () => {
      const build = JSON.parse(readFileSync("data/builds/09-psyker-2026.json", "utf-8"));
      // forcesword_2h_p1_m1 → forcesword_2h_p1_m2 (both forcesword_2h family)
      const result = swapWeapon(
        build, getIndex(),
        "shared.weapon.forcesword_2h_p1_m1",
        "shared.weapon.forcesword_2h_p1_m2"
      );
      assert.equal(result.valid, true);
      assert.ok(result.blessing_impact);
      assert.ok(Array.isArray(result.blessing_impact.retained));
      assert.ok(Array.isArray(result.blessing_impact.removed));
      assert.ok(Array.isArray(result.blessing_impact.available));
      // Same family = all resolved blessings retained, none removed
      // Build 09 forcesword now has 2 resolved blessings (Wrath, Unstable Power)
      assert.equal(result.blessing_impact.removed.length, 0);
      assert.equal(result.blessing_impact.retained.length, 2);
    });

    it("removes blessings for cross-family swap", () => {
      const build = JSON.parse(readFileSync("data/builds/09-psyker-2026.json", "utf-8"));
      // forcesword_2h_p1_m1 (forcesword_2h) → powersword_2h_p1_m1 (powersword_2h) — different families
      const result = swapWeapon(
        build, getIndex(),
        "shared.weapon.forcesword_2h_p1_m1",
        "shared.weapon.powersword_2h_p1_m1"
      );
      assert.equal(result.valid, true);
      assert.ok(result.blessing_impact.removed.length > 0);
    });

    it("returns score delta", () => {
      const build = JSON.parse(readFileSync("data/builds/09-psyker-2026.json", "utf-8"));
      // Same-family swap for predictable results
      const result = swapWeapon(
        build, getIndex(),
        "shared.weapon.forcesword_2h_p1_m1",
        "shared.weapon.forcesword_2h_p1_m2"
      );
      assert.ok(typeof result.score_delta.blessing_synergy === "number");
      assert.ok(typeof result.score_delta.talent_coherence === "number");
      assert.ok(typeof result.score_delta.role_coverage === "number");
      assert.ok(typeof result.score_delta.survivability === "number");
      assert.ok(typeof result.score_delta.composite === "number");
    });

    it("returns full calculator-backed score deltas for a weapon swap", () => {
      const build = JSON.parse(readFileSync("data/builds/09-psyker-2026.json", "utf-8"));
      const modifiedBuild = JSON.parse(JSON.stringify(build));
      const weapon = modifiedBuild.weapons.find((entry) => entry.name.canonical_entity_id === "shared.weapon.forcesword_2h_p1_m1");
      weapon.name.canonical_entity_id = "shared.weapon.forcesword_2h_p1_m2";
      weapon.name.raw_label = "shared.weapon.forcesword_2h_p1_m2";

      const result = swapWeapon(
        build, getIndex(),
        "shared.weapon.forcesword_2h_p1_m1",
        "shared.weapon.forcesword_2h_p1_m2"
      );

      assert.deepEqual(result.score_delta, scoreDeltaVector(buildScorecard(build), buildScorecard(modifiedBuild)));
    });

    it("returns invalid for weapon not in build", () => {
      const build = JSON.parse(readFileSync("data/builds/09-psyker-2026.json", "utf-8"));
      const result = swapWeapon(
        build, getIndex(),
        "shared.weapon.fake_weapon",
        "shared.weapon.also_fake"
      );
      assert.equal(result.valid, false);
      assert.ok(result.reason.includes("not found"));
    });

    it("returns gained/lost synergy edges", () => {
      const build = JSON.parse(readFileSync("data/builds/09-psyker-2026.json", "utf-8"));
      const result = swapWeapon(
        build, getIndex(),
        "shared.weapon.forcesword_2h_p1_m1",
        "shared.weapon.powersword_2h_p1_m1"
      );
      assert.equal(result.valid, true);
      assert.ok(Array.isArray(result.gained_edges));
      assert.ok(Array.isArray(result.lost_edges));
    });

    it("populates available blessings for new weapon", () => {
      const build = JSON.parse(readFileSync("data/builds/09-psyker-2026.json", "utf-8"));
      // forcesword_2h_p1_m2 has weapon_has_trait_pool edges → should have available blessings
      const result = swapWeapon(
        build, getIndex(),
        "shared.weapon.forcesword_2h_p1_m1",
        "shared.weapon.forcesword_2h_p1_m2"
      );
      assert.equal(result.valid, true);
      assert.ok(Array.isArray(result.blessing_impact.available));
      assert.ok(result.blessing_impact.available.length > 0);
    });

    it("reports bot flag deltas for a weapon swap", () => {
      const build = {
        title: "Weapon Bot Flag Delta",
        class: { canonical_entity_id: "shared.class.psyker", raw_label: "psyker", resolution_status: "resolved" },
        ability: { raw_label: "Scrier's Gaze", canonical_entity_id: "psyker.ability.psyker_combat_ability_stance", resolution_status: "resolved" },
        blitz: { raw_label: "Brain Rupture", canonical_entity_id: "psyker.ability.psyker_brain_burst_improved", resolution_status: "resolved" },
        aura: { raw_label: "Seers Presence", canonical_entity_id: "psyker.aura.psyker_cooldown_aura_improved", resolution_status: "resolved" },
        keystone: null,
        talents: [],
        weapons: [
          {
            name: {
              raw_label: "Deimos Mk IV Blaze Force Sword",
              canonical_entity_id: "shared.weapon.forcesword_p1_m1",
              resolution_status: "resolved",
            },
            slot: "melee",
            perks: [],
            blessings: [
              {
                raw_label: "Riposte",
                canonical_entity_id: "shared.name_family.blessing.riposte",
                resolution_status: "resolved",
              },
            ],
          },
        ],
        curios: [],
      };
      const modifiedBuild = JSON.parse(JSON.stringify(build));
      modifiedBuild.weapons[0].name = {
        raw_label: "Munitorum Mk VI Power Sword",
        canonical_entity_id: "shared.weapon.powersword_p1_m1",
        resolution_status: "resolved",
      };
      modifiedBuild.weapons[0].blessings = [];

      const result = swapWeapon(
        build,
        getIndex(),
        "shared.weapon.forcesword_p1_m1",
        "shared.weapon.powersword_p1_m1"
      );

      assert.equal(result.valid, true);
      assert.deepEqual(result.bot_flag_delta, botFlagDelta(buildScorecard(build), buildScorecard(modifiedBuild)));
    });

    // --- Ranged parity -------------------------------------------------------
    // Mirrors the melee swap suite. The branch name `feat/ranged-recommend-parity`
    // asserts that ranged swaps produce identically-shaped output. See review H8.
    it("ranged: preserves same-family blessings on a ranged weapon swap", () => {
      const build = JSON.parse(readFileSync("data/builds/03-veteran-sharpshooter-2026.json", "utf-8"));
      const result = swapWeapon(
        build, getIndex(),
        "shared.weapon.lasgun_p1_m3",
        "shared.weapon.lasgun_p1_m2",
      );
      assert.equal(result.valid, true);
      assert.ok(Array.isArray(result.blessing_impact.retained));
      assert.ok(Array.isArray(result.blessing_impact.removed));
      assert.ok(Array.isArray(result.blessing_impact.available));
      // Same family (lasgun_p1) — blessings are retained.
      assert.equal(result.blessing_impact.removed.length, 0);
      assert.equal(result.blessing_impact.retained.length, 2);
    });

    it("ranged: removes blessings for a cross-family ranged swap", () => {
      const build = JSON.parse(readFileSync("data/builds/03-veteran-sharpshooter-2026.json", "utf-8"));
      // lasgun_p1 → lasgun_p3 is a different weapon family.
      const result = swapWeapon(
        build, getIndex(),
        "shared.weapon.lasgun_p1_m3",
        "shared.weapon.lasgun_p3_m1",
      );
      assert.equal(result.valid, true);
      assert.ok(result.blessing_impact.removed.length > 0);
    });

    it("ranged: returns shape-identical score delta for a ranged swap", () => {
      const build = JSON.parse(readFileSync("data/builds/03-veteran-sharpshooter-2026.json", "utf-8"));
      const result = swapWeapon(
        build, getIndex(),
        "shared.weapon.lasgun_p1_m3",
        "shared.weapon.lasgun_p1_m2",
      );
      assert.ok(typeof result.score_delta.blessing_synergy === "number");
      assert.ok(typeof result.score_delta.talent_coherence === "number");
      assert.ok(typeof result.score_delta.role_coverage === "number");
      assert.ok(typeof result.score_delta.survivability === "number");
      assert.ok(typeof result.score_delta.composite === "number");
    });

    it("ranged: score delta matches an independently computed scorecard diff", () => {
      const build = JSON.parse(readFileSync("data/builds/03-veteran-sharpshooter-2026.json", "utf-8"));
      const modifiedBuild = JSON.parse(JSON.stringify(build));
      const weapon = modifiedBuild.weapons.find(
        (entry) => entry.name.canonical_entity_id === "shared.weapon.lasgun_p1_m3",
      );
      weapon.name.canonical_entity_id = "shared.weapon.lasgun_p1_m2";
      weapon.name.raw_label = "shared.weapon.lasgun_p1_m2";

      const result = swapWeapon(
        build, getIndex(),
        "shared.weapon.lasgun_p1_m3",
        "shared.weapon.lasgun_p1_m2",
      );
      assert.deepEqual(
        result.score_delta,
        scoreDeltaVector(buildScorecard(build), buildScorecard(modifiedBuild)),
      );
    });

    it("ranged: populates available blessings for new ranged weapon", () => {
      const build = JSON.parse(readFileSync("data/builds/03-veteran-sharpshooter-2026.json", "utf-8"));
      const result = swapWeapon(
        build, getIndex(),
        "shared.weapon.lasgun_p1_m3",
        "shared.weapon.lasgun_p1_m2",
      );
      assert.equal(result.valid, true);
      assert.ok(result.blessing_impact.available.length > 0);
    });

    it("ranged: returns gained/lost synergy edges for a cross-family ranged swap", () => {
      const build = JSON.parse(readFileSync("data/builds/03-veteran-sharpshooter-2026.json", "utf-8"));
      const result = swapWeapon(
        build, getIndex(),
        "shared.weapon.lasgun_p1_m3",
        "shared.weapon.lasgun_p3_m1",
      );
      assert.equal(result.valid, true);
      assert.ok(Array.isArray(result.gained_edges));
      assert.ok(Array.isArray(result.lost_edges));
    });
  });
});
