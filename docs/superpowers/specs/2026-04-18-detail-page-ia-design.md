# Detail page IA redesign — verdict-first restructure

**Issue:** #26 (first tranche — detail route)
**Date:** 2026-04-18
**Scope:** `website/src/routes/builds/[slug]/+page.svelte` only. List and compare routes are separate tranches of the same issue and are out of scope here.

## Problem

The detail page currently reads as a ledger dump. Order today:

1. Hero
2. Ledger Entries (4 meta cards: armament count, synergy edge count, calc coverage, build identity)
3. Ordo Manifest (slots, talents, curio perks)
4. Seven Dimensions grid
5. Armoury Record (weapons + perks + blessings)
6. Synergy (edges, anti-synergies, orphans, coverage stats)
7. Cogitator Breakpoint Matrix

The reader scrolls past four meta cards and a dimension grid before reaching weapons, and has to read the qualitative explanations hidden in each dimension card to figure out what the build is actually good at. Evidence sits above the verdict instead of beneath it.

## Goal

Restructure the detail page so the first screen answers: *what is this build, what is it good at, what is it bad at, how confident are we in that answer*. Weapons and structural decisions come next. Evidence (full dimension table, synergy edges, breakpoint matrix) sits behind progressive disclosure.

No data-model changes. No new routes. Imperial Dataslate aesthetic is retained — this is a section reshuffle plus one new composed component (verdict strip).

## New page order

1. **Hero** — unchanged.
2. **Verdict Strip** *(new — replaces Ledger Entries)*: three parchment tiles: Role Fingerprint, Signature Strengths, Noted Risks.
3. **Ordo Manifest** — unchanged position and content.
4. **Armoury Record** — promoted from position 5 to 4. Weapons are the primary decision surface and belong above evidence.
5. **Synergy Summary** — demoted. Synergy edges preview shrinks to top 3 by strength with `<details>` for the rest. Anti-synergies and isolated picks keep their current chip + `<details>` pattern. The standalone *Coverage Stats* panel is removed (its one user-facing number moves into the Verdict Risk tile; the rest are audit data and move into a collapsed "Analytical coverage audit" block at the bottom of this section).
6. **Seven Dimensions grid** — demoted and collapsed by default. A one-line summary ("Composite 27/35 · Grade B · show full scorecard") expands the existing 8-card grid on click.
7. **Cogitator Breakpoint Matrix** — unchanged position.

## Verdict Strip — contents

Each tile is a parchment card with a label, a primary value, and a short explanatory line. Three tiles, equal width on desktop, stacked on mobile.

### Tile 1: Role Fingerprint

- **Primary line:** `build_identity` families joined with `·` (e.g. `melee_offense · toughness`). Falls back to "Undefined role" if the array is empty.
- **Secondary line:** slot balance — `Melee {melee.strength} · Ranged {ranged.strength}`.
- **Caption:** `Concentration {concentration}` (already computed).

### Tile 2: Signature Strengths

Rule for picking what to show:

- Candidates: the five qualitative dimensions (talent_coherence, blessing_synergy, role_coverage, breakpoint_relevance, difficulty_scaling), each with a score out of 5 and a `scorecard.qualitative.*.explanations[0]` string.
- Select up to two candidates with `score >= 4`, sorted by score descending. If none qualify, select the single highest-scoring qualitative dimension regardless of score (so the tile is never empty).
- Render each as `{Dimension Label} {score}/5` on one line, explanation on the next.

### Tile 3: Noted Risks

Structured as a short bulleted list, at most four bullets in priority order:

1. `scoring_unavailable` — emitted when every qualitative dimension is null (all five scorecard entries missing). Text: `Qualitative scoring unavailable`.
2. Lowest-scoring qualitative dimension **if score ≤ 2** (otherwise skip). Format: `{Label} {score}/5 — {explanations[0]}`.
3. `coverage_gaps` — join with `·` if non-empty, prefixed with `Gaps:`.
4. Anti-synergy + orphan counts if either > 0: `{N} anti-synergies · {M} isolated picks`.
5. Calc coverage — one of three shapes depending on `synergy.metadata.calc_coverage_pct` (a fraction in 0..1):
   - `calc_coverage_missing` **risk** bullet when the value is null or NaN: `Calc coverage unavailable`.
   - `low_calc_coverage` **risk** bullet when the value is below the 0.6 threshold: `Low calc coverage — only {pct}% of selections simulated`.
   - `calc_coverage` **informational** bullet otherwise (rendered after any risks): `Calc coverage {pct}%`.

