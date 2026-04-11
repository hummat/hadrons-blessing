# Handoff

**From:** GPT-5 Codex
**Date:** 2026-04-11

## Task
Resume from the website / calculator / payload cleanup pass that followed the GL alias corpus work.

## Current State
- Branch: `main`
- Worktree is clean.
- The 2026-04-11 session work is committed as:
  - `8ff1ebd` `fix: stop emitting null weapon perk entries in scorecards`
  - `14613b9` `feat: improve website compare/detail/list UX and add smoke tooling`
  - `f859d5d` `fix: expand damage-profile extraction for missing ranged action maps`
- No push has been performed.
- This handoff replaces the stale alias-only handoff from 2026-04-10.

## What Changed

### 1. Website UX cleanup
- Added `website/src/lib/detail-format.ts` and tests in `website/src/lib/detail-format.test.ts`.
- Cleaned up:
  - build list scanability and wider shell layout
  - build detail structure/scorecard/synergy/breakpoint presentation
  - compare-page overview and formatted diff output
- Build detail now:
  - uses a cleaner structure payload section
  - formats selection / family labels for humans instead of raw IDs
  - fixes calc coverage percentage formatting
  - stops exposing blessing internal IDs in the default UI

### 2. Breakpoint matrix honesty
- `website/src/lib/detail-format.ts` now builds slot-aware breakpoint panels with explicit states:
  - `supported`
  - `missing`
  - `unsupported`
- Unsupported ranged families no longer show misleading melee/bash/push matrices.
- Current unsupported corpus set is explicitly surfaced in the UI:
  - flamers: builds `05`, `07`, `08`
  - force staves: builds `09`, `11`, `12`
  - projectile ranged: builds `14`, `15`

### 3. Ranged breakpoint extractor fixes
- `src/cli/extract-damage-profiles.ts` now handles the missing ranged cases that were actual parser bugs:
  - shotshell templates
  - damage-profile override blocks
  - hitscan clone/template variants
- Regressions added in `src/lib/extract-damage-profiles.test.ts`.
- Result: straightforward hitscan / shotshell ranged gaps in the checked-in corpus are fixed.

### 4. Null weapon perk payload fix (`#23`)
- Root cause was scorer-side, not website-side.
- `src/lib/score-build.ts` no longer emits `null` placeholders inside `weapon.perks.perks`.
- Regressions added in `src/lib/score-build.test.ts`.
- Consumer types and renderers were tightened:
  - `website/src/lib/types.ts`
  - `src/lib/build-report.ts`
  - `src/lib/report-formatter.ts`
  - `website/src/routes/builds/[slug]/+page.svelte`
- Score snapshots and website build-detail JSON were regenerated.
- Known offenders (`07`, `10`, `21`) no longer contain null perk entries.

### 5. Playwright / smoke flow
- Added:
  - `scripts/website-smoke.sh`
  - `make website-preview`
  - `make website-smoke`
- Documented the flow in `README.md`.
- Global Codex MCP Playwright config was fixed earlier in the session to use Firefox. Browser verification worked after that.

## GitHub Issue State
- Updated `#6` to keep it focused on website/product scope. Plans 1–3 are effectively in place; Plan 4 remains next.
- `#23` was fixed and closed.
- Opened:
  - `#22` Add breakpoint support for unsupported ranged weapon families in the current build corpus
  - `#24` Extend damage-profile extraction to remaining template variants outside the current fixture corpus
  - `#25` Add structured hover detail cards for compressed or non-obvious website items
  - `#26` Redesign the website information architecture around verdict-first build analysis
- Added labels and applied them:
  - `website`
  - `data-pipeline`
  - `ground-truth`
  - `calculator`

## Verification

### Passed
- `npx tsx --test src/lib/extract-damage-profiles.test.ts`
- `npx tsx --test src/lib/score-build.test.ts`
- `npm run build`
- `GROUND_TRUTH_SOURCE_ROOT=$(<.source-root) npm run calc:freeze`
- `GROUND_TRUTH_SOURCE_ROOT=$(<.source-root) npx tsx --test src/lib/damage-calculator.test.ts`
- `GROUND_TRUTH_SOURCE_ROOT=$(<.source-root) npm test`
- `npm run score:freeze`
- `cd website && npx tsx scripts/generate-data.ts`
- `cd website && npm test`
- `cd website && npm run build`

### Browser verification completed
- `/`
- `/builds/09-psyker-2026`
- `/builds/07-zealot-hammer-flamer`
- `/builds/17-arbites-busted`
- `/compare?builds=09-psyker-2026,01-veteran-havoc40-2026`

Artifacts in `output/playwright/` include:
- `unsupported-ranged-panels.png`
- `arbites-shotgun-matrix-fixed.png`
- `ogryn-stubber-matrix-fixed.png`
- `ui-final-list.png`
- `ui-final-detail.png`
- `ui-final-compare.png`

### Root test gate
- The earlier calc snapshot drift caveat is resolved.
- `GROUND_TRUTH_SOURCE_ROOT=$(<.source-root) npm test` is now a clean top-level gate again after refreshing the frozen calc snapshots under `tests/fixtures/ground-truth/calc/`.

## Next Steps
1. If continuing implementation next, the best queued tasks are:
   - `#22` unsupported ranged family calculator support
   - or `#25` hover detail system
   - or `#26` broader website redesign spec/implementation
2. Push only when explicitly requested.
