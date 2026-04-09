import {
  analyzeBuild,
  computeBreakpoints,
  generateScorecard,
  listBuilds,
  loadCalculatorData,
  loadSynergyIndex,
} from "../../dist/lib/index.js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSlugFromFile } from "../src/lib/builds.ts";
import type { BuildDetailData, BuildSummary } from "../src/lib/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "..", "static", "data");
const BUILD_DETAILS_DIR = join(OUTPUT_DIR, "builds");
const BUILDS_DIR = join(__dirname, "..", "..", "data", "builds");
type AnyRecord = Record<string, unknown>;

export function buildDetailRecord(
  summary: BuildSummary,
  scorecard: AnyRecord,
  synergy: AnyRecord,
  breakpoints: AnyRecord,
): BuildDetailData {
  return {
    slug: buildSlugFromFile(summary.file),
    summary,
    scorecard: scorecard as BuildDetailData["scorecard"],
    synergy: synergy as BuildDetailData["synergy"],
    breakpoints: breakpoints as BuildDetailData["breakpoints"],
  };
}

export function generateData(): { summaries: BuildSummary[]; details: BuildDetailData[] } {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(BUILD_DETAILS_DIR, { recursive: true });

  const summaries = listBuilds(BUILDS_DIR);
  const summariesByFile = new Map(summaries.map((summary) => [summary.file, summary]));
  const synergyIndex = loadSynergyIndex();
  const calcData = loadCalculatorData();

  const details: BuildDetailData[] = [];

  writeFileSync(
    join(OUTPUT_DIR, "build-summaries.json"),
    JSON.stringify(summaries, null, 2),
  );

  for (const summary of summaries) {
    const buildPath = join(BUILDS_DIR, summary.file);
    const build = JSON.parse(readFileSync(buildPath, "utf-8")) as AnyRecord;
    const summaryForBuild = summariesByFile.get(summary.file);

    if (!summaryForBuild) {
      throw new Error(`Missing summary for build file: ${summary.file}`);
    }

    const synergy = analyzeBuild(build, synergyIndex) as AnyRecord;
    const breakpoints = computeBreakpoints(build, synergyIndex, calcData) as AnyRecord;
    const scorecard = generateScorecard(build, synergy, { matrix: breakpoints }) as AnyRecord;
    const detail = buildDetailRecord(summaryForBuild, scorecard, synergy, breakpoints);
    details.push(detail);

    writeFileSync(
      join(BUILD_DETAILS_DIR, `${detail.slug}.json`),
      JSON.stringify(detail, null, 2),
    );
  }

  return { summaries, details };
}

function main(): void {
  const { summaries, details } = generateData();
  console.log(`Generated ${summaries.length} build summaries → static/data/build-summaries.json`);
  console.log(`Generated ${details.length} build details → static/data/builds/*.json`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main();
}
