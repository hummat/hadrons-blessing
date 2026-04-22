# AGENTS.md

AI agent instructions for the Hadron's Blessing project.

## Roles

The human owner (Matthias) provides high-level design directives, feature priorities, and architectural steering. All software engineering and software design decisions — implementation approach, data modeling, schema design, algorithm choice, error handling strategy, test design, etc. — are the AI agent's responsibility. Do not ask the human SWE/SWD/code questions; make the best decision, state your reasoning, and proceed. Escalate only when a decision requires domain knowledge about Darktide game mechanics that cannot be derived from the decompiled source, or when the decision has irreversible external consequences (e.g. pushing, publishing).

## What This Is

Source-backed Darktide entity resolution and build audit tooling. Maps community-facing names (talent labels, weapon names, blessing names, perks) to canonical internal IDs from the decompiled Darktide source (`Aussiemon/Darktide-Source-Code`).

This is a standalone project extracted from BetterBots. The long-term vision is a build intelligence platform: CLI + static web app for build ideation, creation, optimization, and debugging.

## Source Root Contract

All index builds and most tests require a pinned Darktide source checkout:

```bash
echo /path/to/Darktide-Source-Code > .source-root   # one-time setup (gitignored)
make check                                           # reads from .source-root
make test                                            # or set env: GROUND_TRUTH_SOURCE_ROOT=... npm test
```

Local path: `/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code`

Never hardcode the source root. The Makefile reads `.source-root` as a fallback; the env var always takes precedence. Tests that require it are skipped when neither is set. Source-backed commands now also require the pinned checkout to have a clean tracked git worktree; local edits in `Darktide-Source-Code` invalidate the snapshot contract.

`npm test` alone runs ~914 tests but silently skips ~107 source-dependent integration tests (effects pipeline, talent settings parser, class-side manifest, GL alias coverage audit). Always use `make check` or `GROUND_TRUTH_SOURCE_ROOT="$(cat .source-root)" npm test` for full confidence (1028+ tests).

## Commands

