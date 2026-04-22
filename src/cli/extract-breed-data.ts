/**
 * Pipeline entry point: extract breed data from Darktide Lua source files.
 *
 * Reads breed files and difficulty settings to produce a consolidated
 * breed-data.json used by the calculator for damage breakpoints.
 *
 * Usage: node scripts/extract-breed-data.mjs
 *        npm run breeds:build
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { validateSourceSnapshot } from "../lib/validate.js";
import { runCliMain } from "../lib/cli.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

const GENERATED_DIR = join(
  import.meta.dirname,
  "..",
  "..",
  "data",
  "ground-truth",
  "generated",
);

const DIFFICULTY_NAMES = ["uprising", "malice", "heresy", "damnation", "auric"];

/**
 * Challenge-level indices for each named difficulty (from DangerSettings).
 *
 * hit_mass arrays in the Lua source have 6 elements, indexed 1-6 in Lua.
 * The game resolves `get_table_entry_by_challenge(t)` -> `t[challenge]`.
 * Challenge values: uprising=2, malice=3, heresy=4, damnation=5, auric=5.
 *
 * We map to 0-based JS array indices (challenge - 1).
 */
const CHALLENGE_LEVELS = [1, 2, 3, 4, 4]; // 0-based indices for [uprising..auric]

const COMMUNITY_ARMOR_NAMES: Record<string, string> = {
  unarmored: "Unarmoured",
  armored: "Flak",
  resistant: "Infested",
  berserker: "Maniac",
  super_armor: "Carapace",
  disgustingly_resilient: "Unyielding",
};

/** Factions containing breed Lua files (enemies + companions). */
const BREED_FACTIONS = ["renegade", "cultist", "chaos", "companion"];

/**
 * Stagger type names in the order they appear in the Lua enum.
 * Used to map `stagger_types.X` references in breed files.
 */
const STAGGER_TYPE_NAMES = [
  "light", "medium", "heavy", "light_ranged", "sticky", "electrocuted",
  "killshot", "shield_block", "shield_heavy_block", "shield_broken",
  "explosion", "wall_collision", "blinding", "companion_push",
];

if (import.meta.main) {
  await runCliMain("breeds:build", async () => {
  const snapshot = validateSourceSnapshot();
  const sourceRoot = snapshot.source_root;
  const snapshotId = snapshot.id;

  // -- Phase 1: Parse health from minion_difficulty_settings.lua ----------------
  const healthMap = parseDifficultyHealth(sourceRoot);
  console.log(`Parsed health for ${healthMap.size} breeds`);

  // -- Phase 1b: Parse hit_mass from minion_difficulty_settings.lua -------------
  const hitMassMap = parseDifficultyHitMass(sourceRoot);
  console.log(`Parsed hit_mass for ${hitMassMap.size} breeds`);

  // -- Phase 2: Parse breed files -----------------------------------------------
  const breedFiles = collectBreedFiles(sourceRoot);
  console.log(`Found ${breedFiles.length} breed files`);

  const breeds = [];
  for (const filePath of breedFiles) {
    const luaSource = readFileSync(filePath, "utf8");
    let breed;
    try {
      breed = parseBreedFile(luaSource);
    } catch (err: unknown) {
      console.warn(`Warning: skipping ${filePath} — ${(err as Error).message}`);
      continue;
    }
    if (!breed) continue;

    // -- Phase 3: Attach difficulty health ------------------------------------
    const healthSteps = healthMap.get(breed.id);
    if (!healthSteps) {
      console.warn(`Warning: no health data for ${breed.id}, skipping`);
      continue;
    }
    const difficultyHealth: AnyRecord = {};
    for (let i = 0; i < DIFFICULTY_NAMES.length; i++) {
      difficultyHealth[DIFFICULTY_NAMES[i]] = healthSteps[i];
    }

    // -- Phase 4: Attach difficulty hit_mass -----------------------------------
    const hitMassSteps = hitMassMap.get(breed.id);
    let difficultyHitMass: AnyRecord | undefined;
    if (hitMassSteps) {
      difficultyHitMass = {} as AnyRecord;
      for (let i = 0; i < DIFFICULTY_NAMES.length; i++) {
        difficultyHitMass[DIFFICULTY_NAMES[i]] = hitMassSteps[i];
      }
    }

    // -- Phase 5: Assemble final record with stable field order ---------------
    const communityArmorName =
      COMMUNITY_ARMOR_NAMES[breed.base_armor_type] || breed.base_armor_type;

    const record: AnyRecord = {
      id: breed.id,
      display_name: breed.display_name,
      faction: breed.faction,
      base_armor_type: breed.base_armor_type,
      community_armor_name: communityArmorName,
      tags: breed.tags,
      difficulty_health: difficultyHealth,
      hit_zones: breed.hit_zones,
      stagger: breed.stagger,
    };
    if (difficultyHitMass) {
      record.hit_mass = difficultyHitMass;
    }

    breeds.push(record);
  }

  breeds.sort((a, b) => a.id.localeCompare(b.id));

  // -- Phase 6: Write breed-data.json -------------------------------------------
  const output = {
    breeds,
    source_snapshot_id: snapshotId,
    generated_at: new Date().toISOString(),
  };
  mkdirSync(GENERATED_DIR, { recursive: true });
  writeFileSync(
    join(GENERATED_DIR, "breed-data.json"),
    JSON.stringify(output, null, 2) + "\n",
  );
    console.log(`Wrote ${breeds.length} breeds to breed-data.json`);
  });
}

