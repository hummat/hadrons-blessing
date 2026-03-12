# Ground-Truth Entity Resolution: Research, Vision, and Extraction Plan

> Created 2026-03-12. Covers the research into prior art, the case for a standalone project, and the concrete extraction plan from BetterBots.

---

## 1. What the Ground-Truth System Is

A source-backed entity resolution system for Warhammer 40,000: Darktide. It maps human-readable names (community guides, GamesLantern builds, scraper output, in-game display text) to exact internal game entity IDs from decompiled Lua source, with deterministic ranking, structured resolution states, and audit tooling.

### Core components

| Layer | Purpose | Implementation |
|-------|---------|----------------|
| **Canonical entity registry** | Source-backed game entities with internal IDs, loc keys, refs, typed attributes | JSON shards under `data/ground-truth/entities/` |
| **Alias registry** | Maps human/community/guide/stale names to canonical entities with match mode and context constraints | JSON shards under `data/ground-truth/aliases/` |
| **Edge registry** | Typed relationships between entities (grants_buff, modifies, instance_of, etc.) with conditions | JSON shards under `data/ground-truth/edges/` |
| **Evidence records** | Explicit claims with source refs and confidence | JSON shards under `data/ground-truth/evidence/` |
| **Resolver** | Normalizes input, applies query context, runs exact/normalized/fuzzy matching, returns resolved/ambiguous/unresolved | `scripts/ground-truth/lib/resolve.mjs` |
| **Index builder** | Validates schemas, merges shards, builds normalized lookup tables, detects collisions | `scripts/build-ground-truth-index.mjs` |
| **Build auditor** | Resolves names from scraped build JSONs, reports unresolved/ambiguous mappings | `scripts/audit-build-names.mjs` |
| **JSON schemas** | 15 schemas validating entities (13 kind-specific), aliases, edges, evidence, conditions, query context | `data/ground-truth/schemas/` |

### Current state (Psyker pilot on `feat/ground-truth-psyker-pilot`)

