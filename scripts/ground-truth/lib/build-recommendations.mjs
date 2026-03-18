// scripts/ground-truth/lib/build-recommendations.mjs
// Gap analysis for build recommendations (#10).

import { analyzeBuild } from "./synergy-model.mjs";
import { scoreFromSynergy } from "./build-scoring.mjs";
import { generateScorecard } from "../../score-build.mjs";

// Map coverage_gap names to descriptive reason strings and suggested families.
const GAP_DESCRIPTORS = {
  survivability: {
    reason: "Build primary identity is melee offense with no toughness or damage reduction investment",
    suggested_families: ["toughness", "damage_reduction"],
  },
  crit_chance_source: {
    reason: "Crit family present but no selection provides a crit chance stat",
    suggested_families: ["crit"],
  },
  warp_charge_producer: {
    reason: "Build consumes warp charges but has no warp charge producer",
    suggested_families: ["warp_resource"],
  },
};

/**
 * Analyze build gaps and return structured recommendation input.
 *
 * @param {object} build - Canonical build JSON
 * @param {{ entities: Map<string, object>, edges: Array<object> }} index - Loaded index
 * @param {{ synergy?: object, scorecard?: object } | null} [precomputed=null] - Precomputed pipeline output
 * @returns {{ gaps: Array<object>, underinvested_families: string[], scorecard: object }}
 */
export function analyzeGaps(build, index, precomputed = null) {
  const synergy = precomputed?.synergy ?? analyzeBuild(build, index);
  const scorecard = precomputed?.scorecard ?? generateScorecard(build, synergy);

  const family_profile = synergy.coverage?.family_profile ?? {};
  const coverage_gaps = synergy.coverage?.coverage_gaps ?? [];
  const slot_balance = synergy.coverage?.slot_balance ?? {};

  // Underinvested families: present in profile but count <= 1
  const underinvested_families = Object.entries(family_profile)
    .filter(([, data]) => data.count <= 1)
    .map(([family]) => family);

  // Structured gap entries from coverage_gaps
  const gaps = coverage_gaps.map((gapName) => {
    const descriptor = GAP_DESCRIPTORS[gapName] ?? {
      reason: gapName,
      suggested_families: [],
    };
    return {
      type: gapName,
      reason: descriptor.reason,
      suggested_families: descriptor.suggested_families,
    };
  });

  // Slot imbalance gap: min/max ratio < 0.3 (both-zero = no data, not perfect)
  const melee = slot_balance.melee?.strength ?? 0;
  const ranged = slot_balance.ranged?.strength ?? 0;

  let slot_balance_ratio;
  if (melee === 0 && ranged === 0) {
    slot_balance_ratio = 0.5; // no data → neutral
  } else {
    slot_balance_ratio = Math.min(melee, ranged) / Math.max(melee, ranged);
  }

  if (slot_balance_ratio < 0.3) {
    // Weaker slot's families are what should be invested in
    const weakerSlotFamilies =
      melee <= ranged
        ? (slot_balance.melee?.families ?? [])
        : (slot_balance.ranged?.families ?? []);
    gaps.push({
      type: "slot_imbalance",
      reason: `ranged/melee imbalance (mel=${melee}, rng=${ranged})`,
      suggested_families: weakerSlotFamilies,
    });
  }

  return {
    gaps,
    underinvested_families,
    scorecard,
  };
}

/**
 * Validate whether a talent can be legally added to a build's talent tree.
 *
 * Checks two constraints:
 * 1. The talent's tree node parent must be selected in the build (reachability).
 *    Root-adjacent nodes (parent has no talent mapping or parent has no parent) are always reachable.
 * 2. The talent must not be exclusive_with any currently selected build talent.
 *
 * Fails open: unknown talents or missing tree mappings return reachable: true.
 *
 * @param {object} build - Canonical build JSON
 * @param {{ entities: Map<string, object>, edges: Array<object> }} index - Loaded index
 * @param {string} newTalentId - Entity ID of the talent to validate
 * @returns {{ reachable: boolean, reason: string }}
 */
