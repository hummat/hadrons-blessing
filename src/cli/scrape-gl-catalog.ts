// Scrape weapon and blessing catalog data from GamesLantern.
//
// Usage:
//   node scripts/scrape-gl-catalog.mjs
//
// Output: data/ground-truth/generated/gl-catalog.json

import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WEAPONS_URL = "https://darktide.gameslantern.com/weapons";
const PERKS_URL = "https://darktide.gameslantern.com/weapon-perks";
const BLESSINGS_URL = "https://darktide.gameslantern.com/weapon-blessing-traits";
const OUT_DIR = resolve(__dirname, "..", "..", "data", "ground-truth", "generated");
const OUT_FILE = resolve(OUT_DIR, "gl-catalog.json");
const WEAPONS_OUT_FILE = resolve(OUT_DIR, "gl-weapons.json");
const PERKS_OUT_FILE = resolve(OUT_DIR, "gl-perks.json");
const BLESSINGS_OUT_FILE = resolve(OUT_DIR, "gl-blessings.json");

// --- Pure functions (exported for testing) ---

/**
 * Parse blessing table rows into structured objects.
 * @param {Array<[string, string, string]>} rows - Each row is [name, effect, weaponTypesRaw]
 * @returns {Array<{ display_name: string, effect, weapon_types: string[] }>}
 */
function parseBlessingRows(rows: Array<[string, string, string]>) {
  const result = [];
  for (const [name, effect, weaponTypesRaw] of rows) {
    if (!name || !effect) continue;
    result.push({
      display_name: name,
      effect,
      weapon_types: weaponTypesRaw.split("\n"),
      source_url: BLESSINGS_URL,
    });
  }
  return result;
}

function parsePerkRows(rows: Array<[string, string]>) {
  return rows
    .filter(([label, slot]) => label.trim().length > 0 && /^(Melee|Ranged)$/i.test(slot.trim()))
    .map(([displayName, slot]) => ({
      display_name: displayName.trim(),
      slot: slot.trim().toLowerCase(),
      source_url: PERKS_URL,
    }));
}

function parseBlessingDetailPage(html: string, sourceUrl: string) {
  const nameMatch = html.match(/<h3[^>]*>([^<]+)<\/h3>/i);
  const effectMatch = html.match(/<p[^>]*>([^<]+)<\/p>/i);
  if (!nameMatch || !effectMatch) {
    throw new Error(`Unable to parse blessing detail page: ${sourceUrl}`);
  }

  return {
    display_name: nameMatch[1].trim(),
    effect: effectMatch[1].trim(),
    source_url: sourceUrl,
  };
}

/**
 * Strip url from GL API class objects.
 * @param {Array<{ name: string, url, unlock_level: number }>} classes
 * @returns {Array<{ name: string, unlock_level: number }>}
 */
function parseWeaponClasses(classes: AnyRecord[]) {
  return classes.map(({ name, unlock_level }) => ({ name, unlock_level }));
}

/**
 * Extract the weapon type slug from a GL weapon URL (2nd path segment after /weapons/).
 * E.g. "https://darktide.gameslantern.com/weapons/braced-autogun/agripinaa-mk-viii-braced-autogun"
 *   → "braced-autogun"
 * @param {string} url
 * @returns {string}
 */
function extractUrlSlug(url: string) {
  // pathname segments after /weapons/: ["braced-autogun", "agripinaa-mk-viii-braced-autogun"]
  const match = url.match(/\/weapons\/([^/]+)/);
  return match ? match[1] : "";
}

// --- Scraping functions ---

/**
 * Navigate to the weapons page and intercept the /api/weapons response.
 * The API requires browser cookies — returns 401 without them.
 * @param {import("playwright").Page} page
 * @returns {Promise<Array<{ gl_id: string, display_name, type: string, url_slug, classes: Array<{ name: string, unlock_level: number }> }>>}
 */
