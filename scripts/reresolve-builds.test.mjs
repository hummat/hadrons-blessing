import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { reresolveBuildTargets } from "./reresolve-builds.mjs";

function makeSelection(rawLabel, canonicalEntityId = null, resolutionStatus = "unresolved") {
  return {
    raw_label: rawLabel,
    canonical_entity_id: canonicalEntityId,
    resolution_status: resolutionStatus,
  };
}

function makeCanonicalBuild(overrides = {}) {
  return {
    schema_version: 1,
    title: "Fixture",
    class: makeSelection("psyker", "shared.class.psyker", "resolved"),
    provenance: {
      source_kind: "gameslantern",
      source_url: "legacy-fixture://scripts/builds/example.json",
      author: "tester",
      scraped_at: "2026-03-13T00:00:00Z",
    },
    ability: makeSelection("Unknown ability"),
    blitz: makeSelection("Unknown blitz"),
    aura: makeSelection("Unknown aura"),
    keystone: null,
    talents: [makeSelection("Warp Rider")],
    weapons: [
      {
        slot: "melee",
        name: makeSelection("Covenant Mk VI Blaze Force Greatsword", "shared.weapon.forcesword_2h_p1_m1", "resolved"),
        perks: [],
        blessings: [],
      },
      {
        slot: "ranged",
        name: makeSelection("Equinox Mk III Voidblast Force Staff", "shared.weapon.forcestaff_p4_m1", "resolved"),
        perks: [],
        blessings: [],
      },
    ],
    curios: [
      {
        name: makeSelection("Blessed Bullet", null, "non_canonical"),
        perks: [],
      },
    ],
    ...overrides,
  };
}

function makeDeps(overrides = {}) {
  return {
    resolveQuery: async (query) => {
      if (query === "Warp Rider") {
        return {
          resolution_state: "resolved",
          resolved_entity_id: "psyker.talent.psyker_damage_based_on_warp_charge",
        };
      }

      return {
        resolution_state: "unresolved",
        resolved_entity_id: null,
      };
    },
    classifyKnownUnresolved: (text) => (
      text === "Blessed Bullet"
        ? { text, status: "known_display_only" }
        : null
    ),
    ...overrides,
  };
}

describe("reresolveBuildTargets", () => {
  it("walks canonical build files in a directory", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hb-reresolve-"));
    writeFileSync(join(tempDir, "a.json"), JSON.stringify(makeCanonicalBuild(), null, 2));
    writeFileSync(join(tempDir, "b.json"), JSON.stringify(makeCanonicalBuild(), null, 2));

    const result = await reresolveBuildTargets([tempDir], makeDeps());
    assert.equal(result.files.length, 2);
  });

  it("re-resolves unresolved selections when possible", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hb-reresolve-"));
    const filePath = join(tempDir, "build.json");
    writeFileSync(filePath, JSON.stringify(makeCanonicalBuild(), null, 2));

    const result = await reresolveBuildTargets([filePath], makeDeps());
    assert.equal(result.files[0].build.talents[0].resolution_status, "resolved");
    assert.equal(
      result.files[0].build.talents[0].canonical_entity_id,
      "psyker.talent.psyker_damage_based_on_warp_charge",
    );
  });

  it("preserves already resolved selections by default", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hb-reresolve-"));
    const filePath = join(tempDir, "build.json");
    const build = makeCanonicalBuild({
      talents: [makeSelection("Warp Rider", "psyker.talent.original", "resolved")],
    });
    writeFileSync(filePath, JSON.stringify(build, null, 2));

    const result = await reresolveBuildTargets([filePath], makeDeps());
    assert.equal(result.files[0].build.talents[0].canonical_entity_id, "psyker.talent.original");
  });

  it("can overwrite build files in place", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hb-reresolve-"));
    const filePath = join(tempDir, "build.json");
    writeFileSync(filePath, JSON.stringify(makeCanonicalBuild(), null, 2));

    await reresolveBuildTargets([filePath], {
      ...makeDeps(),
      write: true,
    });

    const updated = JSON.parse(readFileSync(filePath, "utf8"));
    assert.equal(updated.talents[0].resolution_status, "resolved");
  });

  it("exits non-zero on schema-invalid build files", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hb-reresolve-"));
    const filePath = join(tempDir, "invalid.json");
    writeFileSync(filePath, JSON.stringify({ title: "bad" }, null, 2));

    const result = spawnSync("node", ["scripts/reresolve-builds.mjs", filePath], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
  });
});
