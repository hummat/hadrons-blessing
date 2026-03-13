# BetterBots Offline Consumer Scope Design

> Created 2026-03-13. Defines how `hadrons-blessing` should support BetterBots without absorbing BetterBots runtime responsibilities.

## 1. Decision

`hadrons-blessing` supports BetterBots as an **offline, source-backed design intelligence tool**.

It is not:

- a BetterBots runtime dependency
- the home for bot behavior-tree logic
- the place to implement per-frame combat heuristics
- a second bot-AI project hidden behind CLI commands

The primary consumer is not the BetterBots Lua mod at runtime. The primary consumer is ongoing engineering work in the BetterBots repository: research, profile design, heuristic tuning, loadout selection, and evidence-backed implementation decisions.

## 2. Why This Boundary Exists

BetterBots' own roadmap is much broader than item/build lookup.

From `../BetterBots/docs/dev/roadmap.md` and `../BetterBots/docs/dev/status.md`, BetterBots already spans:

- ability activation and reliability
- combat heuristics and safety guards
- grenade/blitz support
- weapon behavior fixes
- sprinting, targeting, pinging, hazard handling, boss behavior
- future work on healing, item management, profile management, utility scoring, and human-likeness

Open issues confirm the long-term direction:

- `#22` utility-based ability scoring
- `#41` weapon/enemy-aware ADS vs hip-fire
- `#24` healing item management
- `#44` human-likeness tuning
- `#28` built-in bot profile management
- `#45` built-in default class profiles
- `#38` talent-aware bot behavior

Those are BetterBots problems. Trying to make `hadrons-blessing` answer all of them would destroy the repo boundary and turn this project into an incoherent sidecar AI framework.

## 3. BetterBots Eventual Scope

BetterBots aspires to approximate VT2-style improved bot intelligence, not just "activate abilities sometimes."

Its eventual scope includes four broad areas:

### 3.1 Ability-quality architecture

- threshold heuristics and future utility scoring
- cooldown coordination and anti-waste behavior
- objective-aware activation
- preset-driven aggression and per-ability controls

### 3.2 Bot combat behavior

- weapon-aware ranged behavior
- better melee/ranged engagement logic
- weapon special actions
- rescue/charge/nav correctness
- communication and situational responses

### 3.3 Bot profile and build systems

- default class profiles
- Tertium replacement / profile ingestion
- limited talent-aware behavior where game state exposes it

### 3.4 General teammate simulation

- healing/stim/item management
- player-facing human-likeness tuning
- inventory/pickup cooperation

This matters because `hadrons-blessing` can help inform some of those decisions, but it cannot and should not own the runtime implementations.

## 4. What Hadrons Blessing Should Own

`hadrons-blessing` should own the offline facts and tooling that BetterBots engineers need before they write or tune bot logic.

### 4.1 Canonical entity resolution

Map community-facing labels and scraped build names to stable canonical IDs:

- classes
- weapons
- blessings / blessing families
- weapon perks
- curio perks
- talents and abilities where source-backed coverage exists

This is the minimum contract required to stop BetterBots-side design work from depending on fuzzy display-name matching.

### 4.2 Build audit and triage

Given a build JSON, report:

- what resolved cleanly
- what is ambiguous
- what is known non-canonical
- what remains unresolved
- what evidence and refs support the resolved results

This is useful for choosing BetterBots default profiles, vetting community builds, and identifying data gaps before implementation.

### 4.3 Build scoring and bot-decision signals

Given a build or loadout, produce machine-readable signals useful to BetterBots engineering work, such as:

- perk quality / curio efficiency
- blessing-family identity
- dominant weapon family or slot identity
- unresolved labels and confidence warnings
- known bot-risk markers where the scoring model can support them

This is not runtime decision-making. It is offline support for profile selection and design review.

### 4.4 Evidence-backed entity inspection

Given a canonical entity ID or resolved query, surface:

- refs
- supporting evidence
- normalized aliases
- relationships to other entities where modeled

This is necessary because BetterBots design work often needs justification, not just a guessed label match.

### 4.5 Coverage reporting

Make it obvious what this repo knows and does not know.

BetterBots-side agents need to distinguish:

- source-backed facts
- partial pilot coverage
- unresolved gaps
- unsupported inference territory

Without this, downstream work will treat missing data as negative evidence and make bad design decisions.

## 5. What Hadrons Blessing Should Not Own

Explicit non-goals:

- per-frame heuristic evaluation
- behavior-tree execution logic
- aim, dodge, sprint, rescue, targeting, or pathing behavior
- healing-item and pickup state machines
- utility scoring for live bot actions
- player-command response logic
- "simulate BetterBots" CLI features

