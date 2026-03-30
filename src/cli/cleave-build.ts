// @ts-nocheck
// Cleave calculator CLI — run on a build or directory of builds.
// Usage: npm run cleave -- <build.json|dir> [--json|--text] [--freeze]

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runCliMain } from "../lib/cli.js";
import { loadCalculatorData } from "../lib/damage-calculator.js";
import { loadIndex } from "../lib/synergy-model.js";
import { computeCleaveMatrix } from "../lib/cleave-calculator.js";

const __filename = fileURLToPath(import.meta.url);

// -- Helpers ------------------------------------------------------------------

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

// -- Text formatter -----------------------------------------------------------

function formatCleaveText(matrix, build) {
  const lines = [];
  const buildTitle = build.title || "Untitled Build";

  lines.push(`\u2550\u2550\u2550 Cleave Analysis: ${buildTitle} \u2550\u2550\u2550`);
  lines.push("");

  const compositions = matrix.metadata.compositions_used;

  for (const weapon of matrix.weapons) {
    const weaponBuild = (build.weapons ?? [])[weapon.slot];
    const weaponName = weaponBuild ? selectionLabel(weaponBuild.name) : weapon.entityId;

    lines.push(`Weapon: ${weaponName}`);

    if (weapon.actions.length === 0) {
      lines.push("  (no cleave data)");
      lines.push("");
      continue;
    }

    // Column layout
    const actionColWidth = 18;
    const compColWidth = 32;

    // Header row
    const header =
      "  " +
      "Action".padEnd(actionColWidth) +
      "\u2502 " +
      compositions
        .map((c) => c.padEnd(compColWidth))
        .join("\u2502 ");
    lines.push(header);

    // Data rows
    for (const action of weapon.actions) {
      const cells = compositions.map((compName) => {
        const comp = action.compositions[compName];
        if (!comp) return "-".padEnd(compColWidth);
        const cell = `${comp.targets_hit} hit / ${comp.targets_killed} killed (budget ${action.cleave_budget.toFixed(1)})`;
        return cell.padEnd(compColWidth);
      });

      const row =
        "  " +
        action.type.padEnd(actionColWidth) +
        "\u2502 " +
        cells.join("\u2502 ");
      lines.push(row);
    }

    lines.push("");
  }

  return lines.join("\n");
}

// -- CLI ----------------------------------------------------------------------

await runCliMain("cleave", async () => {
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
    throw new Error("Usage: npm run cleave -- <build.json|dir> [--json|--text] [--freeze]");
  }

  const index = loadIndex();
  const calcData = loadCalculatorData();

  function processFile(filePath) {
    const build = JSON.parse(readFileSync(filePath, "utf-8"));
    const matrix = computeCleaveMatrix(build, index, calcData);
    return { build, matrix };
  }

  const stat = statSync(target);

  if (stat.isDirectory()) {
    const files = readdirSync(target).filter((f) => f.endsWith(".json")).sort();
    let failures = 0;

    if (values.freeze) {
      const outDir = "tests/fixtures/ground-truth/cleave";
      mkdirSync(outDir, { recursive: true });

      for (const f of files) {
        try {
          const { build, matrix } = processFile(join(target, f));
          const prefix = basename(f, ".json");
          writeFileSync(
            join(outDir, `${prefix}.cleave.json`),
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
          console.log(formatCleaveText(matrix, build));
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
      console.log(formatCleaveText(matrix, build));
    }
  }
});
