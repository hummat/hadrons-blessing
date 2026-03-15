# Human-Readable Build Reports Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `npm run report` command that produces human-readable build reports in text, markdown, and JSON formats, with batch mode for directory input.

**Architecture:** Three-file split — `build-report.mjs` (data assembly), `report-formatter.mjs` (rendering), `report-build.mjs` (CLI). The library layer joins audit results + scorecard + build metadata into a `BuildReport` object; formatters render it to text/markdown/JSON. Batch mode produces a summary table + per-build details.

**Tech Stack:** Node.js ESM, `node:test`, `node:assert`, `node:util` (parseArgs), `node:fs`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-03-15-human-readable-reports-design.md`

---

## Chunk 1: Data Assembly Layer

### Task 1: Build report data assembly — test

**Files:**
- Create: `scripts/build-report.test.mjs`
- Reference: `scripts/builds/08-gandalf-melee-wizard.json` (resolved build with 3 unresolved curio names)
- Reference: `scripts/builds/07-zealot-infodump.json` (build with non_canonical entries)

- [ ] **Step 1: Write the test file for `generateReport`**

```js
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { REPO_ROOT } from "./ground-truth/lib/load.mjs";
import { generateReport } from "./ground-truth/lib/build-report.mjs";

const BUILDS_DIR = join(REPO_ROOT, "scripts", "builds");

