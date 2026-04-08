import type { BuildSummary, BuildScores } from "./types.js";

export interface FilterOptions {
  class?: string;
  weapon?: string;
  minGrade?: string;
  sort?: string;
  reverse?: boolean;
}

const GRADE_ORDER = ["S", "A", "B", "C", "D"];

type ScoreKey = keyof BuildScores;

export function filterAndSort(
  builds: BuildSummary[],
  options: FilterOptions,
): BuildSummary[] {
  let result = builds;

  if (options.class) {
    const lc = options.class.toLowerCase();
    result = result.filter((b) => b.class.toLowerCase() === lc);
  }

  if (options.weapon) {
    const lc = options.weapon.toLowerCase();
    result = result.filter((b) =>
      b.weapons.some(
        (w) =>
          w.name.toLowerCase().includes(lc) ||
          (w.family != null && w.family.toLowerCase().includes(lc)),
      ),
    );
  }

  if (options.minGrade) {
    const minIdx = GRADE_ORDER.indexOf(options.minGrade);
    if (minIdx >= 0) {
      result = result.filter((b) => {
        const idx = GRADE_ORDER.indexOf(b.scores.grade);
        return idx >= 0 && idx <= minIdx;
      });
    }
  }

  const sortKey = (options.sort ?? "composite") as ScoreKey;
  result = [...result].sort((a, b) => {
    const av = a.scores[sortKey];
    const bv = b.scores[sortKey];
    // nulls last
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (bv as number) - (av as number);
  });

  if (options.reverse) {
    result.reverse();
  }

  return result;
}
