# Hadron's Blessing

Source-backed Darktide build intelligence. Maps community names to canonical
game entities, audits builds against decompiled source, and will grow into a
build planner, calculator, and static web tool.

## Current CLI Contract

Stable v1 commands:

- **Resolve** — map a community-facing name ("Warp Rider", "Blaze Away") to a
  canonical entity ID backed by decompiled source with evidence
- **Audit** — verify a build JSON: classify each field as resolved, ambiguous,
  unresolved, or known non-canonical

Provisional surface:

- **Score** — coarse build scoring exists today in `scripts/score-build.mjs`,
  uses checked-in ground-truth weapon aliases plus scoring data, but is not yet
  part of the stable CLI contract

Not yet part of the public CLI contract:

- **Inspect** — implemented as `npm run inspect -- --id <canonical-entity-id>`,
  but not part of the stable v1 contract
- **Coverage** — implemented as `npm run coverage`, but not part of the stable
  v1 contract

All stable output is machine-readable JSON. Human-readable reports, richer
build-oriented commands, and calculator features are follow-up phases.

## Source Root Contract

Commands that use the ground-truth resolver currently require a pinned checkout
of `Aussiemon/Darktide-Source-Code`:

```bash
git clone --depth 1 https://github.com/Aussiemon/Darktide-Source-Code.git ../Darktide-Source-Code
```

Pass the path via `GROUND_TRUTH_SOURCE_ROOT`:

```bash
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code npm run resolve -- --query "Warp Rider" --context '{"kind":"talent","class":"psyker"}'
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code npm run audit -- scripts/builds/08-gandalf-melee-wizard.json
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code npm test
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code make check
```

Current command requirements:

- `resolve` — requires `GROUND_TRUTH_SOURCE_ROOT`
- `audit` — requires `GROUND_TRUTH_SOURCE_ROOT`
- `index:build` / `index:check` / `test` / `check` — require `GROUND_TRUTH_SOURCE_ROOT`
- `scripts/score-build.mjs` — does not require `GROUND_TRUTH_SOURCE_ROOT`

If `GROUND_TRUTH_SOURCE_ROOT` is missing or points at the wrong pinned revision,
resolver/index/test commands fail deliberately with explicit setup guidance.

Generated artifacts under `data/ground-truth/generated/` are build outputs and
remain gitignored.

## Commands

Install dependencies:

```bash
npm install
```

Resolve one query:

```bash
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code npm run resolve -- --query "Warp Rider" --context '{"kind":"talent","class":"psyker"}'
```

Audit a build file:

```bash
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code npm run audit -- scripts/builds/08-gandalf-melee-wizard.json
```

Build the generated index:

```bash
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code npm run index:build
```

Run the full verification flow (index + tests + freshness check):

```bash
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code make check
```

Experimental scorecard output:

```bash
node scripts/score-build.mjs scripts/builds/08-gandalf-melee-wizard.json --json
```

Read-only coverage summary:

```bash
npm run coverage
```

Read-only canonical entity inspection:

```bash
npm run inspect -- --id psyker.talent.psyker_damage_based_on_warp_charge
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
