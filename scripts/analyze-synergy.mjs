#!/usr/bin/env node
// Synergy analysis CLI — run on a build or directory of builds.
// Usage: npm run synergy -- <build.json|dir> [--json]

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { analyzeBuild, loadIndex } from "./ground-truth/lib/synergy-model.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: "boolean", default: false },
  },
});

const target = positionals[0];
if (!target) {
  console.error("Usage: npm run synergy -- <build.json|dir> [--json]");
  process.exit(1);
}

const index = loadIndex();

function processFile(filePath) {
  const build = JSON.parse(readFileSync(filePath, "utf-8"));
  return analyzeBuild(build, index);
}

function formatText(result) {
  const lines = [];
  lines.push(`=== ${result.build} (${result.class}) ===`);
  lines.push(`Coverage: ${result.metadata.unique_entities_with_calc}/${result.metadata.entities_analyzed} selections (${Math.round(result.metadata.calc_coverage_pct * 100)}%)`);
  lines.push("");

  if (result.coverage.build_identity.length > 0) {
    lines.push(`Build identity: ${result.coverage.build_identity.join(", ")}`);
    lines.push(`Concentration: ${result.coverage.concentration}`);
  }

  if (result.coverage.coverage_gaps.length > 0) {
    lines.push(`Coverage gaps: ${result.coverage.coverage_gaps.join(", ")}`);
  }

  lines.push("");
  lines.push(`Synergy edges: ${result.synergy_edges.length}`);
  const byStrength = { 3: 0, 2: 0, 1: 0 };
  for (const e of result.synergy_edges) byStrength[e.strength] = (byStrength[e.strength] || 0) + 1;
  lines.push(`  Strong (3): ${byStrength[3] || 0}  Moderate (2): ${byStrength[2] || 0}  Weak (1): ${byStrength[1] || 0}`);

  if (result.anti_synergies.length > 0) {
    lines.push("");
    lines.push("Anti-synergies:");
    for (const a of result.anti_synergies) {
      lines.push(`  [${a.severity}] ${a.reason}`);
    }
  }

  if (result.orphans.length > 0) {
    lines.push("");
    lines.push("Orphans:");
    for (const o of result.orphans) {
      lines.push(`  ${o.selection}: ${o.reason}${o.resource ? ` (${o.resource})` : ""}${o.condition ? ` [${o.condition}]` : ""}`);
    }
  }

  lines.push("");
  lines.push(`Slot balance: melee=${result.coverage.slot_balance.melee.strength} ranged=${result.coverage.slot_balance.ranged.strength}`);

  if (result.metadata.opaque_conditions > 0) {
    lines.push(`Opaque conditions: ${result.metadata.opaque_conditions}`);
  }

  return lines.join("\n");
}

const stat = statSync(target);
if (stat.isDirectory()) {
  const files = readdirSync(target).filter((f) => f.endsWith(".json")).sort();
  for (const f of files) {
    const result = processFile(join(target, f));
    if (values.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatText(result));
      console.log("");
    }
  }
} else {
  const result = processFile(target);
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatText(result));
  }
}
