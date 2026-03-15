import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { generateReport, generateBatchReport } from "./ground-truth/lib/build-report.mjs";
import {
  formatText,
  formatMarkdown,
  formatJson,
  formatBatchText,
  formatBatchMarkdown,
  formatBatchJson,
} from "./ground-truth/lib/report-formatter.mjs";
import { REPO_ROOT } from "./ground-truth/lib/load.mjs";

const BUILDS_DIR = join(REPO_ROOT, "scripts", "builds");

/** Shared report fixture — generated once, reused across formatText tests. */
let _report;
async function getReport() {
  if (!_report) _report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));
  return _report;
}

/** Shared batch fixture. */
let _batch;
async function getBatch() {
  if (!_batch) _batch = await generateBatchReport(BUILDS_DIR);
  return _batch;
}

// ---------------------------------------------------------------------------
// formatText
// ---------------------------------------------------------------------------
describe("formatText", () => {
  it("produces text with title and class", async () => {
    const report = await getReport();
    const text = formatText(report);
    assert.ok(text.includes(report.title), "should contain build title");
    assert.ok(
      text.toLowerCase().includes("psyker"),
      "should contain class name (case-insensitive)",
    );
  });

  it("shows summary counts", async () => {
    const report = await getReport();
    const text = formatText(report);
    assert.ok(/resolved/i.test(text), "should mention resolved");
    assert.ok(/unresolved/i.test(text), "should mention unresolved");
  });

  it("shows structural slots", async () => {
    const report = await getReport();
    const text = formatText(report);
    for (const slot of ["Ability", "Blitz", "Aura", "Keystone"]) {
      assert.ok(
        new RegExp(slot, "i").test(text),
        `should contain structural slot "${slot}"`,
      );
    }
  });

  it("shows weapon sections", async () => {
    // Use build 01 which has weapons with both perks and blessings
    const report = await generateReport(join(BUILDS_DIR, "01-veteran-squad-leader.json"));
    const text = formatText(report);
    assert.ok(/\[melee\]/i.test(text) || /melee/i.test(text), "should mention melee");
    assert.ok(/\[ranged\]/i.test(text) || /ranged/i.test(text), "should mention ranged");
    assert.ok(/perk/i.test(text), "should mention perks");
    assert.ok(/blessing/i.test(text), "should mention blessings");
  });

  it("shows scores", async () => {
    const report = await getReport();
    const text = formatText(report);
    assert.ok(/perk.optimality/i.test(text) || /perk_optimality/i.test(text), "should mention perk optimality");
    assert.ok(/curio/i.test(text), "should mention curio score");
    assert.ok(text.includes("/5"), "should show /5 scale");
  });

  it("shows problems section when unresolved entries exist", async () => {
    const report = await getReport();
    assert.ok(report.unresolved.length > 0, "precondition: build 08 has unresolved entries");
    const text = formatText(report);
    assert.ok(/problems/i.test(text), "should contain PROBLEMS section header");
  });

  it("omits problems section when build is fully resolved", async () => {
    const report = await getReport();
    // Synthesise a fully-resolved report by clearing problem arrays
    const clean = {
      ...report,
      unresolved: [],
      ambiguous: [],
      non_canonical: [],
      summary: { ...report.summary, unresolved: 0, ambiguous: 0, non_canonical: 0 },
    };
    const text = formatText(clean);
    assert.ok(!/problems/i.test(text), "should NOT contain PROBLEMS section when fully resolved");
  });
});

// ---------------------------------------------------------------------------
// formatMarkdown
// ---------------------------------------------------------------------------
describe("formatMarkdown", () => {
  it("produces markdown with headers", async () => {
    const report = await getReport();
    const md = formatMarkdown(report);
    assert.ok(/^#\s/m.test(md) || /^##\s/m.test(md), "should contain markdown headers");
    assert.ok(md.includes(report.title), "should contain build title");
  });

  it("uses tables for weapons", async () => {
    const report = await getReport();
    const md = formatMarkdown(report);
    assert.ok(md.includes("|"), "should contain pipe characters for tables");
  });
});

// ---------------------------------------------------------------------------
// formatJson
// ---------------------------------------------------------------------------
describe("formatJson", () => {
  it("produces valid JSON matching report object", async () => {
    const report = await getReport();
    const jsonStr = formatJson(report);
    const parsed = JSON.parse(jsonStr);
    assert.equal(parsed.title, report.title, "title should match");
    assert.equal(parsed.class, report.class, "class should match");
    assert.equal(parsed.summary.resolved, report.summary.resolved, "summary.resolved should match");
  });
});

// ---------------------------------------------------------------------------
// formatBatchText
// ---------------------------------------------------------------------------
describe("formatBatchText", () => {
  it("produces summary table with all builds", async () => {
    const batch = await getBatch();
    const text = formatBatchText(batch);
    assert.ok(/summary/i.test(text), "should contain SUMMARY header");
    assert.ok(text.includes(String(batch.summary.build_count)), "should mention build count");
    assert.ok(/resolved/i.test(text), "should mention Resolved");
  });

  it("includes per-build details after summary", async () => {
    const batch = await getBatch();
    const text = formatBatchText(batch);
    assert.ok(
      text.includes(batch.reports[0].title),
      "should contain first build title in per-build details",
    );
  });
});

// ---------------------------------------------------------------------------
// formatBatchMarkdown
// ---------------------------------------------------------------------------
describe("formatBatchMarkdown", () => {
  it("produces markdown with summary table and per-build details", async () => {
    const batch = await getBatch();
    const md = formatBatchMarkdown(batch);
    assert.ok(/# Build Summary/i.test(md) || /# .*summary/i.test(md), "should have summary heading");
    assert.ok(md.includes("|"), "should contain table pipes");
    assert.ok(md.includes("---"), "should contain table separator");
  });
});

// ---------------------------------------------------------------------------
// formatBatchJson
// ---------------------------------------------------------------------------
describe("formatBatchJson", () => {
  it("produces valid JSON with summary and reports array", async () => {
    const batch = await getBatch();
    const jsonStr = formatBatchJson(batch);
    const parsed = JSON.parse(jsonStr);
    assert.ok(parsed.summary, "should have summary object");
    assert.ok(Array.isArray(parsed.reports), "should have reports array");
  });
});
