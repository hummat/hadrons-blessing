#!/usr/bin/env node
// Generate weapon-name-mapping.json: GL display names → internal template IDs.
//
// Usage:
//   node scripts/generate-weapon-name-mapping.mjs
//
// Output: data/ground-truth/weapon-name-mapping.json

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Hardcoded data ---

// 27 mappings from the DarktideRenameRevert community mod.
// Keys: internal template IDs (without shared.weapon. prefix).
// Values: pre-rename display names (may differ from current GL names due to renames).
const RENAME_REVERT_MAP = new Map([
  ["autogun_p1_m2", "Vraks Mk V Infantry Autogun"],
  ["autogun_p1_m3", "Columnus Mk VIII Infantry Autogun"],
  ["autogun_p2_m1", "Vraks Mk II Braced Autogun"],
  ["autogun_p3_m1", "Columnus Mk III Vigilant Autogun"],
  ["autogun_p3_m2", "Graia Mk VII Vigilant Autogun"],
  ["autogun_p3_m3", "Agripinaa Mk IX Vigilant Autogun"],
  ["autopistol_p1_m1", "Ius Mk IV Shredder Autopistol"],
  ["boltpistol_p1_m1", "Godwyn-Branx Mk IV Bolt Pistol"],
  ["chainsword_2h_p1_m1", "Tigrus Mk III Heavy Eviscerator"],
  ["combataxe_p1_m1", "Rashad Mk III Combat Axe"],
  ["combataxe_p3_m1", "Munitorum Mk I Sapper Shovel"],
  ["lasgun_p1_m1", "Kantrael Mk VII Infantry Lasgun"],
  ["lasgun_p1_m2", "Kantrael Mk IIb Infantry Lasgun"],
  ["lasgun_p1_m3", "Kantrael Mk IX Infantry Lasgun"],
  ["lasgun_p2_m1", "Lucius MK IIIa Helbore Lasgun"],
  ["lasgun_p2_m2", "Lucius MK V Helbore Lasgun"],
  ["lasgun_p2_m3", "Lucius Mk IV Helbore Lasgun"],
  ["lasgun_p3_m1", "Accatran Mk VIc Recon Lasgun"],
  ["lasgun_p3_m2", "Accatran Mk XII Recon Lasgun"],
  ["lasgun_p3_m3", "Accatran Mk XIV Recon Lasgun"],
  ["ogryn_pickaxe_2h_p1_m1", "Branx Mk Ia Delver's Pickaxe"],
  ["ogryn_pickaxe_2h_p1_m2", "Borovian Mk III Delver's Pickaxe"],
  ["ogryn_pickaxe_2h_p1_m3", "Karsolas Mk II Delver's Pickaxe"],
  ["powermaul_p1_m2", "Munitorum Mk III Shock Maul"],
  ["powersword_p1_m1", "Scandar Mk III Power Sword"],
  ["powersword_p1_m2", "Achlys Mk VI Power Sword"],
  ["shotgun_p2_m1", "Crucis Mk XI Double-Barrelled Shotgun"],
]);

// GL URL slugs that can't be auto-derived from existing aliases because
// no known mapping covers that family yet. Maps slug → merged family name.
const SLUG_TO_FAMILY_OVERRIDES = new Map([
  ["assault-chainaxe", "chainaxe_p1"],
  ["assault-chainsword", "chainsword_p1"],
  ["bully-club", "ogryn_club_p2"],
  ["cleaver", "ogryn_combatblade_p1"],
  ["combat-blade", "combatknife_p1"],
  ["combat-shotgun", "shotgun_p1"],
  ["crowbar", "crowbar_p1"],
  ["crusher", "powermaul_2h_p1"],
  ["dual-autopistols", "dual_autopistols_p1"],
  ["grenadier-gauntlet", "ogryn_gauntlet_p1"],
  ["heavy-laspistol", "laspistol_p1"],
  ["heavy-stubber", "ogryn_heavystubber_p1"],
  ["heavy-sword", "combatsword_p3"],
  ["kickback", "ogryn_thumper_p1"],
  ["quickdraw-stub-revolver", "stubrevolver_p1"],
  ["tactical-axe", "combataxe_p2"],
  ["thunder-hammer", "thunderhammer_2h_p1"],
  ["voidstrike-force-staff", "forcestaff_p1"],
]);

