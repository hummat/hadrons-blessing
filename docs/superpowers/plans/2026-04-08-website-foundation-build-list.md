# Website Foundation + Build List — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy a SvelteKit static site on GitHub Pages with a build list page that displays all 24 builds in a filterable, sortable scorecard table.

**Architecture:** Pre-computed data approach. A Node.js build script imports the existing library (`listBuilds`) to generate a single `build-summaries.json` file. The SvelteKit app loads this JSON at prerender time — no runtime computation needed. Generated data files (gitignored) are required locally but not on CI; the website's static data file is checked in.

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), Tailwind CSS v4 (`@tailwindcss/vite`), `@sveltejs/adapter-static`, GitHub Pages

**Scope note:** Issue #6 has 8 MVP items. This plan covers only the foundation (scaffold, data pipeline, deployment) and the build list page. Subsequent plans will cover:
- Plan 2: Build detail page (scorecard, synergy graph via Svelte Flow, breakpoint matrix)
- Plan 3: Build comparison page
- Plan 4: GL import + interactive features (smells, "Explain This Grade")

---

## File Structure

```
website/                          # SvelteKit project (separate npm package)
  package.json                    # SvelteKit + Tailwind deps
  svelte.config.js                # adapter-static for GitHub Pages
  vite.config.ts                  # Tailwind v4 Vite plugin
  tsconfig.json                   # Extends SvelteKit-generated tsconfig
  src/
    app.html                      # HTML shell (dark theme)
    app.css                       # Tailwind v4 import
    routes/
      +layout.svelte              # Navigation shell + footer
      +layout.ts                  # prerender = true (all pages static)
      +page.svelte                # Build list: scorecard table + filters
      +page.ts                    # Load build-summaries.json at prerender
    lib/
      types.ts                    # BuildSummary, BuildScores, WeaponSummary
      filter-sort.ts              # Client-side filter/sort pure functions
      filter-sort.test.ts         # Tests for filter/sort logic
  static/
    data/
      build-summaries.json        # Pre-computed BuildSummary[] (checked in)
    .nojekyll                     # Disable Jekyll on GitHub Pages
  scripts/
    generate-data.ts              # Imports library, outputs build-summaries.json
.github/
  workflows/
    deploy-website.yml            # GitHub Actions: build + deploy to Pages
Makefile                          # Add website targets (modify existing)
.gitignore                        # Add website/build/, website/.svelte-kit/ (modify)
```

---

### Task 1: SvelteKit Project Scaffold

**Files:**
- Create: `website/package.json`
- Create: `website/svelte.config.js`
- Create: `website/vite.config.ts`
- Create: `website/tsconfig.json`
- Create: `website/src/app.html`
- Create: `website/src/app.css`
- Create: `website/src/routes/+layout.ts`
- Create: `website/src/routes/+layout.svelte`
- Create: `website/src/routes/+page.svelte` (placeholder)
- Modify: `.gitignore`

- [ ] **Step 1: Create `website/package.json`**

```json
{
  "name": "hadrons-blessing-website",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "generate-data": "tsx scripts/generate-data.ts",
    "test": "tsx --test src/**/*.test.ts"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run from `website/`:

```bash
npm install --save-dev @sveltejs/adapter-static @sveltejs/kit @sveltejs/vite-plugin-svelte svelte tailwindcss @tailwindcss/vite tsx typescript vite
```

- [ ] **Step 3: Create `website/svelte.config.js`**

```js
import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: '404.html',
      precompress: false,
      strict: true
    }),
    paths: {
      base: process.argv.includes('dev') ? '' : (process.env.BASE_PATH ?? '')
    }
  }
};

