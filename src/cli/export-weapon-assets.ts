/**
 * Scrapes GamesLantern weapon hero images and mirrors them into the website's
 * static folder. Emits an asset-map JSON the website can consume to render
 * real weapon art in place of chip-only cards.
 *
 * Flow:
 *   1. Match each ground-truth `shared.weapon.*` to its GL catalog entry via ui_name.
 *   2. Fetch each GL weapon page, extract the first hero image URL
 *      (path: /storage/sites/darktide/weapons/<hash>.png|webp|jpg).
 *   3. Download the image to website/static/weapons/{internal_name}.{ext}.
 *   4. Emit website/static/data/weapon-assets.json with the full mapping.
 *
 * Usage:
 *   npm run weapons:build              # scrape + mirror (skips existing files)
 *   npm run weapons:build -- --force   # redownload everything
 *   npm run weapons:build -- --only <entity_id>  # single weapon (for iteration)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { REPO_ROOT, ENTITIES_ROOT, GENERATED_ROOT } from "../lib/load.js";
import { runCliMain } from "../lib/cli.js";

const WEBSITE_STATIC = join(REPO_ROOT, "website", "static");
const WEAPONS_DIR = join(WEBSITE_STATIC, "weapons");
const ASSET_MAP_PATH = join(WEBSITE_STATIC, "data", "weapon-assets.json");

const HERO_PATH_RE = /\/storage\/sites\/darktide\/weapons\/[A-Za-z0-9]+\.(?:png|webp|jpg|jpeg)/i;
const USER_AGENT = "hadrons-blessing-asset-mirror (+https://github.com/matthiashumt/hadrons-blessing)";
const REQUEST_DELAY_MS = 350;

interface GlWeapon {
  gl_id: string;
  display_name: string;
  url_slug: string;
  source_url: string;
  type?: string;
}

interface WeaponEntity {
  id: string;
  kind: string;
  internal_name: string;
  ui_name: string | null;
  attributes?: { weapon_family?: string; slot?: string };
}

interface AssetRecord {
  entity_id: string;
  internal_name: string;
  display_name: string;
  gl_url: string;
  image_path: string; // relative to website root, e.g. /weapons/powersword_p1_m2.png
  scraped_at: string;
}

function parseArgs(argv: string[]): { force: boolean; only: string | null } {
  const out = { force: false, only: null as string | null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--force") out.force = true;
    else if (argv[i] === "--only" && argv[i + 1]) {
      out.only = argv[i + 1];
      i++;
    }
  }
  return out;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  return await res.text();
}

async function downloadImage(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching image ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) throw new Error(`zero-byte image at ${url}`);
  writeFileSync(dest, buf);
}

function extractHeroImagePath(html: string): string | null {
  const match = html.match(HERO_PATH_RE);
  return match ? match[0] : null;
}

function absolutizeImageUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `https://gameslantern.com${path}`;
}

function loadGlWeapons(): GlWeapon[] {
  const path = join(GENERATED_ROOT, "gl-weapons.json");
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadWeaponEntities(): WeaponEntity[] {
  const path = join(ENTITIES_ROOT, "shared-weapons.json");
  const all = JSON.parse(readFileSync(path, "utf8")) as WeaponEntity[];
  return all.filter((e) => e.id.startsWith("shared.weapon.") && e.ui_name);
}

/**
 * Build entity_id → GL weapon entry map by exact display_name matching.
 * Logs and returns the count of unmatched entries on each side.
 */
function matchEntitiesToGl(
  entities: WeaponEntity[],
  glWeapons: GlWeapon[],
): { matched: Map<string, { entity: WeaponEntity; gl: GlWeapon }>; unmatchedEntities: WeaponEntity[]; unmatchedGl: GlWeapon[] } {
  const byName = new Map<string, GlWeapon>();
  for (const gl of glWeapons) byName.set(gl.display_name, gl);

  const matched = new Map<string, { entity: WeaponEntity; gl: GlWeapon }>();
  const unmatchedEntities: WeaponEntity[] = [];
  for (const entity of entities) {
    const gl = entity.ui_name ? byName.get(entity.ui_name) : undefined;
    if (gl) {
      matched.set(entity.id, { entity, gl });
    } else {
      unmatchedEntities.push(entity);
    }
  }

  const matchedGlNames = new Set(
    [...matched.values()].map((m) => m.gl.display_name),
  );
  const unmatchedGl = glWeapons.filter((g) => !matchedGlNames.has(g.display_name));

  return { matched, unmatchedEntities, unmatchedGl };
}

