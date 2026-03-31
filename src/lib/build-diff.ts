// src/lib/build-diff.ts
// Structural and score diff between two canonical build files.

import { readFileSync } from "node:fs";
import { loadScorecardDeps, buildScorecard } from "./scorecard-deps.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScoreDelta {
  dimension: string;
  a: number | null;
  b: number | null;
  delta: number | null; // b - a, null if either missing
}

export interface StructuralDiff {
  class_match: boolean;
  talents: { only_a: string[]; only_b: string[]; shared: string[] };
  weapons: { only_a: string[]; only_b: string[]; shared: string[] };
  blessings: { only_a: string[]; only_b: string[]; shared: string[] };
  curio_perks: { only_a: string[]; only_b: string[]; shared: string[] };
  ability: { a: string | null; b: string | null; changed: boolean };
  blitz: { a: string | null; b: string | null; changed: boolean };
  aura: { a: string | null; b: string | null; changed: boolean };
  keystone: { a: string | null; b: string | null; changed: boolean };
}

export interface BreakpointDelta {
  label: string;
  a_htk: number | null;
  b_htk: number | null;
  delta: number | null;
}

export interface AnalyticalDiff {
  synergy_edges: { only_a: string[]; only_b: string[]; shared: string[] };
  breakpoints: BreakpointDelta[];
}

export interface BuildDiff {
  a: { file: string; title: string; class: string };
  b: { file: string; title: string; class: string };
  score_deltas: ScoreDelta[];
  structural: StructuralDiff;
  analytical: AnalyticalDiff | null; // null unless detailed mode
}

