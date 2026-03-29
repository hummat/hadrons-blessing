# Handoff

**From:** Claude Opus 4.6 (Claude Code CLI)
**Date:** 2026-03-29

## Task
#17 (extract-build.mjs robustness hardening) — complete and merged to main. Not pushed.

## In-Flight Work
- 7 unpushed commits on main (2 spec/plan docs + 5 implementation commits).
- Feature branch `feature/extract-build-robustness` deleted after merge.

## What Changed

### `scripts/extract-build.mjs`
- **404 detection** — detects deleted/empty GL build pages early and shows clear error instead of cryptic schema validation failure
- **`validateRawScrape()`** — pre-canonicalization validation reporting missing title, class, weapons, or talents
- **Selector fallback chains** — `getSection()` falls back from `.mt-8.mb-4` Tailwind classes → semantic `<h1>`–`<h6>` → short-text block elements; `parseItemCards()` falls back from `div[class*="max-w"]` → child divs matching weapon-signature text patterns (rarity names, perk patterns)
- **`_diagnostics` object** — tracks which selector strategy fired, heading inventory, selector hit counts, body preview; stripped before output
- **`--diagnose` flag** — dumps page structure as JSON for debugging future scraper breakage
- **Empty weapons guard** — skips canonicalization with actionable error when no weapons extracted

### `scripts/extract-build.test.mjs`
- 4 new tests for `validateRawScrape` (complete scrape, empty scrape, partial scrape, inactive-only talents)

## Session Context
- The original issue's repro URL (`one-man-army-arbites-build-in-darktide`) is a **404** — the build was deleted from GL. All current Arbites and Hive Scum builds scrape correctly.
- The bug was never about changed selectors — it was about missing 404 detection producing empty results that failed schema validation with a misleading error.
- GL uses *both* `.mt-8.mb-4` divs and `<h2>` elements for section headings with the same text. The heading fallback will catch it if GL drops Tailwind classes.

## Next Steps
1. **Push to origin** — `git push`
2. **Close #17** — `gh issue close 17 --comment "Fixed in extract-build robustness hardening"`
3. **#1 (TypeScript migration)** — next planned issue
4. **#6 (Website)** — unblocked by #14
5. **#16** — weapon mark refinement via Darktide mod dump (requires game running)

## Pipeline Reference
```
npm run gl:scrape          # scrape GL catalog → gl-catalog.json (gitignored)
npm run entities:fix-slugs # fix malformed IDs (idempotent)
npm run entities:gen-mapping # auto-populate weapon-name-mapping.json
npm run entities:enrich    # set ui_name + generate aliases
npm run effects:build      # rebuild calc data
npm run check              # index build + 872 tests + integrity gate
```

## Design Docs
- Spec: `docs/superpowers/specs/2026-03-29-extract-build-robustness-design.md`
- Plan: `docs/superpowers/plans/2026-03-29-extract-build-robustness.md`