```bash
npm install
npm test                                          # unit tests (no source root needed for most)
npm run edges:build                               # regenerate tree edges from Lua source
npm run trees:build                               # build class talent-tree DAG JSON from Lua source
npm run check                                     # build + index:build + test + index:check
make check                                        # full quality gate (edges:build + effects:build + breeds:build + profiles:build + check)
npm run effects:build                             # populate calc fields from Lua buff templates
npm run synergy -- data/builds/08-zealot-chorus-swiss-knife.json          # synergy analysis (text)
npm run synergy -- data/builds/08-zealot-chorus-swiss-knife.json --json   # synergy analysis (JSON)
npm run synergy -- data/builds/                                       # batch synergy (all builds)
npm run analyze -- data/sample-build.json                            # end-to-end user CLI surface (same as hb analyze)
npm run resolve -- --query "Warp Rider" --context '{"kind":"talent","class":"psyker"}'
npm run audit -- data/builds/08-zealot-chorus-swiss-knife.json
npm run canonicalize -- data/sample-build.json    # raw scrape → canonical build JSON
npm run reresolve -- --write data/builds          # batch re-resolve unresolved entries
npm run coverage                                  # domain/kind coverage summary
npm run inspect -- --id psyker.talent.psyker_damage_based_on_warp_charge
npm run export:bot-weapons                        # regenerate data/exports/bot-weapon-recommendations.json
npm run betterbots:sync                          # regenerate data/builds/bot/*.json and data/exports/bot-weapon-recommendations.json from ../BetterBots
npm run report -- data/builds/08-zealot-chorus-swiss-knife.json           # human-readable text report
npm run report -- data/builds/08-zealot-chorus-swiss-knife.json --format md  # markdown report
npm run report -- data/builds/                                       # batch report (all builds)
npm run list                                                                    # list all builds (scorecard table)
npm run list -- --class psyker --sort breakpoint_relevance                      # filter + sort
npm run list -- --json                                                          # list as JSON (BuildSummary[])
npm run diff -- data/builds/08-zealot-chorus-swiss-knife.json data/builds/01-veteran-havoc40-2026.json          # compare two builds
npm run diff -- data/builds/08-zealot-chorus-swiss-knife.json data/builds/01-veteran-havoc40-2026.json --detailed  # with synergy + breakpoint diff
npm run diff -- data/builds/08-zealot-chorus-swiss-knife.json data/builds/01-veteran-havoc40-2026.json --json      # compare as JSON
npm run score -- data/builds/08-zealot-chorus-swiss-knife.json --json             # build scoring (with qualitative)
npm run score -- data/builds/08-zealot-chorus-swiss-knife.json --text             # build scoring (human-readable)
npm run recommend -- analyze-gaps data/builds/08-zealot-chorus-swiss-knife.json   # coverage gap analysis
npm run recommend -- swap-talent data/builds/08-zealot-chorus-swiss-knife.json --from <id> --to <id>  # talent swap delta
npm run recommend -- swap-weapon data/builds/08-zealot-chorus-swiss-knife.json --from <id> --to <id>  # weapon swap delta
npm run score:freeze                                                            # regenerate golden score snapshots
npm run breeds:build                                                            # extract breed HP/armor/hitzones/stagger/hit_mass from Lua
npm run profiles:build                                                          # extract damage profiles/action maps from Lua
npm run calc -- data/builds/08-zealot-chorus-swiss-knife.json                     # breakpoint calculator (damage, default mode)
npm run calc -- data/builds/08-zealot-chorus-swiss-knife.json --json              # breakpoint calculator (JSON)
npm run calc -- data/builds/08-zealot-chorus-swiss-knife.json --compare data/builds/01-veteran-havoc40-2026.json  # compare two builds
npm run calc -- data/builds/                                                 # batch calc (all builds)
npm run calc -- data/builds/08-zealot-chorus-swiss-knife.json --mode stagger      # stagger analysis
npm run calc -- data/builds/08-zealot-chorus-swiss-knife.json --mode cleave       # cleave analysis
npm run calc -- data/builds/08-zealot-chorus-swiss-knife.json --mode toughness    # survivability analysis
npm run stagger -- data/builds/08-zealot-chorus-swiss-knife.json                  # stagger (alias)
npm run cleave -- data/builds/08-zealot-chorus-swiss-knife.json                   # cleave (alias)
npm run toughness -- data/builds/08-zealot-chorus-swiss-knife.json                # toughness (alias)
npm run calc:freeze                                                             # regenerate golden calc snapshots
npm run stagger:freeze                                                          # regenerate golden stagger snapshots
npm run cleave:freeze                                                           # regenerate golden cleave snapshots
npm run toughness:freeze                                                        # regenerate golden toughness snapshots
npm run stagger:build                                                             # extract stagger settings from Lua source
npm run weapons:build                                                             # mirror website weapon art + emit static asset map
npm run icons:build                                                               # mirror website talent icons + emit static asset map
node dist/cli/extract-build.js <gl-url> --json    # live GL scrape → canonical (requires Playwright)
node dist/cli/extract-build.js <gl-url> --raw-json # live GL scrape → pre-canonical raw shape
# Website (run from website/)
cd website && npm run dev                                                         # local dev server
cd website && npm run build                                                       # production build → website/build/
cd website && npm run test                                                        # website tests (filter-sort)
cd website && npx tsx scripts/generate-data.ts                                    # regenerate build summaries/details + copied tree DAGs + talent labels
make website-build                                                                # full pipeline: compile library → generate data → build site
make website-dev                                                                  # convenience: start dev server
```

## Data Architecture

