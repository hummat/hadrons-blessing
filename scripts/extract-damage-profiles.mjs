/**
 * Pipeline entry point: extract damage profiles from Darktide Lua source files.
 *
 * Reads damage profile templates, weapon templates, and hitscan templates to
 * produce a consolidated damage-profiles.json used by the calculator engine.
 *
 * Usage: node scripts/extract-damage-profiles.mjs
 *        npm run profiles:build
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
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

  // -- Phase 3: Parse all damage profile template files -----------------------
  const profiles = parseAllDamageProfiles(sourceRoot, lerpValues, cleavePresets);
  profiles.sort((a, b) => a.id.localeCompare(b.id));
  console.log(`Parsed ${profiles.length} damage profiles`);

  // -- Phase 4: Parse hitscan templates for ranged profile resolution ---------
  const hitscanMap = parseAllHitscanTemplates(sourceRoot);
  console.log(`Parsed ${hitscanMap.size} hitscan templates`);

  // -- Phase 5: Parse weapon templates for action -> profile mapping -----------
  const profileIds = new Set(profiles.map((p) => p.id));
  const actionMaps = parseAllWeaponTemplates(sourceRoot, hitscanMap, profileIds);
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
function parseLerpValues(sourceRoot) {
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

  const lerpValues = {};
  // Match entries like: lerp_1 = { 0.67, 1.33, }
  const lerpRe = /(\w+)\s*=\s*\{\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,?\s*\}/g;
  let m;
  while ((m = lerpRe.exec(lerpBlockMatch[1])) !== null) {
    lerpValues[m[1]] = [Number(m[2]), Number(m[3])];
  }

  // Parse cleave presets: no_cleave, single_cleave, single_plus_cleave, double_cleave, etc.
  const cleavePresets = {};
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
      const braceIdx = cleaveMatch.index + cleaveMatch[0].length - 1;
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
function parseConstants(sourceRoot) {
  const plsPath = join(sourceRoot, "scripts", "settings", "damage", "power_level_settings.lua");
  const plsLua = readFileSync(plsPath, "utf8");

  const asPath = join(sourceRoot, "scripts", "settings", "damage", "armor_settings.lua");
  const asLua = readFileSync(asPath, "utf8");

  // default_power_level
  const defaultPl = extractNumber(plsLua, /default_power_level\s*=\s*(\d+)/);

  // damage_output: all armor types have {min: 0, max: 20}
  const damageOutput = parseArmorTypeTable(plsLua, "damage_output", (block) => {
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
      ? boostCurveMatch[1].match(/-?\d+(?:\.\d+)?/g).map(Number)
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
  const defaultCritBoost = extractNumber(plsLua, /default_crit_boost_amount\s*=\s*(-?\d+(?:\.\d+)?)/);

  // default_boost_curve_multiplier
  const defaultBoostCurveMult = extractNumber(plsLua, /default_boost_curve_multiplier\s*=\s*(-?\d+(?:\.\d+)?)/);

  // rending_boost_amount
  const rendingBoostAmount = parseSimpleArmorTypeMap(plsLua, "rending_boost_amount");

  // boost_damage_armor_conversion
  const boostConversion = parseArmorConversionMap(plsLua);

  // default_armor_damage_modifier
  const defaultAdm = parseDefaultArmorDamageModifier(plsLua);

  // finesse_min_damage_multiplier
  const finesseMinDamageMult = extractNumber(plsLua, /finesse_min_damage_multiplier\s*=\s*(-?\d+(?:\.\d+)?)/);

  // From armor_settings
  const overdamageRendingMult = parseSimpleArmorTypeMapFromLocal(asLua, "overdamage_rending_multiplier");
  const rendingArmorTypeMult = parseSimpleArmorTypeMapFromLocal(asLua, "rending_armor_type_multiplier");

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
 * @returns {object[]}
 */
