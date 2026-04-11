# 2026-04-11 UI Low-Hanging Fruit Design

## Goal

Improve the website's scanability, density, and navigation without changing routes, data contracts, or overall information architecture.

This is a cleanup pass, not a redesign. The site should feel easier to read and faster to operate while preserving the current static-data flow and page set:

- build list
- build detail
- build compare

## Non-Goals

- no new pages
- no visual rebrand
- no backend or schema changes unless a small derived helper is required for presentation
- no removal of analytical detail from the product; only better disclosure and grouping

## Problems Observed

### Build list

- filter controls are visually weak and feel detached from the table
- compare flow is present but low-signal
- weapon slots are readable but still noisy in dense rows
- score headers are usable but not especially scannable

### Build detail

- useful summary information exists, but the page front-loads too much structure before actionable interpretation
- analytical sections are long and visually flat
- repeated panels create a "dump" feeling rather than a guided reading order
- secondary diagnostics deserve progressive disclosure

### Build compare

- overview is functional but still too repetitive
- shared/only-in-A/only-in-B sections are visually bulky for small deltas
- slot and curio differences do not surface the most important signal quickly enough

## Chosen Approach

Use a progressive-disclosure cleanup pass:

- compress high-frequency information
- elevate summary and decision-making views
- collapse or visually soften secondary detail
- improve control affordance and selection feedback

This keeps implementation risk low while producing a meaningful improvement.

## Intended Changes

### Build list

- make the filter/compare bar feel like a single control surface
- tighten table density without harming legibility
- improve row hover and compare-selection state
- make weapon slot rendering more compact and aligned
- improve score-column scanability

### Build detail

- strengthen the header into a clearer "at a glance" summary
- compress Build Structure and Scorecard presentation
- convert long secondary analysis blocks into collapsible sections or lighter-weight summaries where appropriate
- improve section spacing and hierarchy so the page reads top-down in a more deliberate order
- keep source-backed detail available, but stop forcing it all open by default

### Build compare

- make Overview the fastest path to a decision
- improve score delta readability
- deduplicate or compress repeated shared-item presentation
- make slot diffs easier to parse as change chips rather than prose-like blocks
- keep detailed tabs, but reduce list bulk where the signal is small

## Constraints

- preserve current dark theme and project visual language
- preserve current routes and build JSON loading flow
- keep implementation local to the website package unless a shared presentation helper is clearly warranted
- prefer obvious Svelte code over abstraction-heavy componentization

## Verification

- targeted tests for any new helper logic
- `cd website && npm test`
- `cd website && npm run build`
- browser smoke on `/`, one build detail page, and one compare page

