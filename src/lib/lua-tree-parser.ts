/**
 * Parses Darktide *_tree.lua layout files into structured node objects.
 *
 * These files define the talent tree UI layout: node positions, parent/child
 * edges, group membership, and type metadata. The parser extracts the subset
 * needed for entity resolution and edge generation.
 */

export interface TreeNode {
  widget_name: string;
  talent: string;
  type: string;
  group_name: string | null;
  children: string[];
  parents: string[];
  /** Canvas x position in source pixels. 0 when missing. */
  x: number;
  /** Canvas y position in source pixels. 0 when missing. */
  y: number;
  /** Point cost to select the node. Defaults to 0 (e.g. "start" nodes). */
  cost: number;
  /** Max points that can be spent on this node (1 except for a handful of modifier nodes). */
  max_points: number;
  /** Source path for the node icon asset, or null when absent. */
  icon: string | null;
  /** Source path for the node ring gradient, or null when absent. */
  gradient_color: string | null;
  /** 1-indexed line number of widget_name */
  line: number;
}

/**
 * Parse a Lua tree source file into an array of TreeNode objects.
 */
function parseLuaTree(luaSource: string): TreeNode[] {
  const lines = luaSource.split("\n");
  const nodes: TreeNode[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Look for widget_name assignments to identify node blocks
    const widgetMatch = line.match(/widget_name\s*=\s*"([^"]+)"/);
    if (!widgetMatch) {
      i++;
      continue;
    }

    const widgetName = widgetMatch[1];
    const widgetLine = i + 1; // 1-indexed

    // Find block boundaries by scanning for the enclosing `{` / `}`
    const blockStart = findBlockStart(lines, i);
    const blockEnd = findBlockEnd(lines, i);

    const blockLines = lines.slice(blockStart, blockEnd + 1);
    const blockText = blockLines.join("\n");

    const talent = extractStringField(blockText, "talent");
    const type = extractStringField(blockText, "type");
    const groupName = extractStringField(blockText, "group_name");
    const icon = extractStringField(blockText, "icon");
    const gradientColor = extractStringField(blockText, "gradient_color");
    const children = extractStringArray(blockText, "children");
    const parents = extractStringArray(blockText, "parents");
    const x = extractNumberField(blockText, "x") ?? 0;
    const y = extractNumberField(blockText, "y") ?? 0;
    const cost = extractNumberField(blockText, "cost") ?? 0;
    const maxPoints = extractNumberField(blockText, "max_points") ?? 1;

    nodes.push({
      widget_name: widgetName,
      talent: talent ?? "not_selected",
      type: type ?? "default",
      group_name: groupName === "" ? null : (groupName ?? null),
      children,
      parents,
      x,
      y,
      cost,
      max_points: maxPoints,
      icon: icon ?? null,
      gradient_color: gradientColor ?? null,
      line: widgetLine,
    });

    i = blockEnd + 1;
  }

  return nodes;
}

/**
 * Find the start of the enclosing node block (the `{` line).
 */
function findBlockStart(lines: string[], widgetLineIndex: number): number {
  let braceDepth = 0;

  for (let j = widgetLineIndex; j >= 0; j--) {
    const line = lines[j];

    // Count closing braces (going backwards, these are "opens")
    for (const ch of line) {
      if (ch === "}") {
        braceDepth++;
      } else if (ch === "{") {
        if (braceDepth === 0) {
          return j;
        }
        braceDepth--;
      }
    }
  }

  return 0;
}

/**
 * Find the end of the enclosing node block (the `},` line).
 */
function findBlockEnd(lines: string[], widgetLineIndex: number): number {
  let braceDepth = 0;

  for (let j = widgetLineIndex; j < lines.length; j++) {
    const line = lines[j];

    for (const ch of line) {
      if (ch === "{") {
        braceDepth++;
      } else if (ch === "}") {
        if (braceDepth === 0) {
          return j;
        }
        braceDepth--;
      }
    }
  }

  return lines.length - 1;
}

/**
 * Extract a simple string field value from a Lua block.
 * Returns the string value, or null if not found.
 */
function extractStringField(blockText: string, fieldName: string): string | null {
  const regex = new RegExp(`(?:^|\\n)[\\t ]*${fieldName}\\s*=\\s*"([^"]*)"`, "m");
  const match = blockText.match(regex);
  return match ? match[1] : null;
}

/**
 * Extract a string array field from a Lua block.
 * Handles: field = { "str1", "str2", } and field = {}
 */
function extractStringArray(blockText: string, fieldName: string): string[] {
  const regex = new RegExp(
    `${fieldName}\\s*=\\s*\\{([^}]*?)\\}`,
    "s",
  );
  const match = blockText.match(regex);
  if (!match) {
    return [];
  }

  const content = match[1];
  const items: string[] = [];
  const itemRegex = /"([^"]+)"/g;
  let itemMatch;

  while ((itemMatch = itemRegex.exec(content)) !== null) {
    items.push(itemMatch[1]);
  }

  return items;
}

/**
 * Extract a numeric field value from a Lua block.
 * Handles integers and floats, including scientific notation.
 * Returns the parsed number, or null if the field is missing or unparseable.
 */
function extractNumberField(blockText: string, fieldName: string): number | null {
  const regex = new RegExp(
    `(?:^|\\n)[\\t ]*${fieldName}\\s*=\\s*(-?[0-9]+(?:\\.[0-9]+)?(?:[eE][-+]?[0-9]+)?)`,
    "m",
  );
  const match = blockText.match(regex);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export { parseLuaTree };
