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

For covered shared weapons, `resolve` also accepts internal template ids and
BetterBots-style full content item paths such as
`content/items/weapons/player/ranged/bot_lasgun_killshot`.

Provisional surface:

- **Canonicalize** — convert a scraped/raw build JSON into the canonical build
  shape used by this repo
- **Re-resolve** — batch refresh unresolved or non-canonical selections in
  canonical build files when resolver coverage expands
- **Score** — coarse build scoring exists today in `scripts/score-build.mjs`,
  now accepts canonical build fixtures directly, but is not yet part of the
  stable CLI contract

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
- `canonicalize` — requires `GROUND_TRUTH_SOURCE_ROOT`
- `reresolve` — requires `GROUND_TRUTH_SOURCE_ROOT`
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

Resolve a BetterBots profile weapon path:

```bash
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code npm run resolve -- --query "content/items/weapons/player/ranged/bot_lasgun_killshot" --context '{"kind":"weapon","slot":"ranged"}'
```

Audit a build file:

```bash
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code npm run audit -- scripts/builds/08-gandalf-melee-wizard.json
```

Canonicalize a scraped/raw build file:

```bash
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code npm run canonicalize -- scripts/sample-build.json
```

Re-resolve canonical build files in place:

```bash
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code npm run reresolve -- --write scripts/builds
```

Build the generated index:

```bash
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code npm run index:build
```

Run the full verification flow (index + tests + freshness check):

```bash
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code make check
```

Experimental scorecard output on canonical build fixtures:

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

Current entity coverage:

| Domain   | Entities | Aliases | Notes |
|----------|----------|---------|-------|
| Shared   | 90 | many | weapons, weapon perks, curio perks, blessing families, classes, buffs |
| Psyker   | ~25 | ~25 | talents, abilities, implicit tree nodes |
| Veteran  | 43 | 44 | abilities, auras, keystones, talent modifiers, talents — 3 builds re-extracted |
| Zealot   | 57 | 57 | abilities, auras, keystones, talent modifiers, talents — 4 builds re-extracted |
| Ogryn    | — | — | unsupported (builds exist but not re-extracted) |
| Arbites  | — | — | unsupported |
| Hive Scum | — | — | unsupported |

20 build fixtures (all 6 classes) are stored in canonical build shape.
7 of the 20 (3 veteran, 4 zealot) have been re-extracted from live GL pages
with full 30-node talent trees. The remaining 13 are legacy fixtures with
placeholder class-side slots and no talent data.

Audit totals across all 20 fixtures: **480 resolved / 79 non-canonical / 85
unresolved / 0 ambiguous**.

## Roadmap

- `#1` TypeScript migration
- `#2` Human-readable audit/report layer
- `#3` Build-oriented CLI (browse, compare)
- `#4` BetterBots integration contract
- `#5` Calculator and dataflow layer
- `#6` Website (SvelteKit + Svelte Flow talent tree)

## License

MIT
