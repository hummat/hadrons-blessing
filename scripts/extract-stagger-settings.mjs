/**
 * Extract global stagger settings from Darktide source.
 *
 * Reads scripts/settings/damage/stagger_settings.lua to produce
 * stagger-settings.json with default thresholds, stagger categories,
 * and other global constants used by the stagger calculator.
 *
 * Usage: node scripts/extract-stagger-settings.mjs
 *        npm run stagger:build
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateSourceSnapshot } from "./ground-truth/lib/validate.mjs";
import { runCliMain } from "./ground-truth/lib/cli.mjs";

const GENERATED_DIR = join(
  import.meta.dirname,
  "..",
  "data",
  "ground-truth",
  "generated",
);

/**
 * Stagger type names in the Lua enum order (1-indexed in Lua).
 */
const STAGGER_TYPE_NAMES = [
  "light", "medium", "heavy", "light_ranged", "sticky", "electrocuted",
  "killshot", "shield_block", "shield_heavy_block", "shield_broken",
  "explosion", "wall_collision", "blinding", "companion_push",
];

await runCliMain("stagger:build", async () => {
  const snapshot = validateSourceSnapshot();
  const sourceRoot = snapshot.source_root;
  const snapshotId = snapshot.id;

  const filePath = join(
    sourceRoot,
    "scripts",
    "settings",
    "damage",
    "stagger_settings.lua",
  );
  const luaSource = readFileSync(filePath, "utf8");

  // -- Parse stagger_types enum -------------------------------------------
  const staggerTypes = parseStaggerTypes(luaSource);

  // -- Parse default_stagger_thresholds -----------------------------------
  const defaultThresholds = parseStaggerTable(
    luaSource, "default_stagger_thresholds",
  );

  // -- Parse stagger_impact_comparison ------------------------------------
  const impactComparison = parseStaggerTable(
    luaSource, "stagger_impact_comparison",
  );

  // -- Parse stagger_categories -------------------------------------------
  const staggerCategories = parseStaggerCategories(luaSource);

  // -- Parse scalar constants ---------------------------------------------
  const scalars = parseScalarConstants(luaSource);

  // -- Assemble output ----------------------------------------------------
  const output = {
    stagger_types: staggerTypes,
    default_stagger_thresholds: defaultThresholds,
    stagger_impact_comparison: impactComparison,
    stagger_categories: staggerCategories,
    default_stagger_resistance: scalars.default_stagger_resistance,
    max_excessive_force: scalars.max_excessive_force,
    default_stagger_count_multiplier: scalars.default_stagger_count_multiplier,
    stagger_pool_decay_time: scalars.stagger_pool_decay_time,
    stagger_pool_decay_delay: scalars.stagger_pool_decay_delay,
    rending_stagger_strength_modifier: scalars.rending_stagger_strength_modifier,
    stagger_duration_scale: scalars.stagger_duration_scale,
    stagger_length_scale: scalars.stagger_length_scale,
    source_snapshot_id: snapshotId,
    generated_at: new Date().toISOString(),
  };

  writeFileSync(
    join(GENERATED_DIR, "stagger-settings.json"),
    JSON.stringify(output, null, 2) + "\n",
  );
  console.log("Wrote stagger-settings.json");
});

// -- Parsers ----------------------------------------------------------------

/**
 * Parse the stagger_types enum values.
 *
 * @param {string} luaSource
 * @returns {string[]}
 */
export function parseStaggerTypes(luaSource) {
  const match = luaSource.match(
    /table\.enum\(([^)]+)\)/,
  );
  if (!match) return STAGGER_TYPE_NAMES;

  const types = [];
  const strRe = /"(\w+)"/g;
  let m;
  while ((m = strRe.exec(match[1])) !== null) {
    types.push(m[1]);
  }
  return types;
}

/**
 * Parse a stagger-type-keyed table from stagger_settings.
 *
 * Matches patterns like:
 *   stagger_settings.table_name = {
 *     [stagger_types.light] = 1,
 *     ...
 *   }
 *
 * @param {string} luaSource
 * @param {string} tableName
 * @returns {object} { light: 1, medium: 10, ... }
 */
export function parseStaggerTable(luaSource, tableName) {
  const re = new RegExp(
    `stagger_settings\\.${tableName}\\s*=\\s*\\{([\\s\\S]*?)\\}`,
  );
  const match = luaSource.match(re);
  if (!match) return {};

  const result = {};
  const entryRe =
    /\[stagger_types\.(\w+)\]\s*=\s*(-?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = entryRe.exec(match[1])) !== null) {
    result[m[1]] = Number(m[2]);
  }
  return result;
}

/**
 * Parse stagger_categories from stagger_settings.
 *
 * Each category maps to a list of stagger type names (resolved from enum refs).
 *
 * @param {string} luaSource
 * @returns {object} { melee: ["light", "medium", "heavy"], ... }
 */
export function parseStaggerCategories(luaSource) {
  const blockMatch = luaSource.match(
    /stagger_settings\.stagger_categories\s*=\s*\{([\s\S]*?)\n\}/,
  );
  if (!blockMatch) return {};

  const result = {};
  // Match each category: name = { stagger_types.X, ... }
  const catRe = /(\w+)\s*=\s*\{([^}]*)\}/g;
  let cm;
  while ((cm = catRe.exec(blockMatch[1])) !== null) {
    const catName = cm[1];
    const body = cm[2];
    const types = [];
    const typeRe = /stagger_types\.(\w+)/g;
    let tm;
    while ((tm = typeRe.exec(body)) !== null) {
      types.push(tm[1]);
    }
    if (types.length > 0) {
      result[catName] = types;
    }
  }
  return result;
}

/**
 * Parse scalar constants from stagger_settings.
 *
 * @param {string} luaSource
 * @returns {object}
 */
export function parseScalarConstants(luaSource) {
  const result = {};
  const scalars = [
    "default_stagger_resistance",
    "max_excessive_force",
    "default_stagger_count_multiplier",
    "stagger_pool_decay_time",
    "stagger_pool_decay_delay",
    "rending_stagger_strength_modifier",
  ];

  for (const name of scalars) {
    const re = new RegExp(
      `stagger_settings\\.${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`,
    );
    const m = luaSource.match(re);
    if (m) result[name] = Number(m[1]);
  }

  // Parse array constants
  for (const name of ["stagger_duration_scale", "stagger_length_scale"]) {
    const re = new RegExp(
      `stagger_settings\\.${name}\\s*=\\s*\\{([^}]+)\\}`,
    );
    const m = luaSource.match(re);
    if (m) {
      result[name] = m[1].match(/-?\d+(?:\.\d+)?/g).map(Number);
    }
  }

  return result;
}
