# Build Comparison Page — Design Spec

**Issue:** #6 (Plan 3) — Build comparison page
**Date:** 2026-04-09
**Scope:** `/compare` route, build list checkboxes, detail page "Compare with" link. Client-side diff from existing per-build JSON.

## Motivation

Plans 1–2 provide build list and detail views. Users need to compare two builds — see score deltas, structural differences (talents, weapons, blessings), synergy edge diffs, and breakpoint HTK comparisons. The library already has `diffBuilds()` but it uses `fs` and loads the full index; the website needs a browser-compatible diff layer operating on the existing per-build JSON payloads.

Client-side diff is chosen over pre-computation because it extends naturally to Plan 4 (GL import) — any two builds can be compared without pipeline changes.

## Routing & Entry Points

**Route:** `/compare?builds=slug1,slug2`

**Three entry points:**

1. **Build list page** — checkbox per row + "Compare" button. Select 2 builds → navigate to compare page.
2. **Build detail page** — "Compare with..." button in the header area → navigate to `/compare?builds={currentSlug},`.
3. **Direct URL** — `/compare?builds=slug1,slug2` is shareable.

**Fallback behavior:** If zero or one build slugs are provided, the compare page shows dropdown selectors to pick builds. The build list from `build-summaries.json` populates the dropdowns.

## Data Layer

**No new data generation.** The compare page fetches two existing per-build JSON files from `static/data/builds/{slug}.json` (the `BuildDetailData` shape already includes scorecard, synergy, breakpoints).

**New module:** `website/src/lib/compare.ts` — pure functions on `BuildDetailData`, no `fs`, no library imports:

### `computeScoreDeltas(a: BuildSummary, b: BuildSummary): ScoreDelta[]`

Delta per scoring dimension. `delta = b - a`. Same shape as library's `ScoreDelta`.

### `computeSetDiff(idsA: string[], idsB: string[]): SetDiff`

```ts
interface SetDiff {
  only_a: string[];
  only_b: string[];
  shared: string[];
}
```

For talents, weapons, blessings, curio perks. Uses `canonical_entity_id` for set operations.

### `computeSlotDiff(a: BuildDetailData, b: BuildDetailData): SlotDiff`

```ts
interface SlotDiff {
  ability: { a: string | null; b: string | null; changed: boolean };
  blitz: { a: string | null; b: string | null; changed: boolean };
  aura: { a: string | null; b: string | null; changed: boolean };
  keystone: { a: string | null; b: string | null; changed: boolean };
}
```

### `computeSynergyEdgeDiff(a: SynergyAnalysisDetail, b: SynergyAnalysisDetail): SetDiff`

Diff synergy edge sets by key (`type:sorted_selections`). Returns `SetDiff` of edge keys.

### `computeBreakpointDiff(a: BreakpointMatrixDetail, b: BreakpointMatrixDetail, scenario: string, difficulty: string): BreakpointDelta[]`

```ts
interface BreakpointDelta {
  breed_id: string;
  action_type: string;      // "light", "heavy", "special"
  a_htk: number | null;
  b_htk: number | null;
  delta: number | null;     // b - a, negative = B kills faster
}
```

Compares HTK across both breakpoint matrices for the selected scenario/difficulty. Finds the best (lowest) HTK per breed/action across weapons.

### Extractor helpers

```ts
function talentIds(detail: BuildDetailData): string[]
function weaponIds(detail: BuildDetailData): string[]
function blessingIds(detail: BuildDetailData): string[]
function curioPerkIds(detail: BuildDetailData): string[]
```

Extract `canonical_entity_id` arrays from the appropriate sections of `BuildDetailData`. These parallel the library's `build-diff.ts` extractors but operate on the website's pre-computed data shape.

### Display name resolution

The per-build JSON contains canonical entity IDs (e.g. `psyker.talent.psyker_toughness_on_warp_kill`) but not display names. To show human-readable labels in the diff views, the data generation script (`scripts/generate-data.ts`) must be extended to emit an `entity_names` map in each per-build JSON:

```json
{
  "entity_names": {
    "psyker.ability.psyker_combat_ability_stance": "Scrier's Gaze",
    "psyker.talent.psyker_toughness_on_warp_kill": "Warp Conductor",
    ...
  }
}
```

This map is built from the build's raw data during generation — the `raw_label` field from each selection. It covers all entities in the build (ability, blitz, aura, keystone, talents, weapons, blessings, curio perks). The compare functions use this map to render display names instead of raw IDs.

**Alternative rejected:** Shipping the full entity index to the browser for lookup. The `entity_names` map is ~40 entries per build, adds negligible size, and avoids loading the ~388KB index.

## Page Structure

### Tabs

Five tabs: **Overview | Talents | Weapons | Synergy | Breakpoints**

### Overview Tab — Center-Delta Scorecard

Three-column layout:

- **Left panel:** Build A header (title, class badge, grade badge) + 8 score rows (composite + 7 dimensions), each showing `{label}: {score}/{max}`
- **Center column (narrow):** Delta values per row. Color-coded: green = B scores higher, red = A scores higher, gray = tied or both null. Delta format: `+N` / `-N` / `0`
- **Right panel:** Build B header + 8 score rows (mirroring left)