- Psyker canonical entities, aliases, edges, evidence fully populated
- Shared entities (weapons, buffs, blessing families, curio perks, weapon perks) in transitive closure of pilot fixtures
- 3 frozen build audit fixtures (Psyker builds #08, #09, #10)
- 7 golden resolver test cases (Warp Rider, Brain Rupture, Prescience, etc.)
- Schema validation, collision detection, freshness checks
- Wired into `package.json`, `Makefile`, CI

---

## 2. Prior Art Research

**Research date:** 2026-03-12. Searched GitHub, Nexus Mods, Reddit (r/DarkTide, r/DarktideMods), game wikis, modding Discords, and equivalent systems in Path of Exile, Destiny 2, Warframe, Vermintide 2, and Grim Dawn.

### Darktide landscape

| Tool/Resource | What it does | Entity resolution? |
|---|---|---|
| **Aussiemon/Darktide-Source-Code** | Raw decompiled Lua scripts | No mapping layer — modders grep manually |
| **GamesLantern** | Build editor, weapon/talent DB, Discord bot | No public API, no internal ID exposure, no source refs. "Most data extracted from game files" but curated manually |
| **Darkmass.gg** | Was the most ambitious Darktide wiki | **Defunct.** Planned a "Darktide API," never shipped. No successor |
| **Power DI** (Nexus #281) | Runtime data collection/transformation framework | Operates on live game state, not static entity resolution |
| **Modding Tools** (Nexus #312) | In-game table inspector + variable watcher | Runtime debugging only, no registry |
| **Simple Buff Filter** (Nexus #682) | Learns buff names at runtime | Closest Darktide thing — maps `buff_template_name` → display, but runtime-only, incomplete (only buffs you've seen), no source refs |
| **Enhanced Descriptions** (Nexus #210) | Shows internal numbers for blessings/perks/talents in-game | Uses internal data but doesn't expose a mapping registry |
| **What The Localization** (Nexus #163) | Patches broken localization strings | Highlights the loc gap but doesn't bridge it systematically |
| **Wartide.net Breakpoint Calculator** | Breakpoint math from decompiled damage data | Data baked into tool, not exposed as registry |

**Key finding:** No Darktide tool maps between community/display names and internal entity IDs. Modders reference decompiled source directly. Community tools trust display names.

### Closest analogues in other games

| System | Game | Canonical registry | Name mapping | Source-backed (file:line) | Alias/fuzzy layer | Build audit |
|---|---|---|---|---|---|---|
| **RePoE** | Path of Exile | JSON from GGPK | ID → display | Implicit via GGPK | No | No |
| **Bungie Manifest** | Destiny 2 | SQLite, official API | Hash → definition | First-party | No | No |
| **WFCD/warframe-items** | Warframe | JSON from Public Export | Internal path → structured entity | Via export | No | No |
| **Warframe Wiki Modules** | Warframe | Lua/JSON (`Module:Weapons/data`) | Internal → display | Game export | No | No |
| **GrimTools** | Grim Dawn | Item/build DB from `database.arz` | Internal record refs | Via game files | No | No |

**RePoE** (github.com/brather1ng/RePoE) is the closest architectural precedent: structured JSON exported from game files, powering downstream tools (Path of Building, poe.ninja). But it lacks alias resolution, build auditing, and source-line tracing.

### What's genuinely novel (no known implementation anywhere)

1. **Alias layer with fuzzy matching** for community → internal name bridging
2. **Source-reference tracing to file:line** in entity definitions
3. **Build audit against verified source** (verifying community builds from GamesLantern etc.)
4. **Structured resolution states** (resolved/ambiguous/unresolved) instead of binary succeed/fail
5. **Deterministic ranking with context constraints** (class, slot, weapon family) for shared-name disambiguation

### Conclusion

The system fills a real gap. Every Darktide modder and community tool either works with raw decompiled Lua (manual grep) or trusts display names (which don't map 1:1 to internal IDs). Blessing families like "Precognition" exist on multiple weapons with different internal IDs. Community names like "Warp Rider" don't match obvious internal names. No existing tool handles this systematically.

### Reference projects: what to study and why

These projects aren't competitors (none cover Darktide, none do alias resolution), but each solves a related sub-problem worth studying for implementation patterns.

#### Data extraction and registry architecture

| Project | What to study | Where to look |
|---|---|---|
| **RePoE** (github.com/brather1ng/RePoE) | How to structure JSON exports from game files. Their `stat_translations.json` maps stat IDs → display text with format strings — closest precedent for our alias layer. `mods.json` shows typed entity records with numeric attributes. | `RePoE/data/` for output format, `RePoE/parser/` for extraction pipeline |
| **RePoE fork** (github.com/repoe-fork/repoe) | Maintained fork — check for schema evolution since the original stalled. Shows how a community maintains game data exports across patches. | Compare `data/` schema changes between original and fork |
| **WFCD/warframe-items** (github.com/WFCD/warframe-items) | Community-built entity registry with `findItem()` API by internal path. Shows how to expose structured entity lookup programmatically. Category-based organization (weapons, warframes, mods) maps to our kind-based entity shards. | `lib/`, `data/` directory structure, `index.js` API surface |
| **Warframe Wiki Modules** (wiki.warframe.com `Module:Weapons/data`, `Module:Ability/data`) | Machine-readable Lua/JSON with internal names as keys. Shows the wiki-as-database pattern — structured data maintained by a community, consumed by templates and external tools. | Any `Module:*/data` page on the wiki |

#### Name mapping and localization bridging

| Project | What to study | Where to look |
|---|---|---|
| **Bungie Manifest** (github.com/Bungie-net/api) | First-party hash → definition mapping in SQLite. Every entity has a stable hash ID, display name, description, icon, and typed stats. Shows what a "complete" entity definition looks like when you have full localization access. | `DestinyInventoryItemDefinition` table structure |
| **d2-additional-info** (github.com/DestinyItemManager/d2-additional-info) | Community-curated data layered on top of official manifest — exactly the alias/annotation pattern we use. Shows how to maintain supplementary mappings that the official source doesn't provide. | `data/` for the supplementary data format |
| **Enhanced Descriptions** (Nexus #210, github.com/cgodwin0/DarktideMods) | Darktide mod that reads internal buff/perk/blessing values and patches them into the UI. Study how it resolves internal template names to displayable numbers — this is the runtime equivalent of our offline resolution. | Source for how it accesses `buff_template_name` → numeric values |
| **What The Localization** (Nexus #163) | Patches broken Darktide localization. Study what loc keys it fixes — these are exactly the gaps our system needs to handle (missing or wrong `ui_name` for canonical entities). | Source for the specific loc key corrections |

#### Build planning and calculator patterns

| Project | What to study | Where to look |
|---|---|---|
| **Path of Building** (github.com/PathOfBuildingCommunity/PathOfBuilding) | The gold standard game build calculator. Study how it consumes RePoE data, models buff stacking, and computes DPS. Our `calc` fields and edge conditions are designed to support a similar pipeline. | `src/Modules/CalcPerform.lua` for the calculation pipeline, `src/Data/` for data consumption |
| **Wartide.net Breakpoint Calculator** (dt.wartide.net/calc/) | Darktide-specific. Study what damage formula it uses, how it models enemy armor/HP, and what data it baked in. By manshanko (same person who built the decompilation pipeline). | Web tool — inspect data model via browser devtools |
| **GamesLantern** (darktide.gameslantern.com) | Study the build editor UX, talent tree visualization, and how they present weapon stats. This is what our web tool would complement/compete with. Also study what names they use vs internal names — their naming choices are exactly what our alias layer needs to handle. | Build editor pages, weapon database |

#### Darktide-specific data sources and manshanko's toolchain

manshanko is the author of most of the Darktide modding infrastructure (decompiler, mod loader, breakpoint calculator). Relevant tools:

| Resource | What to study | Where to look |
|---|---|---|
| **Aussiemon/Darktide-Source-Code** (github.com/Aussiemon/Darktide-Source-Code) | The upstream data source. Study update frequency, what's included/excluded (no English loc strings in current clone), file organization conventions. Our `source-snapshots/manifest.json` pins to specific revisions of this repo. | `scripts/settings/` for templates, `scripts/extension_systems/` for runtime systems |
| **`dtenv`** (github.com/manshanko/dtenv, MIT) | **Critical for calculator work.** Lua polyfill that runs Darktide's `DamageCalculation.calculate` outside the game. Use as a test oracle: feed weapon/enemy data, get exact damage numbers, verify our JS calculator matches the game. | Root-level Lua files, study which globals it polyfills and what decompiled source it requires |
| **`dtmath-wit`** (github.com/manshanko/dtmath-wit, MIT, archived) | WASM interface definition for Wartide's calculator engine. Documents the calculation API surface (damage matrices, cleave, per-difficulty HP, armor by hitzone, stat buff application). Useful as a spec reference even though the implementation (`dtmath`) is closed source. | `dt-math.wit` interface file, GitHub releases for pre-compiled WASM binaries |
| **`limn`** (github.com/manshanko/limn, Apache-2.0/MIT) | Bundle extractor / decompiler that produces the decompiled source. Relevant if we need to re-extract after a game update before Aussiemon updates. Rust, 19 stars. | `src/` for extraction logic |
| **Darktide decompilation pipeline** (backup158.github.io/Darktide_Decompiling.html) | Documents how decompiled source is produced (`limn` + LuaJIT decompiler). Important for understanding fidelity and limitations of our upstream data. | The guide itself |
| **Simple Buff Filter** (Nexus #682) | Runtime buff name learning. Study how it maps `buff_template_name` → display text at runtime — the runtime half of what we do offline. Could inform a future "runtime alias discovery" tool. | Source for the buff template → display mapping logic |
| **Power DI** (Nexus #281, github.com/OvenProofMars/Power_DI) | Extensible runtime data collection framework. Study its data source API — if we need runtime validation of canonical data. | `scripts/mods/Power_DI/modules/` for the data source extension pattern |
| **Modding Tools** (Nexus #312) | Table inspector + variable watcher. Useful for discovering entity fields not visible in decompiled source (runtime-computed values, cached lookups). | In-game use for entity field discovery |

---

## 3. The Case for a Standalone Project

### Why extract from BetterBots

| Factor | In BetterBots | Standalone |
|---|---|---|
| **Primary audience** | Bot mod users (Lua, DMF) | Build theorycrafters, modders, content creators, tool builders |
| **Tech stack** | Lua mod + Node.js tooling (mixed) | Pure Node.js / web stack |
| **Scope trajectory** | 6-class rollout + calculator + web UI = majority of repo by LOC | Grows naturally as its own project |
| **CI coupling** | Ground-truth checks slow down Lua-only changes | Independent CI pipeline |
| **Data ownership** | Game data JSON in a mod repo feels wrong | Natural home for a game data project |
| **Contributor profile** | Different people mod bots vs build entity databases | Clean separation of concerns |

### What the standalone project becomes

A **Darktide build intelligence platform** — the "RePoE + Path of Building" equivalent for Darktide. No such thing exists today.

Three layers, built incrementally:

1. **Entity resolution** (current pilot) — canonical registry + alias resolution + build audit
2. **Calculator** (future) — DPS/EHP/breakpoint computation from source-backed data
3. **Web tool + CLI** — build ideation, creation, optimization, debugging with verified game data

### How BetterBots benefits

BetterBots becomes a *consumer* of the ground-truth data rather than its host:

- **Issue #45 (default class profiles):** Bot loadout definitions reference canonical entity IDs
- **Issue #38 (talent-aware behavior):** Heuristics query talent/buff effects via stable IDs
- **Issue #22 (utility-based scoring):** Scoring weights reference canonical ability/weapon entities
- **Build-informed heuristics:** Audit community meta builds → extract activation patterns → feed into bot decision logic

---

## 4. Product Design

Two interaction surfaces, one shared data layer.

### Users

| User | What they want | Surface |
|---|---|---|
| **Build theorycrafters** | "Is Warp Rider good on my build?" with real numbers | Web app |
| **Players optimizing** | "What's the best Psyker build for Havoc 5?" | Web app (browse presets) |
| **Modders / bot dev** | Stable entity IDs, typed data, build audit | CLI |
| **Content creators** | Verify claims before publishing guides | Web app (audit) or CLI |
| **BetterBots mod** | Programmatic entity lookup for bot profiles | CLI / JSON data |

### CLI (developer / modder audience)

The CLI is the primary interface for bot development and modder workflows. It wraps the existing resolver, auditor, and index builder behind a consistent command interface.

```
dt resolve "Warp Rider"                    # canonical entity + source refs + confidence
dt resolve "Warp Rider" --class psyker     # with query context for disambiguation
dt audit build.json                        # flag unresolved/ambiguous names
dt audit https://darktide.gameslantern.com/builds/<uuid>/...  # scrape + resolve
dt build list                              # show available preset builds
dt build show psyker/gandalf-melee         # display a preset build
dt build diff build1.json build2.json      # compare two builds
dt index build                             # rebuild generated index
dt index check                             # freshness check
```

The CLI is a thin wrapper over library functions — the same code powers the web app's build-time data generation.

### Static web app (casual player audience)

A static site generated at build time from the entity registry and preset builds. No server, no accounts, no database — just HTML/CSS/JS served from a CDN.

#### Core flows

**1. Browse presets**
- Ship the 20 pre-scraped GL builds plus curated picks, browsable by class
- Each build shows: talent tree (visual), weapons with blessings/perks, ability, curios
- Every talent/blessing/perk is clickable → shows source-backed description and internal values

**2. Import a build**
- Paste a GamesLantern URL → scrape + resolve + display with verified data
- Scraping requires a lightweight serverless function (GL pages are JS-rendered, no API, no CORS)
- GL build URLs have stable UUIDs: `darktide.gameslantern.com/builds/{uuid}/{slug}`
- Display audit warnings inline: "this blessing name is ambiguous", "this perk doesn't exist on this weapon"

**3. Build from scratch / modify**
- Visual talent tree picker (click nodes to toggle)
- Weapon selector with blessing/perk slots
- Curio slots with perk selection
- Modify an imported or preset build by changing selections
- All selections resolve against the canonical registry — impossible to pick invalid combinations

**4. Search**
- Type any name (community, internal, stale, abbreviated) → find the entity
- This is the alias layer's killer feature for casual users who don't know the "real" name
- Shows resolution confidence and alternative matches for ambiguous queries

**5. Share / export**
- URL-encoded build state (no server needed — build encoded in the URL hash/query params)
- JSON export for tooling consumption
- Copy-pasteable text summary

#### Per-entity pages (SEO)

Every talent, blessing, weapon, and perk gets its own static page with:
- Source-backed description and internal values
- Known aliases (community names, stale names)
- Which builds use this entity (cross-referenced from presets)
- Source references (file:line in decompiled source)

These pages are the organic traffic driver. "Warp Rider darktide" → lands on a page with verified stats instead of a Reddit thread with conflicting opinions.

#### Patch impact tracking

When a game patch drops:
- Diff the decompiled source against the pinned snapshot
- Identify changed entities (talents, blessings, weapons)
- Flag which preset builds are affected
- Display on a "Patch X.Y.Z Impact" page

High value, low effort once the entity registry covers all classes — the structured data makes diffing mechanical.

### Feature roadmap

| Phase | CLI | Web app | Data |
|---|---|---|---|
| **v0.1** (Psyker pilot done) | `resolve`, `audit`, `index` | — | Psyker + shared entities |
| **v0.2** (all classes) | Same commands, full coverage | — | All 6 classes, all shared entities |
| **v1.0** (web launch) | `build list/show/diff` | Browse presets, search, per-entity pages | Preset builds, full alias coverage |
| **v1.1** (import) | `audit <url>` | Paste GL URL → audit + display | Serverless scrape endpoint |
| **v1.2** (builder) | — | Build from scratch / modify | Interactive talent tree |
| **v1.3** (share) | — | URL-encoded builds, JSON export | — |
| **v2.0** (calculator) | `calc` commands | Inline DPS/EHP/breakpoint numbers | `calc` fields populated on edges |

### Calculator layer (v2.0, not v1)

**What Wartide.net does (and doesn't):**
Wartide is a weapon breakpoint calculator by manshanko (same person behind `limn`, the Darktide decompiler). You pick a weapon, pick a difficulty, and it tells you how many hits each attack takes to kill each enemy type with a given perk/blessing setup. It answers: "can my weapon two-shot a Crusher on Havoc 5?" It covers weapon damage only — no talent interactions, no ability effects, no build-wide buff stacking.

Architecture: Rust core (`dtmath`) compiled to WASM, with all weapon/breed/buff data baked in at compile time from decompiled source. Vanilla JS frontend. The WASM interface is defined via WIT (`dtmath-wit`, MIT, archived). The core `dtmath` engine and web frontend are **closed source** — not available for reuse.

**What the calculator layer would add:**
The `calc` fields in the entity schema (buff durations, stat modifiers, proc conditions, stacking rules) and the typed edge conditions (additive/multiplicative/override aggregation, stacking modes) are designed to model full build interactions:

- "With Warp Rider + Kinetic Deflection + this staff, what's my effective toughness regen during a horde?"
- "Does this talent combination hit the breakpoint for one-shotting Ragers?"
- "What's the actual DPS difference between Blazing Spirit and Empowered Psionics on this weapon?"

This is the Path of Building equivalent — buff stacking across talents, weapons, curios, and abilities, using the 13-stage damage pipeline from `docs/knowledge/damage-system.md`.

**Implementation approach:**
We can't reuse Wartide's code (closed source), but we have access to the same upstream data and two open tools from manshanko:

| Resource | What it gives us | License |
|---|---|---|
| **Decompiled source** (`../Darktide-Source-Code/`) | `DamageCalculation.calculate` — the game's own damage Lua, plus all weapon templates, breed data, buff values. This is the ground truth for the formulas. | N/A (decompiled) |
| **`dtenv`** (github.com/manshanko/dtenv) | Lua polyfill that runs Darktide's `DamageCalculation.calculate` outside the game. Can serve as a **test oracle** — feed it weapon/enemy data, get exact damage numbers, verify our implementation matches the game. | MIT |
| **`dtmath-wit`** (github.com/manshanko/dtmath-wit) | WASM interface definition for dtmath. Documents the calculation API surface: damage matrices (base/weak/crit/crit_weak), cleave, per-difficulty HP, armor-by-hitzone, stat buff application. Useful as a spec for our own API, even though we can't use the implementation. | MIT (archived) |
| **`limn`** (github.com/manshanko/limn) | Bundle extractor / decompiler. Produces the decompiled source. Relevant if we need to re-extract after a game update before Aussiemon updates. | Apache-2.0 / MIT |

**Recommended calculator architecture:**
- Reimplement the damage pipeline in JS/TS (simpler build than Rust→WASM, runs natively in the static site, formulas are arithmetic — no performance concern)
- Source formulas from decompiled Lua (`DamageCalculation.calculate` and surrounding pipeline)
- Use `dtenv` as a differential test oracle: run the same inputs through both our JS implementation and dtenv's Lua execution, assert matching outputs
- Consume entity `calc` fields for talent/buff modifiers (stat_buffs, durations, stacking)
- Consume edge conditions for interaction modeling (additive vs multiplicative, exclusive scopes)

This gives us a wider scope than Wartide (full build interactions, not just weapon damage) while staying grounded in the same decompiled source.

**Why it's v2, not v1:** Populating `calc` fields requires verifying every numeric value against decompiled source — per-talent, per-buff, per-stacking interaction. The entity resolution and build browsing/auditing are useful without the calculator. Ship the useful parts first.

### What this is NOT

- **Not a GamesLantern competitor on UX.** GL has polish, community, and a head start on the build editor. This tool's differentiator is *verified data*, not prettier UI.
- **Not a tier list or build ranking system.** No opinion model, no "S-tier" labels. Show the numbers, let users decide.
- **Not a social platform.** No accounts, no comments, no ratings in v1. Static site, zero operational burden.

### GamesLantern integration constraints

- **No public API.** Build data must be scraped via Playwright (existing `extract-build.mjs`).
- **JS-rendered pages.** `curl`/`fetch` won't work — need a headless browser.
- **No CORS.** Client-side scraping is not possible. Import requires a serverless function.
- **Stable URLs.** Builds have UUID-based URLs (`/builds/{uuid}/{slug}`), so link-paste is reliable.
- **No direct selection.** Cannot embed GL's build list or search. Users must find the build on GL first, then paste the URL.
- **Scraper maintenance.** GL can change their DOM at any time. The scraper is inherently fragile and needs monitoring.

---

## 5. Extraction Plan

### Proposed repo name

`darktide-ground-truth` or `darktide-entity-resolution` (shorter: `dt-ground-truth`)

### What moves to the new repo

```
# Data (entire directory)
data/ground-truth/
  schemas/              # 15 JSON schemas
  entities/             # canonical entity shards (psyker, shared-*)
  aliases/              # alias shards
  edges/                # relationship shards
  evidence/             # evidence records
  non-canonical/        # known-unresolved labels
  source-snapshots/     # pinned source metadata

# Tooling
scripts/ground-truth/   # lib/ (load, normalize, resolve, validate, non-canonical)
scripts/build-ground-truth-index.mjs
scripts/resolve-ground-truth.mjs
scripts/audit-build-names.mjs
scripts/ground-truth.test.mjs

# Build fixtures (scraped builds used by auditor)
scripts/builds/*.json

# Test fixtures
tests/fixtures/ground-truth/

# Scraper (produces build JSONs consumed by auditor)
scripts/extract-build.mjs

# Build scorer (consumes ground-truth data)
scripts/score-build.mjs
scripts/score-build.test.mjs
scripts/build-scoring-data.json

# Design docs
docs/superpowers/specs/2026-03-11-ground-truth-resolution-design.md
docs/superpowers/plans/2026-03-11-ground-truth-psyker-pilot.md
docs/plans/2026-03-09-build-scoring-design.md
docs/plans/2026-03-09-build-scoring-plan.md
docs/plans/2026-03-10-default-bot-profiles-design.md
```

### What stays in BetterBots

```
# All Lua mod code
scripts/mods/BetterBots/

# Lua tests
tests/*.lua
tests/test_helper.lua

# Mod infrastructure
BetterBots.mod
bb-log
Makefile (Lua parts)
.luacheckrc, .luarc.json, .stylua.toml

# Bot-specific docs
docs/bot/
docs/classes/*.md (ability templates, tactics — bot-relevant)
docs/dev/ (architecture, debugging, validation-tracker, etc.)
docs/knowledge/ (game knowledge base — shared reference, stays or is duplicated)

# Mod packaging
BetterBots.zip pipeline
```

### Shared resources (needs decision)

| Resource | Recommendation |
|---|---|
| `docs/knowledge/` (class-talents, buff-templates, damage-system, etc.) | **Copy to new repo.** These are game reference docs, not mod-specific. BetterBots keeps its copy for bot heuristic work. Over time, the ground-truth project supersedes them with source-backed structured data. |
| `docs/classes/meta-builds-research.md` | **Move.** This is build analysis, not bot behavior. BetterBots can reference ground-truth outputs instead. |
| `package.json` / `package-lock.json` | **Split.** New repo gets its own. BetterBots keeps only Playwright (if scraper stays) or drops Node deps entirely. |
| `.github/workflows/ci.yml` | **Split.** BetterBots CI drops ground-truth steps. New repo gets its own CI. |
| `../Darktide-Source-Code/` dependency | **Shared.** Both repos reference the same local clone. New repo owns the `source-snapshots/manifest.json` contract. |

### Extraction steps

1. **Create new repo** (`darktide-ground-truth` on GitHub)
2. **Copy files** (not `git filter-branch` — clean start, reference BetterBots history in README)
3. **Set up new repo infrastructure:** `package.json`, CI, README, CLAUDE.md/AGENTS.md
4. **Remove ground-truth files from BetterBots** on the `feat/ground-truth-psyker-pilot` branch
5. **Update BetterBots CI/Makefile** to drop ground-truth steps
6. **Add cross-reference:** BetterBots CLAUDE.md points to ground-truth repo for entity data
7. **Finish Psyker pilot** in the new repo (complete remaining golden cases, stabilize CI)
8. **Roll out remaining classes** (Veteran, Zealot, Ogryn, Arbites, Hive Scum) in the new repo

### Timing

The pilot is mostly complete on `feat/ground-truth-psyker-pilot`. Two viable approaches:

- **Extract now:** Move current state to new repo, finish pilot there. Cleaner but requires setup work before continuing feature development.
- **Finish pilot first, then extract:** Complete the Psyker pilot in BetterBots, validate it works end-to-end, then extract the proven system. Lower risk but accumulates more coupling.

**Recommendation:** Finish the Psyker pilot in BetterBots (it's 90%+ done), validate it, then extract. The pilot proves the design before investing in repo infrastructure. The extraction is mechanical — the file boundaries are already clean.

---

## 6. New Repo Structure (Proposed)

```
darktide-ground-truth/
  README.md
  CLAUDE.md
  package.json
  .github/workflows/ci.yml

  # CLI entry point
  bin/
    dt.mjs              # CLI dispatcher (resolve, audit, build, index, calc)

  # Core library (shared by CLI and web build)
  src/
    lib/
      load.mjs          # shard loading and merging
      normalize.mjs     # name normalization
      resolve.mjs       # resolver (exact/normalized/fuzzy)
      validate.mjs      # schema validation
      non-canonical.mjs # known-unresolved label handling
    build-index.mjs     # schema validation + index generation
    audit.mjs           # build audit pipeline
    scrape.mjs          # GamesLantern scraper (Playwright)
    score.mjs           # build scorer

  # Entity data (the core asset)
  data/
    entities/           # canonical entity shards by class/domain
    aliases/            # alias shards
    edges/              # relationship shards
    evidence/           # evidence records
    schemas/            # JSON schemas
    non-canonical/      # known-unresolved labels
    source-snapshots/   # pinned source metadata

  # Preset builds (scraped + curated)
  builds/
    presets/             # curated builds shipped with the tool
    scraped/             # raw GL scraper output (build-time input)

  # Static web app (v1.0+)
  web/
    src/
      pages/             # per-entity static pages (generated)
      components/        # talent tree, weapon selector, search
      build-viewer/      # build display + audit warnings
      build-editor/      # talent tree picker, weapon/curio slots (v1.2)
    public/
    astro.config.mjs     # or equivalent static site generator
    package.json         # workspace member

  # Tests
  tests/
    fixtures/
    ground-truth.test.mjs
    score.test.mjs

  # Documentation
  docs/
    design.md           # resolution design spec
    data-model.md       # entity/alias/edge/evidence schemas explained
    product.md          # product design (surfaces, flows, roadmap)
    contributing.md     # how to add entities, aliases, evidence
    game-knowledge/     # game system reference (from BetterBots docs/knowledge/)
```

---

## 7. Open Questions

1. **Repo name:** `darktide-ground-truth` vs `darktide-entity-resolution` vs `darktide-build-tools` vs something else?
2. **License:** MIT (matching BetterBots) or something else?
3. **Monorepo vs multi-repo for web tool:** Single repo with `packages/` or separate `darktide-build-tool` repo for the web frontend?
4. **Game knowledge docs:** Copy to new repo, or extract into a shared submodule?
5. **When to extract:** After Psyker pilot passes, or now?
