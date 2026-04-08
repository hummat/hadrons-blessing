import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCliMain } from "../lib/cli.js";
import { buildClassSideAliasRecord } from "../lib/gl-class-tree-labels.js";
import { normalizeText } from "../lib/normalize.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Hardcoded lookup tables ---
// Derived from data/build-scoring-data.json.
// Keys: entity internal_name. Values: display name from scoring data.

const MELEE_PERK_NAMES = new Map([
  ["weapon_trait_melee_common_wield_increased_unarmored_damage", "Damage (Unarmoured)"],
  ["weapon_trait_melee_common_wield_increased_armored_damage", "Damage (Flak Armoured)"],
  ["weapon_trait_melee_common_wield_increased_resistant_damage", "Damage (Unyielding)"],
  ["weapon_trait_melee_common_wield_increased_berserker_damage", "Damage (Maniacs)"],
  ["weapon_trait_melee_common_wield_increased_super_armor_damage", "Damage (Carapace)"],
  ["weapon_trait_melee_common_wield_increased_disgustingly_resilient_damage", "Damage (Infested)"],
  ["weapon_trait_increase_crit_chance", "Critical Hit Chance"],
  ["weapon_trait_increase_crit_damage", "Critical Hit Damage"],
  ["weapon_trait_increase_stamina", "Stamina"],
  ["weapon_trait_increase_weakspot_damage", "Weakspot Damage"],
  ["weapon_trait_increase_damage", "Damage (flat)"],
  ["weapon_trait_increase_finesse", "Finesse"],
  ["weapon_trait_increase_power", "Power Level"],
  ["weapon_trait_increase_impact", "Impact"],
  ["weapon_trait_reduced_block_cost", "Block Efficiency"],
  ["weapon_trait_increase_damage_elites", "Damage (Elites)"],
  ["weapon_trait_increase_damage_hordes", "Damage (Hordes)"],
  ["weapon_trait_increase_damage_specials", "Damage (Specialists)"],
  ["weapon_trait_reduce_sprint_cost", "Sprint Efficiency"],
]);

const RANGED_PERK_NAMES = new Map([
  ["weapon_trait_ranged_common_wield_increased_unarmored_damage", "Damage (Unarmoured)"],
  ["weapon_trait_ranged_common_wield_increased_armored_damage", "Damage (Flak Armoured)"],
  ["weapon_trait_ranged_common_wield_increased_resistant_damage", "Damage (Unyielding)"],
  ["weapon_trait_ranged_common_wield_increased_berserker_damage", "Damage (Maniacs)"],
  ["weapon_trait_ranged_common_wield_increased_super_armor_damage", "Damage (Carapace)"],
  ["weapon_trait_ranged_common_wield_increased_disgustingly_resilient_damage", "Damage (Infested)"],
  ["weapon_trait_ranged_increase_crit_chance", "Critical Hit Chance"],
  ["weapon_trait_ranged_increase_crit_damage", "Critical Hit Damage"],
  ["weapon_trait_ranged_increase_stamina", "Stamina (while active)"],
  ["weapon_trait_ranged_increase_weakspot_damage", "Weakspot Damage"],
  ["weapon_trait_ranged_increase_damage", "Damage (flat)"],
  ["weapon_trait_ranged_increase_finesse", "Finesse"],
  ["weapon_trait_ranged_increase_power", "Power Level"],
  ["weapon_trait_ranged_increase_damage_elites", "Damage (Elites)"],
  ["weapon_trait_ranged_increase_damage_hordes", "Damage (Hordes)"],
  ["weapon_trait_ranged_increase_damage_specials", "Damage (Specialists)"],
  ["weapon_trait_ranged_increased_reload_speed", "Reload Speed"],
]);

