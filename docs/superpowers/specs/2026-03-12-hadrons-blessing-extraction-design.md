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
- `scripts/ground-truth/**`
- ground-truth tests and fixtures
- package/build/test/CI files needed to run the project independently
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
4. Make the extracted repository self-contained and passing locally.
5. Create `hummat/hadrons-blessing` on GitHub and push the extracted history.

Reasoning:

- preserves the actual development history
- avoids dragging the full BetterBots history into a data-tooling repo
- gives the new project a clean, relevant commit log

## 5. Repo Boundary Rules

The new repository should look like an independent Node-based data/CLI project, not a partial BetterBots checkout.

Rules:

- no BetterBots Lua mod files
- no BetterBots-only docs unless they are required as historical context for the ground-truth project
- no references that assume the project lives inside BetterBots
- source snapshot handling must stay explicit and externalized
- machine-readable core remains the source of truth; human-readable reporting is layered on top

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

This keeps the project useful immediately without committing to the calculator or site before the core contract is validated.

## 7. Human-Readable Reporting Scope

After extraction, the next feature phase is a reporting layer on top of the existing audit output.

That reporting layer should:

- explain `resolved`, `ambiguous`, `non_canonical`, and `unresolved` in plain English
- surface evidence and context constraints
- remain a wrapper over the same machine-readable audit core

It should not invent a second semantic model. The raw audit JSON remains the underlying contract.

## 8. Acceptance Criteria

Extraction is complete when all of the following are true:

1. `hadrons-blessing` exists as its own local git repository with preserved ground-truth history.
2. The extracted repo runs its tests and index checks without depending on BetterBots-specific files.
3. The public CLI surface is limited to `resolve`, `audit`, and `index`.
4. The repo is pushed to `github.com/hummat/hadrons-blessing`.
5. Follow-up work is tracked in the new repo's issue tracker rather than continuing feature growth inside BetterBots.

## 9. Follow-Up Issues

Track these after extraction, not during it:

- TypeScript migration evaluation
- human-readable report UX refinement
- build-oriented commands
- BetterBots consumption path
- calculator/dataflow layer
- website/backend architecture
