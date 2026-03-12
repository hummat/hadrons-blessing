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
import { resolveQuery } from "./ground-truth/lib/resolve.mjs";
import { auditBuildFile } from "./audit-build-names.mjs";

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

  it("includes evidence records for known bad-case mappings", async () => {
    const index = await buildIndex({ check: false });
    const evidenceIds = new Set(index.evidence.map((evidence) => evidence.id));

    for (const id of [
      "psyker.evidence.entity.psyker_damage_based_on_warp_charge",
      "psyker.evidence.entity.psyker_brain_burst_improved",
      "psyker.evidence.entity.psyker_aura_crit_chance_aura",
      "psyker.evidence.entity.psyker_damage_to_peril_conversion",
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
      assert.equal(result.candidate_trace.length > 0, true);
      assert.equal(result.refs.length > 0, true);
      assert.equal(typeof result.candidate_trace[0].entity_id, "string");
      assert.equal(typeof result.candidate_trace[0].score, "number");
      assert.equal(typeof result.candidate_trace[0].context_match_explanation, "string");
      assert.equal(typeof result.refs[0].path, "string");
      assert.equal(typeof result.refs[0].line, "number");
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
    const result = await resolveQuery("M1000 Completely Fake Lasgun", {
      kind: "weapon",
      slot: "ranged",
    });

    assert.equal(result.resolution_state, "unresolved");
    assert.equal(result.resolved_entity_id, null);
    assert.equal(result.proposed_entity_id, null);
    assert.equal(result.match_type, "none");
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
      ["Confident Strike", { kind: "weapon_trait", slot: "melee" }],
      ["Fire Frenzy", { kind: "weapon_trait", slot: "ranged" }],
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
});

describe("auditBuildFile", () => {
  for (const fixtureName of [
    "08-gandalf-melee-wizard",
    "09-electrodominance-psyker",
    "10-electro-shriek-psyker",
  ]) {
    it(`matches the frozen ${fixtureName} audit snapshot`, async () => {
      const result = await auditBuildFile(`scripts/builds/${fixtureName}.json`);
      const expected = JSON.parse(
        readFileSync(`tests/fixtures/ground-truth/audits/${fixtureName}.audit.json`, "utf8"),
      );
      assert.deepEqual(result, expected);
    });
  }

  it("audits the structured class field", async () => {
    const result = await auditBuildFile("scripts/builds/08-gandalf-melee-wizard.json");
    assert.equal(
      result.resolved.some(
        (entry) =>
          entry.field === "class" &&
          entry.resolved_entity_id === "shared.class.psyker",
      ),
      true,
    );
  });

  it("keeps unsupported curio item labels explicit", async () => {
    const result = await auditBuildFile("scripts/builds/08-gandalf-melee-wizard.json");
    assert.equal(
      result.non_canonical.some(
        (entry) =>
          entry.field === "curios[0].name" &&
          entry.text === "Blessed Bullet" &&
          entry.non_canonical_kind === "display_label",
      ),
      true,
    );
  });

  it("classifies known unsupported curio item labels into a non-canonical bucket", async () => {
    const psykerResult = await auditBuildFile("scripts/builds/08-gandalf-melee-wizard.json");
    const arbitesResult = await auditBuildFile("scripts/builds/14-arbites-nuncio-aquila.json");

    for (const [result, field, text] of [
      [psykerResult, "curios[0].name", "Blessed Bullet"],
      [psykerResult, "curios[1].name", "Blessed Bullet"],
      [psykerResult, "curios[2].name", "Blessed Bullet"],
      [arbitesResult, "curios[0].name", "Gilded Inquisitorial Rosette"],
      [arbitesResult, "curios[1].name", "Gilded Inquisitorial Rosette"],
      [arbitesResult, "curios[2].name", "Scrap of Scripture"],
    ]) {
      assert.equal(
        result.non_canonical.some(
          (entry) =>
            entry.field === field &&
            entry.text === text &&
            entry.non_canonical_kind === "display_label",
        ),
        true,
        `${field} should be classified as a known non-canonical label`,
      );
      assert.equal(
        result.unresolved.some((entry) => entry.field === field),
        false,
        `${field} should not remain unresolved once classified`,
      );
    }
  });

  it("classifies repeated unresolved blessing labels into the non-canonical bucket", async () => {
    const veteranResult = await auditBuildFile("scripts/builds/01-veteran-squad-leader.json");
    const explodegrynResult = await auditBuildFile("scripts/builds/11-explodegryn.json");
    const arbitesResult = await auditBuildFile("scripts/builds/16-arbites-busted.json");
    const hiveScumResult = await auditBuildFile("scripts/builds/18-reginald-melee.json");

    for (const [result, field, text] of [
      [veteranResult, "weapons[0].blessings[0].name", "Cranial Grounding"],
      [veteranResult, "weapons[0].blessings[1].name", "Heatsink"],
      [explodegrynResult, "weapons[1].blessings[1].name", "Adhesive Charge"],
      [arbitesResult, "weapons[0].blessings[0].name", "Execution"],
      [arbitesResult, "weapons[1].blessings[0].name", "Deathspitter"],
      [arbitesResult, "weapons[1].blessings[1].name", "Execution"],
      [hiveScumResult, "weapons[0].blessings[0].name", "Decimator"],
      [hiveScumResult, "weapons[0].blessings[1].name", "Shock & Awe"],
    ]) {
      assert.equal(
        result.non_canonical.some(
          (entry) =>
            entry.field === field &&
            entry.text === text &&
            entry.non_canonical_kind === "known_unresolved",
        ),
        true,
        `${field} should be classified as a repeated known-unresolved blessing label`,
      );
      assert.equal(
        result.unresolved.some((entry) => entry.field === field),
        false,
        `${field} should not remain unresolved once classified`,
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

    for (let index = 1; index <= 20; index += 1) {
      const buildPath = `scripts/builds/${String(index).padStart(2, "0")}-${[
        "veteran-squad-leader",
        "assault-veteran",
        "slinking-veteran",
        "spicy-meta-zealot",
        "fatmangus-zealot-stealth",
        "holy-gains-zealot",
        "zealot-infodump",
        "gandalf-melee-wizard",
        "electrodominance-psyker",
        "electro-shriek-psyker",
        "explodegryn",
        "ogryn-shield-tank",
        "shovel-ogryn",
        "arbites-nuncio-aquila",
        "arbites-melee-meta",
        "arbites-busted",
        "crackhead-john-wick",
        "reginald-melee",
        "the-chemist",
        "stimmtec-blender",
      ][index - 1]}.json`;
      const build = JSON.parse(readFileSync(buildPath, "utf8"));
      const result = await auditBuildFile(buildPath);

      assert.equal(
        result.resolved.some(
          (entry) =>
            entry.field === "class" &&
            entry.resolved_entity_id === expectedByClass.get(build.class),
        ),
        true,
        `class field did not resolve for ${buildPath}`,
      );
    }
  });

  it("resolves newly covered weapon labels in representative build audits", async () => {
    const veteranResult = await auditBuildFile("scripts/builds/01-veteran-squad-leader.json");
    const explodegrynResult = await auditBuildFile("scripts/builds/11-explodegryn.json");
    const arbitesResult = await auditBuildFile("scripts/builds/14-arbites-nuncio-aquila.json");
    const arbitesShotgunResult = await auditBuildFile("scripts/builds/15-arbites-melee-meta.json");
    const zealotMetaResult = await auditBuildFile("scripts/builds/04-spicy-meta-zealot.json");
    const hiveScumResult = await auditBuildFile("scripts/builds/17-crackhead-john-wick.json");
    const chemistResult = await auditBuildFile("scripts/builds/19-the-chemist.json");
    const surgeonResult = await auditBuildFile("scripts/builds/18-reginald-melee.json");
    const stimmtecResult = await auditBuildFile("scripts/builds/20-stimmtec-blender.json");

    for (const [result, field, expectedEntityId] of [
      [veteranResult, "weapons[0].name", "shared.weapon.powersword_p2_m1"],
      [veteranResult, "weapons[1].name", "shared.weapon.plasmagun_p1_m1"],
      [explodegrynResult, "weapons[1].name", "shared.weapon.ogryn_thumper_p1_m1"],
      [arbitesResult, "weapons[0].name", "shared.weapon.powermaul_p2_m1"],
      [arbitesResult, "weapons[1].name", "shared.weapon.shotpistol_shield_p1_m1"],
      [arbitesShotgunResult, "weapons[1].name", "shared.weapon.shotgun_p4_m1"],
      [zealotMetaResult, "weapons[1].name", "shared.weapon.flamer_p1_m1"],
      [hiveScumResult, "weapons[0].name", "shared.weapon.dual_shivs_p1_m1"],
      [hiveScumResult, "weapons[1].name", "shared.weapon.dual_stubpistols_p1_m1"],
      [chemistResult, "weapons[1].name", "shared.weapon.needlepistol_p1_m1"],
      [surgeonResult, "weapons[0].name", "shared.weapon.saw_p1_m1"],
      [stimmtecResult, "weapons[0].name", "shared.weapon.dual_shivs_p1_m1"],
      [stimmtecResult, "weapons[1].name", "shared.weapon.needlepistol_p1_m1"],
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
    const result = await auditBuildFile("scripts/builds/14-arbites-nuncio-aquila.json");

    for (const field of [
      "weapons[0].blessings[1].name",
      "weapons[1].blessings[1].name",
    ]) {
      assert.equal(
        result.unresolved.some((entry) => entry.field === field),
        true,
        `${field} should stay unresolved`,
      );
      assert.equal(
        result.resolved.some((entry) => entry.field === field),
        false,
        `${field} should not resolve`,
      );
      assert.equal(
        result.ambiguous.some((entry) => entry.field === field),
        false,
        `${field} should not be ambiguous`,
      );
    }
  });

  it("resolves newly covered curio perks in non-Psyker build audits", async () => {
    const arbitesResult = await auditBuildFile("scripts/builds/14-arbites-nuncio-aquila.json");
    const hiveScumResult = await auditBuildFile("scripts/builds/17-crackhead-john-wick.json");

    for (const [result, field, expectedEntityId] of [
      [arbitesResult, "curios[0].perks[0]", "shared.gadget_trait.gadget_toughness_increase"],
      [arbitesResult, "curios[1].perks[0]", "shared.gadget_trait.gadget_health_increase"],
      [hiveScumResult, "curios[0].perks[0]", "shared.gadget_trait.gadget_health_increase"],
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
    const veteranResult = await auditBuildFile("scripts/builds/01-veteran-squad-leader.json");
    const zealotResult = await auditBuildFile("scripts/builds/04-spicy-meta-zealot.json");
    const hiveScumResult = await auditBuildFile("scripts/builds/20-stimmtec-blender.json");

    for (const [result, field, expectedEntityId] of [
      [
        veteranResult,
        "weapons[0].perks[1]",
        "shared.weapon_perk.melee.weapon_trait_melee_common_wield_increased_berserker_damage",
      ],
      [
        veteranResult,
        "weapons[1].perks[0]",
        "shared.weapon_perk.ranged.weapon_trait_ranged_common_wield_increased_berserker_damage",
      ],
      [
        zealotResult,
        "weapons[0].perks[1]",
        "shared.weapon_perk.melee.weapon_trait_increase_damage_elites",
      ],
      [
        hiveScumResult,
        "weapons[1].perks[0]",
        "shared.weapon_perk.ranged.weapon_trait_ranged_increased_reload_speed",
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
    const veteranResult = await auditBuildFile("scripts/builds/01-veteran-squad-leader.json");
    const zealotResult = await auditBuildFile("scripts/builds/04-spicy-meta-zealot.json");
    const zealotBoltgunResult = await auditBuildFile("scripts/builds/05-fatmangus-zealot-stealth.json");
    const zealotBoltpistolResult = await auditBuildFile("scripts/builds/06-holy-gains-zealot.json");
    const ogrynResult = await auditBuildFile("scripts/builds/13-shovel-ogryn.json");
    const arbitesResult = await auditBuildFile("scripts/builds/14-arbites-nuncio-aquila.json");
    const hiveScumResult = await auditBuildFile("scripts/builds/17-crackhead-john-wick.json");
    const chemistResult = await auditBuildFile("scripts/builds/19-the-chemist.json");
    const stimmtecResult = await auditBuildFile("scripts/builds/20-stimmtec-blender.json");

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
        zealotBoltgunResult,
        "weapons[1].blessings[0].name",
        "shared.name_family.blessing.pinning_fire",
      ],
      [
        zealotBoltgunResult,
        "weapons[1].blessings[1].name",
        "shared.name_family.blessing.puncture",
      ],
      [
        zealotBoltpistolResult,
        "weapons[1].blessings[0].name",
        "shared.name_family.blessing.lethal_proximity",
      ],
      [
        zealotBoltpistolResult,
        "weapons[1].blessings[1].name",
        "shared.name_family.blessing.puncture",
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
        "shared.name_family.blessing.inspiring_barrage",
      ],
      [
        arbitesResult,
        "weapons[0].blessings[0].name",
        "shared.name_family.blessing.high_voltage",
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
        "shared.name_family.blessing.run_n_gun",
      ],
      [
        hiveScumResult,
        "weapons[1].blessings[1].name",
        "shared.name_family.blessing.speedload",
      ],
      [
        chemistResult,
        "weapons[1].blessings[1].name",
        "shared.name_family.blessing.stripped_down",
      ],
      [
        stimmtecResult,
        "weapons[1].blessings[0].name",
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