export default config;
```

Notes:
- `fallback: '404.html'` produces a custom 404 page for GitHub Pages.
- `BASE_PATH` is set by the GitHub Actions workflow to `/${{ github.event.repository.name }}` so asset URLs work when deployed to `hummat.github.io/hadrons-blessing/`.
- During `vite dev`, `base` is empty so local dev works at `/`.

- [ ] **Step 4: Create `website/vite.config.ts`**

```ts
import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
});
```

Note: Tailwind CSS v4 uses a first-party Vite plugin — no PostCSS config needed.

- [ ] **Step 5: Create `website/tsconfig.json`**

```json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "strict": true,
    "moduleResolution": "bundler"
  }
}
```

Note: Extends the SvelteKit-generated tsconfig (created when `vite dev` or `vite build` first runs). The `.svelte-kit/` directory is auto-generated.

- [ ] **Step 6: Create `website/src/app.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Source-backed Darktide build analysis — scores, synergies, breakpoints" />
    %sveltekit.head%
  </head>
  <body class="bg-gray-950 text-gray-100 min-h-screen antialiased" data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
```

Note: Dark background (`bg-gray-950`) applied at the `<body>` level so it's immediate. No flash of white.

- [ ] **Step 7: Create `website/src/app.css`**

```css
@import "tailwindcss";
```

Note: Tailwind v4 uses a single `@import "tailwindcss"` — no `@tailwind base/components/utilities` directives.

- [ ] **Step 8: Create `website/src/routes/+layout.ts`**

```ts
export const prerender = true;
```

Note: This tells SvelteKit to statically generate all pages at build time. Required for `adapter-static`.

- [ ] **Step 9: Create `website/src/routes/+layout.svelte`**

```svelte
<script>
  import "../app.css";
  let { children } = $props();
</script>

<div class="min-h-screen flex flex-col">
  <header class="bg-gray-900 border-b border-gray-800 px-6 py-4">
    <nav class="max-w-7xl mx-auto flex items-center gap-6">
      <a href="/" class="text-xl font-bold text-amber-400 hover:text-amber-300 transition-colors">
        Hadron's Blessing
      </a>
      <a href="/" class="text-gray-400 hover:text-gray-200 text-sm transition-colors">Builds</a>
    </nav>
  </header>

  <main class="flex-1 max-w-7xl mx-auto w-full px-6 py-8">
    {@render children()}
  </main>

  <footer class="bg-gray-900 border-t border-gray-800 px-6 py-4 text-center text-gray-500 text-xs">
    Source-backed Darktide build analysis
  </footer>
</div>
```

Notes:
- Svelte 5 runes: `$props()` replaces `export let`, `{@render children()}` replaces `<slot />`.
- Amber accent color evokes the Darktide aesthetic.
- Nav links will expand in future plans (Build Detail, Compare).

- [ ] **Step 10: Create placeholder `website/src/routes/+page.svelte`**

```svelte
<svelte:head>
  <title>Builds — Hadron's Blessing</title>
</svelte:head>

<h1 class="text-2xl font-bold mb-6">Builds</h1>
<p class="text-gray-400">Build list loading...</p>
```

- [ ] **Step 11: Add website paths to root `.gitignore`**

Append to the existing `.gitignore`:

```
website/build/
website/.svelte-kit/
website/node_modules/
```

- [ ] **Step 12: Verify dev server starts**

Run from `website/`:

```bash
npm run dev -- --open
```

Expected: Browser opens, dark page with "Hadron's Blessing" header, "Builds" heading, and placeholder text. No errors in terminal.

- [ ] **Step 13: Commit**

```bash
git add website/ .gitignore
git commit -m "feat(website): scaffold SvelteKit project with Tailwind v4

