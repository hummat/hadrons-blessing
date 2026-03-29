# extract-build.mjs Robustness Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the GL build scraper with 404 detection, pre-canonicalization validation, selector fallback chains, and a `--diagnose` flag.

**Architecture:** All changes are in `scripts/extract-build.mjs`. A new pure function `validateRawScrape` validates raw scrape results. Inside `page.evaluate()`, the existing `getSection` and `parseItemCards` functions gain fallback selector chains. A `_diagnostics` object tracks which selectors fired. A new `--diagnose` CLI flag dumps page structure for debugging.

**Tech Stack:** Node.js ESM, Playwright (existing), node:test (existing)

**Spec:** `docs/superpowers/specs/2026-03-29-extract-build-robustness-design.md`

---

## File Structure

- **Modify:** `scripts/extract-build.mjs` — all runtime changes (404 detection, fallbacks, diagnostics, validation, --diagnose)
- **Modify:** `scripts/extract-build.test.mjs` — unit tests for `validateRawScrape`

No new files. No changes to `build-shape.mjs`, `build-canonicalize.mjs`, or schemas.

---

### Task 1: TDD `validateRawScrape`

**Files:**
- Modify: `scripts/extract-build.test.mjs`
- Modify: `scripts/extract-build.mjs` (add function + export)

- [ ] **Step 1: Write failing tests**

Add to `scripts/extract-build.test.mjs`:

```js
import { postProcessTalentNodes, slugToName, validateRawScrape } from "./extract-build.mjs";

// ... existing tests ...

describe("validateRawScrape", () => {
  it("returns empty array for complete scrape", () => {
    const raw = {
      title: "Test Build",
      class: "veteran",
      weapons: [{ name: "Weapon" }],
      talents: { active: [{ slug: "talent" }], inactive: [] },
    };
    assert.deepEqual(validateRawScrape(raw), []);
  });

  it("reports all missing fields for empty scrape", () => {
    const raw = {
      title: "",
      class: "",
      weapons: [],
      talents: { active: [], inactive: [] },
    };
    const problems = validateRawScrape(raw);
    assert.equal(problems.length, 4);
    assert.ok(problems.includes("title not found"));
    assert.ok(problems.includes("class not detected"));
    assert.ok(problems.includes("no weapons extracted"));
    assert.ok(problems.includes("no talents extracted"));
  });

  it("reports only missing fields for partial scrape", () => {
    const raw = {
      title: "Test Build",
      class: "veteran",
      weapons: [{ name: "Weapon" }],
      talents: { active: [], inactive: [] },
    };
    assert.deepEqual(validateRawScrape(raw), ["no talents extracted"]);
  });

  it("accepts inactive-only talent scrapes", () => {
    const raw = {
      title: "Test Build",
      class: "veteran",
      weapons: [{ name: "Weapon" }],
      talents: { active: [], inactive: [{ slug: "talent" }] },
    };
    assert.deepEqual(validateRawScrape(raw), []);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/extract-build.test.mjs`
Expected: FAIL — `validateRawScrape` is not exported / does not exist

- [ ] **Step 3: Implement `validateRawScrape`**

Add to `scripts/extract-build.mjs`, after the `postProcessTalentNodes` function (after line 87):

```js
function validateRawScrape(raw) {
  const problems = [];
  if (!raw.title) problems.push("title not found");
  if (!raw.class) problems.push("class not detected");
  if (raw.weapons.length === 0) problems.push("no weapons extracted");
  if (raw.talents.active.length === 0 && raw.talents.inactive.length === 0) {
    problems.push("no talents extracted");
  }
  return problems;
}
```

Update the export line at the bottom:

```js
export { extractBuild, frameTier, main, postProcessTalentNodes, slugToName, validateRawScrape };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/extract-build.test.mjs`
Expected: PASS — all existing + new tests green

- [ ] **Step 5: Commit**

```bash
git add scripts/extract-build.mjs scripts/extract-build.test.mjs
git commit -m "feat(extract-build): add validateRawScrape with tests (#17)"
```

---

### Task 2: Add 404 detection

**Files:**
- Modify: `scripts/extract-build.mjs` (page.evaluate + main)

- [ ] **Step 1: Add 404 detection inside `page.evaluate`**

At the very start of the `page.evaluate` callback (line 113, inside `return await page.evaluate(() => {`), before the `const result = {` block, add:

```js
      // --- Early page validation ---
      const bodyText = document.body?.innerText?.trim() ?? "";
      if (/^404\b/i.test(bodyText) || bodyText.length < 50) {
        return { error: "page_not_found", bodyPreview: bodyText.slice(0, 200) };
      }
```

- [ ] **Step 2: Handle error sentinel in `main`**

In the `main` function, after `const rawBuild = await extractBuild(url);` (line 440), add:

```js
  if (rawBuild.error === "page_not_found") {
    console.error(
      "Error: Build page not found — the build may have been deleted from GamesLantern."
    );
    console.error(`Page content: ${rawBuild.bodyPreview}`);
    process.exit(1);
  }
```

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `node --test scripts/extract-build.test.mjs`
Expected: PASS — existing tests unaffected