```
data/ground-truth/
  entities/          # canonical entity records (one JSON per class/domain)
  aliases/           # alias records (display names → entity IDs)
  edges/             # relationships between entities
  evidence/          # source citations and justifications
  non-canonical/     # known-unresolved and display-only labels
  schemas/           # JSON Schema definitions for all record types
  source-snapshots/  # pinned source version metadata
  generated/         # built artifacts (gitignored — regenerated by index:build, breeds:build, profiles:build, stagger:build)
                     #   index.json         — entity index
                     #   breed-data.json    — breed HP, armor, hitzones, difficulty scaling, stagger data, hit_mass
                     #   damage-profiles.json — damage profiles, action maps, pipeline constants
                     #   stagger-settings.json — global stagger thresholds, categories, scalars
data/exports/        # checked-in JSON artifacts for downstream consumers (BetterBots)
data/builds/         # 27 canonical build fixtures (core 24 cross-class set + 3 Zealot additions)
src/
  lib/               # typed library modules (.ts)
                     # resolve.ts, validate.ts, load.ts, normalize.ts,
                     # build-canonicalize.ts, build-classification.ts,
                     # build-classification-registry.ts, build-shape.ts,
                     # build-audit.ts, coverage.ts, inspect.ts,
                     # lua-tree-parser.ts, tree-edge-generator.ts,
                     # lua-data-reader.ts, talent-settings-parser.ts,
                     # condition-tagger.ts, buff-semantic-parser.ts,
                     # synergy-stat-families.ts, synergy-rules.ts,
                     # synergy-model.ts,
                     # damage-calculator.ts, breakpoint-checklist.ts,
                     # stagger-calculator.ts, cleave-calculator.ts,
                     # toughness-calculator.ts,
                     # index.ts (public API entry point)
  cli/               # CLI entry points (.ts, compiled to dist/cli/)
  generated/         # auto-generated types (schema-types.ts)
dist/                # compiled output (gitignored — regenerated by npm run build)
website/             # SvelteKit static site (separate npm package)
  src/routes/        # SvelteKit pages (+page.svelte, +page.ts)
  src/lib/           # shared types, filter-sort logic
  scripts/           # build-time data generation (generate-data.ts)
  static/data/       # pre-computed JSON (build-summaries.json — checked in)
  build/             # SvelteKit output (gitignored)
```

Entity ID format: `{domain}.{kind}.{internal_name}` — e.g. `psyker.talent.psyker_damage_based_on_warp_charge`

Shared cross-class entities use `shared` as domain: `shared.weapon.autogun_p1_m1`, `shared.gadget_trait.gadget_toughness_increase`. Family-level stat nodes: `shared.stat_node.toughness_boost`.

## Resolution States

- `resolved` — unambiguous match to a canonical entity
- `ambiguous` — multiple candidates above threshold, no winner
- `unresolved` — no match above threshold
- `proposed` — below threshold, best candidate surfaced with low confidence
- `non_canonical` — structurally unresolvable (e.g. multi-option guide labels listing alternatives). **Never** use as a parking spot for deferred work — missing aliases and unmodeled domains are `unresolved`.

## Known Coverage Gaps

**Curio cosmetic base labels** (81 `non_canonical` selections across the 27 build fixtures; 4 unique labels in the fixtures, 21 unique base labels confirmed by the runtime dump): the live runtime item catalog shows these as concrete variants like `Blessed Bullet (Caged|Casket|Reliquary)`. Games Lantern drops that suffix, so the scraped base label is structurally ambiguous rather than unresolved. Curio *perks* still resolve (`shared.gadget_trait.*`). A DMF helper mod for a one-shot live dump lives in `tools/darktide-mods/curio_dump/`.

**Residual fixture unresolveds:** none in the canonical 27-build fixture set. The last three unresolved entries were scrape-parser mistakes where the GL weapon perk string `Increase Ranged Critical Strike Chance by 2-5%` was misfiled into blessing slots; that extractor bug is fixed.

**Weapons with a single scraped perk (5 fixtures):** builds 03, 08, 11, 16 (ranged) and 21 (melee) each carry only one weapon perk, even though the live GL pages list two. The surviving perks are well-formed and resolve cleanly; the second row was dropped during scraping. The scoring pipeline handles missing perks correctly — it just understates perk coverage for these builds. Requires a re-scrape to confirm whether the extractor mis-classified the second row or GL itself omitted it.