SvelteKit 2 + Svelte 5 + adapter-static + Tailwind CSS v4.
Dark theme shell with nav header and footer.
Placeholder build list page."
```

---

### Task 2: Shared Types + Filter/Sort Logic (TDD)

**Files:**
- Create: `website/src/lib/types.ts`
- Create: `website/src/lib/filter-sort.ts`
- Create: `website/src/lib/filter-sort.test.ts`

- [ ] **Step 1: Write the failing test `website/src/lib/filter-sort.test.ts`**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filterAndSort } from "./filter-sort.ts";
import type { BuildSummary } from "./types.ts";

function makeBuild(overrides: Partial<BuildSummary> = {}): BuildSummary {
  return {
    file: "test.json",
    title: "Test Build",
    class: "veteran",
    ability: null,
    keystone: null,
    weapons: [],
    scores: {
      composite: 20,
      grade: "B",
      perk_optimality: 3,
      curio_efficiency: 3,
      talent_coherence: null,
      blessing_synergy: null,
      role_coverage: null,
      breakpoint_relevance: null,
      difficulty_scaling: null,
    },
    ...overrides,
  };
}

describe("filterAndSort", () => {
  it("returns all builds with no filters", () => {
    const builds = [makeBuild(), makeBuild(), makeBuild()];
    const result = filterAndSort(builds, {});
    assert.equal(result.length, 3);
  });

  it("filters by class (case-insensitive)", () => {
    const builds = [
      makeBuild({ class: "veteran" }),
      makeBuild({ class: "psyker" }),
      makeBuild({ class: "veteran" }),
    ];
    const result = filterAndSort(builds, { class: "Veteran" });
    assert.equal(result.length, 2);
    assert.ok(result.every((b) => b.class === "veteran"));
  });

  it("filters by weapon name substring", () => {
    const builds = [
      makeBuild({
        weapons: [{ name: "Vraks Mk VII Headhunter Autogun", slot: "ranged", family: "autogun_p1" }],
      }),
      makeBuild({
        weapons: [{ name: "Indignatus Mk IVe Crusher", slot: "melee", family: "thunderhammer_2h" }],
      }),
    ];
    const result = filterAndSort(builds, { weapon: "autogun" });
    assert.equal(result.length, 1);
    assert.ok(result[0].weapons[0].name.includes("Autogun"));
  });

  it("filters by weapon family", () => {
    const builds = [
      makeBuild({
        weapons: [{ name: "Some Autogun", slot: "ranged", family: "autogun_p1" }],
      }),
      makeBuild({
        weapons: [{ name: "Some Axe", slot: "melee", family: "combataxe_p1" }],
      }),
    ];
    const result = filterAndSort(builds, { weapon: "autogun" });
    assert.equal(result.length, 1);
  });

  it("filters by minimum grade", () => {
    const builds = [
      makeBuild({ scores: { ...makeBuild().scores, grade: "A", composite: 28 } }),
      makeBuild({ scores: { ...makeBuild().scores, grade: "C", composite: 18 } }),
      makeBuild({ scores: { ...makeBuild().scores, grade: "B", composite: 23 } }),
    ];
    const result = filterAndSort(builds, { minGrade: "B" });
    assert.equal(result.length, 2);
    assert.ok(result.every((b) => ["S", "A", "B"].includes(b.scores.grade)));
  });

  it("sorts by composite descending by default", () => {
    const builds = [
      makeBuild({ scores: { ...makeBuild().scores, composite: 20 } }),
      makeBuild({ scores: { ...makeBuild().scores, composite: 30 } }),
      makeBuild({ scores: { ...makeBuild().scores, composite: 25 } }),
    ];
    const result = filterAndSort(builds, { sort: "composite" });
    assert.deepEqual(
      result.map((b) => b.scores.composite),
      [30, 25, 20],
    );
  });

  it("sorts by a dimension key", () => {
    const builds = [
      makeBuild({ scores: { ...makeBuild().scores, perk_optimality: 2 } }),
      makeBuild({ scores: { ...makeBuild().scores, perk_optimality: 5 } }),
      makeBuild({ scores: { ...makeBuild().scores, perk_optimality: 3 } }),
    ];
    const result = filterAndSort(builds, { sort: "perk_optimality" });
    assert.deepEqual(
      result.map((b) => b.scores.perk_optimality),
      [5, 3, 2],
    );
  });

  it("puts null scores last when sorting", () => {
    const builds = [
      makeBuild({ scores: { ...makeBuild().scores, talent_coherence: null } }),
      makeBuild({ scores: { ...makeBuild().scores, talent_coherence: 3 } }),
      makeBuild({ scores: { ...makeBuild().scores, talent_coherence: 1 } }),
    ];
    const result = filterAndSort(builds, { sort: "talent_coherence" });
    assert.equal(result[0].scores.talent_coherence, 3);
    assert.equal(result[1].scores.talent_coherence, 1);
    assert.equal(result[2].scores.talent_coherence, null);
  });

  it("reverses sort order", () => {
    const builds = [
      makeBuild({ scores: { ...makeBuild().scores, composite: 20 } }),
      makeBuild({ scores: { ...makeBuild().scores, composite: 30 } }),
    ];
    const result = filterAndSort(builds, { sort: "composite", reverse: true });
    assert.deepEqual(
      result.map((b) => b.scores.composite),
      [20, 30],
    );
  });

  it("combines filters", () => {
    const builds = [
      makeBuild({ class: "veteran", scores: { ...makeBuild().scores, grade: "A", composite: 28 } }),
      makeBuild({ class: "psyker", scores: { ...makeBuild().scores, grade: "A", composite: 29 } }),
      makeBuild({ class: "veteran", scores: { ...makeBuild().scores, grade: "D", composite: 12 } }),
    ];
    const result = filterAndSort(builds, { class: "veteran", minGrade: "B" });
    assert.equal(result.length, 1);
    assert.equal(result[0].class, "veteran");
    assert.equal(result[0].scores.grade, "A");
  });

  it("does not mutate the input array", () => {
    const builds = [
      makeBuild({ scores: { ...makeBuild().scores, composite: 20 } }),
      makeBuild({ scores: { ...makeBuild().scores, composite: 30 } }),
    ];
    const original = [...builds];
    filterAndSort(builds, { sort: "composite" });
    assert.equal(builds[0].scores.composite, original[0].scores.composite);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `website/`:

```bash
npx tsx --test src/lib/filter-sort.test.ts
```

Expected: FAIL — `Cannot find module './filter-sort.ts'`

- [ ] **Step 3: Create `website/src/lib/types.ts`**

These types mirror `BuildSummary`, `BuildScores`, and `WeaponSummary` from the library's `build-list.ts`. Duplicated here to avoid a runtime dependency on the Node.js library.

```ts
export interface WeaponSummary {
  name: string;
  slot: string | null;
  family: string | null;
}

