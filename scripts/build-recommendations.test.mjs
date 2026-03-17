import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { analyzeGaps } from "./ground-truth/lib/build-recommendations.mjs";
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
});