const GADGET_TRAIT_NAMES = new Map([
  ["gadget_block_cost_reduction", "Block Efficiency"],
  ["gadget_cooldown_reduction", "Combat Ability Regen"],
  ["gadget_corruption_resistance", "Corruption Resistance"],
  ["gadget_damage_reduction_vs_bombers", "DR vs Bombers"],
  ["gadget_damage_reduction_vs_flamers", "DR vs Flamers"],
  ["gadget_damage_reduction_vs_gunners", "DR vs Gunners"],
  ["gadget_damage_reduction_vs_hounds", "DR vs Pox Hounds"],
  ["gadget_damage_reduction_vs_mutants", "DR vs Mutants"],
  ["gadget_damage_reduction_vs_snipers", "DR vs Snipers"],
  ["gadget_health_increase", "Health"],
  ["gadget_mission_credits_increase", "Ordo Dockets"],
  ["gadget_mission_reward_gear_instead_of_weapon_increase", "Curio Drop Chance"],
  ["gadget_mission_xp_increase", "Experience"],
  ["gadget_revive_speed_increase", "Revive Speed"],
  ["gadget_sprint_cost_reduction", "Sprint Efficiency"],
  ["gadget_stamina_increase", "Max Stamina"],
  ["gadget_stamina_regeneration", "Stamina Regeneration"],
  ["gadget_toughness_increase", "Toughness"],
  ["gadget_toughness_regen_delay", "Toughness Regen Speed"],
]);

// 9 unambiguous concept_suffix → community_name mappings from scoring data.
// Only suffixes that map to exactly one community name across all weapons
// AND do not collide with existing aliases on other name_family entities.
// Excluded: warp_charge_power_bonus → "Blazing Spirit" collides with
// shared.name_family.blessing.blazing_spirit (duplicate family, needs merge).
const BLESSING_NAMES = new Map([
  ["allow_flanking_and_increased_damage_when_flanking", "Flanking Fire"],
  ["bleed_on_non_weakspot_hit", "Lacerate"],
  ["chance_to_explode_elites_on_kill", "Soulfire"],
  ["charge_level_increases_critical_strike_chance", "Charge Crit"],
  ["extended_activation_duration_on_chained_attacks", "Cycler"],
  ["faster_reload_on_empty_clip", "Charmed Reload"],
  ["increased_weakspot_damage_against_bleeding", "Flesh Tearer"],
  ["power_bonus_on_first_attack", "Haymaker"],
  ["toughness_on_elite_kills", "Gloryhunter"],
]);

function buildPerkAliasRecord(entityId: string, displayName: string, slot: string) {
  return {
    text: displayName,
    normalized_text: normalizeText(displayName),
    candidate_entity_id: entityId,
    alias_kind: "community_name",
    match_mode: "fuzzy_allowed",
    provenance: "build-scoring-data",
    confidence: "high",
    context_constraints: {
      require_all: [{ key: "slot", value: slot }],
      prefer: [],
    },
    rank_weight: 150,
    notes: "",
  };
}

function slotFromEntityId(entityId: string) {
  if (entityId.includes(".melee.")) return "melee";
  if (entityId.includes(".ranged.")) return "ranged";
  return null;
}

function generatePerkAliases(entities: AnyRecord[]) {
  const aliases = [];
  for (const entity of entities) {
    if (entity.kind !== "weapon_perk") continue;
    const slot = slotFromEntityId(entity.id);
    if (!slot) continue;
    const lookupTable = slot === "melee" ? MELEE_PERK_NAMES : RANGED_PERK_NAMES;
    const displayName = lookupTable.get(entity.internal_name);
    if (!displayName) continue;
    aliases.push(buildPerkAliasRecord(entity.id, displayName, slot));
  }
  return aliases;
}

function enrichGadgetTraits(entities: AnyRecord[]) {
  let count = 0;
  for (const entity of entities) {
    if (entity.kind !== "gadget_trait") continue;
    if (entity.ui_name != null) continue;
    const displayName = GADGET_TRAIT_NAMES.get(entity.internal_name);
    if (!displayName) continue;
    entity.ui_name = displayName;
    count++;
  }
  return count;
}

const NAME_FAMILY_PREFIX = "shared.name_family.blessing.";

function enrichNameFamilies(entities: AnyRecord[]) {
  let count = 0;
  for (const entity of entities) {
    if (entity.kind !== "name_family") continue;
    if (entity.ui_name != null) continue;
    if (!entity.id.startsWith(NAME_FAMILY_PREFIX)) continue;
    const slug = entity.id.slice(NAME_FAMILY_PREFIX.length);
    const displayName = BLESSING_NAMES.get(slug);
    if (!displayName) continue;
    entity.ui_name = displayName;
    count++;
  }
  return count;
}

const TITLE_CASE_ARTICLES = new Set([
  "a", "an", "and", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "vs",
]);

