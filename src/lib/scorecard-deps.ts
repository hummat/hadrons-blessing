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
  errors: Record<"index" | "synergy" | "calc" | "survivability", string | null>;
}

export interface ScorecardAnalysis {
  synergyOutput: AnyRecord | null;
  calcOutput: { matrix: AnyRecord } | null;
  survivabilityOutput: { profile: AnyRecord; baseline: AnyRecord } | null;
  scorecard: AnyRecord;
  errors: Record<"synergy" | "calc" | "survivability", string | null>;
}

let _cached: ScorecardDeps | null = null;

function describeMissingDataError(err: unknown): { isMissingData: boolean; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  const isMissingData =
    (err as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
    || /\bENOENT\b/i.test(message)
    || /\bno such file or directory\b/i.test(message)
    || /\brun index:build\b/i.test(message);
  return { isMissingData, message };
}

export function resetScorecardDepsCache(): void {
  _cached = null;
}

export function loadScorecardDeps(): ScorecardDeps {
  if (_cached) return _cached;

  const deps: ScorecardDeps = {
    analyzeBuild: null,
    computeBreakpoints: null,
    computeSurvivability: null,
    index: null,
    calcData: null,
    errors: { index: null, synergy: null, calc: null, survivability: null },
  };

  try {
    deps.index = loadIndex() as unknown as AnyRecord;
  } catch (err) {
    const { isMissingData, message } = describeMissingDataError(err);
    deps.errors.index = message;
    if (!isMissingData) {
      throw err;
    }
    console.warn(
      `[scorecard-deps] synergy/calc unavailable — ground-truth index missing (${message}). `
      + `Run 'npm run index:build' to enable qualitative scoring.`,
    );
  }

  if (deps.index) {
    deps.analyzeBuild = analyzeBuild as unknown as ScorecardDeps["analyzeBuild"];
  }

  try {
    deps.calcData = loadCalculatorData() as unknown as AnyRecord;
    deps.computeBreakpoints = computeBreakpoints as unknown as ScorecardDeps["computeBreakpoints"];
    deps.computeSurvivability = computeSurvivability as unknown as ScorecardDeps["computeSurvivability"];
  } catch (err) {
    const { isMissingData, message } = describeMissingDataError(err);
    deps.errors.calc = message;
    if (!isMissingData) {
      throw err;
    }
    console.warn(
      `[scorecard-deps] calculator unavailable — calc data missing (${message}). `
      + `Run 'make check' to regenerate.`,
    );
  }

  _cached = deps;
  return deps;
}

interface AnalyzeScorecardOptions {
  index?: AnyRecord | null;
  synergyOutput?: AnyRecord | null;
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function analyzeScorecard(
  build: AnyRecord,
  deps: ScorecardDeps,
  options: AnalyzeScorecardOptions = {},
): ScorecardAnalysis {
  const index = options.index ?? deps.index;
  const buildTitle = typeof build.title === "string" ? build.title : "<unknown build>";
  const errors: ScorecardAnalysis["errors"] = { synergy: null, calc: null, survivability: null };

  let synergyOutput = options.synergyOutput ?? null;
  if (synergyOutput == null && deps.analyzeBuild && index) {
    try {
      synergyOutput = deps.analyzeBuild(build, index);
    } catch (err) {
      errors.synergy = toErrorMessage(err);
      console.warn(`[scorecard] synergy analysis failed for '${buildTitle}': ${errors.synergy}`);
    }
  }

  let calcOutput: { matrix: AnyRecord } | null = null;
  if (deps.computeBreakpoints && index && deps.calcData) {
    try {
      calcOutput = { matrix: deps.computeBreakpoints(build, index, deps.calcData) };
    } catch (err) {
      errors.calc = toErrorMessage(err);
      console.warn(`[scorecard] breakpoint calc failed for '${buildTitle}': ${errors.calc}`);
    }
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
      } catch (err) {
        errors.survivability = toErrorMessage(err);
        console.warn(`[scorecard] survivability failed for '${buildTitle}': ${errors.survivability}`);
      }
    }
  }

  return {
    synergyOutput,
    calcOutput,
    survivabilityOutput,
    scorecard: generateScorecard(build, synergyOutput, calcOutput, survivabilityOutput) as unknown as AnyRecord,
    errors,
  };
}

export function buildScorecard(build: AnyRecord, deps: ScorecardDeps): AnyRecord {
  return analyzeScorecard(build, deps).scorecard;
}
