/**
 * Pipeline entry point: extract damage profiles from Darktide Lua source files.
 *
 * Reads damage profile templates, weapon templates, and hitscan templates to
 * produce a consolidated damage-profiles.json used by the calculator engine.
 *
 * Usage: node scripts/extract-damage-profiles.mjs
 *        npm run profiles:build
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
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

/**
 * Weapon template families and their directory names.
 * These are all subdirectories under scripts/settings/equipment/weapon_templates/
 * that contain weapon definition .lua files (not settings_templates, not utility files).
 */
const WEAPON_FAMILIES = [
  "autoguns",
  "autopistols",
  "bolters",
  "bolt_pistols",
  "chain_axes",
  "chain_swords",
  "chain_swords_2h",
  "combat_axes",
  "combat_blades",
  "combat_knives",
  "combat_swords",
  "crowbars",
  "dual_autopistols",
  "dual_shivs",
  "dual_stub_pistols",
  "flamers",
  "force_staffs",
  "force_swords",
  "force_swords_2h",
  "grenadier_gauntlets",
  "lasguns",
  "laspistols",
  "luggables",
  "needlepistols",
  "ogryn_clubs",
  "ogryn_heavystubbers",
  "ogryn_pickaxes_2h",
  "ogryn_power_mauls",
  "ogryn_powermaul_slabshield",
  "plasma_rifles",
  "power_mauls",
  "power_mauls_2h",
  "power_maul_shields",
  "power_swords",
  "power_swords_2h",
  "ripperguns",
  "saws",
  "shotguns",
  "shotpistol_shield",
  "stub_pistols",
  "thumpers",
  "thunder_hammers_2h",
];

await runCliMain("profiles:build", async () => {
  const snapshot = validateSourceSnapshot();
  const sourceRoot = snapshot.source_root;
  const snapshotId = snapshot.id;

  // -- Phase 1: Parse lerp lookup table from damage_profile_settings.lua ------
  const { lerpValues, cleavePresets } = parseLerpValues(sourceRoot);
  console.log(`Parsed ${Object.keys(lerpValues).length} lerp values, ${Object.keys(cleavePresets).length} cleave presets`);

  // -- Phase 2: Parse pipeline constants from power_level_settings + armor_settings
  const constants = parseConstants(sourceRoot);
  console.log(`Parsed pipeline constants`);

  // -- Phase 2b: Parse preset ADM variables from damage_profile_settings.lua --
  const presetAdmVars = parsePresetAdmVariables(sourceRoot, lerpValues);
  console.log(`Parsed ${presetAdmVars.size} preset ADM variables`);

  // -- Phase 3: Parse all damage profile template files -----------------------
  const profiles = parseAllDamageProfiles(sourceRoot, lerpValues, cleavePresets, presetAdmVars);
  profiles.sort((a, b) => a.id.localeCompare(b.id));
  console.log(`Parsed ${profiles.length} damage profiles`);

  // -- Phase 4: Parse projectile templates for ranged profile resolution ------
  const hitscanMap = parseAllHitscanTemplates(sourceRoot);
  const shotshellMap = parseAllShotshellTemplates(sourceRoot);
  const flamerGasMap = parseAllFlamerGasTemplates(sourceRoot);
  const projectileMap = parseAllProjectileTemplates(sourceRoot);
  console.log(`Parsed ${hitscanMap.size} hitscan templates`);
  console.log(`Parsed ${shotshellMap.size} shotshell templates`);
  console.log(`Parsed ${flamerGasMap.size} flamer gas templates`);
  console.log(`Parsed ${projectileMap.size} projectile templates`);

  // -- Phase 5: Parse weapon templates for action -> profile mapping -----------
  const profileIds = new Set(profiles.map((p) => p.id));
  const actionMaps = parseAllWeaponTemplates(
    sourceRoot,
    hitscanMap,
    shotshellMap,
    flamerGasMap,
    projectileMap,
    profileIds,
  );
  actionMaps.sort((a, b) => a.weapon_template.localeCompare(b.weapon_template));
  console.log(`Parsed ${actionMaps.length} weapon action maps`);

  // -- Phase 6: Write damage-profiles.json ------------------------------------
  const output = {
    profiles,
    action_maps: actionMaps,
    constants,
    source_snapshot_id: snapshotId,
    generated_at: new Date().toISOString(),
  };
  mkdirSync(GENERATED_DIR, { recursive: true });
  writeFileSync(
    join(GENERATED_DIR, "damage-profiles.json"),
    JSON.stringify(output, null, 2) + "\n",
  );
  console.log(`Wrote damage-profiles.json`);
});

// -- Phase 1: Lerp values ----------------------------------------------------

/**
 * Parse lerp values and cleave presets from damage_profile_settings.lua.
 *
 * @param {string} sourceRoot
 * @returns {{ lerpValues: Record<string, [number, number]>, cleavePresets: Record<string, object> }}
 */
