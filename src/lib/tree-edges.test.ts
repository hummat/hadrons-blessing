import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLuaTree } from "./lua-tree-parser.js";
import {
  TREE_TYPE_TO_KIND,
  generateTreeEdges,
  generateTreeNodeEntities,
} from "./tree-edge-generator.js";
import { REPO_ROOT, resolveSourceRoot } from "./load.js";

const SOURCE_ROOT = resolveSourceRoot();

// -- Inline test fixtures --------------------------------------------------

const SAMPLE_LUA = `
-- chunkname: @scripts/ui/views/talent_builder_view/layouts/test_tree.lua

return {
\tarchetype_name = "test_class",
\tnodes = {
\t\t{
\t\t\tcost = 0,
\t\t\ticon = "content/ui/materials/frames/talents/starting_points/starting_point",
\t\t\tmax_points = 1,
\t\t\ttalent = "not_selected",
\t\t\ttype = "start",
\t\t\twidget_name = "node_aaaa-1111",
\t\t\tx = 100,
\t\t\ty = 200,
\t\t\tchildren = {
\t\t\t\t"node_bbbb-2222",
\t\t\t\t"node_cccc-3333",
\t\t\t},
\t\t\tparents = {},
\t\t\trequirements = {
\t\t\t\tall_parents_chosen = false,
\t\t\t\tchildren_unlock_points = 0,
\t\t\t\tmin_points_spent = 0,
\t\t\t},
\t\t},
\t\t{
\t\t\tcost = 1,
\t\t\tgroup_name = "test_group_1",
\t\t\ticon = "content/ui/textures/icons/talents/test/talent_a",
\t\t\tmax_points = 1,
\t\t\ttalent = "test_talent_alpha",
\t\t\ttype = "default",
\t\t\twidget_name = "node_bbbb-2222",
\t\t\tx = 80,
\t\t\ty = 300,
\t\t\tchildren = {},
\t\t\tparents = {
\t\t\t\t"node_aaaa-1111",
\t\t\t},
\t\t\trequirements = {
\t\t\t\tall_parents_chosen = false,
\t\t\t\tchildren_unlock_points = 1,
\t\t\t\tmin_points_spent = 0,
\t\t\t},
\t\t},
\t\t{
\t\t\tcost = 1,
\t\t\tgroup_name = "test_group_1",
\t\t\ticon = "content/ui/textures/icons/talents/test/talent_b",
\t\t\tmax_points = 1,
\t\t\ttalent = "test_talent_beta",
\t\t\ttype = "default",
\t\t\twidget_name = "node_cccc-3333",
\t\t\tx = 120,
\t\t\ty = 300,
\t\t\tchildren = {},
\t\t\tparents = {
\t\t\t\t"node_aaaa-1111",
\t\t\t},
\t\t\trequirements = {
\t\t\t\tall_parents_chosen = false,
\t\t\t\tchildren_unlock_points = 1,
\t\t\t\tmin_points_spent = 0,
\t\t\t},
\t\t},
\t},
}
`;

// -- Task 1: parseLuaTree tests --------------------------------------------

