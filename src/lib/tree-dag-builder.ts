/**
 * Builds a website-facing talent-tree DAG from parsed Lua tree nodes.
 *
 * Output shape is optimized for static consumption by the website TalentTree
 * component: all layout coords, asset path keys, entity IDs, and topology are
 * resolved up-front so the client can render without any further lookups.
 */

import type { TreeNode } from "./lua-tree-parser.js";
import { TREE_TYPE_TO_KIND } from "./tree-edge-generator.js";

export interface TreeDagNode {
  widget_name: string;
  entity_id: string | null;
  selection_ids: string[];
  talent_internal_name: string | null;
  type: string;
  group_name: string | null;
  x: number;
  y: number;
  cost: number;
  max_points: number;
  icon_key: string | null;
  gradient_color: string | null;
  children: string[];
  parents: string[];
}

export interface TreeDagHeader {
  archetype_name: string | null;
  version: number | null;
  node_points: number | null;
  talent_points: number | null;
  background_height: number | null;
}

export interface TreeDag {
  domain: string;
  source_file: string;
  source_snapshot_id: string;
  archetype_name: string | null;
  version: number | null;
  node_points: number | null;
  talent_points: number | null;
  canvas: { width: number; height: number };
  nodes: TreeDagNode[];
}

/**
 * Parse the top-level header metadata (archetype_name, version, node_points, etc.)
 * from the raw Lua source. Uses anchored line matches because these fields sit
 * at the top of the file outside any node block.
 */
export function parseTreeHeader(luaSource: string): TreeDagHeader {
  const str = (field: string): string | null => {
    const match = luaSource.match(new RegExp(`(?:^|\\n)[\\t ]*${field}\\s*=\\s*"([^"]*)"`, "m"));
    return match ? match[1] : null;
  };
  const num = (field: string): number | null => {
    const match = luaSource.match(
      new RegExp(`(?:^|\\n)[\\t ]*${field}\\s*=\\s*(-?[0-9]+(?:\\.[0-9]+)?)`, "m"),
    );
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  };

  return {
    archetype_name: str("archetype_name"),
    version: num("version"),
    node_points: num("node_points"),
    talent_points: num("talent_points"),
    background_height: num("background_height"),
  };
}

/**
 * Canvas height is taken from `background_height`; canvas width is inferred
 * from the maximum x coordinate across all nodes (the layouts don't store
 * an explicit width). A small padding leaves room for the node icon radius.
 */
function computeCanvas(nodes: TreeNode[], header: TreeDagHeader): { width: number; height: number } {
  const maxX = nodes.reduce((m, n) => (n.x > m ? n.x : m), 0);
  const width = Math.ceil(maxX + 200);
  const height = header.background_height ?? Math.ceil(nodes.reduce((m, n) => (n.y > m ? n.y : m), 0) + 200);
  return { width, height };
}

/**
 * Resolve the canonical entity ID for a node's selection, or null when the
 * node is structural (start nodes, empty groups) or its type has no kind mapping.
 */
function nodeEntityId(node: TreeNode, domain: string): string | null {
  if (node.talent === "not_selected") return null;
  if (node.type === "start") return null;
  const kind = TREE_TYPE_TO_KIND[node.type];
  if (!kind) return null;
  return `${domain}.${kind}.${node.talent}`;
}

function nodeSelectionIds(
  node: TreeNode,
  domain: string,
  sharedStatNodeIdByInternalPrefix: Record<string, string>,
): string[] {
  const ids: string[] = [];
  const entityId = nodeEntityId(node, domain);
  if (entityId) ids.push(entityId);

  if (node.type === "stat" && node.talent !== "not_selected") {
    const match = Object.entries(sharedStatNodeIdByInternalPrefix)
      .sort((a, b) => b[0].length - a[0].length)
      .find(([prefix]) => node.talent.startsWith(prefix));
    if (match && !ids.includes(match[1])) ids.push(match[1]);
  }

  return ids;
}

/**
 * Convert an icon path like `content/ui/textures/icons/talents/zealot/foo` to
 * a compact key `zealot/foo` the asset pipeline uses as a filename stem.
 * Returns null when the node has no icon or the path doesn't follow the
 * expected structure.
 */
export function iconPathToKey(iconPath: string | null): string | null {
  if (!iconPath) return null;
  const prefix = "content/ui/textures/icons/talents/";
  if (iconPath.startsWith(prefix)) {
    return iconPath.slice(prefix.length);
  }
  // Some "start" nodes use a materials path; preserve the last two segments
  // so the asset pipeline can still mirror them if desired.
  const parts = iconPath.split("/");
  return parts.length >= 2 ? parts.slice(-2).join("/") : iconPath;
}

export interface BuildDagOptions {
  luaSource: string;
  nodes: TreeNode[];
  domain: string;
  sourceFile: string;
  snapshotId: string;
  sharedStatNodeIdByInternalPrefix?: Record<string, string>;
}

/**
 * Assemble the full TreeDag from parsed nodes + raw Lua source (for header).
 */
export function buildTreeDag({
  luaSource,
  nodes,
  domain,
  sourceFile,
  snapshotId,
  sharedStatNodeIdByInternalPrefix = {},
}: BuildDagOptions): TreeDag {
  const header = parseTreeHeader(luaSource);
  const canvas = computeCanvas(nodes, header);

  const dagNodes: TreeDagNode[] = nodes.map((node) => ({
    widget_name: node.widget_name,
    entity_id: nodeEntityId(node, domain),
    selection_ids: nodeSelectionIds(node, domain, sharedStatNodeIdByInternalPrefix),
    talent_internal_name: node.talent === "not_selected" ? null : node.talent,
    type: node.type,
    group_name: node.group_name,
    x: node.x,
    y: node.y,
    cost: node.cost,
    max_points: node.max_points,
    icon_key: iconPathToKey(node.icon),
    gradient_color: node.gradient_color,
    children: node.children,
    parents: node.parents,
  }));

  dagNodes.sort((a, b) => a.widget_name.localeCompare(b.widget_name));

  return {
    domain,
    source_file: sourceFile,
    source_snapshot_id: snapshotId,
    archetype_name: header.archetype_name,
    version: header.version,
    node_points: header.node_points,
    talent_points: header.talent_points,
    canvas,
    nodes: dagNodes,
  };
}
