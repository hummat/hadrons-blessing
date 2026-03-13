import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "./ground-truth/lib/load.mjs";
import { buildCoverageReport } from "./ground-truth/lib/coverage.mjs";

describe("buildCoverageReport", () => {
  it("reports domain coverage status for current ground-truth scope", () => {
    const report = buildCoverageReport();

    const shared = report.domains.find((entry) => entry.domain === "shared");
    const psyker = report.domains.find((entry) => entry.domain === "psyker");
    const veteran = report.domains.find((entry) => entry.domain === "veteran");

    assert.equal(shared.status, "source_backed");
    assert.equal(psyker.status, "source_backed");
    assert.equal(veteran.status, "unsupported");
  });

  it("includes implemented kinds and record counts per domain", () => {
    const report = buildCoverageReport();
    const shared = report.domains.find((entry) => entry.domain === "shared");

    assert.ok(shared.implemented_kinds.includes("weapon"));
    assert.ok(shared.entity_count > 0);
    assert.ok(shared.alias_count > 0);
  });

  it("summarizes kind coverage across domains", () => {
    const report = buildCoverageReport();
    const weapon = report.kinds.find((entry) => entry.kind === "weapon");

    assert.deepEqual(weapon.domains, ["shared"]);
    assert.ok(weapon.entity_count > 0);
  });
});

describe("coverage-ground-truth CLI", () => {
  it("runs without source-root setup", () => {
    const result = spawnSync(process.execPath, ["scripts/coverage-ground-truth.mjs"], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        GROUND_TRUTH_SOURCE_ROOT: "",
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 0);
  });
});
