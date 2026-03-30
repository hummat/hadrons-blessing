// @ts-nocheck
// Breakpoint calculator CLI — run on a build or directory of builds.
// Usage: npm run calc -- <build.json|dir> [--json|--text] [--compare <file>] [--freeze]

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runCliMain } from "../lib/cli.js";
import { loadIndex } from "../lib/synergy-model.js";
import { loadCalculatorData, computeBreakpoints, summarizeBreakpoints } from "../lib/damage-calculator.js";

const __filename = fileURLToPath(import.meta.url);

// ── Display mappings ──────────────────────────────────────────────────

/** Checklist enemies — the key breeds players care about for breakpoint analysis. */
const CHECKLIST_BREEDS = [
  "renegade_berzerker",
  "chaos_ogryn_executor",
  "chaos_poxwalker",
  "renegade_executor",
  "chaos_ogryn_bulwark",
  "renegade_netgunner",
  "chaos_hound",
  "chaos_poxwalker_bomber",
  "renegade_sniper",
];

/** Human-readable breed names with community armor classification. */
const BREED_DISPLAY = {
  renegade_berzerker: { name: "Rager", armor: "Flak" },
  chaos_ogryn_executor: { name: "Crusher", armor: "Carapace" },
  chaos_poxwalker: { name: "Poxwalker", armor: null },
  renegade_executor: { name: "Mauler", armor: "Flak" },
  chaos_ogryn_bulwark: { name: "Bulwark", armor: "Carapace" },
  renegade_netgunner: { name: "Trapper", armor: "Flak" },
  chaos_hound: { name: "Hound", armor: null },
  chaos_poxwalker_bomber: { name: "Bomber", armor: null },
  renegade_sniper: { name: "Sniper", armor: "Flak" },
};

/** Scenario display labels. */
const SCENARIO_DISPLAY = {
  sustained: "Sustained (body)",
  aimed: "Aimed (head)",
  burst: "Burst (head+crit)",
};

// ── Helpers ───────────────────────────────────────────────────────────

function selectionLabel(value) {
  if (typeof value === "string") return value;
  if (value != null && typeof value === "object" && typeof value.raw_label === "string") {
    return value.raw_label;
  }
  return "";
}

function formatHitsToKill(htk) {
  if (htk == null) return "N/A (no data)";
  if (!Number.isFinite(htk)) return "\u221E (negated)";
  return `${htk} hit${htk !== 1 ? "s" : ""}`;
}

/** JSON replacer that preserves Infinity as the string "Infinity" (and null stays null). */
function calcReplacer(_key, value) {
  if (value === Infinity) return "Infinity";
  return value;
}

/**
 * Extract damnation hitsToKill for checklist breeds per scenario from a weapon's summary.
 * Returns Map<breedId, Map<scenario, hitsToKill>>.
 */
function extractChecklistBreakpoints(weaponResult) {
  const table = new Map();

  for (const breedId of CHECKLIST_BREEDS) {
    const scenarioMap = new Map();

    for (const action of weaponResult.actions) {
      for (const [scenarioName, scenarioData] of Object.entries(action.scenarios)) {
        const entry = scenarioData.breeds.find(
          (b) => b.breed_id === breedId && b.difficulty === "damnation",
        );
        if (!entry) continue;

        const existing = scenarioMap.get(scenarioName);
        // Keep the lowest hitsToKill (best action) for each scenario
        if (existing == null || entry.hitsToKill < existing) {
          scenarioMap.set(scenarioName, entry.hitsToKill);
        }
      }
    }

    if (scenarioMap.size > 0) {
      table.set(breedId, scenarioMap);
    }
  }

  return table;
}

// ── Text formatter ────────────────────────────────────────────────────

