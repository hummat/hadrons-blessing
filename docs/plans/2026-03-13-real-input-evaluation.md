# Real Input Evaluation

> Ran 2026-03-13 against checked-in build fixtures, current shared/Psyker ground-truth data, and representative BetterBots profile weapon template ids.

## What Was Tested

- `audit` against all 20 checked-in build fixtures under `scripts/builds/`
- `score-build` against the same 20 fixtures
- `resolve` against representative BetterBots loadout template ids and full `content/items/...` item paths from bot profile tables
- `coverage` against current checked-in shard data

## Results

### Audit on real build fixtures

- 20/20 build fixtures completed with:
  - `252` resolved entries
  - `80` non-canonical entries
  - `0` ambiguous entries
  - `0` unresolved entries
- This means the current audit path is already useful for real structured build fixtures as a machine-readable loadout triage tool.
- The remaining `non_canonical` entries are mostly expected:
  - unsupported curio display labels such as `Blessed Bullet`
  - known unresolved weapon/blessing labels still tracked as non-canonical instead of leaking into `unresolved`

### Scorecard on real build fixtures

- Canonical weapon metadata is now materially better but still incomplete on community build display names:
  - 12 builds: both weapons canonicalized
  - 3 builds: one weapon canonicalized
  - 5 builds: zero weapons canonicalized
- Remaining misses are mainly unmapped display-name variants from scraped builds, not resolver crashes.

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

`coverage` still reports the same hard limit:

- `shared` domain: source-backed
- `psyker` domain: source-backed
- `veteran`, `zealot`, `ogryn`, `adamant`, `broker`: unsupported for class-scoped talent/ability data

## What This Means

The current CLI is useful today for:

- weapon/blessing/perk/curio/class audit on real build fixtures
- canonicalization of BetterBots weapon template ids
- inspecting source-backed shared weapon entities for bot loadout work

It is still not enough for full BetterBots build/behavior design because:

- class-scoped non-Psyker talent/ability coverage is missing
- scraped build fixtures do not currently retain structured talent/ability/blitz/aura data in a form that `audit` consumes
- `score-build` still depends on partial display-name coverage for community build weapon names

## Next High-Value Work

1. Fix the extraction/build-shaping pipeline so scraped builds preserve structured class decision inputs, not just weapons/curios.
2. Expand shared weapon display-name alias coverage for the remaining community build misses.
3. Add class-scoped coverage beyond Psyker if BetterBots-side heuristic design needs talent/ability evidence for those archetypes.
