// Public API surface for the hadrons-blessing library.
// This is what the website (and other downstream consumers) will import.

// Core types
export type { CanonicalBuildSchemaJson as CanonicalBuild } from "../generated/schema-types.js";
export type { BuildSelectionSchemaJson as BuildSelection } from "../generated/schema-types.js";

// Resolution
export { resolveQuery } from "./resolve.js";
export { buildIndex } from "./ground-truth-index.js";
export type { GroundTruthIndex } from "./ground-truth-index.js";
export type { ResolveResult } from "./resolve.js";

// Calculators
export { computeHit, computeBreakpoints, assembleBuildBuffStack, loadCalculatorData } from "./damage-calculator.js";
export type { HitResult, BuffStack, CalculatorData, ComputeHitParams } from "./damage-calculator.js";
export { computeStaggerMatrix, loadStaggerSettings } from "./stagger-calculator.js";
export { computeCleaveMatrix, simulateCleave, HORDE_COMPOSITIONS } from "./cleave-calculator.js";
export { computeSurvivability, loadClassBaseStats } from "./toughness-calculator.js";

// Scoring & analysis
export { generateScorecard } from "./score-build.js";
export { analyzeBuild, loadIndex as loadSynergyIndex } from "./synergy-model.js";
export type { AnalyzeBuildResult, SynergyIndex } from "./synergy-model.js";

// Browse & compare
export { listBuilds } from "./build-list.js";
export type { BuildSummary, ListOptions, BuildScores, WeaponSummary } from "./build-list.js";
export { diffBuilds } from "./build-diff.js";
export type { BuildDiff, DiffOptions, ScoreDelta, StructuralDiff, AnalyticalDiff, BreakpointDelta } from "./build-diff.js";
