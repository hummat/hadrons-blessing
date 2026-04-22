// Score Darktide build data (output of extract-build.mjs) against build-scoring-data.json.
// CLI entry point — library functions live in ../lib/score-build.ts.

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, basename } from "node:path";
import { parseArgs } from "node:util";
import { runCliMain } from "../lib/cli.js";
import {
  parsePerkString,
  scorePerk,
  scoreWeaponPerks,
  scoreBlessings,
  scoreCurios,
  generateScorecard,
} from "../lib/score-build.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

/**
 * Format scorecard as human-readable text.
 */
function formatScorecardText(card: AnyRecord): string {
  const lines: string[] = [];
  const compositeMax = card.qualitative?.survivability ? 40 : 35;
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
    const perkParts: string[] = [];
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
    const blessingParts: string[] = [];
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
  lines.push("QUALITATIVE SCORES:");
  const tc = card.qualitative.talent_coherence;
  const bs = card.qualitative.blessing_synergy;
  const rc = card.qualitative.role_coverage;
  const br = card.qualitative.breakpoint_relevance;
  const ds = card.qualitative.difficulty_scaling;
  const sv = card.qualitative.survivability;
  lines.push(`  Talent Coherence:     ${tc ? tc.score + "/5" : "-/5"}`);
  lines.push(`  Blessing Synergy:     ${bs ? bs.score + "/5" : "-/5"}`);
  lines.push(`  Role Coverage:        ${rc ? rc.score + "/5" : "-/5"}`);
  lines.push(`  Breakpoint Relevance: ${br ? br.score + "/5" : "-/5  (requires calculator)"}`);
  lines.push(`  Difficulty Scaling:   ${ds ? ds.score + "/5" : "-/5  (requires calculator)"}`);
  lines.push(`  Survivability:        ${sv ? sv.score + "/5" : "-/5  (requires toughness profile)"}`);

  lines.push("");
  lines.push(`COMPOSITE: ${card.composite_score}/${compositeMax} (${card.letter_grade})`);

  lines.push("");
  lines.push("BOT FLAGS:");
  if (Array.isArray(card.bot_flags) && card.bot_flags.length > 0) {
    for (const flag of card.bot_flags) {
      lines.push(`  - ${flag}`);
    }
  } else {
    lines.push("  - none");
  }

  return lines.join("\n");
}

// CLI entry point — only when executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runCliMain("score", async () => {
    const { values, positionals } = parseArgs({
      options: {
        json: { type: "boolean", default: false },
        text: { type: "boolean", default: false },
        freeze: { type: "boolean", default: false },
      },
      allowPositionals: true,
      strict: true,
    });

    if (values.json && values.text) {
      throw new Error("--json and --text are mutually exclusive");
    }

    const target = positionals[0];
    if (!target) {
      throw new Error("Usage: npm run score -- <build.json|dir> [--json|--text] [--freeze]");
    }

    // Load synergy + calculator data once (graceful degradation)
    let index: AnyRecord | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let analyzeBuildFn: ((build: AnyRecord, idx: AnyRecord) => AnyRecord) | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let computeBreakpointsFn: ((build: AnyRecord, idx: AnyRecord, calcData: AnyRecord) => AnyRecord) | null = null;
    let calcData: AnyRecord | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let computeSurvivabilityFn: ((build: AnyRecord, idx: AnyRecord, options?: AnyRecord) => AnyRecord) | null = null;

    try {
      const synMod = await import("../lib/synergy-model.js");
      index = synMod.loadIndex() as AnyRecord;
      analyzeBuildFn = synMod.analyzeBuild as unknown as (build: AnyRecord, idx: AnyRecord) => AnyRecord;
    } catch {
      // Synergy unavailable (e.g. missing GROUND_TRUTH_SOURCE_ROOT) — proceed without qualitative scores
    }

    try {
      const calcMod = await import("../lib/damage-calculator.js");
      const toughnessMod = await import("../lib/toughness-calculator.js");
      if (!index) {
        const synMod = await import("../lib/synergy-model.js");
        index = synMod.loadIndex() as AnyRecord;
      }
      calcData = calcMod.loadCalculatorData() as AnyRecord;
      computeBreakpointsFn = calcMod.computeBreakpoints as unknown as (build: AnyRecord, idx: AnyRecord, calcData: AnyRecord) => AnyRecord;
      computeSurvivabilityFn = toughnessMod.computeSurvivability as unknown as (build: AnyRecord, idx: AnyRecord, options?: AnyRecord) => AnyRecord;
    } catch {
      // Calculator data not available — proceed without breakpoint scores
    }

    function processFile(filePath: string): AnyRecord {
      const build = JSON.parse(readFileSync(filePath, "utf-8")) as AnyRecord;

      let synergyOutput: AnyRecord | null = null;
      if (analyzeBuildFn && index) {
        try {
          synergyOutput = analyzeBuildFn(build, index) as AnyRecord;
        } catch {
          // Build-level synergy failure — skip qualitative scores for this build
        }
      }

      let calcOutput: { matrix: AnyRecord } | null = null;
      if (computeBreakpointsFn && index && calcData) {
        try {
          const matrix = computeBreakpointsFn(build, index, calcData);
          calcOutput = { matrix };
        } catch {
          // Build-level calc failure — skip breakpoint scores for this build
        }
      }

      let survivabilityOutput: { profile: AnyRecord; baseline: AnyRecord } | null = null;
      if (computeSurvivabilityFn && index && build.class && typeof build.class === "object") {
        try {
          const profile = computeSurvivabilityFn(build, index, { difficulty: "damnation" });
          const baseline = computeSurvivabilityFn(
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
            index,
            { difficulty: "damnation" },
          );
          survivabilityOutput = { profile, baseline };
        } catch {
          // Build-level survivability failure — skip survivability score for this build
        }
      }

      return generateScorecard(build, synergyOutput, calcOutput, survivabilityOutput) as AnyRecord;
    }

    const FREEZE_DIR = "tests/fixtures/ground-truth/scores";

    const stat = statSync(target);

    if (stat.isDirectory()) {
      const files = readdirSync(target).filter((f) => f.endsWith(".json")).sort();
      let failures = 0;

      if (values.freeze) {
        mkdirSync(FREEZE_DIR, { recursive: true });

        for (const f of files) {
          try {
            const card = processFile(join(target, f));
            const prefix = basename(f, ".json");
            writeFileSync(
              join(FREEZE_DIR, `${prefix}.score.json`),
              JSON.stringify(card, null, 2) + "\n",
            );
            console.log(`Frozen: ${prefix} → ${card.letter_grade} (${card.composite_score})`);
          } catch (err) {
            console.error(`SKIP ${f}: ${(err as Error).message}`);
            failures++;
          }
        }
        if (failures > 0) console.error(`${failures} build(s) skipped due to errors.`);
        return;
      }

      for (const f of files) {
        try {
          const card = processFile(join(target, f));
          if (values.text) {
            console.log(formatScorecardText(card));
            console.log("");
          } else {
            console.log(JSON.stringify(card, null, 2));
          }
        } catch (err) {
          console.error(`SKIP ${f}: ${(err as Error).message}`);
          failures++;
        }
      }
      if (failures > 0) console.error(`${failures} build(s) skipped due to errors.`);
    } else {
      const card = processFile(target);
      if (values.text) {
        console.log(formatScorecardText(card));
      } else {
        console.log(JSON.stringify(card, null, 2));
      }
    }
  });
}

export { parsePerkString, scorePerk, scoreWeaponPerks, scoreBlessings, scoreCurios, generateScorecard };