export function validateTreeReachability(build, index, newTalentId) {
  // 1. Extract class domain
  const classId = build.class?.canonical_entity_id ?? "";
  const domain = classId.replace(/^shared\.class\./, "");
  if (!domain) {
    return { reachable: true, reason: "no class domain on build" };
  }

  // 2. Filter edges for this domain
  const domainEdges = index.edges.filter(
    (e) => e.from_entity_id.startsWith(domain + ".") || e.to_entity_id.startsWith(domain + ".")
  );

  // 3. Build lookup maps
  const talentToTreeNode = new Map();
  const treeNodeChildren = new Map();
  const treeNodeParent = new Map();
  const exclusivePairs = new Map();

  for (const e of domainEdges) {
    if (e.type === "belongs_to_tree_node") {
      talentToTreeNode.set(e.from_entity_id, e.to_entity_id);
    } else if (e.type === "parent_of") {
      if (!treeNodeChildren.has(e.from_entity_id)) {
        treeNodeChildren.set(e.from_entity_id, new Set());
      }
      treeNodeChildren.get(e.from_entity_id).add(e.to_entity_id);
      treeNodeParent.set(e.to_entity_id, e.from_entity_id);
    } else if (e.type === "exclusive_with") {
      if (!exclusivePairs.has(e.from_entity_id)) {
        exclusivePairs.set(e.from_entity_id, new Set());
      }
      exclusivePairs.get(e.from_entity_id).add(e.to_entity_id);
      if (!exclusivePairs.has(e.to_entity_id)) {
        exclusivePairs.set(e.to_entity_id, new Set());
      }
      exclusivePairs.get(e.to_entity_id).add(e.from_entity_id);
    }
  }

  // 4. Find the new talent's tree node
  const newNode = talentToTreeNode.get(newTalentId);
  if (!newNode) {
    return { reachable: true, reason: "no tree mapping for talent" };
  }

  // 5. Collect tree nodes occupied by current build selections
  const buildSlots = [
    ...(build.talents ?? []),
    build.ability,
    build.blitz,
    build.aura,
    build.keystone,
  ].filter(Boolean);

  const buildEntityIds = new Set(
    buildSlots.map((s) => s.canonical_entity_id).filter(Boolean)
  );
  const buildTreeNodes = new Set();
  for (const id of buildEntityIds) {
    const node = talentToTreeNode.get(id);
    if (node) buildTreeNodes.add(node);
  }

  // 6. Check exclusive_with: new node must not conflict with any build node
  const exclusivePartners = exclusivePairs.get(newNode);
  if (exclusivePartners) {
    for (const partner of exclusivePartners) {
      if (buildTreeNodes.has(partner)) {
        // Find the conflicting talent for the reason message
        const conflictTalent = [...buildEntityIds].find(
          (id) => talentToTreeNode.get(id) === partner
        );
        return {
          reachable: false,
          reason: `exclusive_with conflict: ${newTalentId} conflicts with ${conflictTalent ?? "unknown"}`,
        };
      }
    }
  }

  // 7. Check parent reachability
  const parentNode = treeNodeParent.get(newNode);
  if (!parentNode) {
    // Root node or root-adjacent — always reachable
    return { reachable: true, reason: "root node" };
  }

  // If parent node has no talent mapping, it's a structural root — always reachable
  const parentHasTalent = [...talentToTreeNode.entries()].some(
    ([, node]) => node === parentNode
  );
  if (!parentHasTalent) {
    return { reachable: true, reason: "parent is structural root" };
  }

  // Parent must be selected in the build
  if (buildTreeNodes.has(parentNode)) {
    return { reachable: true, reason: "parent selected in build" };
  }

  // Find which talent owns the parent node for the reason message
  const parentTalent = [...talentToTreeNode.entries()].find(
    ([, node]) => node === parentNode
  )?.[0];
  return {
    reachable: false,
    reason: `parent not in build: ${parentTalent ?? parentNode} required`,
  };
}