## Known Scoring/Calculator Limitations

**Weapon blessing validation source split:** Blessing validation now derives weapon blessing pools from the ground-truth edge graph (`weapon_has_trait_pool` → `instance_of`) and only falls back to `build-scoring-data.json` when a weapon has no source-backed path. The hand-curated scoring catalog still matters for perk tier tables, curio ratings, and weapon role/class metadata.

**lerped_stat_buff lerp factor:** `assembleBuildBuffStack` hardcodes `warp_charge` as the interpolation factor for all `lerped_stat_buff` effects. Validated: all 40 lerped effects in the corpus have null conditions, confirming warp_charge is the only interpolation variable in practice.

**talent population edge-only fallback:** If `_resolvedIds` is absent from synergy output (unlikely in production), the fallback counts only talents that participate in edges — isolated talents are invisible, inflating coherence scores.

**Cleave per-target damage falloff:** The profile extractor does not extract `targets[n]` per-target overrides from damage profiles (0/592 profiles have them). The cleave calculator uses the primary target's damage for all targets, which is conservative (real damage falls off for subsequent targets).

**Ranged breakpoint distance policy:** Breakpoint matrices no longer use one hidden `20m` default. Ranged entries now evaluate `sustained` at `ranged_close` (default 12.5m) and `aimed` / `burst` at the midpoint between `ranged_close` and `ranged_far` (default 21.25m). This is still a scoring policy assumption, not a source-backed combat-context fact.

**Survivability scoring policy:** The toughness calculator now feeds a class-relative `survivability` dimension. The score compares build profile vs baseline class profile at Damnation using effective HP, movement-state toughness, and recovery. It is still a scoring policy layer, not a direct source-backed combat truth.

**Bot-flag signal matching:** `score-build.ts` flags builds for bot-compat via word-start STEM matching on normalized signal strings (e.g. `"dodg"` matches dodge/dodging/dodges; `"slid"` matches slide/sliding). `stemPattern()` anchors each stem at `\b` and allows trailing characters. Snapshots at `tests/fixtures/ground-truth/scores/` assert `bot_flags` deepEqual to lock the classifier against drift. When adding a new signal pattern, pick the stem that covers all morphological variants — never a literal substring that misses one.

**Scorecard-deps degradation contract:** `loadScorecardDeps` warns (`console.warn`) and returns a partial deps object only when generated ground-truth/calc data is missing (ENOENT-class). Any other exception propagates. `analyzeScorecard` does the same per-dimension and records per-dimension failures in `ScorecardAnalysis.errors` (`synergy` / `calc` / `survivability`). Use `resetScorecardDepsCache()` in tests that need a clean singleton. Missing-data warnings exist so "data said no" and "no data loaded" are never confused.

## Adding New Entity Coverage

1. Add entity records to `data/ground-truth/entities/{domain}.json`
2. Add alias records to `data/ground-truth/aliases/{domain}.json` (or `shared.json`)
3. Add evidence records to `data/ground-truth/evidence/{domain}.json` for non-obvious mappings
4. Add edges to `data/ground-truth/edges/{domain}.json` for relationships
5. Add golden test cases to `tests/fixtures/ground-truth/resolver-golden.json`
6. Update coverage fixtures in `tests/fixtures/ground-truth/expected-*.json`
7. Run `make check` to verify

All `refs` fields in entity and evidence records must point to real file:line in the source root. The index build validates these.

## Schemas

All records are validated against JSON schemas in `data/ground-truth/schemas/`. Never add a field that isn't in the schema. Never add a record that violates schema invariants (e.g. `loc_key` aliases cannot use `match_mode: fuzzy_allowed`; `inferred_ui_name` status is rejected on canonical entities).

## Build Fixtures

