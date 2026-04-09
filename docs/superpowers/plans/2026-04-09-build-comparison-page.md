# Build Comparison Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browser-side build comparison workflow to the website, including structural diff, score deltas, synergy/breakpoint comparison, list-page selection, and detail-page entry.

**Architecture:** Extend the generated per-build website payload with a `structure` block, add small shared website metadata modules (`dimensions.ts`, `compare.ts`), and build the `/compare` route as a client-side fetcher that independently loads build A and build B JSONs from the existing static data directory. Keep comparison logic pure and testable in `src/lib`, and keep route components focused on state, URL syncing, and rendering.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TypeScript, Node test runner via `tsx --test`, existing website static JSON generation script.

---

### Task 1: Extend Website Detail Payloads For Structural Diff

**Files:**
- Modify: `website/src/lib/types.ts`
- Modify: `website/scripts/generate-data.ts`
- Modify: `website/src/lib/generate-data.test.ts`

- [ ] **Step 1: Write the failing data-shape test**

```ts
it("includes structural selections in the generated detail payload", () => {
  const summary: BuildSummary = makeSummary();
  const structure = {
    slots: {
      ability: { id: "shared.ability.test", name: "Test Ability" },
      blitz: { id: null, name: null },
      aura: { id: null, name: null },
      keystone: { id: null, name: null },
    },
    talents: [{ id: "shared.stat_node.toughness_boost", name: "Toughness Boost 4" }],
    weapons: [],
    curio_perks: [],
  };

  assert.deepEqual(buildDetailRecord(summary, {}, {}, {}, structure), {
    slug: "17-arbites-busted",
    summary,
    scorecard: {},
    synergy: {},
    breakpoints: {},
    structure,
  });
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `cd website && npm test -- --test-name-pattern "includes structural selections"`
Expected: FAIL because `buildDetailRecord` does not accept or return `structure`.

- [ ] **Step 3: Add the new website types**

```ts
export interface BuildStructureSlot {
  id: string | null;
  name: string | null;
}

export interface BuildStructureBlessing {
  id: string | null;
  name: string;
}

export interface BuildStructureWeapon {
  id: string;
  name: string;
  slot: string | null;
  family: string | null;
  blessings: BuildStructureBlessing[];
}

export interface BuildStructureEntry {
  id: string | null;
  name: string;
}

export interface BuildStructure {
  slots: {
    ability: BuildStructureSlot;
    blitz: BuildStructureSlot;
    aura: BuildStructureSlot;
    keystone: BuildStructureSlot;
  };
  talents: Array<{ id: string; name: string }>;
  weapons: BuildStructureWeapon[];
  curio_perks: BuildStructureEntry[];
}
```

- [ ] **Step 4: Extend `buildDetailRecord()` and generator extraction minimally**

```ts
export function buildDetailRecord(
  summary: BuildSummary,
  scorecard: AnyRecord,
  synergy: AnyRecord,
  breakpoints: AnyRecord,
  structure: BuildStructure,
): BuildDetailData {
  return {
    slug: buildSlugFromFile(summary.file),
    summary,
    scorecard: scorecard as BuildDetailData["scorecard"],
    synergy: synergy as BuildDetailData["synergy"],
    breakpoints: breakpoints as BuildDetailData["breakpoints"],
    structure,
  };
}
```

```ts
function extractStructure(build: AnyRecord): BuildStructure {
  return {
    slots: {
      ability: slotEntry(build.ability),
      blitz: slotEntry(build.blitz),
      aura: slotEntry(build.aura),
      keystone: slotEntry(build.keystone),
    },
    talents: asArray(build.talents).flatMap(talentEntry),
    weapons: asArray(build.weapons).flatMap(weaponEntry),
    curio_perks: asArray(build.curios).flatMap(curioPerkEntries),
  };
}
```

- [ ] **Step 5: Run website tests**

Run: `cd website && npm test`
Expected: PASS, including the updated generator test.


### Task 2: Add Shared Comparison Metadata And Pure Diff Helpers

**Files:**
- Create: `website/src/lib/dimensions.ts`
- Create: `website/src/lib/compare.ts`
- Create: `website/src/lib/compare.test.ts`
- Modify: `website/src/lib/filter-sort.ts`
- Modify: `website/src/routes/builds/[slug]/+page.svelte`

- [ ] **Step 1: Write the failing helper tests**

```ts
it("preserves same-id different-name entries in multiset diffs", () => {
  const a = [
    { compare_key: "shared.stat_node.toughness_boost::Toughness Boost 4", id: "shared.stat_node.toughness_boost", name: "Toughness Boost 4" },
  ];
  const b = [
    { compare_key: "shared.stat_node.toughness_boost::Toughness Boost 5", id: "shared.stat_node.toughness_boost", name: "Toughness Boost 5" },
  ];

  const diff = computeSetDiff(a, b);
  assert.deepEqual(diff.shared, []);
  assert.equal(diff.only_a[0].name, "Toughness Boost 4");
  assert.equal(diff.only_b[0].name, "Toughness Boost 5");
});

