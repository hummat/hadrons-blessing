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

    it("filters by class", () => {
      const results = listBuilds(BUILDS_DIR, { class: "psyker" });
      assert.ok(results.length > 0, "should have psyker builds");
      assert.ok(results.every((r) => r.class === "psyker"), "all should be psyker");
    });

    it("filters by class case-insensitively", () => {
      const lower = listBuilds(BUILDS_DIR, { class: "psyker" });
      const upper = listBuilds(BUILDS_DIR, { class: "Psyker" });
      assert.equal(lower.length, upper.length);
    });

    it("filters by weapon name substring", () => {
      const results = listBuilds(BUILDS_DIR, { weapon: "bolter" });
      assert.ok(results.length > 0, "should have bolter builds");
      assert.ok(
        results.every((r) => r.weapons.some((w) =>
          w.name.toLowerCase().includes("bolter") ||
          (w.family && w.family.toLowerCase().includes("bolter"))
        )),
        "all should have a bolter weapon",
      );
    });

    it("filters by minimum grade", () => {
      const results = listBuilds(BUILDS_DIR, { minGrade: "A" });
      assert.ok(results.length > 0, "should have A+ builds");
      assert.ok(results.every((r) => ["S", "A"].includes(r.scores.grade)), "all should be A or S");
    });

    it("sorts by composite descending by default", () => {
      const results = listBuilds(BUILDS_DIR);
      for (let i = 1; i < results.length; i++) {
        assert.ok(
          results[i - 1].scores.composite >= results[i].scores.composite,
          `should be descending: ${results[i - 1].scores.composite} >= ${results[i].scores.composite}`,
        );
      }
    });

    it("sorts ascending with reverse flag", () => {
      const results = listBuilds(BUILDS_DIR, { reverse: true });
      for (let i = 1; i < results.length; i++) {
        assert.ok(
          results[i - 1].scores.composite <= results[i].scores.composite,
          `should be ascending: ${results[i - 1].scores.composite} <= ${results[i].scores.composite}`,
        );
      }
    });

    it("sorts by a specific dimension", () => {
      const results = listBuilds(BUILDS_DIR, { sort: "perk_optimality" });
      for (let i = 1; i < results.length; i++) {
        assert.ok(
          results[i - 1].scores.perk_optimality >= results[i].scores.perk_optimality,
          "should sort by perk_optimality descending",
        );
      }
    });

    it("rejects invalid sort key", () => {
      assert.throws(
        () => listBuilds(BUILDS_DIR, { sort: "nonexistent" }),
        /Invalid sort key/,
      );
    });

    it("returns empty array when no builds match filter", () => {
      const results = listBuilds(BUILDS_DIR, { class: "nonexistent_class" });
      assert.equal(results.length, 0);
    });
  });
});
