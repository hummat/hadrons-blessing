import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { analyzeGaps, validateTreeReachability, swapTalent, swapWeapon } from "./build-recommendations.js";
import { loadIndex, analyzeBuild } from "./synergy-model.js";
import { generateScorecard } from "./score-build.js";

const HAS_SOURCE = !!process.env.GROUND_TRUTH_SOURCE_ROOT;

describe("build-recommendations", { skip: !HAS_SOURCE && "requires GROUND_TRUTH_SOURCE_ROOT" }, () => {
  let index;
  function getIndex() {
    if (!index) index = loadIndex();
    return index;
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
      assert.ok(typeof result.score_delta.composite === "number");
      assert.ok(Array.isArray(result.gained_edges));
      assert.ok(Array.isArray(result.lost_edges));
      assert.ok(Array.isArray(result.resolved_orphans));
      assert.ok(Array.isArray(result.new_orphans));
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
      assert.ok(typeof result.score_delta.composite === "number");
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
  });
});