- [ ] **Step 4: Manual verify with a deleted build URL**

Run: `node scripts/extract-build.mjs "https://darktide.gameslantern.com/builds/91b777ae-d2c2-4ff9-8c0f-e1eedb9e7eb7/one-man-army-arbites-build-in-darktide" --raw-json 2>&1`
Expected: stderr shows "Error: Build page not found" message, exits with code 1

- [ ] **Step 5: Commit**

```bash
git add scripts/extract-build.mjs
git commit -m "feat(extract-build): detect 404 pages with clear error message (#17)"
```

---

### Task 3: Selector fallback chains + diagnostics

**Files:**
- Modify: `scripts/extract-build.mjs` (inside page.evaluate)

- [ ] **Step 1: Initialize `_diagnostics` object inside `page.evaluate`**

After the 404 check (added in Task 2), before `const result = {`, add:

```js
      const _diagnostics = {
        sectionStrategy: "primary",
        weaponCardStrategy: "primary",
        weaponCardCount: 0,
        talentCount: 0,
      };
```

- [ ] **Step 2: Refactor `getSection` with fallback chain**

Replace the existing `getSection` function inside `page.evaluate` (currently lines ~225-230):

```js
      function getSection(name) {
        // Primary: Tailwind utility class selector (current GL layout)
        for (const h of document.querySelectorAll(".mt-8.mb-4")) {
          if (h.textContent.trim() === name) return h;
        }

        // Fallback: semantic heading elements with matching text
        for (const el of document.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
          if (el.textContent.trim() === name) {
            _diagnostics.sectionStrategy = "fallback";
            return el;
          }
        }

        // Fallback: short-text block elements acting as section headers
        for (const el of document.querySelectorAll("div, p")) {
          const text = el.textContent.trim();
          if (
            text === name
            && text.length < 30
            && el.nextElementSibling
            && el.children.length <= 2
          ) {
            _diagnostics.sectionStrategy = "fallback";
            return el;
          }
        }

        return null;
      }
```

- [ ] **Step 3: Add item card fallback in `parseItemCards`**

Inside `parseItemCards`, replace the `const cards = container.querySelectorAll(...)` line (currently line ~265-267) with:

```js
        let cards = container.querySelectorAll(
          ':scope > div[class*="max-w"]'
        );

        if (cards.length === 0) {
          // Fallback: child divs containing weapon-signature text patterns
          const WEAPON_SIGNATURE = /Transcendant|Anointed|Profane|Redeemed|\d+-\d+%/;
          const fallbackCards = [...container.querySelectorAll(":scope > div")].filter(
            (div) => WEAPON_SIGNATURE.test(div.innerText ?? "")
          );
          if (fallbackCards.length > 0) {
            cards = fallbackCards;
            _diagnostics.weaponCardStrategy = "fallback";
          }
        }
```

- [ ] **Step 4: Collect diagnostic data and attach to result**

At the end of `page.evaluate`, just before `return result;`, add:

```js
      _diagnostics.weaponCardCount = result.weapons.length;
      _diagnostics.talentCount = result.talents.active.length + result.talents.inactive.length;
      _diagnostics.headings = [
        ...document.querySelectorAll("h1, h2, h3, h4, h5, h6, .mt-8.mb-4"),
      ].map((el) => ({
        tag: el.tagName,
        classes: el.className.slice(0, 100),
        text: el.textContent.trim().slice(0, 80),
      }));
      _diagnostics.selectorHits = {
        "section.mt-8.mb-4": document.querySelectorAll(".mt-8.mb-4").length,
        "cards.max-w": document.querySelectorAll('[class*="max-w"]').length,
        "talent.ability-active": document.querySelectorAll(".ability-active").length,
        "talent.ability-inactive": document.querySelectorAll(".ability-inactive").length,
      };
      _diagnostics.bodyPreview = (document.body?.innerText ?? "").slice(0, 500);
      result._diagnostics = _diagnostics;
```

- [ ] **Step 5: Run existing tests**

Run: `node --test scripts/extract-build.test.mjs`
Expected: PASS — existing tests unaffected

- [ ] **Step 6: Manual verify diagnostics appear in raw-json output**

Run: `node scripts/extract-build.mjs "https://darktide.gameslantern.com/builds/a0ec9b4c-1f7f-4a28-aa75-e6c3973e4725/2026-dog-meta" --raw-json 2>&1 | grep -A5 _diagnostics`
Expected: shows `_diagnostics` object with `sectionStrategy: "primary"`, `weaponCardStrategy: "primary"`, `weaponCardCount: 2`

- [ ] **Step 7: Commit**

```bash
git add scripts/extract-build.mjs
git commit -m "feat(extract-build): add selector fallback chains with diagnostics (#17)"
```

---

### Task 4: Add `--diagnose` flag

**Files:**
- Modify: `scripts/extract-build.mjs` (main function + USAGE + file header)

- [ ] **Step 1: Update USAGE string and file header**

Update the USAGE constant:

```js
const USAGE = `Usage: node scripts/extract-build.mjs <gameslantern-build-url> [--json|--raw-json|--markdown|--diagnose]`;
```

