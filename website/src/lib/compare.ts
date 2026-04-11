import { DIMENSIONS } from "./dimensions.ts";
import type {
  BreakpointMatrixDetail,
  BuildDetailData,
  BuildStructure,
  BuildStructureEntry,
  BuildStructureWeapon,
  CompareActionCategory,
  CompareBreakpointDelta,
  CompareScoreDelta,
  CompareSetDiff,
  ScorecardWeaponDetail,
  SynergyAnalysisDetail,
  SynergyEdgeDetail,
} from "./types.ts";

type CompareableEntry = {
  compare_key: string;
};

type BreakpointBucket = {
  htk: number | null;
  weapon: string | null;
};

type SlotKey = keyof BuildStructure["slots"];

const ACTION_CATEGORY: Record<string, CompareActionCategory> = {
  light_attack: "light",
  action_swing: "light",
  action_swing_right: "light",
  action_swing_up: "light",
  push_followup: "light",
  heavy_attack: "heavy",
  shoot_hip: "light",
  shoot_zoomed: "light",
  shoot_charged: "heavy",
  weapon_special: "special",
  push: "push",
  action_overheat_explode: "special",
};

function compareKey(entry: BuildStructureEntry): string {
  return entry.id == null ? `unresolved::${entry.name}` : `${entry.id}::${entry.name}`;
}

function tally<T extends CompareableEntry>(items: T[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.compare_key, (counts.get(item.compare_key) ?? 0) + 1);
  }
  return counts;
}

function takeShared<T extends CompareableEntry>(
  items: T[],
  countsA: Map<string, number>,
  countsB: Map<string, number>,
): T[] {
  const used = new Map<string, number>();
  const shared: T[] = [];

  for (const item of items) {
    const limit = Math.min(countsA.get(item.compare_key) ?? 0, countsB.get(item.compare_key) ?? 0);
    const current = used.get(item.compare_key) ?? 0;
    if (current < limit) {
      shared.push(item);
      used.set(item.compare_key, current + 1);
    }
  }

  return shared;
}

function takeOnly<T extends CompareableEntry>(
  items: T[],
  countsA: Map<string, number>,
  countsB: Map<string, number>,
): T[] {
  const used = new Map<string, number>();
  const only: T[] = [];

  for (const item of items) {
    const limit = Math.max((countsA.get(item.compare_key) ?? 0) - (countsB.get(item.compare_key) ?? 0), 0);
    const current = used.get(item.compare_key) ?? 0;
    if (current < limit) {
      only.push(item);
      used.set(item.compare_key, current + 1);
    }
  }

  return only;
}

function weaponNameByEntityId(weapons: ScorecardWeaponDetail[]): Map<string, string> {
  return new Map(
    weapons
      .filter((weapon): weapon is ScorecardWeaponDetail & { canonical_entity_id: string } => weapon.canonical_entity_id != null)
      .map((weapon) => [weapon.canonical_entity_id, weapon.name]),
  );
}

function bestHitsByBreedAndCategory(
  matrix: BreakpointMatrixDetail,
  weapons: ScorecardWeaponDetail[],
  scenario: string,
  difficulty: string,
): Map<string, BreakpointBucket> {
  const byEntityId = weaponNameByEntityId(weapons);
  const result = new Map<string, BreakpointBucket>();

  for (const weapon of matrix.weapons) {
    const weaponName = byEntityId.get(weapon.entityId) ?? weapon.entityId;

    for (const action of weapon.actions) {
      const category = ACTION_CATEGORY[action.type];
      if (!category) continue;

      for (const breed of action.scenarios[scenario]?.breeds ?? []) {
        if (breed.difficulty !== difficulty) continue;

        const rowKey = `${breed.breed_id}::${category}`;
        const current = result.get(rowKey);
        if (
          current == null
          || current.htk == null
          || (breed.hitsToKill != null && breed.hitsToKill < current.htk)
        ) {
          result.set(rowKey, {
            htk: breed.hitsToKill,
            weapon: weaponName,
          });
        }
      }
    }
  }

  return result;
}