/**
 * Create a stable key for a synergy edge (order-independent selections).
 * @param {object} edge
 * @returns {string}
 */
function edgeKey(edge) {
  const sels = [...(edge.selections ?? [])].sort().join(",");
  return `${edge.type}::${sels}`;
}

/**
 * Find which build slot contains a given entity ID.
 *
 * Returns { location: "talents"|"ability"|"blitz"|"aura"|"keystone", index?: number }
 * or null if not found.
 *
 * @param {object} build
 * @param {string} entityId
 * @returns {{ location: string, index?: number } | null}
 */
function findSlot(build, entityId) {
  for (const slot of ["ability", "blitz", "aura", "keystone"]) {
    if (build[slot]?.canonical_entity_id === entityId) {
      return { location: slot };
    }
  }
  const talents = build.talents ?? [];
  for (let i = 0; i < talents.length; i++) {
    if (talents[i].canonical_entity_id === entityId) {
      return { location: "talents", index: i };
    }
  }
  return null;
}

/**
 * Evaluate the impact of swapping one talent for another in a build.
 *
 * Validates the swap is legal (old talent exists, new talent is reachable),
 * then computes score deltas, gained/lost synergy edges, and orphan changes.
 *
 * @param {object} build - Canonical build JSON
 * @param {{ entities: Map<string, object>, edges: Array<object> }} index - Loaded index
 * @param {string} oldId - Entity ID of the talent to remove
 * @param {string} newId - Entity ID of the talent to add
 * @returns {{ valid: boolean, reason?: string, score_delta?: object, gained_edges?: Array, lost_edges?: Array, resolved_orphans?: Array, new_orphans?: Array }}
 */
export function swapTalent(build, index, oldId, newId) {
  // 1. Validate oldId is in the build
  const slot = findSlot(build, oldId);
  if (!slot) {
    return { valid: false, reason: "old talent not found in build" };
  }

  // 2. Build a clone without oldId, then check reachability
  const buildWithoutOld = JSON.parse(JSON.stringify(build));
  if (slot.location === "talents") {
    buildWithoutOld.talents.splice(slot.index, 1);
  } else {
    buildWithoutOld[slot.location] = null;
  }

  const reachability = validateTreeReachability(buildWithoutOld, index, newId);
  if (!reachability.reachable) {
    return { valid: false, reason: reachability.reason };
  }

  // 3. Deep-clone the build and swap in the new talent
  const modifiedBuild = JSON.parse(JSON.stringify(build));
  if (slot.location === "talents") {
    modifiedBuild.talents[slot.index] = {
      canonical_entity_id: newId,
      raw_label: newId,
      resolution_status: "resolved",
    };
  } else {
    modifiedBuild[slot.location] = {
      canonical_entity_id: newId,
      raw_label: newId,
      resolution_status: "resolved",
    };
  }

  // 4 & 5. Run synergy + scoring on both builds
  const originalSynergy = analyzeBuild(build, index);
  const modifiedSynergy = analyzeBuild(modifiedBuild, index);

  const originalScores = scoreFromSynergy(originalSynergy);
  const modifiedScores = scoreFromSynergy(modifiedSynergy);

  // 6. Score deltas
  const tcDelta = modifiedScores.talent_coherence.score - originalScores.talent_coherence.score;
  const bsDelta = modifiedScores.blessing_synergy.score - originalScores.blessing_synergy.score;
  const rcDelta = modifiedScores.role_coverage.score - originalScores.role_coverage.score;

  const score_delta = {
    talent_coherence: tcDelta,
    blessing_synergy: bsDelta,
    role_coverage: rcDelta,
    composite: tcDelta + bsDelta + rcDelta,
  };

  // 7. Diff synergy edges
  const originalEdgeKeys = new Set(originalSynergy.synergy_edges.map(edgeKey));
  const modifiedEdgeKeys = new Set(modifiedSynergy.synergy_edges.map(edgeKey));

  const gained_edges = modifiedSynergy.synergy_edges.filter(
    (e) => !originalEdgeKeys.has(edgeKey(e))
  );
  const lost_edges = originalSynergy.synergy_edges.filter(
    (e) => !modifiedEdgeKeys.has(edgeKey(e))
  );

  // 8. Diff orphans
  const originalOrphanKeys = new Set(
    (originalSynergy.orphans ?? []).map((o) => `${o.selection}::${o.resource ?? o.condition}`)
  );
  const modifiedOrphanKeys = new Set(
    (modifiedSynergy.orphans ?? []).map((o) => `${o.selection}::${o.resource ?? o.condition}`)
  );

  const resolved_orphans = (originalSynergy.orphans ?? []).filter(
    (o) => !modifiedOrphanKeys.has(`${o.selection}::${o.resource ?? o.condition}`)
  );
  const new_orphans = (modifiedSynergy.orphans ?? []).filter(
    (o) => !originalOrphanKeys.has(`${o.selection}::${o.resource ?? o.condition}`)
  );

  return {
    valid: true,
    score_delta,
    gained_edges,
    lost_edges,
    resolved_orphans,
    new_orphans,
  };
}

