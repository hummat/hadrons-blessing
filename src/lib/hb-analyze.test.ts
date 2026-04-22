import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
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
    assert.deepEqual(calls, [
      "extract:https://darktide.gameslantern.com/builds/example",
      "canonicalize:Fixture Raw",
    ]);
  });
});
