# Real Input Evaluation

> Ran 2026-03-13 against checked-in build fixtures, current shared/Psyker data plus minimal veteran slot coverage, and representative BetterBots profile weapon template ids.

## What Was Tested

- `audit` against all 20 checked-in build fixtures under `scripts/builds/`
- `score-build` against the same 20 fixtures
- `resolve` against representative BetterBots loadout template ids and full `content/items/...` item paths from bot profile tables
- `coverage` against current checked-in shard data

## Results

### Audit on canonical build fixtures

- 20/20 migrated canonical build fixtures completed with:
  - `261` resolved entries
  - `78` non-canonical entries
  - `0` ambiguous entries
  - `57` unresolved entries
- The `57` unresolved entries are not fuzzy-match failures. They are the remaining persisted class-side selections that still lack resolver coverage, plus the explicit placeholders in builds whose scrape data never preserved class-side choices.
- This means the current audit path is useful on real canonical fixtures, and it now preserves recovered class-side labels when raw scrape prose contains them instead of flattening everything to `Unknown ability` / `Unknown blitz` / `Unknown aura`.
- The remaining `non_canonical` entries are still mostly expected:
  - unsupported curio display labels such as `Blessed Bullet`
  - known unresolved weapon/blessing labels still tracked as non-canonical instead of leaking into `unresolved`

### Real sample-build recovery

- `scripts/sample-build.json` canonicalizes to:
  - `ability`: `Voice of Command`
  - `blitz`: `Shredder Frag Grenade`
  - `aura`: `Survivalist`
  - `keystone`: `Focus Target!`
- This recovery now comes from explicit scraped `class_selections`, not the old description-only fallback.
- The checked-in canonical fixture `scripts/builds/01-veteran-squad-leader.json` now resolves those four veteran slot selections all the way to canonical entity ids.

### Live extractor verification

- Ran the live extractor against:
  - `https://darktide.gameslantern.com/builds/9a565016-bd70-4fe0-8c82-1080bc73412e/veteran-squad-leader`
- `--raw-json` now returns:
  - the full Description section instead of only the old teaser snippet
  - clean `class_selections`:
    - `ability`: `Voice of Command`
    - `blitz`: `Shredder Frag Grenade`
    - `aura`: `Survivalist`
    - `keystone`: `Focus Target!`
  - the full active talent tree scrape, which was previously missing from the checked-in sample fixture
- Canonical `--json` no longer crashes on that real veteran page even though `veteran` class-side registry coverage is still empty.
- The recovered sample labels now resolve for the live veteran page path because minimal veteran slot aliases exist.
- Broader veteran tree selections still remain a coverage limitation rather than an extraction failure.

### Scorecard on canonical build fixtures

- `score-build` now accepts the migrated canonical build shape directly.
- Canonical weapon metadata is now complete enough to emit either an exact canonical weapon id or a provisional family signal for every fixture weapon:
  - exact canonical ids: `14` builds with both weapons canonicalized, `3` with one, `3` with zero
  - exact-or-provisional family signal: `17` builds with both weapons identified, `3` with one, `0` with zero
- Exact canonical ids now cover additional real fixture labels such as `Godwyn-Branx Mk IV Bolt Pistol`, `Maccabian Mk IV Duelling Sword`, and `Orox Mk II Battle Maul & Slab Shield`.
- The remaining partial cases are provisional family matches, not hard failures.

### BetterBots profile template ids

Representative internal template ids now resolve:

- `chainsword_p1_m1` -> `shared.weapon.chainsword_p1_m1`
- `bot_lasgun_killshot` -> `shared.weapon.bot_lasgun_killshot`
- `high_bot_autogun_killshot` -> `shared.weapon.high_bot_autogun_killshot`
- `bot_combataxe_linesman` -> `shared.weapon.bot_combataxe_linesman`

Full content item paths also resolve via basename fallback:

- `content/items/weapons/player/melee/chainsword_p1_m1`
- `content/items/weapons/player/ranged/bot_lasgun_killshot`

This is the first point where `resolve` is directly useful on the strings BetterBots profile tables actually contain.

### Coverage boundary

`coverage` now reports:

- `shared` domain: source-backed
- `psyker` domain: source-backed
- `veteran` domain: partial (`ability`, `aura`, `keystone` implemented; `talent`, `talent_modifier`, `tree_node` still missing)
- `zealot`, `ogryn`, `adamant`, `broker`: unsupported for class-scoped talent/ability data

## What This Means

The current CLI is useful today for:

- weapon/blessing/perk/curio/class audit on real build fixtures
- canonicalization of BetterBots weapon template ids
- inspecting source-backed shared weapon entities for bot loadout work

It is still not enough for full BetterBots build/behavior design because:

- full class-scoped non-Psyker talent/ability coverage is still missing
- most of the migrated fixture corpus still lacks real class-side selections, so `ability` / `blitz` / `aura` remain explicit unresolved placeholders outside the live veteran sample path
- `score-build` still uses provisional family fallback for several community build weapon names instead of exact canonical ids

## Next High-Value Work

1. Re-extract builds from source pages so fixtures preserve real selected class-side nodes beyond prose-level recovery and stop depending on placeholder slots.
2. Replace the remaining provisional family matches in `score-build` with exact canonical weapon coverage where the source-backed mark-to-template bridge can be proven.
3. Extend veteran beyond the four live sample slot entities, then add class-scoped coverage for zealot/ogryn/adamant if BetterBots-side heuristic design needs talent/ability evidence for those archetypes.
