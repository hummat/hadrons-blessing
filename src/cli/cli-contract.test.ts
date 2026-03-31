import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "../lib/load.js";
import { formatCliError } from "../lib/cli.js";

function runCli(scriptPath, args = []) {
  const quotedArgs = args.map((arg) => JSON.stringify(arg)).join(" ");
  const command = `GROUND_TRUTH_SOURCE_ROOT=/nonexistent/source-root tsx ${JSON.stringify(scriptPath)} ${quotedArgs}`.trim();

  return spawnSync("/usr/bin/zsh", ["-lc", command], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

describe("CLI setup errors", () => {
  it("formats resolve setup errors clearly", () => {
    const output = formatCliError(
      "resolve",
      new Error("Pinned source snapshot mismatch: expected abc, got def"),
    );

    assert.match(output, /GROUND_TRUTH_SOURCE_ROOT/);
    assert.match(output, /npm run resolve/);
    assert.equal(output.includes("Error:"), false);
  });

  it("formats audit setup errors clearly", () => {
    const output = formatCliError(
      "audit",
      new Error("GROUND_TRUTH_SOURCE_ROOT is required"),
    );

    assert.match(output, /GROUND_TRUTH_SOURCE_ROOT/);
    assert.match(output, /npm run audit/);
    assert.equal(output.includes("Error:"), false);
  });

  it("formats index build setup errors clearly", () => {
    const output = formatCliError(
      "index:build",
      new Error("Pinned source snapshot mismatch: expected abc, got def"),
    );

    assert.match(output, /GROUND_TRUTH_SOURCE_ROOT/);
    assert.match(output, /npm run index:build/);
    assert.equal(output.includes("Error:"), false);
  });

  it("resolve exits non-zero on source-root setup failure", () => {
    const result = runCli("src/cli/resolve-ground-truth.ts", [
      "--query",
      "Warp Rider",
      "--context",
      '{"kind":"talent","class":"psyker"}',
    ]);

    assert.notEqual(result.status, 0);
  });

  it("audit exits non-zero on source-root setup failure", () => {
    const result = runCli("src/cli/audit-build-names.ts", [
      "data/builds/09-psyker-2026.json",
    ]);

    assert.notEqual(result.status, 0);
  });

  it("index build exits non-zero on source-root setup failure", () => {
    const result = runCli("src/cli/build-ground-truth-index.ts");

    assert.notEqual(result.status, 0);
  });
});

describe("CLI contract — list and diff", () => {
  it("list exits zero with default args", () => {
    const result = runCli("src/cli/list-builds.ts", ["data/builds"]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes("build(s)"), "should show build count");
  });

  it("list --json exits zero and produces valid JSON", () => {
    const result = runCli("src/cli/list-builds.ts", ["data/builds", "--json"]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.ok(Array.isArray(parsed), "should produce an array");
    assert.equal(parsed.length, 24);
  });

  it("diff exits zero with two builds", () => {
    const result = runCli("src/cli/diff-builds.ts", [
      "data/builds/09-psyker-2026.json",
      "data/builds/01-veteran-havoc40-2026.json",
    ]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes("DIFF:"), "should show diff header");
  });

  it("diff --json exits zero and produces valid JSON", () => {
    const result = runCli("src/cli/diff-builds.ts", [
      "data/builds/09-psyker-2026.json",
      "data/builds/01-veteran-havoc40-2026.json",
      "--json",
    ]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.a, "should have build A metadata");
    assert.ok(parsed.b, "should have build B metadata");
    assert.ok(Array.isArray(parsed.score_deltas), "should have score deltas");
  });

  it("diff exits non-zero with missing arguments", () => {
    const result = runCli("src/cli/diff-builds.ts", []);
    assert.notEqual(result.status, 0);
  });
});
