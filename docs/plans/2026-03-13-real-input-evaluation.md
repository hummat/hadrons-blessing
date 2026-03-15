# Real Input Evaluation

> Last updated 2026-03-15.
>
> **Superseded:** The numbers below reflect a 2026-03-14 snapshot. As of 2026-03-15 all 20 builds are re-extracted, all 6 classes have full entity coverage (768 entities total), and audit totals are **1089 resolved / 60 unresolved / 1 non_canonical / 0 ambiguous**. The 60 unresolved are curio cosmetic item names (backend-only). See README.md for current coverage table.

## What Was Tested

- `audit` against all 20 checked-in build fixtures under `scripts/builds/`
- `score-build` against the same 20 fixtures
- `resolve` against representative BetterBots loadout template ids and full `content/items/...` item paths from bot profile tables
- `coverage` against current checked-in shard data

## Results

### Audit on canonical build fixtures

- 20/20 canonical build fixtures completed with:
  - `480` resolved entries
  - `79` non-canonical entries
  - `0` ambiguous entries
  - `85` unresolved entries

Unresolved breakdown:
- ~20 stat nodes across 7 re-extracted builds (e.g., `Toughness Boost 22`, `Stamina Boost 3`) — design question on representation, not resolver failures
- ~48 placeholder class-side slots across 13 legacy fixtures (`Unknown ability`, `Unknown blitz`, `Unknown aura`) — need re-extraction from live GL pages
- ~17 perks in expanded GL label format not covered by current aliases (e.g., `10-25% Damage (Carapace Armoured Enemies)` vs the aliased `20-25% Damage (Carapace)`)

Non-canonical entries are mostly expected:
- unsupported curio display labels such as `Blessed Bullet`
- known unresolved weapon/blessing labels tracked as non-canonical
- multi-option guide entries (e.g., build 07's compound blitz label listing 3 alternatives)

### Re-extracted builds

7 of 20 builds have been re-extracted from live GL pages with full talent trees:

| Build | Class | Slots | Talents | Unresolved |
|-------|-------|-------|---------|------------|
| 01-veteran-squad-leader | veteran | 4/4 resolved | 21/26 | 5 stat nodes |
| 02-assault-veteran | veteran | 4/4 resolved | 21/26 | 5 stat nodes |
| 03-slinking-veteran | veteran | 4/4 resolved | 21/26 | 5 stat nodes |
| 04-spicy-meta-zealot | zealot | 4/4 resolved | 22/26 | 4 stat nodes |
| 05-fatmangus-zealot-stealth | zealot | 4/4 resolved | 22/26 | 4 stat nodes |
| 06-holy-gains-zealot | zealot | 4/4 resolved | 22/26 | 4 stat nodes |
| 07-zealot-infodump | zealot | 2/4 resolved (blitz+aura are multi-option guide entries) | 22/26 | 4 stat nodes |

Remaining 13 builds (psyker 08-10, ogryn 11-13, arbites 14-16, hive-scum 17-20) are legacy fixtures with empty talent data and placeholder class-side slots.

### Scorecard on canonical build fixtures

- `score-build` accepts canonical build shape directly
- Weapon coverage: 17 builds with both weapons identified (exact or provisional), 3 with one
- Some re-extracted perks in expanded GL label format are unresolved by the scorer — a perk alias coverage gap, not a structural issue

### BetterBots profile template ids

Representative internal template ids resolve:

- `chainsword_p1_m1` -> `shared.weapon.chainsword_p1_m1`
- `bot_lasgun_killshot` -> `shared.weapon.bot_lasgun_killshot`
- `high_bot_autogun_killshot` -> `shared.weapon.high_bot_autogun_killshot`
- `bot_combataxe_linesman` -> `shared.weapon.bot_combataxe_linesman`

Full content item paths also resolve via basename fallback:

- `content/items/weapons/player/melee/chainsword_p1_m1`
- `content/items/weapons/player/ranged/bot_lasgun_killshot`

### Coverage boundary

| Domain | Status | Entities | Aliases | Notes |
|--------|--------|----------|---------|-------|
| shared | source-backed | 90 | many | weapons, perks, blessings, curio traits, classes |
| psyker | source-backed | ~25 | ~25 | builds not yet re-extracted |
| veteran | source-backed | 43 | 44 | 3 builds re-extracted with full talent trees |
| zealot | source-backed | 57 | 57 | 4 builds re-extracted with full talent trees |
| ogryn | unsupported | — | — | |
| arbites/adamant | unsupported | — | — | |
| hive-scum/broker | unsupported | — | — | |

## What This Means

The current CLI is useful today for:

- weapon/blessing/perk/curio/class audit on real build fixtures across all classes
- full class-side resolution (ability, blitz, aura, keystone, talents) for veteran and zealot builds
- canonicalization of BetterBots weapon template ids
- inspecting source-backed entities for bot loadout work

It is still not enough for full BetterBots build/behavior design across all classes because:

- ogryn, psyker (re-extraction), arbites, and hive-scum talent/ability coverage is missing
- stat nodes are unresolved and not yet represented as source-backed entities
- some perk labels in the expanded GL display format are not covered by aliases

## Next High-Value Work

1. Re-extract ogryn builds (11-13) and psyker builds (08-10) with full talent trees
2. Add ogryn and psyker class-side entity coverage following the established workflow
3. Decide how stat nodes should be represented and resolved
4. Expand perk alias coverage for the newer GL label format (`X-Y% Damage (Carapace Armoured Enemies)`)
5. Re-extract arbites and hive-scum builds when those classes become relevant for BetterBots work
