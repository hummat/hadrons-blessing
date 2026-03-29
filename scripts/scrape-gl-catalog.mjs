#!/usr/bin/env node
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WEAPONS_URL = "https://darktide.gameslantern.com/weapons";
const BLESSINGS_URL = "https://darktide.gameslantern.com/weapon-blessing-traits";
const OUT_DIR = resolve(__dirname, "..", "data", "ground-truth", "generated");
const OUT_FILE = resolve(OUT_DIR, "gl-catalog.json");

// --- Pure functions (exported for testing) ---

/**
 * Parse blessing table rows into structured objects.
 * @param {Array<[string, string, string]>} rows - Each row is [name, effect, weaponTypesRaw]
 * @returns {Array<{ display_name: string, effect: string, weapon_types: string[] }>}
 */
function parseBlessingRows(rows) {
  const result = [];
  for (const [name, effect, weaponTypesRaw] of rows) {
    if (!name || !effect) continue;
    result.push({
      display_name: name,
      effect,
      weapon_types: weaponTypesRaw.split("\n"),
    });
  }
  return result;
}

/**
 * Strip url from GL API class objects.
 * @param {Array<{ name: string, url: string, unlock_level: number }>} classes
 * @returns {Array<{ name: string, unlock_level: number }>}
 */
function parseWeaponClasses(classes) {
  return classes.map(({ name, unlock_level }) => ({ name, unlock_level }));
}

/**
 * Extract the weapon type slug from a GL weapon URL (2nd path segment after /weapons/).
 * E.g. "https://darktide.gameslantern.com/weapons/braced-autogun/agripinaa-mk-viii-braced-autogun"
 *   → "braced-autogun"
 * @param {string} url
 * @returns {string}
 */
function extractUrlSlug(url) {
  // pathname segments after /weapons/: ["braced-autogun", "agripinaa-mk-viii-braced-autogun"]
  const match = url.match(/\/weapons\/([^/]+)/);
  return match ? match[1] : "";
}

// --- Scraping functions ---

/**
 * Navigate to the weapons page and intercept the /api/weapons response.
 * The API requires browser cookies — returns 401 without them.
 * @param {import("playwright").Page} page
 * @returns {Promise<Array<{ gl_id: string, display_name: string, type: string, url_slug: string, classes: Array<{ name: string, unlock_level: number }> }>>}
 */
async function scrapeWeaponsApi(page) {
  let resolveResponse;
  const responsePromise = new Promise((res) => { resolveResponse = res; });

  page.on("response", async (response) => {
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

  const data = await Promise.race([
    responsePromise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout waiting for /api/weapons response")), 30_000),
    ),
  ]);

  const weapons = (data.data ?? []).map((weapon) => ({
    gl_id: weapon.id ?? weapon.uuid ?? weapon._id ?? "",
    display_name: weapon.name ?? weapon.display_name ?? "",
    type: weapon.type ?? "",
    url_slug: extractUrlSlug(weapon.url ?? ""),
    classes: parseWeaponClasses(weapon.classes ?? []),
  }));

  return weapons;
}

/**
 * Navigate to the blessings page, wait for the JS-rendered table, and extract all rows.
 * @param {import("playwright").Page} page
 * @returns {Promise<Array<{ display_name: string, effect: string, weapon_types: string[] }>>}
 */
async function scrapeBlessingsTable(page) {
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

  const rows = await page.evaluate(() => {
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

// --- Main ---

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();

    const weapons = await scrapeWeaponsApi(page);
    console.error(`Scraped ${weapons.length} weapons (expected: 119)`);

    const blessings = await scrapeBlessingsTable(page);
    console.error(`Scraped ${blessings.length} blessings (expected: ~193)`);

    const catalog = {
      scraped_at: new Date().toISOString(),
      source: "darktide.gameslantern.com",
      weapons,
      blessings,
    };

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT_FILE, JSON.stringify(catalog, null, 2), "utf8");
    console.error(`Written to ${OUT_FILE}`);
  } finally {
    await browser.close();
  }
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();

export { parseBlessingRows, parseWeaponClasses, extractUrlSlug };
