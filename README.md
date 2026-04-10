# Hadron's Blessing

Source-backed Darktide build intelligence. Maps community names to canonical
game entities, audits builds against decompiled source, computes damage
breakpoints via a 13-stage calculator, and scores builds across 7 dimensions.

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
- **Score** — 7-dimension build scoring (2 mechanical + 5 qualitative)
- **Calc** — 13-stage damage breakpoint calculator with per-weapon per-enemy
  per-difficulty hits-to-kill matrix

Not yet part of the public CLI contract:

- **Inspect** — implemented as `npm run inspect -- --id <canonical-entity-id>`,
  but not part of the stable v1 contract
- **Coverage** — implemented as `npm run coverage`, but not part of the stable
  v1 contract

All stable output is machine-readable JSON with optional `--text` human-readable mode.

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
- `breeds:build` / `profiles:build` — require `GROUND_TRUTH_SOURCE_ROOT`
- `calc` — requires `GROUND_TRUTH_SOURCE_ROOT` (reads generated data from `breeds:build` + `profiles:build`)
- `score` — does not require `GROUND_TRUTH_SOURCE_ROOT` (but includes breakpoint scoring when calc data available)

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

Build scoring on canonical build fixtures:

```bash
npm run score -- scripts/builds/08-gandalf-melee-wizard.json --json
npm run score -- scripts/builds/08-gandalf-melee-wizard.json --text
```

Damage breakpoint calculator:

```bash
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code npm run calc -- scripts/builds/08-gandalf-melee-wizard.json
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code npm run calc -- scripts/builds/08-gandalf-melee-wizard.json --json
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code npm run calc -- scripts/builds/ --json            # batch
```

Regenerate tree edges from Lua source (requires source root):

```bash
npm run edges:build
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

Current entity coverage (1376 total: 768 non-tree + 608 tree_node):

| Domain    | Entities | Tree Nodes | Aliases | Edges | Notes |
|-----------|----------|------------|---------|-------|-------|
| Shared    | 200 | — | 134 | 76 | weapons, weapon perks, curio perks, blessing families, stat nodes, classes, buffs |
| Psyker    | 89 | 111 | 76 | 255 | full tree DAG with exclusive_with edges |
| Ogryn     | 85 | 108 | 85 | 240 | tree DAG (9 edges skipped — missing talent entities) |
| Arbites   | 82 | 110 | — | 259 | tree DAG (5 edges skipped) |
| Hive Scum | 103 | 83 | — | 236 | tree DAG (5 edges skipped) |
| Zealot    | 57 | 89 | 57 | 210 | tree DAG (24 edges skipped) |
| Veteran   | 43 | 107 | 44 | 211 | tree DAG (40 edges skipped) |

Tree edges are generated from Lua source via `npm run edges:build`. Skipped edges reference
talent entities not yet in ground-truth — they appear automatically as entity coverage grows.

All 24 build fixtures (all 6 classes) are stored in canonical build shape,
re-extracted from live Games Lantern pages with full talent trees.

Audit totals across all 24 fixtures: **1275 resolved / 0 unresolved / 72
non_canonical / 0 ambiguous**. The `non_canonical` bucket in the fixtures is
the four curio cosmetic base labels whose concrete runtime variants are
collapsed by the Games Lantern scrape; the live dump helper in
`tools/darktide-mods/curio_dump/` confirms 21 such ambiguous base labels in
the full curio catalog.

## Roadmap

- `#1` TypeScript migration
- `#2` Human-readable audit/report layer
- `#3` Build-oriented CLI (browse, compare)
- ~~`#4` BetterBots integration contract~~ (resolved)
- ~~`#5` Calculator and dataflow layer~~ (resolved)
- `#6` Website (SvelteKit + Svelte Flow talent tree)

## License

MIT