function parseAllDamageProfiles(sourceRoot, lerpValues, cleavePresets) {
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
    } catch {
      // directory may not exist
    }
  }

  const allFiles = [...sharedFiles, ...weaponFiles];

  for (const filePath of allFiles) {
    const lua = readFileSync(filePath, "utf8");
    const sourceFile = basename(filePath);
    const fileProfiles = parseDamageProfileFile(lua, sourceFile, lerpValues, cleavePresets);
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
function collectDamageProfileFiles(dir) {
  const files = [];
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
 * Extracts all `damage_templates.X = { ... }` definitions.
 *
 * @param {string} lua
 * @param {string} sourceFile
 * @param {Record<string, [number, number]>} lerpValues
 * @param {Record<string, object>} cleavePresets
 * @returns {object[]}
 */
function parseDamageProfileFile(lua, sourceFile, lerpValues, cleavePresets) {
  const profiles = [];

  // Parse file-level local variables that define near/far ADM structures
  const localAdmVars = parseLocalAdmVariables(lua, lerpValues);

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
      }
    } catch (err) {
      console.warn(`Warning: failed to parse profile ${profileName} in ${sourceFile}: ${err.message}`);
    }
  }

  return profiles;
}

/**
 * Parse a single profile block into the output shape.
 *
 * @param {string} id
 * @param {string} block - The full `{ ... }` block
 * @param {string} sourceFile
 * @param {Record<string, [number, number]>} lerpValues
 * @param {Record<string, object>} cleavePresets
 * @returns {object|null}
 */
