/**
 * Stat family definitions and mappings — maps individual stat names to
 * conceptual families (melee_offense, toughness, etc.) for synergy analysis.
 */

export const ALL_FAMILIES = [
  "melee_offense", "ranged_offense", "general_offense", "crit",
  "toughness", "damage_reduction", "mobility", "warp_resource",
  "grenade", "stamina", "utility",
] as const;

export type StatFamily = (typeof ALL_FAMILIES)[number];

const PERSISTENT_TYPES = new Set(["stat_buff", "conditional_stat_buff"]);
const DYNAMIC_TYPES = new Set(["proc_stat_buff", "lerped_stat_buff"]);

export type EffectCategory = "persistent" | "dynamic" | "unknown";

export function getEffectCategory(effectType: string): EffectCategory {
  if (PERSISTENT_TYPES.has(effectType)) return "persistent";
  if (DYNAMIC_TYPES.has(effectType)) return "dynamic";
  return "unknown";
}

const FAMILY_STATS: Record<StatFamily, string[]> = {
  melee_offense: [
    "melee_damage", "melee_attack_speed", "melee_power_level_modifier",
    "melee_weakspot_damage", "melee_impact_modifier",
    "melee_weakspot_power_modifier", "melee_weakspot_impact_modifier",
    "melee_damage_bonus", "melee_rending_vs_staggered_multiplier",
    "melee_finesse_modifier_bonus", "max_melee_hit_mass_attack_modifier",
    "max_hit_mass_attack_modifier", "first_target_melee_damage_modifier",
    "lunge_distance", "toughness_melee_replenish",
    "melee_critical_strike_damage", "melee_heavy_damage",
    "melee_fully_charged_damage", "melee_weakspot_damage_vs_bleeding",
    "melee_weakspot_damage_vs_toxin_status",
  ],
  ranged_offense: [
    "ranged_damage", "ranged_attack_speed", "ranged_damage_far",
    "ranged_weakspot_damage", "ranged_impact_modifier",
    "ranged_critical_strike_damage", "ranged_critical_strike_chance",
    "ranged_critical_strike_rending_multiplier", "ranged_power_level_modifier",
    "reload_speed", "recoil_modifier", "spread_modifier", "sway_modifier",
    "ammo_reserve_capacity", "clip_size_modifier",
    "consumed_hit_mass_modifier", "consumed_hit_mass_modifier_on_weakspot_hit",
    "ranged_max_hit_mass_attack_modifier",
    "overheat_over_time_amount", "overheat_dissipation_multiplier",
    "overheat_immediate_amount_critical_strike", "overheat_amount",
    "overheat_explosion_speed_modifier", "overheat_explosion_damage_modifier",
    "overheat_explosion_radius_modifier", "reload_decrease_movement_reduction",
    "alternate_fire_movement_speed_reduction_modifier",
    "explosion_arming_distance_multiplier", "fov_multiplier",
    "charge_level_modifier", "charge_movement_reduction_multiplier",
    "charge_up_time",
  ],
  general_offense: [
    "damage", "power_level_modifier", "rending_multiplier",
    "damage_near", "damage_far", "damage_vs_ogryn_and_monsters",
    "damage_vs_elites", "damage_vs_staggered", "damage_vs_suppressed",
    "damage_vs_healthy", "damage_vs_monsters", "damage_vs_ogryn",
    "damage_vs_chaos_plague_ogryn", "damage_vs_electrocuted",
    "damage_vs_nonthreat", "damage_vs_horde", "damage_vs_specials",
    "weakspot_damage", "finesse_modifier_bonus",
    "impact_modifier", "explosion_radius_modifier",
    "flanking_damage", "backstab_damage", "backstab_rending_multiplier",
    "suppression_dealt",
    "max_hit_mass_attack_modifier", "max_hit_mass_impact_modifier",
    "push_impact_modifier", "attack_speed",
    "weapon_action_movespeed_reduction_multiplier",
    "critical_strike_chance", "critical_strike_damage",
    "critical_strike_rending_multiplier", "critical_strike_weakspot_damage",
    "toxin_power", "disgustingly_resilient_damage", "resistant_damage",
    "stagger_count_damage", "stagger_weakspot_reduction_modifier",
    "stagger_burning_reduction_modifier", "rending_vs_staggered_multiplier",
  ],
  crit: [
    "critical_strike_chance", "critical_strike_damage",
    "critical_strike_rending_multiplier", "critical_strike_weakspot_damage",
    "melee_critical_strike_chance", "ranged_critical_strike_chance",
    "ranged_critical_strike_damage", "ranged_critical_strike_rending_multiplier",
    "melee_finesse_modifier_bonus", "finesse_modifier_bonus",
  ],
  toughness: [
    "toughness", "toughness_bonus", "toughness_damage_taken_modifier",
    "toughness_damage_taken_multiplier", "toughness_replenish_modifier",
    "toughness_replenish_multiplier", "toughness_regen_rate_modifier",
    "toughness_melee_replenish", "toughness_extra_regen_rate",
    "toughness_regen_delay_multiplier",
  ],
  damage_reduction: [
    "damage_taken_multiplier", "corruption_taken_multiplier",
    "corruption_taken_grimoire_multiplier",
    "block_cost_multiplier", "health_segment_damage_taken_multiplier",
    "max_health_damage_taken_per_hit", "max_health_modifier",
    "extra_max_amount_of_wounds",
    "damage_taken_by_cultist_flamer_multiplier",
    "damage_taken_by_renegade_flamer_multiplier",
    "damage_taken_by_renegade_flamer_mutator_multiplier",
    "damage_taken_by_cultist_gunner_multiplier",
    "damage_taken_by_renegade_gunner_multiplier",
    "damage_taken_by_chaos_ogryn_gunner_multiplier",
    "damage_taken_by_renegade_sniper_multiplier",
    "damage_taken_by_renegade_grenadier_multiplier",
    "damage_taken_by_cultist_grenadier_multiplier",
    "damage_taken_by_chaos_hound_multiplier",
    "damage_taken_by_chaos_hound_mutator_multiplier",
    "damage_taken_by_chaos_armored_hound_multiplier",
    "damage_taken_by_cultist_mutant_multiplier",
    "damage_taken_by_cultist_mutant_mutator_multiplier",
    "damage_taken_by_chaos_plague_ogryn_multiplier",
    "damage_taken_by_chaos_poxwalker_bomber_multiplier",
    "ogryn_damage_taken_multiplier", "ranged_damage_taken_multiplier",
    "damage_taken_from_toxic_gas_multiplier", "syringe_duration",
  ],
  mobility: [
    "movement_speed", "sprint_movement_speed", "sprinting_cost_multiplier",
    "extra_consecutive_dodges", "dodge_speed_multiplier",
    "dodge_distance_modifier", "dodge_linger_time_modifier", "dodge_linger_time",
    "dodge_cooldown_reset_modifier", "sprint_dodge_reduce_angle_threshold_rad",
  ],
  warp_resource: [
    "warp_charge_amount", "warp_charge_block_cost",
    "warp_charge_dissipation_multiplier", "vent_warp_charge_speed",
    "vent_warp_charge_decrease_movement_reduction",
    "warp_attacks_rending_multiplier", "smite_damage_multiplier",
    "chain_lightning_max_jumps", "chain_lightning_max_radius",
    "chain_lightning_max_angle", "chain_lightning_staff_max_jumps",
    "psyker_smite_max_hit_mass_attack_modifier",
    "psyker_smite_max_hit_mass_impact_modifier",
  ],
  grenade: [
    "extra_max_amount_of_grenades", "grenade_ability_cooldown_modifier",
    "extra_grenade_throw_chance", "frag_damage",
    "explosion_radius_modifier_frag", "krak_damage",
    "smoke_fog_duration_modifier", "explosion_radius_modifier_shock",
    "ogryn_grenade_box_cluster_amount",
  ],
  stamina: [
    "stamina_modifier", "stamina_regeneration_modifier",
    "stamina_regeneration_delay", "block_cost_multiplier",
    "push_impact_modifier",
  ],
  utility: [
    "coherency_radius_modifier", "wield_speed", "revive_speed_modifier",
    "combat_ability_cooldown_modifier", "ability_cooldown_modifier",
    "ability_extra_charges", "shout_radius_modifier",
    "companion_damage_modifier", "companion_damage_vs_elites",
    "companion_damage_vs_special", "companion_damage_vs_ranged",
  ],
};

export const STAT_FAMILIES = new Map<string, Set<string>>();

for (const [family, stats] of Object.entries(FAMILY_STATS)) {
  for (const stat of stats) {
    if (!STAT_FAMILIES.has(stat)) {
      STAT_FAMILIES.set(stat, new Set());
    }
    STAT_FAMILIES.get(stat)!.add(family);
  }
}

export function getFamilies(stat: string): Set<string> {
  return STAT_FAMILIES.get(stat) ?? new Set(["uncategorized"]);
}