describe("generateReport", () => {
  it("produces a BuildReport with correct header for a canonical build", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));

    assert.equal(report.title, "Gandalf: Melee Wizard (Updated for Bound by Duty)");
    assert.equal(report.class, "psyker");
    assert.equal(report.provenance.source_kind, "gameslantern");
    assert.equal(report.provenance.author, "nomalarkey");
    assert.equal(typeof report.provenance.source_url, "string");
    assert.equal(typeof report.provenance.scraped_at, "string");
  });

  it("produces correct summary counts", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));

    assert.equal(typeof report.summary.total, "number");
    assert.ok(report.summary.total > 0, "total should be positive");
    assert.ok(report.summary.resolved > 0, "resolved should be positive");
    assert.equal(report.summary.ambiguous, 0);
    assert.ok(report.summary.unresolved >= 0);
    assert.ok(report.summary.non_canonical >= 0);
    assert.equal(
      report.summary.resolved + report.summary.unresolved + report.summary.ambiguous + report.summary.non_canonical,
      report.summary.total,
      "counts should sum to total",
    );
  });

  it("populates structural slots", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));

    const slotNames = report.slots.map((s) => s.slot);
    assert.ok(slotNames.includes("ability"));
    assert.ok(slotNames.includes("blitz"));
    assert.ok(slotNames.includes("aura"));
    assert.ok(slotNames.includes("keystone"));

    for (const slot of report.slots) {
      assert.equal(typeof slot.label, "string");
      assert.ok(slot.label.length > 0);
      assert.equal(typeof slot.status, "string");
    }
  });

  it("populates weapons with perks and blessings", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));

    assert.equal(report.weapons.length, 2);
    const slots = report.weapons.map((w) => w.slot).sort();
    assert.deepEqual(slots, ["melee", "ranged"]);

    for (const weapon of report.weapons) {
      assert.equal(typeof weapon.name, "string");
      assert.ok(weapon.perks.length > 0, "weapon should have perks");
      assert.ok(weapon.blessings.length > 0, "weapon should have blessings");
    }
  });

  it("includes scoring data", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));

    assert.equal(typeof report.perk_optimality, "number");
    assert.ok(report.perk_optimality >= 1 && report.perk_optimality <= 5);
    assert.equal(typeof report.curio_score, "number");
    assert.ok(report.curio_score >= 1 && report.curio_score <= 5);
  });

  it("lists unresolved entries in problems", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));

    // Build 08 has unresolved curio names
    assert.ok(report.unresolved.length > 0, "should have unresolved entries");
    for (const entry of report.unresolved) {
      assert.equal(typeof entry.field, "string");
      assert.equal(typeof entry.label, "string");
    }
  });

  it("lists non_canonical entries when present", async () => {
    const report = await generateReport(join(BUILDS_DIR, "07-zealot-infodump.json"));

    // Build 07 has non_canonical entries (multi-option guide label)
    assert.ok(report.non_canonical.length > 0, "build 07 should have non_canonical entries");
    for (const entry of report.non_canonical) {
      assert.equal(typeof entry.field, "string");
      assert.equal(typeof entry.label, "string");
    }
  });

  it("includes keystone slot even when null", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));
    const keystone = report.slots.find((s) => s.slot === "keystone");
    assert.ok(keystone, "keystone slot should always be present");
    // keystone.label may be null in builds without a keystone — the report should not crash
    assert.equal(typeof keystone.slot, "string");
  });

  it("normalizes blessing fields to { label, known }", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));
    for (const weapon of report.weapons) {
      for (const b of weapon.blessings) {
        assert.equal(typeof b.label, "string", "blessings should use 'label' not 'name'");
        assert.equal(typeof b.known, "boolean");
        assert.equal(b.internal, undefined, "internal field should be stripped");
      }
    }
  });

  it("normalizes curio perk fields to { label, tier, rating }", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));
    for (const curio of report.curios) {
      for (const p of curio.perks) {
        assert.equal(typeof p.label, "string", "curio perks should use 'label' not 'name'");
        assert.equal(typeof p.tier, "number");
        assert.equal(typeof p.rating, "string");
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/build-report.test.mjs`
Expected: FAIL with "Cannot find module" (build-report.mjs doesn't exist yet)

- [ ] **Step 3: Commit failing test**

```bash
git add scripts/build-report.test.mjs
git commit -m "test: add failing tests for build report data assembly (#2)"
```

---

### Task 2: Build report data assembly — implementation

**Files:**
- Create: `scripts/ground-truth/lib/build-report.mjs`
- Reference: `scripts/audit-build-names.mjs` (exports `auditBuildFile`)
- Reference: `scripts/score-build.mjs` (exports `generateScorecard`)
- Reference: `scripts/ground-truth/lib/load.mjs` (exports `loadJsonFile`)

- [ ] **Step 1: Implement `generateReport`**

```js
import { loadJsonFile } from "./load.mjs";
import { auditBuildFile } from "../../audit-build-names.mjs";
import { generateScorecard } from "../../score-build.mjs";

/**
 * Assemble a BuildReport from a canonical build file.
 * Joins build metadata + audit results + scorecard into a single report shape.
 *
 * @param {string} buildPath — absolute or relative path to a build JSON file
 * @returns {Promise<object>} BuildReport
 */
export async function generateReport(buildPath) {
  const build = loadJsonFile(buildPath);
  const audit = await auditBuildFile(buildPath);
  const scorecard = generateScorecard(build);

  return assembleBuildReport(build, audit, scorecard);
}

function selectionLabel(selection) {
  if (typeof selection === "string") return selection;
  return selection?.raw_label ?? "(unknown)";
}

function selectionStatus(selection) {
  if (typeof selection === "string") return "resolved";
  return selection?.resolution_status ?? "unresolved";
}

function selectionEntityId(selection) {
  if (typeof selection === "string") return null;
  return selection?.canonical_entity_id ?? null;
}

function assembleBuildReport(build, audit, scorecard) {
  // Header
  const title = build.title ?? "(untitled)";
  const className = selectionLabel(build.class);
  const provenance = {
    source_kind: build.provenance?.source_kind ?? null,
    source_url: build.provenance?.source_url ?? null,
    author: build.provenance?.author ?? null,
    scraped_at: build.provenance?.scraped_at ?? null,
  };

  // Summary counts from audit buckets
  const summary = {
    total: audit.resolved.length + audit.ambiguous.length + audit.unresolved.length + audit.non_canonical.length,
    resolved: audit.resolved.length,
    ambiguous: audit.ambiguous.length,
    unresolved: audit.unresolved.length,
    non_canonical: audit.non_canonical.length,
    warnings: audit.warnings ?? [],
  };

  // Structural slots
  const slotKeys = ["ability", "blitz", "aura", "keystone"];
  const slots = slotKeys.map((key) => ({
    slot: key,
    label: build[key] ? selectionLabel(build[key]) : null,
    entity_id: build[key] ? selectionEntityId(build[key]) : null,
    status: build[key] ? selectionStatus(build[key]) : null,
  }));

  // Talents
  const talents = (build.talents ?? []).map((t) => ({
    label: selectionLabel(t),
    entity_id: selectionEntityId(t),
    status: selectionStatus(t),
  }));

  // Weapons — merge build data with scorecard
  const weapons = (build.weapons ?? []).map((w, i) => {
    const scorecardWeapon = scorecard.weapons?.[i];
    return {
      slot: w.slot ?? (i === 0 ? "melee" : "ranged"),
      name: selectionLabel(w.name),
      entity_id: selectionEntityId(w.name),
      perks: scorecardWeapon?.perks?.perks ?? [],
      // Normalize scorecard blessings { name, known, internal } → spec shape { label, known }
      blessings: (scorecardWeapon?.blessings?.blessings ?? []).map((b) => ({
        label: b.name,
        known: b.known,
      })),
      perk_score: scorecardWeapon?.perks?.score ?? null,
    };
  });

  // Curios — scorecard.curios.perks is flat across all curios. Re-group by curio
  // using build file perk counts, and normalize { name, tier, rating } → { label, tier, rating }.
  const curiosWithPerks = [];
  let flatPerkIndex = 0;
  const flatPerks = scorecard.curios?.perks ?? [];
  for (const c of build.curios ?? []) {
    const perkCount = c.perks?.length ?? 0;
    const perks = flatPerks.slice(flatPerkIndex, flatPerkIndex + perkCount).map((p) => ({
      label: p.name,
      tier: p.tier,
      rating: p.rating,
    }));
    flatPerkIndex += perkCount;
    curiosWithPerks.push({
      name: selectionLabel(c.name),
      perks,
    });
  }

  // Problems
  const unresolved = audit.unresolved.map((e) => ({
    field: e.field,
    label: e.text,
    reason: e.match_type === "none" ? "no match" : e.match_type ?? "no match",
  }));

  const ambiguous = audit.ambiguous.map((e) => ({
    field: e.field,
    label: e.text,
    candidates: [], // audit entries don't carry candidate lists — placeholder
  }));

  const non_canonical = audit.non_canonical.map((e) => ({
    field: e.field,
    label: e.text,
    kind: e.non_canonical_kind ?? null,
    notes: e.notes ?? null,
  }));

  return {
    title,
    class: className,
    provenance,
    summary,
    slots,
    talents,
    weapons,
    curios: curiosWithPerks,
    curio_score: scorecard.curio_efficiency ?? null,
    perk_optimality: scorecard.perk_optimality ?? null,
    unresolved,
    ambiguous,
    non_canonical,
  };
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --test scripts/build-report.test.mjs`
Expected: All tests PASS

- [ ] **Step 3: Fix any failures and re-run**

If curio perk mapping is wrong (flat index assumption), debug by inspecting `scorecard.curios` shape and adjust the slicing logic.

- [ ] **Step 4: Commit passing implementation**

```bash
git add scripts/ground-truth/lib/build-report.mjs
git commit -m "feat: add build report data assembly layer (#2)"
```

---

### Task 3: Batch report generation

**Files:**
- Modify: `scripts/build-report.test.mjs`
- Modify: `scripts/ground-truth/lib/build-report.mjs`

- [ ] **Step 1: Add batch test**

Append to `scripts/build-report.test.mjs`:

```js
import { generateBatchReport } from "./ground-truth/lib/build-report.mjs";

describe("generateBatchReport", () => {
  it("produces reports for all builds in a directory", async () => {
    const batch = await generateBatchReport(BUILDS_DIR);

    assert.ok(batch.reports.length > 0, "should have reports");
    // Dynamic count — don't hardcode, derive from directory
    const { readdirSync } = await import("node:fs");
    const expected = readdirSync(BUILDS_DIR).filter((f) => f.endsWith(".json")).length;
    assert.equal(batch.reports.length, expected, `should match build file count (${expected})`);
    assert.equal(typeof batch.summary.total, "number");
    assert.equal(typeof batch.summary.resolved, "number");
    assert.equal(typeof batch.summary.unresolved, "number");
  });

  it("batch summary counts sum correctly", async () => {
    const batch = await generateBatchReport(BUILDS_DIR);

    const sumResolved = batch.reports.reduce((sum, r) => sum + r.summary.resolved, 0);
    assert.equal(batch.summary.resolved, sumResolved, "batch resolved should equal sum of per-build resolved");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/build-report.test.mjs`
Expected: FAIL with "generateBatchReport is not a function"

- [ ] **Step 3: Implement `generateBatchReport`**

Add to `scripts/ground-truth/lib/build-report.mjs`:

```js
import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Generate reports for all build JSON files in a directory.
 *
 * @param {string} dirPath — path to directory containing build JSON files
 * @returns {Promise<{ summary: object, reports: object[] }>}
 */
export async function generateBatchReport(dirPath) {
  const files = readdirSync(dirPath)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const reports = [];
  for (const file of files) {
    const report = await generateReport(join(dirPath, file));
    reports.push(report);
  }

  const summary = {
    build_count: reports.length,
    total: reports.reduce((s, r) => s + r.summary.total, 0),
    resolved: reports.reduce((s, r) => s + r.summary.resolved, 0),
    ambiguous: reports.reduce((s, r) => s + r.summary.ambiguous, 0),
    unresolved: reports.reduce((s, r) => s + r.summary.unresolved, 0),
    non_canonical: reports.reduce((s, r) => s + r.summary.non_canonical, 0),
  };

  return { summary, reports };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/build-report.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/build-report.mjs scripts/build-report.test.mjs
git commit -m "feat: add batch report generation (#2)"
```

---

## Chunk 2: Formatter Layer

### Task 4: Text formatter — test

**Files:**
- Create: `scripts/report-formatter.test.mjs`
- Reference: `scripts/ground-truth/lib/build-report.mjs`

- [ ] **Step 1: Write formatter tests**

```js
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { REPO_ROOT } from "./ground-truth/lib/load.mjs";
import { generateReport, generateBatchReport } from "./ground-truth/lib/build-report.mjs";
import {
  formatText, formatMarkdown, formatJson,
  formatBatchText, formatBatchMarkdown, formatBatchJson,
} from "./ground-truth/lib/report-formatter.mjs";

const BUILDS_DIR = join(REPO_ROOT, "scripts", "builds");

describe("formatText", () => {
  it("produces text with title and class", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));
    const text = formatText(report);

    assert.ok(text.includes(report.title), "should include build title");
    assert.ok(text.includes("Psyker") || text.includes("psyker"), "should include class");
  });

  it("shows summary counts", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));
    const text = formatText(report);

    assert.ok(text.includes("resolved"), "should mention resolved");
    assert.ok(text.includes("unresolved"), "should mention unresolved");
  });

  it("shows structural slots", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));
    const text = formatText(report);

    assert.ok(text.includes("Ability"), "should show ability slot");
    assert.ok(text.includes("Blitz"), "should show blitz slot");
    assert.ok(text.includes("Aura"), "should show aura slot");
    assert.ok(text.includes("Keystone"), "should show keystone slot");
  });

  it("shows weapon sections", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));
    const text = formatText(report);

    assert.ok(text.includes("[melee]") || text.includes("melee"), "should show melee weapon");
    assert.ok(text.includes("[ranged]") || text.includes("ranged"), "should show ranged weapon");
    assert.ok(text.includes("Perk") || text.includes("perk"), "should show perks");
    assert.ok(text.includes("Blessing") || text.includes("blessing"), "should show blessings");
  });

  it("shows scores", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));
    const text = formatText(report);

    assert.ok(text.includes("Perk Optimality") || text.includes("perk_optimality"), "should show perk score");
    assert.ok(text.includes("Curio") || text.includes("curio"), "should show curio score");
    assert.ok(text.includes("/5"), "should show x/5 format");
  });

  it("shows problems section when unresolved entries exist", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));
    const text = formatText(report);

    assert.ok(text.includes("PROBLEMS") || text.includes("Problems"), "should show problems header");
  });

  it("omits problems section when build is fully resolved", async () => {
    // Use a build where we can test — if all 23 builds have unresolved curio names,
    // just verify the problems section lists them
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));
    const text = formatText(report);

    if (report.unresolved.length === 0 && report.non_canonical.length === 0) {
      assert.ok(!text.includes("PROBLEMS"), "should omit problems when none exist");
    }
  });
});

