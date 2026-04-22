# Roadmap

Last updated: 2026-04-22

## Current state

Core analytical engine complete: entity resolution, synergy model, 8-dimension scoring, damage/stagger/cleave/toughness calculators, build browse/compare, and `hb analyze` for end-to-end CLI analysis. 24 canonical build fixtures, full test suite green, all 6 classes covered.

Website: SvelteKit static site on GitHub Pages. Build list, detail page, and comparison page functional (Plans 1–3 merged). Imperial Dataslate aesthetic now covers the detail page and list route; compare page still on the original `panel-strong` theme pending its verdict-first IA pass.

Product-level MVP blockers are documented separately in [docs/mvp.md](docs/mvp.md). The short version: the engine is ahead of the user surfaces; the missing work is website import flow plus CLI productization.

## Active sequence

Ordered by dependency. Each step builds on the previous.

| Priority | Issue | Summary | Blocked by | Effort |
|----------|-------|---------|------------|--------|
| 1 | #26 | Website IA redesign — compare page verdict-first overview, route-wide progressive disclosure (detail + list tranches already shipped) | — | Medium |
| 2 | #25 | Hover detail cards — shared primitive + content adapters for compressed/opaque items | #26 | Medium |

## After the active sequence

- **#6 Plan 4:** GL import + interactive features (paste a GL URL, scrape → canonicalize → display in-browser)
- **#6 umbrella cleanup:** Close or narrow #6 once Plan 4 scope is defined as its own issue

## v1.1 (deferred)

Per CLAUDE.md and design specs:

- `suggest-improvement` brute-force candidate enumeration for recommendations
- Build editor with interactive talent tree (Svelte Flow)
- What-if swap analysis with live scoring
- Damage pipeline storyboard

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
| #9 | Build quality scoring | 2026-03 |
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
| #27 | Website design system foundation | 2026-04 |
| #26 detail tranche | Detail page verdict-first IA | 2026-04 |
| #26 list tranche | List page as Commander's Manifest (Dataslate theme) | 2026-04 |
| #22 | Breakpoint support for unsupported ranged families | 2026-04 |
| #24 | Damage-profile extraction for non-fixture template variants | 2026-04 |
| #28 | Survivability scoring dimension | 2026-04 |
| #29 | Productized CLI with `hb analyze` | 2026-04 |
