// @ts-nocheck
// Stagger calculator CLI — run on a build or directory of builds.
// Usage: npm run stagger -- <build.json|dir> [--json|--text] [--freeze]

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runCliMain } from "../lib/cli.js";
import { loadCalculatorData } from "../lib/damage-calculator.js";
import { loadIndex } from "../lib/synergy-model.js";
import { computeStaggerMatrix, loadStaggerSettings } from "../lib/stagger-calculator.js";

const __filename = fileURLToPath(import.meta.url);

// ── Display mappings ──────────────────────────────────────────────────

/** Checklist enemies — the key breeds players care about for stagger analysis. */
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

/** Human-readable breed names. */
const BREED_DISPLAY = {
  renegade_berzerker: "Rager",
  chaos_ogryn_executor: "Crusher",
  chaos_poxwalker: "Poxwalker",
  renegade_executor: "Mauler",
  chaos_ogryn_bulwark: "Bulwark",
  renegade_netgunner: "Trapper",
  chaos_hound: "Hound",
  chaos_poxwalker_bomber: "Bomber",
  renegade_sniper: "Sniper",
};

// ── Helpers ───────────────────────────────────────────────────────────

function selectionLabel(value) {
  if (typeof value === "string") return value;
  if (value != null && typeof value === "object" && typeof value.raw_label === "string") {
    return value.raw_label;
  }
  return "";
}

/** JSON replacer that preserves Infinity as the string "Infinity". */
function calcReplacer(_key, value) {
  if (value === Infinity) return "Infinity";
  return value;
}

/**
 * Extract damnation stagger tiers for checklist breeds per action from a weapon's results.
 * Returns Map<breedId, Map<actionType, stagger_tier>>.
 */
function extractChecklistStagger(weaponResult) {
  const table = new Map();

  for (const breedId of CHECKLIST_BREEDS) {
    const actionMap = new Map();

    for (const action of weaponResult.actions) {
      const entry = action.breeds.find(
        (b) => b.breed_id === breedId && b.difficulty === "damnation",
      );
      if (!entry) continue;

      const tier = entry.stagger_tier ?? "none";
      const existing = actionMap.get(action.type);
      // Keep the best (highest) stagger tier for each action type
      if (existing == null) {
        actionMap.set(action.type, tier);
      }
    }

    if (actionMap.size > 0) {
      table.set(breedId, actionMap);
    }
  }

  return table;
}

/**
 * Collect all unique action types from a weapon's results.
 */
function collectActionTypes(weaponResult) {
  const types = new Set();
  for (const action of weaponResult.actions) {
    types.add(action.type);
  }
  return [...types];
}

// ── Text formatter ────────────────────────────────────────────────────

function formatStaggerText(matrix, build) {
  const lines = [];
  const buildTitle = build.title || "Untitled Build";

  lines.push(`\u2550\u2550\u2550 Stagger Analysis: ${buildTitle} \u2550\u2550\u2550`);
  lines.push("");

  for (const weapon of matrix.weapons) {
    const weaponBuild = (build.weapons ?? [])[weapon.slot];
    const weaponName = weaponBuild ? selectionLabel(weaponBuild.name) : weapon.entityId;

    lines.push(`Weapon: ${weaponName}`);

    const stagger = extractChecklistStagger(weapon);
    const actionTypes = collectActionTypes(weapon);

    if (actionTypes.length === 0) {
      lines.push("  (no stagger data)");
      lines.push("");
      continue;
    }

    // Pick breeds that have data for this weapon
    const activeBreeds = CHECKLIST_BREEDS.filter((b) => stagger.has(b));
    if (activeBreeds.length === 0) {
      lines.push("  (no stagger data for key breeds)");
      lines.push("");
      continue;
    }

    // Column layout
    const actionColWidth = 18;
    const breedColWidth = 10;

    // Header row
    const header =
      "  " +
      "Action".padEnd(actionColWidth) +
      "\u2502 " +
      activeBreeds
        .map((b) => (BREED_DISPLAY[b] ?? b).padEnd(breedColWidth))
        .join("\u2502 ");
    lines.push(header);

    // Data rows
    for (const actionType of actionTypes) {
      const cells = activeBreeds.map((breedId) => {
        const breedMap = stagger.get(breedId);
        const tier = breedMap?.get(actionType) ?? "none";
        return tier.padEnd(breedColWidth);
      });

      const row =
        "  " +
        actionType.padEnd(actionColWidth) +
        "\u2502 " +
        cells.join("\u2502 ");
      lines.push(row);
    }

    lines.push("");
  }

  return lines.join("\n");
}

// ── CLI ───────────────────────────────────────────────────────────────

await runCliMain("stagger", async () => {
  const { values, positionals } = parseArgs({
    options: {
      json: { type: "boolean", default: false },
      text: { type: "boolean", default: false },
      freeze: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const target = positionals[0];
  if (!target) {
    throw new Error("Usage: npm run stagger -- <build.json|dir> [--json|--text] [--freeze]");
  }

  const index = loadIndex();
  const calcData = loadCalculatorData();
  const staggerSettings = loadStaggerSettings();

  function processFile(filePath) {
    const build = JSON.parse(readFileSync(filePath, "utf-8"));
    const matrix = computeStaggerMatrix(build, index, calcData, staggerSettings);
    return { build, matrix };
  }

  const stat = statSync(target);

  if (stat.isDirectory()) {
    const files = readdirSync(target).filter((f) => f.endsWith(".json")).sort();
    let failures = 0;

    if (values.freeze) {
      const outDir = "tests/fixtures/ground-truth/stagger";
      mkdirSync(outDir, { recursive: true });

      for (const f of files) {
        try {
          const { build, matrix } = processFile(join(target, f));
          const prefix = basename(f, ".json");
          writeFileSync(
            join(outDir, `${prefix}.stagger.json`),
            JSON.stringify(matrix, calcReplacer, 2) + "\n",
          );
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
          console.log(JSON.stringify(matrix, calcReplacer, 2));
        } else {
          console.log(formatStaggerText(matrix, build));
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
      console.log(JSON.stringify(matrix, calcReplacer, 2));
    } else {
      console.log(formatStaggerText(matrix, build));
    }
  }
});
