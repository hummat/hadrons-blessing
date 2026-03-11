import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { normalizeText } from "./ground-truth/lib/normalize.mjs";
import {
  loadSchemas,
  validateAliasRecord,
  validateEntityRecord,
  validateSourceSnapshot,
} from "./ground-truth/lib/validate.mjs";

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
    await assert.rejects(
      () => validateSourceSnapshot("/definitely/missing"),
      /GROUND_TRUTH_SOURCE_ROOT/,
    );
  });

  it("accepts a matching pinned checkout", async () => {
    await loadSchemas();
    const sourceRoot = process.env.GROUND_TRUTH_SOURCE_ROOT;
    const result = await validateSourceSnapshot(sourceRoot);
    assert.equal(typeof result.git_revision, "string");
    assert.equal(result.git_revision.length > 0, true);
  });
});
