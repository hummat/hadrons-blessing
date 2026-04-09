import { listBuilds } from "../../dist/lib/index.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "..", "static", "data");
const BUILDS_DIR = join(__dirname, "..", "..", "data", "builds");

mkdirSync(OUTPUT_DIR, { recursive: true });

const summaries = listBuilds(BUILDS_DIR);

writeFileSync(
  join(OUTPUT_DIR, "build-summaries.json"),
  JSON.stringify(summaries, null, 2),
);

console.log(`Generated ${summaries.length} build summaries → static/data/build-summaries.json`);