it("includes unresolved blessings in weapon entry extraction", () => {
  const entries = weaponEntries(makeDetailWithUnresolvedBlessing());
  assert.equal(entries[0].blessings[1].compare_key, "unresolved::Unstable Power");
});

it("computes breakpoint deltas with weapon attribution", () => {
  const rows = computeBreakpointDiff(detailA.breakpoints, detailB.breakpoints, "sustained", "damnation");
  assert.ok(rows.some((row) => row.a_weapon != null || row.b_weapon != null));
});
```

- [ ] **Step 2: Run the new helper tests and verify failure**

Run: `cd website && npm test -- src/lib/compare.test.ts`
Expected: FAIL because `compare.ts` and `dimensions.ts` do not exist yet.

- [ ] **Step 3: Add shared dimension metadata**

```ts
export const DIMENSIONS = [
  { scorecard_key: "composite_score", summary_key: "composite", label: "Overall", max: 35 },
  { scorecard_key: "perk_optimality", summary_key: "perk_optimality", label: "Perks", max: 5 },
  { scorecard_key: "curio_efficiency", summary_key: "curio_efficiency", label: "Curios", max: 5 },
  { scorecard_key: "talent_coherence", summary_key: "talent_coherence", label: "Talents", max: 5 },
  { scorecard_key: "blessing_synergy", summary_key: "blessing_synergy", label: "Blessings", max: 5 },
  { scorecard_key: "role_coverage", summary_key: "role_coverage", label: "Role", max: 5 },
  { scorecard_key: "breakpoint_relevance", summary_key: "breakpoint_relevance", label: "Breakpoints", max: 5 },
  { scorecard_key: "difficulty_scaling", summary_key: "difficulty_scaling", label: "Scaling", max: 5 },
] as const;
```

- [ ] **Step 4: Implement pure compare helpers**

```ts
export function computeSetDiff<T extends { compare_key: string }>(itemsA: T[], itemsB: T[]): CompareSetDiff<T> {
  const countsA = tally(itemsA);
  const countsB = tally(itemsB);
  return {
    shared: takeShared(itemsA, countsA, countsB),
    only_a: takeOnly(itemsA, countsA, countsB),
    only_b: takeOnly(itemsB, countsB, countsA),
  };
}
```

```ts
const ACTION_CATEGORY: Record<string, CompareActionCategory> = {
  light_attack: "light",
  action_swing: "light",
  action_swing_right: "light",
  action_swing_up: "light",
  push_followup: "light",
  heavy_attack: "heavy",
  shoot_hip: "light",
  shoot_zoomed: "light",
  shoot_charged: "heavy",
  weapon_special: "special",
  push: "push",
  action_overheat_explode: "special",
};
```

- [ ] **Step 5: Reuse `DIMENSIONS` in existing list/detail surfaces**

```ts
const COLUMNS = DIMENSIONS.map(({ summary_key, label }) => ({
  key: summary_key,
  label,
}));
```

- [ ] **Step 6: Run unit tests**

Run: `cd website && npm test`
Expected: PASS, including the new `compare.test.ts`.


### Task 3: Build The `/compare` Route With Independent Client Fetches

**Files:**
- Create: `website/src/routes/compare/+page.ts`
- Create: `website/src/routes/compare/+page.svelte`

- [ ] **Step 1: Add a load function that only fetches build summaries**

```ts
export const load: PageLoad = async ({ fetch }) => {
  const res = await fetch(`${base}/data/build-summaries.json`);
  const builds: BuildSummary[] = await res.json();
  return { builds };
};
```

- [ ] **Step 2: Add the failing route-state behaviors manually in the component first**

```ts
let buildASlug = $state("");
let buildBSlug = $state("");
let buildA = $state<BuildDetailData | null>(null);
let buildB = $state<BuildDetailData | null>(null);
let errorA = $state<string | null>(null);
let errorB = $state<string | null>(null);
let activeTab = $state<CompareTab>("overview");
```

- [ ] **Step 3: Implement independent fetch and URL-sync helpers**

```ts
async function loadBuild(slug: string): Promise<BuildDetailData> {
  const res = await fetch(`${base}/data/builds/${slug}.json`);
  if (!res.ok) throw new Error(`Build not found: ${slug}`);
  return res.json();
}

