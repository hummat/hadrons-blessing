#!/usr/bin/env node
// Toughness/survivability calculator CLI — run on a build or directory of builds.
// Usage: npm run toughness -- <build.json|dir> [--json|--text] [--freeze]

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runCliMain } from "./ground-truth/lib/cli.mjs";
import { loadIndex } from "./ground-truth/lib/synergy-model.mjs";
import { computeSurvivability } from "./ground-truth/lib/toughness-calculator.mjs";

const __filename = fileURLToPath(import.meta.url);

// -- Helpers ------------------------------------------------------------------

/** JSON replacer that preserves Infinity as the string "Infinity". */
function calcReplacer(_key, value) {
  if (value === Infinity) return "Infinity";
  return value;
}

/**
 * Format a DR source value as a human-readable percentage.
 * Raw magnitudes are negative (e.g., -0.15 means 15% DR).
 * Multiplier-style stats use (1 + value) as the damage multiplier.
 */
function formatDRValue(source) {
  const { stat, value } = source;
  if (stat === "toughness_damage_taken_modifier") {
    // Additive modifier — magnitude is negative, so -0.05 means 5% DR
    const pct = Math.abs(value) * 100;
    const multiplier = 1 + value;
    return `${multiplier.toFixed(2)} (${pct.toFixed(0)}% DR, additive)`;
  }
  // Multiplicative: (1 + value) is the damage multiplier
  const multiplier = 1 + value;
  const pct = Math.abs(value) * 100;
  return `${multiplier.toFixed(2)} (${pct.toFixed(0)}% DR)`;
}

// -- Text formatter -----------------------------------------------------------

function formatToughnessText(result, build) {
  const lines = [];
  const buildTitle = build.title || "Untitled Build";

  lines.push(`\u2550\u2550\u2550 Survivability Analysis: ${buildTitle} \u2550\u2550\u2550`);
  lines.push("");

  // Class + base stats
  lines.push(`Class: ${result.class} (${result.difficulty})`);
  lines.push(`  Base HP: ${result.base.health} \u00d7 ${result.base.wounds} wounds = ${result.health_pool}`);
  lines.push(`  Base Toughness: ${result.base.toughness}`);
  if (result.max_toughness !== result.base.toughness) {
    lines.push(`  Max Toughness: ${result.max_toughness}`);
  }
  lines.push("");

  // DR sources
  if (result.dr_sources.length > 0) {
    lines.push("DR Sources:");
    for (const src of result.dr_sources) {
      const entity = src.source_entity.padEnd(42);
      const stat = src.stat.padEnd(40);
      lines.push(`  ${entity} ${stat} ${formatDRValue(src)}`);
    }
    lines.push(`  Total DR: ${(result.total_dr * 100).toFixed(1)}%`);
    lines.push("");
  } else {
    lines.push("DR Sources: (none)");
    lines.push("");
  }

  // Effective toughness + HP
  lines.push(`Effective Toughness: ${result.effective_toughness} (base ${result.base.toughness}${result.max_toughness !== result.base.toughness ? `, max ${result.max_toughness}` : ""}, / DR multiplier)`);
  lines.push(`Effective HP: ${result.effective_hp}`);
  if (result.max_health_modifier !== 0) {
    lines.push(`  Health modifier: ${result.max_health_modifier > 0 ? "+" : ""}${(result.max_health_modifier * 100).toFixed(1)}%`);
  }
  lines.push("");

  // State modifiers
  const stateLabels = { dodging: "Dodging", sliding: "Sliding", sprinting: "Sprinting" };
  const stateEntries = Object.entries(result.state_modifiers);
  if (stateEntries.length > 0) {
    lines.push("State Modifiers:");
    for (const [state, mod] of stateEntries) {
      const label = stateLabels[state] ?? state;
      const tdrPct = (mod.tdr * 100).toFixed(0);
      const dmgMult = (1 - mod.tdr).toFixed(1);
      lines.push(`  ${label}: ${dmgMult}\u00d7 toughness damage \u2192 effective toughness ${mod.effective_toughness}`);
    }
    lines.push("");
  }

  // Toughness regen
  const regen = result.toughness_regen;
  lines.push("Toughness Regen:");
  lines.push(`  Base: ${regen.base_rate.toFixed(1)}/sec (${regen.delay_seconds}s delay after hit)`);

  const coherencyLabels = {
    solo: "Solo",
    one_ally: "1 ally",
    two_allies: "2 allies",
    three_allies: "3+ allies",
  };
  for (const [key, label] of Object.entries(coherencyLabels)) {
    if (regen.coherency[key] != null) {
      lines.push(`  ${label}: ${regen.coherency[key].toFixed(1)}/sec`);
    }
  }

  const meleeKillPct = (regen.melee_kill_recovery_percent * 100).toFixed(0);
  lines.push(`  Melee kill: +${regen.melee_kill_recovery.toFixed(1)} (${meleeKillPct}% of max)`);

  return lines.join("\n");
}

// -- CLI ----------------------------------------------------------------------

await runCliMain("toughness", async () => {
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
    throw new Error("Usage: npm run toughness -- <build.json|dir> [--json|--text] [--freeze]");
  }

  const index = loadIndex();

  function processFile(filePath) {
    const build = JSON.parse(readFileSync(filePath, "utf-8"));
    const result = computeSurvivability(build, index);
    return { build, result };
  }

  const stat = statSync(target);

  if (stat.isDirectory()) {
    const files = readdirSync(target).filter((f) => f.endsWith(".json")).sort();
    let failures = 0;

    if (values.freeze) {
      const outDir = "tests/fixtures/ground-truth/toughness";
      mkdirSync(outDir, { recursive: true });

      for (const f of files) {
        try {
          const { build, result } = processFile(join(target, f));
          const prefix = basename(f, ".json");
          writeFileSync(
            join(outDir, `${prefix}.toughness.json`),
            JSON.stringify(result, calcReplacer, 2) + "\n",
          );
          console.log(`Frozen: ${prefix}`);
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
        const { build, result } = processFile(join(target, f));
        if (values.json) {
          console.log(JSON.stringify(result, calcReplacer, 2));
        } else {
          console.log(formatToughnessText(result, build));
          console.log("");
        }
      } catch (err) {
        console.error(`SKIP ${f}: ${err.message}`);
        failures++;
      }
    }
    if (failures > 0) console.error(`${failures} build(s) skipped due to errors.`);
  } else {
    const { build, result } = processFile(target);
    if (values.json) {
      console.log(JSON.stringify(result, calcReplacer, 2));
    } else {
      console.log(formatToughnessText(result, build));
    }
  }
});
