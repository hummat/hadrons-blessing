import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { REPO_ROOT, resolveSourceRoot } from "./load.js";
import { normalizeText } from "./normalize.js";
import {
  loadSchemas,
  validateAliasRecord,
  validateEntityRecord,
  validateSourceSnapshot,
} from "./validate.js";
import { buildIndex } from "./ground-truth-index.js";
import { resolveQuery } from "./resolve.js";
import { auditBuildFile } from "./audit-build-file.js";

const PINNED_SOURCE_ROOT = resolveSourceRoot();

function makeCanonicalSelection(rawLabel, canonicalEntityId, resolutionStatus = "resolved") {
  return {
    raw_label: rawLabel,
    canonical_entity_id: canonicalEntityId,
    resolution_status: resolutionStatus,
  };
}

function writeTempCanonicalBuild(build) {
  const tempDir = mkdtempSync(join(tmpdir(), "hb-audit-canonical-"));
  const filePath = join(tempDir, "build.json");
  writeFileSync(filePath, JSON.stringify(build, null, 2));
  return filePath;
}

function expectedPersistedUnresolvedFields(build) {
  if (build?.schema_version !== 1) {
    return [];
  }

  const expected = [];

  function addSelection(field, selection) {
    if (selection?.resolution_status === "unresolved") {
      expected.push(field);
    }
  }

  for (const field of ["ability", "blitz", "aura", "keystone"]) {
    addSelection(field, build[field]);
  }

  for (const [index, talent] of (build.talents ?? []).entries()) {
    addSelection(`talents[${index}]`, talent);
  }

  for (const [weaponIndex, weapon] of (build.weapons ?? []).entries()) {
    addSelection(`weapons[${weaponIndex}].name`, weapon?.name);

    for (const [perkIndex, perk] of (weapon?.perks ?? []).entries()) {
      addSelection(`weapons[${weaponIndex}].perks[${perkIndex}]`, perk);
    }

    for (const [blessingIndex, blessing] of (weapon?.blessings ?? []).entries()) {
      addSelection(`weapons[${weaponIndex}].blessings[${blessingIndex}].name`, blessing);
    }
  }

  for (const [curioIndex, curio] of (build.curios ?? []).entries()) {
    addSelection(`curios[${curioIndex}].name`, curio?.name);

    for (const [perkIndex, perk] of (curio?.perks ?? []).entries()) {
      addSelection(`curios[${curioIndex}].perks[${perkIndex}]`, perk);
    }
  }

  return expected.sort();
}

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

  it("fails dangling edge targets", async () => {
    await assert.rejects(
      () => buildIndex({ check: false, injectBadFixture: "dangling-edge-target" }),
      /Edge target does not exist/,
    );
  });

  it("fails dangling evidence subjects", async () => {
    await assert.rejects(
      () => buildIndex({ check: false, injectBadFixture: "dangling-evidence-subject" }),
      /Evidence subject does not exist/,
    );
  });

  it("fails dangling evidence entity values", async () => {
    await assert.rejects(
      () => buildIndex({ check: false, injectBadFixture: "dangling-evidence-value" }),
      /Evidence value entity does not exist/,
    );
  });

  it("fails dangling edge evidence references", async () => {
    await assert.rejects(
      () => buildIndex({ check: false, injectBadFixture: "dangling-edge-evidence-id" }),
      /Edge evidence id does not exist/,
    );
  });

  it("fails mismatched entity source snapshot ids", async () => {
    await assert.rejects(
      () => buildIndex({ check: false, injectBadFixture: "mismatched-entity-source-snapshot-id" }),
      /entity record has mismatched source snapshot id/,
    );
  });

  it("fails mismatched edge source snapshot ids", async () => {
    await assert.rejects(
      () => buildIndex({ check: false, injectBadFixture: "mismatched-edge-source-snapshot-id" }),
      /edge record has mismatched source snapshot id/,
    );
  });

  it("fails mismatched evidence source snapshot ids", async () => {
    await assert.rejects(
      () => buildIndex({ check: false, injectBadFixture: "mismatched-evidence-source-snapshot-id" }),
      /evidence record has mismatched source snapshot id/,
    );
  });

  it("fails edge evidence subject mismatches", async () => {
    await assert.rejects(
      () => buildIndex({ check: false, injectBadFixture: "edge-evidence-subject-mismatch" }),
      /Edge evidence subject mismatch/,
    );
  });

  it("fails orphaned edge-subject evidence", async () => {
    await assert.rejects(
      () => buildIndex({ check: false, injectBadFixture: "orphaned-edge-subject-evidence" }),
      /Edge evidence is not referenced by its subject edge/,
    );
  });

  it("fails missing entity ref paths", async () => {
    await assert.rejects(
      () => buildIndex({ check: false, injectBadFixture: "missing-entity-ref-path" }),
      /entity ref path does not exist/,
    );
  });

  it("fails missing evidence ref paths", async () => {
    await assert.rejects(
      () => buildIndex({ check: false, injectBadFixture: "missing-evidence-ref-path" }),
      /evidence ref path does not exist/,
    );
  });

  it("fails out-of-range entity ref lines", async () => {
    await assert.rejects(
      () => buildIndex({ check: false, injectBadFixture: "out-of-range-entity-ref-line" }),
      /entity ref line is out of range/,
    );
  });

  it("fails out-of-range evidence ref lines", async () => {
    await assert.rejects(
      () => buildIndex({ check: false, injectBadFixture: "out-of-range-evidence-ref-line" }),
      /evidence ref line is out of range/,
    );
  });

  it("writes generated metadata with the pinned source snapshot id", async () => {
    const index = await buildIndex({ check: false });

    assert.equal(index.meta.source_snapshot_id.startsWith("darktide-source."), true);
    assert.equal(typeof index.meta.input_fingerprint, "string");
    assert.equal(Array.isArray(index.meta.shard_manifest.entities), true);
  });

  it("keeps all entity, edge, and evidence records on the pinned source snapshot", async () => {
    const index = await buildIndex({ check: false });

    for (const record of [...index.entities, ...index.edges, ...index.evidence]) {
      assert.equal(
        record.source_snapshot_id,
        index.meta.source_snapshot_id,
        `record ${record.id} drifted off the pinned snapshot`,
      );
    }
  });

  it(
    "dereferences every entity and evidence ref against the pinned source root",
    { skip: PINNED_SOURCE_ROOT == null },
    async () => {
      const index = await buildIndex({ check: false });
      const roots = [REPO_ROOT, PINNED_SOURCE_ROOT];

      for (const record of [...index.entities, ...index.evidence]) {
        for (const ref of record.refs) {
          const resolvedPath = roots
            .map((root) => resolve(root, ref.path))
            .find((candidate) => existsSync(candidate));
          assert.notEqual(resolvedPath, undefined, `missing ref path for ${record.id}`);
          const owningRoot = roots.find((root) => {
            const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
            return resolvedPath === root || resolvedPath.startsWith(normalizedRoot);
          });
          assert.equal(
            owningRoot != null,
            true,
            `ref escapes known roots for ${record.id}`,
          );
          assert.equal(Number.isInteger(ref.line) && ref.line > 0, true, `invalid ref line for ${record.id}`);
        }
      }
    },
  );

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

  it("includes evidence records for known bad-case mappings", async () => {
    const index = await buildIndex({ check: false });
    const evidenceIds = new Set(index.evidence.map((evidence) => evidence.id));

    for (const id of [
      "psyker.evidence.entity.psyker_damage_based_on_warp_charge",
      "psyker.evidence.entity.psyker_brain_burst_improved",
      "psyker.evidence.entity.psyker_aura_crit_chance_aura",
      "psyker.evidence.entity.psyker_block_costs_warp_charge",
      "shared.evidence.edge.instance_of.weapon_trait_bespoke_forcesword_2h_p1_warp_burninating_on_crit",
      "shared.evidence.edge.instance_of.weapon_trait_bespoke_forcesword_2h_p1_chained_hits_increases_crit_chance_parent",
      "shared.evidence.edge.instance_of.weapon_trait_bespoke_forcesword_2h_p1_dodge_grants_critical_strike_chance",
    ]) {
      assert.equal(evidenceIds.has(id), true, `missing evidence ${id}`);
    }
  });

  it("fails when shared class coverage is incomplete", async () => {
    const expected = JSON.parse(
      readFileSync("tests/fixtures/ground-truth/expected-class-resolution.json", "utf8"),
    );
    const index = await buildIndex({ check: false });
    const entityIds = new Set(
      index.entities.filter((entity) => entity.kind === "class").map((entity) => entity.id),
    );

    for (const { expected_entity_id: id } of expected) {
      assert.equal(entityIds.has(id), true, `missing class entity ${id}`);
    }
  });

  it("fails when shared curio perk coverage is incomplete", async () => {
    const expected = JSON.parse(
      readFileSync("tests/fixtures/ground-truth/expected-curio-perk-resolution.json", "utf8"),
    );
    const index = await buildIndex({ check: false });
    const entityIds = new Set(
      index.entities.filter((entity) => entity.kind === "gadget_trait").map((entity) => entity.id),
    );

    for (const { expected_entity_id: id } of expected) {
      assert.equal(entityIds.has(id), true, `missing gadget trait ${id}`);
    }
  });

  it("fails when class-side selectable node coverage is incomplete", async () => {
    const manifest = JSON.parse(
      readFileSync("data/ground-truth/generated/class-tree-manifest.json", "utf8"),
    );
    const index = await buildIndex({ check: false });
    const entityIds = new Set(index.entities.map((entity) => entity.id));

    for (const entry of manifest) {
      assert.equal(
        entityIds.has(entry.entity_id),
        true,
        `missing class-side entity ${entry.entity_id} from ${entry.class}:${entry.internal_name}`,
      );
    }
  });

  it("fails when class-side GamesLantern alias coverage is incomplete", { skip: !existsSync("data/ground-truth/generated/gl-class-tree-labels.json") }, async () => {
    const manifest = JSON.parse(
      readFileSync("data/ground-truth/generated/gl-class-tree-labels.json", "utf8"),
    );

    for (const entry of manifest) {
      const result = await resolveQuery(entry.display_name, {
        class: entry.class,
        kind: entry.kind,
      });

      assert.equal(
        result.resolution_state,
        "resolved",
        `failed to resolve ${entry.class}:${entry.kind}:${entry.display_name}`,
      );
      assert.equal(
        result.entity?.id,
        entry.entity_id,
        `wrong entity for ${entry.class}:${entry.kind}:${entry.display_name}`,
      );
    }
  });

  it("fails when shared weapon perk coverage is incomplete", async () => {
    const expected = JSON.parse(
      readFileSync("tests/fixtures/ground-truth/expected-weapon-perk-resolution.json", "utf8"),
    );
    const index = await buildIndex({ check: false });
    const entityIds = new Set(
      index.entities.filter((entity) => entity.kind === "weapon_perk").map((entity) => entity.id),
    );

    for (const { expected_entity_id: id } of expected) {
      assert.equal(entityIds.has(id), true, `missing weapon perk ${id}`);
    }
  });

  it("fails when shared blessing family coverage is incomplete", async () => {
    const expected = JSON.parse(
      readFileSync("tests/fixtures/ground-truth/expected-blessing-family-resolution.json", "utf8"),
    );
    const index = await buildIndex({ check: false });
    const entityIds = new Set(
      index.entities.filter((entity) => entity.kind === "name_family").map((entity) => entity.id),
    );

    for (const { expected_entity_id: id } of expected) {
      assert.equal(entityIds.has(id), true, `missing blessing family ${id}`);
    }
  });

  it("fails when shared weapon coverage is incomplete", async () => {
    const expected = JSON.parse(
      readFileSync("tests/fixtures/ground-truth/expected-weapon-resolution.json", "utf8"),
    );
    const index = await buildIndex({ check: false });
    const entityIds = new Set(
      index.entities.filter((entity) => entity.kind === "weapon").map((entity) => entity.id),
    );

    for (const { expected_entity_id: id } of expected) {
      assert.equal(entityIds.has(id), true, `missing weapon ${id}`);
    }
  });
});

