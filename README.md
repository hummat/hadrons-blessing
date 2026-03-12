# Hadron's Blessing

Source-backed Darktide build intelligence. Maps community names to canonical
game entities, audits builds against decompiled source, and will grow into a
build planner, calculator, and static web tool.

## What it does

- **Resolve** — map a community-facing name ("Warp Rider", "Blaze Away") to a
  canonical entity ID backed by decompiled source with a file:line citation
- **Audit** — verify a build JSON: classify each field as resolved, ambiguous,
  unresolved, or known non-canonical, with source citations for every hit
- **Index** — build and freshness-check the generated resolver index from raw
  ground-truth data

All output is machine-readable JSON. Human-readable reports, a build planner,
and a calculator are follow-up phases.

## Source Root Contract

Most commands require a pinned checkout of `Aussiemon/Darktide-Source-Code`:

```bash
git clone --depth 1 https://github.com/Aussiemon/Darktide-Source-Code.git ../Darktide-Source-Code
```

Pass the path via `GROUND_TRUTH_SOURCE_ROOT`:

```bash
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code npm test
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code make check
```

If the env var is missing or points at the wrong revision, index builds and
tests fail deliberately.

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
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code npm run index:build
```

Run the full verification flow (index + tests + freshness check):

```bash
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code make check
```

## Status

Current entity coverage (Psyker pilot + shared):

| Domain   | Entities | Aliases |
|----------|----------|---------|
| Psyker   | talents, implicit tree nodes | display names, loc keys |
| Shared   | weapons, weapon perks, curio perks, blessing families, classes, buffs | community names |

20 build fixtures (all 6 classes) are included as audit regression coverage.

## Roadmap

- `#1` TypeScript migration
- `#2` Human-readable audit/report layer
- `#3` Build-oriented CLI (browse, compare)
- `#4` BetterBots integration contract
- `#5` Calculator and dataflow layer
- `#6` Website (SvelteKit + Svelte Flow talent tree)

## License

MIT