// -- Parsers ------------------------------------------------------------------

/**
 * Parse the health table from minion_difficulty_settings.lua.
 *
 * Resolves helper function calls like `_elite_health_steps(1000)` into
 * 5-element arrays, and also handles inline literal arrays.
 *
 * @param {string} sourceRoot
 * @returns {Map<string, number[]>} breedName -> [uprising, malice, heresy, damnation, auric]
 */
export function parseDifficultyHealth(sourceRoot: string) {
  const filePath = join(
    sourceRoot,
    "scripts",
    "settings",
    "difficulty",
    "minion_difficulty_settings.lua",
  );
  const luaSource = readFileSync(filePath, "utf8");

  // Extract helper function multiplier arrays
  const helperMultipliers = parseHealthHelpers(luaSource);

  // Extract the health table
  const healthMatch = luaSource.match(
    /minion_difficulty_settings\.health\s*=\s*\{([\s\S]*?)\n\}/,
  );
  if (!healthMatch) {
    throw new Error("Could not find minion_difficulty_settings.health table");
  }

  const healthBlock = healthMatch[1];
  const healthMap = new Map();

  // Match entries: breed_name = _helper(value) or breed_name = { ... }
  const entryRe =
    /(\w+)\s*=\s*(?:(_\w+)\((\d+(?:\.\d+)?)\)|(\{[\s\S]*?\}))\s*,/g;
  let match;
  while ((match = entryRe.exec(healthBlock)) !== null) {
    const breedName = match[1];

    if (match[2]) {
      // Helper function call: _helper(base)
      const helperName = match[2];
      const baseHealth = Number(match[3]);
      const multipliers = helperMultipliers.get(helperName);
      if (!multipliers) {
        console.warn(`Warning: unknown health helper ${helperName} for ${breedName}`);
        continue;
      }
      healthMap.set(
        breedName,
        multipliers.map((m: number) => Math.round(baseHealth * m)),
      );
    } else {
      // Inline literal array: { 850, 1000, 1250, ... }
      const arrayStr = match[4];
      const numbers = arrayStr.match(/-?\d+(?:\.\d+)?/g);
      if (numbers && numbers.length >= 5) {
        healthMap.set(
          breedName,
          numbers.slice(0, 5).map(Number),
        );
      }
    }
  }

  return healthMap;
}

/**
 * Parse the hit_mass table from minion_difficulty_settings.lua.
 *
 * hit_mass entries can be:
 * - Scalars: `breed_name = 20` (same across all difficulties)
 * - Arrays:  `breed_name = { 1.25, 1.25, 1.25, 1.5, 1.5, 1.5 }` (per challenge level, 6 elements)
 *
 * For arrays, we map challenge levels 2-5 to [uprising, malice, heresy, damnation, auric]
 * (auric shares challenge=5 with damnation).
 *
 * @param {string} sourceRoot
 * @returns {Map<string, number[]>} breedName -> [uprising, malice, heresy, damnation, auric]
 */
