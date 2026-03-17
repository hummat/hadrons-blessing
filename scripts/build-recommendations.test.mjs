import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { analyzeGaps, validateTreeReachability } from "./ground-truth/lib/build-recommendations.mjs";
import { loadIndex, analyzeBuild } from "./ground-truth/lib/synergy-model.mjs";
import { generateScorecard } from "./score-build.mjs";

const HAS_SOURCE = !!process.env.GROUND_TRUTH_SOURCE_ROOT;

describe("build-recommendations", { skip: !HAS_SOURCE && "requires GROUND_TRUTH_SOURCE_ROOT" }, () => {
  let index;
  function getIndex() {
    if (!index) index = loadIndex();
    return index;
  }

  describe("analyzeGaps", () => {
    it("returns gap analysis for a real build", () => {
      const build = JSON.parse(readFileSync("scripts/builds/08-gandalf-melee-wizard.json", "utf-8"));
      const result = analyzeGaps(build, getIndex());
      assert.ok(Array.isArray(result.gaps));
      assert.ok(Array.isArray(result.underinvested_families));
      assert.ok(result.scorecard !== undefined);
      assert.ok(typeof result.scorecard.composite_score === "number");
    });

    it("identifies underinvested families", () => {
      const build = JSON.parse(readFileSync("scripts/builds/08-gandalf-melee-wizard.json", "utf-8"));
      const result = analyzeGaps(build, getIndex());
      for (const fam of result.underinvested_families) {
        assert.ok(typeof fam === "string");
      }
    });

    it("returns structured gap entries with type and suggested_families", () => {
      const build = JSON.parse(readFileSync("scripts/builds/04-spicy-meta-zealot.json", "utf-8"));
      const result = analyzeGaps(build, getIndex());
      for (const gap of result.gaps) {
        assert.ok(typeof gap.type === "string");
        assert.ok(typeof gap.reason === "string");
        assert.ok(Array.isArray(gap.suggested_families));
      }
    });

    it("includes full scorecard with perk and qualitative scores", () => {
      const build = JSON.parse(readFileSync("scripts/builds/08-gandalf-melee-wizard.json", "utf-8"));
      const result = analyzeGaps(build, getIndex());
      assert.ok(typeof result.scorecard.perk_optimality === "number");
      assert.ok(typeof result.scorecard.letter_grade === "string");
    });

    it("accepts precomputed synergy and scorecard", () => {
      const build = JSON.parse(readFileSync("scripts/builds/08-gandalf-melee-wizard.json", "utf-8"));
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
      const build = JSON.parse(readFileSync("scripts/builds/08-gandalf-melee-wizard.json", "utf-8"));
      const result = validateTreeReachability(
        build, getIndex(),
        "psyker.talent_modifier.psyker_ability_increase_brain_burst_speed"
      );
      assert.equal(result.reachable, true);
      assert.equal(result.reason, "parent selected in build");
    });

    it("rejects unreachable talent (parent not in build)", () => {
      // base_crit_chance_node_buff_low_1's parent is psyker_spread_warpfire_on_kill (NOT in Gandalf build)
      const build = JSON.parse(readFileSync("scripts/builds/08-gandalf-melee-wizard.json", "utf-8"));
      const result = validateTreeReachability(
        build, getIndex(),
        "psyker.talent.base_crit_chance_node_buff_low_1"
      );
      assert.equal(result.reachable, false);
      assert.ok(result.reason.includes("parent not in build"));
      assert.ok(result.reason.includes("psyker.talent.psyker_spread_warpfire_on_kill"));
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
      const build = JSON.parse(readFileSync("scripts/builds/08-gandalf-melee-wizard.json", "utf-8"));
      const result = validateTreeReachability(
        build, getIndex(),
        "psyker.talent.nonexistent_xyz"
      );
      assert.equal(result.reachable, true);
      assert.equal(result.reason, "no tree mapping for talent");
    });
  });
});
