import {
  analyzeBuild,
  computeBreakpoints,
  computeSurvivability,
  generateScorecard,
  listBuilds,
  loadCalculatorData,
  loadSynergyIndex,
} from "../../dist/lib/index.js";
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSlugFromFile } from "../src/lib/builds.ts";
import type {
  BuildDetailData,
  BuildStructure,
  BuildStructureEntry,
  BuildStructureSlot,
  BuildStructureWeapon,
  BuildSummary,
} from "../src/lib/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "..", "static", "data");
const BUILD_DETAILS_DIR = join(OUTPUT_DIR, "builds");
const TREES_OUTPUT_DIR = join(OUTPUT_DIR, "trees");
const BUILDS_DIR = join(__dirname, "..", "..", "data", "builds");
const TREES_INPUT_DIR = join(__dirname, "..", "..", "data", "ground-truth", "generated", "trees");
const GL_LABELS_PATH = join(__dirname, "..", "..", "data", "ground-truth", "generated", "gl-class-tree-labels.json");
type AnyRecord = Record<string, unknown>;

export function buildDetailRecord(
  summary: BuildSummary,
  scorecard: AnyRecord,
  synergy: AnyRecord,
  breakpoints: AnyRecord,
  structure: BuildStructure,
): BuildDetailData {
  return {
    slug: buildSlugFromFile(summary.file),
    summary,
    scorecard: scorecard as BuildDetailData["scorecard"],
    synergy: synergy as BuildDetailData["synergy"],
    breakpoints: breakpoints as BuildDetailData["breakpoints"],
    structure,
  };
}

function asRecord(value: unknown): AnyRecord | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as AnyRecord
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function namedSelectionEntry(value: unknown): BuildStructureEntry | null {
  const record = asRecord(value);
  if (!record) return null;

  const name = typeof record.raw_label === "string" ? record.raw_label : null;
  if (!name) return null;

  return {
    id: typeof record.canonical_entity_id === "string" ? record.canonical_entity_id : null,
    name,
  };
}

function requiredNamedSelectionEntry(value: unknown): { id: string; name: string } | null {
  const entry = namedSelectionEntry(value);
  if (!entry || entry.id == null) return null;
  return { id: entry.id, name: entry.name };
}

function slotEntry(value: unknown): BuildStructureSlot {
  const entry = namedSelectionEntry(value);
  return entry ?? { id: null, name: null };
}

function weaponEntry(value: unknown): BuildStructureWeapon | null {
  const record = asRecord(value);
  if (!record) return null;

  const name = namedSelectionEntry(record.name);
  if (!name || name.id == null) return null;

  return {
    id: name.id,
    name: name.name,
    slot: typeof record.slot === "string" ? record.slot : null,
    family: typeof record.family === "string" ? record.family : null,
    blessings: asArray(record.blessings)
      .map((item) => namedSelectionEntry(item))
      .filter((entry): entry is BuildStructureEntry => entry != null),
  };
}

function curioPerkEntries(value: unknown): BuildStructureEntry[] {
  const record = asRecord(value);
  if (!record) return [];

  return asArray(record.perks)
    .map((item) => namedSelectionEntry(item))
    .filter((entry): entry is BuildStructureEntry => entry != null);
}

function extractStructure(build: AnyRecord): BuildStructure {
  return {
    slots: {
      ability: slotEntry(build.ability),
      blitz: slotEntry(build.blitz),
      aura: slotEntry(build.aura),
      keystone: slotEntry(build.keystone),
    },
    talents: asArray(build.talents)
      .map((item) => requiredNamedSelectionEntry(item))
      .filter((entry): entry is { id: string; name: string } => entry != null),
    weapons: asArray(build.weapons)
      .map((item) => weaponEntry(item))
      .filter((entry): entry is BuildStructureWeapon => entry != null),
    curio_perks: asArray(build.curios).flatMap((curio) => curioPerkEntries(curio)),
  };
}

/**
 * Emit a compact talent-label map keyed by entity_id for client-side lookups
 * (used by the TalentTree tooltip). Input source is the full GL tree label
 * snapshot; output strips scraping metadata.
 */
function copyTalentLabels(): number {
  if (!existsSync(GL_LABELS_PATH)) return 0;
  const labels = JSON.parse(readFileSync(GL_LABELS_PATH, "utf8")) as Array<{
    entity_id: string;
    display_name: string | null;
    normalized_text?: string | null;
  }>;
  const byId: Record<string, { display_name: string }> = {};
  for (const label of labels) {
    if (!label.entity_id || !label.display_name) continue;
    byId[label.entity_id] = { display_name: label.display_name };
  }
  writeFileSync(
    join(OUTPUT_DIR, "talent-labels.json"),
    JSON.stringify(byId, null, 2),
  );
  return Object.keys(byId).length;
}

function copyTreeDags(): number {
  if (!existsSync(TREES_INPUT_DIR)) {
    console.warn(
      `⚠ No tree DAGs found at ${TREES_INPUT_DIR} — run \`npm run trees:build\` in the library root first.`,
    );
    return 0;
  }
  mkdirSync(TREES_OUTPUT_DIR, { recursive: true });
  const files = readdirSync(TREES_INPUT_DIR).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    copyFileSync(join(TREES_INPUT_DIR, file), join(TREES_OUTPUT_DIR, file));
  }
  return files.length;
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
    const survivability = build.class && typeof build.class === "object"
      ? {
          profile: computeSurvivability(build, synergyIndex, { difficulty: "damnation" }) as AnyRecord,
          baseline: computeSurvivability(
            {
              class: build.class,
              ability: null,
              blitz: null,
              aura: null,
              keystone: null,
              talents: [],
              weapons: [],
              curios: [],
            },
            synergyIndex,
            { difficulty: "damnation" },
          ) as AnyRecord,
        }
      : null;
    const scorecard = generateScorecard(build, synergy, { matrix: breakpoints }, survivability) as AnyRecord;
    const structure = extractStructure(build);
    const detail = buildDetailRecord(summaryForBuild, scorecard, synergy, breakpoints, structure);
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
  const treeCount = copyTreeDags();
  const labelCount = copyTalentLabels();
  console.log(`Generated ${summaries.length} build summaries → static/data/build-summaries.json`);
  console.log(`Generated ${details.length} build details → static/data/builds/*.json`);
  if (treeCount > 0) {
    console.log(`Copied ${treeCount} talent tree DAGs → static/data/trees/*.json`);
  }
  if (labelCount > 0) {
    console.log(`Emitted ${labelCount} talent labels → static/data/talent-labels.json`);
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main();
}
