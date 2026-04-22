import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { REPO_ROOT } from "../lib/load.js";
import { formatCliError } from "../lib/cli.js";

function runCli(scriptPath, args = []) {
  const captureDir = mkdtempSync(join(tmpdir(), "hb-cli-contract-"));
  const stdoutPath = join(captureDir, "stdout.txt");
  const stderrPath = join(captureDir, "stderr.txt");
  const stdoutFd = openSync(stdoutPath, "w");
  const stderrFd = openSync(stderrPath, "w");
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    scriptPath,
    ...args,
  ], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      GROUND_TRUTH_SOURCE_ROOT: "/nonexistent/source-root",
    },
    stdio: ["ignore", stdoutFd, stderrFd],
  });
  closeSync(stdoutFd);
  closeSync(stderrFd);

  return {
    ...result,
    stdout: readFileSync(stdoutPath, "utf8"),
    stderr: readFileSync(stderrPath, "utf8"),
  };
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

  it("list rejects invalid grade filters", () => {
    const result = runCli("src/cli/list-builds.ts", ["data/builds", "--grade", "Z"]);
    assert.notEqual(result.status, 0);
  });

  it("list rejects unknown flags", () => {
    const result = runCli("src/cli/list-builds.ts", ["data/builds", "--bogus-flag"]);
    assert.notEqual(result.status, 0);
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

  it("diff rejects unknown flags", () => {
    const result = runCli("src/cli/diff-builds.ts", [
      "data/builds/09-psyker-2026.json",
      "data/builds/01-veteran-havoc40-2026.json",
      "--bogus-flag",
    ]);
    assert.notEqual(result.status, 0);
  });

  it("diff exits non-zero with missing arguments", () => {
    const result = runCli("src/cli/diff-builds.ts", []);
    assert.notEqual(result.status, 0);
  });
});

describe("CLI contract — score and calc output modes", () => {
  it("score rejects mutually exclusive --json and --text", () => {
    const result = runCli("src/cli/score-build.ts", [
      "data/builds/09-psyker-2026.json",
      "--json",
      "--text",
    ]);
    assert.notEqual(result.status, 0);
  });

  it("score --text prints computed bot flags instead of manual placeholders", () => {
    const result = runCli("src/cli/score-build.ts", [
      "data/builds/03-veteran-sharpshooter-2026.json",
      "--text",
    ]);

    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.equal(result.stdout.includes("BOT FLAGS: (fill manually)"), false);
    assert.equal(result.stdout.includes("QUALITATIVE (fill manually):"), false);
    assert.match(result.stdout, /BOT:NO_WEAKSPOT/);
    assert.match(result.stdout, /BOT:AIM_DEPENDENT/);
  });

  it("calc rejects mutually exclusive --json and --text", () => {
    const result = runCli("src/cli/calc-build.ts", [
      "data/builds/09-psyker-2026.json",
      "--json",
      "--text",
    ]);
    assert.notEqual(result.status, 0);
  });
});

describe("CLI contract — hb analyze", () => {
  it("analyzes canonical build files without a source checkout", () => {
    const result = runCli("src/cli/hb.ts", [
      "analyze",
      "data/builds/09-psyker-2026.json",
    ]);

    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /Psyker Build 2026/);
    assert.match(result.stdout, /Grade:/);
    assert.match(result.stdout, /Input:/);
  });

  it("analyzes raw build files without a source checkout", () => {
    const result = runCli("src/cli/hb.ts", [
      "analyze",
      "data/sample-build.json",
      "--json",
    ]);

    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.input.kind, "raw_build");
    assert.equal(parsed.build.schema_version, 1);
    assert.equal(typeof parsed.scorecard.letter_grade, "string");
  });

  it("rejects unknown hb subcommands", () => {
    const result = runCli("src/cli/hb.ts", ["bogus"]);
    assert.notEqual(result.status, 0);
  });
});