`data/builds/` contains 30 representative build JSON files (builds 01–30: the original 24-build cross-class set plus 3 additional Zealot fixtures and 3 additional Veteran fixtures) in canonical build shape. Each build stores `schema_version`, `title`, `class`, `provenance`, `ability`, `blitz`, `aura`, `keystone`, `talents[]`, `weapons[]`, and `curios[]`. Every selection carries `raw_label`, `canonical_entity_id`, and `resolution_status` (`resolved` / `unresolved` / `non_canonical`).

All 30 builds have been extracted from live GL pages with full talent trees, targeting Havoc 40 meta builds with diversity across keystones, weapons, and playstyles. Current fixture totals: 1593 resolved, 2 unresolved, 90 non_canonical. The two unresolved selections are currently in `30-veteran-expedition-smoke-stealth.json` (`Unknown aura`, `Close and Kill`) and are intentionally retained to surface resolver/index gaps instead of being filtered out. The `non_canonical` bucket in the fixtures is four curio cosmetic base labels whose concrete runtime variants are collapsed by the scrape; the runtime dump confirms 21 such ambiguous base labels in the full curio catalog.

Frozen audit snapshots live in `tests/fixtures/ground-truth/audits/`. When the index or audit logic changes, re-freeze all snapshots with `npm run audit:freeze`. Do NOT use `npm run audit -- <file> > snapshot.json` — npm's stderr banner contaminates the JSON output.

Frozen calc snapshots live in `tests/fixtures/ground-truth/calc/`. Regression tests in `damage-calculator.test.ts` compare fresh `computeBreakpoints` output against these snapshots for every build. Re-freeze with `npm run calc:freeze` after pipeline changes.

## Canonical Build Shape

The canonical build format is the single shared shape consumed by `audit`, `score`, `canonicalize`, `reresolve`, and future website flows. Key design decisions:

- Decision-data only — no prose, no scrape artifacts
- Fixed structural slots: `ability`, `blitz`, `aura`, `keystone` (nullable)
- Flat `talents[]` for all other selected class-side nodes
- Blessings resolve to family-level IDs (`shared.name_family.blessing.*`), not concrete weapon-trait instances
- Stat nodes resolve to family-level IDs (`shared.stat_node.*`), stripping GL positional numbers. Per-instance resolution deferred to tree DAG work.
- `ambiguous` is not a valid `resolution_status` in build files — if ingestion can't commit, store `unresolved`

## Synergy Model

`npm run synergy -- <build.json> [--json]` analyzes talent-weapon synergies. Produces structured output with synergy edges, anti-synergies, orphaned selections, and build coverage metrics.

**Architecture:** 3 modules in `src/lib/`:
- `synergy-stat-families.ts` — 144 stats mapped to 11 families (melee_offense, ranged_offense, general_offense, crit, toughness, damage_reduction, mobility, warp_resource, grenade, stamina, utility). Multi-membership supported.
- `synergy-rules.ts` — 5 pure-function rules: stat-family alignment, slot coverage, trigger-target chains, resource flow, orphan detection
- `synergy-model.ts` — orchestrator: selection resolution (direct calc, stat_node prefix match, blessing tier-4 traversal), stat aggregation (NHHI concentration, build identity, coverage gaps), output assembly. The stat_node prefix-match resolution path is mirrored in `damage-calculator.ts:assembleBuildBuffStack` for breakpoint accuracy.

**Coverage:** Effect-modeled coverage averages ~71.7% per build (56% min, 82% max) across the original 24-build baseline fixture set. Source-linked coverage averages ~89.1% (65% min, 97% max) on that same baseline. Blessing synergy remains partial because family-level blessing traversal still depends on `instance_of` → weapon_trait tier paths rather than full per-weapon runtime context.

**Output consumed by:** #9 (scoring) and #10 (recommendations). Design spec: `docs/superpowers/specs/2026-03-16-synergy-model-design.md`.

