# GL Catalog Scrape & Entity Name Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete #14 by scraping GL weapon/blessing display names, mapping them to internal entities, enriching all weapon + name_family `ui_name` fields, generating weapon aliases, and fixing malformed slug IDs.

**Architecture:** GL catalog data is scraped via Playwright (weapons API + blessings DOM table) and cached as `gl-catalog.json`. A curated mapping file bridges GL display names to internal template IDs. The existing `enrich-entity-names.mjs` is extended with new enrichment functions. Malformed `bespoke_bespoke_` IDs are fixed by a standalone rename script.

**Tech Stack:** Node.js (ESM), Playwright, `node --test`

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/scrape-gl-catalog.mjs` | New: scrape GL weapons API + blessings DOM → `gl-catalog.json` |
| `scripts/scrape-gl-catalog.test.mjs` | New: unit tests for scraper parsing/normalization |
| `scripts/generate-weapon-name-mapping.mjs` | New: auto-populate `weapon-name-mapping.json` from known sources |
| `scripts/generate-weapon-name-mapping.test.mjs` | New: unit tests for mapping logic |
| `scripts/fix-malformed-slugs.mjs` | New: rename `bespoke_bespoke_` → `bespoke_` in entities + edges |
| `scripts/fix-malformed-slugs.test.mjs` | New: unit tests for slug fix |
| `scripts/enrich-entity-names.mjs` | Extended: weapon ui_name/aliases + blessing name_family ui_name |
| `scripts/enrich-entity-names.test.mjs` | Extended: tests for new enrichment functions |
| `data/ground-truth/generated/gl-catalog.json` | Generated: GL scrape output (gitignored) |
| `data/ground-truth/weapon-name-mapping.json` | Curated: GL display name → internal template ID |

---

### Task 1: Malformed Slug Fix

**Files:**
- Create: `scripts/fix-malformed-slugs.mjs`
- Create: `scripts/fix-malformed-slugs.test.mjs`
- Modify: `package.json` (add npm script + test registration)

This task is independent of all others — fixes the 4 entities and 12 edges with doubled `bespoke_bespoke_` prefix.

- [ ] **Step 1: Write failing tests for slug fix**

Create `scripts/fix-malformed-slugs.test.mjs`:

```js
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { fixMalformedSlugs } from "./fix-malformed-slugs.mjs";

