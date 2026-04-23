import type { BuildScores } from "./types.ts";

export interface ScoreAxisMeta {
  hasSurvivabilityAxis: boolean;
  compositeMax: 35 | 40;
  dimensionCount: 7 | 8;
}

export function scoreAxisMeta(scores: Pick<BuildScores, "survivability">): ScoreAxisMeta {
  const hasSurvivabilityAxis = scores.survivability != null;
  return {
    hasSurvivabilityAxis,
    compositeMax: hasSurvivabilityAxis ? 40 : 35,
    dimensionCount: hasSurvivabilityAxis ? 8 : 7,
  };
}
