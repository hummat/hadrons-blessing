# curio_dump

Minimal DMF utility mod that dumps unique curio items from cached `MasterItems`.

## Prerequisites

- Darktide Mod Framework
- MasterItems Community Patch (Nexus)

## Installation

1. Copy the `curio_dump/` folder into Darktide's `mods/` directory.
2. Add `curio_dump` to `mod_load_order.txt` after `dmf`.
3. Launch the game, enter the Mourningstar, and type `/curio_dump` in chat.

## Output

The mod writes the dump files under the game's `binaries/` working directory:

- `binaries/curio_dump_output.json`
- `binaries/curio_dump_diag.txt`

Each entry includes:

- `master_item_id` — stable cache key from `MasterItems.get_cached()`
- `display_name` — localized curio item name via `Items.display_name(item)`
- `display_name_key` — raw localization key from the master item, when present
- `slots` — item slots from the cached item
- `archetypes` — archetype restrictions from the cached item

For one-off inspection, `/curio_diag` writes a representative raw gadget sample to `binaries/curio_dump_diag.txt`.

## Observed Result

The runtime dump exposes 21 ambiguous curio base labels as concrete variants
with suffixes like `(Caged)`, `(Casket)`, and `(Reliquary)`. Example:
`Blessed Bullet (Caged|Casket|Reliquary)`. Games Lantern strips that suffix,
so the bare cosmetic labels in scraped builds are structurally ambiguous and
should be treated as `non_canonical`, not unresolved.
