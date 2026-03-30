// @ts-nocheck
// Score Darktide build data (output of extract-build.mjs) against build-scoring-data.json.
// CLI entry point — library functions live in ../lib/score-build.ts.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  parsePerkString,
  scorePerk,
  scoreWeaponPerks,
  scoreBlessings,
  scoreCurios,
  generateScorecard,
} from "../lib/score-build.js";

/**
 * Format scorecard as human-readable text.
 */
function formatScorecardText(card) {
  const lines = [];
  lines.push(`=== ${card.title} (${card.class}) ===`);
  lines.push("");
  lines.push("MECHANICAL SCORES:");
  lines.push(`  Perk Optimality:      ${card.perk_optimality}/5`);
  lines.push(`  Curio Efficiency:     ${card.curio_efficiency}/5`);
  lines.push("  Breakpoint Relevance: -/5  (requires qualitative assessment)");
  lines.push("");
  lines.push("WEAPONS:");

  for (const w of card.weapons) {
    const slotTag = w.slot ? `[${w.slot}]` : "[?]";
    lines.push(`  ${slotTag} ${w.name}`);

    // Perks line
    const perkParts = [];
    for (const p of w.perks.perks) {
      if (p === null) {
        perkParts.push("? (unknown)");
      } else {
        perkParts.push(`+${p.name} (T${p.tier}) \u2713`);
      }
    }
    if (perkParts.length > 0) {
      lines.push(`    Perks: ${perkParts.join(", ")}`);
    }

    // Blessings line
    const blessingParts = [];
    for (const b of w.blessings.blessings) {
      blessingParts.push(`${b.name} ${b.known ? "\u2713" : "(?)"}`);
    }
    if (blessingParts.length > 0) {
      lines.push(`    Blessings: ${blessingParts.join(", ")}`);
    }
  }

  lines.push("");
  lines.push("CURIOS:");
  for (const p of card.curios.perks) {
    const tierStr = p.tier > 0 ? `(T${p.tier})` : "(?)";
    const check = p.rating === "avoid" ? "\u2717" : "\u2713";
    lines.push(`  ${p.name} ${tierStr} ${check} ${p.rating}`);
  }

  lines.push("");
  const hasQualitative = card.qualitative.talent_coherence != null || card.qualitative.blessing_synergy != null || card.qualitative.role_coverage != null;
  const hasCalc = card.qualitative.breakpoint_relevance != null || card.qualitative.difficulty_scaling != null;
  if (hasQualitative || hasCalc) {
    lines.push("QUALITATIVE SCORES:");
    const tc = card.qualitative.talent_coherence;
    const bs = card.qualitative.blessing_synergy;
    const rc = card.qualitative.role_coverage;
    const br = card.qualitative.breakpoint_relevance;
    const ds = card.qualitative.difficulty_scaling;
    lines.push(`  Talent Coherence:     ${tc ? tc.score + "/5" : "-/5"}`);
    lines.push(`  Blessing Synergy:     ${bs ? bs.score + "/5" : "-/5"}`);
    lines.push(`  Role Coverage:        ${rc ? rc.score + "/5" : "-/5"}`);
    lines.push(`  Breakpoint Relevance: ${br ? br.score + "/5" : "-/5  (requires calculator)"}`);
    lines.push(`  Difficulty Scaling:   ${ds ? ds.score + "/5" : "-/5  (requires calculator)"}`);
  } else {
    lines.push("QUALITATIVE (fill manually):");
    lines.push("  Blessing Synergy:     _/5");
    lines.push("  Talent Coherence:     _/5");
    lines.push("  Role Coverage:        _/5");
    lines.push("  Difficulty Scaling:   _/5");
  }

  lines.push("");
  lines.push(`COMPOSITE: ${card.composite_score}/35 (${card.letter_grade})`);

  lines.push("");
  lines.push("BOT FLAGS: (fill manually)");
  lines.push("  [ ] BOT:NO_DODGE");
  lines.push("  [ ] BOT:NO_WEAKSPOT");
  lines.push("  [ ] BOT:NO_PERIL_MGT");
  lines.push("  [ ] BOT:NO_POSITIONING");
  lines.push("  [ ] BOT:NO_BLOCK_TIMING");
  lines.push("  [ ] BOT:AIM_DEPENDENT");
  lines.push("  [ ] BOT:ABILITY_OK");
  lines.push("  [ ] BOT:ABILITY_MISSING");

  return lines.join("\n");
}

// CLI entry point — only when executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      text: { type: "boolean", default: false },
    },
  });

  const buildPath = positionals[0];
  if (!buildPath) {
    console.error("Usage: node scripts/score-build.mjs <build.json> [--json|--text]");
    process.exit(1);
  }

  const build = JSON.parse(readFileSync(buildPath, "utf-8"));

  // Load synergy for qualitative scoring (dynamic import to keep module lightweight for library consumers)
  let synergyOutput = null;
  let index = null;
  try {
    const { analyzeBuild, loadIndex } = await import("../lib/synergy-model.js");
    index = loadIndex();
    synergyOutput = analyzeBuild(build, index);
  } catch {
    // Synergy unavailable (e.g. missing GROUND_TRUTH_SOURCE_ROOT) — proceed without qualitative scores
  }

  // Load calculator output for breakpoint scoring (graceful degradation)
  let calcOutput = null;
  try {
    const { loadCalculatorData, computeBreakpoints } = await import("../lib/damage-calculator.js");
    if (!index) {
      const { loadIndex } = await import("../lib/synergy-model.js");
      index = loadIndex();
    }
    const calcData = loadCalculatorData();
    const matrix = computeBreakpoints(build, index, calcData);
    calcOutput = { matrix };
  } catch {
    // Calculator data not available — proceed without breakpoint scores
  }

  const card = generateScorecard(build, synergyOutput, calcOutput);

  if (values.text) {
    console.log(formatScorecardText(card));
  } else {
    console.log(JSON.stringify(card, null, 2));
  }
}

export { parsePerkString, scorePerk, scoreWeaponPerks, scoreBlessings, scoreCurios, generateScorecard };
