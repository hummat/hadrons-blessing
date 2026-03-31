// src/lib/build-list.test.ts
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { listBuilds } from "./build-list.js";

const BUILDS_DIR = "data/builds";

describe("build-list", () => {
  describe("listBuilds", () => {
    it("loads all 23 builds with valid summaries", () => {
      const results = listBuilds(BUILDS_DIR);
      assert.equal(results.length, 23);

      for (const r of results) {
        assert.ok(r.file.endsWith(".json"), `file should end with .json: ${r.file}`);
        assert.ok(r.title.length > 0, `title should be non-empty: ${r.file}`);
        assert.ok(["veteran", "zealot", "psyker", "ogryn", "arbites", "hive scum"].includes(r.class), `unknown class: ${r.class}`);
        assert.ok(typeof r.scores.composite === "number", `composite should be number: ${r.file}`);
        assert.ok(["S", "A", "B", "C", "D"].includes(r.scores.grade), `invalid grade: ${r.scores.grade}`);
        assert.ok(r.scores.perk_optimality >= 1 && r.scores.perk_optimality <= 5, `perk_optimality out of range: ${r.file}`);
        assert.ok(r.scores.curio_efficiency >= 1 && r.scores.curio_efficiency <= 5, `curio_efficiency out of range: ${r.file}`);
        assert.ok(r.weapons.length > 0, `weapons should be non-empty: ${r.file}`);
      }
    });
  });
});
