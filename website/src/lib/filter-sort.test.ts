import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filterAndSort } from "./filter-sort.ts";
import type { BuildSummary } from "./types.ts";

function makeBuild(overrides: Partial<BuildSummary> = {}): BuildSummary {
  return {
    file: "test.json",
    title: "Test Build",
    class: "veteran",
    ability: null,
    keystone: null,
    weapons: [],
    scores: {
      composite: 20,
      grade: "B",
      perk_optimality: 3,
      curio_efficiency: 3,
      talent_coherence: null,
      blessing_synergy: null,
      role_coverage: null,
      breakpoint_relevance: null,
      difficulty_scaling: null,
    },
    ...overrides,
  };
}

describe("filterAndSort", () => {
  it("returns all builds with no filters", () => {
    const builds = [makeBuild(), makeBuild(), makeBuild()];
    const result = filterAndSort(builds, {});
    assert.equal(result.length, 3);
  });

  it("filters by class (case-insensitive)", () => {
    const builds = [
      makeBuild({ class: "veteran" }),
      makeBuild({ class: "psyker" }),
      makeBuild({ class: "veteran" }),
    ];
    const result = filterAndSort(builds, { class: "Veteran" });
    assert.equal(result.length, 2);
    assert.ok(result.every((b) => b.class === "veteran"));
  });

  it("filters by weapon name substring", () => {
    const builds = [
      makeBuild({
        weapons: [{ name: "Vraks Mk VII Headhunter Autogun", slot: "ranged", family: "autogun_p1" }],
      }),
      makeBuild({
        weapons: [{ name: "Indignatus Mk IVe Crusher", slot: "melee", family: "thunderhammer_2h" }],
      }),
    ];
    const result = filterAndSort(builds, { weapon: "autogun" });
    assert.equal(result.length, 1);
    assert.ok(result[0].weapons[0].name.includes("Autogun"));
  });

  it("filters by weapon family", () => {
    const builds = [
      makeBuild({
        weapons: [{ name: "Some Autogun", slot: "ranged", family: "autogun_p1" }],
      }),
      makeBuild({
        weapons: [{ name: "Some Axe", slot: "melee", family: "combataxe_p1" }],
      }),
    ];
    const result = filterAndSort(builds, { weapon: "autogun" });
    assert.equal(result.length, 1);
  });

  it("filters by minimum grade", () => {
    const builds = [
      makeBuild({ scores: { ...makeBuild().scores, grade: "A", composite: 28 } }),
      makeBuild({ scores: { ...makeBuild().scores, grade: "C", composite: 18 } }),
      makeBuild({ scores: { ...makeBuild().scores, grade: "B", composite: 23 } }),
    ];
    const result = filterAndSort(builds, { minGrade: "B" });
    assert.equal(result.length, 2);
    assert.ok(result.every((b) => ["S", "A", "B"].includes(b.scores.grade)));
  });

  it("sorts by composite descending by default", () => {
    const builds = [
      makeBuild({ scores: { ...makeBuild().scores, composite: 20 } }),
      makeBuild({ scores: { ...makeBuild().scores, composite: 30 } }),
      makeBuild({ scores: { ...makeBuild().scores, composite: 25 } }),
    ];
    const result = filterAndSort(builds, { sort: "composite" });
    assert.deepEqual(
      result.map((b) => b.scores.composite),
      [30, 25, 20],
    );
  });

  it("sorts by a dimension key", () => {
    const builds = [
      makeBuild({ scores: { ...makeBuild().scores, perk_optimality: 2 } }),
      makeBuild({ scores: { ...makeBuild().scores, perk_optimality: 5 } }),
      makeBuild({ scores: { ...makeBuild().scores, perk_optimality: 3 } }),
    ];
    const result = filterAndSort(builds, { sort: "perk_optimality" });
    assert.deepEqual(
      result.map((b) => b.scores.perk_optimality),
      [5, 3, 2],
    );
  });

  it("puts null scores last when sorting", () => {
    const builds = [
      makeBuild({ scores: { ...makeBuild().scores, talent_coherence: null } }),
      makeBuild({ scores: { ...makeBuild().scores, talent_coherence: 3 } }),
      makeBuild({ scores: { ...makeBuild().scores, talent_coherence: 1 } }),
    ];
    const result = filterAndSort(builds, { sort: "talent_coherence" });
    assert.equal(result[0].scores.talent_coherence, 3);
    assert.equal(result[1].scores.talent_coherence, 1);
    assert.equal(result[2].scores.talent_coherence, null);
  });

  it("reverses sort order", () => {
    const builds = [
      makeBuild({ scores: { ...makeBuild().scores, composite: 20 } }),
      makeBuild({ scores: { ...makeBuild().scores, composite: 30 } }),
    ];
    const result = filterAndSort(builds, { sort: "composite", reverse: true });
    assert.deepEqual(
      result.map((b) => b.scores.composite),
      [20, 30],
    );
  });

  it("combines filters", () => {
    const builds = [
      makeBuild({ class: "veteran", scores: { ...makeBuild().scores, grade: "A", composite: 28 } }),
      makeBuild({ class: "psyker", scores: { ...makeBuild().scores, grade: "A", composite: 29 } }),
      makeBuild({ class: "veteran", scores: { ...makeBuild().scores, grade: "D", composite: 12 } }),
    ];
    const result = filterAndSort(builds, { class: "veteran", minGrade: "B" });
    assert.equal(result.length, 1);
    assert.equal(result[0].class, "veteran");
    assert.equal(result[0].scores.grade, "A");
  });

  it("does not mutate the input array", () => {
    const builds = [
      makeBuild({ scores: { ...makeBuild().scores, composite: 20 } }),
      makeBuild({ scores: { ...makeBuild().scores, composite: 30 } }),
    ];
    const original = [...builds];
    filterAndSort(builds, { sort: "composite" });
    assert.equal(builds[0].scores.composite, original[0].scores.composite);
  });
});
