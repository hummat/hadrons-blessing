return {
	run = function()
		fassert(rawget(_G, "new_mod"), "`Curio Dump` encountered an error loading the Darktide Mod Framework.")

		new_mod("curio_dump", {
			mod_script = "curio_dump/scripts/mods/curio_dump/curio_dump",
			mod_data = "curio_dump/scripts/mods/curio_dump/curio_dump_data",
		})
	end,
	packages = {},
}