describe("fixMalformedSlugs", () => {
  it("renames bespoke_bespoke_ to bespoke_ in entity IDs", () => {
    const entities = [
      { id: "shared.weapon_trait.weapon_trait_bespoke_bespoke_powersword_2h_p1_block", kind: "weapon_trait", internal_name: "weapon_trait_bespoke_bespoke_powersword_2h_p1_block" },
      { id: "shared.weapon_trait.weapon_trait_bespoke_chainsword_p1_crit", kind: "weapon_trait", internal_name: "weapon_trait_bespoke_chainsword_p1_crit" },
    ];
    const edges = [];
    const result = fixMalformedSlugs(entities, edges);
    assert.equal(result.entitiesFixed, 1);
    assert.equal(entities[0].id, "shared.weapon_trait.weapon_trait_bespoke_powersword_2h_p1_block");
    assert.equal(entities[0].internal_name, "weapon_trait_bespoke_powersword_2h_p1_block");
    assert.equal(entities[1].id, "shared.weapon_trait.weapon_trait_bespoke_chainsword_p1_crit");
  });

  it("renames bespoke_bespoke_ in edge from_entity_id and to_entity_id", () => {
    const entities = [];
    const edges = [
      { id: "shared.edge.weapon_has_trait_pool.x.weapon_trait_bespoke_bespoke_powersword_2h_p1_block", type: "weapon_has_trait_pool", from_entity_id: "shared.weapon.powersword_2h_p1_m1", to_entity_id: "shared.weapon_trait.weapon_trait_bespoke_bespoke_powersword_2h_p1_block" },
    ];
    const result = fixMalformedSlugs(entities, edges);
    assert.equal(result.edgesFixed, 1);
    assert.equal(edges[0].id, "shared.edge.weapon_has_trait_pool.x.weapon_trait_bespoke_powersword_2h_p1_block");
    assert.equal(edges[0].to_entity_id, "shared.weapon_trait.weapon_trait_bespoke_powersword_2h_p1_block");
    assert.equal(edges[0].from_entity_id, "shared.weapon.powersword_2h_p1_m1");
  });

  it("aborts if fixed ID collides with existing entity", () => {
    const entities = [
      { id: "shared.weapon_trait.weapon_trait_bespoke_bespoke_powersword_2h_p1_block", kind: "weapon_trait", internal_name: "weapon_trait_bespoke_bespoke_powersword_2h_p1_block" },
      { id: "shared.weapon_trait.weapon_trait_bespoke_powersword_2h_p1_block", kind: "weapon_trait", internal_name: "weapon_trait_bespoke_powersword_2h_p1_block" },
    ];
    assert.throws(() => fixMalformedSlugs(entities, []), /collision/i);
  });

  it("is idempotent — no-ops when no bespoke_bespoke_ found", () => {
    const entities = [
      { id: "shared.weapon_trait.weapon_trait_bespoke_powersword_2h_p1_block", kind: "weapon_trait", internal_name: "weapon_trait_bespoke_powersword_2h_p1_block" },
    ];
    const result = fixMalformedSlugs(entities, []);
    assert.equal(result.entitiesFixed, 0);
    assert.equal(result.edgesFixed, 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/fix-malformed-slugs.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement fixMalformedSlugs**

Create `scripts/fix-malformed-slugs.mjs`:

```js
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BAD = "bespoke_bespoke_";
const GOOD = "bespoke_";

function fixMalformedSlugs(entities, edges) {
  // Check for collisions first
  const existingIds = new Set(entities.map((e) => e.id));
  for (const entity of entities) {
    if (!entity.id.includes(BAD)) continue;
    const fixedId = entity.id.replaceAll(BAD, GOOD);
    if (existingIds.has(fixedId)) {
      throw new Error(`Collision: renaming ${entity.id} would collide with existing ${fixedId}`);
    }
  }

  let entitiesFixed = 0;
  for (const entity of entities) {
    if (!entity.id.includes(BAD)) continue;
    entity.id = entity.id.replaceAll(BAD, GOOD);
    entity.internal_name = entity.internal_name.replaceAll(BAD, GOOD);
    entitiesFixed++;
  }

  let edgesFixed = 0;
  for (const edge of edges) {
    let fixed = false;
    if (edge.id.includes(BAD)) { edge.id = edge.id.replaceAll(BAD, GOOD); fixed = true; }
    if (edge.from_entity_id.includes(BAD)) { edge.from_entity_id = edge.from_entity_id.replaceAll(BAD, GOOD); fixed = true; }
    if (edge.to_entity_id.includes(BAD)) { edge.to_entity_id = edge.to_entity_id.replaceAll(BAD, GOOD); fixed = true; }
    if (fixed) edgesFixed++;
  }

  return { entitiesFixed, edgesFixed };
}

function main() {
  const DATA_ROOT = resolve(__dirname, "..", "data", "ground-truth");
  const weaponsPath = resolve(DATA_ROOT, "entities", "shared-weapons.json");
  const edgesPath = resolve(DATA_ROOT, "edges", "shared.json");

  const entities = JSON.parse(readFileSync(weaponsPath, "utf8"));
  const edges = JSON.parse(readFileSync(edgesPath, "utf8"));

  const result = fixMalformedSlugs(entities, edges);

  if (result.entitiesFixed === 0 && result.edgesFixed === 0) {
    console.log("No malformed slugs found — already clean.");
    return;
  }

  writeFileSync(weaponsPath, JSON.stringify(entities, null, 2) + "\n");
  writeFileSync(edgesPath, JSON.stringify(edges, null, 2) + "\n");
  console.log(`Fixed ${result.entitiesFixed} entities, ${result.edgesFixed} edges`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();

export { fixMalformedSlugs };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/fix-malformed-slugs.test.mjs`
Expected: 4 tests PASS

- [ ] **Step 5: Register npm scripts and test**

Add to `package.json` `"scripts"`:
- `"entities:fix-slugs": "node scripts/fix-malformed-slugs.mjs"`
- Add `scripts/fix-malformed-slugs.test.mjs` to the `"test"` script list

- [ ] **Step 6: Run slug fix on real data**

Run: `npm run entities:fix-slugs`
Expected: `Fixed 4 entities, 12 edges`

Verify: `grep -r bespoke_bespoke_ data/ground-truth/` should return no results.

- [ ] **Step 7: Run full test suite**

Run: `npm test`
Expected: All tests pass. Some snapshot tests may need updating if they reference the old IDs.

If snapshot tests fail, update them:
- Check if any frozen fixture files reference `bespoke_bespoke_` and update accordingly
- Re-run `npm test` to confirm

- [ ] **Step 8: Commit**

```bash
git add scripts/fix-malformed-slugs.mjs scripts/fix-malformed-slugs.test.mjs package.json data/ground-truth/entities/shared-weapons.json data/ground-truth/edges/shared.json
git commit -m "fix: rename bespoke_bespoke_ to bespoke_ in 4 entities + 12 edges"
```

---

### Task 2: GL Catalog Scraper

**Files:**
- Create: `scripts/scrape-gl-catalog.mjs`
- Create: `scripts/scrape-gl-catalog.test.mjs`
- Modify: `package.json` (add `gl:scrape` script + test registration)

- [ ] **Step 1: Write failing tests for blessing table parsing**

The scraper has two parts: the weapons API (trivial JSON capture) and the blessings DOM table (needs parsing logic). Test the parsing.

Create `scripts/scrape-gl-catalog.test.mjs`:

```js
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { parseBlessingRows, parseWeaponClasses } from "./scrape-gl-catalog.mjs";

describe("parseBlessingRows", () => {
  it("parses a blessing row into name, effect, and weapon_types", () => {
    const rows = [
      ["Bloodthirsty", "+100% Critical Chance on your next Melee Attack after Special Attack Kill.", "Assault Chainsword\nBlaze Force Sword"],
    ];
    const blessings = parseBlessingRows(rows);
    assert.equal(blessings.length, 1);
    assert.equal(blessings[0].display_name, "Bloodthirsty");
    assert.equal(blessings[0].effect, "+100% Critical Chance on your next Melee Attack after Special Attack Kill.");
    assert.deepEqual(blessings[0].weapon_types, ["Assault Chainsword", "Blaze Force Sword"]);
  });

  it("handles multiple blessings with same name (different weapon types)", () => {
    const rows = [
      ["Blaze Away", "+8% Strength for every 10%...", "Heavy Stubber\nPurgation Flamer"],
      ["Blaze Away", "+8% Strength for every shot...", "Grenadier Gauntlet\nPlasma Gun"],
    ];
    const blessings = parseBlessingRows(rows);
    assert.equal(blessings.length, 2);
    assert.equal(blessings[0].display_name, "Blaze Away");
    assert.equal(blessings[1].display_name, "Blaze Away");
  });

  it("skips rows with missing data", () => {
    const rows = [["", "", ""]];
    const blessings = parseBlessingRows(rows);
    assert.equal(blessings.length, 0);
  });
});

describe("parseWeaponClasses", () => {
  it("parses API classes array into normalized form", () => {
    const classes = [
      { name: "Veteran", url: "...", unlock_level: 7 },
      { name: "Hive Scum", url: "...", unlock_level: 5 },
    ];
    const result = parseWeaponClasses(classes);
    assert.deepEqual(result, [
      { name: "Veteran", unlock_level: 7 },
      { name: "Hive Scum", unlock_level: 5 },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/scrape-gl-catalog.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement scraper with exported parse functions**

Create `scripts/scrape-gl-catalog.mjs`:

```js
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseBlessingRows(rows) {
  const blessings = [];
  for (const [name, effect, weaponTypesRaw] of rows) {
    if (!name || !effect) continue;
    const weapon_types = weaponTypesRaw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    blessings.push({ display_name: name, effect, weapon_types });
  }
  return blessings;
}

function parseWeaponClasses(classes) {
  return classes.map((c) => ({ name: c.name, unlock_level: c.unlock_level }));
}

function extractUrlSlug(url) {
  try {
    return new URL(url).pathname.split("/")[2] || "";
  } catch {
    return "";
  }
}

async function scrapeWeaponsApi(page) {
  let weaponData = null;
  const handler = async (response) => {
    if (response.url().includes("/api/weapons")) {
      try { weaponData = await response.json(); } catch { /* ignore */ }
    }
  };
  page.on("response", handler);

  await page.goto("https://darktide.gameslantern.com/weapons", {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  page.off("response", handler);

  if (!weaponData?.data) {
    throw new Error("Failed to capture /api/weapons response");
  }

  return weaponData.data.map((w) => ({
    gl_id: w.id,
    display_name: w.name,
    type: w.type,
    url_slug: extractUrlSlug(w.url),
    classes: parseWeaponClasses(w.classes),
  }));
}

async function scrapeBlessingsTable(page) {
  await page.goto("https://darktide.gameslantern.com/weapon-blessing-traits", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForTimeout(5_000);

  // Dismiss cookie consent if present
  try {
    await page.click(".fc-confirm-choices", { timeout: 3_000 });
    await page.waitForTimeout(500);
  } catch { /* no consent dialog */ }

  // Wait for table to render
  await page.waitForSelector("table", { timeout: 10_000 });

  const rows = await page.evaluate(() => {
    const table = document.querySelector("table");
    if (!table) return [];
    return [...table.querySelectorAll("tr")]
      .slice(1) // skip header
      .map((row) => [...row.querySelectorAll("td")].map((td) => td.innerText.trim()));
  });

  return parseBlessingRows(rows);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();

    console.error("Scraping GL weapons API...");
    const weapons = await scrapeWeaponsApi(page);
    console.error(`  ${weapons.length} weapons captured`);

    console.error("Scraping GL blessings table...");
    const blessings = await scrapeBlessingsTable(page);
    console.error(`  ${blessings.length} blessings captured`);

    const catalog = {
      scraped_at: new Date().toISOString(),
      source: "darktide.gameslantern.com",
      weapons,
      blessings,
    };

    const outPath = resolve(__dirname, "..", "data", "ground-truth", "generated", "gl-catalog.json");
    writeFileSync(outPath, JSON.stringify(catalog, null, 2) + "\n");
    console.error(`Written to ${outPath}`);
  } finally {
    await browser.close();
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();

export { parseBlessingRows, parseWeaponClasses, extractUrlSlug };
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `node --test scripts/scrape-gl-catalog.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Register npm scripts**

Add to `package.json`:
- `"gl:scrape": "node scripts/scrape-gl-catalog.mjs"`
- Add `scripts/scrape-gl-catalog.test.mjs` to the `"test"` script list

- [ ] **Step 6: Run the scraper live**

Run: `npm run gl:scrape`
Expected: Outputs `data/ground-truth/generated/gl-catalog.json` with 119 weapons and ~193 blessings. Verify the file exists and has sensible content.

Add `gl-catalog.json` to `.gitignore` (it's a generated artifact from an external source — regenerated on demand, not versioned).

- [ ] **Step 7: Commit**

```bash
git add scripts/scrape-gl-catalog.mjs scripts/scrape-gl-catalog.test.mjs package.json .gitignore
git commit -m "feat: add GL catalog scraper for weapon + blessing display names"
```

---

### Task 3: Weapon Name Mapping Generator

**Files:**
- Create: `scripts/generate-weapon-name-mapping.mjs`
- Create: `scripts/generate-weapon-name-mapping.test.mjs`
- Create: `data/ground-truth/weapon-name-mapping.json`
- Modify: `package.json` (add npm script + test registration)

This script auto-populates the mapping from known sources and reports gaps for manual curation.

- [ ] **Step 1: Write failing tests for mapping logic**

Create `scripts/generate-weapon-name-mapping.test.mjs`:

```js
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildSlugToFamilyMap,
  matchSingletonFamilies,
  matchByKnownAliases,
  deduceLastRemaining,
} from "./generate-weapon-name-mapping.mjs";

describe("buildSlugToFamilyMap", () => {
  it("maps GL URL slug to internal family using known mappings", () => {
    const knownMap = [
      { gl_name: "Agripinaa Mk VIII Braced Autogun", template_id: "autogun_p2_m1" },
    ];
    const glWeapons = [
      { display_name: "Agripinaa Mk VIII Braced Autogun", url_slug: "braced-autogun" },
    ];
    const familyMarks = { autogun_p2: ["autogun_p2_m1", "autogun_p2_m2", "autogun_p2_m3"] };
    const result = buildSlugToFamilyMap(knownMap, glWeapons, familyMarks);
    assert.equal(result.get("braced-autogun"), "autogun_p2");
  });
});

describe("matchSingletonFamilies", () => {
  it("maps GL weapons in singleton families automatically", () => {
    const slugToFamily = new Map([["plasma-gun", "plasmagun_p1"]]);
    const familyMarks = { plasmagun_p1: ["plasmagun_p1_m1"] };
    const glWeapons = [
      { display_name: "M35 Magnacore Mk II Plasma Gun", url_slug: "plasma-gun" },
    ];
    const existing = new Map();
    const result = matchSingletonFamilies(slugToFamily, familyMarks, glWeapons, existing);
    assert.equal(result.length, 1);
    assert.equal(result[0].gl_name, "M35 Magnacore Mk II Plasma Gun");
    assert.equal(result[0].template_id, "plasmagun_p1_m1");
    assert.equal(result[0].source, "singleton_family");
  });
});

describe("matchByKnownAliases", () => {
  it("creates mapping entries from existing weapon aliases", () => {
    const aliases = [
      { text: "Agripinaa Mk VIII Braced Autogun", candidate_entity_id: "shared.weapon.autogun_p2_m1" },
    ];
    const glWeapons = [
      { display_name: "Agripinaa Mk VIII Braced Autogun", url_slug: "braced-autogun" },
    ];
    const result = matchByKnownAliases(aliases, glWeapons);
    assert.equal(result.length, 1);
    assert.equal(result[0].template_id, "autogun_p2_m1");
    assert.equal(result[0].source, "existing_alias");
  });

  it("skips aliases not found in GL catalog", () => {
    const aliases = [
      { text: "Some Deleted Weapon", candidate_entity_id: "shared.weapon.deleted_p1_m1" },
    ];
    const result = matchByKnownAliases(aliases, []);
    assert.equal(result.length, 0);
  });
});

describe("deduceLastRemaining", () => {
  it("auto-matches when one mark and one GL weapon remain in a family", () => {
    const slugToFamily = new Map([["braced-autogun", "autogun_p2"]]);
    const familyMarks = { autogun_p2: ["autogun_p2_m1", "autogun_p2_m2"] };
    const glWeapons = [
      { display_name: "Agripinaa Mk VIII Braced Autogun", url_slug: "braced-autogun" },
      { display_name: "Graia Mk IV Braced Autogun", url_slug: "braced-autogun" },
    ];
    const alreadyMapped = new Map([["autogun_p2_m1", "Agripinaa Mk VIII Braced Autogun"]]);
    const result = deduceLastRemaining(slugToFamily, familyMarks, glWeapons, alreadyMapped);
    assert.equal(result.length, 1);
    assert.equal(result[0].gl_name, "Graia Mk IV Braced Autogun");
    assert.equal(result[0].template_id, "autogun_p2_m2");
    assert.equal(result[0].source, "last_remaining");
  });

  it("does not match when more than one remain", () => {
    const slugToFamily = new Map([["braced-autogun", "autogun_p2"]]);
    const familyMarks = { autogun_p2: ["autogun_p2_m1", "autogun_p2_m2", "autogun_p2_m3"] };
    const glWeapons = [
      { display_name: "A", url_slug: "braced-autogun" },
      { display_name: "B", url_slug: "braced-autogun" },
      { display_name: "C", url_slug: "braced-autogun" },
    ];
    const alreadyMapped = new Map([["autogun_p2_m1", "A"]]);
    const result = deduceLastRemaining(slugToFamily, familyMarks, glWeapons, alreadyMapped);
    assert.equal(result.length, 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/generate-weapon-name-mapping.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement mapping generator**

Create `scripts/generate-weapon-name-mapping.mjs`. Core logic:

1. `matchByKnownAliases(aliases, glWeapons)` — match existing weapon aliases from `shared-guides.json` to GL weapons by display name
2. `buildSlugToFamilyMap(knownMap, glWeapons, familyMarks)` — derive GL URL slug → internal family from known mappings
3. `matchSingletonFamilies(slugToFamily, familyMarks, glWeapons, alreadyMapped)` — for families with exactly 1 mark and 1 GL weapon in that slug, auto-match
4. `deduceLastRemaining(slugToFamily, familyMarks, glWeapons, alreadyMapped)` — for families where all but 1 mark is mapped, match the last one
5. `main()` — orchestrate: read inputs, run matching passes, merge with existing `weapon-name-mapping.json` (preserving `manual` entries), write output, report gaps

The `main()` function should:
- Read `data/ground-truth/generated/gl-catalog.json` for GL weapons
- Read `data/ground-truth/aliases/shared-guides.json` for existing aliases
- Read `data/ground-truth/entities/shared-weapons.json` for internal weapon list
- Read existing `data/ground-truth/weapon-name-mapping.json` if it exists (preserve `manual` entries)
- Run the 4 matching passes in order
- Write the merged mapping to `data/ground-truth/weapon-name-mapping.json`
- Print a report: matched count, gap count, list of unmatched GL weapons

Also include additional known mappings from the DarktideRenameRevert mod as a hardcoded lookup (27 entries — `{ templateId: glName }` pairs extracted from the mod's Lua comments). Include these as a `RENAME_REVERT_MAP` constant.

Also include a hardcoded `SLUG_TO_FAMILY_OVERRIDES` map for GL type slugs that can't be automatically derived (e.g., `"bully-club" → "ogryn_club_p1"`, `"heavy-laspistol" → "laspistol_p1"`, etc.). Populate from the research data gathered during design. There are ~15-20 slug → family mappings that can't be auto-derived because no existing alias covers that family.

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `node --test scripts/generate-weapon-name-mapping.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Register npm scripts**

Add to `package.json`:
- `"entities:gen-mapping": "node scripts/generate-weapon-name-mapping.mjs"`
- Add `scripts/generate-weapon-name-mapping.test.mjs` to the `"test"` script list

- [ ] **Step 6: Run mapping generator**

Run: `npm run entities:gen-mapping`
Expected: Creates `data/ground-truth/weapon-name-mapping.json` with ~90-100 auto-populated entries. Reports ~20-30 gaps.

- [ ] **Step 7: Manual curation of remaining gaps**

For each gap reported by the generator, research the correct mapping using:
- Community wikis (Fandom, Steam guides)
- GL weapon page descriptions (lore text can sometimes identify the variant)
- Process of elimination within families

Edit `data/ground-truth/weapon-name-mapping.json` directly, setting `"source": "manual"` for hand-curated entries.

Run `npm run entities:gen-mapping` again to verify no gaps remain (auto-populated entries are re-derived, `manual` entries preserved).

- [ ] **Step 8: Commit**

```bash
git add scripts/generate-weapon-name-mapping.mjs scripts/generate-weapon-name-mapping.test.mjs data/ground-truth/weapon-name-mapping.json package.json
git commit -m "feat: add weapon name mapping generator — 119 GL weapons mapped to internal IDs"
```

---

### Task 4: Weapon Enrichment (ui_name + aliases)

**Files:**
- Modify: `scripts/enrich-entity-names.mjs` (add weapon enrichment functions)
- Modify: `scripts/enrich-entity-names.test.mjs` (add weapon enrichment tests)

- [ ] **Step 1: Write failing tests for weapon enrichment**

Add to `scripts/enrich-entity-names.test.mjs`:

```js
import { enrichWeaponNames, generateWeaponAliases } from "./enrich-entity-names.mjs";

describe("enrichWeaponNames", () => {
  it("sets ui_name on weapon entities from mapping", () => {
    const entities = [
      { id: "shared.weapon.autogun_p2_m1", kind: "weapon", internal_name: "autogun_p2_m1", ui_name: null, attributes: { slot: "ranged" } },
      { id: "shared.weapon.bot_autogun", kind: "weapon", internal_name: "bot_autogun", ui_name: null, attributes: { slot: "ranged" } },
    ];
    const mapping = [
      { gl_name: "Agripinaa Mk VIII Braced Autogun", template_id: "autogun_p2_m1", source: "existing_alias" },
    ];
    const count = enrichWeaponNames(entities, mapping);
    assert.equal(count, 1);
    assert.equal(entities[0].ui_name, "Agripinaa Mk VIII Braced Autogun");
    assert.equal(entities[1].ui_name, null);
  });

  it("preserves existing ui_name values", () => {
    const entities = [
      { id: "shared.weapon.autogun_p2_m1", kind: "weapon", internal_name: "autogun_p2_m1", ui_name: "Already Set", attributes: { slot: "ranged" } },
    ];
    const mapping = [
      { gl_name: "Different Name", template_id: "autogun_p2_m1", source: "manual" },
    ];
    const count = enrichWeaponNames(entities, mapping);
    assert.equal(count, 0);
    assert.equal(entities[0].ui_name, "Already Set");
  });
});

describe("generateWeaponAliases", () => {
  it("generates alias record for mapped weapon", () => {
    const mapping = [
      { gl_name: "Agripinaa Mk VIII Braced Autogun", template_id: "autogun_p2_m1", source: "existing_alias" },
    ];
    const entities = [
      { id: "shared.weapon.autogun_p2_m1", kind: "weapon", internal_name: "autogun_p2_m1", attributes: { slot: "ranged" } },
    ];
    const aliases = generateWeaponAliases(mapping, entities);
    assert.equal(aliases.length, 1);
    assert.equal(aliases[0].text, "Agripinaa Mk VIII Braced Autogun");
    assert.equal(aliases[0].candidate_entity_id, "shared.weapon.autogun_p2_m1");
    assert.equal(aliases[0].alias_kind, "gameslantern_name");
    assert.equal(aliases[0].match_mode, "fuzzy_allowed");
    assert.equal(aliases[0].provenance, "gl-catalog");
    assert.deepEqual(aliases[0].context_constraints.require_all, [{ key: "slot", value: "ranged" }]);
  });

  it("uses melee slot constraint for melee weapons", () => {
    const mapping = [
      { gl_name: "Rashad Mk III Combat Axe", template_id: "combataxe_p1_m1", source: "manual" },
    ];
    const entities = [
      { id: "shared.weapon.combataxe_p1_m1", kind: "weapon", internal_name: "combataxe_p1_m1", attributes: { slot: "melee" } },
    ];
    const aliases = generateWeaponAliases(mapping, entities);
    assert.deepEqual(aliases[0].context_constraints.require_all, [{ key: "slot", value: "melee" }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/enrich-entity-names.test.mjs`
Expected: FAIL — `enrichWeaponNames` and `generateWeaponAliases` not exported

- [ ] **Step 3: Implement weapon enrichment functions**

Add to `scripts/enrich-entity-names.mjs`:

```js
function enrichWeaponNames(entities, mapping) {
  const templateToName = new Map(mapping.map((m) => [m.template_id, m.gl_name]));
  let count = 0;
  for (const entity of entities) {
    if (entity.kind !== "weapon") continue;
    if (entity.ui_name != null) continue;
    const displayName = templateToName.get(entity.internal_name);
    if (!displayName) continue;
    entity.ui_name = displayName;
    count++;
  }
  return count;
}

function generateWeaponAliases(mapping, entities) {
  const entityMap = new Map(entities.filter((e) => e.kind === "weapon").map((e) => [e.internal_name, e]));
  const aliases = [];
  for (const { gl_name, template_id } of mapping) {
    const entity = entityMap.get(template_id);
    if (!entity) continue;
    const slot = entity.attributes?.slot;
    if (!slot) continue;
    aliases.push({
      text: gl_name,
      normalized_text: normalizeText(gl_name),
      candidate_entity_id: entity.id,
      alias_kind: "gameslantern_name",
      match_mode: "fuzzy_allowed",
      provenance: "gl-catalog",
      confidence: "high",
      context_constraints: {
        require_all: [{ key: "slot", value: slot }],
        prefer: [],
      },
      rank_weight: 120,
      notes: "",
    });
  }
  return aliases;
}
```

Add both to the `export { ... }` block. Update `main()` to:
1. Read `data/ground-truth/weapon-name-mapping.json`
2. Call `enrichWeaponNames(weaponEntities, mapping)`
3. Call `generateWeaponAliases(mapping, weaponEntities)`
4. Merge weapon aliases with the existing alias merge logic
5. Log weapon enrichment stats

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/enrich-entity-names.test.mjs`
Expected: All tests PASS (including new ones)

- [ ] **Step 5: Run enrichment on real data**

Run: `npm run entities:enrich`
Expected: Prints weapon enrichment stats alongside existing perk/gadget/blessing stats. ~90-119 weapon `ui_name` values set, ~90-119 weapon aliases generated.

- [ ] **Step 6: Commit**

```bash
git add scripts/enrich-entity-names.mjs scripts/enrich-entity-names.test.mjs data/ground-truth/entities/shared-weapons.json data/ground-truth/aliases/shared-guides.json
git commit -m "feat: enrich weapon entities with GL display names and generate weapon aliases"
```

---

### Task 5: Blessing Name Family Enrichment

**Files:**
- Modify: `scripts/enrich-entity-names.mjs` (add blessing enrichment from GL + community names)
- Modify: `scripts/enrich-entity-names.test.mjs` (add blessing enrichment tests)

Two strategies:
1. **Community-named families** (53): title-case the slug suffix (e.g., `bloodthirsty` → `"Bloodthirsty"`, `blaze_away` → `"Blaze Away"`)
2. **Concept-slug families** (110): match by GL blessing weapon-type fingerprint

- [ ] **Step 1: Write failing tests for blessing enrichment**

Add to `scripts/enrich-entity-names.test.mjs`:

```js
import { enrichBlessingNamesFromSlugs, enrichBlessingNamesFromGL } from "./enrich-entity-names.mjs";

describe("enrichBlessingNamesFromSlugs", () => {
  it("title-cases community-named slug as ui_name", () => {
    const entities = [
      { id: "shared.name_family.blessing.bloodthirsty", kind: "name_family", ui_name: null },
      { id: "shared.name_family.blessing.blaze_away", kind: "name_family", ui_name: null },
      { id: "shared.name_family.blessing.brutal_momentum", kind: "name_family", ui_name: null },
    ];
    const glBlessings = [
      { display_name: "Bloodthirsty", effect: "...", weapon_types: [] },
      { display_name: "Blaze Away", effect: "...", weapon_types: [] },
      { display_name: "Brutal Momentum", effect: "...", weapon_types: [] },
    ];
    const count = enrichBlessingNamesFromSlugs(entities, glBlessings);
    assert.equal(count, 3);
    assert.equal(entities[0].ui_name, "Bloodthirsty");
    assert.equal(entities[1].ui_name, "Blaze Away");
    assert.equal(entities[2].ui_name, "Brutal Momentum");
  });

  it("skips concept-slug families with no GL match", () => {
    const entities = [
      { id: "shared.name_family.blessing.consecutive_hits_increases_close_damage", kind: "name_family", ui_name: null },
    ];
    const glBlessings = [];
    const count = enrichBlessingNamesFromSlugs(entities, glBlessings);
    assert.equal(count, 0);
  });

  it("preserves existing ui_name", () => {
    const entities = [
      { id: "shared.name_family.blessing.bloodthirsty", kind: "name_family", ui_name: "Already Set" },
    ];
    const glBlessings = [
      { display_name: "Bloodthirsty", effect: "...", weapon_types: [] },
    ];
    const count = enrichBlessingNamesFromSlugs(entities, glBlessings);
    assert.equal(count, 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/enrich-entity-names.test.mjs`
Expected: FAIL — `enrichBlessingNamesFromSlugs` not exported

- [ ] **Step 3: Implement blessing enrichment**

Add to `scripts/enrich-entity-names.mjs`:

```js
function slugToTitleCase(slug) {
  return slug
    .split("_")
    .map((word, i) => {
      if (i > 0 && ["a", "an", "and", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "vs"].includes(word)) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function enrichBlessingNamesFromSlugs(entities, glBlessings) {
  // Build a set of normalized GL blessing names for matching
  const glNameSet = new Set(glBlessings.map((b) => b.display_name.toLowerCase()));

  let count = 0;
  for (const entity of entities) {
    if (entity.kind !== "name_family") continue;
    if (entity.ui_name != null) continue;
    if (!entity.id.startsWith(NAME_FAMILY_PREFIX)) continue;

    const slug = entity.id.slice(NAME_FAMILY_PREFIX.length);
    const candidate = slugToTitleCase(slug);

    // Only set if the candidate matches a GL blessing name (confirms it's a real community name)
    if (glNameSet.has(candidate.toLowerCase())) {
      entity.ui_name = candidate;
      count++;
    }
  }
  return count;
}
```

Add to exports. Update `main()` to:
1. Read `gl-catalog.json` blessings (if file exists — skip gracefully if not)
2. Call `enrichBlessingNamesFromSlugs(nameEntities, glBlessings)` after the existing `enrichNameFamilies()` call
3. Log blessing enrichment stats

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/enrich-entity-names.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Run enrichment on real data**

Run: `npm run entities:enrich`
Expected: Reports ~40-50 additional name_family `ui_name` values set via slug matching (on top of the 9 from the hardcoded `BLESSING_NAMES` map). Total `ui_name` coverage should reach ~50-60 of 163 name_families from this pass alone.

Note: The remaining ~100 concept-slug families that don't match a GL blessing by name will need a weapon-type fingerprint matching pass. Implement that as a stretch goal — if time permits, add `enrichBlessingNamesFromGL()` that matches by comparing weapon-type sets. If not, the ~50-60 enriched families are a significant improvement and the concept-slug ones can be addressed in a follow-up.

- [ ] **Step 6: Run full check**

Run: `npm run check`
Expected: All tests pass, index builds, integrity gate passes.

Update integration test assertions in `enrich-entity-names.test.mjs` if the `enrichNameFamilies` count changed (the existing test asserts exactly 9).

- [ ] **Step 7: Commit**

```bash
git add scripts/enrich-entity-names.mjs scripts/enrich-entity-names.test.mjs data/ground-truth/entities/shared-names.json
git commit -m "feat: enrich blessing name_family ui_names from GL catalog"
```

---

### Task 6: Pipeline Wiring & Final Verification

**Files:**
- Modify: `package.json` (update pipeline docs if needed)
- Modify: `HANDOFF.md` (update with completion state)

- [ ] **Step 1: Run full pipeline in order**

```bash
npm run gl:scrape
npm run entities:fix-slugs
npm run entities:gen-mapping
npm run entities:enrich
npm run effects:build
npm run check
```

Each step should succeed. Log and note the output of each.

- [ ] **Step 2: Verify weapon coverage**

```bash
node -e "
const e = JSON.parse(require('fs').readFileSync('data/ground-truth/entities/shared-weapons.json','utf8'));
const weapons = e.filter(x => x.kind === 'weapon');
const player = weapons.filter(x => !x.internal_name.startsWith('bot_'));
const withName = player.filter(x => x.ui_name);
console.log('Player weapons with ui_name:', withName.length, '/', player.length);
"
```

Expected: 119+ of 124 player weapons have `ui_name` set.

- [ ] **Step 3: Verify alias coverage**

```bash
node -e "
const a = JSON.parse(require('fs').readFileSync('data/ground-truth/aliases/shared-guides.json','utf8'));
const weapon = a.filter(x => x.candidate_entity_id.includes('.weapon.'));
console.log('Weapon aliases:', weapon.length);
"
```

Expected: 119+ weapon aliases (up from 36).

- [ ] **Step 4: Verify name_family coverage**

```bash
node -e "
const e = JSON.parse(require('fs').readFileSync('data/ground-truth/entities/shared-names.json','utf8'));
const nf = e.filter(x => x.kind === 'name_family');
const withName = nf.filter(x => x.ui_name);
console.log('Name families with ui_name:', withName.length, '/', nf.length);
"
```

Expected: 50+ of 163 name_families have `ui_name` (up from 9).

- [ ] **Step 5: Verify slug fix**

```bash
grep -r bespoke_bespoke_ data/ground-truth/
```

Expected: No output (no remaining malformed slugs).

- [ ] **Step 6: Smoke test — resolve a previously-failing GL build**

Pick a GL build URL that uses a weapon not previously aliased (e.g., a build with a Turtolsky Heavy Sword or an Orestes Chainaxe).

```bash
node scripts/extract-build.mjs <url> --json 2>/dev/null | node -e "
const build = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
for (const w of build.weapons) {
  console.log(w.name.raw_label, '→', w.name.resolution_status);
}
"
```

Expected: All weapons show `resolution_status: "resolved"`.

- [ ] **Step 7: Update HANDOFF.md**

Update `HANDOFF.md` with:
- Phase 3 Track 2 complete
- Weapon coverage: X/124 `ui_name` set, Y weapon aliases
- Name_family coverage: Z/163 `ui_name` set
- Slug fix: 4 entities + 12 edges renamed
- Remaining: Blazing Spirit collision (out of scope), profile extraction gap, concept-slug name_families without GL match

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "feat: complete #14 Phase 3 Track 2 — GL weapon names, blessing names, slug fix"
```

- [ ] **Step 9: Close issue #14**

```bash
gh issue close 14 --comment "Closed by Phase 3 Track 2. All player weapons have display names and aliases. Blessing name_families enriched. Malformed slugs fixed. Remaining: Blazing Spirit collision (separate spec), profile extraction gap, concept-slug name_families."
```
