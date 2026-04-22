import { loadJsonFile } from "./load.js";
import { validateCanonicalBuild } from "./build-shape.js";
import { canonicalizeScrapedBuild } from "./build-canonicalize.js";
import type { CanonicalBuild as CanonicalizedBuild } from "./build-canonicalize.js";
import { resolveQueryFromShippedData } from "./runtime-resolve.js";
import { loadScorecardDeps, analyzeScorecard } from "./scorecard-deps.js";
import { analyzeGaps } from "./build-recommendations.js";
import type { ResolveResult } from "./resolve.js";
import type { AnalyzeBuildResult, SynergyIndex } from "./synergy-model.js";

type AnyRecord = Record<string, unknown>;

interface AnalyzeInput {
  kind: "gameslantern_url" | "canonical_build" | "raw_build";
  target: string;
}

interface SelectionLike {
  raw_label?: string;
  canonical_entity_id?: string | null;
  resolution_status?: string;
}

type CanonicalBuild = CanonicalizedBuild;

interface ResolutionSummary {
  total: number;
  resolved: number;
  unresolved: number;
  non_canonical: number;
}

interface AnalyzeResult {
  input: AnalyzeInput;
  build: CanonicalBuild;
  resolution_summary: ResolutionSummary;
  scorecard: AnyRecord;
  gap_analysis: {
    gaps: Array<{ type: string; reason: string; suggested_families: string[] }>;
    underinvested_families: string[];
  };
}

interface AnalyzeDeps {
  loadJsonFile: (path: string) => unknown;
  extractBuild: (url: string) => Promise<AnyRecord>;
  canonicalizeScrapedBuild: (
    rawBuild: AnyRecord,
    deps?: Record<string, unknown>,
  ) => Promise<CanonicalBuild>;
  resolveQuery: (query: string, queryContext: unknown) => Promise<ResolveResult>;
}

const GAMES_LANTERN_BUILD_URL =
  /^https?:\/\/darktide\.gameslantern\.com\/builds(?:\/|$)/i;

function isGamesLanternBuildUrl(target: string): boolean {
  return GAMES_LANTERN_BUILD_URL.test(target);
}

function looksLikeCanonicalBuild(value: unknown): value is CanonicalBuild {
  return value != null
    && typeof value === "object"
    && Number.isInteger((value as { schema_version?: unknown }).schema_version);
}

function isSelection(value: unknown): value is SelectionLike {
  return value != null
    && typeof value === "object"
    && typeof (value as SelectionLike).raw_label === "string"
    && Object.hasOwn(value as object, "canonical_entity_id")
    && typeof (value as SelectionLike).resolution_status === "string";
}

function summarizeSelections(build: CanonicalBuild): ResolutionSummary {
  const selections: SelectionLike[] = [];

  const pushSelection = (value: unknown) => {
    if (isSelection(value)) {
      selections.push(value);
    }
  };

  pushSelection(build.class);
  pushSelection(build.ability);
  pushSelection(build.blitz);
  pushSelection(build.aura);
  pushSelection(build.keystone);

  for (const talent of build.talents ?? []) {
    pushSelection(talent);
  }

  for (const weapon of build.weapons ?? []) {
    pushSelection(weapon.name);
    for (const perk of weapon.perks ?? []) {
      pushSelection(perk);
    }
    for (const blessing of weapon.blessings ?? []) {
      pushSelection(blessing);
    }
  }

  for (const curio of build.curios ?? []) {
    pushSelection(curio.name);
    for (const perk of curio.perks ?? []) {
      pushSelection(perk);
    }
  }

  const summary: ResolutionSummary = {
    total: selections.length,
    resolved: 0,
    unresolved: 0,
    non_canonical: 0,
  };

  for (const selection of selections) {
    switch (selection.resolution_status) {
      case "resolved":
        summary.resolved += 1;
        break;
      case "non_canonical":
        summary.non_canonical += 1;
        break;
      default:
        summary.unresolved += 1;
        break;
    }
  }

  return summary;
}