function titleCaseSlug(slug: string) {
  return slug
    .split("_")
    .map((word, i) => {
      if (i !== 0 && TITLE_CASE_ARTICLES.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function enrichBlessingNamesFromSlugs(entities: AnyRecord[], glBlessings: AnyRecord[]) {
  const glNames = new Set(glBlessings.map((b) => b.display_name.toLowerCase()));
  let count = 0;
  for (const entity of entities) {
    if (entity.kind !== "name_family") continue;
    if (entity.ui_name != null) continue;
    if (!entity.id.startsWith(NAME_FAMILY_PREFIX)) continue;
    const slug = entity.id.slice(NAME_FAMILY_PREFIX.length);
    const candidate = titleCaseSlug(slug);
    if (!glNames.has(candidate.toLowerCase())) continue;
    entity.ui_name = candidate;
    count++;
  }
  return count;
}

function enrichWeaponNames(entities: AnyRecord[], mapping: AnyRecord[]) {
  const nameByTemplateId = new Map(mapping.map((m) => [m.template_id, m.gl_name]));
  let count = 0;
  for (const entity of entities) {
    if (entity.kind !== "weapon") continue;
    if (entity.ui_name != null) continue;
    const displayName = nameByTemplateId.get(entity.internal_name);
    if (!displayName) continue;
    entity.ui_name = displayName;
    count++;
  }
  return count;
}

function generateWeaponAliases(mapping: AnyRecord[], entities: AnyRecord[]) {
  const entityByInternalName = new Map(entities.map((e) => [e.internal_name, e]));
  const aliases = [];
  for (const entry of mapping) {
    const entity = entityByInternalName.get(entry.template_id);
    if (!entity) continue;
    aliases.push({
      text: entry.gl_name,
      normalized_text: normalizeText(entry.gl_name),
      candidate_entity_id: entity.id,
      alias_kind: "gameslantern_name",
      match_mode: "fuzzy_allowed",
      provenance: "gl-catalog",
      confidence: "high",
      context_constraints: {
        require_all: [{ key: "slot", value: entity.attributes.slot }],
        prefer: [],
      },
      rank_weight: 120,
      notes: "",
    });
  }
  return aliases;
}

function mergeAliases(existingAliases: AnyRecord[], newAliases: AnyRecord[]) {
  const existingByEntity = new Map();
  for (let i = 0; i < existingAliases.length; i++) {
    const key = [
      existingAliases[i].candidate_entity_id,
      existingAliases[i].alias_kind,
      existingAliases[i].text,
    ].join("|");
    existingByEntity.set(key, i);
  }

  const merged = [...existingAliases];
  let added = 0;
  let updated = 0;
  for (const alias of newAliases) {
    const key = [
      alias.candidate_entity_id,
      alias.alias_kind,
      alias.text,
    ].join("|");
    const existingIndex = existingByEntity.get(key);
    if (existingIndex != null) {
      merged[existingIndex] = alias;
      updated++;
    } else {
      merged.push(alias);
      added++;
    }
  }
  return { merged, added, updated };
}

function generateClassSideAliases(entries: AnyRecord[]) {
  return entries.map((entry) =>
    buildClassSideAliasRecord({
      class: entry.class,
      kind: entry.kind,
      display_name: entry.display_name,
      normalized_text: entry.normalized_text,
      entity_id: entry.entity_id,
    }),
  );
}

function main() {
  const ENTITIES_ROOT = resolve(__dirname, "..", "..", "data", "ground-truth", "entities");
  const ALIASES_ROOT = resolve(__dirname, "..", "..", "data", "ground-truth", "aliases");

  const weaponsPath = resolve(ENTITIES_ROOT, "shared-weapons.json");
  const namesPath = resolve(ENTITIES_ROOT, "shared-names.json");
  const aliasesPath = resolve(ALIASES_ROOT, "shared-guides.json");

  const weaponEntities = JSON.parse(readFileSync(weaponsPath, "utf8"));
  const nameEntities = JSON.parse(readFileSync(namesPath, "utf8"));
  const existingAliases = JSON.parse(readFileSync(aliasesPath, "utf8"));

  const perkAliases = generatePerkAliases(weaponEntities);
  const gadgetCount = enrichGadgetTraits(weaponEntities);
  const blessingCount = enrichNameFamilies(nameEntities);
  let slugBlessingCount = 0;
  const glCatalogPath = resolve(__dirname, "..", "..", "data", "ground-truth", "generated", "gl-catalog.json");
  if (existsSync(glCatalogPath)) {
    const catalog = JSON.parse(readFileSync(glCatalogPath, "utf8"));
    slugBlessingCount = enrichBlessingNamesFromSlugs(nameEntities, catalog.blessings);
  } else {
    console.warn("Warning: gl-catalog.json not found, skipping slug-based blessing enrichment");
  }
  let allNewAliases = [...perkAliases];

  const weaponMappingPath = resolve(__dirname, "..", "..", "data", "ground-truth", "weapon-name-mapping.json");
  if (existsSync(weaponMappingPath)) {
    const weaponMapping = JSON.parse(readFileSync(weaponMappingPath, "utf8"));
    const weaponCount = enrichWeaponNames(weaponEntities, weaponMapping);
    const weaponAliases = generateWeaponAliases(weaponMapping, weaponEntities);
    allNewAliases = [...allNewAliases, ...weaponAliases];
    console.log(`Weapon ui_names: ${weaponCount} set`);
    console.log(`Weapon aliases: ${weaponAliases.length} generated`);
  } else {
    console.warn("Warning: weapon-name-mapping.json not found, skipping weapon enrichment");
  }

  const { merged, added, updated } = mergeAliases(existingAliases, allNewAliases);

  writeFileSync(weaponsPath, JSON.stringify(weaponEntities, null, 2) + "\n");
  writeFileSync(namesPath, JSON.stringify(nameEntities, null, 2) + "\n");
  writeFileSync(aliasesPath, JSON.stringify(merged, null, 2) + "\n");

  const glClassTreePath = resolve(__dirname, "..", "..", "data", "ground-truth", "generated", "gl-class-tree-labels.json");
  const classAliasStats: Array<{ className: string; added: number; updated: number; total: number }> = [];
  if (existsSync(glClassTreePath)) {
    const classEntries = JSON.parse(readFileSync(glClassTreePath, "utf8"));
    const byClass = new Map<string, AnyRecord[]>();
    for (const entry of classEntries) {
      if (!byClass.has(entry.class)) {
        byClass.set(entry.class, []);
      }
      byClass.get(entry.class)!.push(entry);
    }

    for (const [className, entries] of byClass) {
      const classAliasesPath = resolve(ALIASES_ROOT, `${className}.json`);
      if (!existsSync(classAliasesPath)) {
        console.warn(`Warning: alias file not found for class "${className}" at ${classAliasesPath}, skipping`);
        continue;
      }
      const existingClassAliases = JSON.parse(readFileSync(classAliasesPath, "utf8"));
      const generatedAliases = generateClassSideAliases(entries);
      const result = mergeAliases(existingClassAliases, generatedAliases);
      writeFileSync(classAliasesPath, JSON.stringify(result.merged, null, 2) + "\n");
      classAliasStats.push({
        className,
        added: result.added,
        updated: result.updated,
        total: generatedAliases.length,
      });
    }
  } else {
    console.warn("Warning: gl-class-tree-labels.json not found, skipping class-side alias enrichment");
  }

  console.log(`Aliases merged: ${added} added, ${updated} updated (${allNewAliases.length} total)`);
  console.log(`  - perk aliases: ${perkAliases.length}`);
  console.log(`Gadget traits: ${gadgetCount} ui_name set`);
  console.log(`Name families: ${blessingCount} ui_name set (hardcoded)`);
  console.log(`Name families: ${slugBlessingCount} ui_name set (from GL slugs)`);
  for (const stat of classAliasStats.sort((a, b) => a.className.localeCompare(b.className))) {
    console.log(`Class aliases (${stat.className}): ${stat.added} added, ${stat.updated} updated (${stat.total} generated)`);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await runCliMain("entities:enrich", async () => { main(); });
}

export {
  MELEE_PERK_NAMES,
  RANGED_PERK_NAMES,
  GADGET_TRAIT_NAMES,
  BLESSING_NAMES,
  buildPerkAliasRecord,
  generatePerkAliases,
  enrichGadgetTraits,
  enrichNameFamilies,
  enrichBlessingNamesFromSlugs,
  enrichWeaponNames,
  generateWeaponAliases,
  mergeAliases,
  generateClassSideAliases,
};
