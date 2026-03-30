// @ts-nocheck
/**
 * Parses Darktide *_tree.lua layout files into structured node objects.
 *
 * These files define the talent tree UI layout: node positions, parent/child
 * edges, group membership, and type metadata. The parser extracts the subset
 * needed for entity resolution and edge generation.
 */

/**
 * @typedef {Object} TreeNode
 * @property {string} widget_name
 * @property {string} talent
 * @property {string} type
 * @property {string|null} group_name
 * @property {string[]} children
 * @property {string[]} parents
 * @property {number} line - 1-indexed line number of widget_name
 */

/**
 * Parse a Lua tree source file into an array of TreeNode objects.
 *
 * @param {string} luaSource - Raw content of a *_tree.lua file
 * @returns {TreeNode[]}
 */
function parseLuaTree(luaSource) {
  const lines = luaSource.split("\n");
  const nodes = [];

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
    const children = extractStringArray(blockText, "children");
    const parents = extractStringArray(blockText, "parents");

    nodes.push({
      widget_name: widgetName,
      talent: talent ?? "not_selected",
      type: type ?? "default",
      group_name: groupName === "" ? null : (groupName ?? null),
      children,
      parents,
      line: widgetLine,
    });

    i = blockEnd + 1;
  }

  return nodes;
}

/**
 * Find the start of the enclosing node block (the `{` line).
 */
function findBlockStart(lines, widgetLineIndex) {
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
function findBlockEnd(lines, widgetLineIndex) {
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
function extractStringField(blockText, fieldName) {
  const regex = new RegExp(`(?:^|\\n)[\\t ]*${fieldName}\\s*=\\s*"([^"]*)"`, "m");
  const match = blockText.match(regex);
  return match ? match[1] : null;
}

/**
 * Extract a string array field from a Lua block.
 * Handles: field = { "str1", "str2", } and field = {}
 */
function extractStringArray(blockText, fieldName) {
  const regex = new RegExp(
    `${fieldName}\\s*=\\s*\\{([^}]*?)\\}`,
    "s",
  );
  const match = blockText.match(regex);
  if (!match) {
    return [];
  }

  const content = match[1];
  const items = [];
  const itemRegex = /"([^"]+)"/g;
  let itemMatch;

  while ((itemMatch = itemRegex.exec(content)) !== null) {
    items.push(itemMatch[1]);
  }

  return items;
}

export { parseLuaTree };