describe("parseLuaTree", () => {
  it("extracts the correct number of nodes from inline sample", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    assert.equal(nodes.length, 3);
  });

  it("extracts widget_name, talent, and type", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    const start = nodes.find((n) => n.widget_name === "node_aaaa-1111");
    assert.ok(start);
    assert.equal(start.talent, "not_selected");
    assert.equal(start.type, "start");
  });

  it("extracts children and parents arrays", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    const start = nodes.find((n) => n.widget_name === "node_aaaa-1111");
    assert.deepEqual(start.children, ["node_bbbb-2222", "node_cccc-3333"]);
    assert.deepEqual(start.parents, []);

    const alpha = nodes.find((n) => n.widget_name === "node_bbbb-2222");
    assert.deepEqual(alpha.parents, ["node_aaaa-1111"]);
    assert.deepEqual(alpha.children, []);
  });

  it("extracts group_name when present", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    const alpha = nodes.find((n) => n.widget_name === "node_bbbb-2222");
    assert.equal(alpha.group_name, "test_group_1");
  });

  it("sets group_name to null when absent", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    const start = nodes.find((n) => n.widget_name === "node_aaaa-1111");
    assert.equal(start.group_name, null);
  });

  it("treats empty group_name as null", () => {
    const lua = SAMPLE_LUA.replace(
      'group_name = "test_group_1"',
      'group_name = ""',
    );
    const nodes = parseLuaTree(lua);
    const alpha = nodes.find((n) => n.widget_name === "node_bbbb-2222");
    assert.equal(alpha.group_name, null);
  });

  it("reports correct 1-indexed line numbers for widget_name", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    const lines = SAMPLE_LUA.split("\n");

    for (const node of nodes) {
      const actualLine = lines[node.line - 1];
      assert.ok(
        actualLine.includes(`widget_name = "${node.widget_name}"`),
        `Line ${node.line} should contain widget_name for ${node.widget_name}, got: ${actualLine}`,
      );
    }
  });
});

describe("parseLuaTree with real source files", () => {
  const sourceRoot = resolveSourceRoot();

  it("parses psyker_tree.lua and yields 87 nodes", { skip: !sourceRoot }, () => {
    const luaPath = join(
      sourceRoot,
      "scripts/ui/views/talent_builder_view/layouts/psyker_tree.lua",
    );
    const luaSource = readFileSync(luaPath, "utf8");
    const nodes = parseLuaTree(luaSource);
    assert.equal(nodes.length, 87, `Expected 87 nodes, got ${nodes.length}`);
  });

  it("finds a start node in veteran_tree.lua", { skip: !sourceRoot }, () => {
    const luaPath = join(
      sourceRoot,
      "scripts/ui/views/talent_builder_view/layouts/veteran_tree.lua",
    );
    const luaSource = readFileSync(luaPath, "utf8");
    const nodes = parseLuaTree(luaSource);
    const startNode = nodes.find((n) => n.type === "start");
    assert.ok(startNode, "veteran_tree.lua should have a start node");
    assert.equal(startNode.talent, "veteran_combat_ability_stance");
  });
});

// -- Task 2: generateTreeEdges tests ---------------------------------------

const TEST_DOMAIN = "testdom";
const TEST_SNAPSHOT = "darktide-source.test123";
const TEST_LUA_PATH = "scripts/ui/views/talent_builder_view/layouts/test_tree.lua";