Below the scorecard: a **slot diff summary bar** showing ability/blitz/aura/keystone status (changed/same, with values).

Both build headers link to their respective detail pages (`/builds/{slug}`).

### Talents Tab — Three-Column Diff

- **Only in A** | **Shared** | **Only in B**
- Talent names resolved from `canonical_entity_id` via the `entity_names` map
- Below the three columns: **slot diff details** — shows ability, blitz, aura, keystone values for each build, with "changed" highlighted

### Weapons Tab — Three-Column Diff

- **Only in A** | **Shared** | **Only in B**
- For shared weapons: inline comparison of perks and blessings showing which differ
- Weapon cards include slot label and perk/blessing summary

### Synergy Tab — Three-Column Edge Diff

- **Only in A** | **Shared** | **Only in B** — synergy edge cards (type, strength, selections, explanation)
- Below: anti-synergy comparison — anti-synergies unique to each build
- Below: coverage stats side-by-side (calc coverage, entities analyzed, build identity, coverage gaps)

### Breakpoints Tab — HTK Comparison Table

- Scenario/difficulty selectors (same as detail page)
- Table rows: per breed + action type combination
- Columns: Breed/Action | Build A HTK | Delta | Build B HTK
- Color coding: same as detail page's `htkCellClass` (green ≤1, yellow 2, red 3+), delta column uses green/red for direction
- Note below table: "Lower HTK is better. Green delta = Build B kills faster."

## Build List Checkboxes

**On the build list page** (`+page.svelte`):

- Add a checkbox column on the left side of the table
- State: `selectedBuilds: Set<string>` tracking slugs, max 2 selections
- When 2 are selected, show a "Compare" button (positioned in the filter bar area)
- Clicking Compare navigates to `/compare?builds=slug1,slug2`
- When 0 or 1 are selected, the Compare button is disabled/hidden
- Unchecking a third build after 2 are selected deselects the first (FIFO) — or just prevent selecting more than 2
- Clear selection state when navigating away or when Compare is clicked

## Build Detail "Compare With"

**On the build detail page** (`/builds/[slug]/+page.svelte`):

- Add a "Compare with..." link in the header section, next to the "Back to builds" link
- Navigates to `/compare?builds={currentSlug},`
- The compare page detects the empty second slug and shows a dropdown pre-filtered to the current build's class (or all builds)

## Cross-Class Comparison

Cross-class comparisons are allowed — the structural diff is still meaningful. The Overview tab shows a small "Cross-class comparison" badge when the two builds are different classes, to set expectations that some dimensions (like breakpoint relevance) aren't directly comparable across classes.

## Types

New types in `$lib/types.ts`:

```ts
interface CompareScoreDelta {
  dimension: string;       // key like "composite", "perk_optimality", etc.
  label: string;           // display label like "Perk Optimality"
  a: number | null;
  b: number | null;
  delta: number | null;
  max: number;             // 35 for composite, 5 for dimensions
}

interface CompareSetDiff {
  only_a: string[];
  only_b: string[];
  shared: string[];
}

interface CompareSlotDiff {
  key: string;             // "ability", "blitz", "aura", "keystone"
  a: string | null;
  b: string | null;
  changed: boolean;
}

interface CompareBreakpointDelta {
  breed_id: string;
  action_type: string;
  a_htk: number | null;
  b_htk: number | null;
  delta: number | null;
}
```

Add to `BuildDetailData` in `$lib/types.ts`:

```ts
entity_names: Record<string, string>;  // canonical_entity_id → display name
```

## File Structure

```
website/src/
  lib/
    compare.ts             # pure diff functions on BuildDetailData
    types.ts               # new CompareXxx types added
    builds.ts              # existing helpers (no changes needed)
  routes/
    compare/
      +page.svelte         # comparison page with tabs
      +page.ts             # load both build JSONs from URL params
    +page.svelte           # build list — add checkboxes + Compare button
    builds/[slug]/
      +page.svelte         # build detail — add "Compare with..." link
```

## Testing

### `compare.ts` unit tests

- `computeScoreDeltas`: same-build diff (all zeros), different builds (known deltas)
- `computeSetDiff`: empty sets, identical sets, disjoint sets, overlapping sets
- `computeSlotDiff`: same slots, different slots, null slots
- `computeSynergyEdgeDiff`: identical edges, unique edges per side
- `computeBreakpointDiff`: known HTK comparison for two real builds
- Extractor helpers: verify correct IDs extracted from `BuildDetailData`

### Manual verification

- Load two builds via URL params, verify all tabs render correctly
- Cross-class comparison renders with badge
- Single build URL shows dropdown picker
- Build list checkboxes work: select 2 → Compare button appears → navigates correctly
- Detail page "Compare with..." link works

## Deferred

- **Swap analysis on compare page** — showing what-if deltas if you swap a talent/weapon from the other build. This depends on the `recommend` module being browser-compatible, which requires more work.
- **Synergy graph visualization** — Svelte Flow rendering of edge diff. Deferred to v1.1 as noted in #6 brainstorm.
- **Curio perk diff tab** — curio perks are shown in the Overview slot diff and in the structural diff within Talents tab. Not enough data for a dedicated tab.
