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

## Commands

```bash
npm install
npm test                                          # unit tests (no source root needed for most)
npm run edges:build                               # regenerate tree edges from Lua source
npm run check                                     # index:build + test + index:check
make check                                        # full quality gate (edges:build + effects:build + breeds:build + profiles:build + check)
npm run effects:build                             # populate calc fields from Lua buff templates
npm run synergy -- scripts/builds/08-gandalf-melee-wizard.json          # synergy analysis (text)
npm run synergy -- scripts/builds/08-gandalf-melee-wizard.json --json   # synergy analysis (JSON)
npm run synergy -- scripts/builds/                                       # batch synergy (all builds)
npm run resolve -- --query "Warp Rider" --context '{"kind":"talent","class":"psyker"}'
npm run audit -- scripts/builds/08-gandalf-melee-wizard.json
npm run canonicalize -- scripts/sample-build.json # raw scrape → canonical build JSON
npm run reresolve -- --write scripts/builds       # batch re-resolve unresolved entries
npm run coverage                                  # domain/kind coverage summary
npm run inspect -- --id psyker.talent.psyker_damage_based_on_warp_charge
npm run export:bot-weapons                        # regenerate data/exports/bot-weapon-recommendations.json
npm run report -- scripts/builds/08-gandalf-melee-wizard.json           # human-readable text report
npm run report -- scripts/builds/08-gandalf-melee-wizard.json --format md  # markdown report
npm run report -- scripts/builds/                                       # batch report (all builds)
npm run score -- scripts/builds/08-gandalf-melee-wizard.json --json             # build scoring (with qualitative)
npm run score -- scripts/builds/08-gandalf-melee-wizard.json --text             # build scoring (human-readable)
npm run recommend -- analyze-gaps scripts/builds/08-gandalf-melee-wizard.json   # coverage gap analysis
npm run recommend -- swap-talent scripts/builds/08-gandalf-melee-wizard.json --from <id> --to <id>  # talent swap delta
npm run recommend -- swap-weapon scripts/builds/08-gandalf-melee-wizard.json --from <id> --to <id>  # weapon swap delta
npm run score:freeze                                                            # regenerate golden score snapshots
npm run breeds:build                                                            # extract breed HP/armor/hitzones from Lua
npm run profiles:build                                                          # extract damage profiles/action maps from Lua
npm run calc -- scripts/builds/08-gandalf-melee-wizard.json                     # breakpoint calculator (text)
npm run calc -- scripts/builds/08-gandalf-melee-wizard.json --json              # breakpoint calculator (JSON)
npm run calc -- scripts/builds/08-gandalf-melee-wizard.json --compare scripts/builds/01-veteran-squad-leader.json  # compare two builds
npm run calc -- scripts/builds/                                                 # batch calc (all builds)
npm run calc:freeze                                                             # regenerate golden calc snapshots
node scripts/extract-build.mjs <gl-url> --json    # live GL scrape → canonical (requires Playwright)
node scripts/extract-build.mjs <gl-url> --raw-json # live GL scrape → pre-canonical raw shape
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
  generated/         # built artifacts (gitignored — regenerated by index:build, breeds:build, profiles:build)
                     #   index.json         — entity index
                     #   breed-data.json    — breed HP, armor, hitzones, difficulty scaling
                     #   damage-profiles.json — damage profiles, action maps, pipeline constants
data/exports/        # checked-in JSON artifacts for downstream consumers (BetterBots)
scripts/ground-truth/
  lib/               # resolve.mjs, validate.mjs, load.mjs, normalize.mjs
                     # build-canonicalize.mjs, build-classification.mjs,
                     # build-classification-registry.mjs, build-shape.mjs,
                     # build-audit.mjs, coverage.mjs, inspect.mjs,
                     # lua-tree-parser.mjs, tree-edge-generator.mjs
                     # lua-data-reader.mjs, talent-settings-parser.mjs,
                     # condition-tagger.mjs, buff-semantic-parser.mjs
                     # synergy-stat-families.mjs, synergy-rules.mjs,
                     # synergy-model.mjs
                     # damage-calculator.mjs, breakpoint-checklist.mjs
scripts/builds/      # 23 canonical build fixtures (all 6 classes)
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

**lerped_stat_buff lerp factor:** `assembleBuildBuffStack` hardcodes `warp_charge` as the interpolation factor for all `lerped_stat_buff` effects. Correct for current game data but not validated against non-warp lerped buffs.

**difficulty_health fallback:** If a breed lacks HP for a difficulty level, `difficulty_health?.[difficulty] ?? 0` produces `hitsToKill = Infinity`, which the scoring layer treats as "unkillable" rather than "data missing". Could penalize `difficulty_scaling` for data absence.

**talent population edge-only fallback:** If `_resolvedIds` is absent from synergy output (unlikely in production), the fallback counts only talents that participate in edges — isolated talents are invisible, inflating coherence scores.

**Build 14** (arbites-nuncio-aquila) fails in `computeBreakpoints` due to shield weapon action maps with null profile references. The `calc:freeze` command skips it.

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

`scripts/builds/` contains 23 representative build JSON files (builds 01–23, all 6 classes) in canonical build shape. Each build stores `schema_version`, `title`, `class`, `provenance`, `ability`, `blitz`, `aura`, `keystone`, `talents[]`, `weapons[]`, and `curios[]`. Every selection carries `raw_label`, `canonical_entity_id`, and `resolution_status` (`resolved` / `unresolved` / `non_canonical`).

All 23 builds have been re-extracted from live GL pages with full talent trees. 1089 resolved, 60 unresolved (all curio cosmetic names — backend-only, see below), 1 non_canonical (multi-option guide label).

Frozen audit snapshots live in `tests/fixtures/ground-truth/audits/`. When the index or audit logic changes, re-freeze all snapshots with `npm run audit:freeze`. Do NOT use `npm run audit -- <file> > snapshot.json` — npm's stderr banner contaminates the JSON output.

Frozen calc snapshots live in `tests/fixtures/ground-truth/calc/`. Regression tests in `damage-calculator.test.mjs` compare fresh `computeBreakpoints` output against these snapshots for every build. Re-freeze with `npm run calc:freeze` after pipeline changes.

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

**Architecture:** 3 modules in `scripts/ground-truth/lib/`:
- `synergy-stat-families.mjs` — 144 stats mapped to 11 families (melee_offense, ranged_offense, general_offense, crit, toughness, damage_reduction, mobility, warp_resource, grenade, stamina, utility). Multi-membership supported.
- `synergy-rules.mjs` — 5 pure-function rules: stat-family alignment, slot coverage, trigger-target chains, resource flow, orphan detection
- `synergy-model.mjs` — orchestrator: selection resolution (direct calc, stat_node prefix match, blessing tier-4 traversal), stat aggregation (NHHI concentration, build identity, coverage gaps), output assembly. The stat_node prefix-match resolution path is mirrored in `damage-calculator.mjs:assembleBuildBuffStack` for breakpoint accuracy.

**Coverage:** ~40% per-build calc coverage. Blessing synergy partial (27/46 families via `instance_of` → weapon_trait tier traversal). Named gameplay talents at 48% calc coverage; stat-node talents and gadget traits at 100%.

**Output consumed by:** #9 (scoring) and #10 (recommendations). Design spec: `docs/superpowers/specs/2026-03-16-synergy-model-design.md`.

**Deferred:** Keyword affinity rule (no proficiency data in index), weak (1) strength edges, ~58 opaque conditions (reduced from 68 by condition tagger expansion in #5).

Frozen synergy snapshots in `tests/fixtures/ground-truth/synergy/`. Re-freeze with `npm run synergy:freeze`.

## Build Scoring

`npm run score -- <build.json> [--json|--text]` produces a full scorecard with mechanical + qualitative dimensions.

**Mechanical (from hardcoded data):** `perk_optimality`, `curio_efficiency` — scored from perk tier tables in `build-scoring-data.json`.

**Qualitative (from synergy model):** `talent_coherence` (talent-talent edge density + graph isolation), `blessing_synergy` (blessing-X edge density + blessing-blessing bonus), `role_coverage` (stat family breadth + coverage gaps + slot balance). Each 1–5.

**Calculator-derived (from breakpoint matrix):** `breakpoint_relevance` (weighted checklist of community-standard breakpoints), `difficulty_scaling` (damnation→auric degradation on high-priority breakpoints). Scored via `breakpoint-checklist.mjs` against `data/ground-truth/breakpoint-checklist.json`.

**Composite:** Sum of all 7 dimensions, scaled to /35. Letter grades: S (32+), A (27+), B (22+), C (17+), D (<17).

**Perk normalization:** GL-scraped perk labels (e.g. `"Damage (Flak Armoured Enemies)"`, `"Damage Resistance (Gunners)"`) are normalized to match scoring catalog keys via `normalizePerkName()` in `score-build.mjs`. Integration tests in `score-build.test.mjs` verify every distinct GL perk format resolves correctly.

Module: `scripts/ground-truth/lib/build-scoring.mjs`. Frozen score snapshots in `tests/fixtures/ground-truth/scores/`. Re-freeze with `npm run score:freeze`.

**Scoring data coverage:** Weapon perks 84/84 (100%), curio perks 273/273 (100%), blessings 30/30 (100%) across all 23 builds. Weapon catalog covers 23/32 unique weapons — 9 weapons appear in builds but lack scoring data entries (blessing lists). When adding new builds, run the coverage audit in `score-build.test.mjs` to catch gaps.

## Build Recommendations

`npm run recommend -- <operation> <build.json> [--from <id> --to <id>] [--json]`

Three operations:
- `analyze-gaps` — coverage gap diagnosis (survivability, crit_chance_source, warp_charge_producer, slot_imbalance) + underinvested families
- `swap-talent` — score delta + gained/lost synergy edges + tree reachability validation (parent_of + exclusive_with)
- `swap-weapon` — score delta + blessing cascade (same-family retains, cross-family removes) + available trait pool

**Deferred to v1.1:** `suggest-improvement` (brute-force candidate enumeration).

Module: `scripts/ground-truth/lib/build-recommendations.mjs`. Formatter: `scripts/ground-truth/lib/recommend-formatter.mjs`. Design spec: `docs/superpowers/specs/2026-03-17-scoring-and-recommendations-design.md`.

## Classification Registry

`scripts/ground-truth/lib/build-classification-registry.mjs` maps GL talent slugs to canonical build slots. Only slot-routing nodes need entries (abilities, blitz, auras, keystones, modifiers). Regular talents flow through to `talents[]` without registry entries. The registry is populated per-class from the decompiled source tree.

## Tech Stack

Node.js ESM (`"type": "module"`). No runtime dependencies. Dev dependencies: `ajv` for schema validation, `playwright` for GL scraping.

Future: SvelteKit + TypeScript + Tailwind CSS + Svelte Flow (xyflow) for the web app.

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

- `#1` TypeScript migration for CLI and library
- `#3` Build-oriented CLI commands (browse, compare)
- `#6` Website architecture
- `#11` Toughness and survivability calculator (defender-side, extends #5 stages 10/12/13)
- `#12` Stagger calculator (impact pipeline, extends #5)
- `#13` Cleave multi-target simulation (extends #5)

## Completed Issues

- `#4` BetterBots integration contract
- `#5` Calculator and dataflow layer (13-stage damage pipeline, `breeds:build` + `profiles:build` extraction, breakpoint matrix, scoring integration, `calc` CLI)
- `#7` Buff semantic extraction (`effects:build` pipeline)
- `#8` Synergy model (`synergy` CLI, 5 rules, stat aggregator)
- `#9` Build quality scoring (7 dimensions: 2 mechanical [perk_optimality, curio_efficiency], 3 qualitative [talent_coherence, blessing_synergy, role_coverage], 2 calculator-derived [breakpoint_relevance, difficulty_scaling]; composite /35 + letter grade)
- `#10` Modification recommendations v1 (analyze-gaps, swap-talent, swap-weapon; suggest-improvement deferred to v1.1)

## BetterBots Integration

Issue `#4` resolved. `data/exports/` is the cross-repo handoff surface. BetterBots agents read exports via `../hadrons-blessing/data/exports/` or regenerate via CLI (`npm run export:bot-weapons`). See `data/exports/README.md` for the contract and `docs/superpowers/specs/2026-03-15-betterBots-integration-contract-design.md` for the design spec.

**Weapon export scoring:** Picks are evaluated against 4 bot-incompatibility criteria: dodge-dependent, block-timing-dependent, weapon-special-dependent (until BetterBots #33), and weakspot-aim-dependent. The export declares `"assumes": "betterbots"` — ADS, peril, force staves, and melee selection are handled by BetterBots and are not exclusion criteria.

## No Unsourced Claims

Every factual claim about Darktide mechanics must be sourced from a file you've actually read. If you haven't read the source, say so — never guess. Entity IDs, talent names, field names, buff values — all must be verified against the decompiled source before being added to ground-truth data.
