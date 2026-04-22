// src/lib/scorecard-deps.ts
// Shared scorecard dependency loading for build-list and build-diff.
// Static imports + try-catch at call site (not dynamic require — this is ESM).

import { loadIndex, analyzeBuild } from "./synergy-model.js";
import { loadCalculatorData, computeBreakpoints } from "./damage-calculator.js";
import { computeSurvivability } from "./toughness-calculator.js";
import { generateScorecard } from "./score-build.js";

type AnyRecord = Record<string, unknown>;

export interface ScorecardDeps {
  analyzeBuild: ((build: AnyRecord, index: AnyRecord) => AnyRecord) | null;
  computeBreakpoints: ((build: AnyRecord, index: AnyRecord, calcData: AnyRecord) => AnyRecord) | null;
  computeSurvivability: ((build: AnyRecord, index: AnyRecord, options?: AnyRecord) => AnyRecord) | null;
  index: AnyRecord | null;
  calcData: AnyRecord | null;
}

export interface ScorecardAnalysis {
  synergyOutput: AnyRecord | null;
  calcOutput: { matrix: AnyRecord } | null;
  survivabilityOutput: { profile: AnyRecord; baseline: AnyRecord } | null;
  scorecard: AnyRecord;
}

let _cached: ScorecardDeps | null = null;

export function loadScorecardDeps(): ScorecardDeps {
  if (_cached) return _cached;

  const deps: ScorecardDeps = {
    analyzeBuild: null,
    computeBreakpoints: null,
    computeSurvivability: null,
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
    deps.computeSurvivability = computeSurvivability as unknown as ScorecardDeps["computeSurvivability"];
  } catch {
    // Calculator data unavailable
  }

  _cached = deps;
  return deps;
}

interface AnalyzeScorecardOptions {
  index?: AnyRecord | null;
  synergyOutput?: AnyRecord | null;
}

export function analyzeScorecard(
  build: AnyRecord,
  deps: ScorecardDeps,
  options: AnalyzeScorecardOptions = {},
): ScorecardAnalysis {
  const index = options.index ?? deps.index;

  let synergyOutput = options.synergyOutput ?? null;
  if (synergyOutput == null && deps.analyzeBuild && index) {
    try { synergyOutput = deps.analyzeBuild(build, index); } catch { /* skip */ }
  }

  let calcOutput: { matrix: AnyRecord } | null = null;
  if (deps.computeBreakpoints && index && deps.calcData) {
    try { calcOutput = { matrix: deps.computeBreakpoints(build, index, deps.calcData) }; } catch { /* skip */ }
  }

  let survivabilityOutput: { profile: AnyRecord; baseline: AnyRecord } | null = null;
  if (deps.computeSurvivability && index) {
    const classSelection = build.class;
    if (classSelection != null && typeof classSelection === "object") {
      try {
        const profile = deps.computeSurvivability(build, index, { difficulty: "damnation" });
        const baseline = deps.computeSurvivability(
          {
            class: classSelection,
            ability: null,
            blitz: null,
            aura: null,
            keystone: null,
            talents: [],
            weapons: [],
            curios: [],
          },
          index,
          { difficulty: "damnation" },
        );
        survivabilityOutput = { profile, baseline };
      } catch {
        // skip survivability for builds that cannot be profiled
      }
    }
  }

  return {
    synergyOutput,
    calcOutput,
    survivabilityOutput,
    scorecard: generateScorecard(build, synergyOutput, calcOutput, survivabilityOutput) as unknown as AnyRecord,
  };
}

export function buildScorecard(build: AnyRecord, deps: ScorecardDeps): AnyRecord {
  return analyzeScorecard(build, deps).scorecard;
}
