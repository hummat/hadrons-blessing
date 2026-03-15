import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLuaTree } from "./ground-truth/lib/lua-tree-parser.mjs";
import { resolveSourceRoot } from "./ground-truth/lib/load.mjs";

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