function formatCalcText(matrix, build) {
  const lines = [];
  const buildTitle = build.title || "Untitled Build";
  const buildClass = selectionLabel(build.class);

  lines.push(`\u2550\u2550\u2550 BUILD: ${buildTitle} (${buildClass}) \u2550\u2550\u2550`);
  lines.push("");

  const scenarioNames = matrix.metadata.scenarios;

  for (const weapon of matrix.weapons) {
    const weaponBuild = (build.weapons ?? [])[weapon.slot];
    const weaponName = weaponBuild ? selectionLabel(weaponBuild.name) : weapon.entityId;
    const slotLabel = weaponBuild?.slot ?? (weapon.entityId.includes("ranged") ? "ranged" : "melee");

    lines.push(`\u2500\u2500\u2500 ${weaponName} (${slotLabel}) \u2500\u2500\u2500`);

    const breakpoints = extractChecklistBreakpoints(weapon);

    // Column headers
    const scenarioHeaders = scenarioNames.map((s) => SCENARIO_DISPLAY[s] ?? s);
    const colWidth = 20;
    const nameColWidth = 24;
    const header =
      "".padEnd(nameColWidth) +
      scenarioHeaders.map((h) => h.padEnd(colWidth)).join("");
    lines.push(header);

    for (const breedId of CHECKLIST_BREEDS) {
      const scenarioMap = breakpoints.get(breedId);
      if (!scenarioMap) continue;

      const breedInfo = BREED_DISPLAY[breedId];
      const displayName = breedInfo?.name ?? breedId;
      const nameCell = breedInfo?.armor
        ? `${displayName} (${breedInfo.armor})`
        : displayName;

      const cells = scenarioNames.map((s) => {
        const htk = scenarioMap.get(s);
        return htk != null ? formatHitsToKill(htk) : "-";
      });

      const row =
        nameCell.padEnd(nameColWidth) +
        cells.map((c) => c.padEnd(colWidth)).join("");
      lines.push(row);
    }

    lines.push("");
  }

  // Summary section
  const summaries = summarizeBreakpoints(matrix);
  if (summaries.length > 0) {
    lines.push("BREAKPOINT SUMMARY (Damnation):");

    for (const weapon of matrix.weapons) {
      const weaponSummaries = summaries.filter((s) => s.weaponId === weapon.entityId);
      if (weaponSummaries.length === 0) continue;

      const weaponBuild = (build.weapons ?? [])[weapon.slot];
      const weaponName = weaponBuild ? selectionLabel(weaponBuild.name) : weapon.entityId;
      lines.push(`  ${weaponName}:`);

      for (const s of weaponSummaries) {
        const breedEntries = Object.entries(s.keyBreakpoints)
          .filter(([, htk]) => htk != null)
          .map(([breedId, htk]) => {
            const name = BREED_DISPLAY[breedId]?.name ?? breedId;
            return `${formatHitsToKill(htk)} ${name}`;
          });
        if (breedEntries.length > 0) {
          const label = `${s.category} (${SCENARIO_DISPLAY[s.scenario] ?? s.scenario})`;
          lines.push(`    ${label}: ${breedEntries.join(", ")}`);
        }
      }
    }
  }

  return lines.join("\n");
}

// ── Compare formatter ─────────────────────────────────────────────────

