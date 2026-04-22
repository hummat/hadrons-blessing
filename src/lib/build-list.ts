// src/lib/build-list.ts
// Library module for listing and filtering canonical build summaries.

import { readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { loadScorecardDeps, buildScorecard } from "./scorecard-deps.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WeaponSummary {
  name: string;
  slot: string | null;
  family: string | null;
}

export interface BuildScores {
  composite: number;
  grade: string;
  perk_optimality: number;
  curio_efficiency: number;
  talent_coherence: number | null;
  blessing_synergy: number | null;
  role_coverage: number | null;
  breakpoint_relevance: number | null;
  difficulty_scaling: number | null;
  survivability: number | null;
}

export interface BuildSummary {
  file: string;
  title: string;
  class: string;
  ability: string | null;
  keystone: string | null;
  weapons: WeaponSummary[];
  scores: BuildScores;
}

export interface ListOptions {
  class?: string;
  weapon?: string;
  minGrade?: string;
  sort?: string;
  reverse?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRADE_RANK: Record<string, number> = { S: 5, A: 4, B: 3, C: 2, D: 1 };

const VALID_SORT_KEYS = new Set([
  "composite",
  "perk_optimality",
  "curio_efficiency",
  "talent_coherence",
  "blessing_synergy",
  "role_coverage",
  "breakpoint_relevance",
  "difficulty_scaling",
  "survivability",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AnyRecord = Record<string, unknown>;

function selectionLabel(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (typeof value === "object" && typeof (value as AnyRecord).raw_label === "string") {
    const label = (value as AnyRecord).raw_label as string;
    return label.length > 0 ? label : null;
  }
  return null;
}

function dimensionScore(qualitative: AnyRecord, key: string): number | null {
  const dim = qualitative[key];
  if (dim == null) return null;
  if (typeof dim === "object" && typeof (dim as AnyRecord).score === "number") {
    return (dim as AnyRecord).score as number;
  }
  return null;
}

function buildSummaryFromScorecard(file: string, build: AnyRecord, scorecard: AnyRecord): BuildSummary {
  const qualitative = (scorecard.qualitative as AnyRecord) ?? {};

  const scores: BuildScores = {
    composite: scorecard.composite_score as number,
    grade: scorecard.letter_grade as string,
    perk_optimality: scorecard.perk_optimality as number,
    curio_efficiency: scorecard.curio_efficiency as number,
    talent_coherence: dimensionScore(qualitative, "talent_coherence"),
    blessing_synergy: dimensionScore(qualitative, "blessing_synergy"),
    role_coverage: dimensionScore(qualitative, "role_coverage"),
    breakpoint_relevance: dimensionScore(qualitative, "breakpoint_relevance"),
    difficulty_scaling: dimensionScore(qualitative, "difficulty_scaling"),
    survivability: dimensionScore(qualitative, "survivability"),
  };

  const weapons: WeaponSummary[] = ((scorecard.weapons as AnyRecord[]) ?? []).map((w) => ({
    name: (w.name as string) ?? "",
    slot: (w.slot as string | null) ?? null,
    family: (w.weapon_family as string | null) ?? null,
  }));

  return {
    file,
    title: scorecard.title as string,
    class: (scorecard.class as string) ?? "",
    ability: selectionLabel(build.ability),
    keystone: selectionLabel(build.keystone),
    weapons,
    scores,
  };
}

function scoreSortValue(summary: BuildSummary, key: string): number | null {
  switch (key) {
    case "composite": return summary.scores.composite;
    case "perk_optimality": return summary.scores.perk_optimality;
    case "curio_efficiency": return summary.scores.curio_efficiency;
    case "talent_coherence": return summary.scores.talent_coherence;
    case "blessing_synergy": return summary.scores.blessing_synergy;
    case "role_coverage": return summary.scores.role_coverage;
    case "breakpoint_relevance": return summary.scores.breakpoint_relevance;
    case "difficulty_scaling": return summary.scores.difficulty_scaling;
    case "survivability": return summary.scores.survivability;
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function listBuilds(dir: string, options: ListOptions = {}): BuildSummary[] {
  const sortKey = options.sort ?? "composite";

  if (!VALID_SORT_KEYS.has(sortKey)) {
    throw new Error(`Invalid sort key: "${sortKey}". Valid keys: ${[...VALID_SORT_KEYS].join(", ")}`);
  }

  const deps = loadScorecardDeps();

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort(); // stable alphabetical order before sort override

  const summaries: BuildSummary[] = [];

  for (const filename of files) {
    const fullPath = join(dir, filename);
    const build = JSON.parse(readFileSync(fullPath, "utf-8")) as AnyRecord;
    const scorecard = buildScorecard(build, deps);
    const summary = buildSummaryFromScorecard(basename(filename), build, scorecard);
    summaries.push(summary);
  }

  // Filtering
  let results = summaries;

  if (options.class != null) {
    const lc = options.class.toLowerCase();
    results = results.filter((s) => s.class.toLowerCase() === lc);
  }

  if (options.weapon != null) {
    const lc = options.weapon.toLowerCase();
    results = results.filter((s) =>
      s.weapons.some(
        (w) =>
          w.name.toLowerCase().includes(lc) ||
          (w.family != null && w.family.toLowerCase().includes(lc)),
      ),
    );
  }

  if (options.minGrade != null) {
    const minRank = GRADE_RANK[options.minGrade.toUpperCase()] ?? 0;
    results = results.filter((s) => (GRADE_RANK[s.scores.grade] ?? 0) >= minRank);
  }

  // Sorting: descending by default; nulls sort last
  const ascending = options.reverse === true;
  results.sort((a, b) => {
    const av = scoreSortValue(a, sortKey);
    const bv = scoreSortValue(b, sortKey);

    if (av == null && bv == null) return 0;
    if (av == null) return 1;  // nulls last regardless of direction
    if (bv == null) return -1;

    if (ascending) return av - bv;
    return bv - av;
  });

  return results;
}