export function computeScoreDeltas(a: BuildDetailData, b: BuildDetailData): CompareScoreDelta[] {
  return DIMENSIONS.map((dimension) => {
    const aQualitative = a.scorecard.qualitative[
      dimension.scorecard_key as keyof typeof a.scorecard.qualitative
    ];
    const bQualitative = b.scorecard.qualitative[
      dimension.scorecard_key as keyof typeof b.scorecard.qualitative
    ];

    const aValue = dimension.scorecard_key === "composite_score"
      ? a.scorecard.composite_score
      : aQualitative?.score ?? a.scorecard[dimension.scorecard_key as keyof typeof a.scorecard] as number | null;
    const bValue = dimension.scorecard_key === "composite_score"
      ? b.scorecard.composite_score
      : bQualitative?.score ?? b.scorecard[dimension.scorecard_key as keyof typeof b.scorecard] as number | null;

    return {
      dimension: dimension.scorecard_key,
      label: dimension.label,
      a: aValue,
      b: bValue,
      delta: aValue == null || bValue == null ? null : bValue - aValue,
      max: dimension.max,
    };
  });
}

export function computeSetDiff<T extends CompareableEntry>(itemsA: T[], itemsB: T[]): CompareSetDiff<T> {
  const countsA = tally(itemsA);
  const countsB = tally(itemsB);

  return {
    shared: takeShared(itemsA, countsA, countsB),
    only_a: takeOnly(itemsA, countsA, countsB),
    only_b: takeOnly(itemsB, countsB, countsA),
  };
}

export function computeSlotDiff(a: BuildStructure, b: BuildStructure) {
  const keys: SlotKey[] = ["ability", "blitz", "aura", "keystone"];

  return keys.map((key) => ({
    key,
    label: key.charAt(0).toUpperCase() + key.slice(1),
    a: a.slots[key],
    b: b.slots[key],
    changed: a.slots[key].id !== b.slots[key].id || a.slots[key].name !== b.slots[key].name,
  }));
}

export function computeSynergyEdgeDiff(
  a: SynergyAnalysisDetail,
  b: SynergyAnalysisDetail,
): CompareSetDiff<SynergyEdgeDetail & { compare_key: string }> {
  const keyed = (edge: SynergyEdgeDetail) => ({
    ...edge,
    compare_key: `${edge.type}::${[...edge.families].sort().join("|")}::${[...edge.selections].sort().join("|")}`,
  });

  return computeSetDiff(
    a.synergy_edges.map(keyed),
    b.synergy_edges.map(keyed),
  );
}

export function talentEntries(detail: BuildDetailData): Array<{ compare_key: string; id: string; name: string }> {
  return detail.structure.talents.map((talent) => ({
    compare_key: `${talent.id}::${talent.name}`,
    ...talent,
  }));
}

export function weaponEntries(detail: BuildDetailData): Array<BuildStructureWeapon & { compare_key: string; blessings: Array<BuildStructureEntry & { compare_key: string }> }> {
  return detail.structure.weapons.map((weapon) => ({
    ...weapon,
    compare_key: `${weapon.id}::${weapon.name}`,
    blessings: weapon.blessings.map((blessing) => ({
      ...blessing,
      compare_key: compareKey(blessing),
    })),
  }));
}

export function curioPerkEntries(detail: BuildDetailData): Array<BuildStructureEntry & { compare_key: string }> {
  return detail.structure.curio_perks.map((perk) => ({
    ...perk,
    compare_key: compareKey(perk),
  }));
}

export function computeCurioPerkDiff(
  a: BuildDetailData,
  b: BuildDetailData,
): CompareSetDiff<BuildStructureEntry & { compare_key: string }> {
  return computeSetDiff(curioPerkEntries(a), curioPerkEntries(b));
}

export function computeBreakpointDiff(
  a: BreakpointMatrixDetail,
  b: BreakpointMatrixDetail,
  scenario: string,
  difficulty: string,
  aWeapons: ScorecardWeaponDetail[],
  bWeapons: ScorecardWeaponDetail[],
): CompareBreakpointDelta[] {
  const rowsA = bestHitsByBreedAndCategory(a, aWeapons, scenario, difficulty);
  const rowsB = bestHitsByBreedAndCategory(b, bWeapons, scenario, difficulty);
  const keys = [...new Set([...rowsA.keys(), ...rowsB.keys()])].sort();

  return keys.map((key) => {
    const [breed_id, action_category] = key.split("::");
    const aRow = rowsA.get(key) ?? { htk: null, weapon: null };
    const bRow = rowsB.get(key) ?? { htk: null, weapon: null };

    return {
      breed_id,
      action_category: action_category as CompareActionCategory,
      a_htk: aRow.htk,
      b_htk: bRow.htk,
      delta: aRow.htk == null || bRow.htk == null ? null : bRow.htk - aRow.htk,
      a_weapon: aRow.weapon,
      b_weapon: bRow.weapon,
    };
  });
}
