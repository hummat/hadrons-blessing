# Real Input Evaluation

> Ran 2026-03-13 against checked-in build fixtures, current shared/Psyker ground-truth data, and representative BetterBots profile weapon template ids.

## What Was Tested

- `audit` against all 20 checked-in build fixtures under `scripts/builds/`
- `score-build` against the same 20 fixtures
- `resolve` against representative BetterBots loadout template ids and full `content/items/...` item paths from bot profile tables
- `coverage` against current checked-in shard data

## Results

### Audit on canonical build fixtures

- 20/20 migrated canonical build fixtures completed with:
  - `252` resolved entries
  - `80` non-canonical entries
  - `0` ambiguous entries
  - `60` unresolved entries
- The `60` unresolved entries are not fuzzy-match failures. They are the explicit `ability` / `blitz` / `aura` placeholder selections now carried by the migrated fixtures because the checked-in legacy fixture corpus never preserved real class-side talent-tree data.
- This means the current audit path is useful on real canonical fixtures, but it now honestly surfaces the class-side data gap instead of pretending those selections were present.
- The remaining `non_canonical` entries are still mostly expected:
  - unsupported curio display labels such as `Blessed Bullet`
  - known unresolved weapon/blessing labels still tracked as non-canonical instead of leaking into `unresolved`

### Scorecard on canonical build fixtures

- `score-build` now accepts the migrated canonical build shape directly.
- Canonical weapon metadata is improved but still incomplete:
  - `13` builds: both weapons canonicalized
  - `3` builds: one weapon canonicalized
  - `4` builds: zero weapons canonicalized
- Remaining misses are still display-name coverage gaps in the scoring catalog, not resolver crashes.

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
- the migrated fixture corpus still lacks real class-side selections, so `ability` / `blitz` / `aura` remain explicit unresolved placeholders
- `score-build` still depends on partial display-name coverage for several community build weapon names

## Next High-Value Work

1. Re-extract builds from source pages so fixtures preserve real selected class-side nodes instead of `Unknown ability` / `Unknown blitz` / `Unknown aura` placeholders.
2. Expand shared weapon display-name alias coverage for the remaining `score-build` misses.
3. Add class-scoped coverage beyond Psyker if BetterBots-side heuristic design needs talent/ability evidence for those archetypes.
