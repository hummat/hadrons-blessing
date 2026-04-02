# weapon_dump

Minimal DMF utility mod that dumps unique weapon template IDs and display names from cached MasterItems.

## Prerequisites

- Darktide Mod Framework
- MasterItems Community Patch (Nexus)

## Installation

1. Copy the `weapon_dump/` folder into Darktide's `mods/` directory.
2. Add `weapon_dump` to `mod_load_order.txt` after `dmf`.
3. Launch the game, enter the Mourningstar, and type `/weapon_dump` in chat.

## Output

The mod writes the JSON dump to `mods/weapon_dump/master_items_dump.json` relative to the game root.