**Deferred:** Keyword affinity rule (no proficiency data in index), weak (1) strength edges, and genuine pairwise orphan/coverage semantics that remain after the `unknown_condition` cleanup. The current build corpus now has `0` opaque conditions in emitted entity calc data; remaining low-score cases are graph/model limitations, not raw condition-tagging failures.

Frozen synergy snapshots in `tests/fixtures/ground-truth/synergy/`. Re-freeze with `npm run synergy:freeze`.

## Build Scoring

`npm run score -- <build.json> [--json|--text]` produces a full scorecard with mechanical + qualitative dimensions.

**Mechanical (from hardcoded data):** `perk_optimality`, `curio_efficiency` — scored from perk tier tables in `build-scoring-data.json`.

**Qualitative (from synergy model):** `talent_coherence` (talent-talent edge density + graph isolation), `blessing_synergy` (blessing-X edge density + blessing-blessing bonus), `role_coverage` (stat family breadth + coverage gaps + slot balance). Each 1–5.

**Calculator-derived (from breakpoint matrix):** `breakpoint_relevance` (weighted checklist of community-standard breakpoints), `difficulty_scaling` (damnation→auric degradation on high-priority breakpoints). Scored via `breakpoint-checklist.ts` against `data/ground-truth/breakpoint-checklist.json`.

**Survivability:** class-relative durability from the toughness calculator (effective HP, movement-state toughness, and recovery) at Damnation.

**Composite:** Sum of all 8 dimensions, scaled to /40 when survivability is present. Letter grades: S (36+), A (31+), B (25+), C (19+), D (<19). Legacy /35 thresholds still apply only when survivability is absent.

**Perk normalization:** GL-scraped perk labels (e.g. `"Damage (Flak Armoured Enemies)"`, `"Damage Resistance (Gunners)"`) are normalized to match scoring catalog keys via `normalizePerkName()` in `score-build.ts`. Integration tests in `score-build.test.ts` verify every distinct GL perk format resolves correctly.

Module: `src/lib/score-build.ts`. Frozen score snapshots in `tests/fixtures/ground-truth/scores/`. Re-freeze with `npm run score:freeze`.

**Scoring data coverage:** When adding new builds, run the coverage audit in `score-build.test.ts` to catch gaps.

## Build Recommendations

`npm run recommend -- <operation> <build.json> [--from <id> --to <id>] [--json]`

Three operations:
- `analyze-gaps` — coverage gap diagnosis (survivability, crit_chance_source, warp_charge_producer, slot_imbalance) + underinvested families
- `swap-talent` — score delta + gained/lost synergy edges + tree reachability validation (parent_of + exclusive_with)
- `swap-weapon` — score delta + blessing cascade (same-family retains, cross-family removes) + available trait pool

**Deferred to v1.1:** `suggest-improvement` (brute-force candidate enumeration).

Module: `src/lib/build-recommendations.ts`. Formatter: `src/lib/recommend-formatter.ts`. Design spec: `docs/superpowers/specs/2026-03-17-scoring-and-recommendations-design.md`.

## Stagger Calculator

`npm run stagger -- <build.json> [--text|--json]` computes stagger tiers for every weapon action against key breeds. Determines whether a weapon can interrupt specific enemies (e.g., "can this weapon stagger a Crusher out of overhead?").

**Architecture:** Mirrors the damage pipeline but uses `power_distribution.impact` instead of `.attack`. Computes impact power → applies impact ADM → applies breed stagger resistance/reduction → classifies stagger tier (none/light/medium/heavy) against per-breed thresholds.

**Data sources:** Per-profile `stagger_category` and `power_distribution.impact` from `damage-profiles.json`. Per-breed `stagger` object (resistance, reduction, thresholds, durations, immune times) from `breed-data.json`. Global stagger settings (type definitions, categories, rending multiplier) from `stagger-settings.json`.

**Scoring:** 3 stagger checklist entries in `breakpoint-checklist.json` (Crusher, Rager, Mauler). Scored via `scoreStaggerRelevance()` in `breakpoint-checklist.ts`.

