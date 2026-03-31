// src/lib/scorecard-deps.ts
// Shared scorecard dependency loading for build-list and build-diff.
// Static imports + try-catch at call site (not dynamic require — this is ESM).

import { loadIndex, analyzeBuild } from "./synergy-model.js";
import { loadCalculatorData, computeBreakpoints } from "./damage-calculator.js";
import { generateScorecard } from "./score-build.js";

type AnyRecord = Record<string, unknown>;

export interface ScorecardDeps {
  analyzeBuild: ((build: AnyRecord, index: AnyRecord) => AnyRecord) | null;
  computeBreakpoints: ((build: AnyRecord, index: AnyRecord, calcData: AnyRecord) => AnyRecord) | null;
  index: AnyRecord | null;
  calcData: AnyRecord | null;
}

let _cached: ScorecardDeps | null = null;

export function loadScorecardDeps(): ScorecardDeps {
  if (_cached) return _cached;

  const deps: ScorecardDeps = {
    analyzeBuild: null,
    computeBreakpoints: null,
    index: null,
    calcData: null,
  };

  try {
    deps.index = loadIndex() as unknown as AnyRecord;
    deps.analyzeBuild = analyzeBuild as unknown as ScorecardDeps["analyzeBuild"];
  } catch {
    // Synergy data unavailable (e.g. missing generated index)
  }

  try {
    if (!deps.index) {
      deps.index = loadIndex() as unknown as AnyRecord;
    }
    deps.calcData = loadCalculatorData() as unknown as AnyRecord;
    deps.computeBreakpoints = computeBreakpoints as unknown as ScorecardDeps["computeBreakpoints"];
  } catch {
    // Calculator data unavailable
  }

  _cached = deps;
  return deps;
}

export function buildScorecard(build: AnyRecord, deps: ScorecardDeps): AnyRecord {
  let synergyOutput: AnyRecord | null = null;
  if (deps.analyzeBuild && deps.index) {
    try { synergyOutput = deps.analyzeBuild(build, deps.index); } catch { /* skip */ }
  }

  let calcOutput: { matrix: AnyRecord } | null = null;
  if (deps.computeBreakpoints && deps.index && deps.calcData) {
    try { calcOutput = { matrix: deps.computeBreakpoints(build, deps.index, deps.calcData) }; } catch { /* skip */ }
  }

  return generateScorecard(build, synergyOutput, calcOutput) as unknown as AnyRecord;
}