describe("generateTreeEdges", () => {
  const nodes = parseLuaTree(SAMPLE_LUA);

  it("generates parent_of edges from children arrays", () => {
    const edges = generateTreeEdges(nodes, TEST_DOMAIN, TEST_SNAPSHOT);
    const parentEdges = edges.filter((e) => e.type === "parent_of");

    // start node has 2 children → 2 parent_of edges
    assert.equal(parentEdges.length, 2);
    assert.ok(
      parentEdges.some(
        (e) =>
          e.from_entity_id === `${TEST_DOMAIN}.tree_node.node_aaaa-1111` &&
          e.to_entity_id === `${TEST_DOMAIN}.tree_node.node_bbbb-2222`,
      ),
    );
  });

  it("generates belongs_to_tree_node edges for non-start nodes", () => {
    const edges = generateTreeEdges(nodes, TEST_DOMAIN, TEST_SNAPSHOT);
    const belongsEdges = edges.filter((e) => e.type === "belongs_to_tree_node");

    // 2 default nodes with talents → 2 belongs_to edges
    assert.equal(belongsEdges.length, 2);

    const alphaEdge = belongsEdges.find(
      (e) => e.from_entity_id === `${TEST_DOMAIN}.talent.test_talent_alpha`,
    );
    assert.ok(alphaEdge);
    assert.equal(
      alphaEdge.to_entity_id,
      `${TEST_DOMAIN}.tree_node.node_bbbb-2222`,
    );
  });

  it("skips belongs_to_tree_node for start nodes", () => {
    const edges = generateTreeEdges(nodes, TEST_DOMAIN, TEST_SNAPSHOT);
    const startBelongs = edges.filter(
      (e) =>
        e.type === "belongs_to_tree_node" &&
        e.to_entity_id.includes("node_aaaa-1111"),
    );
    assert.equal(startBelongs.length, 0);
  });

  it("generates exclusive_with edges for nodes in the same group", () => {
    const edges = generateTreeEdges(nodes, TEST_DOMAIN, TEST_SNAPSHOT);
    const exclusiveEdges = edges.filter((e) => e.type === "exclusive_with");

    // 2 nodes in test_group_1 → 1 pairwise edge
    assert.equal(exclusiveEdges.length, 1);

    const edge = exclusiveEdges[0];
    // Lexicographic order: node_bbbb-2222 < node_cccc-3333
    assert.equal(
      edge.from_entity_id,
      `${TEST_DOMAIN}.tree_node.node_bbbb-2222`,
    );
    assert.equal(
      edge.to_entity_id,
      `${TEST_DOMAIN}.tree_node.node_cccc-3333`,
    );
  });

  it("includes conditions boilerplate on all edges", () => {
    const edges = generateTreeEdges(nodes, TEST_DOMAIN, TEST_SNAPSHOT);

    for (const edge of edges) {
      assert.deepEqual(edge.conditions, {
        predicates: [],
        aggregation: "additive",
        stacking_mode: "binary",
        exclusive_scope: null,
      });
      assert.deepEqual(edge.calc, {});
      assert.deepEqual(edge.evidence_ids, []);
    }
  });

  it("sorts edges by id", () => {
    const edges = generateTreeEdges(nodes, TEST_DOMAIN, TEST_SNAPSHOT);
    const ids = edges.map((e) => e.id);
    const sorted = [...ids].sort();
    assert.deepEqual(ids, sorted);
  });
});

describe("TREE_TYPE_TO_KIND", () => {
  it("maps tactical to ability", () => {
    assert.equal(TREE_TYPE_TO_KIND.tactical, "ability");
  });

  it("maps ability_modifier to talent_modifier", () => {
    assert.equal(TREE_TYPE_TO_KIND.ability_modifier, "talent_modifier");
  });

  it("maps default to talent", () => {
    assert.equal(TREE_TYPE_TO_KIND.default, "talent");
  });

  it("maps stat to talent", () => {
    assert.equal(TREE_TYPE_TO_KIND.stat, "talent");
  });

  it("does not map start", () => {
    assert.equal(TREE_TYPE_TO_KIND.start, undefined);
  });
});

describe("generateTreeNodeEntities", () => {
  const nodes = parseLuaTree(SAMPLE_LUA);

  it("generates one entity per parsed node", () => {
    const entities = generateTreeNodeEntities(
      nodes,
      TEST_DOMAIN,
      TEST_SNAPSHOT,
      TEST_LUA_PATH,
    );
    // 3 primary nodes, no implicit refs in SAMPLE_LUA (all children/parents are defined)
    const primary = entities.filter((e) => e.status === "source_backed");
    assert.equal(primary.length, 3);
  });

  it("populates all required entity fields", () => {
    const entities = generateTreeNodeEntities(
      nodes,
      TEST_DOMAIN,
      TEST_SNAPSHOT,
      TEST_LUA_PATH,
    );

    const required = [
      "id", "kind", "domain", "internal_name", "loc_key",
      "ui_name", "status", "refs", "source_snapshot_id", "attributes", "calc",
    ];

    for (const entity of entities) {
      for (const field of required) {
        assert.ok(
          field in entity,
          `Entity ${entity.id} missing field: ${field}`,
        );
      }
    }
  });

  it("sets correct attributes on primary nodes", () => {
    const entities = generateTreeNodeEntities(
      nodes,
      TEST_DOMAIN,
      TEST_SNAPSHOT,
      TEST_LUA_PATH,
    );

    const startEntity = entities.find(
      (e) => e.internal_name === "node_aaaa-1111",
    );
    assert.equal(startEntity.attributes.tree_type, "start");
    assert.equal(startEntity.attributes.talent_internal_name, null);
    assert.deepEqual(startEntity.attributes.children, [
      "node_bbbb-2222",
      "node_cccc-3333",
    ]);
    assert.deepEqual(startEntity.attributes.parents, []);

    const alphaEntity = entities.find(
      (e) => e.internal_name === "node_bbbb-2222",
    );
    assert.equal(alphaEntity.attributes.tree_type, "default");
    assert.equal(
      alphaEntity.attributes.talent_internal_name,
      "test_talent_alpha",
    );
    assert.equal(alphaEntity.attributes.group_name, "test_group_1");
  });

  it("sets refs with correct path and line", () => {
    const entities = generateTreeNodeEntities(
      nodes,
      TEST_DOMAIN,
      TEST_SNAPSHOT,
      TEST_LUA_PATH,
    );

    for (const entity of entities.filter((e) => e.status === "source_backed")) {
      assert.equal(entity.refs.length, 1);
      assert.equal(entity.refs[0].path, TEST_LUA_PATH);
      assert.ok(entity.refs[0].line > 0);
    }
  });

  it("sorts entities by id", () => {
    const entities = generateTreeNodeEntities(
      nodes,
      TEST_DOMAIN,
      TEST_SNAPSHOT,
      TEST_LUA_PATH,
    );
    const ids = entities.map((e) => e.id);
    const sorted = [...ids].sort();
    assert.deepEqual(ids, sorted);
  });
});