Module: `src/lib/stagger-calculator.ts`. CLI: `src/cli/stagger-build.ts`. Frozen snapshots in `tests/fixtures/ground-truth/stagger/`. Re-freeze with `npm run stagger:freeze`.

## Cleave Calculator

`npm run cleave -- <build.json> [--text|--json]` simulates multi-target melee sweeps. Given a weapon's cleave budget and a horde composition, determines how many enemies are hit and killed per swing.

**Architecture:** Resolves cleave budget from `cleave_distribution.attack` (lerped by quality). Simulates front-to-back sweep: each target consumes `hit_mass` from the budget until exhausted. Per-target damage computed via `computeHit` from the damage calculator.

**Horde compositions:** Two standard compositions defined as data — `mixed_melee_horde` (6 targets: poxwalkers, assault, melee) and `elite_mixed` (4 targets: assault, melee, rager). Sorted by hit_mass ascending.

**Known limitation:** Per-target damage falloff (`targets[n]` profile overrides) is not extracted. All targets receive primary target damage, which is conservative.

**Scoring:** 2 cleave checklist entries in `breakpoint-checklist.json` (heavy 3+ kills, light 2+ kills in mixed horde). Scored via `scoreCleaveRelevance()` in `breakpoint-checklist.ts`.

Module: `src/lib/cleave-calculator.ts`. CLI: `src/cli/cleave-build.ts`. Frozen snapshots in `tests/fixtures/ground-truth/cleave/`. Re-freeze with `npm run cleave:freeze`.

## Toughness Calculator

`npm run toughness -- <build.json> [--text|--json]` computes survivability profiles. Given a build's defensive talents/blessings/curio perks, calculates effective toughness, damage reduction, effective HP, and toughness regeneration.

**Architecture:** Defender-side analysis. Collects DR sources from build entities (toughness_damage_taken_multiplier, damage_taken_multiplier, toughness_bonus, etc.). Computes multiplicative DR stacking, effective HP (health × wounds + toughness/DR), per-state TDR modifiers (dodge/slide/sprint), and coherency-based toughness regen rates.

**Data sources:** Per-class base stats (health, toughness, wounds per difficulty, state damage modifiers, regen rates) from `data/ground-truth/class-base-stats.json`. Build buff effects from the entity index.

**Scoring:** Feeds the `survivability` scorecard dimension via class-relative comparison against a stripped baseline build at Damnation.

Module: `src/lib/toughness-calculator.ts`. CLI: `src/cli/toughness-build.ts`. Frozen snapshots in `tests/fixtures/ground-truth/toughness/`. Re-freeze with `npm run toughness:freeze`.

## Build Browse and Compare

`npm run list [dir] [--class X] [--weapon X] [--grade X] [--sort X] [--reverse] [--json]` lists builds as a filterable, sortable scorecard table. `npm run diff -- <a> <b> [--detailed] [--json]` compares two builds with score deltas, structural diff, and optional analytical diff (synergy edges + breakpoint comparison).

**Architecture:** Two library modules (`build-list.ts`, `build-diff.ts`) backed by a shared `scorecard-deps.ts` helper for graceful degradation of synergy/calc data. Both modules exported from `index.ts` for #6 website consumption.

**`BuildSummary`** (from `build-list.ts`): flat table-row shape with file, title, class, ability, keystone, weapons, and all 8 scoring dimensions + composite + letter grade. Filtering: class (exact), weapon (substring on name/family), minGrade. Sorting: any dimension, descending default, nulls last.

**`BuildDiff`** (from `build-diff.ts`): score deltas (b - a for all 8 dimensions), structural diff (set operations on entity IDs for talents/weapons/blessings/curio_perks + slot diffs for ability/blitz/aura/keystone), and optional analytical diff (synergy edge set diff + breakpoint checklist HTK comparison).

Design spec: `docs/superpowers/specs/2026-03-31-build-browse-and-compare-design.md`.

## Classification Registry

