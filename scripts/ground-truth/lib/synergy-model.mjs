import { getFamilies, ALL_FAMILIES } from "./synergy-stat-families.mjs";
import {
  statAlignment,
  slotCoverage,
  triggerTargetChain,
  resourceFlow,
  detectOrphans,
} from "./synergy-rules.mjs";
import { ENTITIES_ROOT, EDGES_ROOT, listJsonFiles, loadJsonFile } from "./load.mjs";

// ---------------------------------------------------------------------------
// loadIndex — build entities Map and flat edges array from ground-truth data
// ---------------------------------------------------------------------------

export function loadIndex() {
  const entities = new Map();
  for (const path of listJsonFiles(ENTITIES_ROOT)) {
    for (const e of loadJsonFile(path)) {
      entities.set(e.id, e);
    }
  }
  const edges = listJsonFiles(EDGES_ROOT).flatMap((path) => loadJsonFile(path));
  return { entities, edges };
}

// ---------------------------------------------------------------------------
// computeCoverage — stat aggregator
// ---------------------------------------------------------------------------

/**
 * @param {Array<{ id: string, effects: Array<{ stat: string, type: string, magnitude?: number }> }>} selections
 */
export function computeCoverage(selections) {
  // Build family_profile: family -> { count, total_magnitude, selections }
  const profile = {};

  for (const sel of selections) {
    // Track which families this selection contributes to (avoid double-counting per selection)
    const familiesForSel = new Set();

    for (const eff of sel.effects) {
      if (!eff.stat) continue;
      const magnitude = typeof eff.magnitude === "number" ? eff.magnitude : 0;
      for (const family of getFamilies(eff.stat)) {
        if (family === "uncategorized") continue;
        if (!profile[family]) {
          profile[family] = { count: 0, total_magnitude: 0, selections: [] };
        }
        profile[family].total_magnitude += magnitude;
        if (!familiesForSel.has(family)) {
          familiesForSel.add(family);
        }
      }
    }

    // Increment count once per selection per family
    for (const family of familiesForSel) {
      profile[family].count += 1;
      if (!profile[family].selections.includes(sel.id)) {
        profile[family].selections.push(sel.id);
      }
    }
  }

  // Remove families with count === 0 (shouldn't happen but guard)
  for (const family of Object.keys(profile)) {
    if (profile[family].count === 0) delete profile[family];
  }

  // Round total_magnitude to avoid float noise
  for (const fam of Object.keys(profile)) {
    profile[fam].total_magnitude = Math.round(profile[fam].total_magnitude * 1000) / 1000;
  }

  // build_identity: top 3 families by count
  const sortedFamilies = Object.entries(profile)
    .sort(([, a], [, b]) => b.count - a.count || b.total_magnitude - a.total_magnitude)
    .map(([family]) => family);
  const build_identity = sortedFamilies.slice(0, 3);

  // slot_balance
  const meleeSlotFamilies = new Set(["melee_offense", "general_offense", "crit"]);
  const rangedSlotFamilies = new Set(["ranged_offense", "general_offense", "crit"]);

  const meleeSelIds = new Set();
  const rangedSelIds = new Set();
  const meleeFams = new Set();
  const rangedFams = new Set();

  for (const sel of selections) {
    for (const eff of sel.effects) {
      if (!eff.stat) continue;
      for (const family of getFamilies(eff.stat)) {
        if (meleeSlotFamilies.has(family)) {
          meleeSelIds.add(sel.id);
          meleeFams.add(family);
        }
        if (rangedSlotFamilies.has(family)) {
          rangedSelIds.add(sel.id);
          rangedFams.add(family);
        }
      }
    }
  }

  const slot_balance = {
    melee: { families: [...meleeFams], strength: meleeSelIds.size },
    ranged: { families: [...rangedFams], strength: rangedSelIds.size },
  };

  // coverage_gaps
  const coverage_gaps = [];

  // "survivability": primary identity is melee_offense AND no toughness AND no damage_reduction
  if (
    build_identity[0] === "melee_offense" &&
    (!profile["toughness"] || profile["toughness"].count === 0) &&
    (!profile["damage_reduction"] || profile["damage_reduction"].count === 0)
  ) {
    coverage_gaps.push("survivability");
  }

  // "crit_chance_source": crit family present but no selection has a crit chance stat
  const critChanceStats = new Set([
    "critical_strike_chance",
    "melee_critical_strike_chance",
    "ranged_critical_strike_chance",
  ]);
  if (profile["crit"] && profile["crit"].count > 0) {
    const hasCritChanceSource = selections.some((sel) =>
      sel.effects.some((eff) => eff.stat && critChanceStats.has(eff.stat))
    );
    if (!hasCritChanceSource) {
      coverage_gaps.push("crit_chance_source");
    }
  }

  // "warp_charge_producer": selection has warp_charge_block_cost AND no selection produces warp_charge_amount > 0
  const hasWarpBlockCost = selections.some((sel) =>
    sel.effects.some((eff) => eff.stat === "warp_charge_block_cost")
  );
  if (hasWarpBlockCost) {
    const hasWarpProducer = selections.some((sel) =>
      sel.effects.some(
        (eff) =>
          eff.stat === "warp_charge_amount" &&
          typeof eff.magnitude === "number" &&
          eff.magnitude > 0
      )
    );
    if (!hasWarpProducer) {
      coverage_gaps.push("warp_charge_producer");
    }
  }

  // concentration: NHHI
  const activeFamilies = Object.values(profile).filter((f) => f.count > 0);
  const N = activeFamilies.length;
  let concentration = 0;
  if (N === 1) {
    concentration = 1;
  } else if (N > 1) {
    const total = activeFamilies.reduce((sum, f) => sum + f.count, 0);
    const hhi = activeFamilies.reduce((sum, f) => sum + (f.count / total) ** 2, 0);
    concentration = (hhi - 1 / N) / (1 - 1 / N);
  }
  concentration = Math.round(concentration * 100) / 100;

  return {
    family_profile: profile,
    slot_balance,
    build_identity,
    coverage_gaps,
    concentration,
  };
}