function formatCompare(matrixA, buildA, matrixB, buildB) {
  const lines = [];
  lines.push(`\u2550\u2550\u2550 COMPARE: ${buildA.title ?? "Build A"} vs ${buildB.title ?? "Build B"} \u2550\u2550\u2550`);
  lines.push("");

  // Collect damnation breakpoints per weapon per build
  function collectBreakpointMap(matrix) {
    const result = new Map();
    for (const weapon of matrix.weapons) {
      const bp = extractChecklistBreakpoints(weapon);
      result.set(weapon.entityId, bp);
    }
    return result;
  }

  const bpA = collectBreakpointMap(matrixA);
  const bpB = collectBreakpointMap(matrixB);

  // Compare matching weapons
  const allWeaponIds = new Set([...bpA.keys(), ...bpB.keys()]);
  const scenarioNames = matrixA.metadata.scenarios;

  for (const weaponId of allWeaponIds) {
    const wBpA = bpA.get(weaponId);
    const wBpB = bpB.get(weaponId);

    if (!wBpA && !wBpB) continue;

    lines.push(`--- ${weaponId} ---`);

    if (!wBpA) {
      lines.push("  Only in Build B");
      lines.push("");
      continue;
    }
    if (!wBpB) {
      lines.push("  Only in Build A");
      lines.push("");
      continue;
    }

    // Compare breed breakpoints
    for (const breedId of CHECKLIST_BREEDS) {
      const mapA = wBpA.get(breedId);
      const mapB = wBpB.get(breedId);
      if (!mapA && !mapB) continue;

      const displayName = BREED_DISPLAY[breedId]?.name ?? breedId;
      const diffs = [];

      for (const scenario of scenarioNames) {
        const htkA = mapA?.get(scenario);
        const htkB = mapB?.get(scenario);
        if (htkA === htkB) continue;

        const label = SCENARIO_DISPLAY[scenario] ?? scenario;
        const aStr = htkA != null ? formatHitsToKill(htkA) : "-";
        const bStr = htkB != null ? formatHitsToKill(htkB) : "-";
        diffs.push(`${label}: ${aStr} \u2192 ${bStr}`);
      }

      if (diffs.length > 0) {
        lines.push(`  ${displayName}: ${diffs.join("; ")}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

// ── CLI ───────────────────────────────────────────────────────────────

await runCliMain("calc", async () => {
  const { values, positionals } = parseArgs({
    options: {
      json: { type: "boolean", default: false },
      text: { type: "boolean", default: false },
      compare: { type: "string" },
      freeze: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const target = positionals[0];
  if (!target) {
    throw new Error("Usage: npm run calc -- <build.json|dir> [--json|--text|--compare <file>] [--freeze]");
  }

  const index = loadIndex();
  const calcData = loadCalculatorData();

  function processFile(filePath) {
    const build = JSON.parse(readFileSync(filePath, "utf-8"));
    const matrix = computeBreakpoints(build, index, calcData);
    return { build, matrix };
  }

  // Compare mode
  if (values.compare) {
    const { build: buildA, matrix: matrixA } = processFile(target);
    const { build: buildB, matrix: matrixB } = processFile(values.compare);

    if (values.json) {
      console.log(JSON.stringify({ buildA: matrixA, buildB: matrixB }, null, 2));
    } else {
      console.log(formatCompare(matrixA, buildA, matrixB, buildB));
    }
    return;
  }

  const stat = statSync(target);

  if (stat.isDirectory()) {
    const files = readdirSync(target).filter((f) => f.endsWith(".json")).sort();
    let failures = 0;

    if (values.freeze) {
      const outDir = "tests/fixtures/ground-truth/calc";
      mkdirSync(outDir, { recursive: true });

      for (const f of files) {
        try {
          const { build, matrix } = processFile(join(target, f));
          const prefix = basename(f, ".json");
          writeFileSync(join(outDir, `${prefix}.calc.json`), JSON.stringify(matrix, calcReplacer, 2) + "\n");
          const weaponCount = matrix.weapons.length;
          console.log(`Frozen: ${prefix} (${weaponCount} weapon${weaponCount !== 1 ? "s" : ""})`);
        } catch (err) {
          console.error(`SKIP ${f}: ${err.message}`);
          failures++;
        }
      }
      if (failures > 0) console.error(`${failures} build(s) skipped due to errors.`);
      return;
    }

    for (const f of files) {
      try {
        const { build, matrix } = processFile(join(target, f));
        if (values.json) {
          console.log(JSON.stringify(matrix, null, 2));
        } else {
          console.log(formatCalcText(matrix, build));
          console.log("");
        }
      } catch (err) {
        console.error(`SKIP ${f}: ${err.message}`);
        failures++;
      }
    }
    if (failures > 0) console.error(`${failures} build(s) skipped due to errors.`);
  } else {
    const { build, matrix } = processFile(target);
    if (values.json) {
      console.log(JSON.stringify(matrix, null, 2));
    } else {
      console.log(formatCalcText(matrix, build));
    }
  }
});
