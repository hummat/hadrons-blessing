# CLI Contract Design

> Created 2026-03-13. Defines the public CLI contract for `hadrons-blessing` as an offline, source-backed tool for downstream engineering workflows.

## 1. Decision

The v1 stable CLI contract is:

- `resolve`
- `audit`

The v1 provisional CLI surface is:

- `score`
- `coverage`
- `inspect`

This is intentional.

`resolve` and `audit` already expose coherent machine-readable outputs and directly support the core downstream workflow.

`score` is useful, but the current output still mixes mechanical scoring with placeholders for manual qualitative judgment and bot flags. That is not stable enough to freeze as a downstream contract yet.

`coverage` and `inspect` are now implemented as read-only companion commands over checked-in data, but they still should not be treated as stable contract surfaces yet.

## 2. Problem

This repo already has working CLI-adjacent scripts, but there is no explicit public contract for downstream users and agents.

Current problems:

- no field-level stability guarantees
- no documented representation of ambiguity vs unresolved vs unsupported coverage
- no documented bootstrap behavior when generated index artifacts are absent
- `score` looks more mature than it is
- companion commands beyond `resolve` / `audit` are implemented but not yet frozen

If this stays implicit, downstream agents will couple themselves to implementation details and guess at semantics.

## 3. Users And Primary Workflow

The primary consumer is an engineer or agent working in another repo, especially `../BetterBots`.

The core workflow is:

1. Take a build file, label, or entity question from external work.
2. Use `hadrons-blessing` CLI to resolve names to canonical IDs.
3. Audit a build or loadout for ambiguity, unresolved labels, and known non-canonical names.
4. Optionally score the build for coarse mechanical signals.
5. Use the result to guide offline implementation decisions in the downstream repo.

This is not a runtime dependency contract. It is a cross-repo tooling contract.

## 4. Approaches Considered

### Approach A: Freeze all visible commands now

Make `resolve`, `audit`, `score`, and future `inspect` all part of the stable v1 contract immediately.

Pros:

- ambitious and simple to explain
- one public story for all commands

Cons:

- dishonest to current repo state
- freezes weak or placeholder output shapes
- makes future cleanup of `score`, `coverage`, and `inspect` harder

Verdict:

- rejected

### Approach B: Stable core plus provisional extensions

Freeze only the commands with coherent existing semantics. Mark everything else as provisional or deferred.

Pros:

- matches current repo reality
- gives downstream agents something trustworthy now
- keeps room to improve `score` and design `inspect` properly

Cons:

- less tidy than one all-in contract
- requires explicit status labels per command

Verdict:

- recommended

### Approach C: No stable contract yet, design everything first

Declare the whole CLI unstable until all commands and schemas are redesigned together.

Pros:

- maximal flexibility

Cons:

- blocks downstream use unnecessarily
- throws away the value of the current resolver/audit surfaces

Verdict:

- rejected

## 5. Recommended Contract Shape

### 5.1 Stability tiers

Three stability tiers:

- `stable`: downstream agents may rely on field presence and semantics across minor iterations
- `provisional`: useful, but field shape and semantics may change without much ceremony
- `deferred`: named in design only, not yet part of the public CLI contract

Command status in v1:

- `resolve`: `stable`
- `audit`: `stable`
- `score`: `provisional`
- `coverage`: `provisional`
- `inspect`: `provisional`

### 5.2 Schema philosophy

For stable commands:

- required fields must stay required
- enum meanings must stay stable
- absent capability must be represented explicitly, not via silent omission when omission would change semantics
- additive fields are allowed
- breaking field renames or semantic repurposing require an explicit contract revision

For provisional commands:

- machine-readable output is still preferred
- downstream users must treat it as best-effort, not frozen

## 6. Stable v1: `resolve`

### 6.1 Input surface

CLI shape:

```bash
npm run resolve -- --query "Warp Rider" --context '{"kind":"talent","class":"psyker"}'
```

Stable input contract:

- `--query` is required
- `--context` is optional JSON
- unsupported context keys are a caller error

### 6.2 Stable output semantics

The following fields are part of the stable output contract for `resolve`:

- `query`
- `query_context`
- `resolution_state`
- `resolved_entity_id`
- `proposed_entity_id`
- `match_type`
- `confidence`
- `warnings`

The following fields should also be treated as stable because they are core to downstream evidence use:

- `refs`
- `supporting_evidence`

The following fields are useful but should be documented as secondary stable fields:

- `why_this_match`
- `candidate_trace`

The following fields should remain non-contractual implementation detail unless explicitly promoted later:

