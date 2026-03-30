import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { readdirSync } from "node:fs";
import { generateReport, generateBatchReport } from "./build-report.js";
import { REPO_ROOT } from "./load.js";

const BUILDS_DIR = join(REPO_ROOT, "data", "builds");

describe("generateReport", () => {
  it("produces a BuildReport with correct header for a canonical build", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));
    assert.equal(report.title, "Gandalf: Melee Wizard (Updated for Bound by Duty)");
    assert.equal(report.class, "psyker");
    assert.equal(report.provenance.source_kind, "gameslantern");
    assert.equal(report.provenance.author, "nomalarkey");
  });

  it("produces correct summary counts", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));
    const s = report.summary;
    assert.ok(s.total > 0, "total should be > 0");
    assert.ok(s.resolved > 0, "resolved should be > 0");
    assert.equal(s.ambiguous, 0, "ambiguous should be 0");
    assert.equal(
      s.resolved + s.ambiguous + s.unresolved + s.non_canonical,
      s.total,
      "counts should sum to total",
    );
    assert.ok(Array.isArray(s.warnings), "warnings should be an array");
  });

  it("populates structural slots", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));
    assert.ok(Array.isArray(report.slots), "slots should be an array");
    for (const slotName of ["ability", "blitz", "aura", "keystone"]) {
      const entry = report.slots.find((s) => s.slot === slotName);
      assert.ok(entry, `slot ${slotName} should exist`);
      assert.ok(typeof entry.label === "string", `${slotName}.label should be string`);
      assert.ok(typeof entry.status === "string", `${slotName}.status should be string`);
    }
  });

  it("populates weapons with perks and blessings", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));
    assert.equal(report.weapons.length, 2, "should have 2 weapons");
    const melee = report.weapons.find((w) => w.slot === "melee");
    const ranged = report.weapons.find((w) => w.slot === "ranged");
    assert.ok(melee, "should have melee weapon");
    assert.ok(ranged, "should have ranged weapon");
    assert.ok(Array.isArray(melee.perks), "melee should have perks array");
    assert.ok(Array.isArray(melee.blessings), "melee should have blessings array");
    assert.ok(Array.isArray(ranged.perks), "ranged should have perks array");
    assert.ok(Array.isArray(ranged.blessings), "ranged should have blessings array");
  });

  it("includes scoring data", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));
    assert.ok(typeof report.perk_optimality === "number", "perk_optimality should be a number");
    assert.ok(report.perk_optimality >= 1 && report.perk_optimality <= 5, "perk_optimality should be 1-5");
    assert.ok(typeof report.curio_score === "number", "curio_score should be a number");
    assert.ok(report.curio_score >= 1 && report.curio_score <= 5, "curio_score should be 1-5");
  });

  it("lists unresolved entries in problems", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));
    assert.ok(report.unresolved.length > 0, "build 08 should have unresolved curio names");
    for (const entry of report.unresolved) {
      assert.ok(typeof entry.field === "string", "unresolved entry should have field");
      assert.ok(typeof entry.label === "string", "unresolved entry should have label");
    }
  });

  it("lists non_canonical entries when present", async () => {
    const report = await generateReport(join(BUILDS_DIR, "07-zealot-infodump.json"));
    assert.ok(report.non_canonical.length > 0, "build 07 should have non_canonical entries");
  });

  it("includes keystone slot even when null", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));
    const keystone = report.slots.find((s) => s.slot === "keystone");
    assert.ok(keystone, "keystone slot should exist");
  });

  it("normalizes blessing fields to { label, known }", async () => {
    // Build 07 has weapons with blessing scoring data (combat sword)
    const report = await generateReport(join(BUILDS_DIR, "07-zealot-infodump.json"));
    const weapon = report.weapons.find((w) => w.blessings.length > 0);
    assert.ok(weapon, "should find weapon with blessings");
    for (const b of weapon.blessings) {
      assert.ok(typeof b.label === "string", "blessing should have label string");
      assert.ok(typeof b.known === "boolean", "blessing should have known boolean");
      assert.equal(b.internal, undefined, "blessing should not have internal field");
    }
  });

  it("normalizes curio perk fields to { label, tier, rating }", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));
    assert.ok(report.curios.length > 0, "should have curios");
    const curio = report.curios.find((c) => c.perks.length > 0);
    assert.ok(curio, "should have curio with perks");
    for (const p of curio.perks) {
      assert.ok(typeof p.label === "string", "curio perk should have label string");
      assert.ok(typeof p.tier === "number", "curio perk should have tier number");
      assert.ok(typeof p.rating === "string", "curio perk should have rating string");
    }
  });
});

describe("generateBatchReport", () => {
  it("produces reports for all builds in a directory", async () => {
    const batch = await generateBatchReport(BUILDS_DIR);
    const expectedCount = readdirSync(BUILDS_DIR).filter((f) => f.endsWith(".json")).length;
    assert.ok(batch.reports.length > 0, "should produce at least one report");
    assert.equal(batch.reports.length, expectedCount, "should produce one report per JSON file");
    assert.ok(typeof batch.summary.total === "number", "summary should have total");
    assert.ok(typeof batch.summary.resolved === "number", "summary should have resolved");
    assert.ok(typeof batch.summary.unresolved === "number", "summary should have unresolved");
  });

  it("batch summary counts sum correctly", async () => {
    const batch = await generateBatchReport(BUILDS_DIR);
    const sumResolved = batch.reports.reduce((s, r) => s + r.summary.resolved, 0);
    assert.equal(batch.summary.resolved, sumResolved, "batch resolved should equal sum of individual resolved");
  });
});
