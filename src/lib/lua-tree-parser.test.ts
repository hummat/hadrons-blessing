import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLuaTree } from "./lua-tree-parser.js";
import { resolveSourceRoot } from "./load.js";

const SOURCE_ROOT = resolveSourceRoot();

const SAMPLE_LUA = `
return {
\tarchetype_name = "test_class",
\tnodes = {
\t\t{
\t\t\tcost = 0,
\t\t\ticon = "content/ui/materials/frames/talents/starting_points/starting_point",
\t\t\tmax_points = 1,
\t\t\ttalent = "not_selected",
\t\t\ttype = "start",
\t\t\twidget_name = "node_aaaa",
\t\t\tx = 100,
\t\t\ty = 200,
\t\t\tchildren = {},
\t\t\tparents = {},
\t\t},
\t\t{
\t\t\tcost = 1,
\t\t\tgradient_color = "content/ui/textures/color_ramps/class_node_colors/zealot_03",
\t\t\tgroup_name = "grp_1",
\t\t\ticon = "content/ui/textures/icons/talents/test/alpha",
\t\t\tmax_points = 2,
\t\t\ttalent = "alpha",
\t\t\ttype = "default",
\t\t\twidget_name = "node_bbbb",
\t\t\tx = 605.0000274718752,
\t\t\ty = 2014.9999934276934,
\t\t\tchildren = { "node_aaaa" },
\t\t\tparents = {},
\t\t},
\t\t{
\t\t\tcost = 1,
\t\t\tgroup_name = "",
\t\t\tmax_points = 1,
\t\t\ttalent = "gamma",
\t\t\ttype = "modifier",
\t\t\twidget_name = "node_cccc",
\t\t\tx = -50,
\t\t\ty = 0,
\t\t\tchildren = {},
\t\t\tparents = {},
\t\t},
\t},
}
`;

describe("parseLuaTree — positional and asset fields", () => {
  it("extracts integer x/y coordinates", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    const start = nodes.find((n) => n.widget_name === "node_aaaa");
    assert.ok(start);
    assert.equal(start.x, 100);
    assert.equal(start.y, 200);
  });

  it("extracts float x/y coordinates", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    const alpha = nodes.find((n) => n.widget_name === "node_bbbb");
    assert.ok(alpha);
    assert.equal(alpha.x, 605.0000274718752);
    assert.equal(alpha.y, 2014.9999934276934);
  });

  it("extracts negative coordinates", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    const gamma = nodes.find((n) => n.widget_name === "node_cccc");
    assert.ok(gamma);
    assert.equal(gamma.x, -50);
    assert.equal(gamma.y, 0);
  });

  it("captures icon and gradient_color paths", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    const alpha = nodes.find((n) => n.widget_name === "node_bbbb");
    assert.ok(alpha);
    assert.equal(alpha.icon, "content/ui/textures/icons/talents/test/alpha");
    assert.equal(alpha.gradient_color, "content/ui/textures/color_ramps/class_node_colors/zealot_03");
  });

  it("returns null icon/gradient when absent", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    const gamma = nodes.find((n) => n.widget_name === "node_cccc");
    assert.ok(gamma);
    assert.equal(gamma.icon, null);
    assert.equal(gamma.gradient_color, null);
  });

  it("captures cost and max_points with defaults", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    const start = nodes.find((n) => n.widget_name === "node_aaaa");
    const alpha = nodes.find((n) => n.widget_name === "node_bbbb");
    assert.ok(start && alpha);
    assert.equal(start.cost, 0);
    assert.equal(start.max_points, 1);
    assert.equal(alpha.cost, 1);
    assert.equal(alpha.max_points, 2);
  });

  it("treats empty group_name string as null", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    const gamma = nodes.find((n) => n.widget_name === "node_cccc");
    assert.ok(gamma);
    assert.equal(gamma.group_name, null);
  });
});

describe("parseLuaTree — live zealot tree (source-backed)", { skip: !SOURCE_ROOT }, () => {
  it("parses every node with finite x/y and the majority carry icons", () => {
    const path = join(
      SOURCE_ROOT,
      "scripts/ui/views/talent_builder_view/layouts/zealot_tree.lua",
    );
    const source = readFileSync(path, "utf8");
    const nodes = parseLuaTree(source);
    assert.ok(nodes.length > 0, "expected at least one node");

    let withIcon = 0;
    for (const node of nodes) {
      assert.ok(Number.isFinite(node.x), `${node.widget_name} x not finite`);
      assert.ok(Number.isFinite(node.y), `${node.widget_name} y not finite`);
      if (node.icon !== null) withIcon++;
    }

    const ratio = withIcon / nodes.length;
    assert.ok(
      ratio > 0.8,
      `expected >80% of zealot tree nodes to have icons, saw ${withIcon}/${nodes.length}`,
    );
  });
});