export async function loadAnalyzeTarget(
  target: string,
  deps: Partial<AnalyzeDeps> = {},
): Promise<{ input: AnalyzeInput; build: CanonicalBuild }> {
  const loadJson = deps.loadJsonFile ?? loadJsonFile;
  const canonicalizeFn = deps.canonicalizeScrapedBuild ?? canonicalizeScrapedBuild;
  const resolveQuery = deps.resolveQuery ?? resolveQueryFromShippedData;

  if (isGamesLanternBuildUrl(target)) {
    const extractBuildFn = deps.extractBuild
      ?? (await import("../cli/extract-build.js")).extractBuild;
    const rawBuild = await extractBuildFn(target);
    const build = await canonicalizeFn(rawBuild, { resolveQuery });
    return {
      input: { kind: "gameslantern_url", target },
      build,
    };
  }

  const payload = loadJson(target);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Expected JSON object input: ${target}`);
  }

  if (looksLikeCanonicalBuild(payload)) {
    const validation = validateCanonicalBuild(payload);
    if (!validation.ok) {
      throw new Error(`Invalid canonical build: ${validation.errors[0]?.message ?? "unknown validation error"}`);
    }

    return {
      input: { kind: "canonical_build", target },
      build: payload,
    };
  }

  return {
    input: { kind: "raw_build", target },
    build: await canonicalizeFn(payload as AnyRecord, { resolveQuery }),
  };
}

export async function analyzeTarget(
  target: string,
  deps: Partial<AnalyzeDeps> = {},
): Promise<AnalyzeResult> {
  const loaded = await loadAnalyzeTarget(target, deps);
  const scorecardDeps = loadScorecardDeps();
  const analysis = analyzeScorecard(loaded.build as unknown as AnyRecord, scorecardDeps);
  const gapAnalysis = scorecardDeps.index
    ? analyzeGaps(loaded.build as unknown as AnyRecord, scorecardDeps.index as unknown as SynergyIndex, {
      ...(analysis.synergyOutput == null
        ? {}
        : { synergy: analysis.synergyOutput as unknown as AnalyzeBuildResult }),
      scorecard: analysis.scorecard as AnyRecord,
    })
    : {
      gaps: [],
      underinvested_families: [],
      scorecard: analysis.scorecard as AnyRecord,
    };

  return {
    input: loaded.input,
    build: loaded.build,
    resolution_summary: summarizeSelections(loaded.build),
    scorecard: analysis.scorecard,
    gap_analysis: {
      gaps: gapAnalysis.gaps,
      underinvested_families: gapAnalysis.underinvested_families,
    },
  };
}

export function formatAnalyzeText(result: AnalyzeResult): string {
  const lines: string[] = [];
  const title = typeof result.build.title === "string" ? result.build.title : "(untitled)";
  const classLabel =
    typeof result.build.class?.raw_label === "string" ? result.build.class.raw_label : "unknown";
  const qualitative = result.scorecard.qualitative as { survivability?: unknown } | undefined;
  const compositeMax = qualitative?.survivability != null ? 40 : 35;
  const weapons = (result.build.weapons ?? [])
    .map((weapon) => weapon.name?.raw_label)
    .filter((label): label is string => typeof label === "string");

  lines.push(`=== ${title} (${classLabel}) ===`);
  lines.push(`Input: ${result.input.kind} · ${result.input.target}`);
  lines.push(
    `Resolution: ${result.resolution_summary.resolved}/${result.resolution_summary.total} resolved`
    + ` · ${result.resolution_summary.unresolved} unresolved`
    + ` · ${result.resolution_summary.non_canonical} non-canonical`,
  );
  lines.push(
    `Grade: ${String(result.scorecard.letter_grade)}`
    + ` (${String(result.scorecard.composite_score)}/${compositeMax})`,
  );

  const botFlags = Array.isArray(result.scorecard.bot_flags)
    ? result.scorecard.bot_flags.filter((flag): flag is string => typeof flag === "string")
    : [];
  if (botFlags.length > 0) {
    lines.push(`Bot Flags: ${botFlags.join(", ")}`);
  }

  if (weapons.length > 0) {
    lines.push(`Weapons: ${weapons.join(" | ")}`);
  }

  lines.push("");

  if (result.gap_analysis.gaps.length > 0) {
    lines.push("Coverage Gaps:");
    for (const gap of result.gap_analysis.gaps) {
      lines.push(`  - [${gap.type}] ${gap.reason}`);
    }
    lines.push("");
  }

  if (result.gap_analysis.underinvested_families.length > 0) {
    lines.push(`Underinvested Families: ${result.gap_analysis.underinvested_families.join(", ")}`);
  } else {
    lines.push("Underinvested Families: none");
  }

  return lines.join("\n");
}

export function formatAnalyzeJson(result: AnalyzeResult): string {
  return JSON.stringify(result, null, 2);
}
