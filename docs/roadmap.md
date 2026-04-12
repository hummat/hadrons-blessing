# Roadmap

Last updated: 2026-04-12

## Current state

Core analytical engine complete: entity resolution, synergy model, 7-dimension scoring, damage/stagger/cleave/toughness calculators, build browse/compare. 25 canonical build fixtures, 1068 tests passing, all 6 classes covered.

Website: SvelteKit static site on GitHub Pages. Build list, detail page, and comparison page functional (Plans 1–3 merged). No design system, no progressive disclosure, no visual hierarchy.

## Active sequence

Ordered by dependency. Each step builds on the previous.

| Priority | Issue | Summary | Blocked by | Effort |
|----------|-------|---------|------------|--------|
| 1 | #27 | Design system foundation — typography, card tiers, progressive disclosure defaults | — | Medium |
| 3 | #26 | Website IA redesign — verdict-first detail page, command-surface list, decisive compare | #27 | High |
| 4 | #25 | Hover detail cards — shared primitive + content adapters for compressed/opaque items | #27, #26 | Medium |

## Independent tracks

Can interleave with the active sequence at any point.

| Issue | Summary | Effort |
|-------|---------|--------|
| #22 | Breakpoint support for unsupported ranged families (flamers, force staves, projectile weapons — 8 builds affected) | Medium-high |
| #24 | Damage-profile extraction for non-fixture template variants (rippergun etc.) | Medium |

## After the active sequence

- **#6 Plan 4:** GL import + interactive features (paste a GL URL, scrape → canonicalize → display in-browser)
- **#6 umbrella cleanup:** Close or narrow #6 once Plan 4 scope is defined as its own issue

## v1.1 (deferred)

Per CLAUDE.md and design specs:

- `suggest-improvement` brute-force candidate enumeration for recommendations
- Build editor with interactive talent tree (Svelte Flow)
- What-if swap analysis with live scoring
- Damage pipeline storyboard
- Toughness scorecard dimension

## v2+ horizon

- Goal-first optimizer
- Encounter lenses
- Sensitivity analysis
- Constraint solver
- Pareto frontier
- Breakpoint query builder
- Shareable proof links

## Completed milestones

| Issue | Summary | Completed |
|-------|---------|-----------|
| #1 | TypeScript migration | 2026-03 |
| #4 | BetterBots integration contract | 2026-03 |
| #5 | Calculator and dataflow layer | 2026-03 |
| #7 | Buff semantic extraction | 2026-03 |
| #8 | Synergy model | 2026-03 |
| #9 | Build quality scoring (7 dimensions) | 2026-03 |
| #10 | Modification recommendations v1 | 2026-03 |
| #11 | Toughness calculator | 2026-03 |
| #12 | Stagger calculator | 2026-03 |
| #13 | Cleave multi-target simulation | 2026-03 |
| #3 | Build browse and compare (CLI) | 2026-03 |
| #16 | Weapon mark mapping correction | 2026-04 |
| #19 | Class-side entity + GL alias automation | 2026-04 |
| #20 | Scoring data gaps | 2026-04 |
| #23 | Null weapon perk entries fix | 2026-04 |
| #6 Plans 1–3 | Website: list, detail, compare pages | 2026-04 |
| #21 | GL alias coverage beyond fixture set | 2026-04 |
