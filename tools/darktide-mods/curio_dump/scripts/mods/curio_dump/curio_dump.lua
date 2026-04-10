local mod = get_mod("curio_dump")
local MasterItems = require("scripts/backend/master_items")
local Items = require("scripts/utilities/items")

local OUTPUT_PATH = "curio_dump_output.json"
local DIAG_PATH = "curio_dump_diag.txt"

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

local function encode_string_array(values)
	if not values or #values == 0 then
		return "[]"
	end

	local encoded = {}

	for index, value in ipairs(values) do
		encoded[index] = json_string(value)
	end

	return "[" .. table.concat(encoded, ", ") .. "]"
end

local function encode_entry(entry)
	return table.concat({
		"  {",
		"    \"master_item_id\": " .. json_string(entry.master_item_id) .. ",",
		"    \"display_name\": " .. json_string(entry.display_name) .. ",",
		"    \"display_name_key\": " .. json_string(entry.display_name_key) .. ",",
		"    \"slots\": " .. encode_string_array(entry.slots) .. ",",
		"    \"archetypes\": " .. encode_string_array(entry.archetypes),
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

local function sorted_strings(values)
	if type(values) ~= "table" then
		return {}
	end

	local result = {}

	for _, value in pairs(values) do
		if type(value) == "string" then
			result[#result + 1] = value
		end
	end

	table.sort(result)

	return result
end

local function is_curio(item)
	return Items.is_gadget(item.item_type)
end

local function collect_curio_entries()
	local cached_items = MasterItems.get_cached()

	if not cached_items then
		return nil, "MasterItems cache is not ready yet. Wait until you are in the Mourningstar and try again."
	end

	local entries = {}

	for master_item_id, item in pairs(cached_items) do
		if is_curio(item) then
			local display_name = Items.display_name(item)
			local display_name_key = item.display_name or ""

			if not is_missing(master_item_id) and not is_missing(display_name) then
				entries[#entries + 1] = {
					master_item_id = master_item_id,
					display_name = display_name,
					display_name_key = display_name_key,
					slots = sorted_strings(item.slots),
					archetypes = sorted_strings(item.archetypes),
				}
			end
		end
	end

	table.sort(entries, function(left, right)
		if left.display_name == right.display_name then
			return left.master_item_id < right.master_item_id
		end

		return left.display_name < right.display_name
	end)

	return entries
end

local function write_text_file(path, contents)
	local handle, err = Mods.lua.io.open(path, "w")

	if not handle then
		return nil, err
	end

	local ok, write_err = pcall(function()
		handle:write(contents)
	end)

	handle:close()

	if not ok then
		return nil, write_err
	end

	return true
end

mod:command("curio_diag", "Show diagnostic info about cached curio MasterItems.", function()
	local cached_items = MasterItems.get_cached()

	if not cached_items then
		mod:echo("curio_diag: cache not ready")
		return
	end

	local total = 0
	local gadget_count = 0
	local sample_id = nil
	local sample_item = nil

	for master_item_id, item in pairs(cached_items) do
		total = total + 1

		if is_curio(item) then
			gadget_count = gadget_count + 1

			if not sample_item then
				sample_id = master_item_id
				sample_item = item
			end
		end
	end

	mod:echo("Total items: " .. total)
	mod:echo("Curios: " .. gadget_count)

	if not sample_item then
		mod:echo("curio_diag: no gadget sample found")
		return
	end

	local lines = {
		"Sample gadget id: " .. tostring(sample_id),
		"Localized display name: " .. tostring(Items.display_name(sample_item)),
		"",
	}

	for key, value in pairs(sample_item) do
		local rendered
		if type(value) == "table" then
			local parts = {}
			for nested_key, nested_value in pairs(value) do
				parts[#parts + 1] = tostring(nested_key) .. "=" .. tostring(nested_value)
			end
			table.sort(parts)
			rendered = "{" .. table.concat(parts, ", ") .. "}"
		else
			rendered = tostring(value)
		end

		if key ~= "resource_dependencies" then
			lines[#lines + 1] = "  " .. tostring(key) .. " = " .. rendered
		end
	end

	local ok, err = write_text_file(DIAG_PATH, table.concat(lines, "\n"))

	if not ok then
		mod:echo("curio_diag: failed to write diagnostic file: " .. tostring(err))
		return
	end

	mod:echo("Sample curio written to " .. DIAG_PATH)
end)

mod:command("curio_dump", "Dump unique curio items and localized names from cached MasterItems.", function()
	local entries, err = collect_curio_entries()

	if not entries then
		mod:echo("curio_dump: " .. err)
		return
	end

	local ok, write_err = write_text_file(OUTPUT_PATH, encode_entries(entries))

	if not ok then
		mod:echo("curio_dump: failed to write dump file: " .. tostring(write_err))
		return
	end

	mod:echo(string.format("curio_dump: wrote %d entries to %s", #entries, OUTPUT_PATH))
end)