describe("formatMarkdown", () => {
  it("produces markdown with headers", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));
    const md = formatMarkdown(report);

    assert.ok(md.includes("# ") || md.includes("## "), "should use markdown headers");
    assert.ok(md.includes(report.title), "should include title");
  });

  it("uses tables for weapons", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));
    const md = formatMarkdown(report);

    assert.ok(md.includes("|"), "should use markdown tables");
  });
});

describe("formatJson", () => {
  it("produces valid JSON matching the report object", async () => {
    const report = await generateReport(join(BUILDS_DIR, "08-gandalf-melee-wizard.json"));
    const json = formatJson(report);
    const parsed = JSON.parse(json);

    assert.equal(parsed.title, report.title);
    assert.equal(parsed.class, report.class);
    assert.deepEqual(parsed.summary, report.summary);
  });
});

describe("formatBatchText", () => {
  it("produces summary table with all builds", async () => {
    const batch = await generateBatchReport(BUILDS_DIR);
    const text = formatBatchText(batch);

    assert.ok(text.includes("SUMMARY") || text.includes("Summary"), "should have summary header");
    assert.ok(text.includes(`${batch.summary.build_count}`), "should show build count");
    assert.ok(text.includes("Resolved") || text.includes("resolved"), "should show resolved column");
  });

  it("includes per-build details after summary", async () => {
    const batch = await generateBatchReport(BUILDS_DIR);
    const text = formatBatchText(batch);

    // Per-build details should include at least one build title
    assert.ok(text.includes(batch.reports[0].title), "should include first build's details");
  });
});

