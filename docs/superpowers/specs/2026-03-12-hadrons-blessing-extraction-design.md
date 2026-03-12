# Hadron's Blessing Extraction Design

> Created 2026-03-12. Defines how the Darktide ground-truth resolution work is extracted from BetterBots into its own standalone repository.

## 1. Decision

Extract the ground-truth resolver project out of BetterBots into a standalone repository:

- Repository owner: `hummat`
- Repository name: `hadrons-blessing`
- Local path: `/run/media/matthias/1274B04B74B032F9/git/hadrons-blessing`

The new repository is the canonical home for the Darktide entity-resolution project. BetterBots becomes a downstream consumer later, not the host.

## 2. Why Extract Now

This is no longer a Psyker-only pilot. The current branch already contains:

- class-agnostic resolver semantics
- shared weapons, blessings, perks, and evidence
- generic audit tooling
- standalone schemas, tests, and CI-oriented checks

Keeping it in BetterBots is now the wrong boundary:

- it mixes a general-purpose data/tooling project into a Lua mod repository
- it couples unrelated CI concerns
- it obscures ownership and roadmap decisions
- it biases the next phase toward BetterBots-specific glue instead of a reusable CLI/library

## 3. Initial Standalone Scope

The first standalone release is intentionally narrow. Public surface:

- `resolve`
- `audit`
- `index`

Included in the extraction:

- `data/ground-truth/**`
- `scripts/build-ground-truth-index.mjs`
- `scripts/audit-build-names.mjs`
- `scripts/resolve-ground-truth.mjs`
- `scripts/ground-truth/**`
- `scripts/ground-truth.test.mjs`
- ground-truth tests and fixtures:
  - `tests/fixtures/ground-truth/**`
  - `scripts/builds/**` for retained audit snapshots and audit-test inputs
- standalone package/build/test/CI files required to run the project independently:
  - `package.json`
  - `package-lock.json`
  - `Makefile`
  - `.github/workflows/ci.yml`
  - `.gitignore`
  - `LICENSE`
- ground-truth documentation needed to understand and maintain the project

Explicitly out of scope for this extraction:

- build-planner commands (`build list/show/diff/import`)
- calculator implementation
- web UI
- BetterBots integration glue
- TypeScript migration

Those become tracked follow-up issues in the new repository.

## 4. Extraction Method

Use history-preserving extraction, not a fresh copy.

Recommended method:

1. Start from the existing `feat/ground-truth-psyker-pilot` branch.
2. Use `git filter-repo` or an equivalent history-preserving extraction workflow to keep only the standalone project paths.
3. Materialize the extracted repository at `/run/media/matthias/1274B04B74B032F9/git/hadrons-blessing`.
4. Rewrite the retained root-level project files into standalone forms after extraction:
   - `package.json`
   - `package-lock.json`
   - `Makefile`
   - `.github/workflows/ci.yml`
5. Make the extracted repository self-contained and passing locally and on a clean checkout.
6. Create `hummat/hadrons-blessing` on GitHub and push the extracted history.
7. Open follow-up issues in the new repository for work explicitly deferred by this spec.

Reasoning:

- preserves the actual development history
- avoids dragging the full BetterBots history into a data-tooling repo
- gives the new project a clean, relevant commit log

Important boundary detail:

- path-based history preservation applies directly to ground-truth-specific paths
- retained repo-global files are treated as bootstrap files, not as authoritative history artifacts
- those bootstrap files must be rewritten immediately after extraction so the new repo does not inherit unrelated BetterBots behavior or a misleading commit narrative for repo-global automation

## 5. Repo Boundary Rules

The new repository should look like an independent Node-based data/CLI project, not a partial BetterBots checkout.

Rules:

- no BetterBots Lua mod files
- no BetterBots-only docs unless they are required as historical context for the ground-truth project
- no references that assume the project lives inside BetterBots
- source snapshot handling must stay explicit and externalized
- machine-readable core remains the source of truth; human-readable reporting is layered on top
- standalone metadata must be rewritten during extraction:
  - package name, description, repository URL, bugs URL, and homepage
  - package license field must match the retained repository license file
  - CI workflow names and badges
  - README and docs references that still say `BetterBots`
- standalone automation must be functionally rewritten during extraction:
  - `package.json` test scripts must stop invoking BetterBots-only tests such as `scripts/score-build.test.mjs`
  - `Makefile` targets must be reduced to ground-truth build/test/check flows only
  - `.github/workflows/ci.yml` must stop running BetterBots Lua lint/format/LSP/package gates and instead validate only the standalone project contract
  - `.gitignore` must ignore standalone build artifacts and dependencies such as `node_modules/` and `data/ground-truth/generated/`
- the source snapshot contract must be explicit and portable:
  - the repo may not assume a BetterBots-relative checkout or a machine-specific absolute path
  - source-root provisioning must be documented and supported through an explicit input surface such as environment variable or CLI flag
  - clean-checkout verification must prove the repo can fail clearly without source data and pass once the source root is provided

If a file exists only to support BetterBots mod development and is not necessary for general entity resolution, it does not belong in `hadrons-blessing`.

## 6. Product Shape After Extraction

`hadrons-blessing` is a general-purpose Darktide data and verification tool with three intended audiences:

- developers and modders using the CLI and machine-readable output
- human users verifying or exploring builds with readable reports
- future web tooling consuming the same library/data layer

The immediate shape is:

- library layer: resolver, audit, index builder
- CLI layer: machine-readable and human-readable commands
- data layer: canonical entities, aliases, edges, evidence, schemas

Stable contract for downstream consumers in phase 1:

- resolver output shape and field semantics are part of the public contract
- raw audit JSON shape and field semantics are part of the public contract
- CLI command names alone are not sufficient; the machine-readable JSON produced by `resolve` and `audit` must be treated as versioned public output
- any future incompatible schema change must be tracked explicitly in the standalone repo

This keeps the project useful immediately without committing to the calculator or site before the core contract is validated.

## 7. Human-Readable Reporting Scope

After extraction, the next feature phase is a reporting layer on top of the existing audit output.

That reporting layer should:

- explain `resolved`, `ambiguous`, `non_canonical`, and `unresolved` in plain English
- surface evidence and context constraints
- remain a wrapper over the same machine-readable audit core

It should not invent a second semantic model. The raw audit JSON remains the underlying contract.

Build-related boundary for phase 1:

- retained build-shaped JSON under `scripts/builds/**` is test and audit input data, not a public build-planner feature
- build-name parsing and normalization used by `audit` are in scope because they are required for verification of scraped or curated builds
- build authoring, browsing, listing, diffing, and import/export UX remain out of scope until phase 2

## 8. Acceptance Criteria

Extraction is complete when all of the following are true:

1. `hadrons-blessing` exists as its own local git repository with preserved ground-truth history.
2. The extracted repo runs its tests and index checks without depending on BetterBots-specific files.
3. The public CLI surface is limited to `resolve`, `audit`, and `index`, with explicit standalone entrypoints present for all three.
4. The repo is pushed to `github.com/hummat/hadrons-blessing`.
5. Follow-up work is tracked in the new repo's issue tracker rather than continuing feature growth inside BetterBots.
6. A clean checkout can run the standalone verification flow with an explicitly provided source root, without any BetterBots-relative assumptions.
7. The extracted repo carries an explicit license file and matching package metadata, and stays clean after dependency install and index generation.

## 9. Follow-Up Issues

Track these after extraction, not during it:

- TypeScript migration evaluation
- human-readable report UX refinement
- build-oriented commands
- BetterBots consumption path
- calculator/dataflow layer
- website/backend architecture