export interface DiffOptions {
  detailed?: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type AnyRecord = Record<string, unknown>;

function readBuild(filePath: string): AnyRecord {
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as AnyRecord;
}

/** Set diff: returns only_a, only_b, shared from two arrays of IDs. */
function computeSetDiff(
  idsA: string[],
  idsB: string[]
): { only_a: string[]; only_b: string[]; shared: string[] } {
  const setA = new Set(idsA);
  const setB = new Set(idsB);
  const only_a = idsA.filter((id) => !setB.has(id));
  const only_b = idsB.filter((id) => !setA.has(id));
  const shared = idsA.filter((id) => setB.has(id));
  return { only_a, only_b, shared };
}

/** Slot diff for a nullable selection object. */
function slotDiff(
  a: AnyRecord | null | undefined,
  b: AnyRecord | null | undefined
): { a: string | null; b: string | null; changed: boolean } {
  const idA = (a?.canonical_entity_id as string | null | undefined) ?? null;
  const idB = (b?.canonical_entity_id as string | null | undefined) ?? null;
  return { a: idA, b: idB, changed: idA !== idB };
}

/** Extract canonical_entity_id from a selection, or null. */
function selectionId(sel: unknown): string | null {
  if (!sel || typeof sel !== "object") return null;
  const s = sel as AnyRecord;
  return (s.canonical_entity_id as string | null | undefined) ?? null;
}

/** Extract canonical talent IDs from build.talents[]. */
function talentIds(build: AnyRecord): string[] {
  const talents = build.talents as AnyRecord[] | undefined;
  if (!talents) return [];
  return talents.map(selectionId).filter((id): id is string => id !== null);
}

/** Extract canonical weapon name IDs from build.weapons[]. */
function weaponIds(build: AnyRecord): string[] {
  const weapons = build.weapons as AnyRecord[] | undefined;
  if (!weapons) return [];
  return weapons
    .map((w) => selectionId(w.name as AnyRecord))
    .filter((id): id is string => id !== null);
}

/** Extract canonical blessing IDs flattened across all weapons. */
function blessingIds(build: AnyRecord): string[] {
  const weapons = build.weapons as AnyRecord[] | undefined;
  if (!weapons) return [];
  const ids: string[] = [];
  for (const w of weapons) {
    const blessings = w.blessings as AnyRecord[] | undefined;
    if (!blessings) continue;
    for (const b of blessings) {
      const id = selectionId(b);
      if (id !== null) ids.push(id);
    }
  }
  return ids;
}

/** Extract curio perk IDs flattened across all curios. */
function curioPerkIds(build: AnyRecord): string[] {
  const curios = build.curios as AnyRecord[] | undefined;
  if (!curios) return [];
  const ids: string[] = [];
  for (const curio of curios) {
    const perks = curio.perks as unknown[] | undefined;
    if (!perks) continue;
    for (const perk of perks) {
      if (typeof perk === "string") {
        ids.push(perk);
      } else if (perk && typeof perk === "object") {
        const p = perk as AnyRecord;
        const id =
          (p.canonical_entity_id as string | null | undefined) ??
          (p.raw_label as string | null | undefined) ??
          null;
        if (id !== null) ids.push(id);
      }
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Score extraction
// ---------------------------------------------------------------------------

function extractScore(scorecard: AnyRecord, dimension: string): number | null {
  if (
    dimension === "composite_score" ||
    dimension === "perk_optimality" ||
    dimension === "curio_efficiency"
  ) {
    const v = scorecard[dimension];
    return typeof v === "number" ? v : null;
  }

  // Qualitative dimensions live under scorecard.qualitative.{dim}.score
  const qualitative = scorecard.qualitative as AnyRecord | null | undefined;
  if (!qualitative) return null;
  const dim = qualitative[dimension] as AnyRecord | null | undefined;
  if (!dim) return null;
  const score = dim.score;
  return typeof score === "number" ? score : null;
}

const SCORE_DIMENSIONS = [
  "composite_score",
  "perk_optimality",
  "curio_efficiency",
  "talent_coherence",
  "blessing_synergy",
  "role_coverage",
  "breakpoint_relevance",
  "difficulty_scaling",
] as const;

function computeScoreDeltas(
  scorecardA: AnyRecord,
  scorecardB: AnyRecord
): ScoreDelta[] {
  return SCORE_DIMENSIONS.map((dimension) => {
    const a = extractScore(scorecardA, dimension);
    const b = extractScore(scorecardB, dimension);
    const delta = a !== null && b !== null ? b - a : null;
    return { dimension, a, b, delta };
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function diffBuilds(
  pathA: string,
  pathB: string,
  options?: DiffOptions
): BuildDiff {
  const buildA = readBuild(pathA);
  const buildB = readBuild(pathB);

  const deps = loadScorecardDeps();
  const scorecardA = buildScorecard(buildA, deps);
  const scorecardB = buildScorecard(buildB, deps);

  const classIdA = selectionId(buildA.class as AnyRecord);
  const classIdB = selectionId(buildB.class as AnyRecord);

  const structural: StructuralDiff = {
    class_match: classIdA !== null && classIdA === classIdB,
    talents: computeSetDiff(talentIds(buildA), talentIds(buildB)),
    weapons: computeSetDiff(weaponIds(buildA), weaponIds(buildB)),
    blessings: computeSetDiff(blessingIds(buildA), blessingIds(buildB)),
    curio_perks: computeSetDiff(curioPerkIds(buildA), curioPerkIds(buildB)),
    ability: slotDiff(
      buildA.ability as AnyRecord,
      buildB.ability as AnyRecord
    ),
    blitz: slotDiff(buildA.blitz as AnyRecord, buildB.blitz as AnyRecord),
    aura: slotDiff(buildA.aura as AnyRecord, buildB.aura as AnyRecord),
    keystone: slotDiff(
      buildA.keystone as AnyRecord,
      buildB.keystone as AnyRecord
    ),
  };

  return {
    a: {
      file: pathA,
      title: (buildA.title as string | undefined) ?? "",
      class: (buildA.class as AnyRecord | undefined)?.raw_label as string ?? "",
    },
    b: {
      file: pathB,
      title: (buildB.title as string | undefined) ?? "",
      class: (buildB.class as AnyRecord | undefined)?.raw_label as string ?? "",
    },
    score_deltas: computeScoreDeltas(scorecardA, scorecardB),
    structural,
    analytical: options?.detailed ? _analyticalStub() : null,
  };
}

/** Stub — Task 5 fills this in. */
function _analyticalStub(): AnalyticalDiff {
  return {
    synergy_edges: { only_a: [], only_b: [], shared: [] },
    breakpoints: [],
  };
}
