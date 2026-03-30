/**
 * Generates edge and entity records from parsed Lua tree nodes.
 *
 * Consumes the output of parseLuaTree() and produces:
 * - parent_of edges (tree topology)
 * - belongs_to_tree_node edges (talent entity -> tree node entity)
 * - exclusive_with edges (mutual exclusion within groups)
 * - tree_node entity records (one per parsed node)
 */

import type { TreeNode } from "./lua-tree-parser.js";

/** Maps node type strings to entity kind for belongs_to_tree_node from_entity_id. */
const TREE_TYPE_TO_KIND: Record<string, string> = {
  ability: "ability",
  aura: "aura",
  keystone: "keystone",
  tactical: "ability",
  ability_modifier: "talent_modifier",
  tactical_modifier: "talent_modifier",
  keystone_modifier: "talent_modifier",
  default: "talent",
  stat: "talent",
};

interface Conditions {
  predicates: unknown[];
  aggregation: string;
  stacking_mode: string;
  exclusive_scope: string | null;
}

function makeConditions(): Conditions {
  return {
    predicates: [],
    aggregation: "additive",
    stacking_mode: "binary",
    exclusive_scope: null,
  };
}

export interface TreeEdgeRecord {
  id: string;
  type: string;
  from_entity_id: string;
  to_entity_id: string;
  source_snapshot_id: string;
  conditions: Conditions;
  calc: Record<string, never>;
  evidence_ids: string[];
}

export interface TreeNodeEntityRecord {
  id: string;
  kind: "tree_node";
  domain: string;
  internal_name: string;
  loc_key: null;
  ui_name: null;
  status: "source_backed" | "partially_resolved";
  refs: { path: string; line: number }[];
  source_snapshot_id: string;
  attributes: {
    tree_type: string;
    talent_internal_name: string | null;
    group_name: string | null;
    exclusive_group: null;
    children: string[];
    parents: string[];
  };
  calc: Record<string, never>;
}

/**
 * Generate edge records from parsed tree nodes.
 */
function generateTreeEdges(nodes: TreeNode[], domain: string, snapshotId: string): TreeEdgeRecord[] {
  const edges: TreeEdgeRecord[] = [];

  // Build lookup for group membership
  const groupMembers = new Map<string, string[]>();

  for (const node of nodes) {
    // parent_of edges from children[]
    for (const childWidget of node.children) {
      edges.push({
        id: `${domain}.edge.parent_of.${node.widget_name}.${childWidget}`,
        type: "parent_of",
        from_entity_id: `${domain}.tree_node.${node.widget_name}`,
        to_entity_id: `${domain}.tree_node.${childWidget}`,
        source_snapshot_id: snapshotId,
        conditions: makeConditions(),
        calc: {},
        evidence_ids: [],
      });
    }

    // belongs_to_tree_node edges (talent entity -> tree_node)
    if (node.type !== "start" && node.talent !== "not_selected") {
      const kind = TREE_TYPE_TO_KIND[node.type];
      if (kind) {
        edges.push({
          id: `${domain}.edge.belongs_to_tree_node.${node.talent}`,
          type: "belongs_to_tree_node",
          from_entity_id: `${domain}.${kind}.${node.talent}`,
          to_entity_id: `${domain}.tree_node.${node.widget_name}`,
          source_snapshot_id: snapshotId,
          conditions: makeConditions(),
          calc: {},
          evidence_ids: [],
        });
      }
    }

    // Collect group members for exclusive_with
    if (node.group_name) {
      if (!groupMembers.has(node.group_name)) {
        groupMembers.set(node.group_name, []);
      }
      groupMembers.get(node.group_name)!.push(node.widget_name);
    }
  }

  // exclusive_with edges — pairwise, lexicographically ordered
  for (const members of groupMembers.values()) {
    const sorted = [...members].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        edges.push({
          id: `${domain}.edge.exclusive_with.${sorted[i]}.${sorted[j]}`,
          type: "exclusive_with",
          from_entity_id: `${domain}.tree_node.${sorted[i]}`,
          to_entity_id: `${domain}.tree_node.${sorted[j]}`,
          source_snapshot_id: snapshotId,
          conditions: makeConditions(),
          calc: {},
          evidence_ids: [],
        });
      }
    }
  }

  edges.sort((a, b) => a.id.localeCompare(b.id));
  return edges;
}

/**
 * Generate tree_node entity records from parsed tree nodes.
 */
function generateTreeNodeEntities(
  nodes: TreeNode[],
  domain: string,
  snapshotId: string,
  luaPath: string,
): TreeNodeEntityRecord[] {
  const entities: TreeNodeEntityRecord[] = [];
  const definedWidgets = new Set(nodes.map((n) => n.widget_name));

  // Track first occurrence line for implicit references
  const implicitFirstLine = new Map<string, number>();

  for (const node of nodes) {
    // Primary node entity
    entities.push({
      id: `${domain}.tree_node.${node.widget_name}`,
      kind: "tree_node",
      domain,
      internal_name: node.widget_name,
      loc_key: null,
      ui_name: null,
      status: "source_backed",
      refs: [{ path: luaPath, line: node.line }],
      source_snapshot_id: snapshotId,
      attributes: {
        tree_type: node.type,
        talent_internal_name: node.talent === "not_selected" ? null : node.talent,
        group_name: node.group_name,
        exclusive_group: null,
        children: node.children,
        parents: node.parents,
      },
      calc: {},
    });

    // Detect implicit references
    for (const ref of [...node.children, ...node.parents]) {
      if (!definedWidgets.has(ref) && !implicitFirstLine.has(ref)) {
        implicitFirstLine.set(ref, node.line);
      }
    }
  }

  // Emit implicit reference entities
  for (const [widgetName, firstLine] of implicitFirstLine) {
    entities.push({
      id: `${domain}.tree_node.${widgetName}`,
      kind: "tree_node",
      domain,
      internal_name: widgetName,
      loc_key: null,
      ui_name: null,
      status: "partially_resolved",
      refs: [{ path: luaPath, line: firstLine }],
      source_snapshot_id: snapshotId,
      attributes: {
        tree_type: "implicit_reference",
        talent_internal_name: null,
        group_name: null,
        exclusive_group: null,
        children: [],
        parents: [],
      },
      calc: {},
    });
  }

  entities.sort((a, b) => a.id.localeCompare(b.id));
  return entities;
}

export { TREE_TYPE_TO_KIND, generateTreeEdges, generateTreeNodeEntities };