`src/lib/build-classification-registry.ts` maps GL talent slugs to canonical build slots. Only slot-routing nodes need entries (abilities, blitz, auras, keystones, modifiers). Regular talents flow through to `talents[]` without registry entries. The registry is populated per-class from the decompiled source tree.

## Tech Stack

TypeScript (strict), Node.js ESM (`"type": "module"`). Compiled with `tsc` to `dist/`; CLI commands run via `node dist/cli/`. Tests run via `tsx --test` (not compiled). Runtime dependencies: `ajv`, `playwright`. Dev dependencies: `typescript`, `tsx`, and build/test tooling.

Library entry point: `src/lib/index.ts` (compiled to `dist/lib/index.js`) — public API for the website and downstream consumers.

Website: SvelteKit 2 + Svelte 5 + Tailwind CSS v4 + `@sveltejs/adapter-static` in `website/`. Deployed to GitHub Pages via GitHub Actions. Svelte Flow (xyflow) planned for synergy graph (v1 Plan 2).

## Decompiled Source

`Aussiemon/Darktide-Source-Code` — local at `../Darktide-Source-Code` relative to this repo. Pull before starting new entity work:

```bash
cd ../Darktide-Source-Code && git pull && cd -
```

Key paths for entity work:
- `scripts/ui/views/talent_builder_view/layouts/{class}_tree.lua` — talent tree node definitions (talent name, type, icon, exclusive groups)
- `scripts/settings/ability/archetype_talents/talents/{class}_talents.lua` — talent implementation details (buff definitions, display name loc keys)
- `scripts/settings/ability/archetype_talents/talents/base_talents.lua` — shared stat node definitions (138 passive buff templates across 14 families)
- `scripts/settings/equipment/weapons/` — weapon templates
- `scripts/settings/equipment/weapon_traits/` — blessing/perk templates
- `scripts/backend/item_definitions/` — backend item IDs
- `scripts/utilities/attack/damage_calculation.lua` — 13-stage damage pipeline (#5)
- `scripts/settings/damage/power_level_settings.lua` — scaling constants, ADM defaults, boost curves (#5)
- `scripts/settings/damage/armor_settings.lua` — armor types, rending multipliers (#5)
- `scripts/settings/damage/damage_profile_settings.lua` — lerp tables, cleave presets (#5)
- `scripts/settings/breed/breeds/{faction}/*_breed.lua` — breed HP, armor, hitzones (#5)
- `scripts/settings/difficulty/minion_difficulty_settings.lua` — difficulty scaling (#5)

## Roadmap

See [`docs/roadmap.md`](docs/roadmap.md) for the current implementation sequence, open issues, dependency chain, and completed milestones.

## BetterBots Integration

Issue `#4` resolved. `data/exports/` is the cross-repo handoff surface, and `data/builds/bot/` contains the checked-in canonical bot fixtures. BetterBots agents read exports via `../hadrons-blessing/data/exports/` or regenerate from BetterBots source via CLI (`npm run betterbots:sync`; `npm run export:bot-weapons` for export-only refreshes). The source of truth is `../BetterBots/scripts/mods/BetterBots/bot_profiles.lua` (`DEFAULT_PROFILE_TEMPLATES`). See `data/exports/README.md` for the contract and `docs/superpowers/specs/2026-03-15-betterBots-integration-contract-design.md` for the original design spec.

**Weapon export scoring:** Picks are evaluated against 4 bot-incompatibility criteria: dodge-dependent, block-timing-dependent, weapon-special-dependent (until BetterBots #33), and weakspot-aim-dependent. The export declares `"assumes": "betterbots"` — ADS, peril, force staves, and melee selection are handled by BetterBots and are not exclusion criteria.

## No Unsourced Claims

Every factual claim about Darktide mechanics must be sourced from a file you've actually read. If you haven't read the source, say so — never guess. Entity IDs, talent names, field names, buff values — all must be verified against the decompiled source before being added to ground-truth data.
