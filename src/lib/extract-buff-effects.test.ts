import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { REPO_ROOT } from "./load.js";

const sourceRoot = process.env.GROUND_TRUTH_SOURCE_ROOT;
const FIXTURE_SOURCE_DIRS = ["src", "data"];
const FIXTURE_SOURCE_FILES = ["package.json", "tsconfig.json"];

let fixtureRepoRoot: string | null = null;

function ensureFixtureRepo(): string {
  if (fixtureRepoRoot) {
    return fixtureRepoRoot;
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "hb-effects-build-"));

  for (const dir of FIXTURE_SOURCE_DIRS) {
    cpSync(join(REPO_ROOT, dir), join(tempRoot, dir), { recursive: true });
  }

  for (const file of FIXTURE_SOURCE_FILES) {
    cpSync(join(REPO_ROOT, file), join(tempRoot, file));
  }

  symlinkSync(join(REPO_ROOT, "node_modules"), join(tempRoot, "node_modules"), "dir");
  writeFileSync(join(tempRoot, ".source-root"), `${sourceRoot}\n`);
  fixtureRepoRoot = tempRoot;
  return tempRoot;
}

function fixtureEntitiesRoot(): string {
  return join(ensureFixtureRepo(), "data", "ground-truth", "entities");
}

function fixtureEdgesRoot(): string {
  return join(ensureFixtureRepo(), "data", "ground-truth", "edges");
}

function runEffectsBuildFixture() {
  const fixtureRoot = ensureFixtureRepo();
  return spawnSync("tsx", [join(fixtureRoot, "src", "cli", "extract-buff-effects.ts")], {
    cwd: fixtureRoot,
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, GROUND_TRUTH_SOURCE_ROOT: sourceRoot },
  });
}

function snapshotJsonFiles(root: string): Map<string, string> {
  const snapshot = new Map<string, string>();

  for (const file of readdirSync(root).filter((name) => name.endsWith(".json")).sort()) {
    snapshot.set(file, readFileSync(join(root, file), "utf8"));
  }

  return snapshot;
}

describe("effects:build pipeline", () => {
  it("runs without errors", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);
    assert.ok(result.stdout.includes("Populated:"), "Expected summary output");
  });

  it("populates calc on known psyker talent", { skip: !sourceRoot }, () => {
    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "psyker.json"), "utf8"),
    );
    const talent = entities.find(
      (e) => e.internal_name === "psyker_brain_burst_improved",
    );
    assert.ok(talent, "Expected to find psyker talent");
    assert.ok(talent.calc.effects?.length > 0, "Expected non-empty calc.effects");
    assert.ok(talent.calc.buff_template_names?.length > 0, "Expected buff_template_names");
  });

  it("populates tiers on known weapon trait", { skip: !sourceRoot }, () => {
    const allFiles = readdirSync(fixtureEntitiesRoot()).filter((f) => f.endsWith(".json"));
    let found = false;
    for (const file of allFiles) {
      const entities = JSON.parse(
        readFileSync(join(fixtureEntitiesRoot(), file), "utf8"),
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
    const edgeFiles = readdirSync(fixtureEdgesRoot()).filter((f) => f.endsWith(".json"));
    let grantsBuff = 0;
    for (const file of edgeFiles) {
      const edges = JSON.parse(
        readFileSync(join(fixtureEdgesRoot(), file), "utf8"),
      );
      grantsBuff += edges.filter((e) => e.type === "grants_buff").length;
    }
    assert.ok(grantsBuff > 0, `Expected grants_buff edges, got ${grantsBuff}`);
  });

  it("is idempotent", { skip: !sourceRoot }, () => {
    const beforeEntities = snapshotJsonFiles(fixtureEntitiesRoot());
    const beforeEdges = snapshotJsonFiles(fixtureEdgesRoot());

    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Second pipeline run failed:\n${result.stderr}`);

    assert.deepEqual(
      snapshotJsonFiles(fixtureEntitiesRoot()),
      beforeEntities,
      "Expected entity shards to remain unchanged after second run",
    );
    assert.deepEqual(
      snapshotJsonFiles(fixtureEdgesRoot()),
      beforeEdges,
      "Expected edge shards to remain unchanged after second run",
    );
  });
});

process.on("exit", () => {
  if (fixtureRepoRoot) {
    rmSync(fixtureRepoRoot, { recursive: true, force: true });
  }
});
