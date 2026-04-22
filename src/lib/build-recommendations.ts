// Gap analysis for build recommendations (#10).

import { analyzeBuild } from "./synergy-model.js";
import type { SynergyIndex, AnalyzeBuildResult, CoverageResult } from "./synergy-model.js";
import type { SynergyEdge, OrphanEntry } from "./synergy-rules.js";
import { loadScorecardDeps, analyzeScorecard } from "./scorecard-deps.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GapDescriptor {
  reason: string;
  suggested_families: string[];
}

interface Gap {
  type: string;
  reason: string;
  suggested_families: string[];
}

interface GapAnalysisResult {
  gaps: Gap[];
  underinvested_families: string[];
  scorecard: Record<string, unknown>;
}

interface ReachabilityResult {
  reachable: boolean;
  reason: string;
}

interface ScoreDelta {
  perk_optimality: number | null;
  curio_efficiency: number | null;
  talent_coherence: number | null;
  blessing_synergy: number | null;
  role_coverage: number | null;
  breakpoint_relevance: number | null;
  difficulty_scaling: number | null;
  survivability: number | null;
  composite: number | null;
}

interface BotFlagDelta {
  added: string[];
  removed: string[];
}

interface SwapTalentResult {
  valid: boolean;
  reason?: string;
  score_delta?: ScoreDelta;
  bot_flag_delta?: BotFlagDelta;
  gained_edges?: SynergyEdge[];
  lost_edges?: SynergyEdge[];
  resolved_orphans?: OrphanEntry[];
  new_orphans?: OrphanEntry[];
}

interface BlessingImpact {
  retained: string[];
  removed: string[];
  available: string[];
}

interface SwapWeaponResult {
  valid: boolean;
  reason?: string;
  score_delta?: ScoreDelta;
  bot_flag_delta?: BotFlagDelta;
  blessing_impact?: BlessingImpact;
  gained_edges?: SynergyEdge[];
  lost_edges?: SynergyEdge[];
}

interface Precomputed {
  synergy?: AnalyzeBuildResult;
  scorecard?: Record<string, unknown>;
}