// -- Task 3: Implicit node detection tests ---------------------------------

const SAMPLE_LUA_WITH_IMPLICIT = `
return {
\tarchetype_name = "test_class",
\tnodes = {
\t\t{
\t\t\tcost = 0,
\t\t\ticon = "content/ui/materials/frames/talents/starting_points/starting_point",
\t\t\tmax_points = 1,
\t\t\ttalent = "not_selected",
\t\t\ttype = "start",
\t\t\twidget_name = "node_aaaa-1111",
\t\t\tx = 100,
\t\t\ty = 200,
\t\t\tchildren = {
\t\t\t\t"node_bbbb-2222",
\t\t\t\t"node_ffff-9999",
\t\t\t},
\t\t\tparents = {},
\t\t\trequirements = {
\t\t\t\tall_parents_chosen = false,
\t\t\t\tchildren_unlock_points = 0,
\t\t\t\tmin_points_spent = 0,
\t\t\t},
\t\t},
\t\t{
\t\t\tcost = 1,
\t\t\ticon = "content/ui/textures/icons/talents/test/talent_a",
\t\t\tmax_points = 1,
\t\t\ttalent = "test_talent_alpha",
\t\t\ttype = "default",
\t\t\twidget_name = "node_bbbb-2222",
\t\t\tx = 80,
\t\t\ty = 300,
\t\t\tchildren = {},
\t\t\tparents = {
\t\t\t\t"node_aaaa-1111",
\t\t\t},
\t\t\trequirements = {
\t\t\t\tall_parents_chosen = false,
\t\t\t\tchildren_unlock_points = 1,
\t\t\t\tmin_points_spent = 0,
\t\t\t},
\t\t},
\t},
}
`;

