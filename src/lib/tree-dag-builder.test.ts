import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLuaTree } from "./lua-tree-parser.js";
import { buildTreeDag, iconPathToKey, parseTreeHeader } from "./tree-dag-builder.js";
import { resolveSourceRoot } from "./load.js";

const SOURCE_ROOT = resolveSourceRoot();

const SAMPLE_LUA = `
return {
\tarchetype_name = "zealot",
\tbackground_height = 2800,
\tname = "zealot_tree",
\tnode_points = 30,
\ttalent_points = 30,
\tversion = 24,
\tnodes = {
\t\t{
\t\t\tcost = 0,
\t\t\ticon = "content/ui/materials/frames/talents/starting_points/starting_point",
\t\t\tmax_points = 1,
\t\t\ttalent = "not_selected",
\t\t\ttype = "start",
\t\t\twidget_name = "node_start",
\t\t\tx = 1000,
\t\t\ty = 100,
\t\t\tchildren = {},
\t\t\tparents = {},
\t\t},
\t\t{
\t\t\tcost = 1,
\t\t\tgradient_color = "content/ui/textures/color_ramps/class_node_colors/zealot_03",
\t\t\ticon = "content/ui/textures/icons/talents/zealot/zealot_alpha",
\t\t\tmax_points = 1,
\t\t\ttalent = "zealot_alpha",
\t\t\ttype = "default",
\t\t\twidget_name = "node_alpha",
\t\t\tx = 1200,
\t\t\ty = 500,
\t\t\tchildren = {},
\t\t\tparents = { "node_start" },
\t\t},
\t\t{
\t\t\tcost = 1,
\t\t\ticon = "content/ui/textures/icons/talents/zealot/zealot_default_general_talent",
\t\t\tmax_points = 1,
\t\t\ttalent = "base_toughness_node_buff_medium_2",
\t\t\ttype = "stat",
\t\t\twidget_name = "node_stat",
\t\t\tx = 1000,
\t\t\ty = 900,
\t\t\tchildren = {},
\t\t\tparents = { "node_alpha" },
\t\t},
\t\t{
\t\t\tcost = 1,
\t\t\ticon = "content/ui/textures/icons/talents/zealot/zealot_keystone",
\t\t\tmax_points = 1,
\t\t\ttalent = "zealot_chorus_blessing",
\t\t\ttype = "keystone",
\t\t\twidget_name = "node_keystone",
\t\t\tx = 800,
\t\t\ty = 1500,
\t\t\tchildren = {},
\t\t\tparents = {},
\t\t},
\t},
}
`;

describe("parseTreeHeader", () => {
  it("extracts header metadata from the top-level return block", () => {
    const header = parseTreeHeader(SAMPLE_LUA);
    assert.equal(header.archetype_name, "zealot");
    assert.equal(header.version, 24);
    assert.equal(header.node_points, 30);
    assert.equal(header.talent_points, 30);
    assert.equal(header.background_height, 2800);
  });
});

describe("iconPathToKey", () => {
  it("strips the textures/icons/talents prefix", () => {
    assert.equal(
      iconPathToKey("content/ui/textures/icons/talents/zealot/zealot_alpha"),
      "zealot/zealot_alpha",
    );
  });

  it("preserves the last two segments for non-standard icon paths", () => {
    assert.equal(
      iconPathToKey("content/ui/materials/frames/talents/starting_points/starting_point"),
      "starting_points/starting_point",
    );
  });

  it("returns null for missing icon", () => {
    assert.equal(iconPathToKey(null), null);
  });
});

