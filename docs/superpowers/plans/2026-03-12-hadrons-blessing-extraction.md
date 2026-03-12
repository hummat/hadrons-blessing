# Hadron's Blessing Extraction Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the ground-truth resolver project from BetterBots into a standalone repository at `/run/media/matthias/1274B04B74B032F9/git/hadrons-blessing`, preserve relevant history, make the new repo self-contained, and publish it to `github.com/hummat/hadrons-blessing`.

**Architecture:** Use history-preserving extraction for ground-truth-specific paths, then immediately rewrite repo-global bootstrap files so the new repository stops behaving like BetterBots. Keep the public surface narrow for v1: machine-readable `resolve`, `audit`, and `index` commands backed by the existing JSON data, schemas, resolver, and audit pipeline. Verify locally in the extracted repo before creating the GitHub repository and moving follow-up work into its issue tracker.

**Tech Stack:** Git (`filter-repo` or equivalent history-preserving extraction), Node.js ESM, npm, Ajv, GitHub CLI, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-03-12-hadrons-blessing-extraction-design.md`

---

## File Map

### Source repo inputs

- `data/ground-truth/**`
  - canonical entities, aliases, edges, evidence, schemas, source snapshot manifest, generated outputs, non-canonical labels
- `scripts/build-ground-truth-index.mjs`
  - standalone `index` core entrypoint
- `scripts/audit-build-names.mjs`
  - standalone `audit` core entrypoint
- `scripts/resolve-ground-truth.mjs`
  - standalone `resolve` entrypoint
- `scripts/ground-truth/**`
  - library helpers for load/validate/normalize/resolve/non-canonical logic
- `scripts/ground-truth.test.mjs`
  - retained standalone Node test suite
- `tests/fixtures/ground-truth/**`
  - retained resolver and audit golden fixtures
- `scripts/builds/**`
  - retained audit input builds; these stay as test/audit assets, not planner features
- `docs/superpowers/specs/2026-03-11-ground-truth-resolution-design.md`
  - original design spec for the registry/resolver
- `docs/superpowers/specs/2026-03-12-hadrons-blessing-extraction-design.md`
  - extraction design spec
- `docs/plans/2026-03-12-ground-truth-extraction.md`
  - research and product direction doc worth preserving in the new repo

### Root/bootstrap files that must exist in the extracted repo

- `package.json`
  - rewrite name, description, repository metadata, license, and scripts to standalone-only behavior
- `package-lock.json`
  - keep/refresh lockfile for the standalone dependency set
- `Makefile`
  - rewrite to standalone targets only (`test`, `index`, `check`)
- `.github/workflows/ci.yml`
  - rewrite to standalone CI: Node install, source-snapshot provisioning, standalone verification only
- `.gitignore`
  - rewrite to ignore standalone artifacts like `node_modules/` and `data/ground-truth/generated/`
- `LICENSE`
  - retain explicit MIT license and align package metadata with it
- `README.md`
  - create a standalone project readme with scope, commands, source-root contract, and future direction

### New repo-only artifacts likely needed during extraction

- `docs/issues/bootstrap.md`
  - optional staging note for the issues to create in GitHub after push

---

## Chunk 1: Extract History Into A Standalone Local Repo

### Task 1: Verify extraction prerequisites and capture the exact source state

**Files:**
- Modify: none
- Read: `docs/superpowers/specs/2026-03-12-hadrons-blessing-extraction-design.md`
- Read: `package.json`
- Read: `Makefile`
- Read: `.github/workflows/ci.yml`

- [ ] **Step 1: Confirm the feature worktree is clean before history surgery**

Run:

```bash
git -C /run/media/matthias/1274B04B74B032F9/git/BetterBots/.worktrees/feat-ground-truth-psyker-pilot status --short --branch
```

Expected: branch `feat/ground-truth-psyker-pilot` and no uncommitted changes.

- [ ] **Step 2: Confirm the extraction target path is free**

Run:

```bash
test ! -e /run/media/matthias/1274B04B74B032F9/git/hadrons-blessing
```

Expected: exit code `0`. If the directory already exists, stop and inspect it before proceeding.

- [ ] **Step 3: Check which history-preserving extraction tool is available**

Run:

```bash
command -v git-filter-repo || true
git help subtree >/dev/null
```

Expected: `git-filter-repo` is preferred. If it is unavailable, use `git subtree split` plus a bootstrap import commit only if it can still preserve the relevant path history.

- [ ] **Step 4: Record the source commit that extraction starts from**

Run:

```bash
git -C /run/media/matthias/1274B04B74B032F9/git/BetterBots/.worktrees/feat-ground-truth-psyker-pilot rev-parse HEAD
```

Expected: one SHA. Save that SHA in your working notes; it anchors the extraction provenance.

- [ ] **Step 5: Commit**

No commit in this step. This is a verification gate only.

---

### Task 2: Materialize the new repository with preserved ground-truth history

**Files:**
- Create: `/run/media/matthias/1274B04B74B032F9/git/hadrons-blessing/**`

- [ ] **Step 1: Clone the feature branch into a temporary extraction workspace**

Run one of:

```bash
git clone /run/media/matthias/1274B04B74B032F9/git/BetterBots/.worktrees/feat-ground-truth-psyker-pilot /tmp/hadrons-blessing-extract
```

or, if a bare/history-preserving approach is cleaner:

```bash
git clone --no-hardlinks /run/media/matthias/1274B04B74B032F9/git/BetterBots/.worktrees/feat-ground-truth-psyker-pilot /tmp/hadrons-blessing-extract
```

Expected: a disposable git clone exists at `/tmp/hadrons-blessing-extract`.

- [ ] **Step 2: Run the history-preserving extraction**

Preferred:

```bash
git -C /tmp/hadrons-blessing-extract filter-repo \
  --path data/ground-truth/ \
  --path scripts/build-ground-truth-index.mjs \
  --path scripts/audit-build-names.mjs \
  --path scripts/resolve-ground-truth.mjs \
  --path scripts/ground-truth/ \
  --path scripts/ground-truth.test.mjs \
  --path scripts/builds/ \
  --path tests/fixtures/ground-truth/ \
  --path docs/superpowers/specs/2026-03-11-ground-truth-resolution-design.md \
  --path docs/superpowers/specs/2026-03-12-hadrons-blessing-extraction-design.md \
  --path docs/plans/2026-03-12-ground-truth-extraction.md \
  --path package.json \
  --path package-lock.json \
  --path Makefile \
  --path .github/workflows/ci.yml \
  --path .gitignore \
  --path LICENSE
```

Expected: the temp repo history contains the ground-truth project paths plus the retained bootstrap files that will be rewritten immediately after extraction.

- [ ] **Step 3: Move the extracted repo into place**

Run:

```bash
mv /tmp/hadrons-blessing-extract /run/media/matthias/1274B04B74B032F9/git/hadrons-blessing
```

Expected: the new standalone repo exists at the target path.

- [ ] **Step 4: Rewrite bootstrap files immediately so the repo no longer presents as BetterBots**

Before treating the extraction as a usable repo, rewrite:

- `package.json`
- `package-lock.json`
- `Makefile`
- `.github/workflows/ci.yml`
- `.gitignore`
- `LICENSE`
- `README.md`

The result must be a recognizable `hadrons-blessing` repo before any pause point.

- [ ] **Step 5: Verify the extracted history is relevant and the repo shape is standalone**

Run:

```bash
git -C /run/media/matthias/1274B04B74B032F9/git/hadrons-blessing log --oneline --decorate --stat -10
find /run/media/matthias/1274B04B74B032F9/git/hadrons-blessing -maxdepth 3 -type f | sort
```

Expected: the history and file tree are dominated by ground-truth files, not BetterBots Lua mod files, and the root files identify the repo as `hadrons-blessing`.

- [ ] **Step 6: Commit**

No commit yet. The extraction and immediate bootstrap rewrite are a single continuity step; the first commit should happen only after the standalone bootstrap is real.

---

## Chunk 2: Make The New Repo Pass Standalone Verification

### Task 3: Finalize standalone root files and command surface

**Files:**
- Create or Modify: `/run/media/matthias/1274B04B74B032F9/git/hadrons-blessing/package.json`
- Create or Modify: `/run/media/matthias/1274B04B74B032F9/git/hadrons-blessing/package-lock.json`
- Create or Modify: `/run/media/matthias/1274B04B74B032F9/git/hadrons-blessing/Makefile`
- Create or Modify: `/run/media/matthias/1274B04B74B032F9/git/hadrons-blessing/.github/workflows/ci.yml`
- Create or Modify: `/run/media/matthias/1274B04B74B032F9/git/hadrons-blessing/.gitignore`
- Create or Modify: `/run/media/matthias/1274B04B74B032F9/git/hadrons-blessing/LICENSE`
- Create or Modify: `/run/media/matthias/1274B04B74B032F9/git/hadrons-blessing/README.md`

- [ ] **Step 1: Finalize the standalone bootstrap files**

In the new repo, finalize the standalone versions of the root files that were rewritten immediately after extraction. The files should:

- declare package name `hadrons-blessing`
- set repository/bugs/homepage URLs to `hummat/hadrons-blessing`
- set license to `MIT`
- expose standalone scripts only:
  - `test`
  - `resolve`
  - `audit`
  - `index:build`
  - `index:check`
  - `check`
- ignore `node_modules/` and `data/ground-truth/generated/`
- define a README with:
  - what the project is
  - current command surface
  - the required source-root env var contract

- [ ] **Step 2: Install or refresh only the standalone Node dependencies**

Run:

```bash
npm install
```

from:

```bash
cd /run/media/matthias/1274B04B74B032F9/git/hadrons-blessing
```

Expected: `package-lock.json` reflects only standalone deps.

- [ ] **Step 3: Run the standalone test command before fixing any breakage**

Run:

```bash
npm test
```

Expected: it may fail at first, but any failure should now be about missing standalone wiring in the extracted repo, not BetterBots Lua tooling or missing BetterBots files.

- [ ] **Step 4: Fix the standalone bootstrap until the repo can execute its own commands**

At minimum, make these commands meaningful:

```bash
npm run resolve -- --query "Warp Rider" --context '{"kind":"talent","class":"psyker"}'
npm run audit -- scripts/builds/08-gandalf-melee-wizard.json
npm run index:build
```

Expected: each command executes in the standalone repo and produces machine-readable output.

- [ ] **Step 5: Commit**

```bash
git -C /run/media/matthias/1274B04B74B032F9/git/hadrons-blessing add \
  package.json package-lock.json Makefile .github/workflows/ci.yml .gitignore LICENSE README.md
git -C /run/media/matthias/1274B04B74B032F9/git/hadrons-blessing commit -m "build: bootstrap standalone hadrons blessing repo"
```

---

### Task 4: Verify source-root portability and clean-checkout behavior

**Files:**
- Modify as needed: `README.md`
- Modify as needed: `Makefile`
- Modify as needed: `.github/workflows/ci.yml`
- Modify as needed: `package.json`
- Modify as needed: any standalone script that still assumes BetterBots-relative paths

- [ ] **Step 1: Write or tighten the standalone source-root contract**

The repo must support explicit source provisioning via environment variable or CLI flag. Standardize on:

```bash
GROUND_TRUTH_SOURCE_ROOT=/absolute/or/relative/path
```

Document it in `README.md` and make sure the CLI/build/check commands honor it consistently.

- [ ] **Step 2: Verify clear failure without a source root**

Run:

```bash
cd /run/media/matthias/1274B04B74B032F9/git/hadrons-blessing
env -u GROUND_TRUTH_SOURCE_ROOT npm run index:check
```

Expected: clear, intentional failure telling the user how to provide the source root.

- [ ] **Step 3: Verify success with an explicit source root**

Run:

```bash
cd /run/media/matthias/1274B04B74B032F9/git/hadrons-blessing
GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code npm test
GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code make check
```

Expected: both pass.

- [ ] **Step 4: Verify the repo stays clean after normal standalone flows**

Run:

```bash
git -C /run/media/matthias/1274B04B74B032F9/git/hadrons-blessing status --short
```

Expected: empty output after dependency install, test execution, and index generation.

- [ ] **Step 5: Commit**

```bash
git -C /run/media/matthias/1274B04B74B032F9/git/hadrons-blessing add .
git -C /run/media/matthias/1274B04B74B032F9/git/hadrons-blessing commit -m "fix: make standalone verification portable"
```

---

## Chunk 3: Publish The Repo And Move Follow-Up Work Into GitHub

### Task 5: Create the GitHub repository and push the extracted history

**Files:**
- Modify: none required before push

- [ ] **Step 1: Verify the new repo state before publication**

Run:

```bash
git -C /run/media/matthias/1274B04B74B032F9/git/hadrons-blessing status --short --branch
git -C /run/media/matthias/1274B04B74B032F9/git/hadrons-blessing log --oneline --decorate -5
```

Expected: clean working tree, sensible recent commit history.

- [ ] **Step 2: Create the remote repository**

Run:

```bash
gh repo create hummat/hadrons-blessing --private=false --source=/run/media/matthias/1274B04B74B032F9/git/hadrons-blessing --remote=origin --push
```

Expected: remote created and initial branch pushed.

- [ ] **Step 3: Verify the remote metadata**

Run:

```bash
git -C /run/media/matthias/1274B04B74B032F9/git/hadrons-blessing remote -v
gh repo view hummat/hadrons-blessing
```

Expected: origin points to `github.com/hummat/hadrons-blessing` and the repo is visible.

- [ ] **Step 4: Commit**

No local commit required if the tree is already clean.

---

### Task 6: Create the initial follow-up issues in the new repo

**Files:**
- Create optionally: `/run/media/matthias/1274B04B74B032F9/git/hadrons-blessing/docs/issues/bootstrap.md`

- [ ] **Step 1: Create focused follow-up issues from the spec’s deferred work**

At minimum, create one issue each for:

- TypeScript migration evaluation
- human-readable report layer
- build-oriented commands
- BetterBots consumption path
- calculator/dataflow layer
- website/backend architecture

Use concise bodies that reference the extraction spec and clearly say these are post-extraction work items.

- [ ] **Step 2: Verify the issues exist**

Run:

```bash
gh issue list -R hummat/hadrons-blessing --state open --limit 20
```

Expected: all planned bootstrap issues appear.

- [ ] **Step 3: Commit**

Only commit if you created a local bootstrap note file.

---

## Final Verification Checklist

- [ ] `git -C /run/media/matthias/1274B04B74B032F9/git/hadrons-blessing status --short --branch`
- [ ] `GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code npm test`
- [ ] `GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code make check`
- [ ] `npm run resolve -- --query "Warp Rider" --context '{"kind":"talent","class":"psyker"}'`
- [ ] `npm run audit -- scripts/builds/08-gandalf-melee-wizard.json`
- [ ] `npm run index:check`
- [ ] `gh repo view hummat/hadrons-blessing`
- [ ] `gh issue list -R hummat/hadrons-blessing --state open --limit 20`

## Notes For Execution

- Do not continue feature work in BetterBots after the extraction begins unless the user explicitly asks for backports.
- Preserve the BetterBots branch state; extraction should not rewrite BetterBots history.
- If `git filter-repo` is unavailable, stop and choose the least-wrong fallback deliberately. Do not fake “preserved history” with a plain copy.
- Treat repo-global bootstrap files as standalone rewrites after extraction, not as sacred history.
- Keep the standalone CLI machine-readable first. Human-readable reporting is phase 2 work in the new repo.