function swapBuilds(): void {
  [buildASlug, buildBSlug] = [buildBSlug, buildASlug];
  [buildA, buildB] = [buildB, buildA];
  [errorA, errorB] = [errorB, errorA];
  syncUrl();
}
```

- [ ] **Step 4: Render the five tabs against pure helper output**

```svelte
{#if buildA && buildB}
  <button onclick={swapBuilds}>Swap A ↔ B</button>
  {#if activeTab === "overview"}
    <CompareOverview {buildA} {buildB} />
  {/if}
{/if}
```

- [ ] **Step 5: Cover loading, same-build, invalid-slug, and partial-failure states**

```svelte
{#if !buildA && !buildB && !errorA && !errorB}
  <p>Loading builds...</p>
{:else}
  {#if buildASlug === buildBSlug && buildASlug}
    <p>Comparing build with itself — all deltas will be zero.</p>
  {/if}
{/if}
```

- [ ] **Step 6: Run the website test/build gate**

Run: `cd website && npm test && npm run build`
Expected: PASS, with `/compare` included in the static build.


### Task 4: Add Entry Points From The Build List And Detail Page

**Files:**
- Modify: `website/src/routes/+page.svelte`
- Modify: `website/src/routes/builds/[slug]/+page.svelte`

- [ ] **Step 1: Add comparison selection state to the build list**

```ts
let selectedBuilds = $state<string[]>([]);

function toggleSelected(slug: string): void {
  selectedBuilds = selectedBuilds.includes(slug)
    ? selectedBuilds.filter((value) => value !== slug)
    : selectedBuilds.length < 2
      ? [...selectedBuilds, slug]
      : selectedBuilds;
}
```

- [ ] **Step 2: Add the compare CTA and checkbox column**

```svelte
<a
  href={`${base}/compare?builds=${selectedBuilds.join(",")}`}
  class:invisible={selectedBuilds.length !== 2}
>
  Compare
</a>
```

- [ ] **Step 3: Add the detail-page compare entrypoint**

```svelte
<a href={`${base}/compare?builds=${data.detail.slug},`} class="text-sm text-gray-400 hover:text-amber-300">
  Compare with...
</a>
```

- [ ] **Step 4: Run the complete verification set**

Run: `cd website && npm test && npm run build`
Expected: PASS

Run: `npm run website-build`
Expected: PASS and regenerated static data includes `structure` in `website/static/data/builds/*.json`

- [ ] **Step 5: Manual verification checklist**

```text
1. Open /compare?builds=09-psyker-2026,10-psyker-electrokinetic-staff and verify all five tabs render.
2. Open a same-build URL and verify the zero-delta notice appears.
3. Break one slug intentionally and verify the healthy side still renders.
4. From /builds/<slug>, follow "Compare with..." and select a second build.
5. From /, select two builds, click Compare, then swap A/B and confirm delta signs flip.
```