describe("buildTreeDag", () => {
  const nodes = parseLuaTree(SAMPLE_LUA);
  const dag = buildTreeDag({
    luaSource: SAMPLE_LUA,
    nodes,
    domain: "zealot",
    sourceFile: "scripts/ui/views/talent_builder_view/layouts/zealot_tree.lua",
    snapshotId: "test-snapshot",
    sharedStatNodeIdByInternalPrefix: {
      base_toughness_node_buff: "shared.stat_node.toughness_boost",
    },
  });

  it("populates header metadata", () => {
    assert.equal(dag.archetype_name, "zealot");
    assert.equal(dag.version, 24);
    assert.equal(dag.node_points, 30);
    assert.equal(dag.talent_points, 30);
  });

  it("computes canvas width from max x + padding and height from background_height", () => {
    assert.equal(dag.canvas.width, 1400); // max x 1200 + 200
    assert.equal(dag.canvas.height, 2800);
  });

  it("resolves entity_id by node type", () => {
    const start = dag.nodes.find((n) => n.widget_name === "node_start");
    const alpha = dag.nodes.find((n) => n.widget_name === "node_alpha");
    const stat = dag.nodes.find((n) => n.widget_name === "node_stat");
    const keystone = dag.nodes.find((n) => n.widget_name === "node_keystone");

    assert.equal(start?.entity_id, null, "start nodes should have no entity_id");
    assert.equal(alpha?.entity_id, "zealot.talent.zealot_alpha");
    assert.equal(stat?.entity_id, "zealot.talent.base_toughness_node_buff_medium_2");
    assert.equal(keystone?.entity_id, "zealot.keystone.zealot_chorus_blessing");
  });

  it("emits alternate selection ids for shared stat-node families", () => {
    const stat = dag.nodes.find((n) => n.widget_name === "node_stat");

    assert.deepEqual(stat?.selection_ids, [
      "zealot.talent.base_toughness_node_buff_medium_2",
      "shared.stat_node.toughness_boost",
    ]);
  });

  it("maps icon_key from full icon path", () => {
    const alpha = dag.nodes.find((n) => n.widget_name === "node_alpha");
    assert.equal(alpha?.icon_key, "zealot/zealot_alpha");
  });

  it("preserves talent_internal_name, gradient_color, cost, max_points", () => {
    const alpha = dag.nodes.find((n) => n.widget_name === "node_alpha");
    assert.ok(alpha);
    assert.equal(alpha.talent_internal_name, "zealot_alpha");
    assert.equal(alpha.gradient_color, "content/ui/textures/color_ramps/class_node_colors/zealot_03");
    assert.equal(alpha.cost, 1);
    assert.equal(alpha.max_points, 1);
  });

  it("sorts nodes by widget_name for stable output", () => {
    const names = dag.nodes.map((n) => n.widget_name);
    const sorted = [...names].sort();
    assert.deepEqual(names, sorted);
  });

  it("treats broker_stimm nodes as selectable talents", () => {
    const brokerLua = `
return {
\tnodes = {
\t\t{
\t\t\tcost = 1,
\t\t\ticon = "content/ui/textures/icons/talents/broker/stimm_tree/broker_stimm_combat_1",
\t\t\tmax_points = 1,
\t\t\ttalent = "broker_stimm_combat_1",
\t\t\ttype = "broker_stimm",
\t\t\twidget_name = "node_stimm",
\t\t\tx = 100,
\t\t\ty = 100,
\t\t\tchildren = {},
\t\t\tparents = {},
\t\t},
\t},
}
`;
    const brokerDag = buildTreeDag({
      luaSource: brokerLua,
      nodes: parseLuaTree(brokerLua),
      domain: "hive_scum",
      sourceFile: "scripts/ui/views/broker_stimm_builder_view/layouts/broker_stimm_tree.lua",
      snapshotId: "test-snapshot",
    });

    assert.deepEqual(brokerDag.nodes[0]?.selection_ids, ["hive_scum.talent.broker_stimm_combat_1"]);
  });
});

describe("buildTreeDag — live zealot tree (source-backed)", { skip: !SOURCE_ROOT }, () => {
  it("produces a DAG with entity IDs for selectable nodes and connectivity", () => {
    const path = join(
      SOURCE_ROOT,
      "scripts/ui/views/talent_builder_view/layouts/zealot_tree.lua",
    );
    const source = readFileSync(path, "utf8");
    const nodes = parseLuaTree(source);
    const dag = buildTreeDag({
      luaSource: source,
      nodes,
      domain: "zealot",
      sourceFile: "scripts/ui/views/talent_builder_view/layouts/zealot_tree.lua",
      snapshotId: "live-zealot",
    });

    assert.ok(dag.nodes.length > 50, `expected >50 zealot nodes, got ${dag.nodes.length}`);
    assert.equal(dag.archetype_name, "zealot");

    // Every non-start, non-group node with a known type should carry an entity_id.
    const withEntity = dag.nodes.filter((n) => n.entity_id !== null).length;
    assert.ok(
      withEntity > 0.7 * dag.nodes.length,
      `expected >70% of zealot nodes to resolve to entity_ids, saw ${withEntity}/${dag.nodes.length}`,
    );

    // Topology: most referenced child/parent widgets exist in the node set.
    // The tree layouts contain a small number of implicit references (handled
    // by tree-edge-generator with a `partially_resolved` status) — the DAG
    // keeps them in place so the renderer can draw the edge stub, but the
    // majority of refs must resolve for the topology to be meaningful.
    const widgets = new Set(dag.nodes.map((n) => n.widget_name));
    let refs = 0;
    let resolvedRefs = 0;
    for (const node of dag.nodes) {
      for (const ref of [...node.children, ...node.parents]) {
        refs++;
        if (widgets.has(ref)) resolvedRefs++;
      }
    }
    assert.ok(refs > 0, "expected at least some parent/child references");
    const ratio = resolvedRefs / refs;
    assert.ok(
      ratio > 0.9,
      `expected >90% of parent/child refs to resolve to nodes, saw ${resolvedRefs}/${refs}`,
    );
  });
});
