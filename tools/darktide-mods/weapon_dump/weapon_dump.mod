return {
	run = function()
		fassert(rawget(_G, "new_mod"), "`Weapon Dump` encountered an error loading the Darktide Mod Framework.")

		new_mod("weapon_dump", {
			mod_script = "weapon_dump/scripts/mods/weapon_dump/weapon_dump",
			mod_data = "weapon_dump/scripts/mods/weapon_dump/weapon_dump_data",
		})
	end,
	packages = {},
}