export function parseDifficultyHitMass(sourceRoot: string) {
  const filePath = join(
    sourceRoot,
    "scripts",
    "settings",
    "difficulty",
    "minion_difficulty_settings.lua",
  );
  const luaSource = readFileSync(filePath, "utf8");

  // Find the hit_mass table block
  const hitMassStart = luaSource.indexOf("minion_difficulty_settings.hit_mass = {");
  if (hitMassStart === -1) {
    throw new Error("Could not find minion_difficulty_settings.hit_mass table");
  }

  // Find balanced closing brace
  let depth = 0;
  let i = hitMassStart + "minion_difficulty_settings.hit_mass = ".length;
  for (; i < luaSource.length; i++) {
    if (luaSource[i] === "{") depth++;
    if (luaSource[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const hitMassBlock = luaSource.slice(hitMassStart, i + 1);

  return parseHitMassBlock(hitMassBlock);
}

/**
 * Parse a hit_mass table block into a Map of breed -> 5-element arrays.
 *
 * Handles both scalar values (`breed = 20`) and array values
 * (`breed = { 1.25, 1.25, 1.25, 1.5, 1.5, 1.5 }`).
 *
 * @param {string} block  The Lua source block for the hit_mass table
 * @returns {Map<string, number[]>} breedName -> [uprising, malice, heresy, damnation, auric]
 */
export function parseHitMassBlock(block: string) {
  const hitMassMap = new Map();

  // Match scalar entries at top indent level: \tbreed_name = 20,
  const scalarRe = /^\t(\w+)\s*=\s*(-?\d+(?:\.\d+)?)\s*,/gm;
  let match;
  while ((match = scalarRe.exec(block)) !== null) {
    const breedName = match[1];
    const value = Number(match[2]);
    // Scalar: same hit_mass at all difficulty levels
    hitMassMap.set(breedName, DIFFICULTY_NAMES.map(() => value));
  }

  // Match array entries at top indent level: \tbreed_name = { ... },
  const arrayRe = /^\t(\w+)\s*=\s*\{([\s\S]*?)\}/gm;
  while ((match = arrayRe.exec(block)) !== null) {
    const breedName = match[1];
    // Skip if already captured as scalar
    if (hitMassMap.has(breedName)) continue;

    const arrayBody = match[2];
    const numbers = arrayBody.match(/-?\d+(?:\.\d+)?/g);
    if (numbers && numbers.length >= 5) {
      const allValues = numbers.map(Number);
      // Map challenge levels (1-based Lua) to 0-based JS indices
      const mapped = CHALLENGE_LEVELS.map((idx) => allValues[idx]);
      hitMassMap.set(breedName, mapped);
    }
  }

  return hitMassMap;
}

/**
 * Parse health helper functions from the difficulty settings file.
 *
 * Each helper has the form:
 *   local function _helper(health)
 *     local health_steps = { health * M1, health * M2, ... }
 *     return health_steps
 *   end
 *
 * @param {string} luaSource
 * @returns {Map<string, number[]>} helperName -> multiplier array
 */
export function parseHealthHelpers(luaSource: string) {
  const helpers = new Map();

  const helperRe =
    /local function (_\w+_health_steps)\(health\)\s*local health_steps\s*=\s*\{([\s\S]*?)\}\s*return/g;
  let match;
  while ((match = helperRe.exec(luaSource)) !== null) {
    const name = match[1];
    const body = match[2];
    const multipliers = [];

    const mulRe = /health\s*\*\s*(-?\d+(?:\.\d+)?)/g;
    let m;
    while ((m = mulRe.exec(body)) !== null) {
      multipliers.push(Number(m[1]));
    }

    if (multipliers.length >= 5) {
      helpers.set(name, multipliers.slice(0, 5));
    }
  }

  return helpers;
}

/**
 * Collect all breed Lua files from the source root.
 *
 * @param {string} sourceRoot
 * @returns {string[]}
 */
export function collectBreedFiles(sourceRoot: string) {
  const breedsDir = join(sourceRoot, "scripts", "settings", "breed", "breeds");
  const files = [];

  for (const faction of BREED_FACTIONS) {
    const factionDir = join(breedsDir, faction);
    let entries;
    try {
      entries = readdirSync(factionDir);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`Warning: failed to read breed dir ${factionDir}: ${(err as Error).message}`);
      }
      continue;
    }
    for (const f of entries.filter((n) => n.endsWith("_breed.lua")).sort()) {
      files.push(join(factionDir, f));
    }
  }

  return files;
}

/**
 * Parse a single breed file into the output shape.
 *
 * Extracts: id, display_name, faction, base_armor_type, tags, hit_zones,
 * hitzone_armor_override, hitzone_damage_multiplier, hit_zone_weakspot_types.
 *
 * Returns null for breeds that lack essential fields (e.g. no armor_type).
 *
 * @param {string} luaSource
 * @returns {object|null}
 */
export function parseBreedFile(luaSource: string) {
  // Extract the breed_name local variable
  const breedNameMatch = luaSource.match(
    /local\s+breed_name\s*=\s*"(\w+)"/,
  );
  if (!breedNameMatch) return null;
  const localBreedName = breedNameMatch[1];

  // Check for `name = "literal"` override at the top level of breed_data.
  // Mutator breeds sometimes override the name (e.g. chaos_hound_mutator).
  // The top-level name field is at exactly one-tab indent after `local breed_data = {`.
  const nameOverrideMatch = luaSource.match(
    /^\tname\s*=\s*"(\w+)"\s*,/m,
  );
  let breedId = localBreedName;
  if (nameOverrideMatch && nameOverrideMatch[1] !== localBreedName) {
    breedId = nameOverrideMatch[1];
  }

  // Extract display_name
  const displayNameMatch = luaSource.match(
    /display_name\s*=\s*"([^"]+)"/,
  );
  const displayName = displayNameMatch
    ? displayNameMatch[1]
    : `loc_breed_display_name_${breedId}`;

  // Extract sub_faction_name (preferred) or infer from breed_name prefix
  const subFactionMatch = luaSource.match(
    /sub_faction_name\s*=\s*"(\w+)"/,
  );
  const faction = subFactionMatch
    ? subFactionMatch[1]
    : inferFaction(breedId);

  // Extract armor_type = armor_types.<type>
  const armorMatch = luaSource.match(
    /armor_type\s*=\s*armor_types\.(\w+)/,
  );
  if (!armorMatch) return null; // Skip breeds without armor (player breeds, companion_dog)
  const baseArmorType = armorMatch[1];

  // Extract tags
  const tags = parseTags(luaSource);

  // Extract hit_zones array
  const hitZoneNames = parseHitZoneNames(luaSource);
  if (hitZoneNames.length === 0) return null;

  // Extract hitzone_armor_override
  const armorOverrides = parseHitzoneArmorOverride(luaSource);

  // Extract hitzone_damage_multiplier
  const damageMultipliers = parseHitzoneDamageMultiplier(luaSource);

  // Extract hit_zone_weakspot_types
  const weakspotTypes = parseWeakspotTypes(luaSource);

  // Extract stagger data
  const staggerData = parseStaggerData(luaSource);

  // Build hit_zones object
  const hitZones: AnyRecord = {};
  for (const zoneName of hitZoneNames) {
    const armorType = armorOverrides.get(zoneName) || baseArmorType;
    const isWeakspot = weakspotTypes.has(zoneName);

    // Damage multipliers: merge ranged, melee, and default
    const rangedMult = damageMultipliers.ranged.get(zoneName)
      ?? damageMultipliers.default.get(zoneName)
      ?? 1.0;
    const meleeMult = damageMultipliers.melee.get(zoneName)
      ?? damageMultipliers.default.get(zoneName)
      ?? 1.0;

    hitZones[zoneName] = {
      armor_type: armorType,
      weakspot: isWeakspot,
      damage_multiplier: {
        ranged: rangedMult,
        melee: meleeMult,
      },
    };
  }

  return {
    id: breedId,
    display_name: displayName,
    faction,
    base_armor_type: baseArmorType,
    tags,
    hit_zones: hitZones,
    stagger: staggerData,
  };
}

