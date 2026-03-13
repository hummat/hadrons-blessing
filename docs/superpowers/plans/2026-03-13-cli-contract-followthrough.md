# CLI Contract Follow-Through Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the next bounded CLI capabilities implied by the contract work: machine-readable coverage reporting and entity inspection, with tests and docs that keep stability tiers explicit.

**Architecture:** Keep `resolve` and `audit` as the stable core. Add `coverage` and `inspect` as new read-only commands built from checked-in shard data and generated artifacts already available in-repo, without introducing new source-root requirements. Reuse small helper modules instead of expanding existing command files further.

**Tech Stack:** Node.js ESM, built-in `node:test`, existing ground-truth data loaders and JSON shard files.

---

## Chunk 1: Read-Only Coverage Command

### Task 1: Add failing tests for coverage reporting

**Files:**
- Create: `scripts/coverage.test.mjs`
- Test: `scripts/coverage.test.mjs`

- [ ] **Step 1: Write failing tests for `coverage` output**
- [ ] **Step 2: Run `node scripts/coverage.test.mjs` and verify failure**
- [ ] **Step 3: Implement minimal `coverage` command and data helper**
- [ ] **Step 4: Re-run `node scripts/coverage.test.mjs` and verify pass**
- [ ] **Step 5: Commit**

### Task 2: Implement coverage data helper and CLI entrypoint

**Files:**
- Create: `scripts/ground-truth/lib/coverage.mjs`
- Create: `scripts/coverage-ground-truth.mjs`
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Build coverage summary from checked-in shard files**
- [ ] **Step 2: Expose `npm run coverage`**
- [ ] **Step 3: Document command as planned/provisional, not stable**
- [ ] **Step 4: Run targeted tests**
- [ ] **Step 5: Commit**

## Chunk 2: Entity Inspection Command

### Task 3: Add failing tests for entity inspection

**Files:**
- Create: `scripts/inspect.test.mjs`
- Test: `scripts/inspect.test.mjs`

- [ ] **Step 1: Write failing tests for canonical-id inspection**
- [ ] **Step 2: Run `node scripts/inspect.test.mjs` and verify failure**
- [ ] **Step 3: Implement minimal inspect helper and CLI**
- [ ] **Step 4: Re-run `node scripts/inspect.test.mjs` and verify pass**
- [ ] **Step 5: Commit**

### Task 4: Implement inspect helper and CLI entrypoint

**Files:**
- Create: `scripts/ground-truth/lib/inspect.mjs`
- Create: `scripts/inspect-ground-truth.mjs`
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Support lookup by canonical entity id**
- [ ] **Step 2: Return entity, refs, related aliases, supporting evidence, and incident edges**
- [ ] **Step 3: Keep command read-only and source-root independent if possible**
- [ ] **Step 4: Document command as implemented but not part of stable v1 contract**
- [ ] **Step 5: Run targeted tests**
- [ ] **Step 6: Commit**

## Chunk 3: Test And Contract Integration

### Task 5: Fold new CLI tests into the default test workflow

**Files:**
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Add new test files to default test command**
- [ ] **Step 2: Run full test suite**
- [ ] **Step 3: Verify docs match actual command/setup requirements**
- [ ] **Step 4: Commit**

Plan complete and saved to `docs/superpowers/plans/2026-03-13-cli-contract-followthrough.md`. Executing now.
