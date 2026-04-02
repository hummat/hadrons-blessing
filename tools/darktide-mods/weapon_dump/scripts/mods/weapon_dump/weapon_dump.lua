local mod = get_mod("weapon_dump")
local MasterItems = require("scripts/backend/master_items")
local Items = require("scripts/utilities/items")

local OUTPUT_PATH = "weapon_dump_output.json"

local function is_missing(value)
	if type(value) ~= "string" then
		return true
	end

	local trimmed = value:match("^%s*(.-)%s*$")

	if trimmed == "" then
		return true
	end

	return trimmed:lower() == "n/a"
end

local function json_escape(value)
	return value:gsub('[%z\1-\31\\"]', function(char)
		if char == "\\" then
			return "\\\\"
		end

		if char == "\"" then
			return "\\\""
		end

		if char == "\b" then
			return "\\b"
		end

		if char == "\f" then
			return "\\f"
		end

		if char == "\n" then
			return "\\n"
		end

		if char == "\r" then
			return "\\r"
		end

		if char == "\t" then
			return "\\t"
		end

		return string.format("\\u%04x", string.byte(char))
	end)
end

local function json_string(value)
	return "\"" .. json_escape(value) .. "\""
end

local function encode_entry(entry)
	return table.concat({
		"  {",
		"    \"template_id\": " .. json_string(entry.template_id) .. ",",
		"    \"gl_name\": " .. json_string(entry.gl_name) .. ",",
		"    \"pattern\": " .. json_string(entry.pattern) .. ",",
		"    \"mark\": " .. json_string(entry.mark) .. ",",
		"    \"family\": " .. json_string(entry.family),
		"  }",
	}, "\n")
end

local function encode_entries(entries)
	if #entries == 0 then
		return "[]\n"
	end

	local encoded = {}

	for index, entry in ipairs(entries) do
		encoded[index] = encode_entry(entry)
	end

	return "[\n" .. table.concat(encoded, ",\n") .. "\n]\n"
end

local function is_weapon(item)
	return item.item_type == "WEAPON_MELEE" or item.item_type == "WEAPON_RANGED"
end

local function collect_weapon_entries()
	local cached_items = MasterItems.get_cached()

	if not cached_items then
		return nil, "MasterItems cache is not ready yet. Wait until you are in the Mourningstar and try again."
	end

	local by_template_id = {}

	for _, item in pairs(cached_items) do
		if is_weapon(item) then
			local template_id = item.weapon_template
			local pattern = Items.weapon_lore_pattern_name(item)
			local mark = Items.weapon_lore_mark_name(item)
			local family = Items.weapon_lore_family_name(item)

			if not is_missing(template_id) and not is_missing(pattern) and not is_missing(mark) and not is_missing(family) then
				if not by_template_id[template_id] then
					by_template_id[template_id] = {
						template_id = template_id,
						gl_name = string.format("%s %s %s", pattern, mark, family),
						pattern = pattern,
						mark = mark,
						family = family,
					}
				end
			end
		end
	end

	local entries = {}

	for _, entry in pairs(by_template_id) do
		entries[#entries + 1] = entry
	end

	table.sort(entries, function(left, right)
		return left.template_id < right.template_id
	end)

	return entries
end

local function write_dump_file(entries)
	local handle, err = Mods.lua.io.open(OUTPUT_PATH, "w")

	if not handle then
		return nil, err
	end

	local ok, write_err = pcall(function()
		handle:write(encode_entries(entries))
	end)

	handle:close()

	if not ok then
		return nil, write_err
	end

	return true
end

-- Diagnostic command: inspect what MasterItems actually contains
mod:command("weapon_diag", "Show diagnostic info about cached MasterItems.", function()
	local cached_items = MasterItems.get_cached()

	if not cached_items then
		mod:echo("weapon_diag: cache not ready")
		return
	end

	local total = 0
	local type_counts = {}
	local weapons = 0
	local has_template = 0
	local has_pattern = 0
	local has_mark = 0
	local has_family = 0
	local sample_npc = nil
	local sample_player = nil

	for id, item in pairs(cached_items) do
		total = total + 1
		local itype = tostring(item.item_type or "nil")
		type_counts[itype] = (type_counts[itype] or 0) + 1

		if item.item_type == "WEAPON_MELEE" or item.item_type == "WEAPON_RANGED" then
			weapons = weapons + 1

			-- Classify as NPC vs player weapon
			local is_npc = false
			if item.archetypes then
				for _, arch in pairs(item.archetypes) do
					if arch == "npc" then is_npc = true end
				end
			end

			if is_npc then
				if not sample_npc then sample_npc = {id = id, item = item} end
			else
				if not sample_player then sample_player = {id = id, item = item} end
			end

			if item.weapon_template and item.weapon_template ~= "" then
				has_template = has_template + 1
			end
			local p = Items.weapon_lore_pattern_name(item)
			local m = Items.weapon_lore_mark_name(item)
			local f = Items.weapon_lore_family_name(item)
			if p and p ~= "n/a" and p ~= "" then has_pattern = has_pattern + 1 end
			if m and m ~= "n/a" and m ~= "" then has_mark = has_mark + 1 end
			if f and f ~= "n/a" and f ~= "" then has_family = has_family + 1 end
		end
	end

	mod:echo("Total items: " .. total)
	mod:echo("Weapons: " .. weapons)
	mod:echo("Has weapon_template: " .. has_template)
	mod:echo("Has pattern: " .. has_pattern .. " mark: " .. has_mark .. " family: " .. has_family)

	-- Show item type breakdown
	for itype, count in pairs(type_counts) do
		mod:echo("  " .. itype .. ": " .. count)
	end

	-- Dump sample weapons to file for inspection (prefer player over NPC)
	local samples = {}
	if sample_player then samples[#samples + 1] = {label = "PLAYER WEAPON", data = sample_player} end
	if sample_npc then samples[#samples + 1] = {label = "NPC WEAPON", data = sample_npc} end

	if #samples > 0 then
		local lines = {}
		for _, sample in ipairs(samples) do
			lines[#lines + 1] = "=== " .. sample.label .. " ==="
			lines[#lines + 1] = "Item ID: " .. tostring(sample.data.id)
			lines[#lines + 1] = ""
			local item = sample.data.item
			for k, v in pairs(item) do
				local vstr
				if type(v) == "table" then
					local parts = {}
					for tk, tv in pairs(v) do
						parts[#parts + 1] = tostring(tk) .. "=" .. tostring(tv)
					end
					vstr = "{" .. table.concat(parts, ", ") .. "}"
				else
					vstr = tostring(v)
				end
				-- Skip resource_dependencies (huge)
				if k ~= "resource_dependencies" then
					lines[#lines + 1] = "  " .. tostring(k) .. " = " .. vstr
				end
			end
			lines[#lines + 1] = ""
		end
		local handle = Mods.lua.io.open("weapon_dump_diag.txt", "w")
		if handle then
			handle:write(table.concat(lines, "\n"))
			handle:close()
			mod:echo("Sample weapons written to weapon_dump_diag.txt")
		end
	end
end)

mod:command("weapon_dump", "Dump unique weapon template IDs and display names from cached MasterItems.", function()
	local entries, err = collect_weapon_entries()

	if not entries then
		mod:echo("weapon_dump: " .. err)
		return
	end

	local ok, write_err = write_dump_file(entries)

	if not ok then
		mod:echo("weapon_dump: failed to write " .. OUTPUT_PATH .. ": " .. tostring(write_err))
		return
	end

	mod:echo(string.format("weapon_dump: wrote %d weapon templates to %s", #entries, OUTPUT_PATH))
end)