/**
 * Evaluate the impact of swapping one weapon for another in a build.
 *
 * Determines blessing compatibility (same-family retains, cross-family removes),
 * computes score deltas, and diffs synergy edges.
 *
 * @param {object} build - Canonical build JSON
 * @param {{ entities: Map<string, object>, edges: Array<object> }} index - Loaded index
 * @param {string} oldId - Entity ID of the weapon to remove
 * @param {string} newId - Entity ID of the weapon to add
 * @returns {{ valid: boolean, reason?: string, score_delta?: object, blessing_impact?: object, gained_edges?: Array, lost_edges?: Array }}
 */
export function swapWeapon(build, index, oldId, newId) {
  // 1. Find the weapon entry in build.weapons[]
  const weapons = build.weapons ?? [];
  const weaponIdx = weapons.findIndex((w) => w.name?.canonical_entity_id === oldId);
  if (weaponIdx === -1) {
    return { valid: false, reason: "weapon not found in build" };
  }

  // 2. Resolve old and new weapon entities
  const oldEntity = index.entities.get(oldId);
  const newEntity = index.entities.get(newId);
  const oldFamily = oldEntity?.attributes?.weapon_family ?? null;
  const newFamily = newEntity?.attributes?.weapon_family ?? null;

  // 3. Determine blessing compatibility
  const oldBlessings = (weapons[weaponIdx].blessings ?? [])
    .map((b) => b.canonical_entity_id)
    .filter(Boolean);

  let retained = [];
  let removed = [];

  if (oldFamily && newFamily && oldFamily === newFamily) {
    // Same family: retain all blessings
    retained = [...oldBlessings];
  } else {
    // Different family: check trait pool edges for compatibility
    const newWeaponTraitPool = new Set(
      index.edges
        .filter((e) => e.type === "weapon_has_trait_pool" && e.from_entity_id === newId)
        .map((e) => e.to_entity_id)
    );

    if (newWeaponTraitPool.size > 0) {
      // Build reverse mapping: name_family → weapon_traits that are instance_of it
      const instanceOfEdges = index.edges.filter((e) => e.type === "instance_of");

      for (const blessingId of oldBlessings) {
        // Check if any weapon_trait in the new pool is an instance_of this blessing family
        const compatible = instanceOfEdges.some(
          (e) => newWeaponTraitPool.has(e.from_entity_id) && e.to_entity_id === blessingId
        );
        if (compatible) {
          retained.push(blessingId);
        } else {
          removed.push(blessingId);
        }
      }
    } else {
      // No trait pool data for new weapon — conservatively remove all
      removed = [...oldBlessings];
    }
  }

  // Compute available blessings for the new weapon
  const available = computeAvailableBlessings(newId, newFamily, index);

  const blessing_impact = { retained, removed, available };

  // 4. Deep-clone build and replace weapon entry
  const modifiedBuild = JSON.parse(JSON.stringify(build));
  const modifiedWeapon = modifiedBuild.weapons[weaponIdx];
  modifiedWeapon.name.canonical_entity_id = newId;
  modifiedWeapon.name.raw_label = newId;

  // Keep retained blessings, remove removed ones
  if (removed.length > 0) {
    const removedSet = new Set(removed);
    modifiedWeapon.blessings = (modifiedWeapon.blessings ?? []).filter(
      (b) => !removedSet.has(b.canonical_entity_id)
    );
  }

  // 5. Run synergy → scoring on both builds
  const originalSynergy = analyzeBuild(build, index);
  const modifiedSynergy = analyzeBuild(modifiedBuild, index);

  const originalScores = scoreFromSynergy(originalSynergy);
  const modifiedScores = scoreFromSynergy(modifiedSynergy);

  // 6. Score deltas
  const tcDelta = modifiedScores.talent_coherence.score - originalScores.talent_coherence.score;
  const bsDelta = modifiedScores.blessing_synergy.score - originalScores.blessing_synergy.score;
  const rcDelta = modifiedScores.role_coverage.score - originalScores.role_coverage.score;

  const score_delta = {
    talent_coherence: tcDelta,
    blessing_synergy: bsDelta,
    role_coverage: rcDelta,
    composite: tcDelta + bsDelta + rcDelta,
  };

  // 7. Diff synergy edges
  const originalEdgeKeys = new Set(originalSynergy.synergy_edges.map(edgeKey));
  const modifiedEdgeKeys = new Set(modifiedSynergy.synergy_edges.map(edgeKey));

  const gained_edges = modifiedSynergy.synergy_edges.filter(
    (e) => !originalEdgeKeys.has(edgeKey(e))
  );
  const lost_edges = originalSynergy.synergy_edges.filter(
    (e) => !modifiedEdgeKeys.has(edgeKey(e))
  );

  return {
    valid: true,
    score_delta,
    blessing_impact,
    gained_edges,
    lost_edges,
  };
}

