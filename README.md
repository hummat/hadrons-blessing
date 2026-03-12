# Hadron's Blessing

Source-backed Darktide entity resolution and build audit tooling.

## Scope

Current public surface:

- `resolve`: resolve a human-facing name to a canonical game entity
- `audit`: verify a build JSON against canonical entities and aliases
- `index`: build and freshness-check the generated resolver index

This repository is intentionally machine-readable first. Human-readable reporting, build-planner commands, calculator work, and BetterBots integration are follow-up phases.

## Source Root Contract

The tooling requires a pinned checkout of `Aussiemon/Darktide-Source-Code`.

Provide it explicitly with `GROUND_TRUTH_SOURCE_ROOT`:

```bash
GROUND_TRUTH_SOURCE_ROOT=/path/to/Darktide-Source-Code npm test
GROUND_TRUTH_SOURCE_ROOT=/path/to/Darktide-Source-Code make check
```

If `GROUND_TRUTH_SOURCE_ROOT` is missing or points at the wrong revision, index builds and tests fail deliberately.

## Commands

Install dependencies:

```bash
npm install
```

Resolve one query:

```bash
npm run resolve -- --query "Warp Rider" --context '{"kind":"talent","class":"psyker"}'
```

Audit a build file:

```bash
npm run audit -- scripts/builds/08-gandalf-melee-wizard.json
```

Build the generated index:

```bash
GROUND_TRUTH_SOURCE_ROOT=/path/to/Darktide-Source-Code npm run index:build
```

Run the standalone verification flow:

```bash
GROUND_TRUTH_SOURCE_ROOT=/path/to/Darktide-Source-Code make check
```
