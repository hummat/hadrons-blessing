# Hadron's Blessing

Darktide build intelligence. Maps community names to canonical game entities,
computes damage breakpoints via a 13-stage calculator, and scores builds
across 8 dimensions including survivability.

## User CLI

The public CLI surface is one command:

```bash
hb analyze <gameslantern-url|build.json> [--json]
```

It accepts:

- a Games Lantern build URL
- a canonical build JSON file
- a raw scrape-shaped build JSON file

Normal `hb analyze` flows work from the shipped repo data and do **not**
require `GROUND_TRUTH_SOURCE_ROOT`.

Examples:

```bash
hb analyze https://darktide.gameslantern.com/builds/9a565016-bd70-4fe0-8c82-1080bc73412e/veteran-squad-leader
hb analyze data/builds/09-psyker-2026.json
hb analyze data/sample-build.json --json
```

Default output is human-readable. Use `--json` for machine-readable output.

## Install

The supported end-user install path is the release tarball:

```bash
npm install -g hadrons-blessing-0.1.0.tgz
hb analyze data/sample-build.json
```

For local development from a clone:

```bash
npm install
npm run build
npm run analyze -- data/sample-build.json
```

## Maintainer Commands

The repo still exposes lower-level maintainer tooling through `npm run ...`.
Those commands remain useful for refresh, validation, and debugging, but they
are not the public MVP surface.

Commands that read the pinned decompiled source require a clean
`Aussiemon/Darktide-Source-Code` checkout via `GROUND_TRUTH_SOURCE_ROOT`:

```bash
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code npm run resolve -- --query "Warp Rider" --context '{"kind":"talent","class":"psyker"}'
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code npm run audit -- data/builds/08-zealot-chorus-swiss-knife.json
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code make check
```

Source-root-dependent commands:

- `resolve`
- `audit`
- `canonicalize`
- `reresolve`
- `index:build` / `index:check` / `test` / `check`
- `trees:build` / `breeds:build` / `profiles:build` / `stagger:build`
- source refresh / freeze workflows that rebuild generated artifacts

Source-root-free analysis commands:

- `hb analyze`
- `npm run analyze -- <target>`
- `npm run score -- <build.json>`
- `npm run list -- data/builds`
- `npm run diff -- <a> <b>`
- `npm run recommend -- analyze-gaps <build.json>`

Useful maintainer examples:

```bash
npm run score -- data/builds/08-zealot-chorus-swiss-knife.json --text
npm run recommend -- analyze-gaps data/builds/08-zealot-chorus-swiss-knife.json
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code npm run calc -- data/builds/08-zealot-chorus-swiss-knife.json --json
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code npm run edges:build
GROUND_TRUTH_SOURCE_ROOT=../Darktide-Source-Code npm run trees:build
```

Website browser smoke flow:

```bash
# terminal 1: serve static preview
make website-preview

# terminal 2: open compare page in named Playwright session
make website-smoke ARGS='open-compare 09-psyker-2026 01-veteran-havoc40-2026'

# terminal 2: inspect current page
make website-smoke ARGS='snapshot'
make website-smoke ARGS='screenshot'

# terminal 2: close browser session
make website-smoke ARGS='close'
```

Notes:

- `scripts/website-smoke.sh` defaults to `PLAYWRIGHT_CLI_SESSION=hb-website`, `HB_WEBSITE_HOST=127.0.0.1`, `HB_WEBSITE_PORT=4173`
- the Playwright CLI wrapper must exist and be executable at `~/.codex/skills/playwright/scripts/playwright_cli.sh`
- under Codex, browser launch and local port binding usually require sandbox escape; run these commands outside sandbox if you hit Chromium or `listen EPERM` errors

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
