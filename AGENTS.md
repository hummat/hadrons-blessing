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

Never hardcode the source root. The Makefile reads `.source-root` as a fallback; the env var always takes precedence. Tests that require it are skipped when neither is set.

`npm test` alone runs ~914 tests but silently skips ~107 source-dependent integration tests (effects pipeline, talent settings parser, class-side manifest, GL alias coverage audit). Always use `make check` or `GROUND_TRUTH_SOURCE_ROOT="$(cat .source-root)" npm test` for full confidence (1028+ tests).

## Commands

```bash
npm install
npm test                                          # unit tests (no source root needed for most)
npm run edges:build                               # regenerate tree edges from Lua source
npm run check                                     # build + index:build + test + index:check
make check                                        # full quality gate (edges:build + effects:build + breeds:build + profiles:build + check)
npm run effects:build                             # populate calc fields from Lua buff templates
npm run synergy -- data/builds/08-gandalf-melee-wizard.json          # synergy analysis (text)
npm run synergy -- data/builds/08-gandalf-melee-wizard.json --json   # synergy analysis (JSON)
npm run synergy -- data/builds/                                       # batch synergy (all builds)
npm run resolve -- --query "Warp Rider" --context '{"kind":"talent","class":"psyker"}'
npm run audit -- data/builds/08-gandalf-melee-wizard.json
npm run canonicalize -- data/sample-build.json    # raw scrape → canonical build JSON
npm run reresolve -- --write data/builds          # batch re-resolve unresolved entries
npm run coverage                                  # domain/kind coverage summary
npm run inspect -- --id psyker.talent.psyker_damage_based_on_warp_charge
npm run export:bot-weapons                        # regenerate data/exports/bot-weapon-recommendations.json
npm run report -- data/builds/08-gandalf-melee-wizard.json           # human-readable text report
npm run report -- data/builds/08-gandalf-melee-wizard.json --format md  # markdown report
npm run report -- data/builds/                                       # batch report (all builds)
npm run list                                                                    # list all builds (scorecard table)
npm run list -- --class psyker --sort breakpoint_relevance                      # filter + sort
npm run list -- --json                                                          # list as JSON (BuildSummary[])
npm run diff -- data/builds/08-gandalf-melee-wizard.json data/builds/01-veteran-squad-leader.json          # compare two builds
npm run diff -- data/builds/08-gandalf-melee-wizard.json data/builds/01-veteran-squad-leader.json --detailed  # with synergy + breakpoint diff
npm run diff -- data/builds/08-gandalf-melee-wizard.json data/builds/01-veteran-squad-leader.json --json      # compare as JSON
npm run score -- data/builds/08-gandalf-melee-wizard.json --json             # build scoring (with qualitative)
npm run score -- data/builds/08-gandalf-melee-wizard.json --text             # build scoring (human-readable)
npm run recommend -- analyze-gaps data/builds/08-gandalf-melee-wizard.json   # coverage gap analysis
npm run recommend -- swap-talent data/builds/08-gandalf-melee-wizard.json --from <id> --to <id>  # talent swap delta
npm run recommend -- swap-weapon data/builds/08-gandalf-melee-wizard.json --from <id> --to <id>  # weapon swap delta
npm run score:freeze                                                            # regenerate golden score snapshots
npm run breeds:build                                                            # extract breed HP/armor/hitzones/stagger/hit_mass from Lua
npm run profiles:build                                                          # extract damage profiles/action maps from Lua
npm run calc -- data/builds/08-gandalf-melee-wizard.json                     # breakpoint calculator (damage, default mode)
npm run calc -- data/builds/08-gandalf-melee-wizard.json --json              # breakpoint calculator (JSON)
npm run calc -- data/builds/08-gandalf-melee-wizard.json --compare data/builds/01-veteran-squad-leader.json  # compare two builds
npm run calc -- data/builds/                                                 # batch calc (all builds)
npm run calc -- data/builds/08-gandalf-melee-wizard.json --mode stagger      # stagger analysis
npm run calc -- data/builds/08-gandalf-melee-wizard.json --mode cleave       # cleave analysis
npm run calc -- data/builds/08-gandalf-melee-wizard.json --mode toughness    # survivability analysis
npm run stagger -- data/builds/08-gandalf-melee-wizard.json                  # stagger (alias)
npm run cleave -- data/builds/08-gandalf-melee-wizard.json                   # cleave (alias)
npm run toughness -- data/builds/08-gandalf-melee-wizard.json                # toughness (alias)
npm run calc:freeze                                                             # regenerate golden calc snapshots
npm run stagger:freeze                                                          # regenerate golden stagger snapshots
npm run cleave:freeze                                                           # regenerate golden cleave snapshots
npm run toughness:freeze                                                        # regenerate golden toughness snapshots
npm run stagger:build                                                             # extract stagger settings from Lua source
node dist/cli/extract-build.js <gl-url> --json    # live GL scrape → canonical (requires Playwright)
node dist/cli/extract-build.js <gl-url> --raw-json # live GL scrape → pre-canonical raw shape
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
data/builds/         # 24 canonical build fixtures (all 6 classes, 4 per class)
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

**Curio item names** (60 unresolved, 6 unique labels like "Blessed Bullet"): Darktide's item catalog is fetched from Fatshark's authenticated backend at runtime. The decompiled source contains curio rendering code and perk/trait mechanics but not the item catalog itself. Curio *perks* resolve (`shared.gadget_trait.*`); only the cosmetic item *names* are unresolvable from this source. These are the lowest-value unresolved entries — they don't affect build analysis, scoring, or optimization.

## Known Scoring/Calculator Limitations

**Weapon scoring catalog gap:** 23 of 32 unique weapons in builds have scoring data entries in `build-scoring-data.json`. The other 9 weapons lack blessing lists. Perks still score correctly (catalog is weapon-agnostic for perks), but blessing validation returns "unknown" for these weapons.

**talent_coherence uniformly 1/5:** The 0.2 edges_per_talent threshold is too high at ~40% calc coverage. Every build scores 1. Needs threshold recalibration or calc coverage improvement.

**lerped_stat_buff lerp factor:** `assembleBuildBuffStack` hardcodes `warp_charge` as the interpolation factor for all `lerped_stat_buff` effects. Validated: all 40 lerped effects in the corpus have null conditions, confirming warp_charge is the only interpolation variable in practice.

**talent population edge-only fallback:** If `_resolvedIds` is absent from synergy output (unlikely in production), the fallback counts only talents that participate in edges — isolated talents are invisible, inflating coherence scores.

**Cleave per-target damage falloff:** The profile extractor does not extract `targets[n]` per-target overrides from damage profiles (0/592 profiles have them). The cleave calculator uses the primary target's damage for all targets, which is conservative (real damage falls off for subsequent targets).

**Toughness scoring deferred:** The toughness calculator produces full survivability profiles but does not feed into the scorecard. A `survivability` dimension needs its own design — it is qualitatively different from attacker-side dimensions (no breakpoint checklist analog).

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

`data/builds/` contains 24 representative build JSON files (builds 01–24, 4 per class, all 6 classes) in canonical build shape. Each build stores `schema_version`, `title`, `class`, `provenance`, `ability`, `blitz`, `aura`, `keystone`, `talents[]`, `weapons[]`, and `curios[]`. Every selection carries `raw_label`, `canonical_entity_id`, and `resolution_status` (`resolved` / `unresolved` / `non_canonical`).

All 24 builds have been extracted from live GL pages with full talent trees, targeting Havoc 40 meta builds with diversity across keystones, weapons, and playstyles. 1217 resolved, 127 unresolved (curio cosmetic names — backend-only, plus some blitz/blessing labels).

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

**Coverage:** ~40% per-build calc coverage. Blessing synergy partial (27/46 families via `instance_of` → weapon_trait tier traversal). Named gameplay talents at 48% calc coverage; stat-node talents and gadget traits at 100%.

**Output consumed by:** #9 (scoring) and #10 (recommendations). Design spec: `docs/superpowers/specs/2026-03-16-synergy-model-design.md`.

**Deferred:** Keyword affinity rule (no proficiency data in index), weak (1) strength edges, ~58 opaque conditions (reduced from 68 by condition tagger expansion in #5).

Frozen synergy snapshots in `tests/fixtures/ground-truth/synergy/`. Re-freeze with `npm run synergy:freeze`.

## Build Scoring

`npm run score -- <build.json> [--json|--text]` produces a full scorecard with mechanical + qualitative dimensions.

**Mechanical (from hardcoded data):** `perk_optimality`, `curio_efficiency` — scored from perk tier tables in `build-scoring-data.json`.

**Qualitative (from synergy model):** `talent_coherence` (talent-talent edge density + graph isolation), `blessing_synergy` (blessing-X edge density + blessing-blessing bonus), `role_coverage` (stat family breadth + coverage gaps + slot balance). Each 1–5.

**Calculator-derived (from breakpoint matrix):** `breakpoint_relevance` (weighted checklist of community-standard breakpoints), `difficulty_scaling` (damnation→auric degradation on high-priority breakpoints). Scored via `breakpoint-checklist.ts` against `data/ground-truth/breakpoint-checklist.json`.

**Composite:** Sum of all 7 dimensions, scaled to /35. Letter grades: S (32+), A (27+), B (22+), C (17+), D (<17).

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

**Scoring:** Deferred. The computation exists and is callable via CLI, but does not feed the scorecard. A `survivability` dimension needs its own design.

Module: `src/lib/toughness-calculator.ts`. CLI: `src/cli/toughness-build.ts`. Frozen snapshots in `tests/fixtures/ground-truth/toughness/`. Re-freeze with `npm run toughness:freeze`.

## Build Browse and Compare

`npm run list [dir] [--class X] [--weapon X] [--grade X] [--sort X] [--reverse] [--json]` lists builds as a filterable, sortable scorecard table. `npm run diff -- <a> <b> [--detailed] [--json]` compares two builds with score deltas, structural diff, and optional analytical diff (synergy edges + breakpoint comparison).

**Architecture:** Two library modules (`build-list.ts`, `build-diff.ts`) backed by a shared `scorecard-deps.ts` helper for graceful degradation of synergy/calc data. Both modules exported from `index.ts` for #6 website consumption.

**`BuildSummary`** (from `build-list.ts`): flat table-row shape with file, title, class, ability, keystone, weapons, and all 7 scoring dimensions + composite + letter grade. Filtering: class (exact), weapon (substring on name/family), minGrade. Sorting: any dimension, descending default, nulls last.

**`BuildDiff`** (from `build-diff.ts`): score deltas (b - a for all 8 dimensions), structural diff (set operations on entity IDs for talents/weapons/blessings/curio_perks + slot diffs for ability/blitz/aura/keystone), and optional analytical diff (synergy edge set diff + breakpoint checklist HTK comparison).

Design spec: `docs/superpowers/specs/2026-03-31-build-browse-and-compare-design.md`.

## Classification Registry

`src/lib/build-classification-registry.ts` maps GL talent slugs to canonical build slots. Only slot-routing nodes need entries (abilities, blitz, auras, keystones, modifiers). Regular talents flow through to `talents[]` without registry entries. The registry is populated per-class from the decompiled source tree.

## Tech Stack

TypeScript (strict), Node.js ESM (`"type": "module"`). Compiled with `tsc` to `dist/`; CLI commands run via `node dist/cli/`. Tests run via `tsx --test` (not compiled). No runtime dependencies. Dev dependencies: `typescript`, `tsx`, `ajv` for schema validation, `playwright` for GL scraping.

Library entry point: `src/lib/index.ts` (compiled to `dist/lib/index.js`) — public API for the website and downstream consumers.

Future: SvelteKit + Tailwind CSS + Svelte Flow (xyflow) for the web app.

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

## Open Issues

- `#6` Website architecture