// Partial canonical build shape
interface CanonicalBuild {
  class?: { canonical_entity_id?: string };
  ability?: { canonical_entity_id?: string } | null;
  blitz?: { canonical_entity_id?: string } | null;
  aura?: { canonical_entity_id?: string } | null;
  keystone?: { canonical_entity_id?: string } | null;
  talents?: Array<{ canonical_entity_id?: string; raw_label?: string; resolution_status?: string }>;
  weapons?: Array<{
    name?: { canonical_entity_id?: string; raw_label?: string };
    blessings?: Array<{ canonical_entity_id?: string }>;
    slot?: string;
  }>;
  curios?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

interface EntityBase {
  id: string;
  attributes?: { weapon_family?: string };
  [key: string]: unknown;
}

interface EdgeBase {
  type: string;
  from_entity_id: string;
  to_entity_id: string;
  [key: string]: unknown;
}

type ScorecardRecord = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GAP_DESCRIPTORS: Record<string, GapDescriptor> = {
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

const SCORE_DIMENSIONS = [
  "perk_optimality",
  "curio_efficiency",
  "talent_coherence",
  "blessing_synergy",
  "role_coverage",
  "breakpoint_relevance",
  "difficulty_scaling",
  "survivability",
  "composite",
] as const;

function qualitativeScore(scorecard: ScorecardRecord, key: string): number | null {
  const qualitative = scorecard.qualitative;
  if (qualitative == null || typeof qualitative !== "object") {
    return null;
  }

  const dimension = (qualitative as ScorecardRecord)[key];
  if (dimension == null || typeof dimension !== "object") {
    return null;
  }

  const score = (dimension as ScorecardRecord).score;
  return typeof score === "number" ? score : null;
}

function scorecardDimensionScore(
  scorecard: ScorecardRecord,
  dimension: typeof SCORE_DIMENSIONS[number],
): number | null {
  switch (dimension) {
    case "perk_optimality":
    case "curio_efficiency": {
      const value = scorecard[dimension];
      return typeof value === "number" ? value : null;
    }
    case "composite": {
      const value = scorecard.composite_score;
      return typeof value === "number" ? value : null;
    }
    default:
      return qualitativeScore(scorecard, dimension);
  }
}

function computeScoreDelta(
  before: ScorecardRecord,
  after: ScorecardRecord,
): ScoreDelta {
  return {
    perk_optimality: deltaForDimension(before, after, "perk_optimality"),
    curio_efficiency: deltaForDimension(before, after, "curio_efficiency"),
    talent_coherence: deltaForDimension(before, after, "talent_coherence"),
    blessing_synergy: deltaForDimension(before, after, "blessing_synergy"),
    role_coverage: deltaForDimension(before, after, "role_coverage"),
    breakpoint_relevance: deltaForDimension(before, after, "breakpoint_relevance"),
    difficulty_scaling: deltaForDimension(before, after, "difficulty_scaling"),
    survivability: deltaForDimension(before, after, "survivability"),
    composite: deltaForDimension(before, after, "composite"),
  };
}

function deltaForDimension(
  before: ScorecardRecord,
  after: ScorecardRecord,
  dimension: typeof SCORE_DIMENSIONS[number],
): number | null {
  const beforeScore = scorecardDimensionScore(before, dimension);
  const afterScore = scorecardDimensionScore(after, dimension);
  if (beforeScore == null || afterScore == null) {
    return null;
  }
  return afterScore - beforeScore;
}

function computeBotFlagDelta(
  before: ScorecardRecord,
  after: ScorecardRecord,
): BotFlagDelta {
  const beforeFlags = new Set(
    Array.isArray(before.bot_flags)
      ? before.bot_flags.filter((flag): flag is string => typeof flag === "string")
      : [],
  );
  const afterFlags = new Set(
    Array.isArray(after.bot_flags)
      ? after.bot_flags.filter((flag): flag is string => typeof flag === "string")
      : [],
  );

  return {
    added: [...afterFlags].filter((flag) => !beforeFlags.has(flag)),
    removed: [...beforeFlags].filter((flag) => !afterFlags.has(flag)),
  };
}

// ---------------------------------------------------------------------------
// Gap analysis
// ---------------------------------------------------------------------------

export function analyzeGaps(
  build: CanonicalBuild,
  index: SynergyIndex,
  precomputed: Precomputed | null = null,
): GapAnalysisResult {
  const synergy = precomputed?.synergy ?? analyzeBuild(build as any, index);
  const scorecard = precomputed?.scorecard ?? analyzeScorecard(
    build as ScorecardRecord,
    loadScorecardDeps(),
    {
      index: index as unknown as ScorecardRecord,
      synergyOutput: synergy as unknown as ScorecardRecord,
    },
  ).scorecard;

  const family_profile = synergy.coverage?.family_profile ?? {};
  const coverage_gaps = synergy.coverage?.coverage_gaps ?? [];
  const slot_balance = synergy.coverage?.slot_balance ?? {};

  const underinvested_families = Object.entries(family_profile)
    .filter(([, data]) => data.count <= 1)
    .map(([family]) => family);

  const gaps: Gap[] = coverage_gaps.map((gapName) => {
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

  const melee = slot_balance.melee?.strength ?? 0;
  const ranged = slot_balance.ranged?.strength ?? 0;

  let slot_balance_ratio: number;
  if (melee === 0 && ranged === 0) {
    slot_balance_ratio = 0.5;
  } else {
    slot_balance_ratio = Math.min(melee, ranged) / Math.max(melee, ranged);
  }

  if (slot_balance_ratio < 0.3) {
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
    scorecard: scorecard as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Tree reachability
// ---------------------------------------------------------------------------

export function validateTreeReachability(
  build: CanonicalBuild,
  index: SynergyIndex,
  newTalentId: string,
): ReachabilityResult {
  const classId = build.class?.canonical_entity_id ?? "";
  const domain = classId.replace(/^shared\.class\./, "");
  if (!domain) {
    return { reachable: true, reason: "no class domain on build" };
  }

  const domainEdges = (index.edges as EdgeBase[]).filter(
    (e) => e.from_entity_id.startsWith(domain + ".") || e.to_entity_id.startsWith(domain + ".")
  );

  const talentToTreeNode = new Map<string, string>();
  const treeNodeChildren = new Map<string, Set<string>>();
  const treeNodeParent = new Map<string, string>();
  const exclusivePairs = new Map<string, Set<string>>();

  for (const e of domainEdges) {
    if (e.type === "belongs_to_tree_node") {
      talentToTreeNode.set(e.from_entity_id, e.to_entity_id);
    } else if (e.type === "parent_of") {
      if (!treeNodeChildren.has(e.from_entity_id)) {
        treeNodeChildren.set(e.from_entity_id, new Set());
      }
      treeNodeChildren.get(e.from_entity_id)!.add(e.to_entity_id);
      treeNodeParent.set(e.to_entity_id, e.from_entity_id);
    } else if (e.type === "exclusive_with") {
      if (!exclusivePairs.has(e.from_entity_id)) {
        exclusivePairs.set(e.from_entity_id, new Set());
      }
      exclusivePairs.get(e.from_entity_id)!.add(e.to_entity_id);
      if (!exclusivePairs.has(e.to_entity_id)) {
        exclusivePairs.set(e.to_entity_id, new Set());
      }
      exclusivePairs.get(e.to_entity_id)!.add(e.from_entity_id);
    }
  }

  const newNode = talentToTreeNode.get(newTalentId);
  if (!newNode) {
    return { reachable: true, reason: "no tree mapping for talent" };
  }

  const buildSlots = [
    ...(build.talents ?? []),
    build.ability,
    build.blitz,
    build.aura,
    build.keystone,
  ].filter(Boolean) as Array<{ canonical_entity_id?: string }>;

  const buildEntityIds = new Set(
    buildSlots.map((s) => s.canonical_entity_id).filter(Boolean) as string[]
  );
  const buildTreeNodes = new Set<string>();
  for (const id of buildEntityIds) {
    const node = talentToTreeNode.get(id);
    if (node) buildTreeNodes.add(node);
  }

  const exclusivePartners = exclusivePairs.get(newNode);
  if (exclusivePartners) {
    for (const partner of exclusivePartners) {
      if (buildTreeNodes.has(partner)) {
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

  const parentNode = treeNodeParent.get(newNode);
  if (!parentNode) {
    return { reachable: true, reason: "root node" };
  }

  const parentHasTalent = [...talentToTreeNode.entries()].some(
    ([, node]) => node === parentNode
  );
  if (!parentHasTalent) {
    return { reachable: true, reason: "parent is structural root" };
  }

  if (buildTreeNodes.has(parentNode)) {
    return { reachable: true, reason: "parent selected in build" };
  }

  const parentTalent = [...talentToTreeNode.entries()].find(
    ([, node]) => node === parentNode
  )?.[0];
  return {
    reachable: false,
    reason: `parent not in build: ${parentTalent ?? parentNode} required`,
  };
}

// ---------------------------------------------------------------------------
// Swap helpers
// ---------------------------------------------------------------------------

function edgeKey(edge: SynergyEdge): string {
  const sels = [...(edge.selections ?? [])].sort().join(",");
  return `${edge.type}::${sels}`;
}

function findSlot(
  build: CanonicalBuild,
  entityId: string,
): { location: string; index?: number } | null {
  for (const slot of ["ability", "blitz", "aura", "keystone"] as const) {
    if ((build[slot] as { canonical_entity_id?: string } | null | undefined)?.canonical_entity_id === entityId) {
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

// ---------------------------------------------------------------------------
// Talent swap
// ---------------------------------------------------------------------------

export function swapTalent(
  build: CanonicalBuild,
  index: SynergyIndex,
  oldId: string,
  newId: string,
): SwapTalentResult {
  const slot = findSlot(build, oldId);
  if (!slot) {
    return { valid: false, reason: "old talent not found in build" };
  }

  const buildWithoutOld = JSON.parse(JSON.stringify(build)) as CanonicalBuild;
  if (slot.location === "talents") {
    buildWithoutOld.talents!.splice(slot.index!, 1);
  } else {
    (buildWithoutOld as Record<string, unknown>)[slot.location] = null;
  }

  const reachability = validateTreeReachability(buildWithoutOld, index, newId);
  if (!reachability.reachable) {
    return { valid: false, reason: reachability.reason };
  }

  const modifiedBuild = JSON.parse(JSON.stringify(build)) as CanonicalBuild;
  if (slot.location === "talents") {
    modifiedBuild.talents![slot.index!] = {
      canonical_entity_id: newId,
      raw_label: newId,
      resolution_status: "resolved",
    };
  } else {
    (modifiedBuild as Record<string, unknown>)[slot.location] = {
      canonical_entity_id: newId,
      raw_label: newId,
      resolution_status: "resolved",
    };
  }

  const originalSynergy = analyzeBuild(build as any, index);
  const modifiedSynergy = analyzeBuild(modifiedBuild as any, index);
  const deps = loadScorecardDeps();
  const originalScorecard = analyzeScorecard(
    build as ScorecardRecord,
    deps,
    {
      index: index as unknown as ScorecardRecord,
      synergyOutput: originalSynergy as unknown as ScorecardRecord,
    },
  ).scorecard;
  const modifiedScorecard = analyzeScorecard(
    modifiedBuild as ScorecardRecord,
    deps,
    {
      index: index as unknown as ScorecardRecord,
      synergyOutput: modifiedSynergy as unknown as ScorecardRecord,
    },
  ).scorecard;

  const originalEdgeKeys = new Set(originalSynergy.synergy_edges.map(edgeKey));
  const modifiedEdgeKeys = new Set(modifiedSynergy.synergy_edges.map(edgeKey));

  const gained_edges = modifiedSynergy.synergy_edges.filter(
    (e) => !originalEdgeKeys.has(edgeKey(e))
  );
  const lost_edges = originalSynergy.synergy_edges.filter(
    (e) => !modifiedEdgeKeys.has(edgeKey(e))
  );

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
    score_delta: computeScoreDelta(originalScorecard, modifiedScorecard),
    bot_flag_delta: computeBotFlagDelta(originalScorecard, modifiedScorecard),
    gained_edges,
    lost_edges,
    resolved_orphans,
    new_orphans,
  };
}

// ---------------------------------------------------------------------------
// Weapon swap
// ---------------------------------------------------------------------------

export function swapWeapon(
  build: CanonicalBuild,
  index: SynergyIndex,
  oldId: string,
  newId: string,
): SwapWeaponResult {
  const weapons = build.weapons ?? [];
  const weaponIdx = weapons.findIndex((w) => w.name?.canonical_entity_id === oldId);
  if (weaponIdx === -1) {
    return { valid: false, reason: "weapon not found in build" };
  }

  const oldEntity = (index.entities as Map<string, EntityBase>).get(oldId);
  const newEntity = (index.entities as Map<string, EntityBase>).get(newId);
  const oldFamily = oldEntity?.attributes?.weapon_family ?? null;
  const newFamily = newEntity?.attributes?.weapon_family ?? null;

  const oldBlessings = (weapons[weaponIdx].blessings ?? [])
    .map((b) => b.canonical_entity_id)
    .filter(Boolean) as string[];

  let retained: string[] = [];
  let removed: string[] = [];

  if (oldFamily && newFamily && oldFamily === newFamily) {
    retained = [...oldBlessings];
  } else {
    const newWeaponTraitPool = new Set(
      (index.edges as EdgeBase[])
        .filter((e) => e.type === "weapon_has_trait_pool" && e.from_entity_id === newId)
        .map((e) => e.to_entity_id)
    );

    if (newWeaponTraitPool.size > 0) {
      const instanceOfEdges = (index.edges as EdgeBase[]).filter((e) => e.type === "instance_of");

      for (const blessingId of oldBlessings) {
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
      removed = [...oldBlessings];
    }
  }

  const available = computeAvailableBlessings(newId, newFamily, index);

  const blessing_impact: BlessingImpact = { retained, removed, available };

  const modifiedBuild = JSON.parse(JSON.stringify(build)) as CanonicalBuild;
  const modifiedWeapon = modifiedBuild.weapons![weaponIdx];
  (modifiedWeapon.name as Record<string, unknown>).canonical_entity_id = newId;
  (modifiedWeapon.name as Record<string, unknown>).raw_label = newId;

  if (removed.length > 0) {
    const removedSet = new Set(removed);
    modifiedWeapon.blessings = (modifiedWeapon.blessings ?? []).filter(
      (b) => !removedSet.has(b.canonical_entity_id!)
    );
  }

  const originalSynergy = analyzeBuild(build as any, index);
  const modifiedSynergy = analyzeBuild(modifiedBuild as any, index);
  const deps = loadScorecardDeps();
  const originalScorecard = analyzeScorecard(
    build as ScorecardRecord,
    deps,
    {
      index: index as unknown as ScorecardRecord,
      synergyOutput: originalSynergy as unknown as ScorecardRecord,
    },
  ).scorecard;
  const modifiedScorecard = analyzeScorecard(
    modifiedBuild as ScorecardRecord,
    deps,
    {
      index: index as unknown as ScorecardRecord,
      synergyOutput: modifiedSynergy as unknown as ScorecardRecord,
    },
  ).scorecard;

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
    score_delta: computeScoreDelta(originalScorecard, modifiedScorecard),
    bot_flag_delta: computeBotFlagDelta(originalScorecard, modifiedScorecard),
    blessing_impact,
    gained_edges,
    lost_edges,
  };
}

// ---------------------------------------------------------------------------
// Available blessings
// ---------------------------------------------------------------------------

function computeAvailableBlessings(
  weaponId: string,
  weaponFamily: string | null,
  index: SynergyIndex,
): string[] {
  const traitPoolIds = (index.edges as EdgeBase[])
    .filter((e) => e.type === "weapon_has_trait_pool" && e.from_entity_id === weaponId)
    .map((e) => e.to_entity_id);

  if (traitPoolIds.length > 0) {
    const poolSet = new Set(traitPoolIds);
    return (index.edges as EdgeBase[])
      .filter((e) => e.type === "instance_of" && poolSet.has(e.from_entity_id))
      .map((e) => e.to_entity_id);
  }

  if (weaponFamily) {
    const familyPattern = `weapon_trait_bespoke_${weaponFamily}`;
    return (index.edges as EdgeBase[])
      .filter(
        (e) => e.type === "instance_of" && e.from_entity_id.includes(familyPattern)
      )
      .map((e) => e.to_entity_id);
  }

  return [];
}