describe("implicit node detection", () => {
  it("emits partially_resolved entity for undefined child references", () => {
    const nodes = parseLuaTree(SAMPLE_LUA_WITH_IMPLICIT);
    const entities = generateTreeNodeEntities(
      nodes,
      TEST_DOMAIN,
      TEST_SNAPSHOT,
      TEST_LUA_PATH,
    );

    const implicit = entities.filter(
      (e) => e.status === "partially_resolved",
    );
    assert.equal(implicit.length, 1);
    assert.equal(implicit[0].internal_name, "node_ffff-9999");
  });

  it("sets implicit node attributes correctly", () => {
    const nodes = parseLuaTree(SAMPLE_LUA_WITH_IMPLICIT);
    const entities = generateTreeNodeEntities(
      nodes,
      TEST_DOMAIN,
      TEST_SNAPSHOT,
      TEST_LUA_PATH,
    );

    const implicit = entities.find(
      (e) => e.internal_name === "node_ffff-9999",
    );
    assert.equal(implicit.attributes.tree_type, "implicit_reference");
    assert.equal(implicit.attributes.talent_internal_name, null);
    assert.equal(implicit.attributes.group_name, null);
    assert.deepEqual(implicit.attributes.children, []);
    assert.deepEqual(implicit.attributes.parents, []);
  });

  it("sets ref line to the first occurrence of the implicit reference", () => {
    const nodes = parseLuaTree(SAMPLE_LUA_WITH_IMPLICIT);
    const entities = generateTreeNodeEntities(
      nodes,
      TEST_DOMAIN,
      TEST_SNAPSHOT,
      TEST_LUA_PATH,
    );

    const implicit = entities.find(
      (e) => e.internal_name === "node_ffff-9999",
    );
    assert.equal(implicit.refs.length, 1);
    assert.equal(implicit.refs[0].path, TEST_LUA_PATH);
    // Line should point to the start node (which references node_ffff-9999)
    const startNode = nodes.find((n) => n.widget_name === "node_aaaa-1111");
    assert.equal(implicit.refs[0].line, startNode.line);
  });

  it("does not create implicit entities for defined nodes", () => {
    const nodes = parseLuaTree(SAMPLE_LUA_WITH_IMPLICIT);
    const entities = generateTreeNodeEntities(
      nodes,
      TEST_DOMAIN,
      TEST_SNAPSHOT,
      TEST_LUA_PATH,
    );

    // node_bbbb-2222 is referenced in children AND defined as a primary node
    const bbbb = entities.filter(
      (e) => e.internal_name === "node_bbbb-2222",
    );
    assert.equal(bbbb.length, 1);
    assert.equal(bbbb[0].status, "source_backed");
  });

  it("does not duplicate implicit entities for multiply-referenced nodes", () => {
    // Add a Lua sample where the implicit node is referenced in multiple places
    const luaMultiRef = `
return {
\tarchetype_name = "test_class",
\tnodes = {
\t\t{
\t\t\tcost = 0,
\t\t\ttalent = "not_selected",
\t\t\ttype = "start",
\t\t\twidget_name = "node_aaaa-1111",
\t\t\tx = 100,
\t\t\ty = 200,
\t\t\tchildren = {
\t\t\t\t"node_ffff-9999",
\t\t\t},
\t\t\tparents = {},
\t\t\trequirements = {},
\t\t},
\t\t{
\t\t\tcost = 1,
\t\t\ttalent = "test_talent",
\t\t\ttype = "default",
\t\t\twidget_name = "node_bbbb-2222",
\t\t\tx = 80,
\t\t\ty = 300,
\t\t\tchildren = {
\t\t\t\t"node_ffff-9999",
\t\t\t},
\t\t\tparents = {},
\t\t\trequirements = {},
\t\t},
\t},
}
`;
    const nodes = parseLuaTree(luaMultiRef);
    const entities = generateTreeNodeEntities(
      nodes,
      TEST_DOMAIN,
      TEST_SNAPSHOT,
      TEST_LUA_PATH,
    );

    const implicit = entities.filter(
      (e) => e.internal_name === "node_ffff-9999",
    );
    assert.equal(implicit.length, 1, "Should only emit one entity for node_ffff-9999");
  });
});

// -- Task 4: Psyker golden comparison tests --------------------------------

const PSYKER_LUA_REL = "scripts/ui/views/talent_builder_view/layouts/psyker_tree.lua";
const PSYKER_SNAPSHOT = "darktide-source.f63d836";