describe("resolveQuery", () => {
  it("resolves all golden cases", async () => {
    const cases = JSON.parse(
      readFileSync("tests/fixtures/ground-truth/resolver-golden.json", "utf8"),
    );

    for (const testCase of cases) {
      const result = await resolveQuery(testCase.query, testCase.query_context);
      assert.equal(result.resolution_state, testCase.expected_state);
      assert.equal(result.resolved_entity_id ?? null, testCase.expected_entity_id ?? null);
      assert.equal(
        result.proposed_entity_id ?? null,
        testCase.expected_proposed_entity_id ?? null,
      );
      assert.equal(result.match_type, testCase.expected_match_type);
      assert.equal(result.confidence, testCase.expected_confidence);
      assert.equal(typeof result.score, "number");
      assert.equal(typeof result.score_margin, "number");
      assert.equal(typeof result.why_this_match, "string");
      assert.equal(Array.isArray(result.candidate_trace), true);
      assert.equal(Array.isArray(result.refs), true);
      assert.equal(Array.isArray(result.supporting_evidence), true);
      assert.equal(result.candidate_trace.length > 0, true);
      assert.equal(result.refs.length > 0, true);
      assert.equal(typeof result.candidate_trace[0].entity_id, "string");
      assert.equal(typeof result.candidate_trace[0].score, "number");
      assert.equal(typeof result.candidate_trace[0].context_match_explanation, "string");
      assert.equal(typeof result.refs[0].path, "string");
      assert.equal(typeof result.refs[0].line, "number");
      assert.equal(result.supporting_evidence.length > 0, true);
      assert.deepEqual(result.warnings, testCase.expected_warnings);
    }
  });

  it("resolves all structured build class names", async () => {
    const cases = JSON.parse(
      readFileSync("tests/fixtures/ground-truth/expected-class-resolution.json", "utf8"),
    );

    for (const testCase of cases) {
      const result = await resolveQuery(testCase.query, {
        kind: "class",
        class: testCase.query,
      });

      assert.equal(result.resolution_state, "resolved");
      assert.equal(result.resolved_entity_id, testCase.expected_entity_id);
    }
  });

  it("keeps unrelated weapon labels unresolved instead of fuzzy-guessing", async () => {
    for (const [query, queryContext] of [
      ["Zarkon Mk X Plasma Thrower", { kind: "weapon", slot: "ranged" }],
      ["Zorgon Mk III Void Lance", { kind: "weapon", slot: "ranged" }],
      ["Blarnak Mk IX Gravity Hammer", { kind: "weapon", slot: "melee" }],
      ["Quorzak Mk II Phase Blade", { kind: "weapon", slot: "melee" }],
    ]) {
      const result = await resolveQuery(query, queryContext);

      assert.equal(result.resolution_state, "unresolved");
      assert.equal(result.resolved_entity_id, null);
      assert.equal(result.proposed_entity_id, null);
      assert.equal(result.match_type, "none");
    }
  });

  it("keeps unrelated curio perk labels unresolved instead of fuzzy-guessing", async () => {
    for (const query of ["+99% DR vs Dreg Ragers", "+7-8% Experience Gain"]) {
      const result = await resolveQuery(query, {
        kind: "gadget_trait",
        slot: "curio",
      });

      assert.equal(result.resolution_state, "unresolved");
      assert.equal(result.resolved_entity_id, null);
      assert.equal(result.proposed_entity_id, null);
      assert.equal(result.match_type, "none");
    }
  });

  it("keeps unrelated blessing labels unresolved instead of fuzzy-guessing", async () => {
    for (const [query, queryContext] of [
      ["Totally Fake Conflagration", { kind: "weapon_trait", slot: "ranged" }],
      ["Utterly Invented Blessing", { kind: "weapon_trait", slot: "melee" }],
    ]) {
      const result = await resolveQuery(query, queryContext);

      assert.equal(result.resolution_state, "unresolved");
      assert.equal(result.resolved_entity_id, null);
      assert.equal(result.proposed_entity_id, null);
      assert.equal(result.match_type, "none");
    }
  });

  it("resolves source-backed curio perk labels once they are mapped", async () => {
    const cases = JSON.parse(
      readFileSync("tests/fixtures/ground-truth/expected-curio-perk-resolution.json", "utf8"),
    );

    for (const testCase of cases) {
      const result = await resolveQuery(testCase.query, {
        kind: "gadget_trait",
        slot: "curio",
      });

      assert.equal(result.resolution_state, "resolved");
      assert.equal(result.resolved_entity_id, testCase.expected_entity_id);
    }
  });

  it("resolves source-backed weapon perk labels once they are mapped", async () => {
    const cases = JSON.parse(
      readFileSync("tests/fixtures/ground-truth/expected-weapon-perk-resolution.json", "utf8"),
    );

    for (const testCase of cases) {
      const result = await resolveQuery(testCase.query, testCase.query_context);

      assert.equal(result.resolution_state, "resolved");
      assert.equal(result.resolved_entity_id, testCase.expected_entity_id);
    }
  });

  it("resolves source-backed blessing family labels once they are mapped", async () => {
    const cases = JSON.parse(
      readFileSync("tests/fixtures/ground-truth/expected-blessing-family-resolution.json", "utf8"),
    );

    for (const testCase of cases) {
      const result = await resolveQuery(testCase.query, testCase.query_context);

      assert.equal(result.resolution_state, "resolved");
      assert.equal(result.resolved_entity_id, testCase.expected_entity_id);
      assert.deepEqual(result.warnings, [
        "resolved_to_name_family",
        "partially_resolved_entity",
      ]);
    }
  });

  it("resolves source-backed weapon labels once they are mapped", async () => {
    const cases = JSON.parse(
      readFileSync("tests/fixtures/ground-truth/expected-weapon-resolution.json", "utf8"),
    );

    for (const testCase of cases) {
      const result = await resolveQuery(testCase.query, testCase.query_context);

      assert.equal(result.resolution_state, "resolved");
      assert.equal(result.resolved_entity_id, testCase.expected_entity_id);
    }
  });

  it("resolves minimal source-backed veteran class-side labels from the live sample build", async () => {
    for (const [query, queryContext, expectedEntityId] of [
      ["Voice of Command", { kind: "ability", class: "veteran" }, "veteran.ability.veteran_combat_ability_stagger_nearby_enemies"],
      ["Shredder Frag Grenade", { kind: "blitz", class: "veteran" }, "veteran.ability.veteran_grenade_apply_bleed"],
      ["Survivalist", { kind: "aura", class: "veteran" }, "veteran.aura.veteran_aura_gain_ammo_on_elite_kill_improved"],
      ["Focus Target!", { kind: "keystone", class: "veteran" }, "veteran.keystone.veteran_improved_tag"],
      ["Focus Target", { kind: "keystone", class: "veteran" }, "veteran.keystone.veteran_improved_tag"],
    ]) {
      const result = await resolveQuery(query, queryContext);

      assert.equal(result.resolution_state, "resolved");
      assert.equal(result.resolved_entity_id, expectedEntityId);
    }
  });

  it("resolves the first source-backed veteran talent batch from the live sample build", async () => {
    for (const [query, expectedEntityId] of [
      ["Grenade Tinkerer", "veteran.talent.veteran_improved_grenades"],
      ["Born Leader", "veteran.talent.veteran_allies_in_coherency_share_toughness_gain"],
      ["Tactical Awareness", "veteran.talent.veteran_elite_kills_reduce_cooldown"],
      ["Confirmed Kill", "veteran.talent.veteran_elite_kills_replenish_toughness"],
      ["Demolition Stockpile", "veteran.talent.veteran_replenish_grenades"],
      ["Superiority Complex", "veteran.talent.veteran_increase_damage_vs_elites"],
      ["Close Order Drill", "veteran.talent.veteran_reduced_toughness_damage_in_coherency"],
      ["Iron Will", "veteran.talent.veteran_tdr_on_high_toughness"],
    ]) {
      const result = await resolveQuery(query, { kind: "talent", class: "veteran" });

      assert.equal(result.resolution_state, "resolved");
      assert.equal(result.resolved_entity_id, expectedEntityId);
    }
  });

  it("resolves the second source-backed veteran talent batch from the live sample build", async () => {
    for (const [query, expectedEntityId] of [
      ["Exploit Weakness", "veteran.talent.veteran_crits_apply_rending"],
      ["Skirmisher", "veteran.talent.veteran_increase_damage_after_sprinting"],
      ["Desperado", "veteran.talent.veteran_increased_melee_crit_chance_and_melee_finesse"],
      ["Reciprocity", "veteran.talent.veteran_dodging_grants_crit"],
      ["Serrated Blade", "veteran.talent.veteran_hits_cause_bleed"],
      ["Trench Fighter Drill", "veteran.talent.veteran_attack_speed"],
      ["Catch A Breath", "veteran.talent.veteran_replenish_toughness_outside_melee"],
      ["Exhilarating Takedown", "veteran.talent.veteran_replenish_toughness_on_weakspot_kill"],
      ["Duty And Honour", "veteran.talent_modifier.veteran_combat_ability_increase_and_restore_toughness_to_coherency"],
      ["Longshot", "veteran.talent.veteran_increased_damage_based_on_range"],
      ["Precision Strikes", "veteran.talent.veteran_increased_weakspot_damage"],
      ["Bring It Down", "veteran.talent.veteran_big_game_hunter"],
      ["Ranged Fusilade", "veteran.talent.veteran_increased_ranged_cleave"],
      ["Redirect Fire", "veteran.talent_modifier.veteran_improved_tag_dead_coherency_bonus"],
    ]) {
      const result = await resolveQuery(query, { kind: "talent", class: "veteran" });

      assert.equal(result.resolution_state, "resolved");
      assert.equal(result.resolved_entity_id, expectedEntityId);
    }
  });

  it("treats spaced and underscored class context values as equivalent", async () => {
    for (const [query, queryContext, expectedEntityId] of [
      [
        "Street Tough",
        { kind: "talent", class: "hive scum" },
        "hive_scum.talent.broker_passive_knockback_on_taking_melee_damage",
      ],
      [
        "Regained Posture",
        { kind: "talent", class: "hive_scum" },
        "hive_scum.talent.broker_passive_stamina_on_successful_dodge",
      ],
    ]) {
      const result = await resolveQuery(query, queryContext);

      assert.equal(result.resolution_state, "resolved");
      assert.equal(result.resolved_entity_id, expectedEntityId);
    }
  });

  it("resolves live Games Lantern perk label variants", async () => {
    for (const [query, queryContext, expectedEntityId] of [
      [
        "10-25% Damage (Unyielding Enemies)",
        { kind: "weapon_perk", slot: "ranged" },
        "shared.weapon_perk.ranged.weapon_trait_ranged_common_wield_increased_resistant_damage",
      ],
      [
        "+5-20% Damage Resistance (Snipers)",
        { kind: "gadget_trait", slot: "curio" },
        "shared.gadget_trait.gadget_damage_reduction_vs_snipers",
      ],
      [
        "+5-20% Damage Resistance (Gunners)",
        { kind: "gadget_trait", slot: "curio" },
        "shared.gadget_trait.gadget_damage_reduction_vs_gunners",
      ],
    ]) {
      const result = await resolveQuery(query, queryContext);

      assert.equal(result.resolution_state, "resolved");
      assert.equal(result.resolved_entity_id, expectedEntityId);
    }
  });

  it("resolves exact GL perk corpus labels", async () => {
    const result = await resolveQuery("4-10% Ranged Weak Spot Damage", {
      kind: "weapon_perk",
      slot: "ranged",
    });

    assert.equal(result.resolution_state, "resolved");
    assert.equal(
      result.resolved_entity_id,
      "shared.weapon_perk.ranged.weapon_trait_ranged_increase_weakspot_damage",
    );
  });

  it(
    "reports corpus coverage by domain and state",
    { skip: !existsSync("data/ground-truth/generated/gl-alias-corpus.json") || !existsSync("data/ground-truth/generated/gl-alias-review.json") },
    async () => {
      const corpus = JSON.parse(readFileSync("data/ground-truth/generated/gl-alias-corpus.json", "utf8"));
      const review = JSON.parse(readFileSync("data/ground-truth/generated/gl-alias-review.json", "utf8"));

      assert.ok(corpus.length > 0);
      assert.ok(Array.isArray(review.matched));
      assert.ok(Array.isArray(review.required));
      assert.ok(Array.isArray(review.unmatched));
    },
  );

  it("resolves representative BetterBots profile weapon template ids", async () => {
    for (const [query, queryContext, expectedEntityId] of [
      ["chainsword_p1_m1", { kind: "weapon", slot: "melee" }, "shared.weapon.chainsword_p1_m1"],
      ["autogun_p1_m1", { kind: "weapon", slot: "ranged" }, "shared.weapon.autogun_p1_m1"],
      ["forcesword_p1_m1", { kind: "weapon", slot: "melee" }, "shared.weapon.forcesword_p1_m1"],
      ["forcestaff_p1_m1", { kind: "weapon", slot: "ranged" }, "shared.weapon.forcestaff_p1_m1"],
      ["bot_lasgun_killshot", { kind: "weapon", slot: "ranged" }, "shared.weapon.bot_lasgun_killshot"],
      ["high_bot_autogun_killshot", { kind: "weapon", slot: "ranged" }, "shared.weapon.high_bot_autogun_killshot"],
      ["bot_combatsword_linesman_p1", { kind: "weapon", slot: "melee" }, "shared.weapon.bot_combatsword_linesman_p1"],
      ["bot_combataxe_linesman", { kind: "weapon", slot: "melee" }, "shared.weapon.bot_combataxe_linesman"],
    ]) {
      const result = await resolveQuery(query, queryContext);

      assert.equal(result.resolution_state, "resolved");
      assert.equal(result.resolved_entity_id, expectedEntityId);
    }
  });

  it("resolves BetterBots full content item paths via template basename", async () => {
    for (const [query, queryContext, expectedEntityId] of [
      [
        "content/items/weapons/player/melee/chainsword_p1_m1",
        { kind: "weapon", slot: "melee" },
        "shared.weapon.chainsword_p1_m1",
      ],
      [
        "content/items/weapons/player/ranged/bot_lasgun_killshot",
        { kind: "weapon", slot: "ranged" },
        "shared.weapon.bot_lasgun_killshot",
      ],
      [
        "content/items/weapons/player/ranged/high_bot_autogun_killshot",
        { kind: "weapon", slot: "ranged" },
        "shared.weapon.high_bot_autogun_killshot",
      ],
    ]) {
      const result = await resolveQuery(query, queryContext);

      assert.equal(result.resolution_state, "resolved");
      assert.equal(result.resolved_entity_id, expectedEntityId);
    }
  });
});

