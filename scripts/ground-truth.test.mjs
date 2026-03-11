import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { normalizeText } from "./ground-truth/lib/normalize.mjs";
import {
  loadSchemas,
  validateAliasRecord,
  validateEntityRecord,
  validateSourceSnapshot,
} from "./ground-truth/lib/validate.mjs";
import { buildIndex } from "./build-ground-truth-index.mjs";

const PINNED_SOURCE_ROOT = process.env.GROUND_TRUTH_SOURCE_ROOT ?? null;

describe("normalizeText", () => {
  it("normalizes guide-style text deterministically", () => {
    assert.equal(normalizeText("Warp-Rider / Psyker"), "warp rider psyker");
  });

  it("collapses repeated whitespace and punctuation", () => {
    assert.equal(normalizeText("  Blazing__Spirit!! "), "blazing spirit");
  });
});

describe("schema validation", () => {
  it("rejects inferred ui_name in canonical entities", async () => {
    await loadSchemas();
    const result = validateEntityRecord({
      id: "psyker.talent.fake",
      kind: "talent",
      domain: "psyker",
      internal_name: "fake",
      loc_key: "loc_fake",
      ui_name: "Guess",
      status: "inferred_ui_name",
      refs: [],
      source_snapshot_id: "snapshot.fake",
      attributes: {},
      calc: {},
    });
    assert.equal(result.ok, false);
  });

  it("rejects fuzzy loc_key aliases", async () => {
    await loadSchemas();
    const result = validateAliasRecord({
      text: "loc_psyker_fake",
      normalized_text: "loc psyker fake",
      candidate_entity_id: "psyker.talent.fake",
      alias_kind: "loc_key",
      match_mode: "fuzzy_allowed",
      provenance: "generator",
      confidence: "high",
      context_constraints: {
        require_all: [{ key: "class", value: "psyker" }],
        prefer: [],
      },
      rank_weight: 100,
      notes: "",
    });
    assert.equal(result.ok, false);
  });
});

describe("source snapshot validation", () => {
  it("fails when the declared source root is missing", async () => {
    await loadSchemas();
    assert.throws(
      () => validateSourceSnapshot("/definitely/missing"),
      /GROUND_TRUTH_SOURCE_ROOT/,
    );
  });

  it(
    "accepts a matching pinned checkout",
    { skip: PINNED_SOURCE_ROOT == null },
    async () => {
    await loadSchemas();
    const result = validateSourceSnapshot(PINNED_SOURCE_ROOT);
    assert.equal(typeof result.git_revision, "string");
    assert.equal(result.git_revision.length > 0, true);
    },
  );
});

describe("buildIndex", () => {
  it("generates exact-only synthetic aliases for internal_name and loc_key", async () => {
    const index = await buildIndex({ check: false });
    const warpRiderAliases = index.aliases.filter(
      (alias) =>
        alias.candidate_entity_id ===
        "psyker.talent.psyker_damage_based_on_warp_charge",
    );

    assert.ok(
      warpRiderAliases.some(
        (alias) =>
          alias.alias_kind === "internal_name" &&
          alias.match_mode === "exact_only",
      ),
    );
  });

  it("fails overlapping fuzzy collisions", async () => {
    await assert.rejects(
      () => buildIndex({ check: false, injectBadFixture: "overlapping-fuzzy-collision" }),
      /unsafe alias collision/,
    );
  });

  it("writes generated metadata with the pinned source snapshot id", async () => {
    const index = await buildIndex({ check: false });

    assert.equal(index.meta.source_snapshot_id.startsWith("darktide-source."), true);
    assert.equal(typeof index.meta.input_fingerprint, "string");
    assert.equal(Array.isArray(index.meta.shard_manifest.entities), true);
  });

  it("fails when the Psyker shard is incomplete", async () => {
    const expectedIds = JSON.parse(
      readFileSync("tests/fixtures/ground-truth/expected-psyker-coverage.json", "utf8"),
    );
    const index = await buildIndex({ check: false });
    const entityIds = new Set(
      index.entities.filter((entity) => entity.domain === "psyker").map((entity) => entity.id),
    );

    for (const id of expectedIds) {
      assert.equal(entityIds.has(id), true, `missing Psyker entity ${id}`);
    }
  });

  it("fails when required shared pilot records are missing", async () => {
    const expected = JSON.parse(
      readFileSync(
        "tests/fixtures/ground-truth/expected-shared-pilot-coverage.json",
        "utf8",
      ),
    );
    const index = await buildIndex({ check: false });
    const entityIds = new Set(index.entities.map((entity) => entity.id));
    const edgeIds = new Set(index.edges.map((edge) => edge.id));
    const evidenceIds = new Set(index.evidence.map((evidence) => evidence.id));

    for (const id of expected.entities) {
      assert.equal(entityIds.has(id), true, `missing shared entity ${id}`);
    }

    for (const id of expected.edges) {
      assert.equal(edgeIds.has(id), true, `missing shared edge ${id}`);
    }

    for (const id of expected.evidence) {
      assert.equal(evidenceIds.has(id), true, `missing shared evidence ${id}`);
    }
  });

  it("fails when pilot alias coverage is incomplete", async () => {
    const expectedTexts = JSON.parse(
      readFileSync("tests/fixtures/ground-truth/expected-pilot-aliases.json", "utf8"),
    );
    const index = await buildIndex({ check: false });
    const aliasTexts = new Set(index.aliases.map((alias) => alias.text));

    for (const text of expectedTexts) {
      assert.equal(aliasTexts.has(text), true, `missing pilot alias ${text}`);
    }
  });
});