function parseProfileBlock(id, block, sourceFile, lerpValues, cleavePresets, localAdmVars = new Map()) {
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

  // Extract first target entry from targets array
  const firstTarget = parseFirstTarget(block, lerpValues);

  // Determine final values: prefer first target data, fall back to top-level
  const finalPowerDist = firstTarget?.power_distribution || powerDistribution;
  const finalAdm = firstTarget?.armor_damage_modifier || null;
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
 * Parse cleave_distribution from a profile block.
 * Handles both inline `{ attack = X, impact = Y }` and preset references like `single_cleave`.
 *
 * @param {string} block
 * @param {Record<string, object>} cleavePresets
 * @returns {object|null}
 */
function parseCleaveDistribution(block, cleavePresets) {
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
function parseRanges(block) {
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
function parsePowerDistribution(block) {
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
function parseShallowField(block, fieldName) {
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
function parseArmorDamageModifierRanged(block, lerpValues, localAdmVars = new Map()) {
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
function parseNearFarAdm(admBlock, lerpValues) {
  const result = {};
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
 * Parse file-level local variable definitions that hold near/far ADM structures.
 *
 * Matches patterns like:
 *   local assault_armor_mod = { near = { attack = { ... }, impact = { ... } }, far = { ... } }
 *   local armor_modifiers = { p1_m1 = { near = { ... }, far = { ... } }, ... }
 *
 * @param {string} lua - Full file source
 * @param {Record<string, [number, number]>} lerpValues
 * @returns {Map<string, object>} varName (or table.field) -> parsed near/far ADM
 */
function parseLocalAdmVariables(lua, lerpValues) {
  const vars = new Map();

  // Match: local varName = { ... } where the block contains near/far
  const localRe = /^local\s+(\w+)\s*=\s*\{/gm;
  let m;
  while ((m = localRe.exec(lua)) !== null) {
    const varName = m[1];
    const braceStart = m.index + m[0].length - 1;
    const braceEnd = findBalancedBrace(lua, braceStart);
    if (braceEnd === -1) continue;

    const block = lua.slice(braceStart, braceEnd + 1);

    // Check if this looks like a near/far ADM block
    if (block.includes("near = {") && block.includes("far = {")) {
      // Could be a direct near/far block, or a table of named near/far blocks
      // First try direct parse
      const parsed = parseNearFarAdm(block, lerpValues);
      if (parsed) {
        vars.set(varName, parsed);
        continue;
      }
    }

    // Check if this is a table of named sub-entries that each have near/far
    // e.g., local armor_modifiers = { p1_m1 = { near = { ... }, far = { ... } }, ... }
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
      }
    }
  }

  return vars;
}

/**
 * Parse the first target entry from the `targets` array of a profile block.
 *
 * @param {string} block
 * @param {Record<string, [number, number]>} lerpValues
 * @returns {object|null}
 */
function parseFirstTarget(block, lerpValues) {
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

  return parseTargetEntry(entryBlock, lerpValues);
}

/**
 * Parse a single target entry block.
 *
 * @param {string} entryBlock
 * @param {Record<string, [number, number]>} lerpValues
 * @returns {object}
 */
function parseTargetEntry(entryBlock, lerpValues) {
  const result = {};

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

  // armor_damage_modifier (melee -- flat numbers)
  const admStart = entryBlock.indexOf("armor_damage_modifier = {");
  if (admStart !== -1) {
    const admBraceStart = admStart + "armor_damage_modifier = ".length;
    const admBraceEnd = findBalancedBrace(entryBlock, admBraceStart);
    if (admBraceEnd !== -1) {
      const admBlock = entryBlock.slice(admBraceStart, admBraceEnd + 1);
      result.armor_damage_modifier = {};

      for (const channel of ["attack", "impact"]) {
        const chStart = admBlock.indexOf(`${channel} = {`);
        if (chStart === -1) continue;
        const chBraceStart = chStart + `${channel} = `.length;
        const chBraceEnd = findBalancedBrace(admBlock, chBraceStart);
        if (chBraceEnd === -1) continue;
        const chBlock = admBlock.slice(chBraceStart, chBraceEnd + 1);
        result.armor_damage_modifier[channel] = parseArmorTypeValues(chBlock, lerpValues);
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
function parseAllHitscanTemplates(sourceRoot) {
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
    } catch {
      // skip
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
function parseHitscanFile(lua, map) {
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

// -- Phase 5: Weapon action maps ----------------------------------------------

/**
 * Parse all weapon template files and extract action -> profile mappings.
 *
 * @param {string} sourceRoot
 * @param {Map<string, string>} hitscanMap
 * @param {Set<string>} profileIds
 * @returns {object[]}
 */
function parseAllWeaponTemplates(sourceRoot, hitscanMap, profileIds) {
  const actionMaps = [];
  const weaponBaseDir = join(sourceRoot, "scripts", "settings", "equipment", "weapon_templates");

  for (const family of WEAPON_FAMILIES) {
    const familyDir = join(weaponBaseDir, family);
    if (!existsSync(familyDir)) continue;

    let entries;
    try {
      entries = readdirSync(familyDir);
    } catch {
      continue;
    }

    const weaponFiles = entries
      .filter((f) => f.endsWith(".lua") && !f.startsWith("settings_templates") && f !== "weapon_templates.lua")
      .sort();

    for (const f of weaponFiles) {
      const lua = readFileSync(join(familyDir, f), "utf8");
      const weaponName = f.replace(".lua", "");
      const actions = parseWeaponActions(lua, hitscanMap, profileIds);
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
 * @param {Set<string>} profileIds
 * @returns {Record<string, string[]>}
 */
function parseWeaponActions(lua, hitscanMap, profileIds) {
  const result = {};

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
    const profiles = extractProfilesFromAction(actionBlock, hitscanMap, profileIds);

    if (profiles.length > 0) {
      const category = classifyAction(actionName);
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
 * @param {Set<string>} profileIds
 * @returns {string[]}
 */
function extractProfilesFromAction(actionBlock, hitscanMap, profileIds) {
  const profiles = [];

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

  return profiles;
}

/**
 * Classify an action name into a category.
 *
 * @param {string} actionName
 * @returns {string}
 */
function classifyAction(actionName) {
  // Ranged shoot actions
  if (actionName.includes("shoot_hip") || actionName === "action_shoot") return "shoot_hip";
  if (actionName.includes("shoot_zoomed") || actionName.includes("zoom_shoot")) return "shoot_zoomed";
  if (actionName.includes("shoot_braced") || actionName.includes("braced_shoot")) return "shoot_braced";
  if (actionName.includes("charge_shoot") || actionName.includes("shoot_charged") || actionName.includes("charged_shoot")) return "shoot_charged";

  // Melee light attacks
  if (actionName.includes("light")) {
    if (actionName.includes("pushfollow")) return "push_followup";
    return "light_attack";
  }

  // Melee heavy attacks
  if (actionName.includes("heavy")) return "heavy_attack";

  // Weapon special
  if (actionName.includes("special") || actionName.includes("parry")) return "weapon_special";

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
function parseArmorTypeValues(block, lerpValues) {
  const result = {};

  // Match [armor_types.X] = damage_lerp_values.lerp_Y
  const lerpRe = /\[armor_types\.(\w+)\]\s*=\s*damage_lerp_values\.(\w+)/g;
  let m;
  while ((m = lerpRe.exec(block)) !== null) {
    result[m[1]] = lerpValues[m[2]] || [0, 0];
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
function parseAttackImpactPair(block) {
  const result = {};

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
function parseSimpleArmorTypeMap(lua, settingName) {
  const re = new RegExp(
    `power_level_settings\\.${settingName}\\s*=\\s*\\{([\\s\\S]*?)\\}`,
  );
  const match = lua.match(re);
  if (!match) return {};

  const result = {};
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
function parseSimpleArmorTypeMapFromLocal(lua, varName) {
  const re = new RegExp(
    `(?:local\\s+)?${varName}\\s*=\\s*\\{([\\s\\S]*?)\\}`,
  );
  const match = lua.match(re);
  if (!match) return {};

  const result = {};
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
function parseArmorTypeTable(lua, tableName, valueParser) {
  const startRe = new RegExp(
    `power_level_settings\\.${tableName}\\s*=\\s*\\{`,
  );
  const match = lua.match(startRe);
  if (!match) return {};

  const blockStart = match.index + match[0].length - 1;
  const blockEnd = findBalancedBrace(lua, blockStart);
  if (blockEnd === -1) return {};

  const block = lua.slice(blockStart, blockEnd + 1);

  const result = {};
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
function parseArmorConversionMap(lua) {
  const match = lua.match(
    /boost_damage_armor_conversion\s*=\s*\{([\s\S]*?)\}/,
  );
  if (!match) return {};

  const result = {};
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
function parseDefaultArmorDamageModifier(lua) {
  const startRe = /default_armor_damage_modifier\s*=\s*\{/;
  const match = lua.match(startRe);
  if (!match) return {};

  const blockStart = match.index + match[0].length - 1;
  const blockEnd = findBalancedBrace(lua, blockStart);
  if (blockEnd === -1) return {};

  const block = lua.slice(blockStart, blockEnd + 1);
  const result = {};

  for (const channel of ["attack", "impact"]) {
    const chStart = block.indexOf(`${channel} = {`);
    if (chStart === -1) continue;
    const chBraceStart = chStart + `${channel} = `.length;
    const chBraceEnd = findBalancedBrace(block, chBraceStart);
    if (chBraceEnd === -1) continue;
    const chBlock = block.slice(chBraceStart, chBraceEnd + 1);

    const channelResult = {};
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
 * @returns {number}
 */
function extractNumber(lua, re) {
  const m = lua.match(re);
  return m ? Number(m[1]) : 0;
}

/**
 * Find the index of the closing brace matching the opening brace at `startIdx`.
 *
 * @param {string} str
 * @param {number} startIdx - Index of the opening `{`
 * @returns {number} Index of the matching `}`, or -1 if not found
 */
function findBalancedBrace(str, startIdx) {
  if (str[startIdx] !== "{") return -1;
  let depth = 0;
  // Skip string literals and comments
  for (let i = startIdx; i < str.length; i++) {
    const ch = str[i];
    if (ch === "-" && str[i + 1] === "-") {
      // Skip line comment
      const newline = str.indexOf("\n", i);
      if (newline === -1) return -1;
      i = newline;
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
function countBraceDepth(str, position) {
  let depth = 0;
  for (let i = 0; i < position; i++) {
    if (str[i] === "{") depth++;
    if (str[i] === "}") depth--;
  }
  return depth;
}