/**
 * Parse stagger-related data from a breed file.
 *
 * Extracts:
 * - stagger_resistance (scalar, default 1)
 * - stagger_reduction (scalar, if present)
 * - stagger_reduction_ranged (scalar, if present)
 * - ignore_stagger_accumulation (boolean, if true)
 * - stagger_thresholds (per stagger type)
 * - stagger_durations (per stagger type)
 * - stagger_immune_times (per stagger type)
 *
 * @param {string} luaSource
 * @returns {object} stagger data object
 */
export function parseStaggerData(luaSource: string) {
  const result: AnyRecord = {};

  // Extract scalar fields
  const resistanceMatch = luaSource.match(
    /\bstagger_resistance\s*=\s*(-?\d+(?:\.\d+)?)/,
  );
  result.stagger_resistance = resistanceMatch ? Number(resistanceMatch[1]) : 1;

  const reductionMatch = luaSource.match(
    /\bstagger_reduction\s*=\s*(-?\d+(?:\.\d+)?)/,
  );
  if (reductionMatch) {
    result.stagger_reduction = Number(reductionMatch[1]);
  }

  const reductionRangedMatch = luaSource.match(
    /\bstagger_reduction_ranged\s*=\s*(-?\d+(?:\.\d+)?)/,
  );
  if (reductionRangedMatch) {
    result.stagger_reduction_ranged = Number(reductionRangedMatch[1]);
  }

  if (/\bignore_stagger_accumulation\s*=\s*true/.test(luaSource)) {
    result.ignore_stagger_accumulation = true;
  }

  // Extract per-stagger-type tables
  const thresholds = parseStaggerTypeTable(luaSource, "stagger_thresholds");
  if (thresholds) result.stagger_thresholds = thresholds;

  const durations = parseStaggerTypeTable(luaSource, "stagger_durations");
  if (durations) result.stagger_durations = durations;

  const immuneTimes = parseStaggerTypeTable(luaSource, "stagger_immune_times");
  if (immuneTimes) result.stagger_immune_times = immuneTimes;

  return result;
}

