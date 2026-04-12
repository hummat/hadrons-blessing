# Website Design System Foundation — Design Spec

**Issue:** #27 — Design system foundation for website surfaces
**Date:** 2026-04-12
**Scope:** Apply a shared visual system to the existing website shell, build list, build detail, and compare pages. No information-architecture rewrite in this issue.

## Motivation

The website already ships the core product surfaces, but the presentation is still raw Tailwind gray with page-local styling. The current UI has weak hierarchy, no shared surface language, and inconsistent disclosure behavior. That blocks #26: an IA redesign on top of an unstable visual system will either duplicate styling work or collapse into ad hoc page-local decisions again.

Issue #27 exists to establish a durable baseline: shared tokens, typography, surface tiers, control styling, and disclosure defaults. It should make the current pages feel intentional and game-adjacent without changing their structure.

## Chosen Approach: System Retrofit

Apply a shared system to real pages now, but keep the work strictly presentational.

Rejected alternatives:

- **Full redesign in #27:** better immediate visual payoff, but it overlaps heavily with #26 and muddies ownership of layout/IA decisions.
- **Component-library-first:** likely to create abstractions without pressure-testing them on real pages. Higher maintenance, weaker outcome.

This issue should prove the system on all three existing surfaces:

- `/` build list
- `/builds/[slug]` detail page
- `/compare` compare page

## Visual Direction

### Thesis

Dark steel base, ember accent, muted parchment text. Mood should be reminiscent of Games Lantern's Darktide presentation, but cleaner, denser, and more operational.

### Constraints

- Keep the site dark.
- Avoid generic Tailwind gray slab stacking.
- Do not chase decorative spectacle. This is a build analysis tool, not a promo microsite.
- Use a small visual vocabulary: dark layered surfaces, restrained glow, sharp typography hierarchy, limited accent use.

## System Boundaries

### In scope

- semantic theme tokens in `website/src/app.css`
- shared shell styling in `website/src/routes/+layout.svelte`
- shared surface tiers, label styles, pills, form controls, table affordances, and `details` styling
- light presentational cleanup on the list/detail/compare routes to consume the new system
- limited reuse via tiny presentational wrappers only if repetition is obvious

### Out of scope

