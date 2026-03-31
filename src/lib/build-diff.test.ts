import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { diffBuilds } from "./build-diff.js";

const BUILD_08 = "data/builds/08-gandalf-melee-wizard.json";
const BUILD_01 = "data/builds/01-veteran-squad-leader.json";

describe("build-diff", () => {
  describe("diffBuilds", () => {
    it("same-build diff has zero score deltas and everything shared", () => {
      const diff = diffBuilds(BUILD_08, BUILD_08);
      assert.ok(diff.structural.class_match, "same class should match");
      assert.equal(diff.structural.ability.changed, false);
      assert.equal(diff.structural.blitz.changed, false);
      assert.equal(diff.structural.aura.changed, false);
      assert.equal(diff.structural.keystone.changed, false);
      assert.equal(diff.structural.talents.only_a.length, 0);
      assert.equal(diff.structural.talents.only_b.length, 0);
      assert.ok(diff.structural.talents.shared.length > 0, "should have shared talents");
      assert.equal(diff.structural.weapons.only_a.length, 0);
      assert.equal(diff.structural.weapons.only_b.length, 0);

      for (const d of diff.score_deltas) {
        if (d.delta != null) {
          assert.equal(d.delta, 0, `${d.dimension} delta should be 0`);
        }
      }
    });

    it("cross-class diff is flagged", () => {
      const diff = diffBuilds(BUILD_08, BUILD_01);
      assert.equal(diff.structural.class_match, false);
    });

    it("cross-class diff has structural differences", () => {
      const diff = diffBuilds(BUILD_08, BUILD_01);
      assert.ok(diff.structural.ability.changed, "different classes should have different abilities");
      assert.ok(diff.structural.talents.only_a.length > 0, "should have talents only in build A");
      assert.ok(diff.structural.talents.only_b.length > 0, "should have talents only in build B");
    });

    it("analytical diff is null by default", () => {
      const diff = diffBuilds(BUILD_08, BUILD_01);
      assert.equal(diff.analytical, null);
    });

    it("detailed mode produces analytical diff when data is available", () => {
      const diff = diffBuilds(BUILD_08, BUILD_01, { detailed: true });
      if (diff.analytical) {
        assert.ok(Array.isArray(diff.analytical.synergy_edges.only_a));
        assert.ok(Array.isArray(diff.analytical.synergy_edges.only_b));
        assert.ok(Array.isArray(diff.analytical.synergy_edges.shared));
        assert.ok(Array.isArray(diff.analytical.breakpoints));

        for (const bp of diff.analytical.breakpoints) {
          assert.ok(typeof bp.label === "string");
          assert.ok(bp.a_htk === null || typeof bp.a_htk === "number");
          assert.ok(bp.b_htk === null || typeof bp.b_htk === "number");
        }
      }
    });

    it("same-build detailed diff has all synergy edges shared", () => {
      const diff = diffBuilds(BUILD_08, BUILD_08, { detailed: true });
      if (diff.analytical) {
        assert.equal(diff.analytical.synergy_edges.only_a.length, 0);
        assert.equal(diff.analytical.synergy_edges.only_b.length, 0);
        for (const bp of diff.analytical.breakpoints) {
          if (bp.delta != null) {
            assert.equal(bp.delta, 0, `breakpoint ${bp.label} delta should be 0`);
          }
        }
      }
    });
  });
});