// ---------------------------------------------------------------------------
// resolveSelections — extract and resolve all build selections to effects
// ---------------------------------------------------------------------------

/**
 * @param {object} build - canonical build JSON
 * @param {Map<string, object>} entities
 * @param {Array<object>} edges
 * @returns {Array<{ id: string, effects: Array<object> }>}
 */
export function resolveSelections(build, entities, edges) {
  // Extract all entity IDs from the build
  const ids = new Set();

  // Structural slots
  for (const field of ["ability", "blitz", "aura", "keystone"]) {
    const slot = build[field];
    if (slot?.canonical_entity_id) ids.add(slot.canonical_entity_id);
  }

  // Flat talents
  for (const t of build.talents ?? []) {
    if (t.canonical_entity_id) ids.add(t.canonical_entity_id);
  }

  // Weapons
  for (const w of build.weapons ?? []) {
    if (w.name?.canonical_entity_id) ids.add(w.name.canonical_entity_id);
    for (const b of w.blessings ?? []) {
      // Blessings are flat objects with canonical_entity_id directly
      if (b.canonical_entity_id) ids.add(b.canonical_entity_id);
    }
    for (const p of w.perks ?? []) {
      if (p.canonical_entity_id) ids.add(p.canonical_entity_id);
    }
  }

  // Curios
  for (const c of build.curios ?? []) {
    if (c.name?.canonical_entity_id) ids.add(c.name.canonical_entity_id);
    for (const p of c.perks ?? []) {
      if (p.canonical_entity_id) ids.add(p.canonical_entity_id);
    }
  }

  // Determine class domain for stat_node resolution
  const classDomain = build.class?.canonical_entity_id?.split(".").pop() ?? null;

  // Build instance_of index: to_entity_id -> [from_entity_id]
  const instanceOfIndex = new Map();
  for (const edge of edges) {
    if (edge.type !== "instance_of") continue;
    if (!instanceOfIndex.has(edge.to_entity_id)) {
      instanceOfIndex.set(edge.to_entity_id, []);
    }
    instanceOfIndex.get(edge.to_entity_id).push(edge.from_entity_id);
  }

  const resolved = [];

  for (const entityId of ids) {
    if (!entityId) continue;
    const entity = entities.get(entityId);
    if (!entity) {
      resolved.push({ id: entityId, effects: [] });
      continue;
    }

    let effects = [];

    // Path 1: entity has calc.effects directly
    if (entity.calc?.effects?.length > 0) {
      effects = entity.calc.effects;
    }
    // Path 2: name_family — traverse instance_of edges to find a weapon_trait
    else if (entity.kind === "name_family") {
      const fromIds = instanceOfIndex.get(entityId) ?? [];
      for (const fromId of fromIds) {
        const fromEntity = entities.get(fromId);
        if (!fromEntity) continue;
        if (fromEntity.calc?.effects?.length > 0) {
          effects = fromEntity.calc.effects;
          break;
        }
        if (fromEntity.calc?.tiers?.length > 0) {
          // Use last tier's effects
          const lastTier = fromEntity.calc.tiers[fromEntity.calc.tiers.length - 1];
          effects = lastTier.effects ?? [];
          break;
        }
      }
    }
    // Path 3: stat_node — find per-class talent by internal_name prefix match
    else if (entity.kind === "stat_node" && entity.internal_name && classDomain) {
      const prefix = entity.internal_name;
      // Find class-domain talent whose internal_name starts with prefix
      for (const [id, e] of entities) {
        if (
          e.domain === classDomain &&
          e.kind === "talent" &&
          e.internal_name?.startsWith(prefix) &&
          e.calc?.effects?.length > 0
        ) {
          effects = e.calc.effects;
          break;
        }
      }
    }

    resolved.push({ id: entityId, effects });
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// analyzeBuild — orchestrator
// ---------------------------------------------------------------------------

/**
 * @param {object} build - canonical build JSON
 * @param {{ entities: Map<string, object>, edges: Array<object> }} index
 */
export function analyzeBuild(build, index) {
  const { entities, edges } = index;

  // Step 1: resolve selections
  const allResolved = resolveSelections(build, entities, edges);

  // Step 2: filter to those with effects
  const withEffects = allResolved.filter((s) => s.effects.length > 0);

  // Step 3: pairwise rules
  const synergy_edges = [];
  for (let i = 0; i < withEffects.length; i++) {
    for (let j = i + 1; j < withEffects.length; j++) {
      const a = withEffects[i];
      const b = withEffects[j];
      synergy_edges.push(...statAlignment(a, b));
      synergy_edges.push(...triggerTargetChain(a, b));
    }
  }

  // Step 4: slot coverage and resource flow
  const slotResult = slotCoverage(withEffects);
  const resourceResult = resourceFlow(withEffects);

  // Step 5: detect orphans per selection
  const orphanSet = new Set(); // dedup key: `${selection}::${resource|condition}`
  const orphans = [];

  for (const sel of withEffects) {
    for (const orphan of detectOrphans(sel, withEffects)) {
      const key = `${orphan.selection}::${orphan.resource ?? orphan.condition}`;
      if (!orphanSet.has(key)) {
        orphanSet.add(key);
        orphans.push(orphan);
      }
    }
  }

  // Step 6: add resource flow orphaned consumers
  for (const [resource, flow] of Object.entries(resourceResult)) {
    for (const selId of flow.orphaned_consumers) {
      const key = `${selId}::${resource}`;
      if (!orphanSet.has(key)) {
        orphanSet.add(key);
        orphans.push({
          selection: selId,
          reason: "resource_consumer_without_producer",
          resource,
          condition: `threshold:${resource}`,
        });
      }
    }
  }

  // Step 7: slot imbalance anti-synergies
  const anti_synergies = [];
  if (slotResult.melee.strength > 0 && slotResult.ranged.strength === 0) {
    anti_synergies.push({
      type: "slot_imbalance",
      explanation: "Build has melee coverage but no ranged offense support",
      slots: { melee: slotResult.melee.strength, ranged: 0 },
    });
  } else if (slotResult.ranged.strength > 0 && slotResult.melee.strength === 0) {
    anti_synergies.push({
      type: "slot_imbalance",
      explanation: "Build has ranged coverage but no melee offense support",
      slots: { melee: 0, ranged: slotResult.ranged.strength },
    });
  }

  // Step 8: compute coverage
  const coverage = computeCoverage(withEffects);

  // Step 9: count pre-dedup total selections
  let totalSelections = 0;
  for (const field of ["ability", "blitz", "aura", "keystone"]) {
    if (build[field]?.canonical_entity_id) totalSelections++;
  }
  totalSelections += (build.talents ?? []).length;
  for (const w of build.weapons ?? []) {
    if (w.name?.canonical_entity_id) totalSelections++;
    totalSelections += (w.blessings ?? []).length;
    totalSelections += (w.perks ?? []).length;
  }
  for (const c of build.curios ?? []) {
    if (c.name?.canonical_entity_id) totalSelections++;
    totalSelections += (c.perks ?? []).length;
  }

  // Step 10: opaque conditions count
  const opaqueConditions = new Set(["unknown_condition", "active_and_unknown"]);
  let opaqueCount = 0;
  for (const sel of withEffects) {
    for (const eff of sel.effects) {
      if (eff.condition && opaqueConditions.has(eff.condition)) opaqueCount++;
    }
  }

  const calcCoveragePct =
    allResolved.length > 0
      ? Math.round((withEffects.length / allResolved.length) * 100) / 100
      : 0;

  return {
    build: build.title ?? "",
    class: build.class?.raw_label ?? "",
    synergy_edges,
    anti_synergies,
    orphans,
    coverage,
    metadata: {
      entities_analyzed: totalSelections,
      unique_entities_with_calc: withEffects.length,
      entities_without_calc: allResolved.length - withEffects.length,
      opaque_conditions: opaqueCount,
      calc_coverage_pct: calcCoveragePct,
    },
  };
}
