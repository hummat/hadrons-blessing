import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "./load.js";
import { inspectEntity } from "./inspect.js";

describe("inspectEntity", () => {
  it("returns entity details, aliases, evidence, and edges for a canonical id", () => {
    const result = inspectEntity("psyker.talent.psyker_damage_based_on_warp_charge");

    assert.equal(result.id, "psyker.talent.psyker_damage_based_on_warp_charge");
    assert.equal(result.entity.internal_name, "psyker_damage_based_on_warp_charge");
    assert.ok(result.aliases.some((alias) => alias.text === "Warp Rider"));
    assert.ok(result.evidence.some((record) => record.id === "psyker.evidence.entity.psyker_damage_based_on_warp_charge"));
    assert.ok(result.edges.some((edge) => edge.id === "psyker.edge.belongs_to_tree_node.psyker_damage_based_on_warp_charge"));
  });

  it("returns null for an unknown canonical id", () => {
    assert.equal(inspectEntity("shared.weapon.definitely_fake"), null);
  });
});

describe("inspect-ground-truth CLI", () => {
  it("runs successfully for a known canonical id without source-root setup", () => {
    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "src/cli/inspect-ground-truth.ts",
      "--id",
      "psyker.talent.psyker_damage_based_on_warp_charge",
    ], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        GROUND_TRUTH_SOURCE_ROOT: "",
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 0);
  });

  it("fails non-zero for an unknown canonical id", () => {
    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "src/cli/inspect-ground-truth.ts",
      "--id",
      "shared.weapon.definitely_fake",
    ], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        GROUND_TRUTH_SOURCE_ROOT: "",
      },
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
  });
});