// --- Pure functions ---

/**
 * Extract the logical (merged) family name from a template ID.
 * E.g. "autogun_p2_m1" → "autogun_p2", "ogryn_club_p1_m3" → "ogryn_club_p1"
 * @param {string} templateId
 * @returns {string}
 */
function logicalFamily(templateId) {
  const match = templateId.match(/^(.+)_m\d+$/);
  return match ? match[1] : templateId;
}

/**
 * Build merged familyMarks: group weapon entities by their logical family
 * (derived from internal_name, not the potentially-split weapon_family attribute).
 * Excludes bot weapons.
 * @param {Array} weaponEntities - Entities from shared-weapons.json
 * @returns {Object<string, string[]>} family → [template_id, ...]
 */
function buildMergedFamilyMarks(weaponEntities) {
  const result = {};
  for (const entity of weaponEntities) {
    if (entity.kind !== "weapon") continue;
    if (entity.internal_name.startsWith("bot_")) continue;
    if (entity.internal_name.startsWith("high_bot_")) continue;
    const family = logicalFamily(entity.internal_name);
    if (!result[family]) result[family] = [];
    result[family].push(entity.internal_name);
  }
  return result;
}

/**
 * Match existing weapon aliases to GL weapons by exact display name.
 * @param {Array<{text: string, candidate_entity_id: string}>} aliases
 * @param {Array<{display_name: string, url_slug: string}>} glWeapons
 * @returns {Array<{gl_name: string, template_id: string, source: string}>}
 */
function matchByKnownAliases(aliases, glWeapons) {
  const glByName = new Map(glWeapons.map((w) => [w.display_name, w]));
  const seen = new Set();
  const result = [];

  for (const alias of aliases) {
    if (!alias.candidate_entity_id.includes(".weapon.")) continue;
    const glWeapon = glByName.get(alias.text);
    if (!glWeapon) continue;
    const templateId = alias.candidate_entity_id.replace(/^shared\.weapon\./, "");
    if (seen.has(templateId)) continue;
    seen.add(templateId);
    result.push({
      gl_name: alias.text,
      template_id: templateId,
      source: "existing_alias",
    });
  }
  return result;
}

/**
 * Derive a slug→family map from known mappings.
 * For each known mapping, finds the GL weapon, gets its url_slug,
 * finds which merged family the template_id belongs to, and records the mapping.
 * Also merges in SLUG_TO_FAMILY_OVERRIDES.
 * @param {Array<{gl_name: string, template_id: string}>} knownMappings
 * @param {Array<{display_name: string, url_slug: string}>} glWeapons
 * @param {Object<string, string[]>} familyMarks - merged family → [template_id, ...]
 * @returns {Map<string, string>} slug → family
 */
function buildSlugToFamilyMap(knownMappings, glWeapons, familyMarks) {
  const glByName = new Map(glWeapons.map((w) => [w.display_name, w]));
  const result = new Map();

  for (const mapping of knownMappings) {
    const glWeapon = glByName.get(mapping.gl_name);
    if (!glWeapon) continue;
    const slug = glWeapon.url_slug;

    // Find which family this template_id belongs to
    for (const [family, members] of Object.entries(familyMarks)) {
      if (members.includes(mapping.template_id)) {
        result.set(slug, family);
        break;
      }
    }
  }

  // Merge in hardcoded overrides
  for (const [slug, family] of SLUG_TO_FAMILY_OVERRIDES) {
    if (!result.has(slug)) {
      result.set(slug, family);
    }
  }

  return result;
}