- no page flow rewrite
- no new data loading behavior
- no hover detail cards (#25)
- no verdict-first structural reorganization (#26)
- no new route components for speculative future use

## Architecture

### Layer 1: Global Tokens in `app.css`

`website/src/app.css` becomes the source of truth for visual tokens and a thin set of semantic utilities.

### Token categories

- background layers
- surface colors
- border colors
- text levels
- accent colors
- warning/caution colors
- radius, shadow, and transition defaults

These should be expressed as CSS custom properties on `:root` plus a small number of semantic utility classes. Route files should consume those classes instead of hardcoding large runs of `bg-gray-* border-gray-* text-gray-*`.

### Semantic utility targets

Small, stable class set only:

- page shell
- `panel`
- `panel-strong`
- `panel-muted`
- section labels / eyebrow text
- badge / pill treatments
- form controls
- table row hover/selected states
- disclosure styling for `details` / `summary`

The goal is not to replace Tailwind with a local design framework. The goal is to stop repeating page-local color recipes.

### Layer 2: Typography

### Typeface strategy

Two-role typography:

- display serif stack for page titles and key section headings
- clean sans stack for UI copy, controls, tables, metadata, and dense analytical text

Implementation rule: prefer no new dependency if local/web-safe stacks produce a strong enough result. Only add a font package if the browser result is visibly weak.

### Hierarchy

Strengthen distinction between:

- page title
- section heading
- panel label
- metadata
- score/value numerals

Uppercase micro-labels remain, but their use should be more selective. They work as an accent, not as the default heading style for every block.

### Layer 3: Surface Tiers

Three tiers, reused everywhere.

### `panel-strong`

Used for:

- hero/verdict blocks
- selection trays that need primary emphasis
- major score or summary containers

Visual traits:

- highest contrast surface
- slightly stronger border
- restrained glow or shadow
- the clearest separation from page background

### `panel`

Default content container.

Used for:

- ordinary sections
- data groups
- comparison blocks
- metric cards

### `panel-muted`

Inset/supporting surface.

Used for:

- pills
- subpanels
- expanded disclosure bodies
- control trays
- internal grouping inside larger panels

### Layer 4: Shell

`website/src/routes/+layout.svelte` should establish a stable frame for all pages:

- stronger site identity in header
- cleaner separation between header, content well, and footer
- shared max-width and spacing behavior
- less generic “app shell generated from gray utilities”

This is still a static site shell, not a navigation redesign. Header links and routing stay minimal.

## Route Application

### `/` Build List

Goals:

- make the page read like a command surface, not a raw table dump
- normalize filter tray and compare tray into system pieces
- preserve current table structure and sorting behavior

Changes:

- page intro uses stronger title treatment
- filter area moves onto shared `panel`/`panel-muted` language
- compare selection block becomes visually primary enough to be discoverable
- table chrome uses shared borders, row hover, sticky header treatment, and selected-state language

No changes to:

- filter semantics
- compare behavior
- column structure

### `/builds/[slug]` Detail Page

Goals:

- upgrade verdict/hero block
- normalize metric cards and content sections
- improve scan speed without rearranging sections

Changes:

- top summary block becomes `panel-strong`
- metric cards use shared tier logic instead of per-block ad hoc gray recipes
- “build structure”, “scorecard overview”, “weapons”, “synergy”, and “breakpoints” sections share container rules
- pills and slot tiles share a common shape language

No changes to:

- section order
- payload interpretation
- displayed data categories

### `/compare` Compare Page

Goals:

- align selectors and delta displays to same hierarchy as detail/list pages
- reduce “box soup”

Changes:

- build selection tray uses shared high-emphasis container rules
- comparison deltas, selectors, and section blocks use the same tier language as detail page
- form elements and comparison states share control styling with the list page

No changes to:

- compare logic
- selected scenarios/difficulties behavior
- analytical diff content

## Disclosure Defaults

Current disclosure behavior exists but is visually weak and inconsistent.

This issue standardizes two rules:

1. Secondary detail stays collapsed by default.
2. Summary row must carry meaningful value before expansion.

Applies especially to:

- overflow synergy edges
- anti-synergy detail lists
- other long supporting breakdowns already modeled as `details`

#27 does not decide new verdict-first hiding strategy. That remains #26.

## Motion

Motion should be present but cheap.

Allowed:

- soft hover contrast/lift on actionable surfaces
- subtle focus transitions on controls
- optional lightweight entrance fade/translate for major sections if implementation cost is low

Not allowed:

- large scroll choreography
- decorative motion with no hierarchy value
- anything that risks making the analytical UI feel sluggish

## Implementation Guidance

- Start in CSS, not in route-local Tailwind strings.
- Extract tiny presentational components only where repetition is obvious and stable.
- Prefer semantic classes over large copied class bundles.
- Keep data and control logic untouched unless a presentational cleanup requires a trivial rename or wrapper.

Likely touch points:

- `website/src/app.css`
- `website/src/routes/+layout.svelte`
- `website/src/routes/+page.svelte`
- `website/src/routes/builds/[slug]/+page.svelte`
- `website/src/routes/compare/+page.svelte`

Possible tiny shared component/helpers:

- a generic panel wrapper
- a pill/badge wrapper

These are optional. CSS-first is preferred unless Svelte duplication becomes materially ugly.

## Acceptance Criteria

1. All three current website surfaces share a single tokenized shell and surface system.
2. The site no longer reads as raw Tailwind gray slabs.
3. Detail and compare pages preserve current information architecture.
4. Filter controls, compare selectors, table states, and `details` blocks have visibly shared styling.
5. No behavior or data regressions are introduced.

## Verification

Required:

```bash
cd website && npm run test
cd website && npm run build
```

Required manual/browser check:

- `/`
- one build detail page
- one compare page

Verification focus:

- no broken contrast or unreadable text
- disclosure affordances are clear
- table and form states still read cleanly
- system feels cohesive across all three surfaces

## Risks

### Scope creep into #26

Mitigation: reject structural page rewrites during #27. If a change alters content order or page-level emphasis strategy beyond styling, it belongs in #26.

### Over-abstraction

Mitigation: do not build a component library for its own sake. Only extract wrappers when duplication is repetitive and clearly stable.

### Font churn

Mitigation: prefer no new dependency first. Add a font package only if the result is visibly inadequate during browser verification.

## Follow-on Work

- **#26:** verdict-first detail hierarchy, compare decisiveness, broader IA cleanup
- **#25:** hover detail cards built on top of the new shared surface language