The "Clean verdict — no flagged risks" line is emitted only when none of bullets 1–4 fire **and** calc coverage is healthy (≥ 0.6, not null/NaN). Low or missing coverage suppresses the clean fallback so the strip cannot claim a build is trustworthy while more than ~40% of its selections are outside calculator support.

## Progressive disclosure contract

- **Above the fold (desktop, no scroll):** Hero + Verdict Strip. The verdict is legible in ≤5 seconds.
- **First scroll:** Ordo Manifest + Armoury Record. Structural decisions visible without expansion.
- **Second scroll:** Synergy Summary (top-level chips/edges visible, full lists behind `<details>`) + Seven Dimensions (collapsed by default).
- **Third scroll:** Cogitator Breakpoint Matrix (expanded by default — it is the machine-verified evidence surface and its interactive scenario/difficulty controls are already there).

`<details>` blocks are closed on initial render. No scroll-triggered animations or auto-expansion logic — simple `<details>` is sufficient and matches the existing pattern (`ds-discl` class is already used for synergy drill-downs).

## Components and scope

- **New Svelte component:** `website/src/lib/VerdictStrip.svelte` (colocated with other lib modules — `website/src/lib/` is flat, no `components/` subdirectory today). Takes `BuildDetailData` as a prop, returns three parchment tiles.
- **New helper module:** `website/src/lib/verdict.ts` exporting `selectSignatureStrengths(qualitative, summaryScores)` and `buildRiskBullets(detail)`. Pure functions so they're unit-testable with `node:test`. Tests in `website/src/lib/verdict.test.ts`.
- **Modified file:** `+page.svelte` — section reorder, Ledger Entries removal, dimension grid wrapped in `<details>`, synergy coverage stats block removed (or moved into the synergy `<details>`).
- **No changes to:** `types.ts`, `detail-format.ts` (beyond the two new helpers if we hoist them), compare route, list route, `generate-data.ts`, scoring pipeline, any library code in `src/`.

## CSS

Reuse existing Dataslate tokens (`ds-parchment`, `ds-label`, `ds-body`, `ds-stamp`, `ds-score`, `ds-discl`, etc.). The Verdict Strip uses the same three-column CSS grid as the current `ds-ledger` row — the container class can be renamed `ds-verdict` with near-identical rules. No new color tokens; risk tile uses existing `ds-blood` for the lowest-dimension line.

## Testing

Screenshot before/after via Playwright on two representative builds:

- A high-scoring build where Signature Strengths fills both slots and Noted Risks has no triggers 1–3 (should show "Clean verdict").
- A mid/low-scoring build where Risks triggers all bullets (lowest dim ≤ 2, gaps present, anti-synergies > 0).

Unit tests for `selectSignatureStrengths` and `buildRiskBullets` using `node:test` via `tsx --test` (the existing test runner in `website/package.json`). Location: `website/src/lib/verdict.test.ts`, colocated with other lib helper tests. Cover: no qualifying strengths, single strength, two strengths; empty gaps, populated gaps, zero anti-synergies, no triggers.

## Out of scope

- List and compare route redesigns (same issue, separate tranches).
- Hover cards for talents or weapons.
- Any change to scoring, synergy, or calculator output.
- New aesthetics or color tokens.
- Per-dimension commentary tiles (earlier proposal discarded as redundant with existing dimension grid).
- Scroll-triggered animation or auto-expansion.

## Verification

- `make website-build` passes.
- `cd website && npm run test` passes (existing + new Vitest cases).
- Manual Playwright screenshot diff on the two representative builds confirms the three-tile verdict strip renders, weapons are promoted above synergy, and the dimension grid is collapsed by default.
- The first viewport on a desktop screenshot contains only the hero and the verdict strip.
