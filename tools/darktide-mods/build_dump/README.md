# build_dump

Minimal DMF utility mod that dumps the current operative's equipped build to
raw runtime JSON shaped for Hadron's Blessing canonicalization.

## Prerequisites

- Darktide Mod Framework
- MasterItems Community Patch (Nexus)

## Installation

1. Copy the `build_dump/` folder into Darktide's `mods/` directory.
2. Add `build_dump` to `mod_load_order.txt` after `dmf`.
3. Launch the game, enter the Mourningstar or a mission, and type `/build_dump`
   in chat.

## Output

The mod writes one file under the game's `binaries/` working directory. The
filename is unique per dump:

- `binaries/build_dump_<class>_<melee>_<ranged>_<utc-timestamp>.json`

If that exact name already exists, the mod appends `_2`, `_3`, and so on.

The payload includes:

- top-level runtime provenance (`source_kind`, `dumped_at`, `class`, `title`)
- explicit `class_selections` for `ability`, `blitz`, `aura`, and `keystone`
- `talents.active` with selected node metadata (`widget_name`, `talent_id`,
  `node_type`, `points_spent`, localized `name`)
- `weapons` with runtime slot ids, gear ids, master item ids, canonicalizer-facing
  `name`, localized `display_name`, formatted `perks`, and blessing objects
- `curios` with runtime slot ids, gear ids, master item ids, localized `name`,
  combined formatted `perks`, and separate `runtime_traits` / `runtime_perks`
  detail arrays

The JSON is intentionally raw. It does not try to emit canonical entity ids in
Lua.
