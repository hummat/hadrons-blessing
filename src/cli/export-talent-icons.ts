/**
 * Mirrors GamesLantern talent icons into the website's static folder.
 *
 * Data source: data/ground-truth/generated/gl-class-tree-labels.json — each
 * entry already carries the resolved GL CDN asset_url, so no HTML scraping
 * is needed. Images are downloaded verbatim and an icon-assets.json manifest
 * is emitted so the website can look up the mirrored path per entity_id.
 *
 * Usage:
 *   npm run icons:build              # downloads missing icons
 *   npm run icons:build -- --force   # redownload everything
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { REPO_ROOT, GENERATED_ROOT } from "../lib/load.js";
import { runCliMain } from "../lib/cli.js";

const WEBSITE_STATIC = join(REPO_ROOT, "website", "static");
const ICONS_DIR = join(WEBSITE_STATIC, "icons", "talents");
const ASSET_MAP_PATH = join(WEBSITE_STATIC, "data", "icon-assets.json");

const USER_AGENT = "hadrons-blessing-asset-mirror (+https://github.com/matthiashumt/hadrons-blessing)";
const REQUEST_DELAY_MS = 120;

interface GlTreeLabel {
  class: string;
  kind: string;
  internal_name: string;
  entity_id: string;
  display_name: string;
  asset_url: string | null;
}

interface IconRecord {
  entity_id: string;
  class: string;
  kind: string;
  asset_url: string;
  image_path: string; // e.g. /icons/talents/veteran/default/foo.webp
  scraped_at: string;
}

function parseArgs(argv: string[]): { force: boolean } {
  return { force: argv.includes("--force") };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadImage(url: string, dest: string): Promise<number> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) throw new Error("zero-byte image");
  writeFileSync(dest, buf);
  return buf.byteLength;
}

await runCliMain("icons:build", async () => {
  const args = parseArgs(process.argv.slice(2));

  for (const dir of [ICONS_DIR, join(WEBSITE_STATIC, "data")]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const path = join(GENERATED_ROOT, "gl-class-tree-labels.json");
  const labels = JSON.parse(readFileSync(path, "utf8")) as GlTreeLabel[];
  const targets = labels.filter((l): l is GlTreeLabel & { asset_url: string } => l.asset_url !== null);

  console.log(`Preparing to mirror ${targets.length} talent icons across 6 classes.`);

  const existing: Record<string, IconRecord> = existsSync(ASSET_MAP_PATH)
    ? JSON.parse(readFileSync(ASSET_MAP_PATH, "utf8"))
    : {};
  const results: Record<string, IconRecord> = { ...existing };

  let downloaded = 0;
  let skipped = 0;
  const failures: { entity_id: string; reason: string }[] = [];

  for (const label of targets) {
    const ext = extname(new URL(label.asset_url).pathname).toLowerCase() || ".webp";
    const subdir = join(ICONS_DIR, label.class, label.kind);
    const filename = `${label.internal_name}${ext}`;
    const destLocal = join(subdir, filename);
    const publicPath = `/icons/talents/${label.class}/${label.kind}/${filename}`;

    const existingRecord = results[label.entity_id];
    const alreadyMirrored = !args.force
      && existingRecord
      && existsSync(destLocal)
      && statSync(destLocal).size > 0;

    if (alreadyMirrored) {
      skipped++;
      continue;
    }

    if (!existsSync(subdir)) mkdirSync(subdir, { recursive: true });

    try {
      await downloadImage(label.asset_url, destLocal);
      downloaded++;
      results[label.entity_id] = {
        entity_id: label.entity_id,
        class: label.class,
        kind: label.kind,
        asset_url: label.asset_url,
        image_path: publicPath,
        scraped_at: new Date().toISOString(),
      };
      if (downloaded % 25 === 0) {
        console.log(`  downloaded ${downloaded}/${targets.length}…`);
      }
    } catch (error) {
      failures.push({
        entity_id: label.entity_id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    await sleep(REQUEST_DELAY_MS);
  }

  const sorted: Record<string, IconRecord> = {};
  for (const key of Object.keys(results).sort()) sorted[key] = results[key];
  writeFileSync(ASSET_MAP_PATH, JSON.stringify(sorted, null, 2) + "\n");

  console.log(
    `\nSummary: downloaded=${downloaded}, skipped=${skipped}, failed=${failures.length}, total-in-map=${Object.keys(sorted).length}`,
  );
  if (failures.length > 0) {
    console.log("First failures:");
    for (const f of failures.slice(0, 8)) console.log(`  ${f.entity_id}: ${f.reason}`);
    if (failures.length > 8) console.log(`  ... and ${failures.length - 8} more`);
  }
});
