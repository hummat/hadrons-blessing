import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeText } from "./ground-truth/lib/normalize.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Hardcoded lookup tables ---
// Derived from scripts/build-scoring-data.json.
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

// 10 unambiguous concept_suffix → community_name mappings from scoring data.
// Only suffixes that map to exactly one community name across all weapons.
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
  ["warp_charge_power_bonus", "Blazing Spirit"],
]);

function buildPerkAliasRecord(entityId, displayName, slot) {
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

function slotFromEntityId(entityId) {
  if (entityId.includes(".melee.")) return "melee";
  if (entityId.includes(".ranged.")) return "ranged";
  return null;
}

function generatePerkAliases(entities) {
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

function enrichGadgetTraits(entities) {
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

function enrichNameFamilies(entities) {
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

function mergeAliases(existingAliases, newAliases) {
  const existingByEntity = new Map();
  for (let i = 0; i < existingAliases.length; i++) {
    const key = existingAliases[i].candidate_entity_id + "|" + existingAliases[i].alias_kind;
    existingByEntity.set(key, i);
  }

  const merged = [...existingAliases];
  let added = 0;
  let updated = 0;
  for (const alias of newAliases) {
    const key = alias.candidate_entity_id + "|" + alias.alias_kind;
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

function main() {
  const ENTITIES_ROOT = resolve(__dirname, "..", "data", "ground-truth", "entities");
  const ALIASES_ROOT = resolve(__dirname, "..", "data", "ground-truth", "aliases");

  const weaponsPath = resolve(ENTITIES_ROOT, "shared-weapons.json");
  const namesPath = resolve(ENTITIES_ROOT, "shared-names.json");
  const aliasesPath = resolve(ALIASES_ROOT, "shared-guides.json");

  const weaponEntities = JSON.parse(readFileSync(weaponsPath, "utf8"));
  const nameEntities = JSON.parse(readFileSync(namesPath, "utf8"));
  const existingAliases = JSON.parse(readFileSync(aliasesPath, "utf8"));

  const perkAliases = generatePerkAliases(weaponEntities);
  const gadgetCount = enrichGadgetTraits(weaponEntities);
  const blessingCount = enrichNameFamilies(nameEntities);
  const { merged, added, updated } = mergeAliases(existingAliases, perkAliases);

  writeFileSync(weaponsPath, JSON.stringify(weaponEntities, null, 2) + "\n");
  writeFileSync(namesPath, JSON.stringify(nameEntities, null, 2) + "\n");
  writeFileSync(aliasesPath, JSON.stringify(merged, null, 2) + "\n");

  console.log(`Perk aliases: ${added} added, ${updated} updated (${perkAliases.length} total)`);
  console.log(`Gadget traits: ${gadgetCount} ui_name set`);
  console.log(`Name families: ${blessingCount} ui_name set`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
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
  mergeAliases,
};