/**
 * Match GL weapons in singleton families (exactly 1 mark, exactly 1 unmatched GL weapon).
 * @param {Map<string, string>} slugToFamily
 * @param {Object<string, string[]>} familyMarks
 * @param {Array<{display_name: string, url_slug: string}>} glWeapons
 * @param {Map<string, string>} alreadyMapped - template_id → gl_name
 * @returns {Array<{gl_name: string, template_id: string, source: string}>}
 */
function matchSingletonFamilies(slugToFamily, familyMarks, glWeapons, alreadyMapped) {
  const result = [];

  for (const [slug, family] of slugToFamily) {
    const marks = familyMarks[family];
    if (!marks || marks.length !== 1) continue;

    const mark = marks[0];
    if (alreadyMapped.has(mark)) continue;

    // Find unmatched GL weapons with this slug
    const mappedNames = new Set(alreadyMapped.values());
    const unmatchedGl = glWeapons.filter(
      (w) => w.url_slug === slug && !mappedNames.has(w.display_name),
    );
    if (unmatchedGl.length !== 1) continue;

    result.push({
      gl_name: unmatchedGl[0].display_name,
      template_id: mark,
      source: "singleton_family",
    });
  }
  return result;
}

/**
 * For each slug→family, find unmatched marks and unmatched GL weapons.
 * If exactly 1 mark and 1 GL weapon remain, match them.
 * @param {Map<string, string>} slugToFamily
 * @param {Object<string, string[]>} familyMarks
 * @param {Array<{display_name: string, url_slug: string}>} glWeapons
 * @param {Map<string, string>} alreadyMapped - template_id → gl_name
 * @returns {Array<{gl_name: string, template_id: string, source: string}>}
 */
function deduceLastRemaining(slugToFamily, familyMarks, glWeapons, alreadyMapped) {
  const result = [];
  const mappedNames = new Set(alreadyMapped.values());

  for (const [slug, family] of slugToFamily) {
    const marks = familyMarks[family];
    if (!marks) continue;

    const unmatchedMarks = marks.filter((m) => !alreadyMapped.has(m));
    const unmatchedGl = glWeapons.filter(
      (w) => w.url_slug === slug && !mappedNames.has(w.display_name),
    );

    if (unmatchedMarks.length === 1 && unmatchedGl.length === 1) {
      result.push({
        gl_name: unmatchedGl[0].display_name,
        template_id: unmatchedMarks[0],
        source: "last_remaining",
      });
    }
  }
  return result;
}

// --- Main ---

