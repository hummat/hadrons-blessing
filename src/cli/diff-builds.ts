// src/cli/diff-builds.ts
// CLI entry point for diffing two canonical build files.

import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runCliMain } from "../lib/cli.js";
import { diffBuilds, BuildDiff, ScoreDelta, BreakpointDelta } from "../lib/build-diff.js";

// ---------------------------------------------------------------------------
// Text formatting
// ---------------------------------------------------------------------------

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function fmtScore(v: number | null): string {
  return v === null ? "-" : String(v);
}

function fmtDelta(v: number | null): string {
  if (v === null) return "-";
  if (v > 0) return `+${v}`;
  return String(v);
}

function formatScoreComparison(deltas: ScoreDelta[]): string {
  const lines: string[] = [];
  lines.push("SCORE COMPARISON:");
  const header = `  ${"Dimension".padEnd(26)}${"A".padEnd(6)}${"B".padEnd(6)}Delta`;
  lines.push(header);
  lines.push("  " + "-".repeat(44));
  for (const d of deltas) {
    const row = `  ${pad(d.dimension, 26)}${pad(fmtScore(d.a), 6)}${pad(fmtScore(d.b), 6)}${fmtDelta(d.delta)}`;
    lines.push(row);
  }
  return lines.join("\n");
}

function formatSetSection(
  label: string,
  diff: { only_a: string[]; only_b: string[]; shared: string[] }
): string {
  const lines: string[] = [];
  lines.push(`  ${label}:`);
  if (diff.only_a.length > 0) {
    lines.push(`    Only A: ${diff.only_a.join(", ")}`);
  }
  if (diff.only_b.length > 0) {
    lines.push(`    Only B: ${diff.only_b.join(", ")}`);
  }
  lines.push(`    Shared: ${diff.shared.length} item(s)`);
  return lines.join("\n");
}

function formatSlotLine(label: string, slot: { a: string | null; b: string | null; changed: boolean }): string {
  if (!slot.changed) return "";
  const aLabel = slot.a ?? "(none)";
  const bLabel = slot.b ?? "(none)";
  return `  ${label}: ${aLabel} -> ${bLabel}`;
}

function formatStructuralDiff(diff: BuildDiff): string {
  const { structural } = diff;
  const lines: string[] = [];
  lines.push("STRUCTURAL DIFF:");

  if (!structural.class_match) {
    lines.push(`  WARNING: Cross-class comparison (${diff.a.class} vs ${diff.b.class})`);
  }

  for (const [label, slot] of [
    ["Ability", structural.ability],
    ["Blitz", structural.blitz],
    ["Aura", structural.aura],
    ["Keystone", structural.keystone],
  ] as const) {
    const line = formatSlotLine(label, slot);
    if (line) lines.push(line);
  }

  lines.push("");
  lines.push(formatSetSection("Talents", structural.talents));
  lines.push("");
  lines.push(formatSetSection("Weapons", structural.weapons));
  lines.push("");
  lines.push(formatSetSection("Blessings", structural.blessings));
  lines.push("");
  lines.push(formatSetSection("Curio Perks", structural.curio_perks));

  return lines.join("\n");
}

function fmtHtk(v: number | null): string {
  return v === null ? "-" : String(v);
}

function formatBreakpointDelta(b: BreakpointDelta): string {
  const delta = fmtDelta(b.delta);
  return `  ${b.label}: ${fmtHtk(b.a_htk)} -> ${fmtHtk(b.b_htk)} (${delta})`;
}

function formatAnalyticalDiff(diff: BuildDiff): string {
  if (!diff.analytical) return "";
  const { analytical } = diff;
  const lines: string[] = [];
  lines.push("ANALYTICAL DIFF:");

  lines.push("");
  lines.push("  Synergy Edges:");
  if (analytical.synergy_edges.only_a.length > 0) {
    lines.push(`    Only A: ${analytical.synergy_edges.only_a.join(", ")}`);
  }
  if (analytical.synergy_edges.only_b.length > 0) {
    lines.push(`    Only B: ${analytical.synergy_edges.only_b.join(", ")}`);
  }
  lines.push(`    Shared: ${analytical.synergy_edges.shared.length} item(s)`);

  if (analytical.breakpoints.length > 0) {
    lines.push("");
    lines.push("  Breakpoints:");
    for (const bp of analytical.breakpoints) {
      lines.push(formatBreakpointDelta(bp));
    }
  }

  return lines.join("\n");
}

function formatDiff(diff: BuildDiff): string {
  const sections: string[] = [];

  sections.push(
    `=== DIFF: ${diff.a.title} (${diff.a.class}) vs ${diff.b.title} (${diff.b.class}) ===`
  );
  sections.push("");
  sections.push(formatScoreComparison(diff.score_deltas));
  sections.push("");
  sections.push(formatStructuralDiff(diff));

  if (diff.analytical) {
    sections.push("");
    sections.push(formatAnalyticalDiff(diff));
  }

  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runCliMain("diff", async () => {
    const { values, positionals } = parseArgs({
      options: {
        json: { type: "boolean", default: false },
        detailed: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

    if (positionals.length < 2) {
      throw new Error(
        "Usage: npm run diff -- <build-a.json> <build-b.json> [--detailed] [--json]"
      );
    }

    const [pathA, pathB] = positionals;
    const diff = diffBuilds(pathA, pathB, { detailed: values.detailed as boolean });

    if (values.json) {
      console.log(JSON.stringify(diff, null, 2));
    } else {
      console.log(formatDiff(diff));
    }
  });
}
