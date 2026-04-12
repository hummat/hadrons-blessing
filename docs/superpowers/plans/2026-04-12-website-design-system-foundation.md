# Website Design System Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a shared dark Games-Lantern-adjacent design system across the existing website shell, build list, build detail, and compare pages without changing page information architecture.

**Architecture:** Add a semantic theme layer in `website/src/app.css`, keep route logic intact, and retrofit the three current surfaces to consume shared panel/control/disclosure classes. Use a small source-contract test to lock in the presence of semantic tokens and route adoption, rather than relying on subjective visual memory.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Tailwind CSS v4 import-only setup, plain CSS custom properties, TypeScript, Node test runner via `tsx --test`.

---

## File Map

- `website/src/app.css`
  - Source of truth for theme tokens, panel tiers, form controls, table chrome, disclosure styling, and shell classes.
- `website/src/app.html`
  - Minimal global body hook for the new site background/body treatment.
- `website/src/lib/builds.ts`
  - Existing class/grade/score color helpers. Keep public API stable, but switch returned class names to semantic theme classes.
- `website/src/lib/theme-contract.test.ts`
  - New source-level UI contract test. Verifies semantic theme classes exist and current routes adopt them.
- `website/src/routes/+layout.svelte`
  - Shared shell frame: header, content well, footer.
- `website/src/routes/+page.svelte`
  - Build list route. Retrofit to use shared panel/control/table classes.
- `website/src/routes/builds/[slug]/+page.svelte`
  - Build detail route. Retrofit to use panel tiers, shared labels, and disclosure styling.
- `website/src/routes/compare/+page.svelte`
  - Compare route. Retrofit selectors, deltas, and section blocks to shared system classes.

## Task 1: Add a Failing Theme Contract Test

**Files:**
- Create: `website/src/lib/theme-contract.test.ts`

- [ ] **Step 1: Write the failing theme contract test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