function main() {
  const DATA_ROOT = resolve(__dirname, "..", "data", "ground-truth");
  const glCatalogPath = resolve(DATA_ROOT, "generated", "gl-catalog.json");
  const aliasesPath = resolve(DATA_ROOT, "aliases", "shared-guides.json");
  const entitiesPath = resolve(DATA_ROOT, "entities", "shared-weapons.json");
  const outputPath = resolve(DATA_ROOT, "weapon-name-mapping.json");

  // 1. Read inputs
  const glCatalog = JSON.parse(readFileSync(glCatalogPath, "utf8"));
  const aliases = JSON.parse(readFileSync(aliasesPath, "utf8"));
  const weaponEntities = JSON.parse(readFileSync(entitiesPath, "utf8"));
  const glWeapons = glCatalog.weapons;

  // 4. Read existing mapping if it exists (preserve manual entries)
  let existingManual = [];
  if (existsSync(outputPath)) {
    const existing = JSON.parse(readFileSync(outputPath, "utf8"));
    existingManual = existing.filter((e) => e.source === "manual");
  }

  // 5. Build merged familyMarks
  const familyMarks = buildMergedFamilyMarks(weaponEntities);

  // Track all mappings
  const alreadyMapped = new Map(); // template_id → gl_name
  const allMappings = []; // { gl_name, template_id, source }

  const mappedGlNamesSet = new Set(); // track gl_names already taken

  function addMappings(entries) {
    let added = 0;
    for (const entry of entries) {
      if (alreadyMapped.has(entry.template_id)) continue;
      if (mappedGlNamesSet.has(entry.gl_name)) continue;
      alreadyMapped.set(entry.template_id, entry.gl_name);
      mappedGlNamesSet.add(entry.gl_name);
      allMappings.push(entry);
      added++;
    }
    return added;
  }

  // 6a. Match by known aliases
  const aliasMatches = matchByKnownAliases(
    aliases.filter((a) => a.candidate_entity_id.includes(".weapon.")),
    glWeapons,
  );
  addMappings(aliasMatches);
  console.error(`Pass 1 (existing aliases): ${aliasMatches.length} matched`);

  // 6b. Add RENAME_REVERT_MAP entries
  const glByName = new Map(glWeapons.map((w) => [w.display_name, w]));
  const revertEntries = [];
  for (const [templateId, glName] of RENAME_REVERT_MAP) {
    if (glByName.has(glName) && !alreadyMapped.has(templateId)) {
      revertEntries.push({
        gl_name: glName,
        template_id: templateId,
        source: "rename_revert_mod",
      });
    }
  }
  addMappings(revertEntries);
  console.error(`Pass 2 (rename revert mod): ${revertEntries.length} matched`);

  // 6c. Build slug→family map from all known mappings so far
  const slugToFamily = buildSlugToFamilyMap(allMappings, glWeapons, familyMarks);
  console.error(`Slug→family map: ${slugToFamily.size} entries`);

  // 6d. Match singleton families
  const singletonMatches = matchSingletonFamilies(
    slugToFamily,
    familyMarks,
    glWeapons,
    alreadyMapped,
  );
  addMappings(singletonMatches);
  console.error(`Pass 3 (singleton families): ${singletonMatches.length} matched`);

  // 6e. Deduce last remaining (multiple passes)
  let deducePass = 0;
  let totalDeduced = 0;
  while (true) {
    const deduced = deduceLastRemaining(
      slugToFamily,
      familyMarks,
      glWeapons,
      alreadyMapped,
    );
    if (deduced.length === 0) break;
    const added = addMappings(deduced);
    if (added === 0) break; // guard against infinite loop if all deduced are duplicates
    totalDeduced += added;
    deducePass++;
  }
  console.error(
    `Pass 4 (last remaining, ${deducePass} rounds): ${totalDeduced} matched`,
  );

  // 7. Merge with existing manual entries
  for (const manual of existingManual) {
    if (!alreadyMapped.has(manual.template_id)) {
      alreadyMapped.set(manual.template_id, manual.gl_name);
      allMappings.push(manual);
    }
  }

  // 8. Write output
  allMappings.sort((a, b) => a.template_id.localeCompare(b.template_id));
  writeFileSync(outputPath, JSON.stringify(allMappings, null, 2) + "\n");
  console.error(`\nWritten ${allMappings.length} mappings to ${outputPath}`);

  // 9. Report gaps
  const mappedGlNames = new Set(allMappings.map((m) => m.gl_name));
  const gaps = glWeapons.filter((w) => !mappedGlNames.has(w.display_name));
  if (gaps.length > 0) {
    console.error(`\n${gaps.length} GL weapons still unmapped:`);
    for (const gap of gaps) {
      console.error(`  ${gap.display_name} (slug: ${gap.url_slug})`);
    }
  } else {
    console.error("\nAll GL weapons mapped!");
  }

  // Also report template IDs with no GL match
  const allTemplateIds = Object.values(familyMarks).flat();
  const mappedTemplateIds = new Set(allMappings.map((m) => m.template_id));
  const unmappedTemplates = allTemplateIds.filter((t) => !mappedTemplateIds.has(t));
  if (unmappedTemplates.length > 0) {
    console.error(`\n${unmappedTemplates.length} internal weapons with no GL match:`);
    for (const t of unmappedTemplates.sort()) {
      console.error(`  ${t} (family: ${logicalFamily(t)})`);
    }
  }
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();

export {
  matchByKnownAliases,
  buildSlugToFamilyMap,
  matchSingletonFamilies,
  deduceLastRemaining,
  buildMergedFamilyMarks,
  logicalFamily,
  RENAME_REVERT_MAP,
  SLUG_TO_FAMILY_OVERRIDES,
};
