import { getFamilies, getEffectCategory } from "./synergy-stat-families.mjs";

// ---------------------------------------------------------------------------
// Rule 1: statAlignment
// ---------------------------------------------------------------------------

/**
 * Detects when two selections buff the same stat family.
 *
 * @param {{ id: string, effects: Array<{ stat: string, type: string, magnitude?: number, trigger?: string, condition?: string }> }} selA
 * @param {{ id: string, effects: Array<{ stat: string, type: string, magnitude?: number, trigger?: string, condition?: string }> }} selB
 * @returns {Array<{ type: string, selections: string[], families: string[], strength: number, explanation: string }>}
 */
export function statAlignment(selA, selB) {
  // Build a map: family -> { selA categories, selB categories }
  const familyCategories = new Map();

  for (const eff of selA.effects) {
    if (!eff.stat) continue;
    const cat = getEffectCategory(eff.type);
    if (cat === "unknown") continue;
    for (const fam of getFamilies(eff.stat)) {
      if (fam === "uncategorized") continue;
      if (!familyCategories.has(fam)) familyCategories.set(fam, { a: new Set(), b: new Set() });
      familyCategories.get(fam).a.add(cat);
    }
  }

  for (const eff of selB.effects) {
    if (!eff.stat) continue;
    const cat = getEffectCategory(eff.type);
    if (cat === "unknown") continue;
    for (const fam of getFamilies(eff.stat)) {
      if (fam === "uncategorized") continue;
      if (!familyCategories.has(fam)) familyCategories.set(fam, { a: new Set(), b: new Set() });
      familyCategories.get(fam).b.add(cat);
    }
  }

  const edges = [];
  for (const [family, { a, b }] of familyCategories) {
    if (a.size === 0 || b.size === 0) continue;

    // Compute intersection of categories
    const sharedCats = [...a].filter((c) => b.has(c));
    const strength = sharedCats.length > 0 ? 3 : 2;
    const explanation =
      strength === 3
        ? `Both selections contribute ${[...sharedCats].join("/")} effects to the ${family} family`
        : `Selections contribute different-category effects to the ${family} family`;

    edges.push({
      type: "stat_alignment",
      selections: [selA.id, selB.id],
      families: [family],
      strength,
      explanation,
    });
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Rule 2: slotCoverage
// ---------------------------------------------------------------------------

const MELEE_FAMILIES = new Set(["melee_offense", "general_offense", "crit"]);
const RANGED_FAMILIES = new Set(["ranged_offense", "general_offense", "crit"]);

/**
 * Analyzes melee vs ranged support across a set of selections.
 *
 * @param {Array<{ id: string, effects: Array<{ stat: string, type: string }> }>} selections
 * @returns {{ melee: { families: string[], strength: number }, ranged: { families: string[], strength: number } }}
 */
export function slotCoverage(selections) {
  const meleeSelections = new Set();
  const rangedSelections = new Set();
  const meleeFamilies = new Set();
  const rangedFamilies = new Set();

  for (const sel of selections) {
    for (const eff of sel.effects) {
      if (!eff.stat) continue;
      for (const fam of getFamilies(eff.stat)) {
        if (fam === "uncategorized") continue;
        if (MELEE_FAMILIES.has(fam)) {
          meleeSelections.add(sel.id);
          meleeFamilies.add(fam);
        }
        if (RANGED_FAMILIES.has(fam)) {
          rangedSelections.add(sel.id);
          rangedFamilies.add(fam);
        }
      }
    }
  }

  return {
    melee: { families: [...meleeFamilies], strength: meleeSelections.size },
    ranged: { families: [...rangedFamilies], strength: rangedSelections.size },
  };
}

// ---------------------------------------------------------------------------
// Rule 3: triggerTargetChain
// ---------------------------------------------------------------------------

const THRESHOLD_RESOURCE_STATS = {
  "threshold:warp_charge": ["warp_charge_amount"],
  "threshold:ammo": ["ammo_reserve_capacity", "clip_size_modifier"],
  "threshold:health": ["max_health_modifier", "toughness"],
};

/**
 * Detects trigger co-occurrence and producer-condition chains between two selections.
 *
 * @param {{ id: string, effects: Array<{ stat: string, type: string, magnitude?: number, trigger?: string, condition?: string }> }} selA
 * @param {{ id: string, effects: Array<{ stat: string, type: string, magnitude?: number, trigger?: string, condition?: string }> }} selB
 * @returns {Array<{ type: string, selections: string[], strength: number, trigger?: string, resource?: string }>}
 */
export function triggerTargetChain(selA, selB) {
  const edges = [];

  // Mode 1: trigger co-occurrence
  const triggersA = new Set(selA.effects.map((e) => e.trigger).filter(Boolean));
  const triggersB = new Set(selB.effects.map((e) => e.trigger).filter(Boolean));
  for (const t of triggersA) {
    if (triggersB.has(t)) {
      edges.push({ type: "trigger_target", selections: [selA.id, selB.id], families: [], strength: 2, explanation: `Both activate on ${t}` });
    }
  }

  // Mode 2: producer-condition chains (both directions)
  for (const [producer, consumer] of [[selA, selB], [selB, selA]]) {
    const producedStats = new Set(
      producer.effects
        .filter((e) => typeof e.magnitude === "number" && e.magnitude > 0)
        .map((e) => e.stat)
        .filter(Boolean)
    );

    for (const eff of consumer.effects) {
      if (!eff.condition) continue;
      const resourceStats = THRESHOLD_RESOURCE_STATS[eff.condition];
      if (!resourceStats) continue;
      const matched = resourceStats.some((rs) => producedStats.has(rs));
      if (matched) {
        edges.push({
          type: "trigger_target",
          selections: [producer.id, consumer.id],
          families: [],
          strength: 3,
          explanation: `${producer.id} produces resource needed by ${eff.condition} condition`,
        });
      }
    }
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Rule 4: resourceFlow
// ---------------------------------------------------------------------------

const RESOURCE_PRODUCERS = {
  warp_charge: { stats: ["warp_charge_amount", "vent_warp_charge_speed", "warp_charge_dissipation_multiplier"] },
  grenade: { stats: ["extra_max_amount_of_grenades", "extra_grenade_throw_chance", "grenade_ability_cooldown_modifier"] },
  stamina: { stats: ["stamina_modifier", "stamina_regeneration_modifier"] },
};

const RESOURCE_CONSUMERS = {
  warp_charge: { stats: ["warp_charge_block_cost"] },
  grenade: { stats: [] },
  stamina: { stats: ["block_cost_multiplier", "sprinting_cost_multiplier", "stamina_regeneration_delay"] },
};

/**
 * Analyzes resource production and consumption across a set of selections.
 *
 * @param {Array<{ id: string, effects: Array<{ stat: string, type: string, magnitude?: number }> }>} selections
 * @returns {{ [resource: string]: { producers: string[], consumers: string[], orphaned_consumers: string[] } }}
 */
export function resourceFlow(selections) {
  const result = {};

  for (const resource of Object.keys(RESOURCE_PRODUCERS)) {
    const producerStats = new Set(RESOURCE_PRODUCERS[resource].stats);
    const consumerStats = new Set(RESOURCE_CONSUMERS[resource].stats);

    const producers = [];
    const consumers = [];

    for (const sel of selections) {
      let isProducer = false;
      let isConsumer = false;
      for (const eff of sel.effects) {
        if (!eff.stat) continue;
        if (producerStats.has(eff.stat)) isProducer = true;
        if (consumerStats.has(eff.stat)) isConsumer = true;
      }
      if (isProducer) producers.push(sel.id);
      if (isConsumer) consumers.push(sel.id);
    }

    const orphaned_consumers = producers.length === 0 ? [...consumers] : [];

    result[resource] = { producers, consumers, orphaned_consumers };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Rule 5: detectOrphans
// ---------------------------------------------------------------------------

const SELF_SUFFICIENT_CONDITIONS = new Set(["wielded", "slot_secondary"]);

/**
 * Checks each effect's condition and reports orphaned conditions.
 *
 * @param {{ id: string, effects: Array<{ stat: string, type: string, condition?: string }> }} selection
 * @param {Array<{ id: string, effects: Array<{ stat: string, type: string, magnitude?: number }> }>} allSelections
 * @returns {Array<{ selection: string, reason: string, condition: string, resource?: string }>}
 */
export function detectOrphans(selection, allSelections) {
  const orphans = [];

  for (const eff of selection.effects) {
    if (!eff.condition) continue;
    if (SELF_SUFFICIENT_CONDITIONS.has(eff.condition)) continue;

    if (eff.condition === "unknown_condition" || eff.condition === "active_and_unknown") {
      orphans.push({ selection: selection.id, reason: "unresolvable_condition", condition: eff.condition });
      continue;
    }

    const resourceStats = THRESHOLD_RESOURCE_STATS[eff.condition];
    if (resourceStats) {
      const producerStatSet = new Set(resourceStats);
      const hasProducer = allSelections.some((sel) =>
        sel.effects.some(
          (e) => e.stat && producerStatSet.has(e.stat) && typeof e.magnitude === "number" && e.magnitude > 0
        )
      );
      if (!hasProducer) {
        orphans.push({
          selection: selection.id,
          reason: "resource_consumer_without_producer",
          resource: eff.condition,
          condition: eff.condition,
        });
      }
    }
  }

  return orphans;
}