await runCliMain("weapons:build", async () => {
  const args = parseArgs(process.argv.slice(2));

  for (const dir of [WEAPONS_DIR, join(WEBSITE_STATIC, "data")]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const glWeapons = loadGlWeapons();
  const entities = loadWeaponEntities();
  const { matched, unmatchedEntities, unmatchedGl } = matchEntitiesToGl(entities, glWeapons);

  console.log(
    `Matched ${matched.size} weapons (${unmatchedEntities.length} entities w/o GL entry, ${unmatchedGl.length} GL entries w/o entity)`,
  );
  if (unmatchedEntities.length > 0) {
    console.log(
      "  entities without GL match:",
      unmatchedEntities.map((e) => e.ui_name).slice(0, 5).join(", "),
      unmatchedEntities.length > 5 ? `(+${unmatchedEntities.length - 5} more)` : "",
    );
  }

  const targets = args.only
    ? [...matched.values()].filter((m) => m.entity.id === args.only)
    : [...matched.values()];
  if (args.only && targets.length === 0) {
    throw new Error(`--only ${args.only} did not match any weapon`);
  }

  const existing: Record<string, AssetRecord> = existsSync(ASSET_MAP_PATH)
    ? JSON.parse(readFileSync(ASSET_MAP_PATH, "utf8"))
    : {};

  const results: Record<string, AssetRecord> = { ...existing };
  let scraped = 0;
  let downloaded = 0;
  let skipped = 0;
  const failures: { entity_id: string; reason: string }[] = [];

  for (const { entity, gl } of targets) {
    const entityId = entity.id;
    const existingRecord = existing[entityId];
    const existingLocal = existingRecord
      ? join(WEBSITE_STATIC, existingRecord.image_path.replace(/^\//, ""))
      : null;
    const alreadyMirrored = !args.force
      && existingRecord
      && existingLocal
      && existsSync(existingLocal)
      && statSync(existingLocal).size > 0;

    if (alreadyMirrored) {
      skipped++;
      continue;
    }

    try {
      const html = await fetchText(gl.source_url);
      scraped++;
      const heroPath = extractHeroImagePath(html);
      if (!heroPath) {
        failures.push({ entity_id: entityId, reason: "no hero image found on page" });
        await sleep(REQUEST_DELAY_MS);
        continue;
      }
      const absoluteUrl = absolutizeImageUrl(heroPath);
      const ext = extname(heroPath).toLowerCase() || ".png";
      const filename = `${entity.internal_name}${ext}`;
      const destLocal = join(WEAPONS_DIR, filename);
      const publicPath = `/weapons/${filename}`;

      await downloadImage(absoluteUrl, destLocal);
      downloaded++;

      results[entityId] = {
        entity_id: entityId,
        internal_name: entity.internal_name,
        display_name: gl.display_name,
        gl_url: gl.source_url,
        image_path: publicPath,
        scraped_at: new Date().toISOString(),
      };

      console.log(`✓ ${entity.internal_name} (${gl.display_name})`);
    } catch (error) {
      failures.push({
        entity_id: entityId,
        reason: error instanceof Error ? error.message : String(error),
      });
      console.error(`✗ ${entity.internal_name}: ${error instanceof Error ? error.message : error}`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  // Stable ordering by entity_id
  const sorted: Record<string, AssetRecord> = {};
  for (const key of Object.keys(results).sort()) sorted[key] = results[key];
  writeFileSync(ASSET_MAP_PATH, JSON.stringify(sorted, null, 2) + "\n");

  console.log(
    `\nSummary: scraped=${scraped}, downloaded=${downloaded}, skipped=${skipped}, failed=${failures.length}, total-in-map=${Object.keys(sorted).length}`,
  );
  if (failures.length > 0) {
    console.log("Failures:");
    for (const f of failures.slice(0, 10)) console.log(`  ${f.entity_id}: ${f.reason}`);
    if (failures.length > 10) console.log(`  ... and ${failures.length - 10} more`);
  }
});