describe("website theme contract", () => {
  it("defines semantic shell and panel classes in app.css", () => {
    const css = read("app.css");
    assert.match(css, /:root\s*\{[\s\S]*--hb-bg-canvas:/);
    assert.match(css, /\.site-shell\b/);
    assert.match(css, /\.panel\b/);
    assert.match(css, /\.panel-strong\b/);
    assert.match(css, /\.panel-muted\b/);
    assert.match(css, /\.form-control\b/);
    assert.match(css, /\.disclosure\b/);
  });

  it("routes consume semantic theme classes instead of raw gray slab recipes", () => {
    const layout = read("routes/+layout.svelte");
    const list = read("routes/+page.svelte");
    const detail = read("routes/builds/[slug]/+page.svelte");
    const compare = read("routes/compare/+page.svelte");

    assert.match(layout, /site-shell/);
    assert.match(layout, /site-header/);
    assert.match(list, /panel/);
    assert.match(list, /form-control/);
    assert.match(detail, /panel-strong/);
    assert.match(detail, /disclosure/);
    assert.match(compare, /panel-strong/);

    assert.ok(!list.includes("bg-gray-900/90"));
    assert.ok(!detail.includes("rounded-2xl border border-gray-800 bg-gray-900"));
    assert.ok(!compare.includes("rounded-2xl border border-gray-800 bg-gray-900 p-5"));
  });
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `cd website && npm test -- src/lib/theme-contract.test.ts`
Expected: FAIL because `app.css` does not define semantic theme classes and current routes still use raw `gray-*` surface recipes.

- [ ] **Step 3: Commit the failing test**

```bash
git add website/src/lib/theme-contract.test.ts
git commit -m "test: add website theme contract"
```


## Task 2: Implement Global Theme Tokens And Semantic Color Helpers

**Files:**
- Modify: `website/src/app.css`
- Modify: `website/src/app.html`
- Modify: `website/src/lib/builds.ts`
- Test: `website/src/lib/theme-contract.test.ts`

- [ ] **Step 1: Add the minimal global theme layer to `app.css`**

```css
@import "tailwindcss";

:root {
  --hb-bg-canvas: #090b10;
  --hb-bg-elevated: #11151d;
  --hb-bg-strong: #161b24;
  --hb-bg-muted: #0d1118;
  --hb-border: #262d3a;
  --hb-border-strong: #3a4354;
  --hb-text-main: #f2eee5;
  --hb-text-muted: #b8b1a3;
  --hb-text-faint: #7f7a72;
  --hb-accent: #d08a3c;
  --hb-accent-soft: rgba(208, 138, 60, 0.18);
  --hb-danger: #a84a42;
  --hb-success: #5c9a7a;
  --hb-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
}

html,
body {
  min-height: 100%;
  background:
    radial-gradient(circle at top, rgba(208, 138, 60, 0.08), transparent 32%),
    linear-gradient(180deg, #0b0e14 0%, var(--hb-bg-canvas) 28%, #06080d 100%);
  color: var(--hb-text-main);
}

.site-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.panel {
  border: 1px solid var(--hb-border);
  background: color-mix(in srgb, var(--hb-bg-elevated) 92%, transparent);
  box-shadow: var(--hb-shadow);
}

.panel-strong {
  border: 1px solid var(--hb-border-strong);
  background:
    linear-gradient(180deg, rgba(208, 138, 60, 0.07), transparent 35%),
    color-mix(in srgb, var(--hb-bg-strong) 96%, transparent);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.4);
}

.panel-muted {
  border: 1px solid rgba(58, 67, 84, 0.7);
  background: color-mix(in srgb, var(--hb-bg-muted) 94%, transparent);
}

.form-control {
  border: 1px solid var(--hb-border);
  background: var(--hb-bg-muted);
  color: var(--hb-text-main);
}

.form-control:focus {
  outline: none;
  border-color: var(--hb-accent);
  box-shadow: 0 0 0 3px rgba(208, 138, 60, 0.18);
}

.disclosure {
  border: 1px solid var(--hb-border);
  background: var(--hb-bg-muted);
}

.disclosure > summary {
  cursor: pointer;
  list-style: none;
}
```

- [ ] **Step 2: Hook the body and root shell into the new classes**

```html
<body class="site-body" data-sveltekit-preload-data="hover">
  <div style="display: contents">%sveltekit.body%</div>
</body>
```

```svelte
<div class="site-shell">
  {@render children()}
</div>
```

- [ ] **Step 3: Switch `builds.ts` helpers to semantic class names**

```ts
export const CLASS_COLORS: Record<string, string> = {
  veteran: "text-class-veteran",
  zealot: "text-class-zealot",
  psyker: "text-class-psyker",
  ogryn: "text-class-ogryn",
  arbites: "text-class-arbites",
  "hive scum": "text-class-scum",
};

export const GRADE_STYLES: Record<string, string> = {
  S: "grade-badge grade-badge--s",
  A: "grade-badge grade-badge--a",
  B: "grade-badge grade-badge--b",
  C: "grade-badge grade-badge--c",
  D: "grade-badge grade-badge--d",
};

export function scoreColor(v: number | string | null): string {
  if (v == null) return "score-value score-value--null";
  const n = typeof v === "string" ? 0 : v;
  if (n >= 4) return "score-value score-value--high";
  if (n >= 3) return "score-value score-value--mid";
  if (n >= 2) return "score-value score-value--warn";
  return "score-value score-value--low";
}

export function htkCellClass(htk: number | null): string {
  if (htk == null) return "htk-cell htk-cell--null";
  if (htk <= 1) return "htk-cell htk-cell--best";
  if (htk === 2) return "htk-cell htk-cell--mid";
  return "htk-cell htk-cell--worst";
}
```

- [ ] **Step 4: Extend `app.css` with the semantic helper classes returned by `builds.ts`**

```css
.text-class-veteran { color: #d7b56d; }
.text-class-zealot { color: #d67b66; }
.text-class-psyker { color: #9f8ae8; }
.text-class-ogryn { color: #83ad79; }
.text-class-arbites { color: #78a7d9; }
.text-class-scum { color: #c0a85f; }

.grade-badge {
  display: inline-block;
  border-radius: 999px;
  border: 1px solid var(--hb-border);
  padding: 0.25rem 0.75rem;
  font-weight: 700;
}

.grade-badge--s { color: #f1d48a; background: rgba(112, 72, 20, 0.34); border-color: #8b6428; }
.grade-badge--a { color: #a5d9bd; background: rgba(35, 78, 59, 0.34); border-color: #3f7257; }
.grade-badge--b { color: #95c1e8; background: rgba(26, 57, 88, 0.34); border-color: #41658b; }
.grade-badge--c { color: #d9be77; background: rgba(97, 73, 24, 0.34); border-color: #8b6e2e; }
.grade-badge--d { color: #df8d82; background: rgba(103, 34, 31, 0.34); border-color: #874742; }

.score-value--high { color: #9ed5b8; }
.score-value--mid { color: #89b6dc; }
.score-value--warn { color: #d3b56f; }
.score-value--low { color: #d48880; }
.score-value--null { color: var(--hb-text-faint); }
```

- [ ] **Step 5: Run the focused contract test**

Run: `cd website && npm test -- src/lib/theme-contract.test.ts`
Expected: FAIL, but now only on route adoption assertions because semantic classes exist and helper-class tests pass.

- [ ] **Step 6: Commit the theme foundation**

```bash
git add website/src/app.css website/src/app.html website/src/lib/builds.ts
git commit -m "feat: add website theme tokens and semantic color helpers"
```


## Task 3: Retrofit The Shared Shell And Build List Route

**Files:**
- Modify: `website/src/routes/+layout.svelte`
- Modify: `website/src/routes/+page.svelte`
- Test: `website/src/lib/theme-contract.test.ts`

- [ ] **Step 1: Tighten the contract test around shell/list adoption**

```ts
it("uses shared shell classes in layout and command-surface classes on the build list", () => {
  const layout = read("routes/+layout.svelte");
  const list = read("routes/+page.svelte");

  assert.match(layout, /site-shell/);
  assert.match(layout, /site-header/);
  assert.match(layout, /site-main/);
  assert.match(layout, /site-footer/);

  assert.match(list, /page-title/);
  assert.match(list, /panel\b/);
  assert.match(list, /panel-muted/);
  assert.match(list, /form-control/);
  assert.match(list, /data-table/);
  assert.ok(!list.includes("bg-gray-900/90"));
});
```

- [ ] **Step 2: Run the focused contract test and verify failure**

Run: `cd website && npm test -- src/lib/theme-contract.test.ts`
Expected: FAIL because the layout and list page still use route-local Tailwind gray recipes and do not include the required semantic classes.

- [ ] **Step 3: Retrofit the shell in `+layout.svelte`**

```svelte
<div class="site-shell">
  <header class="site-header">
    <nav class="site-nav">
      <a href="{base}/" class="site-mark">Hadron's Blessing</a>
      <a href="{base}/" class="site-nav-link">Builds</a>
    </nav>
  </header>

  <main class="site-main">
    {@render children()}
  </main>

  <footer class="site-footer">
    Source-backed Darktide build analysis
  </footer>
</div>
```

```css
.site-header {
  border-bottom: 1px solid var(--hb-border);
  background:
    linear-gradient(180deg, rgba(208, 138, 60, 0.08), transparent 85%),
    rgba(10, 13, 19, 0.92);
  backdrop-filter: blur(16px);
}

.site-nav,
.site-main {
  width: min(110rem, calc(100% - 2.5rem));
  margin-inline: auto;
}
```

- [ ] **Step 4: Retrofit the build list route to shared page, tray, and table classes**

```svelte
<div class="page-stack page-stack--tight">
  <div class="page-heading">
    <div>
      <h1 class="page-title">Builds</h1>
      <p class="page-subtitle">
        Browse current fixture corpus, filter quickly, then compare two builds side by side.
      </p>
    </div>
    <span class="page-meta">{filtered.length} of {data.builds.length} builds</span>
  </div>

  <section class="panel control-surface">
    <div class="control-surface__row">
      <div class="control-cluster">
        <label class="field-stack">
          <span class="field-label">Class</span>
          <select bind:value={classFilter} class="form-control">...</select>
        </label>
        <label class="field-stack">
          <span class="field-label">Weapon</span>
          <input bind:value={weaponFilter} class="form-control form-control--wide" />
        </label>
      </div>

      <div class="panel-muted compare-callout">
        <div class="field-label">Compare</div>
        <div class="compare-callout__copy">{compareCountLabel}</div>
        <button type="button" class:button-primary={compareReady} class:button-disabled={!compareReady}>Compare selected</button>
      </div>
    </div>
  </section>

  <div class="panel data-table-wrap">
    <table class="data-table">...</table>
  </div>
</div>
```

- [ ] **Step 5: Run the focused contract test**

Run: `cd website && npm test -- src/lib/theme-contract.test.ts`
Expected: FAIL only on detail/compare route adoption assertions.

- [ ] **Step 6: Commit the shell and list retrofit**

```bash
git add website/src/routes/+layout.svelte website/src/routes/+page.svelte
git commit -m "feat: retrofit website shell and build list styling"
```


## Task 4: Retrofit The Detail And Compare Routes, Including Disclosure Styling

**Files:**
- Modify: `website/src/routes/builds/[slug]/+page.svelte`
- Modify: `website/src/routes/compare/+page.svelte`
- Modify: `website/src/app.css`
- Test: `website/src/lib/theme-contract.test.ts`

- [ ] **Step 1: Extend the contract test for detail/compare route adoption**

```ts
it("uses shared panel tiers and disclosure styling on detail and compare pages", () => {
  const detail = read("routes/builds/[slug]/+page.svelte");
  const compare = read("routes/compare/+page.svelte");

  assert.match(detail, /panel-strong/);
  assert.match(detail, /panel\b/);
  assert.match(detail, /panel-muted/);
  assert.match(detail, /disclosure/);
  assert.match(compare, /panel-strong/);
  assert.match(compare, /panel\b/);
  assert.match(compare, /form-control/);

  assert.ok(!detail.includes("rounded-2xl border border-gray-800 bg-gray-900"));
  assert.ok(!compare.includes("rounded-2xl border border-gray-800 bg-gray-900 p-5"));
});
```

- [ ] **Step 2: Run the focused contract test and verify failure**

Run: `cd website && npm test -- src/lib/theme-contract.test.ts`
Expected: FAIL because the detail and compare routes still use route-local Tailwind gray blocks and unstyled disclosures.

- [ ] **Step 3: Retrofit the detail page to shared panels and disclosure classes**

```svelte
<div class="page-stack">
  <div class="page-crumbs">
    <a href={`${base}/`} class="crumb-link">← Back to builds</a>
    <a href={`${base}/compare?builds=${data.detail.slug},`} class="crumb-link">Compare with...</a>
  </div>

  <section class="panel-strong hero-panel">
    ...
  </section>

  <section class="section-stack">
    <div class="section-heading">
      <h2 class="section-title">Scorecard Overview</h2>
      <span class="section-meta">Seven dimensions + composite</span>
    </div>

    <div class="metric-grid">
      <article class="panel metric-card">...</article>
    </div>
  </section>

  <details class="disclosure">
    <summary class="disclosure__summary">Show {hiddenSynergyCount} more synergy edges</summary>
    <ul class="disclosure__body">...</ul>
  </details>
</div>
```

- [ ] **Step 4: Retrofit the compare page to shared trays, panels, and controls**

```svelte
<div class="page-stack">
  <div class="page-crumbs">
    <a href={`${base}/`} class="crumb-link">← Back to builds</a>
  </div>

  <div class="page-heading">
    <h1 class="page-title">Compare Builds</h1>
  </div>

  <section class="panel-strong selection-tray">
    <div class="selection-grid">
      <label class="field-stack">
        <span class="field-label">Build A</span>
        <select bind:value={buildASlug} class="form-control">...</select>
      </label>

      <button type="button" class="button-secondary">Swap A ↔ B</button>

      <label class="field-stack">
        <span class="field-label">Build B</span>
        <select bind:value={buildBSlug} class="form-control">...</select>
      </label>
    </div>
  </section>

  <section class="panel comparison-section">...</section>
</div>
```

- [ ] **Step 5: Add any missing shared classes needed by the retrofits**

```css
.hero-panel,
.selection-tray {
  border-radius: 1.5rem;
  padding: 1.5rem;
}

.page-title {
  font-family: Iowan Old Style, Palatino Linotype, Book Antiqua, Georgia, serif;
  font-size: clamp(2rem, 3vw, 3rem);
  line-height: 1.02;
  color: var(--hb-text-main);
}

.field-label {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--hb-text-faint);
}

.disclosure__summary::after {
  content: "+";
  color: var(--hb-accent);
}

details[open] > .disclosure__summary::after {
  content: "−";
}
```

- [ ] **Step 6: Run the focused contract test**

Run: `cd website && npm test -- src/lib/theme-contract.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit the detail and compare retrofit**

```bash
git add website/src/routes/builds/[slug]/+page.svelte website/src/routes/compare/+page.svelte website/src/app.css
git commit -m "feat: apply design system to website detail and compare pages"
```


## Task 5: Full Verification And Browser Gut-Check

**Files:**
- Test: `website/src/lib/theme-contract.test.ts`
- Verify: `website/src/lib/*.test.ts`
- Verify: `website/src/routes/+page.svelte`
- Verify: `website/src/routes/builds/[slug]/+page.svelte`
- Verify: `website/src/routes/compare/+page.svelte`

- [ ] **Step 1: Run the full website test suite**

Run: `cd website && npm test`
Expected: PASS, including `theme-contract.test.ts` and the existing data/filter/detail-format tests.

- [ ] **Step 2: Run the production build**

Run: `cd website && npm run build`
Expected: PASS with static pages generated and no Svelte compile errors.

- [ ] **Step 3: Run a local browser verification pass**

Run: `cd website && npm run dev`
Expected: Dev server starts locally.

Manual checks:
- `/` reads as a command surface, not a gray slab table dump
- one build detail page has a clear `panel-strong` top block and readable metric hierarchy
- one compare page has a clear selector tray and cohesive section styling
- disclosure affordances are obvious and secondary detail stays visually subordinate

- [ ] **Step 4: Commit the verified finish**

```bash
git add website/src/app.css website/src/app.html website/src/lib/builds.ts website/src/lib/theme-contract.test.ts website/src/routes/+layout.svelte website/src/routes/+page.svelte website/src/routes/builds/[slug]/+page.svelte website/src/routes/compare/+page.svelte
git commit -m "feat: add website design system foundation"
```

## Self-Review

### Spec coverage

- Shared tokenized shell: covered by Tasks 2 and 3.
- Typography and surface tiers: covered by Tasks 2 and 4.
- Build list/detail/compare adoption: covered by Tasks 3 and 4.
- Disclosure defaults/styling: covered by Task 4.
- Verification requirements: covered by Task 5.

No spec gaps found.

### Placeholder scan

- No `TBD` / `TODO` placeholders present.
- Every task includes explicit file paths, commands, and code snippets.
- Verification commands are concrete.

### Type and interface consistency

- Theme contract test targets concrete file paths that exist today.
- `CLASS_COLORS`, `GRADE_STYLES`, `scoreColor()`, and `htkCellClass()` stay in `website/src/lib/builds.ts`, so route imports remain stable.
- Shared CSS class names used in later tasks are introduced in Task 2 and extended in Task 4.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-12-website-design-system-foundation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