export interface BuildScores {
  composite: number;
  grade: string;
  perk_optimality: number;
  curio_efficiency: number;
  talent_coherence: number | null;
  blessing_synergy: number | null;
  role_coverage: number | null;
  breakpoint_relevance: number | null;
  difficulty_scaling: number | null;
}

export interface BuildSummary {
  file: string;
  title: string;
  class: string;
  ability: string | null;
  keystone: string | null;
  weapons: WeaponSummary[];
  scores: BuildScores;
}
```

- [ ] **Step 4: Create `website/src/lib/filter-sort.ts`**

```ts
import type { BuildSummary, BuildScores } from "./types.js";

export interface FilterOptions {
  class?: string;
  weapon?: string;
  minGrade?: string;
  sort?: string;
  reverse?: boolean;
}

const GRADE_ORDER = ["S", "A", "B", "C", "D"];

type ScoreKey = keyof BuildScores;

export function filterAndSort(
  builds: BuildSummary[],
  options: FilterOptions,
): BuildSummary[] {
  let result = builds;

  if (options.class) {
    const lc = options.class.toLowerCase();
    result = result.filter((b) => b.class.toLowerCase() === lc);
  }

  if (options.weapon) {
    const lc = options.weapon.toLowerCase();
    result = result.filter((b) =>
      b.weapons.some(
        (w) =>
          w.name.toLowerCase().includes(lc) ||
          (w.family != null && w.family.toLowerCase().includes(lc)),
      ),
    );
  }

  if (options.minGrade) {
    const minIdx = GRADE_ORDER.indexOf(options.minGrade);
    if (minIdx >= 0) {
      result = result.filter((b) => {
        const idx = GRADE_ORDER.indexOf(b.scores.grade);
        return idx >= 0 && idx <= minIdx;
      });
    }
  }

  const sortKey = (options.sort ?? "composite") as ScoreKey;
  result = [...result].sort((a, b) => {
    const av = a.scores[sortKey];
    const bv = b.scores[sortKey];
    // nulls last
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (bv as number) - (av as number);
  });

  if (options.reverse) {
    result.reverse();
  }

  return result;
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx tsx --test src/lib/filter-sort.test.ts
```

Expected: All 10 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add website/src/lib/
git commit -m "feat(website): add shared types and filter/sort logic with tests

BuildSummary/BuildScores types mirrored from library.
filterAndSort: class, weapon, grade filtering + multi-key sorting.
10 tests covering all filter/sort paths."
```

---

### Task 3: Data Generation Script

**Files:**
- Create: `website/scripts/generate-data.ts`
- Create: `website/static/data/build-summaries.json` (generated output, checked in)

**Prerequisites:** Root project must be built with generated data present:
```bash
# From repo root (one-time, or after source/scoring changes)
make check
```

- [ ] **Step 1: Create `website/scripts/generate-data.ts`**

This script imports the compiled library and calls `listBuilds` to produce the pre-computed build summaries.

```ts
import { listBuilds } from "../../dist/lib/index.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "..", "static", "data");
const BUILDS_DIR = join(__dirname, "..", "..", "data", "builds");

mkdirSync(OUTPUT_DIR, { recursive: true });

const summaries = listBuilds(BUILDS_DIR);

writeFileSync(
  join(OUTPUT_DIR, "build-summaries.json"),
  JSON.stringify(summaries, null, 2),
);

console.log(`Generated ${summaries.length} build summaries → static/data/build-summaries.json`);
```

Notes:
- Imports from `../../dist/lib/index.js` — the compiled library output.
- `listBuilds` internally loads synergy index, calculator data, and scoring data, then computes a full scorecard for each build.
- Output is `BuildSummary[]` — the same shape as the website's `types.ts`.
- Requires `make check` to have run first (generated data must exist).

- [ ] **Step 2: Run the generation script and verify output**

```bash
cd website && npx tsx scripts/generate-data.ts
```

Expected output: `Generated 24 build summaries → static/data/build-summaries.json`

Verify the output:
```bash
node -e "const d = require('./static/data/build-summaries.json'); console.log(d.length, 'builds'); console.log(d[0].title, d[0].scores.grade);"
```

Expected: `24 builds` followed by the first build's title and grade.

- [ ] **Step 3: Commit (including generated data)**

```bash
git add website/scripts/generate-data.ts website/static/data/build-summaries.json
git commit -m "feat(website): add data generation script

Imports listBuilds from compiled library to pre-compute
BuildSummary[] for all 24 builds. Output checked in as
static/data/build-summaries.json for CI (generated data
files are gitignored and unavailable on GitHub Actions)."
```

---

### Task 4: Build List Page

**Files:**
- Create: `website/src/routes/+page.ts`
- Modify: `website/src/routes/+page.svelte` (replace placeholder)

- [ ] **Step 1: Create `website/src/routes/+page.ts`**

```ts
import type { PageLoad } from "./$types";
import type { BuildSummary } from "$lib/types";

export const load: PageLoad = async ({ fetch }) => {
  const res = await fetch("/data/build-summaries.json");
  const builds: BuildSummary[] = await res.json();
  return { builds };
};
```

Note: During prerendering, SvelteKit's `fetch` reads from `static/`. The data gets serialized into the page HTML — zero client-side fetch on page load.

- [ ] **Step 2: Replace `website/src/routes/+page.svelte`**

```svelte
<script lang="ts">
  import { filterAndSort } from "$lib/filter-sort";

  let { data } = $props();

  // Filter state
  let classFilter = $state("");
  let weaponFilter = $state("");
  let gradeFilter = $state("");

  // Sort state
  let sortKey = $state("composite");
  let sortDesc = $state(true);

  const CLASSES = ["veteran", "zealot", "psyker", "ogryn", "arbites", "hivescum"];
  const GRADES = ["S", "A", "B", "C", "D"];

  const COLUMNS: { key: string; label: string; abbr?: string }[] = [
    { key: "composite", label: "Overall" },
    { key: "perk_optimality", label: "Perks", abbr: "Prk" },
    { key: "curio_efficiency", label: "Curios", abbr: "Cur" },
    { key: "talent_coherence", label: "Talents", abbr: "Tal" },
    { key: "blessing_synergy", label: "Blessings", abbr: "Bls" },
    { key: "role_coverage", label: "Role", abbr: "Rol" },
    { key: "breakpoint_relevance", label: "Breakpoints", abbr: "BP" },
    { key: "difficulty_scaling", label: "Scaling", abbr: "Scl" },
  ];

  let filtered = $derived(
    filterAndSort(data.builds, {
      class: classFilter || undefined,
      weapon: weaponFilter || undefined,
      minGrade: gradeFilter || undefined,
      sort: sortKey,
      reverse: !sortDesc,
    }),
  );

  function toggleSort(key: string) {
    if (sortKey === key) {
      sortDesc = !sortDesc;
    } else {
      sortKey = key;
      sortDesc = true;
    }
  }

  const CLASS_COLORS: Record<string, string> = {
    veteran: "text-amber-400",
    zealot: "text-red-400",
    psyker: "text-violet-400",
    ogryn: "text-green-400",
    arbites: "text-blue-400",
    hivescum: "text-yellow-300",
  };

  const GRADE_STYLES: Record<string, string> = {
    S: "text-amber-300 bg-amber-950/50 border-amber-800",
    A: "text-emerald-300 bg-emerald-950/50 border-emerald-800",
    B: "text-sky-300 bg-sky-950/50 border-sky-800",
    C: "text-yellow-300 bg-yellow-950/50 border-yellow-800",
    D: "text-red-300 bg-red-950/50 border-red-800",
  };

  function scoreColor(v: number | string | null): string {
    if (v == null) return "text-gray-600";
    const n = typeof v === "string" ? 0 : v;
    if (n >= 4) return "text-emerald-400";
    if (n >= 3) return "text-sky-400";
    if (n >= 2) return "text-yellow-400";
    return "text-red-400";
  }
</script>

<svelte:head>
  <title>Builds — Hadron's Blessing</title>
</svelte:head>

<div class="flex items-baseline justify-between mb-6">
  <h1 class="text-2xl font-bold">Builds</h1>
  <span class="text-gray-500 text-sm">
    {filtered.length} of {data.builds.length} builds
  </span>
</div>

<!-- Filters -->
<div class="flex flex-wrap gap-3 mb-6">
  <select
    bind:value={classFilter}
    class="bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm
           focus:outline-none focus:border-amber-600"
  >
    <option value="">All Classes</option>
    {#each CLASSES as cls}
      <option value={cls}>{cls.charAt(0).toUpperCase() + cls.slice(1)}</option>
    {/each}
  </select>

  <input
    type="text"
    bind:value={weaponFilter}
    placeholder="Filter by weapon..."
    class="bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm w-52
           focus:outline-none focus:border-amber-600"
  />

  <select
    bind:value={gradeFilter}
    class="bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm
           focus:outline-none focus:border-amber-600"
  >
    <option value="">Any Grade</option>
    {#each GRADES as grade}
      <option value={grade}>{grade}+</option>
    {/each}
  </select>
</div>

<!-- Scorecard Table -->
<div class="overflow-x-auto rounded-lg border border-gray-800">
  <table class="w-full text-sm">
    <thead>
      <tr class="bg-gray-900/80 text-gray-400 text-left">
        <th class="px-4 py-3 font-medium">Build</th>
        <th class="px-3 py-3 font-medium">Class</th>
        <th class="px-3 py-3 font-medium">Weapons</th>
        {#each COLUMNS as col}
          <th class="px-2 py-3 font-medium whitespace-nowrap">
            <button
              class="hover:text-gray-200 transition-colors"
              onclick={() => toggleSort(col.key)}
            >
              <span class="hidden lg:inline">{col.label}</span>
              <span class="lg:hidden">{col.abbr ?? col.label}</span>
              {#if sortKey === col.key}
                <span class="text-amber-400 ml-0.5">{sortDesc ? "\u25BC" : "\u25B2"}</span>
              {/if}
            </button>
          </th>
        {/each}
        <th class="px-3 py-3 font-medium text-center">Grade</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-gray-900">
      {#each filtered as build (build.file)}
        <tr class="hover:bg-gray-900/40 transition-colors">
          <td class="px-4 py-3 font-medium whitespace-nowrap">{build.title}</td>
          <td class="px-3 py-3 capitalize {CLASS_COLORS[build.class] ?? 'text-gray-400'}">
            {build.class}
          </td>
          <td class="px-3 py-3 text-gray-400 text-xs max-w-52 truncate" title={build.weapons.map((w) => w.name).join(", ")}>
            {build.weapons.map((w) => w.name).join(", ")}
          </td>
          {#each COLUMNS as col}
            {@const val = build.scores[col.key as keyof typeof build.scores]}
            <td class="px-2 py-3 tabular-nums text-center {scoreColor(val)}">
              {val ?? "\u2014"}
            </td>
          {/each}
          <td class="px-3 py-3 text-center">
            <span class="inline-block px-2 py-0.5 rounded border text-xs font-bold
                         {GRADE_STYLES[build.scores.grade] ?? ''}">
              {build.scores.grade}
            </span>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

{#if filtered.length === 0}
  <p class="text-center text-gray-500 py-12">No builds match the current filters.</p>
{/if}
```

Notes:
- Svelte 5 runes: `$state` for reactive filter/sort state, `$derived` for computed filtered list.
- `{#each ... (build.file)}` uses `build.file` as the keyed each block key for efficient DOM updates.
- Responsive: full dimension labels on `lg:` screens, abbreviated on smaller screens.
- `tabular-nums` for aligned score columns.
- Darktide-inspired color scheme: amber accent, dark grays, class-specific colors.

- [ ] **Step 3: Verify in dev server**

```bash
cd website && npm run dev
```

Expected:
- Table shows all 24 builds with scores and letter grades.
- Class filter dropdown works (e.g. selecting "Psyker" shows 4 builds).
- Weapon filter works (e.g. typing "autogun" narrows results).
- Grade filter works (e.g. "A+" shows only S and A builds).
- Column header clicks sort by that dimension.
- Clicking same column header toggles ascending/descending.
- Score values are color-coded (green for high, red for low).
- Grade badges have class-appropriate colors.

- [ ] **Step 4: Commit**

```bash
git add website/src/routes/
git commit -m "feat(website): build list page with scorecard table

Filterable by class, weapon (substring), and minimum grade.
Sortable by any of the 7 scoring dimensions + composite.
Score color-coding and class-specific colors.
Data loaded from pre-computed build-summaries.json at prerender."
```

---

### Task 5: Deployment + Integration

**Files:**
- Create: `website/static/.nojekyll`
- Create: `.github/workflows/deploy-website.yml`
- Modify: `Makefile`

- [ ] **Step 1: Create `website/static/.nojekyll`**

Create an empty file:
```bash
touch website/static/.nojekyll
```

Note: GitHub Pages runs Jekyll by default, which ignores directories starting with `_`. SvelteKit's `_app/` directory would be invisible without this file.

- [ ] **Step 2: Create `.github/workflows/deploy-website.yml`**

```yaml
name: Deploy Website

on:
  push:
    branches: ["main"]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: website/package-lock.json

      - name: Install website dependencies
        working-directory: website
        run: npm ci

      - name: Build website
        working-directory: website
        env:
          BASE_PATH: "/${{ github.event.repository.name }}"
        run: npm run build

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: website/build/

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

Notes:
- Only builds the website — does NOT re-run the data pipeline (build-summaries.json is checked in).
- `BASE_PATH` env var is picked up by `svelte.config.js` for correct asset URLs at `hummat.github.io/hadrons-blessing/`.
- Uses `npm ci` (not `npm install`) for reproducible CI builds — requires `website/package-lock.json` to be committed.

- [ ] **Step 3: Add website targets to `Makefile`**

Append to the existing Makefile:

```makefile

# Website
.PHONY: website-data website-build website-dev

website-data: build
	cd website && npx tsx scripts/generate-data.ts

website-build: website-data
	cd website && npm run build

website-dev:
	cd website && npm run dev
```

Notes:
- `website-data` depends on `build` (root project must be compiled first).
- `website-build` runs the full pipeline: compile library → generate data → build SvelteKit.
- `website-dev` is a convenience target for local development.

- [ ] **Step 4: Ensure `website/package-lock.json` exists**

```bash
cd website && npm install
```

This creates `package-lock.json` which must be committed for CI's `npm ci`.

- [ ] **Step 5: Run full build and verify**

```bash
cd website && npm run build
```

Expected:
- SvelteKit builds successfully.
- Output in `website/build/` contains `index.html`, `_app/` directory, `data/build-summaries.json`.
- `website/build/index.html` contains the pre-rendered build list with all 24 builds embedded in the HTML.

Verify the prerendered HTML contains build data:
```bash
grep -c "Build 2026\|meta-havoc\|melee-meta" website/build/index.html
```

Expected: Several matches (build titles are baked into the static HTML).

Preview the built site:
```bash
cd website && npm run preview
```

Expected: Opens the production build — identical to dev server but from the static files.

- [ ] **Step 6: Commit**

```bash
git add website/static/.nojekyll website/package-lock.json .github/workflows/deploy-website.yml Makefile
git commit -m "feat(website): GitHub Pages deployment pipeline

GitHub Actions workflow: build SvelteKit → deploy to Pages.
.nojekyll to preserve _app/ directory.
Makefile targets: website-data, website-build, website-dev."
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Build list/browse (Task 4) — scorecard table with letter grades, 7 dimensions, filtering by class/weapon/grade, sorting by any dimension.
- [x] Static JSON data loading (Task 3) — pre-computed BuildSummary[] as static asset.
- [x] Build fixtures as static JSON (Task 3) — all 24 builds included.
- [ ] Build detail view — **deferred to Plan 2**
- [ ] Build comparison — **deferred to Plan 3**
- [ ] Import from GL URL — **deferred to Plan 4**
- [ ] Build smells — **deferred to Plan 4**
- [ ] "Explain This Grade" — **deferred to Plan 2** (part of detail view)

**Placeholder scan:** No TBD, TODO, or "implement later" — all steps have complete code.

**Type consistency:**
- `BuildSummary` / `BuildScores` / `WeaponSummary` — defined in `types.ts`, used in `filter-sort.ts`, `filter-sort.test.ts`, `+page.ts`, `+page.svelte`. Names match across all files.
- `FilterOptions` — defined in `filter-sort.ts`, consumed in `+page.svelte`. Field names match.
- `filterAndSort` — defined in `filter-sort.ts`, imported in `+page.svelte` and test. Signature matches.
