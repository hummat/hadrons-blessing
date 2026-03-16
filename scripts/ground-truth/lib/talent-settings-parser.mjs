/**
 * Parses TalentSettings Lua files into flat dotted-path → number maps.
 *
 * TalentSettings files are pure nested Lua data tables containing numeric
 * constants that buff templates reference for magnitudes. No functions,
 * no enums, no table.clone — just nested tables of numbers.
 *
 * Exports:
 *   parseTalentSettings(luaSource) → Map<string, number>
 *   loadAllTalentSettings(sourceRoot) → Map<string, number>
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseLuaTable } from "./lua-data-reader.mjs";

/**
 * Parse a TalentSettings Lua file into a flat Map of dotted paths to numbers.
 *
 * Extracts the top-level `local talent_settings = { ... }` table, parses it
 * with `parseLuaTable`, then recursively walks the result collecting only
 * numeric leaf values.
 *
 * @param {string} luaSource - Full Lua source text of a talent_settings file
 * @returns {Map<string, number>} Dotted path → numeric value
 */
export function parseTalentSettings(luaSource) {
  const tableBody = extractTopLevelTable(luaSource);
  const parsed = parseLuaTable(tableBody);
  const map = new Map();
  walk(parsed, [], map);
  return map;
}

/**
 * Load and merge all talent_settings_*.lua files from a source root.
 *
 * @param {string} sourceRoot - Path to the Darktide source checkout
 * @returns {Promise<Map<string, number>>} Merged dotted path → numeric value
 */
export async function loadAllTalentSettings(sourceRoot) {
  const dir = join(sourceRoot, "scripts", "settings", "talent");
  const entries = await readdir(dir);
  const files = entries
    .filter((f) => f.startsWith("talent_settings_") && f.endsWith(".lua"))
    .sort();

  const merged = new Map();

  for (const file of files) {
    const src = await readFile(join(dir, file), "utf-8");
    const map = parseTalentSettings(src);
    for (const [k, v] of map) {
      merged.set(k, v);
    }
  }

  return merged;
}

// -- Internal helpers ---------------------------------------------------------

/**
 * Extract the table literal body from `local talent_settings = { ... }`.
 *
 * Finds the opening `{` after the assignment and collects everything through
 * the matching closing `}`, respecting brace nesting.
 *
 * @param {string} src - Full Lua source
 * @returns {string} The table literal including outer braces
 */
function extractTopLevelTable(src) {
  const marker = "local talent_settings";
  const idx = src.indexOf(marker);
  if (idx === -1) {
    throw new Error("No `local talent_settings = { ... }` found in source");
  }

  // Find the opening brace
  const braceStart = src.indexOf("{", idx + marker.length);
  if (braceStart === -1) {
    throw new Error("No opening brace found after talent_settings assignment");
  }

  // Walk forward collecting balanced braces
  let depth = 0;
  let i = braceStart;
  while (i < src.length) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        return src.slice(braceStart, i + 1);
      }
    }
    i++;
  }

  throw new Error("Unbalanced braces in talent_settings table");
}

/**
 * Recursively walk a parsed Lua object, collecting numeric leaves into a
 * dotted-path map. Skips non-numeric leaves (strings, booleans, null,
 * sentinel nodes like $ref/$func/$expr/$call) and arrays.
 *
 * @param {*} obj - Parsed value from parseLuaTable
 * @param {string[]} path - Current dotted path segments
 * @param {Map<string, number>} map - Accumulator
 */
function walk(obj, path, map) {
  if (obj === null || obj === undefined) return;
  if (typeof obj === "number") {
    map.set(path.join("."), obj);
    return;
  }
  if (typeof obj !== "object") return; // strings, booleans
  if (Array.isArray(obj)) return; // positional arrays (e.g. interval = {0.3, 0.8})

  // Skip sentinel nodes from lua-data-reader ($ref, $func, $expr, $call)
  if ("$ref" in obj || "$func" in obj || "$expr" in obj || "$call" in obj) return;

  for (const [key, value] of Object.entries(obj)) {
    walk(value, [...path, key], map);
  }
}
