import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractBuild, postProcessTalentNodes } from "./extract-build.js";
import { runCliMain } from "../lib/cli.js";
import {
  buildGlClassTreeLabelEntry,
  dedupeGlClassTreeLabelEntries,
  type GlClassTreeLabelEntry,
} from "../lib/gl-class-tree-labels.js";

interface CanonicalBuildFixture {
  class?: {
    raw_label?: string;
  };
  provenance?: {
    source_kind?: string;
    source_url?: string;
  };
}

const BUILDS_DIR = resolve("data/builds");
const OUTPUT_FILE = resolve("data/ground-truth/generated/gl-class-tree-labels.json");

function pickSeedUrls(): Map<string, string> {
  const seedUrls = new Map<string, string>();

  for (const file of readdirSync(BUILDS_DIR).filter((entry) => entry.endsWith(".json")).sort()) {
    const fixture = JSON.parse(readFileSync(resolve(BUILDS_DIR, file), "utf8")) as CanonicalBuildFixture;
    const className = fixture.class?.raw_label;
    const sourceUrl = fixture.provenance?.source_url;
    if (!className || !sourceUrl || fixture.provenance?.source_kind !== "gameslantern") {
      continue;
    }
    if (!seedUrls.has(className)) {
      seedUrls.set(className, sourceUrl);
    }
  }

  return seedUrls;
}

await runCliMain("gl-class-tree:build", async () => {
  const seedUrls = pickSeedUrls();
  if (seedUrls.size === 0) {
    throw new Error(
      "No GamesLantern-provenance build fixtures found in data/builds/. "
      + "GL class-tree label generation requires at least one build per class with source_kind: 'gameslantern'.",
    );
  }
  const entries: GlClassTreeLabelEntry[] = [];

  for (const [className, sourceUrl] of seedUrls) {
    console.error(`Scraping ${className} labels from ${sourceUrl}`);
    const rawBuild = await extractBuild(sourceUrl);
    const nodes = [
      ...postProcessTalentNodes(rawBuild.talents.active),
      ...postProcessTalentNodes(rawBuild.talents.inactive),
    ];

    let skipped = 0;
    for (const node of nodes) {
      const entry = buildGlClassTreeLabelEntry(className, node, sourceUrl);
      if (entry) {
        entries.push(entry);
      } else if (node.name) {
        skipped++;
      }
    }
    if (skipped > 0) {
      console.warn(`  Warning: ${skipped} named nodes skipped for ${className} (unrecognized asset URL pattern)`);
    }
  }

  const deduped = dedupeGlClassTreeLabelEntries(entries);
  writeFileSync(OUTPUT_FILE, JSON.stringify(deduped, null, 2) + "\n");
  console.log(`Wrote ${deduped.length} GL class-tree label entries to ${OUTPUT_FILE}`);
});
