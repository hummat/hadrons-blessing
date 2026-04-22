# Real MVP Scope

Last updated: 2026-04-22

## What "real MVP" means here

The analytical engine is already beyond MVP. The missing part is productization.

For this project, a real MVP means:

- a non-author Darktide player can analyze their own build
- a website user can do that without touching the repo
- a CLI user can do that without learning the internal pipeline
- common user flows work from shipped data, not from a local decompiled-source checkout

If a capability only works for fixture builds already checked into `data/builds/`, or only works after local maintainer setup, it does not count as MVP-complete.

## Current state

What already exists:

- source-backed entity resolution
- canonical build shape
- scoring, synergy, and calculator layers
- `hb analyze` for URL/raw/canonical input
- CLI browse / compare / score / calc commands
- website list, detail, and compare pages for pre-generated fixture builds

What this means in practice:

- the engine can answer the right questions
- the user-facing surfaces still behave like internal tooling

## MVP blockers

### Website

1. **Bring-your-own-build ingestion**

The website currently renders static JSON generated from the checked-in fixture corpus. That is useful for demos, not for end users. The missing website MVP capability is:

- paste a Games Lantern URL
- scrape and canonicalize it
- run the existing analysis pipeline
- render the result in the same detail / compare UI as fixture builds

This is already implied by `#6 Plan 4`.

2. **Actionable guidance, not just inspection**

The current website is a good dossier viewer. It is not yet a build assistant. A real MVP should expose at least the existing gap-analysis / recommendation layer in user-facing form:

- what the build is missing
- what it is unusually strong at
- what the obvious next modification candidates are

Without that, the site still assumes the user can interpret the raw analysis unaided.

### CLI

The CLI-side MVP path now exists:

- `hb analyze <gameslantern-url>`
- `hb analyze <canonical-build.json>`
- `hb analyze <raw-build.json>`

Normal analyze flows run from shipped repo data and do not require `GROUND_TRUTH_SOURCE_ROOT`. Lower-level `npm run ...` commands still exist for maintainers.

## Not MVP blockers

These are real improvements, but they are not the thing currently preventing a release from being a real MVP:

- compare-page IA cleanup
- more hover-card coverage
- optimizer / editor / what-if tooling

Those are v1.1+ quality and capability expansions.

## Minimal credible MVP

If scope must stay tight, the smallest credible MVP is:

### Website

- paste a Games Lantern URL
- analyze it
- show the same build detail page already used for fixtures
- optionally compare it to one existing fixture build

### CLI

- install one command
- run one `analyze` flow on URL or file input
- emit one human-readable report by default and JSON on demand

### Data / packaging

- ship a pinned generated snapshot with the release
- remove the local source checkout requirement from normal user flows

## Release test

The release counts as a real MVP when this is true:

- a new user with no project context can analyze their own build on the website
- a new user with no project context can analyze their own build from the CLI
- neither user has to understand the repo's internal pipeline or maintain a local decompiled-source checkout