describe("psyker golden comparison", () => {
  it("reproduces existing hand-authored psyker edges", { skip: !SOURCE_ROOT }, () => {
    const luaPath = join(SOURCE_ROOT, PSYKER_LUA_REL);
    const nodes = parseLuaTree(readFileSync(luaPath, "utf8"));
    const generated = generateTreeEdges(nodes, "psyker", PSYKER_SNAPSHOT);

    // Filter to only parent_of and belongs_to_tree_node (exclusive_with is new)
    const generatedFiltered = generated
      .filter((e) => e.type === "parent_of" || e.type === "belongs_to_tree_node")
      .sort((a, b) => a.id.localeCompare(b.id));

    const existingPath = join(REPO_ROOT, "data", "ground-truth", "edges", "psyker.json");
    const existing = JSON.parse(readFileSync(existingPath, "utf8"))
      .filter((e) => e.type === "parent_of" || e.type === "belongs_to_tree_node")
      .sort((a, b) => a.id.localeCompare(b.id));

    assert.equal(
      generatedFiltered.length,
      existing.length,
      `Edge count mismatch: generated ${generatedFiltered.length}, existing ${existing.length}`,
    );

    for (let i = 0; i < existing.length; i++) {
      assert.deepEqual(
        generatedFiltered[i],
        existing[i],
        `Edge mismatch at index ${i}: ${generatedFiltered[i]?.id} vs ${existing[i]?.id}`,
      );
    }
  });

  it("regenerating psyker tree entities matches committed shard", { skip: !SOURCE_ROOT }, () => {
    const luaPath = join(SOURCE_ROOT, PSYKER_LUA_REL);
    const nodes = parseLuaTree(readFileSync(luaPath, "utf8"));
    const generated = generateTreeNodeEntities(
      nodes,
      "psyker",
      PSYKER_SNAPSHOT,
      PSYKER_LUA_REL,
    );

    // Compare against the generated shard (psyker_tree.json)
    const shardPath = join(REPO_ROOT, "data", "ground-truth", "entities", "psyker_tree.json");
    const committed = JSON.parse(readFileSync(shardPath, "utf8"));

    assert.equal(
      generated.length,
      committed.length,
      `Entity count mismatch: generated ${generated.length}, committed ${committed.length}`,
    );

    assert.deepEqual(
      generated,
      committed,
      "Regenerated psyker tree entities should exactly match committed shard",
    );
  });

  it("generates exclusive_with edges with lexicographically ordered UUIDs", { skip: !SOURCE_ROOT }, () => {
    const luaPath = join(SOURCE_ROOT, PSYKER_LUA_REL);
    const nodes = parseLuaTree(readFileSync(luaPath, "utf8"));
    const edges = generateTreeEdges(nodes, "psyker", PSYKER_SNAPSHOT);

    const exclusiveEdges = edges.filter((e) => e.type === "exclusive_with");

    assert.ok(
      exclusiveEdges.length > 0,
      "Should generate at least one exclusive_with edge",
    );

    for (const edge of exclusiveEdges) {
      // Extract UUIDs from the entity IDs (format: psyker.tree_node.node_{uuid})
      const fromUuid = edge.from_entity_id.replace("psyker.tree_node.", "");
      const toUuid = edge.to_entity_id.replace("psyker.tree_node.", "");

      assert.ok(
        fromUuid.localeCompare(toUuid) < 0,
        `exclusive_with edge ${edge.id}: from UUID ${fromUuid} should be lexicographically before to UUID ${toUuid}`,
      );
    }
  });
});

// -- Task 9: Idempotency test -----------------------------------------------

describe("idempotency", () => {
  it(
    "running the generator twice produces identical output",
    { skip: SOURCE_ROOT == null },
    () => {
      const lua = readFileSync(
        `${SOURCE_ROOT}/scripts/ui/views/talent_builder_view/layouts/psyker_tree.lua`,
        "utf8",
      );
      const nodes = parseLuaTree(lua);
      const snapshotId = "darktide-source.f63d836";
      const luaPath = "scripts/ui/views/talent_builder_view/layouts/psyker_tree.lua";

      const edges1 = generateTreeEdges(nodes, "psyker", snapshotId);
      const edges2 = generateTreeEdges(nodes, "psyker", snapshotId);
      assert.deepEqual(edges1, edges2);

      const entities1 = generateTreeNodeEntities(nodes, "psyker", snapshotId, luaPath);
      const entities2 = generateTreeNodeEntities(nodes, "psyker", snapshotId, luaPath);
      assert.deepEqual(entities1, entities2);
    },
  );
});
