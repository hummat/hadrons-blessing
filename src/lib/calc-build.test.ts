import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const HAS_SOURCE = !!process.env.GROUND_TRUTH_SOURCE_ROOT;
const BUILD = join(REPO_ROOT, "data", "builds", "09-psyker-2026.json");
const BUILD2 = join(REPO_ROOT, "data", "builds", "01-veteran-havoc40-2026.json");
const SCRIPT = join(REPO_ROOT, "src", "cli", "calc-build.ts");

// JSON output can be very large (all breeds x actions x difficulties).
// 50 MB buffer avoids ENOBUFS.
const MAX_BUFFER = 50 * 1024 * 1024;

describe("calc CLI", { skip: !HAS_SOURCE && "requires GROUND_TRUTH_SOURCE_ROOT" }, () => {
  it("produces valid JSON with --json flag", () => {
    const out = execFileSync("tsx", [SCRIPT, BUILD, "--json"], {
      encoding: "utf-8",
      env: { ...process.env },
      timeout: 30000,
      maxBuffer: MAX_BUFFER,
    });
    const data = JSON.parse(out);
    assert.ok(data.weapons, "missing weapons");
    assert.ok(data.metadata, "missing metadata");
    assert.ok(Array.isArray(data.weapons), "weapons should be array");
    assert.ok(data.metadata.quality > 0, "quality should be positive");
    assert.ok(Array.isArray(data.metadata.scenarios), "scenarios should be array");
  });

  it("produces text output by default", () => {
    const out = execFileSync("tsx", [SCRIPT, BUILD], {
      encoding: "utf-8",
      env: { ...process.env },
      timeout: 30000,
      maxBuffer: MAX_BUFFER,
    });
    assert.ok(out.includes("Sustained"), "missing Sustained header");
    assert.ok(out.includes("hit"), "missing hits count");
    assert.ok(out.includes("BUILD:"), "missing BUILD header");
  });

  it("text output contains checklist breed names", () => {
    const out = execFileSync("tsx", [SCRIPT, BUILD], {
      encoding: "utf-8",
      env: { ...process.env },
      timeout: 30000,
      maxBuffer: MAX_BUFFER,
    });
    // At least some checklist enemies should appear
    const expected = ["Rager", "Poxwalker", "Crusher", "Mauler", "Bulwark"];
    const found = expected.filter((name) => out.includes(name));
    assert.ok(found.length >= 3, `expected at least 3 checklist enemies, found: ${found.join(", ")}`);
  });

  it("text output contains armor type annotations", () => {
    const out = execFileSync("tsx", [SCRIPT, BUILD], {
      encoding: "utf-8",
      env: { ...process.env },
      timeout: 30000,
      maxBuffer: MAX_BUFFER,
    });
    // Should contain at least one community armor name
    const armorNames = ["Flak", "Carapace", "Unarmoured", "Maniac", "Unyielding"];
    const found = armorNames.filter((name) => out.includes(name));
    assert.ok(found.length >= 1, `expected at least 1 armor type, found: ${found.join(", ")}`);
  });

  it("JSON output contains weapon actions and scenarios", () => {
    const out = execFileSync("tsx", [SCRIPT, BUILD, "--json"], {
      encoding: "utf-8",
      env: { ...process.env },
      timeout: 30000,
      maxBuffer: MAX_BUFFER,
    });
    const data = JSON.parse(out);
    for (const weapon of data.weapons) {
      assert.ok(weapon.entityId, "weapon missing entityId");
      assert.ok(Array.isArray(weapon.actions), "weapon missing actions array");
      assert.ok(weapon.summary, "weapon missing summary");
      for (const action of weapon.actions) {
        assert.ok(action.scenarios, "action missing scenarios");
        assert.ok(action.scenarios.sustained, "action missing sustained scenario");
      }
    }
  });

  it("handles batch directory (text mode)", () => {
    const out = execFileSync("tsx", [SCRIPT, join(REPO_ROOT, "data", "builds/")], {
      encoding: "utf-8",
      env: { ...process.env },
      timeout: 120000,
      maxBuffer: MAX_BUFFER,
    });
    // Text batch output should contain multiple BUILD headers
    assert.ok(out.length > 100, "batch output too short");
    assert.ok(out.includes("BUILD:"), "batch output should contain BUILD header");
  });

  it("compare mode shows differences", () => {
    const out = execFileSync("tsx", [SCRIPT, BUILD, "--compare", BUILD2], {
      encoding: "utf-8",
      env: { ...process.env },
      timeout: 30000,
      maxBuffer: MAX_BUFFER,
    });
    assert.ok(out.includes("COMPARE"), "missing COMPARE header");
  });

  it("exits with error on missing argument", () => {
    assert.throws(() => {
      execFileSync("tsx", [SCRIPT], {
        encoding: "utf-8",
        env: { ...process.env },
        timeout: 10000,
      });
    });
  });
});
