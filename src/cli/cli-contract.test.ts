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
      "data/builds/08-gandalf-melee-wizard.json",
    ]);

    assert.notEqual(result.status, 0);
  });

  it("index build exits non-zero on source-root setup failure", () => {
    const result = runCli("src/cli/build-ground-truth-index.ts");

    assert.notEqual(result.status, 0);
  });
});