- full embedded `entity`
- full embedded `proposed_entity`
- internal ranking scores such as `score` and `score_margin`

These non-contractual fields may continue to appear in output.

Downstream agents must not branch on them as if they were stable contract inputs.

Reason:

- downstream agents need stable resolution semantics and evidence
- they do not need to rely on current internal scoring implementation

### 6.3 Resolution-state contract

Stable enum:

- `resolved`
- `ambiguous`
- `unresolved`

Stable meaning:

- `resolved`: authoritative canonical winner
- `ambiguous`: a best candidate exists but no authoritative winner is claimed
- `unresolved`: no authoritative candidate

Stable ID behavior:

- when `resolution_state = "resolved"`, `resolved_entity_id` is non-null and `proposed_entity_id` is null
- when `resolution_state = "ambiguous"`, `resolved_entity_id` is null and `proposed_entity_id` may be non-null
- when `resolution_state = "unresolved"`, `resolved_entity_id` is null and `proposed_entity_id` is null

### 6.4 Unsupported coverage behavior

The resolver must not silently treat unsupported coverage as authoritative negative evidence.

For v1 stable behavior:

- unsupported or currently uncovered areas are represented through `unresolved`
- `warnings` should carry machine-readable hints where possible
- later coverage metadata should make this distinction explicit at a higher level

This is imperfect, but it matches current behavior without inventing fake certainty.

## 7. Stable v1: `audit`

### 7.1 Input surface

CLI shape:

```bash
npm run audit -- path/to/build.json
```

Stable input contract:

- one build-path positional argument is required
- input must be a valid build JSON in the project’s current audit shape

### 7.2 Stable top-level output fields

The following top-level fields are stable:

- `build`
- `resolved`
- `ambiguous`
- `non_canonical`
- `unresolved`
- `warnings`

### 7.3 Stable per-entry fields

Stable fields common across all resolution buckets:

- `field`
- `text`
- `resolution_state`
- `resolved_entity_id`
- `proposed_entity_id`
- `warnings`

Secondary stable fields inherited from resolver semantics:

- `match_type`
- `confidence`

Stable fields specific to `non_canonical` entries:

- `non_canonical_kind`
- `provenance`
- `notes`

### 7.4 Bucket semantics

Stable meaning:

- `resolved`: authoritative canonical matches
- `ambiguous`: candidate exists but no authoritative winner
- `non_canonical`: known label that is intentionally not a canonical entity match
- `unresolved`: no match and not classified as known non-canonical

Stable ordering behavior:

- bucket contents are sorted by `field`
- `warnings` is a de-duplicated sorted list

### 7.5 Unsupported coverage behavior

The audit contract does not yet distinguish between:

- genuinely unknown label
- unsupported domain coverage
- missing generated index

That gap is intended to be addressed by explicit coverage metadata as described in §10.

Until then, the v1 stable contract must still guarantee:

- these situations never appear as `resolved`
- callers can safely treat `resolved` as authoritative and everything else as non-authoritative

## 8. Provisional v1: `score`

### 8.1 Why provisional

Current `score` output in `scripts/score-build.mjs` mixes:

- mechanical scores
- inferred slot identity
- optional qualitative fields that depend on synergy/calculator availability
- conservative automated `bot_flags`

That is valuable, but not clean enough for a stable contract.

Specific reasons not to freeze it yet:

- qualitative dimensions still depend on optional upstream analysis rather than one stable mandatory pipeline
- `bot_flags` are conservative heuristics tied to current BetterBots support, not a complete runtime proof
- weapon family is not exposed as a first-class signal
- weapon-name matching is implemented through a parallel scoring-specific path rather than the ground-truth resolver, so score can drift from resolver/audit semantics
- some downstream-facing semantics still need design

### 8.2 Provisional usage guidance

`score` may still be used by downstream agents, but only as:

- coarse heuristic input
- advisory output
- non-stable machine-readable data

The next contract revision can promote a subset of `score` once the output is cleaned up.

## 9. Provisional v1: `inspect`

### 9.1 Open design question

Two viable options:

Option 1:

- distinct `inspect` command
- input by canonical entity ID
- returns entity facts, aliases, refs, evidence, and relationships

Option 2:

- extend `resolve` with an exact canonical-id lookup mode or output mode
- avoid a second command until the semantics diverge materially

Recommendation:

- keep the command implemented but non-stable until its query shape is frozen
- do not promise `inspect` in the v1 stable CLI contract

## 10. Provisional v1: `coverage`

