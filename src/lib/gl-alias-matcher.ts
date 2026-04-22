import { normalizeText } from "./normalize.js";
import type { GroundTruthIndex } from "./ground-truth-index.js";
import type { GlAliasCorpusEntry } from "./gl-alias-corpus.js";
import type { AliasSchemaJson, EntityBaseSchemaJson } from "../generated/schema-types.js";

export type MatchState = "high_confidence_match" | "review_required" | "unmatched";

export interface MatchResult {
  state: MatchState;
  candidate_entity_id?: string;
  candidates: string[];
  reason: string;
}

function hasConstraint(alias: AliasSchemaJson, key: string, value: string): boolean {
  return alias.context_constraints.require_all.some((rule) => rule.key === key && rule.value === value);
}

function entryConstraintValue(entry: GlAliasCorpusEntry, key: string): string | undefined {
  if (key === "kind") {
    return entry.domain;
  }

  if (key === "slot") {
    return entry.slot;
  }

  if (key === "class") {
    return entry.class;
  }

  const metadataValue = entry.metadata?.[key];
  return typeof metadataValue === "string" ? metadataValue : undefined;
}

function normalizePerkAliasLabel(text: string): string {
  return normalizeText(text)
    .replace(/\bweak spot\b/g, "weakspot")
    .replace(/\bweapon is active\b/g, "while active")
    .replace(/\bcritical strike\b/g, "critical hit")
    .replace(/\bgroaners poxwalkers\b/g, "hordes")
    .replace(/\b\d+\b/g, "")
    .replace(/\b(increase|increased|melee|ranged|enemies|by)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function exactAliasMatchesEntry(alias: AliasSchemaJson, entry: GlAliasCorpusEntry): boolean {
  if (alias.normalized_text !== entry.normalized_label) {
    return false;
  }

  return alias.context_constraints.require_all.every((rule) => entryConstraintValue(entry, rule.key) === rule.value);
}

function matchExistingAlias(entry: GlAliasCorpusEntry, index: GroundTruthIndex, idPrefix: string): MatchResult | null {
  const alias = index.aliases.find((candidate) =>
    candidate.candidate_entity_id.startsWith(idPrefix) && exactAliasMatchesEntry(candidate, entry),
  );
  if (!alias) {
    return null;
  }

  return {
    state: "high_confidence_match",
    candidate_entity_id: alias.candidate_entity_id,
    candidates: [alias.candidate_entity_id],
    reason: "matched existing exact alias",
  };
}

function matchWeaponPerk(entry: GlAliasCorpusEntry, index: GroundTruthIndex): MatchResult {
  const normalizedEntry = normalizePerkAliasLabel(entry.raw_label);
  const aliases = index.aliases.filter((candidate) =>
    candidate.candidate_entity_id.startsWith("shared.weapon_perk.")
    && (!entry.slot || hasConstraint(candidate, "slot", entry.slot))
    && normalizePerkAliasLabel(candidate.text) === normalizedEntry,
  );

  const candidateIds = [...new Set(aliases.map((alias) => alias.candidate_entity_id))].sort();
  if (candidateIds.length === 1) {
    return {
      state: "high_confidence_match",
      candidate_entity_id: candidateIds[0],
      candidates: candidateIds,
      reason: "matched normalized perk label within slot",
    };
  }

  return {
    state: candidateIds.length > 1 ? "review_required" : "unmatched",
    candidates: candidateIds,
    reason: candidateIds.length > 1 ? "multiple normalized perk matches" : "no normalized perk match",
  };
}

function blessingFamilies(index: GroundTruthIndex): EntityBaseSchemaJson[] {
  return index.entities.filter((entity) =>
    entity.kind === "name_family"
    && entity.id.startsWith("shared.name_family.blessing."),
  );
}

const CURATED_GL_BLESSING_LABELS = new Map<string, string>([
  ["agile", "shared.name_family.blessing.weakspot_hit_resets_dodge_count"],
  ["all or nothing", "shared.name_family.blessing.power_bonus_scaled_on_stamina"],
  ["armourbane", "shared.name_family.blessing.targets_receive_rending_debuff_on_charged_shots"],
  ["bash", "shared.name_family.blessing.crit_chance_on_push"],
  ["between the eyes", "shared.name_family.blessing.suppression_negation_on_weakspot"],
  ["blast zone", "shared.name_family.blessing.explosion_radius_bonus_on_continuous_fire"],
  ["bladed momentum", "shared.name_family.blessing.rending_on_multiple_hits"],
  ["bloodletter", "shared.name_family.blessing.bleed_on_activated_hit"],
  ["born in blood", "shared.name_family.blessing.toughness_on_close_range_kills"],
  ["both barrels", "shared.name_family.blessing.reload_speed_on_ranged_weapon_special_kill"],
  ["can opener", "shared.name_family.blessing.targets_receive_rending_debuff_on_weapon_special"],
  ["cavalcade", "shared.name_family.blessing.stacking_crit_bonus_on_continuous_fire"],
  ["ceaseless barrage", "shared.name_family.blessing.increased_suppression_on_continuous_fire"],
  ["chained deathblow", "shared.name_family.blessing.increased_crit_chance_on_weakspot_kill"],
  ["charmed reload", "shared.name_family.blessing.ammo_from_reserve_on_crit"],
  ["concentrated fire", "shared.name_family.blessing.chained_weakspot_hits_increases_crit_chance"],
  ["counterattack", "shared.name_family.blessing.attack_speed_on_perfect_block"],
  ["crucian roulette", "shared.name_family.blessing.crit_chance_based_on_ammo_left"],
  ["deathblow", "shared.name_family.blessing.brutal_momentum"],
  ["decapitator", "shared.name_family.blessing.stacking_finesse_on_one_hit_kill"],
  ["deadly accurate", "shared.name_family.blessing.lethal_proximity"],
  ["desperado", "shared.name_family.blessing.riposte"],
  ["devastating strike", "shared.name_family.blessing.cleave_on_crit"],
  ["disruptive", "shared.name_family.blessing.melee_power_after_ranged_explosion"],
  ["dumdum", "shared.name_family.blessing.consecutive_hits_increases_close_damage"],
  ["efficiency", "shared.name_family.blessing.first_shot_ammo_cost_reduction"],
  ["energy transfer", "shared.name_family.blessing.energy_leakage"],
  ["everlasting flame", "shared.name_family.blessing.ammo_from_reserve_on_crit"],
  ["executor", "shared.name_family.blessing.chained_weakspot_hits_increases_power"],
  ["exorcist", "shared.name_family.blessing.vents_warpcharge_on_weakspot_hits"],
  ["expansive", "shared.name_family.blessing.melee_power_after_ranged_explosion"],
  ["explosive offensive", "shared.name_family.blessing.power_bonus_after_weapon_special_multiple"],
  ["falter", "shared.name_family.blessing.negate_stagger_reduction_on_weakspot"],
  ["fan the flames", "shared.name_family.blessing.negate_stagger_reduction_with_primary_on_burning"],
  ["flechette", "shared.name_family.blessing.bleed_on_crit"],
  ["focused channelling", "shared.name_family.blessing.uninterruptable_while_charging"],
  ["focused cooling", "shared.name_family.blessing.gets_hot"],
  ["gauntlet momentum", "shared.name_family.blessing.chained_melee_hits_increases_power"],
  ["ghost", "shared.name_family.blessing.count_as_dodge_vs_ranged_on_weakspot"],
  ["hand cannon", "shared.name_family.blessing.puncture"],
  ["hammerblow", "shared.name_family.blessing.stacking_increase_impact_on_hit"],
  ["headtaker", "shared.name_family.blessing.increase_power_on_hit"],
  ["headhunter", "shared.name_family.blessing.stacking_crit_chance_on_weakspot"],
  ["hit run", "shared.name_family.blessing.count_as_dodge_vs_ranged_on_close_kill"],
  ["infernus", "shared.name_family.blessing.burninating_on_crit"],
  ["last guard", "shared.name_family.blessing.block_break_pushes"],
  ["lightning reflexes", "shared.name_family.blessing.block_has_chance_to_stun"],
  ["limbsplitter", "shared.name_family.blessing.power_bonus_on_first_attack"],
  ["man stopper", "shared.name_family.blessing.cleave_on_crit"],
  ["marksman s reflex", "shared.name_family.blessing.weakspot_projectile_hit_increases_reload_speed"],
  ["mercy killer", "shared.name_family.blessing.increased_weakspot_damage_against_bleeding"],
  ["murderous tranquility", "shared.name_family.blessing.vent_warp_charge_on_multiple_hits"],
  ["no guts no glory", "shared.name_family.blessing.toughness_regen_on_weapon_special_elites"],
  ["no respite", "shared.name_family.blessing.stagger_count_bonus_damage"],
  ["offensive defence", "shared.name_family.blessing.block_grants_power_bonus"],
  ["opening salvo", "shared.name_family.blessing.power_bonus_on_first_shot"],
  ["opportunist", "shared.name_family.blessing.rending_vs_staggered"],
  ["optimised cooling", "shared.name_family.blessing.lower_overheat_gives_faster_charge"],
  ["overpressure", "shared.name_family.blessing.power_scales_with_clip_percentage"],
  ["overwhelming fire", "shared.name_family.blessing.consecutive_hits_increases_ranged_power"],
  ["overwhelming force", "shared.name_family.blessing.staggering_hits_has_chance_to_stun"],
  ["perfect strike", "shared.name_family.blessing.pass_past_armor_on_crit"],
  ["pierce", "shared.name_family.blessing.pass_past_armor_on_weapon_special"],
  ["pinpointing target", "shared.name_family.blessing.thunderous"],
  ["point blank", "shared.name_family.blessing.crit_chance_bonus_on_melee_kills"],
  ["powderburn", "shared.name_family.blessing.recoil_reduction_and_suppression_increase_on_close_kills"],
  ["power blast", "shared.name_family.blessing.charge_level_increases_critical_strike_chance"],
  ["power cycler", "shared.name_family.blessing.extended_activation_duration_on_chained_attacks"],
  ["pulverise", "shared.name_family.blessing.crit_chance_bonus_on_melee_kills"],
  ["punishing fire", "shared.name_family.blessing.shot_power_bonus_after_weapon_special_cleave"],
  ["punishing salvo", "shared.name_family.blessing.followup_shots_ranged_weakspot_damage"],
  ["puncture", "shared.name_family.blessing.bleed_on_ranged"],
  ["quickflame", "shared.name_family.blessing.faster_reload_on_empty_clip"],
  ["raking fire", "shared.name_family.blessing.allow_flanking_and_increased_damage_when_flanking"],
  ["rending shockwave", "shared.name_family.blessing.rend_armor_on_aoe_charge"],
  ["reassuringly accurate", "shared.name_family.blessing.toughness_on_crit_kills"],
  ["refined lethality", "shared.name_family.blessing.increased_weakspot_damage_against_toxin_status"],
  ["rev it up", "shared.name_family.blessing.movement_speed_on_activation"],
  ["roaring advance", "shared.name_family.blessing.movement_speed_on_continous_fire"],
  ["ruthless backstab", "shared.name_family.blessing.rending_on_backstab"],
  ["savage sweep", "shared.name_family.blessing.wrath"],
  ["scattershot", "shared.name_family.blessing.crit_chance_on_hitting_multiple_with_one_shot"],
  ["showstopper", "shared.name_family.blessing.chance_to_explode_elites_on_kill"],
  ["slaughter spree", "shared.name_family.blessing.guaranteed_melee_crit_after_crit_weakspot_kill"],
  ["slaughterer", "shared.name_family.blessing.increase_power_on_kill"],
  ["slow and steady", "shared.name_family.blessing.toughness_on_hit_based_on_charge_time"],
  ["smackdown", "shared.name_family.blessing.increased_crit_chance_on_staggered_weapon_special_hit"],
  ["sucker punch", "shared.name_family.blessing.increased_crit_chance_on_weapon_special_hit"],
  ["sunder", "shared.name_family.blessing.pass_past_armor_on_weapon_special"],
  ["supercharge", "shared.name_family.blessing.targets_receive_rending_debuff_on_weapon_special_attacks"],
  ["superiority", "shared.name_family.blessing.elite_kills_grants_stackable_power"],
  ["surge", "shared.name_family.blessing.double_shot_on_crit"],
  ["syphon", "shared.name_family.blessing.weapon_trait_bespoke_powersword_2h_p1_regain_toughness_on_multiple_hits_by_weapon_special"],
  ["take a swing", "shared.name_family.blessing.increased_weakspot_damage_on_push"],
  ["tenderiser", "shared.name_family.blessing.increased_power_on_weapon_special_follow_up_hits"],
  ["terrifying barrage", "shared.name_family.blessing.suppression_on_close_kill"],
  ["thunderstrike", "shared.name_family.blessing.staggered_targets_receive_increased_stagger_debuff"],
  ["torment", "shared.name_family.blessing.increase_power_on_weapon_special_hit"],
  ["transfer peril", "shared.name_family.blessing.vents_warpcharge_on_weakspot_hits"],
  ["trauma", "shared.name_family.blessing.consecutive_hits_increases_stagger"],
  ["trickshooter", "shared.name_family.blessing.chained_weakspot_hits_increases_power"],
  ["thrust", "shared.name_family.blessing.thunderous"],
  ["unstable power", "shared.name_family.blessing.warp_charge_power_bonus"],
  ["unstoppable force", "shared.name_family.blessing.pass_past_armor_on_heavy_attack"],
  ["vicious slice", "shared.name_family.blessing.increase_stagger_per_hit_in_sweep"],
  ["volatile", "shared.name_family.blessing.lower_overheat_gives_faster_charge"],
  ["warp slice", "shared.name_family.blessing.wind_slash_crits"],
  ["weight of fire", "shared.name_family.blessing.warp_flurry"],
  ["wrath", "shared.name_family.blessing.chained_hits_increases_melee_cleave"],
]);

function matchBlessing(entry: GlAliasCorpusEntry, index: GroundTruthIndex): MatchResult {
  const existingAlias = matchExistingAlias(entry, index, "shared.name_family.blessing.");
  if (existingAlias) {
    return existingAlias;
  }

  const exactUiName = blessingFamilies(index).filter((entity) =>
    typeof entity.ui_name === "string"
    && normalizeText(entity.ui_name) === entry.normalized_label,
  );
  if (exactUiName.length === 1) {
    return {
      state: "high_confidence_match",
      candidate_entity_id: exactUiName[0].id,
      candidates: [exactUiName[0].id],
      reason: "matched exact blessing family ui_name",
    };
  }

  const exactSlug = blessingFamilies(index).filter((entity) =>
    normalizeText(entity.id.slice("shared.name_family.blessing.".length)) === entry.normalized_label,
  );
  if (exactSlug.length === 1) {
    return {
      state: "high_confidence_match",
      candidate_entity_id: exactSlug[0].id,
      candidates: [exactSlug[0].id],
      reason: "matched normalized blessing family slug",
    };
  }

  const curatedMatch = CURATED_GL_BLESSING_LABELS.get(entry.normalized_label);
  if (curatedMatch && index.entities.some((entity) => entity.id === curatedMatch)) {
    return {
      state: "high_confidence_match",
      candidate_entity_id: curatedMatch,
      candidates: [curatedMatch],
      reason: "matched curated GL blessing label",
    };
  }

  const candidates = blessingFamilies(index)
    .map((entity) => entity.id)
    .sort();
  return {
    state: candidates.length > 0 ? "review_required" : "unmatched",
    candidates,
    reason: candidates.length > 0 ? "blessing needs graph-backed manual review" : "no blessing families available",
  };
}

export async function matchCorpusEntry(
  entry: GlAliasCorpusEntry,
  index: GroundTruthIndex,
): Promise<MatchResult> {
  if (entry.domain === "weapon_perk") {
    return matchWeaponPerk(entry, index);
  }

  if (entry.domain === "weapon_trait") {
    return matchBlessing(entry, index);
  }

  if (entry.domain === "weapon") {
    return matchExistingAlias(entry, index, "shared.weapon.") ?? {
      state: "unmatched",
      candidates: [],
      reason: "no exact weapon alias match",
    };
  }

  if (entry.domain === "talent") {
    const metadata = entry.metadata ?? {};
    if (typeof metadata.entity_id === "string") {
      return {
        state: "high_confidence_match",
        candidate_entity_id: metadata.entity_id,
        candidates: [metadata.entity_id],
        reason: "matched class-tree corpus entity id",
      };
    }
  }

  return {
    state: "unmatched",
    candidates: [],
    reason: "unsupported or incomplete corpus entry",
  };
}
