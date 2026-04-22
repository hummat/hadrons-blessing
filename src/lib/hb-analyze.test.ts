import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAnalyzeTarget } from "./hb-analyze.js";

function makeCanonicalBuild() {
  return {
    schema_version: 1,
    title: "Fixture",
    class: {
      raw_label: "psyker",
      canonical_entity_id: "shared.class.psyker",
      resolution_status: "resolved",
    },
    provenance: {
      source_kind: "gameslantern",
      source_url: "https://darktide.gameslantern.com/builds/example",
      author: "tester",
      scraped_at: "2026-04-22T12:00:00Z",
    },
    ability: {
      raw_label: "Scrier's Gaze",
      canonical_entity_id: "psyker.ability.psyker_gun",
      resolution_status: "resolved",
    },
    blitz: {
      raw_label: "Brain Rupture",
      canonical_entity_id: "psyker.blitz.psyker_smite_target",
      resolution_status: "resolved",
    },
    aura: {
      raw_label: "Psykinetic's Aura",
      canonical_entity_id: "psyker.aura.quell_on_elite_kill_aura",
      resolution_status: "resolved",
    },
    keystone: null,
    talents: [],
    weapons: [
      {
        slot: "melee",
        name: {
          raw_label: "Munitorum Mk III Power Sword",
          canonical_entity_id: "shared.weapon.powersword_p1_m1",
          resolution_status: "resolved",
        },
        perks: [],
        blessings: [],
      },
      {
        slot: "ranged",
        name: {
          raw_label: "Accatran Recon Lasgun Mk VId",
          canonical_entity_id: "shared.weapon.lasgun_p3_m1",
          resolution_status: "resolved",
        },
        perks: [],
        blessings: [],
      },
    ],
    curios: [],
  };
}

describe("loadAnalyzeTarget", () => {
  it("routes Games Lantern URLs through the extractor and canonicalizer", async () => {
    const calls: string[] = [];
    const canonical = makeCanonicalBuild();
    const rawBuild = { title: "Fixture Raw" };

    const result = await loadAnalyzeTarget(
      "https://darktide.gameslantern.com/builds/example",
      {
        extractBuild: async (url) => {
          calls.push(`extract:${url}`);
          return rawBuild;
        },
        canonicalizeScrapedBuild: async (raw) => {
          calls.push(`canonicalize:${String((raw as { title?: string }).title)}`);
          return canonical;
        },
      },
    );

    assert.equal(result.input.kind, "gameslantern_url");
    assert.equal(result.build.title, canonical.title);
    // Order-independent assertions: extract runs before canonicalize, but
    // we don't pin exact strings so future debug logs don't break this test.
    assert.ok(calls.some((c) => c.startsWith("extract:")));
    assert.ok(calls.some((c) => c.startsWith("canonicalize:")));
  });

  it("returns canonical_build kind for files that validate", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "hb-analyze-"));
    const file = join(tmp, "build.json");
    const canonical = makeCanonicalBuild();
    writeFileSync(file, JSON.stringify(canonical));
    try {
      const result = await loadAnalyzeTarget(file);
      assert.equal(result.input.kind, "canonical_build");
      assert.equal(result.build.title, "Fixture");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("routes raw scrape JSON through canonicalizer", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "hb-analyze-raw-"));
    const file = join(tmp, "raw.json");
    // A raw scrape lacks schema_version; writing an object without it forces
    // the raw_build branch.
    writeFileSync(file, JSON.stringify({ title: "Raw Scrape", talents: "not-an-array" }));
    const canonical = makeCanonicalBuild();
    const calls: string[] = [];
    try {
      const result = await loadAnalyzeTarget(file, {
        canonicalizeScrapedBuild: async (raw) => {
          calls.push(`canonicalize:${String((raw as { title?: string }).title)}`);
          return canonical;
        },
      });
      assert.equal(result.input.kind, "raw_build");
      assert.deepEqual(calls, ["canonicalize:Raw Scrape"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("surfaces detailed validation errors with instancePath", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "hb-analyze-bad-"));
    const file = join(tmp, "bad.json");
    // schema_version integer + talents array + class object triggers the
    // canonical path, but missing required fields (provenance, ability, etc.)
    // produces multiple Ajv errors.
    writeFileSync(file, JSON.stringify({
      schema_version: 1,
      talents: [],
      class: { raw_label: "x", canonical_entity_id: null, resolution_status: "unresolved" },
    }));
    try {
      await assert.rejects(
        () => loadAnalyzeTarget(file),
        /Invalid canonical build:.+/,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects non-object JSON input", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "hb-analyze-arr-"));
    const file = join(tmp, "arr.json");
    writeFileSync(file, JSON.stringify(["not", "an", "object"]));
    try {
      await assert.rejects(() => loadAnalyzeTarget(file), /Expected JSON object input/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
