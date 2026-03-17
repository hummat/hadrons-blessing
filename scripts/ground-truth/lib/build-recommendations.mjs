// scripts/ground-truth/lib/build-recommendations.mjs
// Gap analysis for build recommendations (#10).

import { analyzeBuild } from "./synergy-model.mjs";
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

  // Slot imbalance gap: min/max ratio < 0.3 (both-zero treated as ratio 1.0)
  const melee = slot_balance.melee?.strength ?? 0;
  const ranged = slot_balance.ranged?.strength ?? 0;

  let slot_balance_ratio;
  if (melee === 0 && ranged === 0) {
    slot_balance_ratio = 1.0;
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