Update the file header comment (line 7-8 area) to include:

```js
//   node scripts/extract-build.mjs <url> --diagnose     # dump page structure for debugging
```

- [ ] **Step 2: Add `--diagnose` to format detection**

Replace the format detection in `main` (currently lines ~428-432):

```js
  const format = argv.includes("--diagnose")
    ? "diagnose"
    : argv.includes("--raw-json")
      ? "raw-json"
      : argv.includes("--json")
        ? "json"
        : "markdown";
```

- [ ] **Step 3: Add diagnose output path for 404 pages**

Update the 404 error handling (added in Task 2) to support diagnose mode:

```js
  if (rawBuild.error === "page_not_found") {
    if (format === "diagnose") {
      console.log(JSON.stringify({
        url,
        status: "not_found",
        bodyPreview: rawBuild.bodyPreview,
      }, null, 2));
      return;
    }
    console.error(
      "Error: Build page not found — the build may have been deleted from GamesLantern."
    );
    console.error(`Page content: ${rawBuild.bodyPreview}`);
    process.exit(1);
  }
```

- [ ] **Step 4: Add diagnose output path for loaded pages**

After the 404 handling block, before postProcessTalentNodes, add:

```js
  if (format === "diagnose") {
    console.log(JSON.stringify({
      url: rawBuild.url,
      status: "loaded",
      title: rawBuild.title || "(empty)",
      class: rawBuild.class || "(empty)",
      weaponCount: rawBuild.weapons.length,
      curioCount: rawBuild.curios.length,
      talentCount: rawBuild.talents.active.length + rawBuild.talents.inactive.length,
      ...rawBuild._diagnostics,
    }, null, 2));
    return;
  }
```

- [ ] **Step 5: Manual verify diagnose mode**

Run: `node scripts/extract-build.mjs "https://darktide.gameslantern.com/builds/a0ec9b4c-1f7f-4a28-aa75-e6c3973e4725/2026-dog-meta" --diagnose 2>&1`
Expected: JSON output with `status: "loaded"`, `weaponCount: 2`, `sectionStrategy: "primary"`, headings list, selectorHits, bodyPreview

Run: `node scripts/extract-build.mjs "https://darktide.gameslantern.com/builds/91b777ae-d2c2-4ff9-8c0f-e1eedb9e7eb7/one-man-army-arbites-build-in-darktide" --diagnose 2>&1`
Expected: JSON output with `status: "not_found"`, bodyPreview containing "404"

- [ ] **Step 6: Commit**

```bash
git add scripts/extract-build.mjs
git commit -m "feat(extract-build): add --diagnose flag for debugging scraper issues (#17)"
```

---

### Task 5: Wire validation + diagnostics into `main()`

**Files:**
- Modify: `scripts/extract-build.mjs` (main function)

- [ ] **Step 1: Strip diagnostics and log fallback warnings**

In `main()`, after the diagnose early-return (added in Task 4) and before the existing `rawBuild.talents.active = postProcessTalentNodes(...)` line, add:

```js
  const diagnostics = rawBuild._diagnostics;
  delete rawBuild._diagnostics;

  if (diagnostics?.sectionStrategy === "fallback") {
    console.error("Warning: primary section heading selector missed — used fallback");
  }
  if (diagnostics?.weaponCardStrategy === "fallback") {
    console.error("Warning: primary weapon card selector missed — used fallback");
  }
```

- [ ] **Step 2: Add raw scrape validation after post-processing**

After the existing `class_selections` logic block and before the `if (format === "raw-json")` check, add:

```js
  const problems = validateRawScrape(rawBuild);
  for (const problem of problems) {
    console.error(`Warning: ${problem}`);
  }
```

- [ ] **Step 3: Add empty weapons guard before canonicalization**

After the `if (format === "raw-json")` block and before `const build = await canonicalizeScrapedBuild(rawBuild);`, add:

```js
  if (rawBuild.weapons.length === 0) {
    console.error(
      "Error: no weapons extracted — cannot canonicalize. Try --diagnose for page structure."
    );
    process.exit(1);
  }
```

- [ ] **Step 4: Run all tests**

Run: `node --test scripts/extract-build.test.mjs`
Expected: PASS

Run: `npm run check`
Expected: PASS — full suite including 872+ tests

- [ ] **Step 5: Manual end-to-end verification**

Run: `node scripts/extract-build.mjs "https://darktide.gameslantern.com/builds/a0ec9b4c-1f7f-4a28-aa75-e6c3973e4725/2026-dog-meta" --json 2>&1 | tail -5`
Expected: valid JSON output, no warnings on stderr (clean scrape)

Run: `node scripts/extract-build.mjs "https://darktide.gameslantern.com/builds/91b777ae-d2c2-4ff9-8c0f-e1eedb9e7eb7/one-man-army-arbites-build-in-darktide" --json 2>&1`
Expected: "Error: Build page not found" on stderr, exit code 1

- [ ] **Step 6: Commit**

```bash
git add scripts/extract-build.mjs
git commit -m "feat(extract-build): wire validation and diagnostics into main flow (#17)"
```