describe("auditBuildFile", () => {
  for (const fixtureName of [
    "09-psyker-2026",
    "13-ogryn-bonktide",
    "17-arbites-busted",
  ]) {
    it(`matches the frozen ${fixtureName} audit snapshot`, async () => {
      const result = await auditBuildFile(`data/builds/${fixtureName}.json`);
      const expected = JSON.parse(
        readFileSync(`tests/fixtures/ground-truth/audits/${fixtureName}.audit.json`, "utf8"),
      );
      assert.deepEqual(result, expected);
    });
  }

  it(
    "audits canonical build class-side selections and persisted ids",
    { skip: PINNED_SOURCE_ROOT == null },
    async () => {
      const canonicalBuildPath = writeTempCanonicalBuild({
        schema_version: 1,
        title: "Canonical Psyker Fixture",
        class: makeCanonicalSelection("psyker", "shared.class.psyker"),
        provenance: {
          source_kind: "gameslantern",
          source_url: "https://darktide.gameslantern.com/builds/example",
          author: "tester",
          scraped_at: "2026-03-13T12:00:00Z",
        },
        ability: makeCanonicalSelection("Venting Shriek", "psyker.ability.psyker_shout_vent_warp_charge"),
        blitz: makeCanonicalSelection("Brain Rupture", "psyker.ability.psyker_brain_burst_improved"),
        aura: makeCanonicalSelection("Nonexistent Aura Name", null, "unresolved"),
        keystone: makeCanonicalSelection("Warp Siphon", null, "unresolved"),
        talents: [
          makeCanonicalSelection("Warp Rider", null, "unresolved"),
        ],
        weapons: [
          {
            slot: "melee",
            name: makeCanonicalSelection("Covenant Mk VI Blaze Force Greatsword", "shared.weapon.forcesword_2h_p1_m1"),
            perks: [
              {
                ...makeCanonicalSelection(
                  "20-25% Damage (Carapace)",
                  "shared.weapon_perk.melee.weapon_trait_melee_common_wield_increased_carapace_damage",
                ),
                value: { min: 0.2, max: 0.25, unit: "percent" },
              },
            ],
            blessings: [
              makeCanonicalSelection("Blazing Spirit", "shared.name_family.blessing.blazing_spirit"),
            ],
          },
          {
            slot: "ranged",
            name: makeCanonicalSelection("Equinox Mk III Voidblast Force Staff", "shared.weapon.forcestaff_p4_m1"),
            perks: [],
            blessings: [],
          },
        ],
        curios: [
          {
            name: makeCanonicalSelection("Blessed Bullet", null, "non_canonical"),
            perks: [
              {
                ...makeCanonicalSelection("+4-5% Toughness", "shared.gadget_trait.gadget_toughness_increase"),
                value: { min: 0.04, max: 0.05, unit: "percent" },
              },
            ],
          },
        ],
      });

      const result = await auditBuildFile(canonicalBuildPath);

      assert.equal(
        result.resolved.some((entry) => entry.field === "ability" && entry.resolved_entity_id === "psyker.ability.psyker_shout_vent_warp_charge"),
        true,
      );
      assert.equal(
        result.resolved.some((entry) => entry.field === "blitz" && entry.resolved_entity_id === "psyker.ability.psyker_brain_burst_improved"),
        true,
      );
      assert.equal(
        result.resolved.some((entry) => entry.field === "talents[0]" && entry.resolved_entity_id === "psyker.talent.psyker_damage_based_on_warp_charge"),
        true,
      );
      assert.equal(
        result.unresolved.some((entry) => entry.field === "aura"),
        true,
      );
      assert.equal(
        result.non_canonical.some((entry) => entry.field === "curios[0].name" && entry.text === "Blessed Bullet"),
        true,
      );
    },
  );

  it(
    "reports stale canonical ids in canonical builds",
    { skip: PINNED_SOURCE_ROOT == null },
    async () => {
      const canonicalBuildPath = writeTempCanonicalBuild({
        schema_version: 1,
        title: "Broken Canonical Psyker Fixture",
        class: makeCanonicalSelection("psyker", "shared.class.psyker"),
        provenance: {
          source_kind: "gameslantern",
          source_url: "https://darktide.gameslantern.com/builds/example",
          author: "tester",
          scraped_at: "2026-03-13T12:00:00Z",
        },
        ability: makeCanonicalSelection("Venting Shriek", "psyker.ability.definitely_missing"),
        blitz: makeCanonicalSelection("Brain Rupture", null, "unresolved"),
        aura: makeCanonicalSelection("Psykinetic's Aura", null, "unresolved"),
        keystone: null,
        talents: [],
        weapons: [
          {
            slot: "melee",
            name: makeCanonicalSelection("Covenant Mk VI Blaze Force Greatsword", "shared.weapon.forcesword_2h_p1_m1"),
            perks: [],
            blessings: [],
          },
          {
            slot: "ranged",
            name: makeCanonicalSelection("Equinox Mk III Voidblast Force Staff", "shared.weapon.forcestaff_p4_m1"),
            perks: [],
            blessings: [],
          },
        ],
        curios: [],
      });

      const result = await auditBuildFile(canonicalBuildPath);

      assert.equal(
        result.unresolved.some(
          (entry) => entry.field === "ability" && entry.warnings.includes("stale_canonical_id"),
        ),
        true,
      );
    },
  );

  it("audits the structured class field", async () => {
    const result = await auditBuildFile("data/builds/09-psyker-2026.json");
    assert.equal(
      result.resolved.some(
        (entry) =>
          entry.field === "class" &&
          entry.resolved_entity_id === "shared.class.psyker",
      ),
      true,
    );
  });

  it("classifies structurally ambiguous curio base labels as non_canonical", async () => {
    const result = await auditBuildFile("data/builds/09-psyker-2026.json");
    for (const field of ["curios[0].name", "curios[1].name", "curios[2].name"]) {
      assert.equal(
        result.non_canonical.some(
          (entry) => entry.field === field && entry.text === "Blessed Bullet",
        ),
        true,
        `${field} should be non_canonical because the scrape drops the concrete curio variant suffix`,
      );
    }
  });

  it("resolves blessing labels to family-level entities", async () => {
    const veteranResult = await auditBuildFile("data/builds/01-veteran-havoc40-2026.json");
    const hiveScumResult = await auditBuildFile("data/builds/23-hivescum-melee.json");

    for (const [result, field, entityId] of [
      [veteranResult, "weapons[1].blessings[0].name", "shared.name_family.blessing.rising_heat"],
      [veteranResult, "weapons[1].blessings[1].name", "shared.name_family.blessing.gets_hot"],
      [hiveScumResult, "weapons[0].blessings[0].name", "shared.name_family.blessing.riposte"],
      [hiveScumResult, "weapons[0].blessings[1].name", "shared.name_family.blessing.uncanny_strike"],
    ]) {
      assert.equal(
        result.resolved.some(
          (entry) => entry.field === field && entry.resolved_entity_id === entityId,
        ),
        true,
        `${field} should resolve to ${entityId}`,
      );
    }
  });

  it("resolves previously unresolved weapon labels", async () => {
    const veteranSniperResult = await auditBuildFile("data/builds/03-veteran-sharpshooter-2026.json");
    const zealotHammerResult = await auditBuildFile("data/builds/07-zealot-hammer-flamer.json");
    const ogrynMeleeResult = await auditBuildFile("data/builds/14-ogryn-melee-meta.json");

    for (const [result, field, entityId] of [
      [veteranSniperResult, "weapons[0].name", "shared.weapon.combatsword_p1_m3"],
      [veteranSniperResult, "weapons[1].name", "shared.weapon.lasgun_p1_m3"],
      [zealotHammerResult, "weapons[0].name", "shared.weapon.thunderhammer_2h_p1_m1"],
      [zealotHammerResult, "weapons[1].name", "shared.weapon.flamer_p1_m1"],
      [ogrynMeleeResult, "weapons[0].name", "shared.weapon.ogryn_club_p2_m3"],
      [ogrynMeleeResult, "weapons[1].name", "shared.weapon.ogryn_thumper_p1_m2"],
    ]) {
      assert.equal(
        result.resolved.some(
          (entry) => entry.field === field && entry.resolved_entity_id === entityId,
        ),
        true,
        `${field} should resolve to ${entityId}`,
      );
    }
  });

  it("audits structured class fields across all build fixtures", async () => {
    const cases = JSON.parse(
      readFileSync("tests/fixtures/ground-truth/expected-class-resolution.json", "utf8"),
    );
    const expectedByClass = new Map(
      cases.map((testCase) => [testCase.query, testCase.expected_entity_id]),
    );

    const buildFiles = readdirSync("data/builds")
      .filter((f) => f.endsWith(".json"))
      .sort();

    for (const file of buildFiles) {
      const buildPath = `data/builds/${file}`;
      const build = JSON.parse(readFileSync(buildPath, "utf8"));
      const result = await auditBuildFile(buildPath);

      assert.equal(
        result.ambiguous.length,
        0,
        `unexpected ambiguous entries in ${buildPath}`,
      );
      // Audit may resolve some entries the build file has as unresolved
      // (e.g. perk-like labels in blessing slots that match weapon perk entities).
      // Assert: audit unresolved is a subset of build-file unresolved, and no
      // new unresolved fields appear that the build file didn't already have.
      const actualUnresolved = result.unresolved.map((entry) => entry.field).sort();
      const expectedUnresolved = expectedPersistedUnresolvedFields(build);
      const unexpected = actualUnresolved.filter((f) => !expectedUnresolved.includes(f));
      assert.deepEqual(
        unexpected,
        [],
        `unexpected new unresolved entries in ${buildPath}: ${unexpected.join(", ")}`,
      );
      assert.equal(
        result.resolved.some(
          (entry) =>
            entry.field === "class" &&
            entry.resolved_entity_id === expectedByClass.get(
              build?.schema_version === 1 ? build.class.raw_label : build.class,
            ),
        ),
        true,
        `class field did not resolve for ${buildPath}`,
      );
    }
  });

  it("resolves newly covered weapon labels in representative build audits", async () => {
    const veteranResult = await auditBuildFile("data/builds/01-veteran-havoc40-2026.json");
    const explodegrynResult = await auditBuildFile("data/builds/13-ogryn-bonktide.json");
    const zealotDeathCultistResult = await auditBuildFile("data/builds/06-zealot-death-cultist.json");
    const ogrynTankResult = await auditBuildFile("data/builds/15-ogryn-shield-tank.json");
    const arbitesResult = await auditBuildFile("data/builds/17-arbites-busted.json");
    const arbitesShotgunResult = await auditBuildFile("data/builds/18-arbites-hyper-carry-dog.json");
    const zealotMetaResult = await auditBuildFile("data/builds/05-zealot-meta-havoc40.json");
    const zealotChorusResult = await auditBuildFile("data/builds/08-zealot-chorus-swiss-knife.json");
    const hiveScumResult = await auditBuildFile("data/builds/21-hivescum-scumlinger.json");
    const rampageResult = await auditBuildFile("data/builds/22-hivescum-rampage.json");
    const meleeResult = await auditBuildFile("data/builds/23-hivescum-melee.json");
    const stimmtecResult = await auditBuildFile("data/builds/24-hivescum-stim-melee.json");

    for (const [result, field, expectedEntityId] of [
      [veteranResult, "weapons[0].name", "shared.weapon.powersword_p1_m2"],
      [veteranResult, "weapons[1].name", "shared.weapon.plasmagun_p1_m1"],
      [explodegrynResult, "weapons[0].name", "shared.weapon.ogryn_pickaxe_2h_p1_m1"],
      [explodegrynResult, "weapons[1].name", "shared.weapon.ogryn_heavystubber_p2_m3"],
      [arbitesShotgunResult, "weapons[0].name", "shared.weapon.powermaul_p2_m1"],
      [arbitesShotgunResult, "weapons[1].name", "shared.weapon.shotgun_p4_m1"],
      [zealotDeathCultistResult, "weapons[0].name", "shared.weapon.powersword_2h_p1_m2"],
      [zealotChorusResult, "weapons[1].name", "shared.weapon.flamer_p1_m1"],
      [ogrynTankResult, "weapons[0].name", "shared.weapon.ogryn_powermaul_slabshield_p1_m1"],
      [zealotMetaResult, "weapons[1].name", "shared.weapon.flamer_p1_m1"],
      [hiveScumResult, "weapons[0].name", "shared.weapon.combatknife_p1_m1"],
      [meleeResult, "weapons[0].name", "shared.weapon.dual_shivs_p1_m1"],
      [stimmtecResult, "weapons[0].name", "shared.weapon.combatsword_p1_m3"],
    ]) {
      assert.equal(
        result.resolved.some(
          (entry) =>
            entry.field === field && entry.resolved_entity_id === expectedEntityId,
        ),
        true,
        `${field} should resolve to ${expectedEntityId}`,
      );
    }
  });

  it("does not surface bogus fuzzy blessing matches in non-Psyker build audits", async () => {
    const result = await auditBuildFile("data/builds/17-arbites-busted.json");

    assert.equal(
      result.resolved.some(
        (entry) =>
          entry.field === "weapons[0].blessings[1].name" &&
          entry.resolved_entity_id === "shared.name_family.blessing.high_voltage",
      ),
      true,
      "weapons[0].blessings[1].name should resolve to high_voltage",
    );
    assert.equal(
      result.ambiguous.some((entry) => entry.field === "weapons[0].blessings[1].name"),
      false,
      "weapons[0].blessings[1].name should not be ambiguous",
    );

    assert.equal(
      result.resolved.some(
        (entry) =>
          entry.field === "weapons[1].blessings[1].name" &&
          entry.resolved_entity_id === "shared.name_family.blessing.execution",
      ),
      true,
      "weapons[1].blessings[1].name should resolve to execution",
    );
    assert.equal(
      result.ambiguous.some((entry) => entry.field === "weapons[1].blessings[1].name"),
      false,
      "weapons[1].blessings[1].name should not be ambiguous",
    );
  });

  it("resolves newly covered curio perks in non-Psyker build audits", async () => {
    const arbitesResult = await auditBuildFile("data/builds/17-arbites-busted.json");
    const rampageResult = await auditBuildFile("data/builds/22-hivescum-rampage.json");

    for (const [result, field, expectedEntityId] of [
      [arbitesResult, "curios[0].perks[0]", "shared.gadget_trait.gadget_toughness_increase"],
      [arbitesResult, "curios[1].perks[0]", "shared.gadget_trait.gadget_toughness_increase"],
      [rampageResult, "curios[0].perks[0]", "shared.gadget_trait.gadget_health_increase"],
    ]) {
      assert.equal(
        result.resolved.some(
          (entry) =>
            entry.field === field && entry.resolved_entity_id === expectedEntityId,
        ),
        true,
        `${field} should resolve to ${expectedEntityId}`,
      );
    }
  });

  it("resolves newly covered weapon perks in representative build audits", async () => {
    const veteranResult = await auditBuildFile("data/builds/01-veteran-havoc40-2026.json");
    const zealotResult = await auditBuildFile("data/builds/05-zealot-meta-havoc40.json");
    const hiveScumResult = await auditBuildFile("data/builds/24-hivescum-stim-melee.json");

    for (const [result, field, expectedEntityId] of [
      [
        veteranResult,
        "weapons[0].perks[1]",
        "shared.weapon_perk.melee.weapon_trait_melee_common_wield_increased_resistant_damage",
      ],
      [
        veteranResult,
        "weapons[1].perks[0]",
        "shared.weapon_perk.ranged.weapon_trait_ranged_common_wield_increased_armored_damage",
      ],
      [
        zealotResult,
        "weapons[1].perks[1]",
        "shared.weapon_perk.ranged.weapon_trait_ranged_common_wield_increased_armored_damage",
      ],
      [
        hiveScumResult,
        "weapons[1].perks[0]",
        "shared.weapon_perk.ranged.weapon_trait_ranged_common_wield_increased_resistant_damage",
      ],
    ]) {
      assert.equal(
        result.resolved.some(
          (entry) =>
            entry.field === field && entry.resolved_entity_id === expectedEntityId,
        ),
        true,
        `${field} should resolve to ${expectedEntityId}`,
      );
    }
  });

  it("resolves newly covered blessing families in representative build audits", async () => {
    const veteranResult = await auditBuildFile("data/builds/01-veteran-havoc40-2026.json");
    const zealotResult = await auditBuildFile("data/builds/05-zealot-meta-havoc40.json");
    const zealotHammerResult = await auditBuildFile("data/builds/07-zealot-hammer-flamer.json");
    const zealotChorusResult = await auditBuildFile("data/builds/08-zealot-chorus-swiss-knife.json");
    const ogrynResult = await auditBuildFile("data/builds/14-ogryn-melee-meta.json");
    const bonktideResult = await auditBuildFile("data/builds/13-ogryn-bonktide.json");
    const arbitesResult = await auditBuildFile("data/builds/17-arbites-busted.json");
    const arbitesCarryResult = await auditBuildFile("data/builds/18-arbites-hyper-carry-dog.json");
    const arbitesMetaResult = await auditBuildFile("data/builds/19-arbites-arbitrator-meta.json");
    const hiveScumResult = await auditBuildFile("data/builds/21-hivescum-scumlinger.json");
    const rampageResult = await auditBuildFile("data/builds/22-hivescum-rampage.json");
    const stimmtecResult = await auditBuildFile("data/builds/24-hivescum-stim-melee.json");

    for (const [result, field, expectedEntityId] of [
      [
        zealotResult,
        "weapons[1].blessings[0].name",
        "shared.name_family.blessing.blaze_away",
      ],
      [
        zealotResult,
        "weapons[1].blessings[1].name",
        "shared.name_family.blessing.penetrating_flame",
      ],
      [
        veteranResult,
        "weapons[1].blessings[0].name",
        "shared.name_family.blessing.rising_heat",
      ],
      [
        veteranResult,
        "weapons[1].blessings[1].name",
        "shared.name_family.blessing.gets_hot",
      ],
      [
        zealotHammerResult,
        "weapons[1].blessings[1].name",
        "shared.name_family.blessing.penetrating_flame",
      ],
      [
        zealotChorusResult,
        "weapons[1].blessings[0].name",
        "shared.name_family.blessing.blaze_away",
      ],
      [
        ogrynResult,
        "weapons[0].blessings[0].name",
        "shared.name_family.blessing.skullcrusher",
      ],
      [
        ogrynResult,
        "weapons[0].blessings[1].name",
        "shared.name_family.blessing.thunderous",
      ],
      [
        ogrynResult,
        "weapons[1].blessings[0].name",
        "shared.name_family.blessing.adhesive_charge",
      ],
      [
        ogrynResult,
        "weapons[1].blessings[1].name",
        "shared.name_family.blessing.shattering_impact",
      ],
      [
        bonktideResult,
        "weapons[1].blessings[1].name",
        "shared.name_family.blessing.surgical",
      ],
      [
        arbitesResult,
        "weapons[0].blessings[0].name",
        "shared.name_family.blessing.execution",
      ],
      [
        arbitesResult,
        "weapons[1].blessings[0].name",
        "shared.name_family.blessing.deathspitter",
      ],
      [
        arbitesResult,
        "weapons[1].blessings[1].name",
        "shared.name_family.blessing.execution",
      ],
      [
        arbitesCarryResult,
        "weapons[0].blessings[0].name",
        "shared.name_family.blessing.relentless_strikes",
      ],
      [
        arbitesCarryResult,
        "weapons[1].blessings[0].name",
        "shared.name_family.blessing.deathspitter",
      ],
      [
        arbitesMetaResult,
        "weapons[0].blessings[0].name",
        "shared.name_family.blessing.high_voltage",
      ],
      [
        arbitesMetaResult,
        "weapons[1].blessings[0].name",
        "shared.name_family.blessing.run_n_gun",
      ],
      [
        arbitesMetaResult,
        "weapons[1].blessings[1].name",
        "shared.name_family.blessing.puncture",
      ],
      [
        hiveScumResult,
        "weapons[0].blessings[0].name",
        "shared.name_family.blessing.uncanny_strike",
      ],
      [
        hiveScumResult,
        "weapons[0].blessings[1].name",
        "shared.name_family.blessing.precognition",
      ],
      [
        hiveScumResult,
        "weapons[1].blessings[0].name",
        "shared.name_family.blessing.fire_frenzy",
      ],
      [
        rampageResult,
        "weapons[1].blessings[1].name",
        "shared.name_family.blessing.run_n_gun",
      ],
      [
        stimmtecResult,
        "weapons[1].blessings[0].name",
        "shared.name_family.blessing.run_n_gun",
      ],
      [
        stimmtecResult,
        "weapons[1].blessings[1].name",
        "shared.name_family.blessing.stripped_down",
      ],
    ]) {
      assert.equal(
        result.resolved.some(
          (entry) =>
            entry.field === field && entry.resolved_entity_id === expectedEntityId,
        ),
        true,
        `${field} should resolve to ${expectedEntityId}`,
      );
    }
  });
});