/**
 * Parse a table of stagger-type-keyed values from a breed file.
 *
 * Matches patterns like:
 *   stagger_thresholds = {
 *     [stagger_types.light] = 1,
 *     [stagger_types.medium] = 10,
 *   }
 *
 * @param {string} luaSource
 * @param {string} tableName  e.g. "stagger_thresholds"
 * @returns {object|null} { light: 1, medium: 10, ... } or null if not found
 */
export function parseStaggerTypeTable(luaSource: string, tableName: string) {
  // Find the start of the table
  const tableStart = luaSource.indexOf(`${tableName} = {`);
  if (tableStart === -1) return null;

  // Find the balanced closing brace
  let depth = 0;
  let i = tableStart + `${tableName} = `.length;
  for (; i < luaSource.length; i++) {
    if (luaSource[i] === "{") depth++;
    if (luaSource[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const block = luaSource.slice(tableStart, i + 1);

  const result: Record<string, number> = {};
  const entryRe =
    /\[stagger_types\.(\w+)\]\s*=\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/g;
  let m;
  while ((m = entryRe.exec(block)) !== null) {
    const typeName = m[1];
    if (STAGGER_TYPE_NAMES.includes(typeName)) {
      result[typeName] = Number(m[2]);
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Parse the tags table from a breed file.
 * Tags are structured as `tags = { elite = true, melee = true, ... }`.
 *
 * @param {string} luaSource
 * @returns {string[]}
 */
export function parseTags(luaSource: string) {
  const tagsMatch = luaSource.match(/\btags\s*=\s*\{([\s\S]*?)\}/);
  if (!tagsMatch) return [];

  const tags = [];
  const tagRe = /(\w+)\s*=\s*true/g;
  let m;
  while ((m = tagRe.exec(tagsMatch[1])) !== null) {
    tags.push(m[1]);
  }
  return tags.sort();
}

/**
 * Extract hit zone names from the hit_zones array.
 * Matches patterns like: `name = hit_zone_names.head`
 *
 * @param {string} luaSource
 * @returns {string[]}
 */
export function parseHitZoneNames(luaSource: string) {
  // Find the hit_zones array block
  const hzStart = luaSource.indexOf("hit_zones = {");
  if (hzStart === -1) return [];

  // Find the balanced closing brace
  let depth = 0;
  let i = hzStart + "hit_zones = ".length;
  for (; i < luaSource.length; i++) {
    if (luaSource[i] === "{") depth++;
    if (luaSource[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const block = luaSource.slice(hzStart, i + 1);

  const names: string[] = [];
  const nameRe = /name\s*=\s*hit_zone_names\.(\w+)/g;
  let m;
  while ((m = nameRe.exec(block)) !== null) {
    if (!names.includes(m[1])) {
      names.push(m[1]);
    }
  }
  return names;
}

/**
 * Parse hitzone_armor_override from a breed file.
 *
 * @param {string} luaSource
 * @returns {Map<string, string>} zoneName -> armorType
 */
export function parseHitzoneArmorOverride(luaSource: string) {
  const overrides = new Map();
  const blockMatch = luaSource.match(
    /hitzone_armor_override\s*=\s*\{([\s\S]*?)\}/,
  );
  if (!blockMatch) return overrides;

  const entryRe =
    /\[hit_zone_names\.(\w+)\]\s*=\s*armor_types\.(\w+)/g;
  let m;
  while ((m = entryRe.exec(blockMatch[1])) !== null) {
    overrides.set(m[1], m[2]);
  }
  return overrides;
}

/**
 * Parse hitzone_damage_multiplier from a breed file.
 *
 * The structure can have `ranged`, `melee`, and `default` sub-tables.
 *
 * @param {string} luaSource
 * @returns {{ ranged: Map<string, number>, melee: Map<string, number>, default: Map<string, number> }}
 */
export function parseHitzoneDamageMultiplier(luaSource: string) {
  const result = {
    ranged: new Map<string, number>(),
    melee: new Map<string, number>(),
    default: new Map<string, number>(),
  };

  const blockStart = luaSource.indexOf("hitzone_damage_multiplier = {");
  if (blockStart === -1) return result;

  // Find balanced closing brace for the outer block
  let depth = 0;
  let i = blockStart + "hitzone_damage_multiplier = ".length;
  for (; i < luaSource.length; i++) {
    if (luaSource[i] === "{") depth++;
    if (luaSource[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const block = luaSource.slice(blockStart, i + 1);

  // Parse sub-tables: ranged = { ... }, melee = { ... }, default = { ... }
  for (const category of ["ranged", "melee", "default"]) {
    const subMatch = block.match(
      new RegExp(`${category}\\s*=\\s*\\{([\\s\\S]*?)\\}`, ""),
    );
    if (!subMatch) continue;

    const entryRe =
      /\[hit_zone_names\.(\w+)\]\s*=\s*(-?\d+(?:\.\d+)?)/g;
    let m;
    while ((m = entryRe.exec(subMatch[1])) !== null) {
      result[category as keyof typeof result].set(m[1], Number(m[2]));
    }
  }

  return result;
}

/**
 * Parse hit_zone_weakspot_types from a breed file.
 *
 * @param {string} luaSource
 * @returns {Set<string>} set of zone names that are weakspots
 */
export function parseWeakspotTypes(luaSource: string) {
  const weakspots = new Set();
  const blockMatch = luaSource.match(
    /hit_zone_weakspot_types\s*=\s*\{([\s\S]*?)\}/,
  );
  if (!blockMatch) return weakspots;

  const entryRe =
    /\[hit_zone_names\.(\w+)\]\s*=\s*weakspot_types\.(\w+)/g;
  let m;
  while ((m = entryRe.exec(blockMatch[1])) !== null) {
    weakspots.add(m[1]);
  }
  return weakspots;
}

/**
 * Infer faction from breed ID prefix when sub_faction_name is missing.
 *
 * @param {string} breedId
 * @returns {string}
 */
function inferFaction(breedId: string) {
  if (breedId.startsWith("renegade_")) return "renegade";
  if (breedId.startsWith("cultist_")) return "cultist";
  if (breedId.startsWith("chaos_")) return "chaos";
  if (breedId.startsWith("companion_")) return "companion";
  return "unknown";
}
