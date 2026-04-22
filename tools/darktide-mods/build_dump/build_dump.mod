return {
	run = function()
		fassert(rawget(_G, "new_mod"), "`Build Dump` encountered an error loading the Darktide Mod Framework.")

		new_mod("build_dump", {
			mod_script = "build_dump/scripts/mods/build_dump/build_dump",
			mod_data = "build_dump/scripts/mods/build_dump/build_dump_data",
		})
	end,
	packages = {},
}
