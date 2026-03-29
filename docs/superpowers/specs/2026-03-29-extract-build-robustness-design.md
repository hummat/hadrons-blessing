# extract-build.mjs Robustness Hardening

**Issue:** #17 — `extract-build.mjs` fails on some newer GL builds
**Date:** 2026-03-29
**Approach:** B (guard rails + selector fallback chains)

## Context

The scraper extracts Darktide build data from GamesLantern build pages using Playwright. It relies on CSS-class-based selectors (Tailwind utility classes) to locate page sections and item cards. The original issue reported failures on Arbites builds, but investigation shows the repro URL is a 404 — the build was deleted from GL. All current Arbites and Hive Scum builds scrape correctly.

The real bug: the scraper doesn't detect 404/deleted pages and produces empty results that fail schema validation with a cryptic error (`/weapons must NOT have fewer than 2 items`).

While here, we harden the scraper against future GL layout changes with selector fallback chains.

## Changes

### 1. Early page validation

Inside `page.evaluate()`, before any extraction, detect dead/empty pages:

- Check if body text matches `404` pattern or is under 50 characters
- Return an `{ error: "page_not_found", bodyPreview }` sentinel
- In Node-land, detect the sentinel and throw a clear error: `"Build page returned 404 — the build may have been deleted from GamesLantern"`

### 2. Raw scrape validation (pre-canonicalization)

A `validateRawScrape(raw)` function that checks minimum viable data after `extractBuild()` returns:

- Reports missing: title, class, weapons, talents
- Returns an array of problem strings (empty = valid)
- Warnings always go to stderr
- If weapons are empty: skip canonicalization, exit nonzero, suggest `--diagnose`
- Partial scrapes (e.g., weapons found but no talents) still proceed

### 3. Selector fallback chains

For section headings and item cards, add a two-tier fallback. Each tier returns results; first non-empty wins. A `_diagnostics` object on the raw scrape result records which strategy fired.

**Section headings** (find "Weapons", "Curios", "Description"):
1. Primary: `.mt-8.mb-4` elements with exact text match (existing)
2. Fallback: any element whose `textContent.trim()` equals the section name and is heading-like (h1-h6, or a `div`/`p`/`span` with text length under 30 chars that has a `nextElementSibling`)

**Item cards** (within a section container):
1. Primary: `:scope > div[class*="max-w"]` (existing)
2. Fallback: direct child divs containing weapon-signature text — rarity names (`Transcendant`, `Anointed`, `Profane`, `Redeemed`) or perk patterns (`\d+-\d+%`)

**Class detection**: already has a 3-tier fallback chain. No changes.

**Diagnostics object shape:**
```js
{
  sectionStrategy: "primary" | "fallback",
  weaponCardStrategy: "primary" | "fallback",
  weaponCardCount: number,
  talentCount: number,
}
```

Stripped before output/canonicalization. Logged to stderr when any fallback fires.

### 4. `--diagnose` flag

Diagnostic mode for debugging future breakage. Outputs page structure to stdout:

- Page URL and status (404 or loaded)
- All heading-like elements with CSS classes
- Selector hit counts for each primary + fallback tier
- Body text preview (first 500 chars)

Exits 0 regardless — inspection only, no canonicalization.

### 5. Tests

- Unit tests for fallback selector logic (pure functions, no Playwright)
- Unit test for `validateRawScrape` with partial/empty inputs
- Existing `extract-build.test.mjs` tests unchanged

## Not in scope

- `build-shape.mjs` schema validation — `minItems: 2` is correct
- `build-canonicalize.mjs` — receives valid data or doesn't get called
- Talent tree extraction (`.ability-active`) — already warns and continues
- Retry/polling for flaky loads
- Selector changes for currently-working extractors (title, author, curios)

## Verification

1. `node scripts/extract-build.mjs <deleted-build-url>` → clear 404 error message
2. `node scripts/extract-build.mjs <valid-build-url> --json` → works as before
3. `node scripts/extract-build.mjs <valid-build-url> --diagnose` → dumps page structure
4. `npm test` → all existing + new tests pass