Coverage now exists as a read-only companion command over checked-in shard data.

Current role:

- expose current domain/kind coverage status
- distinguish `source_backed`, `partial`, and `unsupported` at a coarse level
- help downstream agents separate missing coverage from failed lookups

Why still provisional:

- coverage expectations are still partly curated policy, not purely derived fact
- the output shape may grow once downstream users start relying on it
- this is new enough that naming and field granularity may still need cleanup

Minimum useful fields remain:

- domain or entity-kind scope
- status: `source_backed`, `partial`, `unsupported`
- notes
- source snapshot identifier where relevant

This is not required to freeze `resolve` and `audit`, but it should be the next contract addition after the core commands.

## 11. Bootstrap And Generated Index Policy

Current project policy:

- generated index remains in `data/ground-truth/generated/`
- generated outputs are gitignored

Current implementation reality:

- `resolve` and `audit` do **not** currently read a prebuilt generated index
- both rebuild the index in-memory by calling `buildIndex({ check: false })`
- that path requires `GROUND_TRUTH_SOURCE_ROOT`
- that path also rewrites generated artifacts as a side effect

So the current contract reality is not "missing generated index causes resolve/audit to fail."

The real current setup dependency for `resolve` and `audit` is `GROUND_TRUTH_SOURCE_ROOT` pointing at the pinned source snapshot.

Recommended contract decision:

- keep generated artifacts gitignored
- keep the public downstream interface CLI-first
- do not require downstream repos to read generated JSON directly
- long-term, stable commands should not silently rewrite generated artifacts as an incidental side effect of read-oriented lookups

Required CLI behavior:

- commands must fail clearly when required setup is missing
- the failure must tell the caller what setup or bootstrap command to run
- bootstrap must remain explicit rather than silently rebuilding behind the caller’s back in the long-term contract

Implementation note:

- this section partly describes desired future behavior, not only current behavior
- aligning the current `resolve` / `audit` implementation with this contract is a follow-up implementation task

Reason:

- implicit rebuild side effects can hide source-root and freshness problems
- explicit bootstrap is easier for cross-repo agents to reason about

Future extension:

- release artifacts or packaged snapshots can be added later if startup friction becomes a real problem

### 11.1 Environment requirements by command

Current expected environment contract:

- `resolve`: requires `GROUND_TRUTH_SOURCE_ROOT`
- `audit`: requires `GROUND_TRUTH_SOURCE_ROOT`
- `index:build` / `index:check`: require `GROUND_TRUTH_SOURCE_ROOT`
- `score`: does not require `GROUND_TRUTH_SOURCE_ROOT`

This matters for downstream agents:

- a BetterBots-side agent can run `score` with only checked-in repo data
- it cannot run `resolve`, `audit`, or index validation without source-root setup under the current implementation

## 12. Error Contract

Stable commands should have predictable failure classes even if the exact stderr formatting remains unspecified in v1.

Minimum stable behavior:

- caller input error: non-zero exit
- invalid context JSON: non-zero exit
- missing build path or query: non-zero exit
- missing generated index or required bootstrap state: non-zero exit

Required semantic guarantee:

- machine-readable success output is printed only on success
- no partial success JSON with hidden fatal error state

Detailed structured error JSON can be added later, but is not required for the first stable contract.

## 13. Acceptance Criteria

This contract design is satisfied when:

1. `resolve` and `audit` have documented stable fields and semantics.
2. `score` is explicitly documented as provisional rather than silently treated as stable.
3. `coverage` and `inspect` are explicitly documented as implemented but provisional.
4. Setup/bootstrap behavior is explicit and CLI-first.
5. Downstream agents can rely on authoritative vs non-authoritative outcomes without coupling to internal scoring details.

## 14. Follow-Up Work

1. Update docs to mark `resolve` and `audit` as the stable v1 CLI contract.
2. Update docs to mark `score`, `coverage`, and `inspect` as provisional.
3. Document command-by-command environment/setup requirements, especially `GROUND_TRUTH_SOURCE_ROOT`.
4. Implement the desired read-oriented bootstrap behavior for `resolve` / `audit` instead of relying on implicit in-memory rebuild plus generated-file writes.
5. Implement or document explicit setup/bootstrap failure behavior in a way that matches the actual command paths.
6. Document the stable subset of `resolve` output while allowing additional fields to remain additive.
7. Reconcile `score` name matching with the ground-truth resolver before promoting any part of `score` to stable.
8. Revisit `coverage` / `inspect` output shapes after downstream use clarifies what should actually be frozen.