/**
 * Find all blessing name_families available for a given weapon.
 *
 * Uses weapon_has_trait_pool edges (weapon → weapon_trait) and instance_of edges
 * (weapon_trait → name_family) to trace available blessings. Falls back to
 * family-prefix matching on instance_of edges if no trait pool edges exist.
 *
 * @param {string} weaponId - Weapon entity ID
 * @param {string | null} weaponFamily - Weapon family string
 * @param {{ entities: Map<string, object>, edges: Array<object> }} index
 * @returns {string[]} - Blessing name_family entity IDs
 */
function computeAvailableBlessings(weaponId, weaponFamily, index) {
  // Try direct trait pool edges first
  const traitPoolIds = index.edges
    .filter((e) => e.type === "weapon_has_trait_pool" && e.from_entity_id === weaponId)
    .map((e) => e.to_entity_id);

  if (traitPoolIds.length > 0) {
    const poolSet = new Set(traitPoolIds);
    return index.edges
      .filter((e) => e.type === "instance_of" && poolSet.has(e.from_entity_id))
      .map((e) => e.to_entity_id);
  }

  // Fallback: match instance_of edges where the weapon_trait ID contains the family prefix
  if (weaponFamily) {
    const familyPattern = `weapon_trait_bespoke_${weaponFamily}`;
    return index.edges
      .filter(
        (e) => e.type === "instance_of" && e.from_entity_id.includes(familyPattern)
      )
      .map((e) => e.to_entity_id);
  }

  return [];
}
