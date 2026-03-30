import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ENTITIES_ROOT, EDGES_ROOT } from "./load.js";

const sourceRoot = process.env.GROUND_TRUTH_SOURCE_ROOT;

describe("effects:build pipeline", () => {
  it("runs without errors", { skip: !sourceRoot }, () => {
    const result = spawnSync("tsx", ["src/cli/extract-buff-effects.ts"], {
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, GROUND_TRUTH_SOURCE_ROOT: sourceRoot },
    });
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);
    assert.ok(result.stdout.includes("Populated:"), "Expected summary output");
  });

  it("populates calc on known psyker talent", { skip: !sourceRoot }, () => {
    const entities = JSON.parse(
      readFileSync(join(ENTITIES_ROOT, "psyker.json"), "utf8"),
    );
    const talent = entities.find(
      (e) => e.internal_name === "psyker_brain_burst_improved",
    );
    assert.ok(talent, "Expected to find psyker talent");
    assert.ok(talent.calc.effects?.length > 0, "Expected non-empty calc.effects");
    assert.ok(talent.calc.buff_template_names?.length > 0, "Expected buff_template_names");
  });

  it("populates tiers on known weapon trait", { skip: !sourceRoot }, () => {
    const allFiles = readdirSync(ENTITIES_ROOT).filter((f) => f.endsWith(".json"));
    let found = false;
    for (const file of allFiles) {
      const entities = JSON.parse(
        readFileSync(join(ENTITIES_ROOT, file), "utf8"),
      );
      const trait = entities.find(
        (e) => e.kind === "weapon_trait" && e.calc?.tiers?.length === 4,
      );
      if (trait) {
        assert.ok(trait.calc.tiers[0].effects.length > 0, "Expected effects in tier 0");
        found = true;
        break;
      }
    }
    assert.ok(found, "Expected at least one weapon trait with 4 tiers");
  });

  it("generates grants_buff edges", { skip: !sourceRoot }, () => {
    const edgeFiles = readdirSync(EDGES_ROOT).filter((f) => f.endsWith(".json"));
    let grantsBuff = 0;
    for (const file of edgeFiles) {
      const edges = JSON.parse(
        readFileSync(join(EDGES_ROOT, file), "utf8"),
      );
      grantsBuff += edges.filter((e) => e.type === "grants_buff").length;
    }
    assert.ok(grantsBuff > 0, `Expected grants_buff edges, got ${grantsBuff}`);
  });

  it("is idempotent", { skip: !sourceRoot }, () => {
    // Pipeline already ran in the first test. Run again and verify no diff.
    spawnSync("tsx", ["src/cli/extract-buff-effects.ts"], {
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, GROUND_TRUTH_SOURCE_ROOT: sourceRoot },
    });
    const diff = spawnSync("git", ["diff", "--stat", "data/ground-truth/"], {
      encoding: "utf8",
    });
    assert.equal(diff.stdout.trim(), "", "Expected no changes after second run");
  });
});
