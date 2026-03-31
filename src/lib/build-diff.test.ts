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
  });
});