async function scrapeWeaponsApi(page: AnyRecord) {
  let resolveResponse: (value: AnyRecord) => void;
  const responsePromise = new Promise((res) => { resolveResponse = res; });

  page.on("response", async (response: AnyRecord) => {
    if (response.url().includes("/api/weapons") && response.status() === 200) {
      try {
        const json = await response.json();
        resolveResponse(json);
      } catch {
        // ignore parse errors from other intercepted requests
      }
    }
  });

  console.error(`Navigating to ${WEAPONS_URL} ...`);
  await page.goto(WEAPONS_URL, { waitUntil: "networkidle", timeout: 60_000 });

  const data = await Promise.race<AnyRecord>([
    responsePromise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout waiting for /api/weapons response")), 30_000),
    ),
  ]);

  const weapons = (data.data ?? []).map((weapon: AnyRecord) => ({
    gl_id: weapon.id ?? weapon.uuid ?? weapon._id ?? "",
    display_name: weapon.name ?? weapon.display_name ?? "",
    type: weapon.type ?? "",
    url_slug: extractUrlSlug(weapon.url ?? ""),
    source_url: weapon.url ?? WEAPONS_URL,
    classes: parseWeaponClasses(weapon.classes ?? []),
  }));

  return weapons;
}

/**
 * Navigate to the blessings page, wait for the JS-rendered table, and extract all rows.
 * @param {import("playwright").Page} page
 * @returns {Promise<Array<{ display_name: string, effect, weapon_types: string[] }>>}
 */
async function scrapeBlessingsTable(page: AnyRecord) {
  console.error(`Navigating to ${BLESSINGS_URL} ...`);
  await page.goto(BLESSINGS_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(5_000);

  // Dismiss cookie consent if present
  try {
    await page.click(".fc-confirm-choices", { timeout: 3_000 });
    await page.waitForTimeout(500);
  } catch {
    // no consent dialog
  }

  await page.waitForSelector("table", { timeout: 30_000 });

  const rows = await page.evaluate((): Array<string[]> => {
    const table = document.querySelector("table");
    if (!table) return [];
    const trs = Array.from(table.querySelectorAll("tr"));
    // skip header row
    return trs.slice(1).map((tr) => {
      const cells = Array.from(tr.querySelectorAll("td"));
      return cells.map((td) => td.innerText.trim());
    });
  });

  return parseBlessingRows(rows);
}

async function scrapePerksTable(page: AnyRecord) {
  console.error(`Navigating to ${PERKS_URL} ...`);
  await page.goto(PERKS_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("table", { timeout: 30_000 });

  const rows = await page.evaluate((): Array<string[]> => {
    const table = document.querySelector("table");
    if (!table) return [];
    return Array.from(table.querySelectorAll("tr"))
      .slice(1)
      .map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.innerText.trim()));
  });

  return parsePerkRows(rows as Array<[string, string]>);
}

// --- Main ---

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();

    const weapons = await scrapeWeaponsApi(page);
    console.error(`Scraped ${weapons.length} weapons (expected: 119)`);

    const perks = await scrapePerksTable(page);
    console.error(`Scraped ${perks.length} perks`);

    const blessings = await scrapeBlessingsTable(page);
    console.error(`Scraped ${blessings.length} blessings (expected: ~193)`);

    const catalog = {
      scraped_at: new Date().toISOString(),
      source: "darktide.gameslantern.com",
      weapons,
      perks,
      blessings,
    };

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT_FILE, JSON.stringify(catalog, null, 2), "utf8");
    writeFileSync(WEAPONS_OUT_FILE, JSON.stringify(weapons, null, 2) + "\n", "utf8");
    writeFileSync(PERKS_OUT_FILE, JSON.stringify(perks, null, 2) + "\n", "utf8");
    writeFileSync(BLESSINGS_OUT_FILE, JSON.stringify(blessings, null, 2) + "\n", "utf8");
    console.error(`Written to ${OUT_FILE}`);
  } finally {
    await browser.close();
  }
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();

export {
  parseBlessingRows,
  parsePerkRows,
  parseBlessingDetailPage,
  parseWeaponClasses,
  extractUrlSlug,
};