If a feature requires live blackboard state, live unit state, or bot input sequencing, it belongs in BetterBots.

## 6. BetterBots-Specific Constraints That Shape This Scope

Two BetterBots constraints matter immediately:

### 6.1 Default bot profiles are not full player builds

The approved BetterBots default-profile design uses hardcoded bot profiles with `talents = {}` for vanilla bots. That means not every community build insight transfers directly into runtime bot behavior.

Therefore:

- `hadrons-blessing` can help choose weapons, blessings, perks, curios, and general policy
- it must not pretend to provide a faithful runtime model of full player talent-tree builds for vanilla bots

### 6.2 Runtime heuristics are driven by live combat context

BetterBots' activation logic depends on combat context such as:

- nearby threat counts
- ally danger
- hazard presence
- target type and distance
- toughness / health / peril state

That logic lives in BetterBots and should stay there. `hadrons-blessing` should provide offline facts used to justify or calibrate heuristic policy, not replace the runtime evaluator.

## 7. CLI Contract Implication

Because the consumer is engineering workflow rather than runtime Lua code, the right downstream contract is CLI-first.

Phase-appropriate CLI surfaces are:

- `resolve`
- `audit`
- `score`
- `inspect`
- later, optionally: `compare-builds` and batch audit/report commands

The CLI should optimize for machine-readable output that other agents and tooling can trust. Internal JSON storage layout is not the public contract.

Important limitation:

- this section is directional only
- it does **not** yet define field-level output schemas, stability guarantees, ambiguity/error modes, or coverage metadata shapes
- that contract work still needs to be designed explicitly

## 8. Current Gaps Before Contract Work

The current repo does **not** yet satisfy the full downstream CLI contract implied by this document.

Known gaps:

### 8.1 `inspect` is not implemented

The spec lists `inspect` as a desirable CLI surface, but there is no standalone `inspect` command yet.

Open design question:

- should `inspect` be a distinct command
- or should `resolve` plus canonical-id lookup cover the same need with a different output mode

### 8.2 Bot-decision signals are only partial today

Current scoring and audit code already surface some useful signals, but not all of the signals named in this document.

In particular:

- `score-build.mjs` infers weapon slot identity
- it does **not** currently expose dominant weapon family as a first-class machine-readable signal
- any spec that promises family-level signals needs either a new output field or a narrower claim

### 8.3 Coverage metadata is underspecified

This repo can already resolve many shared entities and some class-scoped entities, but there is not yet a compact downstream-facing coverage contract that tells other agents:

- what domains are source-backed
- what remains partial
- what is unsupported
- how unsupported areas are represented in CLI outputs

### 8.4 Generated index consumption needs an explicit decision

Current project policy is that `data/ground-truth/generated/` is a build artifact and remains gitignored.

That is clean for this repo, but it creates a practical downstream question for cross-repo agent workflows:

- should downstream agents always run the build step locally before lookups
- should release artifacts include generated index data
- or should the CLI guarantee lazy/bootstrap behavior so other repos never need to read generated files directly

The intended downstream interface is CLI-first, not "cat the generated JSON," but the build/bootstrap expectation still needs to be made explicit.

## 9. Acceptance Criteria For This Boundary

This repo is staying inside the intended BetterBots-support boundary when all of the following remain true:

1. BetterBots engineers can use this repo to resolve, audit, inspect, and score build/loadout data from the CLI.
2. The outputs clearly distinguish resolved facts from ambiguity, unsupported coverage, and inference.
3. The repo helps choose and justify BetterBots loadout/profile/heuristic decisions without embedding BetterBots runtime logic.
4. Features that require live combat state remain implemented in BetterBots, not here.
5. New work in this repo is framed as source-backed offline intelligence, not as bot behavior implementation by proxy.

## 10. Follow-Up Work

The next implementation work implied by this design is:

1. Design the CLI contract from scratch for `resolve`, `audit`, `score`, and possible `inspect`; do not assume the contract already exists.
2. Define field-level stability guarantees, ambiguity/error behavior, and coverage metadata shape.
3. Decide whether `inspect` is a distinct command or a presentation/query mode on top of existing resolver/index capabilities.
4. Decide how generated-index bootstrap should work for downstream agent workflows while keeping the public interface CLI-first.
5. Document current coverage boundaries in a way downstream agents can consume quickly.
6. Fix broken package/library metadata only where it supports the CLI/tooling contract, not as a substitute for it.
7. Add machine-readable outputs for BetterBots-relevant decision signals where existing audit/score output is insufficient.
