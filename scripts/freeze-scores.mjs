#!/usr/bin/env node
// Freeze golden score snapshots for 5 representative builds.
// Usage: GROUND_TRUTH_SOURCE_ROOT=... node scripts/freeze-scores.mjs
//        or: node scripts/freeze-scores.mjs  (reads from .source-root)

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { generateScorecard } from "./score-build.mjs";
import { analyzeBuild, loadIndex } from "./ground-truth/lib/synergy-model.mjs";

const BUILDS = ["01", "04", "08", "13", "15"];
const BUILDS_DIR = "scripts/builds";
const OUT_DIR = "tests/fixtures/ground-truth/scores";

mkdirSync(OUT_DIR, { recursive: true });

const index = loadIndex();

for (const prefix of BUILDS) {
  const file = readdirSync(BUILDS_DIR).find(f => f.startsWith(prefix) && f.endsWith(".json"));
  if (!file) { console.error(`No build for prefix ${prefix}`); continue; }
  const build = JSON.parse(readFileSync(join(BUILDS_DIR, file), "utf-8"));
  const synergy = analyzeBuild(build, index);
  const card = generateScorecard(build, synergy);
  writeFileSync(join(OUT_DIR, `${prefix}.score.json`), JSON.stringify(card, null, 2) + "\n");
  console.log(`Frozen: ${prefix} → ${card.letter_grade} (${card.composite_score})`);
}
