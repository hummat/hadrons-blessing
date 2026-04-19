import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { REPO_ROOT } from "./load.js";

const sourceRoot = process.env.GROUND_TRUTH_SOURCE_ROOT
  ? resolve(process.env.GROUND_TRUTH_SOURCE_ROOT)
  : undefined;
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

  it("populates calc on known psyker coherency aura", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);

    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "psyker.json"), "utf8"),
    );
    const aura = entities.find(
      (e) => e.internal_name === "psyker_cooldown_aura_improved",
    );
    assert.ok(aura, "Expected to find psyker aura");
    assert.ok(aura.calc.effects?.length > 0, "Expected non-empty calc.effects");
    assert.deepEqual(
      aura.calc.buff_template_names,
      ["psyker_aura_ability_cooldown_improved"],
      "Expected coherency buff template to be linked into calc metadata",
    );
  });

  it("populates calc on the Warp Siphon max-souls modifier", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);

    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "psyker.json"), "utf8"),
    );
    const modifier = entities.find(
      (e) => e.internal_name === "psyker_increased_max_souls",
    );
    assert.ok(modifier, "Expected to find Warp Siphon max-souls modifier");
    assert.deepEqual(modifier.calc.effects, [
      {
        stat: "max_souls",
        magnitude: 6,
        magnitude_expr: null,
        magnitude_min: null,
        magnitude_max: null,
        condition: null,
        trigger: null,
        type: "stat_buff",
      },
    ]);
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

  it("preserves all four tiers for weapon perks and exposes the max tier in calc.effects", { skip: !sourceRoot }, () => {
    const result = runEffectsBuildFixture();
    assert.equal(result.status, 0, `Pipeline failed:\n${result.stderr}`);

    const entities = JSON.parse(
      readFileSync(join(fixtureEntitiesRoot(), "shared-weapons.json"), "utf8"),
    );
    const perk = entities.find(
      (e) => e.id === "shared.weapon_perk.ranged.weapon_trait_ranged_increase_crit_chance",
    );

    assert.ok(perk, "Expected to find ranged crit chance weapon perk");
    assert.equal(perk.calc?.tiers?.length, 4, "Expected all four perk tiers to be preserved");
    assert.equal(perk.calc?.tiers?.[0]?.effects?.[0]?.magnitude, 0.02);
    assert.equal(perk.calc?.tiers?.[3]?.effects?.[0]?.magnitude, 0.05);
    assert.equal(
      perk.calc?.effects?.[0]?.magnitude,
      0.05,
      "Expected calc.effects to use the endgame-tier perk magnitude",
    );
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