function parseLerpValues(sourceRoot: string) {
  const filePath = join(
    sourceRoot,
    "scripts",
    "settings",
    "damage",
    "damage_profile_settings.lua",
  );
  const lua = readFileSync(filePath, "utf8");

  // Parse damage_lerp_values block
  const lerpBlockMatch = lua.match(
    /damage_lerp_values\s*=\s*\{([\s\S]*?)\n\}/,
  );
  if (!lerpBlockMatch) {
    throw new Error("Could not find damage_lerp_values in damage_profile_settings.lua");
  }

  const lerpValues: AnyRecord = {};
  // Match entries like: lerp_1 = { 0.67, 1.33, }
  const lerpRe = /(\w+)\s*=\s*\{\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,?\s*\}/g;
  let m;
  while ((m = lerpRe.exec(lerpBlockMatch[1])) !== null) {
    lerpValues[m[1]] = [Number(m[2]), Number(m[3])];
  }

  // Parse cleave presets: no_cleave, single_cleave, single_plus_cleave, double_cleave, etc.
  const cleavePresets: AnyRecord = {};
  const cleaveNames = [
    "no_cleave",
    "single_cleave",
    "single_plus_cleave",
    "double_cleave",
    "light_cleave",
    "medium_cleave",
    "large_cleave",
    "big_cleave",
    "fold_cleave",
  ];
  for (const name of cleaveNames) {
    const cleaveRe = new RegExp(
      `damage_profile_settings\\.${name}\\s*=\\s*\\{`,
    );
    const cleaveMatch = lua.match(cleaveRe);
    if (cleaveMatch) {
      const braceIdx = cleaveMatch.index! + cleaveMatch[0].length - 1;
      const endIdx = findBalancedBrace(lua, braceIdx);
      if (endIdx === -1) continue;
      const block = lua.slice(braceIdx, endIdx + 1);
      const attackMatch = block.match(
        /attack\s*=\s*\{\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
      );
      const impactMatch = block.match(
        /impact\s*=\s*\{\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
      );
      if (attackMatch && impactMatch) {
        cleavePresets[name] = {
          attack: [Number(attackMatch[1]), Number(attackMatch[2])],
          impact: [Number(impactMatch[1]), Number(impactMatch[2])],
        };
      }
    }
  }

  return { lerpValues, cleavePresets };
}

// -- Phase 2: Constants -------------------------------------------------------

/**
 * Parse pipeline constants from power_level_settings.lua and armor_settings.lua.
 *
 * @param {string} sourceRoot
 * @returns {object}
 */
export function parseConstants(sourceRoot: string) {
  const plsPath = join(sourceRoot, "scripts", "settings", "damage", "power_level_settings.lua");
  const plsLua = readFileSync(plsPath, "utf8");

  const asPath = join(sourceRoot, "scripts", "settings", "damage", "armor_settings.lua");
  const asLua = readFileSync(asPath, "utf8");

  // default_power_level
  const defaultPl = extractNumber(plsLua, /default_power_level\s*=\s*(\d+)/, { critical: true });

  // damage_output: all armor types have {min: 0, max: 20}
  const damageOutput = parseArmorTypeTable(plsLua, "damage_output", (block: string) => {
    const minMatch = block.match(/min\s*=\s*(\d+)/);
    const maxMatch = block.match(/max\s*=\s*(\d+)/);
    return { min: Number(minMatch?.[1] ?? 0), max: Number(maxMatch?.[1] ?? 20) };
  });

  // boost_curves
  const boostCurveMatch = plsLua.match(
    /boost_curves\s*=\s*\{\s*default\s*=\s*\{([\s\S]*?)\}/,
  );
  const boostCurves = {
    default: boostCurveMatch
      ? boostCurveMatch[1].match(/-?\d+(?:\.\d+)?/g)!.map(Number)
      : [0, 0.3, 0.6, 0.8, 1],
  };

  // default_finesse_boost_amount
  const defaultFinesseBoost = parseSimpleArmorTypeMap(plsLua, "default_finesse_boost_amount");

  // ninjafencer_finesse_boost_amount
  const ninjafencerFinesseBoost = parseSimpleArmorTypeMap(plsLua, "ninjafencer_finesse_boost_amount");

  // smiter_finesse_boost_amount
  const smiterFinesseBoost = parseSimpleArmorTypeMap(plsLua, "smiter_finesse_boost_amount");

  // default_finesse_boost_no_base_damage_amount
  const defaultFinesseNoBaseDamage = parseSimpleArmorTypeMap(plsLua, "default_finesse_boost_no_base_damage_amount");

  // default_crit_boost_amount
  const defaultCritBoost = extractNumber(plsLua, /default_crit_boost_amount\s*=\s*(-?\d+(?:\.\d+)?)/, { critical: true });

  // default_boost_curve_multiplier
  const defaultBoostCurveMult = extractNumber(plsLua, /default_boost_curve_multiplier\s*=\s*(-?\d+(?:\.\d+)?)/, { critical: true });

  // rending_boost_amount
  const rendingBoostAmount = parseSimpleArmorTypeMap(plsLua, "rending_boost_amount");

  // boost_damage_armor_conversion
  const boostConversion = parseArmorConversionMap(plsLua);

  // default_armor_damage_modifier
  const defaultAdm = parseDefaultArmorDamageModifier(plsLua);

  // finesse_min_damage_multiplier
  const finesseMinDamageMult = extractNumber(plsLua, /finesse_min_damage_multiplier\s*=\s*(-?\d+(?:\.\d+)?)/, { critical: true });

  // From armor_settings
  const overdamageRendingMult = parseSimpleArmorTypeMapFromLocal(asLua, "overdamage_rending_multiplier");
  const rendingArmorTypeMult = parseSimpleArmorTypeMapFromLocal(asLua, "rending_armor_type_multiplier");

  // Validate critical constant tables are non-empty
  const ALL_ARMOR_TYPES = ["unarmored", "armored", "resistant", "berserker", "super_armor", "disgustingly_resilient"];
  // Rending tables only contain the 4 types where rending applies (not unarmored/DR)
  const RENDING_ARMOR_TYPES = ["armored", "resistant", "berserker", "super_armor"];
  const validationTargets = [
    ["damage_output", damageOutput, ALL_ARMOR_TYPES],
    ["overdamage_rending_multiplier", overdamageRendingMult, RENDING_ARMOR_TYPES],
    ["rending_armor_type_multiplier", rendingArmorTypeMult, RENDING_ARMOR_TYPES],
  ];
  for (const [tableName, table, expectedTypes] of validationTargets) {
    const missing = (expectedTypes as string[]).filter((at) => !(at in (table as object)));
    if (missing.length > 0) {
      throw new Error(`Critical constant table '${tableName}' missing armor types: ${missing.join(", ")}`);
    }
  }

  return {
    damage_output: damageOutput,
    default_power_level: defaultPl,
    boost_curves: boostCurves,
    default_finesse_boost_amount: defaultFinesseBoost,
    ninjafencer_finesse_boost_amount: ninjafencerFinesseBoost,
    smiter_finesse_boost_amount: smiterFinesseBoost,
    default_finesse_boost_no_base_damage_amount: defaultFinesseNoBaseDamage,
    default_crit_boost_amount: defaultCritBoost,
    default_boost_curve_multiplier: defaultBoostCurveMult,
    finesse_min_damage_multiplier: finesseMinDamageMult,
    rending_boost_amount: rendingBoostAmount,
    boost_damage_armor_conversion: boostConversion,
    default_armor_damage_modifier: defaultAdm,
    overdamage_rending_multiplier: overdamageRendingMult,
    rending_armor_type_multiplier: rendingArmorTypeMult,
  };
}

// -- Phase 3: Damage profiles ------------------------------------------------

/**
 * Parse all damage profile template files from both shared and per-weapon locations.
 *
 * @param {string} sourceRoot
 * @param {Record<string, [number, number]>} lerpValues
 * @param {Record<string, object>} cleavePresets
 * @param {Map<string, object>} presetAdmVars
 * @returns {object[]}
 */
function parseAllDamageProfiles(sourceRoot: string, lerpValues: AnyRecord, cleavePresets: AnyRecord, presetAdmVars: AnyRecord) {
  const profiles = [];
  const seenIds = new Set();

  // Shared/archetype damage profile files
  const sharedDir = join(sourceRoot, "scripts", "settings", "damage", "damage_profiles");
  const sharedFiles = collectDamageProfileFiles(sharedDir);

  // Per-weapon damage profile files
  const weaponBaseDir = join(sourceRoot, "scripts", "settings", "equipment", "weapon_templates");
  const weaponFiles = [];
  for (const family of WEAPON_FAMILIES) {
    const settingsDir = join(weaponBaseDir, family, "settings_templates");
    if (!existsSync(settingsDir)) continue;
    try {
      const files = readdirSync(settingsDir)
        .filter((f) => f.endsWith("_damage_profile_templates.lua"))
        .sort();
      for (const f of files) {
        weaponFiles.push(join(settingsDir, f));
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`Warning: failed to read ${settingsDir}: ${(err as Error).message}`);
      }
    }
  }

  const allFiles = [...sharedFiles, ...weaponFiles];

  for (const filePath of allFiles) {
    const lua = readFileSync(filePath, "utf8");
    const sourceFile = basename(filePath);
    const fileProfiles = parseDamageProfileFile(lua, sourceFile, lerpValues, cleavePresets, presetAdmVars);
    for (const p of fileProfiles) {
      if (!seenIds.has(p.id)) {
        seenIds.add(p.id);
        profiles.push(p);
      }
    }
  }

  return profiles;
}

/**
 * Collect damage profile .lua files recursively from a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function collectDamageProfileFiles(dir: string): string[] {
  const files: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectDamageProfileFiles(fullPath));
    } else if (entry.name.endsWith("_damage_profile_templates.lua")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

/**
 * Parse a single damage profile template file.
 *
 * Extracts all `damage_templates.X = { ... }` definitions and
 * `damage_templates.X = table.clone(damage_templates.Y)` clones.
 *
 * @param {string} lua
 * @param {string} sourceFile
 * @param {Record<string, [number, number]>} lerpValues
 * @param {Record<string, object>} cleavePresets
 * @param {Map<string, object>} presetAdmVars
 * @returns {object[]}
 */
function parseDamageProfileFile(lua: string, sourceFile: string, lerpValues: AnyRecord, cleavePresets: AnyRecord, presetAdmVars: AnyRecord = new Map()) {
  const profiles = [];
  const profileMap = new Map(); // id -> profile for clone lookups

  // Parse file-level local variables that define ADM structures
  const localAdmVars = parseLocalAdmVariables(lua, lerpValues);

  // Merge preset ADM vars as fallback: local aliases like
  // `local flat_one_armor_mod = DamageProfileSettings.flat_one_armor_mod`
  // resolve via the local name in localAdmVars already if they define inline tables.
  // For aliases that reference DamageProfileSettings.X, parse them here.
  const localAliasRe = /^local\s+(\w+)\s*=\s*DamageProfileSettings\.(\w+)/gm;
  let aliasMatch;
  while ((aliasMatch = localAliasRe.exec(lua)) !== null) {
    const localName = aliasMatch[1];
    const presetName = aliasMatch[2];
    if (!localAdmVars.has(localName) && presetAdmVars.has(presetName)) {
      localAdmVars.set(localName, presetAdmVars.get(presetName));
    }
  }

  // Find all top-level damage_templates.X = { assignments
  // Use a state machine to find balanced braces
  const templateRe = /^damage_templates\.(\w+)\s*=\s*\{/gm;
  let match;
  while ((match = templateRe.exec(lua)) !== null) {
    const profileName = match[1];
    const startIdx = match.index + match[0].length - 1; // points to the opening {

    // Find balanced closing brace
    const blockEnd = findBalancedBrace(lua, startIdx);
    if (blockEnd === -1) continue;

    const block = lua.slice(startIdx, blockEnd + 1);

    try {
      const profile = parseProfileBlock(profileName, block, sourceFile, lerpValues, cleavePresets, localAdmVars);
      if (profile) {
        profiles.push(profile);
        profileMap.set(profileName, profile);
      }
    } catch (err: unknown) {
      // Re-throw code bugs (TypeError, RangeError) — only catch Lua parse failures
      if (err instanceof RangeError || (err instanceof TypeError && !(err as Error).message.includes("Cannot read"))) {
        throw err;
      }
      console.warn(`Warning: failed to parse profile ${profileName} in ${sourceFile}: ${(err as Error).message}`);
    }
  }

  // Second pass: handle table.clone(damage_templates.Y) definitions
  const cloneRe = /^damage_templates\.(\w+)\s*=\s*table\.clone\(damage_templates\.(\w+)\)/gm;
  let cloneMatch;
  while ((cloneMatch = cloneRe.exec(lua)) !== null) {
    const cloneName = cloneMatch[1];
    const parentName = cloneMatch[2];
    if (profileMap.has(cloneName)) continue; // already parsed as a block definition

    const parent = profileMap.get(parentName);
    if (!parent) continue;

    // Deep clone the parent
    const cloned = JSON.parse(JSON.stringify(parent));
    cloned.id = cloneName;
    cloned.source_file = sourceFile;

    // Apply subsequent field overrides: damage_templates.X.field = value
    applyCloneOverrides(cloned, cloneName, lua, lerpValues);

    profiles.push(cloned);
    profileMap.set(cloneName, cloned);
  }

  // Third pass: handle override-only damage profiles.
  const overrideRe = /^overrides\.(\w+)\s*=\s*\{/gm;
  let overrideMatch;
  while ((overrideMatch = overrideRe.exec(lua)) !== null) {
    const overrideName = overrideMatch[1];
    if (profileMap.has(overrideName)) continue;

    const blockStart = overrideMatch.index + overrideMatch[0].length - 1;
    const blockEnd = findBalancedBrace(lua, blockStart);
    if (blockEnd === -1) continue;

    const block = lua.slice(blockStart, blockEnd + 1);
    const parentMatch = block.match(/parent_template_name\s*=\s*"(\w+)"/);
    if (!parentMatch) continue;

    const parent = profileMap.get(parentMatch[1]);
    if (!parent) continue;

    const cloned = JSON.parse(JSON.stringify(parent));
    cloned.id = overrideName;
    cloned.source_file = sourceFile;
    applyProfileOverrideBlock(cloned, block, lerpValues);

    profiles.push(cloned);
    profileMap.set(overrideName, cloned);
  }

  return profiles;
}

/**
 * Apply field overrides to a cloned profile.
 * Matches patterns like:
 *   damage_templates.X.field = value
 *   damage_templates.X.targets[1].power_distribution.attack = 380
 *   damage_templates.X.power_distribution.attack = 0.175
 *
 * @param {object} profile - The cloned profile to mutate
 * @param {string} name - Profile name
 * @param {string} lua - Full file source
 * @param {Record<string, [number, number]>} lerpValues
 */
export function applyCloneOverrides(profile: AnyRecord, name: string, lua: string, lerpValues: AnyRecord) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const overrideRe = new RegExp(
    `^damage_templates\\.${escapedName}\\.([\\w.\\[\\]]+)\\s*=\\s*(.+)`,
    "gm",
  );
  let m;
  while ((m = overrideRe.exec(lua)) !== null) {
    const path = m[1].trim();
    const valueStr = m[2].trim().replace(/,\s*$/, "");

    // Handle simple scalar overrides on direct profile fields
    if (path === "ragdoll_push_force" || path === "suppression_value") {
      // Skip non-calculation fields
      continue;
    }

    // Handle power_distribution.attack / power_distribution.impact
    if (path === "power_distribution.attack" || path === "power_distribution.impact") {
      const channel = path.split(".")[1];
      const num = Number(valueStr);
      if (!isNaN(num) && profile.power_distribution) {
        profile.power_distribution[channel] = num;
      }
      continue;
    }

    // Handle cleave_distribution.attack / cleave_distribution.impact
    if (path === "cleave_distribution.attack" || path === "cleave_distribution.impact") {
      const channel = path.split(".")[1];
      const num = Number(valueStr);
      if (!isNaN(num) && profile.cleave_distribution) {
        profile.cleave_distribution[channel] = num;
      }
      continue;
    }

    // Handle damage_type override
    if (path === "damage_type") {
      const dtMatch = valueStr.match(/damage_types\.(\w+)/);
      if (dtMatch) profile.damage_type = dtMatch[1];
      continue;
    }

    // Handle stagger_category override
    if (path === "stagger_category") {
      const scMatch = valueStr.match(/"(\w+)"/);
      if (scMatch) profile.stagger_category = scMatch[1];
      continue;
    }

    // Handle gibbing_power override (skip — not in our schema)
    if (path === "gibbing_power") continue;

    // Handle armor_damage_modifier_ranged = { near = { ... complex inline override
    if (path === "armor_damage_modifier_ranged") {
      // Complex block override — skip for now; these are rare and already captured
      // by the main parser if the block is re-defined inline
      continue;
    }

    // targets[N].field.subfield overrides — not worth the complexity for clone deltas
    // (most clones override simple scalars; targets array overrides are rare)
  }
}

function applyProfileOverrideBlock(profile: AnyRecord, block: string, lerpValues: AnyRecord) {
  const overridesMatch = block.match(/overrides\s*=\s*\{/);
  if (!overridesMatch) return;

  const tableStart = overridesMatch.index! + overridesMatch[0].length - 1;
  const tableEnd = findBalancedBrace(block, tableStart);
  if (tableEnd === -1) return;

  const overridesTable = block.slice(tableStart, tableEnd + 1);
  const tupleBlocks = extractTopLevelTableEntries(overridesTable);
  for (const tupleBlock of tupleBlocks) {
    const items = splitTopLevelLuaItems(tupleBlock.slice(1, -1));
    if (items.length < 2) continue;

    const path = items.slice(0, -1).map(stripLuaStringQuotes);
    const value = parseLuaOverrideValue(items.at(-1)!, lerpValues);
    applyProfileOverridePath(profile, path, value);
  }
}

function extractTopLevelTableEntries(tableBlock: string): string[] {
  const entries: string[] = [];
  const braceRe = /\{/g;
  let match;
  while ((match = braceRe.exec(tableBlock)) !== null) {
    if (countBraceDepth(tableBlock, match.index) !== 1) continue;
    const end = findBalancedBrace(tableBlock, match.index);
    if (end === -1) continue;
    entries.push(tableBlock.slice(match.index, end + 1));
    braceRe.lastIndex = end + 1;
  }
  return entries;
}

function splitTopLevelLuaItems(content: string): string[] {
  const items: string[] = [];
  let current = "";
  let depth = 0;
  let inString = false;
  let stringQuote = "";

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    const prev = i > 0 ? content[i - 1] : "";

    if (inString) {
      current += ch;
      if (ch === stringQuote && prev !== "\\") {
        inString = false;
        stringQuote = "";
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      current += ch;
      continue;
    }

    if (ch === "{") {
      depth += 1;
      current += ch;
      continue;
    }

    if (ch === "}") {
      depth -= 1;
      current += ch;
      continue;
    }

    if (ch === "," && depth === 0) {
      const item = current.trim();
      if (item.length > 0) items.push(item);
      current = "";
      continue;
    }

    current += ch;
  }

  const item = current.trim();
  if (item.length > 0) items.push(item);
  return items;
}

function stripLuaStringQuotes(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

function parseLuaOverrideValue(value: string, lerpValues: AnyRecord): unknown {
  const trimmed = value.trim();

  const lerpMatch = trimmed.match(/^damage_lerp_values\.(\w+)$/);
  if (lerpMatch) {
    return lerpValues[lerpMatch[1]] ?? [1, 1];
  }

  const damageTypeMatch = trimmed.match(/^damage_types\.(\w+)$/);
  if (damageTypeMatch) {
    return damageTypeMatch[1];
  }

  if (/^["'].*["']$/.test(trimmed)) {
    return stripLuaStringQuotes(trimmed);
  }

  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const values = (trimmed.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (values.length === 1) return values[0];
    if (values.length > 1) return values;
  }

  return null;
}

function applyProfileOverridePath(profile: AnyRecord, path: string[], value: unknown) {
  if (value == null || path.length === 0) return;

  if (path[0] === "suppression_value" || path[0] === "ragdoll_push_force") {
    return;
  }

  if (path[0] === "power_distribution" && path.length === 2 && profile.power_distribution) {
    profile.power_distribution[path[1]] = value;
    return;
  }

  if (path[0] === "cleave_distribution" && path.length === 2 && profile.cleave_distribution) {
    profile.cleave_distribution[path[1]] = value;
    return;
  }

  if (path[0] === "damage_type" && typeof value === "string") {
    profile.damage_type = value;
    return;
  }

  if (path[0] === "stagger_category" && typeof value === "string") {
    profile.stagger_category = value;
    return;
  }

  if (path[0] === "armor_damage_modifier" && path.length === 3 && profile.armor_damage_modifier) {
    profile.armor_damage_modifier[path[1]] ??= {};
    profile.armor_damage_modifier[path[1]][path[2]] = value;
    return;
  }

  if (path[0] === "armor_damage_modifier_ranged" && path.length === 4 && profile.armor_damage_modifier_ranged) {
    profile.armor_damage_modifier_ranged[path[1]] ??= {};
    profile.armor_damage_modifier_ranged[path[1]][path[2]] ??= {};
    profile.armor_damage_modifier_ranged[path[1]][path[2]][path[3]] = value;
    return;
  }

  if (path[0] === "targets" && path[1] === "default_target" && path[2] === "boost_curve_multiplier_finesse") {
    profile.boost_curve_multiplier_finesse = value;
    return;
  }

  if (path[0] === "targets" && path[1] === "default_target" && path[2] === "finesse_boost") {
    profile.finesse_boost = value;
  }
}

/**
 * Parse a single profile block into the output shape.
 *
 * @param {string} id
 * @param {string} block - The full `{ ... }` block
 * @param {string} sourceFile
 * @param {Record<string, [number, number]>} lerpValues
 * @param {Record<string, object>} cleavePresets
 * @param {Map<string, object>} [localAdmVars] - File-level local ADM variable definitions
 * @returns {object|null}
 */
export function parseProfileBlock(id: string, block: string, sourceFile: string, lerpValues: AnyRecord, cleavePresets: AnyRecord, localAdmVars: AnyRecord = new Map()) {
  // Extract stagger_category
  const staggerMatch = block.match(/stagger_category\s*=\s*"(\w+)"/);
  const staggerCategory = staggerMatch ? staggerMatch[1] : null;

  // Extract damage_type
  const damageTypeMatch = block.match(/damage_type\s*=\s*damage_types\.(\w+)/);
  const damageType = damageTypeMatch ? damageTypeMatch[1] : null;

  // Extract melee_attack_strength
  const meleeStrengthMatch = block.match(
    /melee_attack_strength\s*=\s*melee_attack_strengths\.(\w+)/,
  );
  const meleeAttackStrength = meleeStrengthMatch ? meleeStrengthMatch[1] : null;

  // Extract cleave_distribution
  const cleaveDistribution = parseCleaveDistribution(block, cleavePresets);

  // Extract ranges (ranged profiles)
  const ranges = parseRanges(block);

  // Extract power_distribution (top-level, for ranged profiles)
  const powerDistribution = parsePowerDistribution(block);

  // Extract armor_damage_modifier_ranged (for ranged profiles)
  const admRanged = parseArmorDamageModifierRanged(block, lerpValues, localAdmVars);

  // Extract profile-level armor_damage_modifier (inline or variable reference)
  const profileAdm = parseProfileLevelAdm(block, lerpValues, localAdmVars);

  // Extract first target entry from targets array
  const firstTarget = parseFirstTarget(block, lerpValues, localAdmVars);

  // Determine final values: prefer first target data, fall back to profile-level
  const finalPowerDist = firstTarget?.power_distribution || powerDistribution;
  const finalAdm = firstTarget?.armor_damage_modifier || profileAdm;
  const boostCurveMultFinesse = firstTarget?.boost_curve_multiplier_finesse ?? null;
  const finesseBoost = firstTarget?.finesse_boost || null;

  // Resolve boost_curve_multiplier_finesse from lerp if it's a string reference
  let resolvedBoostFinesse = boostCurveMultFinesse;
  if (typeof boostCurveMultFinesse === "string") {
    resolvedBoostFinesse = lerpValues[boostCurveMultFinesse] || null;
  }

  return {
    id,
    source_file: sourceFile,
    damage_type: damageType,
    stagger_category: staggerCategory,
    melee_attack_strength: meleeAttackStrength,
    power_distribution: finalPowerDist,
    armor_damage_modifier: finalAdm,
    armor_damage_modifier_ranged: admRanged,
    boost_curve_multiplier_finesse: resolvedBoostFinesse,
    finesse_boost: finesseBoost,
    cleave_distribution: cleaveDistribution,
    ranges,
  };
}

/**
 * Parse profile-level armor_damage_modifier from a profile block.
 * Handles inline `{ attack = { ... }, impact = { ... } }` blocks,
 * variable references like `armor_damage_modifier = cutting_am,`, and
 * channel-level variable references like `{ attack = flat_one_armor_mod, ... }`.
 *
 * @param {string} block
 * @param {Record<string, [number, number]>} lerpValues
 * @param {Map<string, object>} localAdmVars
 * @returns {object|null}
 */
function parseProfileLevelAdm(block: string, lerpValues: AnyRecord, localAdmVars: AnyRecord) {
  // Find the shallowest armor_damage_modifier = { ... } occurrence (not _ranged)
  // We need to distinguish `armor_damage_modifier = {` from `armor_damage_modifier_ranged = {`
  const re = /armor_damage_modifier\s*=\s*\{/g;
  let m;
  let bestMatch = null;
  let bestDepth = Infinity;

  while ((m = re.exec(block)) !== null) {
    // Skip if this is actually armor_damage_modifier_ranged
    const prefix = block.slice(Math.max(0, m.index - 1), m.index);
    if (prefix === "_") continue;
    const suffix = block.slice(m.index, m.index + 30);
    if (suffix.startsWith("armor_damage_modifier_ranged")) continue;

    const depth = countBraceDepth(block, m.index);
    if (depth < bestDepth) {
      bestDepth = depth;
      bestMatch = m;
    }
  }

  if (bestMatch) {
    const braceStart = bestMatch.index + bestMatch[0].length - 1;
    const braceEnd = findBalancedBrace(block, braceStart);
    if (braceEnd !== -1) {
      const admBlock = block.slice(braceStart, braceEnd + 1);
      const result: AnyRecord = {};

      for (const channel of ["attack", "impact"]) {
        // Try inline block: attack = { [armor_types.X] = ... }
        const chStart = admBlock.indexOf(`${channel} = {`);
        if (chStart !== -1) {
          const chBraceStart = chStart + `${channel} = `.length;
          const chBraceEnd = findBalancedBrace(admBlock, chBraceStart);
          if (chBraceEnd !== -1) {
            const chBlock = admBlock.slice(chBraceStart, chBraceEnd + 1);
            result[channel] = parseArmorTypeValues(chBlock, lerpValues);
            continue;
          }
        }

        // Try variable reference: attack = varname,
        const chVarMatch = admBlock.match(
          new RegExp(`${channel}\\s*=\\s*(\\w+)\\s*,`),
        );
        if (chVarMatch) {
          const varName = chVarMatch[1];
          if (localAdmVars.has(varName)) {
            const resolved = localAdmVars.get(varName);
            if (resolved && !resolved.attack && !resolved.impact) {
              result[channel] = resolved;
            }
          }
        }
      }

      if (result.attack || result.impact) return result;
    }
  }

  // Check for variable reference: armor_damage_modifier = varname,
  // Must not match armor_damage_modifier_ranged
  const varRefMatch = block.match(
    /(?:^|[^_])armor_damage_modifier\s*=\s*(\w+)\s*,/m,
  );
  if (varRefMatch && varRefMatch[1] !== "nil" && varRefMatch[1] !== "{") {
    // Extract just the variable name (group 1 may include prefix char)
    const varName = varRefMatch[1];
    if (localAdmVars.has(varName)) {
      return localAdmVars.get(varName);
    }
  }

  return null;
}

/**
 * Parse cleave_distribution from a profile block.
 * Handles both inline `{ attack = X, impact = Y }` and preset references like `single_cleave`.
 *
 * @param {string} block
 * @param {Record<string, object>} cleavePresets
 * @returns {object|null}
 */
function parseCleaveDistribution(block: string, cleavePresets: AnyRecord) {
  // Check for preset reference: cleave_distribution = single_cleave,
  const presetMatch = block.match(
    /cleave_distribution\s*=\s*(no_cleave|single_cleave|single_plus_cleave|double_cleave|light_cleave|medium_cleave|large_cleave|big_cleave|fold_cleave)\b/,
  );
  if (presetMatch) {
    return cleavePresets[presetMatch[1]] || null;
  }

  // Check for inline table: cleave_distribution = { attack = X, impact = Y }
  const inlineStart = block.indexOf("cleave_distribution = {");
  if (inlineStart === -1) return null;

  const braceStart = inlineStart + "cleave_distribution = ".length;
  const braceEnd = findBalancedBrace(block, braceStart);
  if (braceEnd === -1) return null;

  const subBlock = block.slice(braceStart, braceEnd + 1);
  return parseAttackImpactPair(subBlock);
}

/**
 * Parse ranges from a profile block.
 * Handles both `{ min = X, max = Y }` (scalar) and `{ min = { a, b }, max = { c, d } }` (array).
 *
 * @param {string} block
 * @returns {object|null}
 */
function parseRanges(block: string) {
  const rangesStart = block.indexOf("ranges = {");
  if (rangesStart === -1) return null;

  const braceStart = rangesStart + "ranges = ".length;
  const braceEnd = findBalancedBrace(block, braceStart);
  if (braceEnd === -1) return null;

  const subBlock = block.slice(braceStart, braceEnd + 1);

  // Try array form first: min = { 10, 20 }
  const minArrayMatch = subBlock.match(
    /min\s*=\s*\{\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,?\s*\}/,
  );
  const maxArrayMatch = subBlock.match(
    /max\s*=\s*\{\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,?\s*\}/,
  );

  if (minArrayMatch && maxArrayMatch) {
    return {
      min: [Number(minArrayMatch[1]), Number(minArrayMatch[2])],
      max: [Number(maxArrayMatch[1]), Number(maxArrayMatch[2])],
    };
  }

  // Scalar form: min = 15, max = 30
  const minScalarMatch = subBlock.match(/min\s*=\s*(-?\d+(?:\.\d+)?)/);
  const maxScalarMatch = subBlock.match(/max\s*=\s*(-?\d+(?:\.\d+)?)/);

  if (minScalarMatch && maxScalarMatch) {
    return {
      min: Number(minScalarMatch[1]),
      max: Number(maxScalarMatch[1]),
    };
  }

  return null;
}

/**
 * Parse top-level power_distribution from a profile block.
 * The top-level power_distribution is used by ranged profiles.
 * Must not confuse with targets[1].power_distribution.
 *
 * @param {string} block
 * @returns {object|null}
 */
function parsePowerDistribution(block: string) {
  // Find top-level (shallowest) power_distribution
  return parseShallowField(block, "power_distribution");
}

/**
 * Find the shallowest occurrence of a field `fieldName = { ... }` in a block
 * and parse it as an attack/impact pair.
 *
 * @param {string} block
 * @param {string} fieldName
 * @returns {object|null}
 */
function parseShallowField(block: string, fieldName: string) {
  const re = new RegExp(`${fieldName}\\s*=\\s*\\{`, "g");
  let m;
  let bestMatch = null;
  let bestDepth = Infinity;

  while ((m = re.exec(block)) !== null) {
    const depth = countBraceDepth(block, m.index);
    if (depth < bestDepth) {
      bestDepth = depth;
      bestMatch = m;
    }
  }

  if (!bestMatch) return null;

  const braceStart = bestMatch.index + bestMatch[0].length - 1;
  const braceEnd = findBalancedBrace(block, braceStart);
  if (braceEnd === -1) return null;

  return parseAttackImpactPair(block.slice(braceStart, braceEnd + 1));
}

/**
 * Parse armor_damage_modifier_ranged from a profile block.
 * Structure: { near = { attack = { ... }, impact = { ... } }, far = { ... } }
 * Values can be lerp references or literal numbers.
 *
 * @param {string} block
 * @param {Record<string, [number, number]>} lerpValues
 * @returns {object|null}
 */
function parseArmorDamageModifierRanged(block: string, lerpValues: AnyRecord, localAdmVars: AnyRecord = new Map()) {
  const admStart = block.indexOf("armor_damage_modifier_ranged = {");
  if (admStart !== -1) {
    const braceStart = admStart + "armor_damage_modifier_ranged = ".length;
    const braceEnd = findBalancedBrace(block, braceStart);
    if (braceEnd !== -1) {
      const admBlock = block.slice(braceStart, braceEnd + 1);
      return parseNearFarAdm(admBlock, lerpValues);
    }
  }

  // Check for variable reference: armor_damage_modifier_ranged = some_local_var,
  // or armor_damage_modifier_ranged = table.field,
  const varRefMatch = block.match(
    /armor_damage_modifier_ranged\s*=\s*(\w+(?:\.\w+)?)\s*,/,
  );
  if (varRefMatch) {
    const varName = varRefMatch[1];
    if (localAdmVars.has(varName)) {
      return localAdmVars.get(varName);
    }
  }

  return null;
}

/**
 * Parse a near/far ADM block.
 *
 * @param {string} admBlock
 * @param {Record<string, [number, number]>} lerpValues
 * @returns {object|null}
 */
function parseNearFarAdm(admBlock: string, lerpValues: AnyRecord) {
  const result: AnyRecord = {};
  for (const distance of ["near", "far"]) {
    const distStart = admBlock.indexOf(`${distance} = {`);
    if (distStart === -1) continue;

    const distBraceStart = distStart + `${distance} = `.length;
    const distBraceEnd = findBalancedBrace(admBlock, distBraceStart);
    if (distBraceEnd === -1) continue;

    const distBlock = admBlock.slice(distBraceStart, distBraceEnd + 1);
    result[distance] = {};

    for (const channel of ["attack", "impact"]) {
      const channelStart = distBlock.indexOf(`${channel} = {`);
      if (channelStart === -1) continue;

      const channelBraceStart = channelStart + `${channel} = `.length;
      const channelBraceEnd = findBalancedBrace(distBlock, channelBraceStart);
      if (channelBraceEnd === -1) continue;

      const channelBlock = distBlock.slice(channelBraceStart, channelBraceEnd + 1);
      result[distance][channel] = parseArmorTypeValues(channelBlock, lerpValues);
    }
  }

  if (Object.keys(result).length === 0) return null;
  return result;
}

/**
 * Parse file-level local variable definitions that hold ADM structures.
 *
 * Handles three patterns:
 * 1. Ranged near/far ADM: `local x = { near = { attack = { ... }, impact = { ... } }, far = { ... } }`
 * 2. Melee attack/impact ADM: `local x = { attack = { [armor_types.X] = ... }, impact = { ... } }`
 * 3. Tables of named sub-entries containing either pattern
 *
 * @param {string} lua - Full file source
 * @param {Record<string, [number, number]>} lerpValues
 * @returns {Map<string, object>} varName (or table.field) -> parsed ADM
 */
function parseLocalAdmVariables(lua: string, lerpValues: AnyRecord) {
  const vars = new Map();

  // Match: local varName = { ... }
  const localRe = /^local\s+(\w+)\s*=\s*\{/gm;
  let m;
  while ((m = localRe.exec(lua)) !== null) {
    const varName = m[1];
    const braceStart = m.index + m[0].length - 1;
    const braceEnd = findBalancedBrace(lua, braceStart);
    if (braceEnd === -1) continue;

    const block = lua.slice(braceStart, braceEnd + 1);

    // Check if this looks like a near/far ADM block (ranged)
    if (block.includes("near = {") && block.includes("far = {")) {
      const parsed = parseNearFarAdm(block, lerpValues);
      if (parsed) {
        vars.set(varName, parsed);
        continue;
      }
    }

    // Check if this looks like a melee ADM block: { attack = { [armor_types.X] = ... }, impact = { ... } }
    if (block.includes("attack = {") && block.includes("armor_types.")) {
      const parsed = parseMeleeAdm(block, lerpValues);
      if (parsed) {
        vars.set(varName, parsed);
        continue;
      }
    }

    // Check if this is a flat channel-level armor type map: { [armor_types.X] = ... }
    // (e.g., flat_one_armor_mod, default_armor_mod — no attack/impact wrapper)
    if (block.includes("armor_types.") && !block.includes("attack = {")) {
      const parsed = parseArmorTypeValues(block, lerpValues);
      if (parsed && Object.keys(parsed).length > 0) {
        vars.set(varName, parsed);
        continue;
      }
    }

    // Check if this is a table of named sub-entries that each have near/far or attack/impact
    const subRe = /(\w+)\s*=\s*\{/g;
    let sub;
    while ((sub = subRe.exec(block)) !== null) {
      const subName = sub[1];
      if (subName === "near" || subName === "far" || subName === "attack" || subName === "impact") continue;

      const subBraceStart = sub.index + sub[0].length - 1;
      // Ensure we're at depth 1 (inside the outer table)
      const depth = countBraceDepth(block, sub.index);
      if (depth !== 1) continue;

      const subBraceEnd = findBalancedBrace(block, subBraceStart);
      if (subBraceEnd === -1) continue;

      const subBlock = block.slice(subBraceStart, subBraceEnd + 1);
      if (subBlock.includes("near = {") && subBlock.includes("far = {")) {
        const parsed = parseNearFarAdm(subBlock, lerpValues);
        if (parsed) {
          vars.set(`${varName}.${subName}`, parsed);
        }
      } else if (subBlock.includes("attack = {") && subBlock.includes("armor_types.")) {
        const parsed = parseMeleeAdm(subBlock, lerpValues);
        if (parsed) {
          vars.set(`${varName}.${subName}`, parsed);
        }
      }
    }
  }

  return vars;
}

/**
 * Parse a melee-style ADM block: { attack = { [armor_types.X] = val, ... }, impact = { ... } }
 *
 * @param {string} block
 * @param {Record<string, [number, number]>} lerpValues
 * @returns {object|null}
 */
function parseMeleeAdm(block: string, lerpValues: AnyRecord) {
  const result: AnyRecord = {};
  for (const channel of ["attack", "impact"]) {
    const chStart = block.indexOf(`${channel} = {`);
    if (chStart === -1) continue;
    const chBraceStart = chStart + `${channel} = `.length;
    const chBraceEnd = findBalancedBrace(block, chBraceStart);
    if (chBraceEnd === -1) continue;
    const chBlock = block.slice(chBraceStart, chBraceEnd + 1);
    result[channel] = parseArmorTypeValues(chBlock, lerpValues);
  }
  if (!result.attack && !result.impact) return null;
  return result;
}

/**
 * Parse well-known preset ADM variables from damage_profile_settings.lua.
 *
 * These are global presets like `flat_one_armor_mod`, `default_armor_mod`,
 * `crit_armor_mod`, `crit_impact_armor_mod`, `base_crit_mod`, etc.
 * Files import them as `local flat_one_armor_mod = DamageProfileSettings.flat_one_armor_mod`.
 *
 * @param {string} sourceRoot
 * @param {Record<string, [number, number]>} lerpValues
 * @returns {Map<string, object>} presetName -> parsed ADM (either flat channel map or full attack/impact)
 */
function parsePresetAdmVariables(sourceRoot: string, lerpValues: AnyRecord) {
  const presets = new Map();
  const filePath = join(sourceRoot, "scripts", "settings", "damage", "damage_profile_settings.lua");
  const lua = readFileSync(filePath, "utf8");

  // Match: damage_profile_settings.name = { ... }
  const presetRe = /damage_profile_settings\.(\w+(?:_armor_mod|_crit_mod)\w*)\s*=\s*\{/g;
  let m;
  while ((m = presetRe.exec(lua)) !== null) {
    const name = m[1];
    const braceStart = m.index + m[0].length - 1;
    const braceEnd = findBalancedBrace(lua, braceStart);
    if (braceEnd === -1) continue;

    const block = lua.slice(braceStart, braceEnd + 1);

    // Check if this has attack/impact structure (e.g., base_crit_mod)
    if (block.includes("attack = {") && block.includes("impact = {")) {
      const parsed = parseMeleeAdm(block, lerpValues);
      if (parsed) {
        presets.set(name, parsed);
        continue;
      }
    }

    // Otherwise it's a flat channel-level map (e.g., flat_one_armor_mod)
    const parsed = parseArmorTypeValues(block, lerpValues);
    if (parsed && Object.keys(parsed).length > 0) {
      presets.set(name, parsed);
    }
  }

  return presets;
}

/**
 * Parse the first target entry from the `targets` array of a profile block.
 *
 * @param {string} block
 * @param {Record<string, [number, number]>} lerpValues
 * @param {Map<string, object>} localAdmVars
 * @returns {object|null}
 */
function parseFirstTarget(block: string, lerpValues: AnyRecord, localAdmVars: AnyRecord = new Map()) {
  const targetsStart = block.indexOf("targets = {");
  if (targetsStart === -1) return null;

  const targetsBraceStart = targetsStart + "targets = ".length;
  const targetsBraceEnd = findBalancedBrace(block, targetsBraceStart);
  if (targetsBraceEnd === -1) return null;

  const targetsBlock = block.slice(targetsBraceStart, targetsBraceEnd + 1);

  // Find the first numeric (unnamed) entry: the first `{` after the opening brace
  // that is NOT preceded by `default_target =` or other named keys
  // The first entry starts with a bare `{` at depth 1
  let depth = 0;
  let firstEntryStart = -1;
  for (let i = 0; i < targetsBlock.length; i++) {
    const ch = targetsBlock[i];
    if (ch === "{") {
      depth++;
      if (depth === 2) {
        // Check if this is a named entry (like `default_target = {`)
        const prefix = targetsBlock.slice(Math.max(0, i - 30), i).trim();
        if (!prefix.endsWith("=")) {
          firstEntryStart = i;
          break;
        }
      }
    } else if (ch === "}") {
      depth--;
    }
  }

  // If no unnamed first entry, try default_target
  if (firstEntryStart === -1) {
    const defaultStart = targetsBlock.indexOf("default_target = {");
    if (defaultStart === -1) return null;
    firstEntryStart = defaultStart + "default_target = ".length;
  }

  const firstEntryEnd = findBalancedBrace(targetsBlock, firstEntryStart);
  if (firstEntryEnd === -1) return null;

  const entryBlock = targetsBlock.slice(firstEntryStart, firstEntryEnd + 1);

  return parseTargetEntry(entryBlock, lerpValues, localAdmVars);
}

/**
 * Parse a single target entry block.
 *
 * @param {string} entryBlock
 * @param {Record<string, [number, number]>} lerpValues
 * @param {Map<string, object>} localAdmVars
 * @returns {object}
 */
function parseTargetEntry(entryBlock: string, lerpValues: AnyRecord, localAdmVars: AnyRecord = new Map()) {
  const result: AnyRecord = {};

  // power_distribution
  const pdStart = entryBlock.indexOf("power_distribution = {");
  if (pdStart !== -1) {
    const braceStart = pdStart + "power_distribution = ".length;
    const braceEnd = findBalancedBrace(entryBlock, braceStart);
    if (braceEnd !== -1) {
      result.power_distribution = parseAttackImpactPair(
        entryBlock.slice(braceStart, braceEnd + 1),
      );
    }
  }

  // armor_damage_modifier (melee -- flat numbers or variable references)
  const admStart = entryBlock.indexOf("armor_damage_modifier = {");
  if (admStart !== -1) {
    const admBraceStart = admStart + "armor_damage_modifier = ".length;
    const admBraceEnd = findBalancedBrace(entryBlock, admBraceStart);
    if (admBraceEnd !== -1) {
      const admBlock = entryBlock.slice(admBraceStart, admBraceEnd + 1);
      result.armor_damage_modifier = {};

      for (const channel of ["attack", "impact"]) {
        // First try inline block: attack = { [armor_types.X] = ... }
        const chStart = admBlock.indexOf(`${channel} = {`);
        if (chStart !== -1) {
          const chBraceStart = chStart + `${channel} = `.length;
          const chBraceEnd = findBalancedBrace(admBlock, chBraceStart);
          if (chBraceEnd !== -1) {
            const chBlock = admBlock.slice(chBraceStart, chBraceEnd + 1);
            result.armor_damage_modifier[channel] = parseArmorTypeValues(chBlock, lerpValues);
            continue;
          }
        }

        // Check for variable reference: attack = flat_one_armor_mod,
        const chVarMatch = admBlock.match(
          new RegExp(`${channel}\\s*=\\s*(\\w+)\\s*,`),
        );
        if (chVarMatch) {
          const varName = chVarMatch[1];
          if (localAdmVars.has(varName)) {
            const resolved = localAdmVars.get(varName);
            // If the resolved var is a flat armor type map (not wrapped in attack/impact),
            // use it directly as the channel value
            if (resolved && !resolved.attack && !resolved.impact) {
              result.armor_damage_modifier[channel] = resolved;
            }
          }
        }
      }
    }
  }

  // If no inline ADM block found, check for variable reference: armor_damage_modifier = varname,
  if (!result.armor_damage_modifier) {
    const admVarMatch = entryBlock.match(
      /armor_damage_modifier\s*=\s*(\w+)\s*,/,
    );
    if (admVarMatch && admVarMatch[1] !== "nil") {
      const varName = admVarMatch[1];
      if (localAdmVars.has(varName)) {
        result.armor_damage_modifier = localAdmVars.get(varName);
      }
    }
  }

  // boost_curve_multiplier_finesse
  const bcmfMatch = entryBlock.match(
    /boost_curve_multiplier_finesse\s*=\s*(?:damage_lerp_values\.(\w+)|(\{[^}]*\})|(-?\d+(?:\.\d+)?))/,
  );
  if (bcmfMatch) {
    if (bcmfMatch[1]) {
      // lerp reference
      result.boost_curve_multiplier_finesse = lerpValues[bcmfMatch[1]] || bcmfMatch[1];
    } else if (bcmfMatch[2]) {
      // inline array { 1.5, 2.5 }
      const nums = bcmfMatch[2].match(/-?\d+(?:\.\d+)?/g);
      result.boost_curve_multiplier_finesse = nums ? nums.map(Number) : null;
    } else {
      result.boost_curve_multiplier_finesse = Number(bcmfMatch[3]);
    }
  }

  // finesse_boost
  const fbStart = entryBlock.indexOf("finesse_boost = {");
  if (fbStart !== -1) {
    const fbBraceStart = fbStart + "finesse_boost = ".length;
    const fbBraceEnd = findBalancedBrace(entryBlock, fbBraceStart);
    if (fbBraceEnd !== -1) {
      const fbBlock = entryBlock.slice(fbBraceStart, fbBraceEnd + 1);
      result.finesse_boost = parseArmorTypeValues(fbBlock, lerpValues);
    }
  }

  return result;
}

// -- Phase 4: Hitscan templates -----------------------------------------------

/**
 * Parse all hitscan template files to build a map of hitscan_name -> damage_profile_name.
 *
 * @param {string} sourceRoot
 * @returns {Map<string, string>} hitscanName -> damageProfileName
 */
function parseAllHitscanTemplates(sourceRoot: string) {
  const map = new Map();

  // Parse per-weapon hitscan template files first (so overrides in main file can reference them)
  const weaponBaseDir = join(sourceRoot, "scripts", "settings", "equipment", "weapon_templates");
  for (const family of WEAPON_FAMILIES) {
    const settingsDir = join(weaponBaseDir, family, "settings_templates");
    if (!existsSync(settingsDir)) continue;
    try {
      const files = readdirSync(settingsDir)
        .filter((f) => f.endsWith("_hitscan_templates.lua"))
        .sort();
      for (const f of files) {
        const lua = readFileSync(join(settingsDir, f), "utf8");
        parseHitscanFile(lua, map);
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`Warning: failed to read hitscan dir ${settingsDir}: ${(err as Error).message}`);
      }
    }
  }

  // Parse the main hit_scan_templates.lua file
  const mainPath = join(sourceRoot, "scripts", "settings", "projectile", "hit_scan_templates.lua");
  if (existsSync(mainPath)) {
    const lua = readFileSync(mainPath, "utf8");
    parseHitscanFile(lua, map);
  }

  return map;
}

/**
 * Parse a single hitscan template file.
 * Extracts both direct templates and overrides.
 *
 * @param {string} lua
 * @param {Map<string, string>} map
 */
function parseHitscanFile(lua: string, map: AnyRecord) {
  // Direct templates: hitscan_templates.X = { ... damage_profile = DamageProfileTemplates.Y ... }
  const directRe = /hitscan_templates\.(\w+)\s*=\s*\{/g;
  let m;
  while ((m = directRe.exec(lua)) !== null) {
    const name = m[1];
    const braceStart = m.index + m[0].length - 1;
    const braceEnd = findBalancedBrace(lua, braceStart);
    if (braceEnd === -1) continue;

    const block = lua.slice(braceStart, braceEnd + 1);
    const profileMatch = block.match(
      /damage_profile\s*=\s*DamageProfileTemplates\.(\w+)/,
    );
    if (profileMatch) {
      map.set(name, profileMatch[1]);
    }
  }

  const cloneRe = /hitscan_templates\.(\w+)\s*=\s*table\.clone\(hitscan_templates\.(\w+)\)/g;
  while ((m = cloneRe.exec(lua)) !== null) {
    const name = m[1];
    const parent = m[2];
    if (map.has(parent) && !map.has(name)) {
      map.set(name, map.get(parent));
    }
  }

  const assignmentRe = /^hitscan_templates\.(\w+)\.damage\.impact\.damage_profile\s*=\s*DamageProfileTemplates\.(\w+)/gm;
  while ((m = assignmentRe.exec(lua)) !== null) {
    map.set(m[1], m[2]);
  }

  // Overrides: overrides.X = { parent_template_name = "Y", overrides = { { ... DamageProfileTemplates.Z } } }
  const overrideRe = /overrides\.(\w+)\s*=\s*\{/g;
  while ((m = overrideRe.exec(lua)) !== null) {
    const name = m[1];
    const braceStart = m.index + m[0].length - 1;
    const braceEnd = findBalancedBrace(lua, braceStart);
    if (braceEnd === -1) continue;

    const block = lua.slice(braceStart, braceEnd + 1);

    // Check for damage_profile override
    const profileMatch = block.match(
      /DamageProfileTemplates\.(\w+)/,
    );
    if (profileMatch) {
      map.set(name, profileMatch[1]);
    } else {
      // Inherit from parent
      const parentMatch = block.match(
        /parent_template_name\s*=\s*"(\w+)"/,
      );
      if (parentMatch && map.has(parentMatch[1])) {
        map.set(name, map.get(parentMatch[1]));
      }
    }
  }
}

/**
 * Parse shotshell template files to build a map of shotshell_name -> damage_profile_name.
 *
 * @param {string} sourceRoot
 * @returns {Map<string, string>} shotshellName -> damageProfileName
 */
function parseAllShotshellTemplates(sourceRoot: string) {
  const map = new Map();
  const weaponBaseDir = join(sourceRoot, "scripts", "settings", "equipment", "weapon_templates");
  for (const family of WEAPON_FAMILIES) {
    const settingsDir = join(weaponBaseDir, family, "settings_templates");
    if (!existsSync(settingsDir)) continue;
    try {
      const files = readdirSync(settingsDir)
        .filter((f) => f.endsWith("_shotshell_templates.lua"))
        .sort();
      for (const f of files) {
        const lua = readFileSync(join(settingsDir, f), "utf8");
        parseShotshellFile(lua, map);
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`Warning: failed to read shotshell dir ${settingsDir}: ${(err as Error).message}`);
      }
    }
  }

  const mainPath = join(sourceRoot, "scripts", "settings", "projectile", "shotshell_templates.lua");
  if (!existsSync(mainPath)) {
    return map;
  }

  const lua = readFileSync(mainPath, "utf8");
  parseShotshellFile(lua, map);
  return map;
}

/**
 * Parse a single shotshell template file.
 *
 * @param {string} lua
 * @param {Map<string, string>} map
 */
function parseShotshellFile(lua: string, map: AnyRecord) {
  const directRe = /shotshell_templates\.(\w+)\s*=\s*\{/g;
  let m;
  while ((m = directRe.exec(lua)) !== null) {
    const name = m[1];
    const braceStart = m.index + m[0].length - 1;
    const braceEnd = findBalancedBrace(lua, braceStart);
    if (braceEnd === -1) continue;

    const block = lua.slice(braceStart, braceEnd + 1);
    const profileMatch = block.match(/damage_profile\s*=\s*DamageProfileTemplates\.(\w+)/);
    if (profileMatch) {
      map.set(name, profileMatch[1]);
    }
  }
}

/**
 * Parse flamer gas template files to build a map of template name -> damage profile name.
 *
 * @param {string} sourceRoot
 * @returns {Map<string, string>} flamerGasName -> damageProfileName
 */
function parseAllFlamerGasTemplates(sourceRoot: string) {
  const map = new Map();
  const path = join(sourceRoot, "scripts", "settings", "projectile", "flamer_gas_templates.lua");
  if (!existsSync(path)) {
    return map;
  }

  const lua = readFileSync(path, "utf8");
  const directRe = /flamer_gas_templates\.(\w+)\s*=\s*\{/g;
  let m;
  while ((m = directRe.exec(lua)) !== null) {
    const name = m[1];
    const braceStart = m.index + m[0].length - 1;
    const braceEnd = findBalancedBrace(lua, braceStart);
    if (braceEnd === -1) continue;

    const block = lua.slice(braceStart, braceEnd + 1);
    const profileMatch = block.match(/damage_profile\s*=\s*DamageProfileTemplates\.(\w+)/);
    if (profileMatch) {
      map.set(name, profileMatch[1]);
    }
  }

  return map;
}

/**
 * Parse projectile template files to build a map of projectile name -> damage profile name.
 *
 * @param {string} sourceRoot
 * @returns {Map<string, string>} projectileName -> damageProfileName
 */
function parseAllProjectileTemplates(sourceRoot: string) {
  const map = new Map();
  const projectileDir = join(sourceRoot, "scripts", "settings", "projectile");
  const candidateFiles = [
    "player_projectile_templates.lua",
    "minion_projectile_templates.lua",
  ];

  for (const filename of candidateFiles) {
    const path = join(projectileDir, filename);
    if (!existsSync(path)) continue;
    const lua = readFileSync(path, "utf8");
    parseProjectileFile(lua, map);
  }

  return map;
}

/**
 * Parse a single projectile template file.
 *
 * @param {string} lua
 * @param {Map<string, string>} map
 */
function parseProjectileFile(lua: string, map: AnyRecord) {
  const directRe = /projectile_templates\.(\w+)\s*=\s*\{/g;
  let m;
  while ((m = directRe.exec(lua)) !== null) {
    const name = m[1];
    const braceStart = m.index + m[0].length - 1;
    const braceEnd = findBalancedBrace(lua, braceStart);
    if (braceEnd === -1) continue;

    const block = lua.slice(braceStart, braceEnd + 1);
    const profileMatch = block.match(/damage_profile\s*=\s*DamageProfileTemplates\.(\w+)/);
    if (profileMatch) {
      map.set(name, profileMatch[1]);
    }
  }

  const cloneRe = /projectile_templates\.(\w+)\s*=\s*table\.clone_instance\(projectile_templates\.(\w+)\)/g;
  while ((m = cloneRe.exec(lua)) !== null) {
    const name = m[1];
    const parent = m[2];
    if (map.has(parent) && !map.has(name)) {
      map.set(name, map.get(parent));
    }
  }

  const assignmentRe =
    /^projectile_templates\.(\w+)\.damage\.impact\.damage_profile\s*=\s*DamageProfileTemplates\.(\w+)/gm;
  while ((m = assignmentRe.exec(lua)) !== null) {
    map.set(m[1], m[2]);
  }
}

// -- Phase 5: Weapon action maps ----------------------------------------------

/**
 * Parse all weapon template files and extract action -> profile mappings.
 *
 * @param {string} sourceRoot
 * @param {Map<string, string>} hitscanMap
 * @param {Map<string, string>} shotshellMap
 * @param {Set<string>} profileIds
 * @returns {object[]}
 */
function parseAllWeaponTemplates(
  sourceRoot: string,
  hitscanMap: AnyRecord,
  shotshellMap: AnyRecord,
  flamerGasMap: AnyRecord,
  projectileMap: AnyRecord,
  profileIds: Set<string>,
) {
  const actionMaps = [];
  const weaponBaseDir = join(sourceRoot, "scripts", "settings", "equipment", "weapon_templates");

  for (const family of WEAPON_FAMILIES) {
    const familyDir = join(weaponBaseDir, family);
    if (!existsSync(familyDir)) continue;

    let entries;
    try {
      entries = readdirSync(familyDir);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`Warning: failed to read weapon dir ${familyDir}: ${(err as Error).message}`);
      }
      continue;
    }

    const weaponFiles = entries
      .filter((f) => f.endsWith(".lua") && !f.startsWith("settings_templates") && f !== "weapon_templates.lua")
      .sort();

    for (const f of weaponFiles) {
      const lua = readFileSync(join(familyDir, f), "utf8");
      const weaponName = f.replace(".lua", "");
      const actions = parseWeaponActions(
        lua,
        hitscanMap,
        shotshellMap,
        flamerGasMap,
        projectileMap,
        profileIds,
      );
      if (Object.keys(actions).length > 0) {
        actionMaps.push({
          weapon_template: weaponName,
          actions,
        });
      }
    }
  }

  return actionMaps;
}

/**
 * Parse weapon_template.actions to extract action -> profile mappings.
 *
 * For melee: look for `damage_profile = DamageProfileTemplates.X` directly in action blocks.
 * For ranged: look for `hit_scan_template = HitScanTemplates.X`, then resolve via hitscanMap.
 *
 * @param {string} lua
 * @param {Map<string, string>} hitscanMap
 * @param {Map<string, string>} shotshellMap
 * @param {Set<string>} profileIds
 * @returns {Record<string, string[]>}
 */
function parseWeaponActions(
  lua: string,
  hitscanMap: AnyRecord,
  shotshellMap: AnyRecord,
  flamerGasMap: AnyRecord,
  projectileMap: AnyRecord,
  profileIds: Set<string>,
) {
  const result: AnyRecord = {};

  // Find weapon_template.actions block
  const actionsStart = lua.indexOf("weapon_template.actions = {");
  if (actionsStart === -1) return result;

  const braceStart = actionsStart + "weapon_template.actions = ".length;
  const braceEnd = findBalancedBrace(lua, braceStart);
  if (braceEnd === -1) return result;

  const actionsBlock = lua.slice(braceStart, braceEnd + 1);

  // Find each action_X = { ... } block at depth 1
  const actionRe = /\t(\w+)\s*=\s*\{/g;
  let m;
  while ((m = actionRe.exec(actionsBlock)) !== null) {
    const actionName = m[1];
    const actionBraceStart = m.index + m[0].length - 1;

    // Check we're at depth 1 (inside the actions table, not deeper)
    const depth = countBraceDepth(actionsBlock, m.index);
    if (depth !== 1) continue;

    const actionBraceEnd = findBalancedBrace(actionsBlock, actionBraceStart);
    if (actionBraceEnd === -1) continue;

    const actionBlock = actionsBlock.slice(actionBraceStart, actionBraceEnd + 1);
    const profiles = extractProfilesFromAction(
      actionBlock,
      hitscanMap,
      shotshellMap,
      flamerGasMap,
      projectileMap,
      profileIds,
    );

    if (profiles.length > 0) {
      const category = classifyAction(actionName, actionBlock);
      if (!result[category]) {
        result[category] = [];
      }
      for (const p of profiles) {
        if (!result[category].includes(p)) {
          result[category].push(p);
        }
      }
    }
  }

  return result;
}

/**
 * Extract damage profile names referenced by a single action block.
 *
 * @param {string} actionBlock
 * @param {Map<string, string>} hitscanMap
 * @param {Map<string, string>} shotshellMap
 * @param {Set<string>} profileIds
 * @returns {string[]}
 */
export function extractProfilesFromAction(
  actionBlock: string,
  hitscanMap: AnyRecord,
  shotshellMap: AnyRecord,
  flamerGasMap: AnyRecord,
  projectileMap: AnyRecord,
  profileIds: Set<string>,
) {
  const profiles: string[] = [];

  // Direct damage_profile reference (melee)
  const directRe = /(?:^|[^_])damage_profile\s*=\s*DamageProfileTemplates\.(\w+)/g;
  let m;
  while ((m = directRe.exec(actionBlock)) !== null) {
    if (profileIds.has(m[1]) && !profiles.includes(m[1])) {
      profiles.push(m[1]);
    }
  }

  // inner_damage_profile and outer_damage_profile (push actions)
  const innerRe = /inner_damage_profile\s*=\s*DamageProfileTemplates\.(\w+)/g;
  while ((m = innerRe.exec(actionBlock)) !== null) {
    if (profileIds.has(m[1]) && !profiles.includes(m[1])) {
      profiles.push(m[1]);
    }
  }
  const outerRe = /outer_damage_profile\s*=\s*DamageProfileTemplates\.(\w+)/g;
  while ((m = outerRe.exec(actionBlock)) !== null) {
    if (profileIds.has(m[1]) && !profiles.includes(m[1])) {
      profiles.push(m[1]);
    }
  }

  // Hitscan template reference (ranged)
  const hitscanRe = /hit_scan_template\s*=\s*HitScanTemplates\.(\w+)/g;
  while ((m = hitscanRe.exec(actionBlock)) !== null) {
    const profileName = hitscanMap.get(m[1]);
    if (profileName && profileIds.has(profileName) && !profiles.includes(profileName)) {
      profiles.push(profileName);
    }
  }

  // Shotshell template reference (shotguns, ripperguns, thumpers)
  const shotshellRe = /shotshell(?:_special)?\s*=\s*ShotshellTemplates\.(\w+)/g;
  while ((m = shotshellRe.exec(actionBlock)) !== null) {
    const profileName = shotshellMap.get(m[1]);
    if (profileName && profileIds.has(profileName) && !profiles.includes(profileName)) {
      profiles.push(profileName);
    }
  }

  // Flamer gas template reference (flamers, inferno staff)
  const flamerGasRe = /flamer_gas_template\s*=\s*FlamerGasTemplates\.(\w+)/g;
  while ((m = flamerGasRe.exec(actionBlock)) !== null) {
    const profileName = flamerGasMap.get(m[1]);
    if (profileName && profileIds.has(profileName) && !profiles.includes(profileName)) {
      profiles.push(profileName);
    }
  }

  // Projectile charge template reference (force staves, grenade launchers)
  const chargeTemplateRe = /charge_template\s*=\s*"([\w_]+)"/g;
  while ((m = chargeTemplateRe.exec(actionBlock)) !== null) {
    const profileName = projectileMap.get(m[1]);
    if (profileName && profileIds.has(profileName) && !profiles.includes(profileName)) {
      profiles.push(profileName);
    }
  }

  const projectileTemplateRe = /projectile(?:_template)?\s*=\s*ProjectileTemplates\.(\w+)/g;
  while ((m = projectileTemplateRe.exec(actionBlock)) !== null) {
    const profileName = projectileMap.get(m[1]);
    if (profileName && profileIds.has(profileName) && !profiles.includes(profileName)) {
      profiles.push(profileName);
    }
  }

  return profiles;
}

/**
 * Classify an action name into a category.
 *
 * @param {string} actionName
 * @returns {string}
 */
function classifyAction(actionName: string, actionBlock = "") {
  const kind = actionBlock.match(/\bkind\s*=\s*"([^"]+)"/)?.[1] ?? "";

  // Ranged shoot actions
  if (actionName.includes("shoot_hip") || actionName === "action_shoot") return "shoot_hip";
  if (actionName.includes("shoot_zoomed") || actionName.includes("zoom_shoot")) return "shoot_zoomed";
  if (actionName.includes("shoot_braced") || actionName.includes("braced_shoot")) return "shoot_braced";
  if (actionName.includes("charge_shoot") || actionName.includes("shoot_charged") || actionName.includes("charged_shoot")) return "shoot_charged";
  if (kind === "shoot_pellets") {
    return actionName.includes("zoomed") ? "shoot_zoomed" : "shoot_hip";
  }
  if (kind === "spawn_projectile") {
    if (actionName.includes("charge") || actionName.includes("charged") || actionName.includes("heavy")) {
      return "shoot_charged";
    }
    if (actionName.includes("zoomed")) return "shoot_zoomed";
    return "shoot_hip";
  }
  if (kind === "flamer_gas" || kind === "flamer_gas_burst") return "shoot_hip";

  // Push followup (must check before "light" — action_pushfollow_light would match "light" first)
  if (actionName.includes("pushfollow")) return "push_followup";

  // Melee light attacks
  if (actionName.includes("light")) return "light_attack";
  if (actionName.includes("stab") || actionName.includes("slash")) return "light_attack";
  if (actionName.includes("swipe") || actionName.includes("fling")) return "light_attack";

  // Melee heavy attacks
  if (actionName.includes("heavy")) return "heavy_attack";

  // Weapon special
  if (actionName.includes("special") || actionName.includes("parry")) return "weapon_special";
  if (actionName.includes("bash") || actionName.includes("pistol_whip")) return "weapon_special";

  // Push
  if (actionName === "action_push" || (actionName.includes("push") && !actionName.includes("pushfollow"))) return "push";

  // Melee start (windup) -- these contain the damage_profile for the chain
  if (actionName.includes("melee_start")) return "light_attack";

  // Fallback
  return actionName;
}

// -- Utility parsers ----------------------------------------------------------

/**
 * Parse an armor type map from a `[armor_types.X] = value` block.
 * Values can be lerp references (damage_lerp_values.lerp_X) or literal numbers.
 *
 * @param {string} block
 * @param {Record<string, [number, number]>} lerpValues
 * @returns {Record<string, number|[number,number]>}
 */
export function parseArmorTypeValues(block: string, lerpValues: AnyRecord) {
  const result: AnyRecord = {};

  // Match [armor_types.X] = damage_lerp_values.lerp_Y
  const lerpRe = /\[armor_types\.(\w+)\]\s*=\s*damage_lerp_values\.(\w+)/g;
  let m;
  while ((m = lerpRe.exec(block)) !== null) {
    if (!lerpValues[m[2]]) {
      console.warn(`Warning: unknown lerp value '${m[2]}' for armor type '${m[1]}', defaulting to [1, 1] (neutral)`);
    }
    result[m[1]] = lerpValues[m[2]] || [1, 1];
  }

  // Match [armor_types.X] = number (only if not already matched as lerp)
  const numRe = /\[armor_types\.(\w+)\]\s*=\s*(-?\d+(?:\.\d+)?)\s*[,}]/g;
  while ((m = numRe.exec(block)) !== null) {
    if (!(m[1] in result)) {
      result[m[1]] = Number(m[2]);
    }
  }

  return result;
}

/**
 * Parse an { attack = X, impact = Y } pair.
 * X and Y can be numbers or { min, max } arrays.
 *
 * @param {string} block
 * @returns {object}
 */
export function parseAttackImpactPair(block: string) {
  const result: AnyRecord = {};

  for (const channel of ["attack", "impact"]) {
    // Check for array form: attack = { 1, 2 }
    const arrayMatch = block.match(
      new RegExp(`${channel}\\s*=\\s*\\{\\s*(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)\\s*,?\\s*\\}`),
    );
    if (arrayMatch) {
      result[channel] = [Number(arrayMatch[1]), Number(arrayMatch[2])];
      continue;
    }

    // Scalar form: attack = 0.5
    const scalarMatch = block.match(
      new RegExp(`${channel}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)\\s*[,}]`),
    );
    if (scalarMatch) {
      result[channel] = Number(scalarMatch[1]);
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Parse a simple armor type map with numeric values from the power_level_settings pattern:
 * `setting_name = { [armor_types.X] = number, ... }`
 *
 * @param {string} lua
 * @param {string} settingName
 * @returns {Record<string, number>}
 */
export function parseSimpleArmorTypeMap(lua: string, settingName: string) {
  const re = new RegExp(
    `power_level_settings\\.${settingName}\\s*=\\s*\\{([\\s\\S]*?)\\}`,
  );
  const match = lua.match(re);
  if (!match) return {};

  const result: AnyRecord = {};
  const entryRe = /\[armor_types\.(\w+)\]\s*=\s*(-?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = entryRe.exec(match[1])) !== null) {
    result[m[1]] = Number(m[2]);
  }
  return result;
}

/**
 * Parse a simple armor type map from local variables (armor_settings.lua pattern).
 *
 * @param {string} lua
 * @param {string} varName
 * @returns {Record<string, number>}
 */
function parseSimpleArmorTypeMapFromLocal(lua: string, varName: string) {
  const re = new RegExp(
    `(?:local\\s+)?${varName}\\s*=\\s*\\{([\\s\\S]*?)\\}`,
  );
  const match = lua.match(re);
  if (!match) return {};

  const result: AnyRecord = {};
  const entryRe = /\[armor_types\.(\w+)\]\s*=\s*(-?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = entryRe.exec(match[1])) !== null) {
    result[m[1]] = Number(m[2]);
  }
  return result;
}

/**
 * Parse damage_output table structure.
 * @param {string} lua
 * @param {string} tableName
 * @param {function} valueParser
 * @returns {Record<string, object>}
 */
function parseArmorTypeTable(lua: string, tableName: string, valueParser: (block: string) => AnyRecord) {
  const startRe = new RegExp(
    `power_level_settings\\.${tableName}\\s*=\\s*\\{`,
  );
  const match = lua.match(startRe);
  if (!match) return {};

  const blockStart = match.index! + match[0].length - 1;
  const blockEnd = findBalancedBrace(lua, blockStart);
  if (blockEnd === -1) return {};

  const block = lua.slice(blockStart, blockEnd + 1);

  const result: AnyRecord = {};
  // Find [armor_types.X] = { ... } entries
  const entryRe = /\[armor_types\.(\w+)\]\s*=\s*\{/g;
  let m;
  while ((m = entryRe.exec(block)) !== null) {
    const entryStart = m.index + m[0].length - 1;
    const entryEnd = findBalancedBrace(block, entryStart);
    if (entryEnd === -1) continue;
    const entryBlock = block.slice(entryStart, entryEnd + 1);
    result[m[1]] = valueParser(entryBlock);
  }
  return result;
}

/**
 * Parse boost_damage_armor_conversion map.
 * Values are armor_types.X references.
 *
 * @param {string} lua
 * @returns {Record<string, string>}
 */
function parseArmorConversionMap(lua: string) {
  const match = lua.match(
    /boost_damage_armor_conversion\s*=\s*\{([\s\S]*?)\}/,
  );
  if (!match) return {};

  const result: AnyRecord = {};
  const entryRe = /\[armor_types\.(\w+)\]\s*=\s*armor_types\.(\w+)/g;
  let m;
  while ((m = entryRe.exec(match[1])) !== null) {
    result[m[1]] = m[2];
  }
  return result;
}

/**
 * Parse default_armor_damage_modifier.
 * Structure: { attack = { [armor_types.X] = number, ... }, impact = { ... } }
 *
 * @param {string} lua
 * @returns {object}
 */
function parseDefaultArmorDamageModifier(lua: string) {
  const startRe = /default_armor_damage_modifier\s*=\s*\{/;
  const match = lua.match(startRe);
  if (!match) return {};

  const blockStart = match.index! + match[0].length - 1;
  const blockEnd = findBalancedBrace(lua, blockStart);
  if (blockEnd === -1) return {};

  const block = lua.slice(blockStart, blockEnd + 1);
  const result: AnyRecord = {};

  for (const channel of ["attack", "impact"]) {
    const chStart = block.indexOf(`${channel} = {`);
    if (chStart === -1) continue;
    const chBraceStart = chStart + `${channel} = `.length;
    const chBraceEnd = findBalancedBrace(block, chBraceStart);
    if (chBraceEnd === -1) continue;
    const chBlock = block.slice(chBraceStart, chBraceEnd + 1);

    const channelResult: AnyRecord = {};
    const entryRe = /\[armor_types\.(\w+)\]\s*=\s*(-?\d+(?:\.\d+)?)/g;
    let m;
    while ((m = entryRe.exec(chBlock)) !== null) {
      channelResult[m[1]] = Number(m[2]);
    }
    result[channel] = channelResult;
  }

  return result;
}

/**
 * Extract a number from a regex match.
 * @param {string} lua
 * @param {RegExp} re
 * @param {{ critical?: boolean }} options
 * @returns {number}
 */
function extractNumber(lua: string, re: RegExp, { critical = false } = {}) {
  const m = lua.match(re);
  if (!m) {
    if (critical) {
      throw new Error(`Critical constant not found: ${re.source}`);
    }
    console.warn(`Warning: extractNumber failed for pattern ${re.source}, defaulting to 0`);
    return 0;
  }
  return Number(m[1]);
}

/**
 * Find the index of the closing brace matching the opening brace at `startIdx`.
 *
 * @param {string} str
 * @param {number} startIdx - Index of the opening `{`
 * @returns {number} Index of the matching `}`, or -1 if not found
 */
export function findBalancedBrace(str: string, startIdx: number) {
  if (str[startIdx] !== "{") return -1;
  let depth = 0;
  // Skip string literals, line comments, multiline comments, and long strings
  for (let i = startIdx; i < str.length; i++) {
    const ch = str[i];
    if (ch === "-" && str[i + 1] === "-") {
      if (str[i + 2] === "[" && str[i + 3] === "[") {
        // Skip multiline comment --[[ ... ]]
        const closing = str.indexOf("]]", i + 4);
        if (closing === -1) return -1;
        i = closing + 1;
        continue;
      }
      // Skip line comment
      const newline = str.indexOf("\n", i);
      if (newline === -1) return -1;
      i = newline;
      continue;
    }
    if (ch === "[" && str[i + 1] === "[") {
      // Skip long string [[ ... ]]
      const closing = str.indexOf("]]", i + 2);
      if (closing === -1) return -1;
      i = closing + 1;
      continue;
    }
    if (ch === '"') {
      // Skip string literal
      const closing = str.indexOf('"', i + 1);
      if (closing === -1) return -1;
      i = closing;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Count the brace nesting depth at a given position.
 *
 * @param {string} str
 * @param {number} position
 * @returns {number}
 */
export function countBraceDepth(str: string, position: number) {
  let depth = 0;
  for (let i = 0; i < position; i++) {
    const ch = str[i];
    if (ch === "-" && str[i + 1] === "-") {
      if (str[i + 2] === "[" && str[i + 3] === "[") {
        const closing = str.indexOf("]]", i + 4);
        if (closing === -1 || closing >= position) break;
        i = closing + 1;
        continue;
      }
      const newline = str.indexOf("\n", i);
      if (newline === -1 || newline >= position) break;
      i = newline;
      continue;
    }
    if (ch === "[" && str[i + 1] === "[") {
      const closing = str.indexOf("]]", i + 2);
      if (closing === -1 || closing >= position) break;
      i = closing + 1;
      continue;
    }
    if (ch === '"') {
      const closing = str.indexOf('"', i + 1);
      if (closing === -1 || closing >= position) break;
      i = closing;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") depth--;
  }
  return depth;
}