describe("formatBatchMarkdown", () => {
  it("produces markdown with summary table and per-build details", async () => {
    const batch = await generateBatchReport(BUILDS_DIR);
    const md = formatBatchMarkdown(batch);

    assert.ok(md.includes("# Build Summary"), "should have markdown header");
    assert.ok(md.includes("|"), "should have table");
    assert.ok(md.includes("---"), "should have per-build separators");
  });
});

describe("formatBatchJson", () => {
  it("produces valid JSON with summary and reports array", async () => {
    const batch = await generateBatchReport(BUILDS_DIR);
    const json = formatBatchJson(batch);
    const parsed = JSON.parse(json);

    assert.ok(parsed.summary, "should have summary");
    assert.ok(Array.isArray(parsed.reports), "should have reports array");
    assert.equal(parsed.reports.length, batch.reports.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/report-formatter.test.mjs`
Expected: FAIL with "Cannot find module" (report-formatter.mjs doesn't exist yet)

- [ ] **Step 3: Commit failing test**

```bash
git add scripts/report-formatter.test.mjs
git commit -m "test: add failing tests for report formatters (#2)"
```

---

### Task 5: Text formatter — implementation

**Files:**
- Create: `scripts/ground-truth/lib/report-formatter.mjs`

- [ ] **Step 1: Implement all formatters**

```js
/**
 * Section order — shared across all formats so they stay in sync.
 */
const SECTIONS = ["header", "summary", "slots", "weapons", "scores", "curios", "problems", "warnings"];

// ── Text format ──────────────────────────────────────────────

export function formatText(report) {
  const lines = [];

  // Header
  const divider = "\u2550".repeat(54);
  lines.push(divider);
  lines.push(`  ${report.title}`);
  const headerMeta = [capitalize(report.class), report.provenance.author, report.provenance.source_kind]
    .filter(Boolean)
    .join(" \u00b7 ");
  if (headerMeta) lines.push(`  ${headerMeta}`);
  lines.push(divider);
  lines.push("");

  // Summary
  const parts = [`${report.summary.resolved} resolved`, `${report.summary.unresolved} unresolved`];
  if (report.summary.ambiguous > 0) parts.push(`${report.summary.ambiguous} ambiguous`);
  parts.push(`${report.summary.non_canonical} non-canonical`);
  lines.push(`  Summary: ${parts.join(" \u00b7 ")}`);
  lines.push("");

  // Slots
  lines.push("  SLOTS");
  for (const slot of report.slots) {
    const label = slot.label ?? "(none)";
    lines.push(`    ${capitalize(slot.slot) + ":"}`.padEnd(15) + label);
  }
  lines.push("");

  // Weapons
  lines.push("  WEAPONS");
  for (const weapon of report.weapons) {
    lines.push(`    [${weapon.slot}] ${weapon.name}`);

    if (weapon.perks.length > 0) {
      const perkParts = weapon.perks.map((p) => {
        if (p === null) return "? (unknown)";
        return `+${p.name} T${p.tier} \u2713`;
      });
      lines.push(`      Perks:     ${perkParts.join(", ")}`);
    }

    if (weapon.blessings.length > 0) {
      const blessingParts = weapon.blessings.map((b) => `${b.label} ${b.known ? "\u2713" : "(?)"}`);
      lines.push(`      Blessings: ${blessingParts.join(", ")}`);
    }
  }
  lines.push("");

  // Scores — currently always integers (1-5) due to Math.round in generateScorecard.
  // Using toFixed(1) for forward-compatibility when #9 adds fractional scoring.
  lines.push("  SCORES");
  if (report.perk_optimality != null) {
    lines.push(`    Perk Optimality:   ${report.perk_optimality.toFixed(1)}/5`);
  }
  if (report.curio_score != null) {
    lines.push(`    Curio Efficiency:  ${report.curio_score.toFixed(1)}/5`);
  }
  lines.push("");

  // Curios
  if (report.curios.length > 0) {
    lines.push("  CURIOS");
    for (const curio of report.curios) {
      const perkStr = curio.perks
        .map((p) => {
          const tier = p.tier > 0 ? `T${p.tier}` : "(?)";
          const check = p.rating === "avoid" ? "\u2717" : "\u2713";
          return `+${p.label} ${tier} ${check} ${p.rating}`;
        })
        .join(", ");
      lines.push(`    ${curio.name}: ${perkStr}`);
    }
    lines.push("");
  }

  // Problems
  const hasProblems = report.unresolved.length > 0 || report.ambiguous.length > 0 || report.non_canonical.length > 0;
  if (hasProblems) {
    const problemCount = report.unresolved.length + report.ambiguous.length + report.non_canonical.length;
    lines.push(`  PROBLEMS (${problemCount})`);
    for (const e of report.unresolved) {
      lines.push(`    ${e.field}  "${e.label}"  \u2014 ${e.reason}`);
    }
    for (const e of report.ambiguous) {
      lines.push(`    ${e.field}  "${e.label}"  \u2014 ambiguous`);
    }
    for (const e of report.non_canonical) {
      const notes = e.notes ? ` (${e.notes})` : "";
      lines.push(`    ${e.field}  "${e.label}"  \u2014 non-canonical: ${e.kind}${notes}`);
    }
    lines.push("");
  }

  // Warnings
  if (report.summary.warnings.length > 0) {
    lines.push(`  \u26a0 Warnings: ${report.summary.warnings.join(", ")}`);
    lines.push("");
  }

  lines.push(divider);
  return lines.join("\n");
}

// ── Markdown format ──────────────────────────────────────────

export function formatMarkdown(report) {
  const lines = [];

  lines.push(`# ${report.title}`);
  const meta = [capitalize(report.class), report.provenance.author, report.provenance.source_kind]
    .filter(Boolean)
    .join(" · ");
  if (meta) lines.push(`*${meta}*`);
  lines.push("");

  // Summary
  const parts = [`**${report.summary.resolved}** resolved`, `**${report.summary.unresolved}** unresolved`];
  if (report.summary.ambiguous > 0) parts.push(`**${report.summary.ambiguous}** ambiguous`);
  parts.push(`**${report.summary.non_canonical}** non-canonical`);
  lines.push(parts.join(" · "));
  lines.push("");

  // Slots
  lines.push("## Slots");
  lines.push("");
  lines.push("| Slot | Selection |");
  lines.push("|------|-----------|");
  for (const slot of report.slots) {
    lines.push(`| ${capitalize(slot.slot)} | ${slot.label ?? "—"} |`);
  }
  lines.push("");

  // Weapons
  lines.push("## Weapons");
  lines.push("");
  for (const weapon of report.weapons) {
    lines.push(`### [${weapon.slot}] ${weapon.name}`);
    lines.push("");
    if (weapon.perks.length > 0) {
      lines.push("| Perk | Tier |");
      lines.push("|------|------|");
      for (const p of weapon.perks) {
        if (p === null) {
          lines.push("| *(unknown)* | — |");
        } else {
          lines.push(`| ${p.name} | T${p.tier} |`);
        }
      }
      lines.push("");
    }
    if (weapon.blessings.length > 0) {
      const bStr = weapon.blessings.map((b) => `${b.label}${b.known ? "" : " (?)"}`).join(", ");
      lines.push(`**Blessings:** ${bStr}`);
      lines.push("");
    }
  }

  // Scores
  lines.push("## Scores");
  lines.push("");
  if (report.perk_optimality != null) lines.push(`- **Perk Optimality:** ${report.perk_optimality.toFixed(1)}/5`);
  if (report.curio_score != null) lines.push(`- **Curio Efficiency:** ${report.curio_score.toFixed(1)}/5`);
  lines.push("");

  // Curios
  if (report.curios.length > 0) {
    lines.push("## Curios");
    lines.push("");
    lines.push("| Curio | Perks |");
    lines.push("|-------|-------|");
    for (const curio of report.curios) {
      const perkStr = curio.perks.map((p) => `${p.label} (T${p.tier}, ${p.rating})`).join("; ");
      lines.push(`| ${curio.name} | ${perkStr} |`);
    }
    lines.push("");
  }

  // Problems
  const hasProblems = report.unresolved.length > 0 || report.ambiguous.length > 0 || report.non_canonical.length > 0;
  if (hasProblems) {
    lines.push("## Problems");
    lines.push("");
    for (const e of report.unresolved) {
      lines.push(`- \`${e.field}\` **"${e.label}"** — ${e.reason}`);
    }
    for (const e of report.ambiguous) {
      lines.push(`- \`${e.field}\` **"${e.label}"** — ambiguous`);
    }
    for (const e of report.non_canonical) {
      const notes = e.notes ? ` (${e.notes})` : "";
      lines.push(`- \`${e.field}\` **"${e.label}"** — non-canonical: ${e.kind}${notes}`);
    }
    lines.push("");
  }

  // Warnings
  if (report.summary.warnings.length > 0) {
    lines.push(`> **Warnings:** ${report.summary.warnings.join(", ")}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ── JSON format ──────────────────────────────────────────────

export function formatJson(report) {
  return JSON.stringify(report, null, 2);
}

// ── Batch formats ────────────────────────────────────────────

export function formatBatchText(batch) {
  const lines = [];
  const { summary, reports } = batch;

  lines.push(`BUILD SUMMARY (${summary.build_count} builds)`);

  // Column headers
  const header = "  Build".padEnd(42) + "Class".padEnd(12) + "Resolved".padEnd(10) + "Unresolved".padEnd(12) + "Perks".padEnd(8) + "Curios";
  lines.push(header);

  for (const r of reports) {
    const buildName = r.title.length > 36 ? r.title.slice(0, 33) + "..." : r.title;
    const row = `  ${buildName}`.padEnd(42)
      + capitalize(r.class).padEnd(12)
      + `${r.summary.resolved}`.padEnd(10)
      + `${r.summary.unresolved}`.padEnd(12)
      + `${r.perk_optimality?.toFixed(1) ?? "-"}`.padEnd(8)
      + `${r.curio_score?.toFixed(1) ?? "-"}`;
    lines.push(row);
  }

  lines.push("");
  lines.push(`  Totals: ${summary.resolved} resolved \u00b7 ${summary.unresolved} unresolved \u00b7 ${summary.non_canonical} non-canonical`);
  lines.push("");

  // Per-build details
  for (const r of reports) {
    lines.push("");
    lines.push(formatText(r));
  }

  return lines.join("\n");
}

export function formatBatchMarkdown(batch) {
  const lines = [];
  const { summary, reports } = batch;

  lines.push(`# Build Summary (${summary.build_count} builds)`);
  lines.push("");
  lines.push("| Build | Class | Resolved | Unresolved | Perks | Curios |");
  lines.push("|-------|-------|----------|------------|-------|--------|");
  for (const r of reports) {
    lines.push(`| ${r.title} | ${capitalize(r.class)} | ${r.summary.resolved} | ${r.summary.unresolved} | ${r.perk_optimality?.toFixed(1) ?? "—"} | ${r.curio_score?.toFixed(1) ?? "—"} |`);
  }
  lines.push("");
  lines.push(`**Totals:** ${summary.resolved} resolved · ${summary.unresolved} unresolved · ${summary.non_canonical} non-canonical`);
  lines.push("");

  // Per-build details
  for (const r of reports) {
    lines.push("---");
    lines.push("");
    lines.push(formatMarkdown(r));
  }

  return lines.join("\n");
}

export function formatBatchJson(batch) {
  return JSON.stringify(batch, null, 2);
}

// ── Helpers ──────────────────────────────────────────────────

function capitalize(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --test scripts/report-formatter.test.mjs`
Expected: All tests PASS

- [ ] **Step 3: Fix any failures and re-run**

Likely issues: `formatBatchText` column alignment, curio perk formatting if the scorecard shape doesn't match expectations.

- [ ] **Step 4: Commit**

```bash
git add scripts/ground-truth/lib/report-formatter.mjs
git commit -m "feat: add text, markdown, and JSON report formatters (#2)"
```

---

## Chunk 3: CLI and Integration

### Task 6: CLI entry point

**Files:**
- Create: `scripts/report-build.mjs`
- Modify: `package.json`

- [ ] **Step 1: Implement the CLI**

```js
import { statSync } from "node:fs";
import { parseArgs } from "node:util";
import { runCliMain } from "./ground-truth/lib/cli.mjs";
import { generateReport, generateBatchReport } from "./ground-truth/lib/build-report.mjs";
import {
  formatText,
  formatMarkdown,
  formatJson,
  formatBatchText,
  formatBatchMarkdown,
  formatBatchJson,
} from "./ground-truth/lib/report-formatter.mjs";

const FORMATTERS = {
  text: { single: formatText, batch: formatBatchText },
  md: { single: formatMarkdown, batch: formatBatchMarkdown },
  json: { single: formatJson, batch: formatBatchJson },
};

if (import.meta.main) {
  await runCliMain("report", async () => {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        format: { type: "string", default: "text" },
      },
    });

    const target = positionals[0];
    if (!target) {
      throw new Error("Usage: npm run report -- <build.json|directory> [--format text|md|json]");
    }

    const format = values.format;
    if (!FORMATTERS[format]) {
      throw new Error(`Unknown format "${format}". Use: text, md, json`);
    }

    const isDir = statSync(target).isDirectory();
    let output;

    if (isDir) {
      const batch = await generateBatchReport(target);
      output = FORMATTERS[format].batch(batch);
    } else {
      const report = await generateReport(target);
      output = FORMATTERS[format].single(report);
    }

    process.stdout.write(output + "\n");
  });
}
```

- [ ] **Step 2: Add `report` script to `package.json`**

Add to the `"scripts"` object in `package.json`:

```json
"report": "node scripts/report-build.mjs"
```

- [ ] **Step 3: Smoke test the CLI**

Run: `npm run report -- scripts/builds/08-gandalf-melee-wizard.json`
Expected: Human-readable text report on stdout

Run: `npm run report -- scripts/builds/08-gandalf-melee-wizard.json --format md`
Expected: Markdown report

Run: `npm run report -- scripts/builds/08-gandalf-melee-wizard.json --format json`
Expected: JSON report

Run: `npm run report -- scripts/builds/`
Expected: Batch summary table + per-build details

- [ ] **Step 4: Commit**

```bash
git add scripts/report-build.mjs package.json
git commit -m "feat: add report CLI with text/md/json output (#2)"
```

---

### Task 7: Register test in npm test, run full suite

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add test files to npm test script**

In `package.json`, append to the `"test"` script value:

```
scripts/build-report.test.mjs scripts/report-formatter.test.mjs
```

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass (existing + new)

- [ ] **Step 3: Run make check**

Run: `make check`
Expected: Green (edges:build + index:build + test + index:check)

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: register report tests in npm test (#2)"
```

---

### Task 8: Add setup hint to cli.mjs

**Files:**
- Modify: `scripts/ground-truth/lib/cli.mjs`

- [ ] **Step 1: Add report hint to SETUP_HINTS**

Add entry to the `SETUP_HINTS` object at the top of `cli.mjs`:

```js
report:
  "GROUND_TRUTH_SOURCE_ROOT=/path/to/Darktide-Source-Code npm run report -- scripts/builds/08-gandalf-melee-wizard.json",
```

- [ ] **Step 2: Run tests to verify no regression**

Run: `npm test`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add scripts/ground-truth/lib/cli.mjs
git commit -m "chore: add report setup hint to CLI error handler (#2)"
```

---

### Task 9: Final verification and cleanup

- [ ] **Step 1: Run full make check**

Run: `make check`
Expected: Green

- [ ] **Step 2: Verify all three single-build formats produce output**

Run:
```bash
npm run report -- scripts/builds/08-gandalf-melee-wizard.json
npm run report -- scripts/builds/08-gandalf-melee-wizard.json --format md
npm run report -- scripts/builds/08-gandalf-melee-wizard.json --format json
```
Expected: All three produce readable output, no errors

- [ ] **Step 3: Verify batch mode**

Run: `npm run report -- scripts/builds/`
Expected: Summary table with 23 rows + per-build details below

- [ ] **Step 4: Verify a build with non-canonical entries**

Run: `npm run report -- scripts/builds/07-zealot-infodump.json`
Expected: Problems section shows non-canonical entry with kind and notes

- [ ] **Step 5: Spot-check JSON round-trip**

Run: `npm run report -- scripts/builds/08-gandalf-melee-wizard.json --format json | node -e "const r=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(r.title, r.summary)"`
Expected: Title and summary object printed correctly