## Completed Issues

- `#19` Full class-side entity and Games Lantern alias coverage automation (source-generated class-side manifest, GL class-tree alias generation, full-tree completeness audits, downstream stat-family coverage fix)

- `#16` Weapon mark mapping correction (43 corrections via in-game MasterItems dump; DMF mod in `tools/darktide-mods/weapon_dump/`; 16 weapons with broken game localization keep existing names)

- `#1` TypeScript migration (strict types for all 97 source/test files, compiled `tsc` output, library entry point)

- `#4` BetterBots integration contract
- `#5` Calculator and dataflow layer (13-stage damage pipeline, `breeds:build` + `profiles:build` extraction, breakpoint matrix, scoring integration, `calc` CLI)
- `#7` Buff semantic extraction (`effects:build` pipeline)
- `#8` Synergy model (`synergy` CLI, 5 rules, stat aggregator)
- `#9` Build quality scoring (7 dimensions: 2 mechanical [perk_optimality, curio_efficiency], 3 qualitative [talent_coherence, blessing_synergy, role_coverage], 2 calculator-derived [breakpoint_relevance, difficulty_scaling]; composite /35 + letter grade)
- `#10` Modification recommendations v1 (analyze-gaps, swap-talent, swap-weapon; suggest-improvement deferred to v1.1)
- `#11` Toughness and survivability calculator (defender-side: DR stacking, effective HP, bleedthrough, toughness regen, state TDR modifiers; `toughness` CLI; scoring deferred)
- `#12` Stagger calculator (impact pipeline, stagger tier classification against breed thresholds, `stagger` CLI, scoring integration via stagger checklist entries)
- `#13` Cleave multi-target simulation (cleave budget simulation against horde compositions, per-target damage, `cleave` CLI, scoring integration via cleave checklist entries)
- `#3` Build-oriented CLI commands (`list` filterable/sortable build table with 7-dimension scores, `diff` structural + analytical build comparison; library modules exported for #6 website)

## BetterBots Integration

Issue `#4` resolved. `data/exports/` is the cross-repo handoff surface. BetterBots agents read exports via `../hadrons-blessing/data/exports/` or regenerate via CLI (`npm run export:bot-weapons`). See `data/exports/README.md` for the contract and `docs/superpowers/specs/2026-03-15-betterBots-integration-contract-design.md` for the design spec.

**Weapon export scoring:** Picks are evaluated against 4 bot-incompatibility criteria: dodge-dependent, block-timing-dependent, weapon-special-dependent (until BetterBots #33), and weakspot-aim-dependent. The export declares `"assumes": "betterbots"` — ADS, peril, force staves, and melee selection are handled by BetterBots and are not exclusion criteria.

## No Unsourced Claims

Every factual claim about Darktide mechanics must be sourced from a file you've actually read. If you haven't read the source, say so — never guess. Entity IDs, talent names, field names, buff values — all must be verified against the decompiled source before being added to ground-truth data.
