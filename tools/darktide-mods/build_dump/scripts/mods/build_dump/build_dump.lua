local mod = get_mod("build_dump")
local CharacterSheet = require("scripts/utilities/character_sheet")
local Items = require("scripts/utilities/items")
local MasterItems = require("scripts/backend/master_items")

local TALENT_LAYOUT_KEYS = {
	"talent_layout_file_path",
	"specialization_talent_layout_file_path",
}
local CURIO_SLOTS = {
	"slot_attachment_1",
	"slot_attachment_2",
	"slot_attachment_3",
}
local WEAPON_SLOTS = {
	"slot_primary",
	"slot_secondary",
}
local CLASS_SIDE_SLOTS = {
	"ability",
	"blitz",
	"aura",
}

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

local function is_array(value)
	if type(value) ~= "table" then
		return false
	end

	local count = 0

	for key, _ in pairs(value) do
		if type(key) ~= "number" or key < 1 or key % 1 ~= 0 then
			return false
		end

		count = count + 1
	end

	for index = 1, count do
		if value[index] == nil then
			return false
		end
	end

	return true
end

local function sorted_keys(value)
	local keys = {}

	for key, _ in pairs(value) do
		keys[#keys + 1] = key
	end

	table.sort(keys, function(left, right)
		return tostring(left) < tostring(right)
	end)

	return keys
end

local function json_encode(value, indent)
	indent = indent or 0

	if value == nil then
		return "null"
	end

	local value_type = type(value)

	if value_type == "boolean" then
		return value and "true" or "false"
	end

	if value_type == "number" then
		return tostring(value)
	end

	if value_type == "string" then
		return json_string(value)
	end

	if value_type ~= "table" then
		return json_string(tostring(value))
	end

	local child_indent = indent + 2
	local padding = string.rep(" ", indent)
	local child_padding = string.rep(" ", child_indent)

	if is_array(value) then
		if #value == 0 then
			return "[]"
		end

		local encoded_items = {}

		for index = 1, #value do
			encoded_items[index] = child_padding .. json_encode(value[index], child_indent)
		end

		return "[\n" .. table.concat(encoded_items, ",\n") .. "\n" .. padding .. "]"
	end

	local keys = sorted_keys(value)

	if #keys == 0 then
		return "{}"
	end

	local encoded_items = {}

	for index, key in ipairs(keys) do
		encoded_items[index] = child_padding .. json_string(tostring(key)) .. ": " .. json_encode(value[key], child_indent)
	end

	return "{\n" .. table.concat(encoded_items, ",\n") .. "\n" .. padding .. "}"
end

local function write_dump_file(path, contents)
	local handle, err = Mods.lua.io.open(path, "w")

	if not handle then
		return nil, err
	end

	local ok, write_err = pcall(function()
		handle:write(contents)
		handle:write("\n")
	end)

	handle:close()

	if not ok then
		return nil, write_err
	end

	return true
end

local function now_iso8601()
	if os and os.date then
		return os.date("!%Y-%m-%dT%H:%M:%SZ")
	end

	return ""
end

local function safe_timestamp()
	if os and os.date then
		return os.date("!%Y%m%d_%H%M%S")
	end

	return "unknown_time"
end

local function slugify(value)
	local text = tostring(value or "unknown"):lower()

	text = text:gsub("[^%w_]+", "_")
	text = text:gsub("_+", "_")
	text = text:gsub("^_+", "")
	text = text:gsub("_+$", "")

	if text == "" then
		return "unknown"
	end

	return text
end

local function file_exists(path)
	local handle = Mods.lua.io.open(path, "r")

	if not handle then
		return false
	end

	handle:close()

	return true
end

local function weapon_name_for_filename(weapons, slot_name)
	for index = 1, #weapons do
		local weapon = weapons[index]

		if weapon.slot == slot_name then
			return slugify(weapon.name)
		end
	end

	return "unknown_" .. slot_name
end

local function unique_output_path(payload)
	local class_name = slugify(payload.class)
	local melee_name = weapon_name_for_filename(payload.weapons or {}, "melee")
	local ranged_name = weapon_name_for_filename(payload.weapons or {}, "ranged")
	local timestamp = safe_timestamp()
	local base_name = string.format("build_dump_%s_%s_%s_%s", class_name, melee_name, ranged_name, timestamp)
	local candidate = base_name .. ".json"
	local suffix = 2

	while file_exists(candidate) do
		candidate = string.format("%s_%d.json", base_name, suffix)
		suffix = suffix + 1
	end

	return candidate
end

local function master_item_id(item)
	local gear = item and item.gear
	local master_data = gear and gear.masterDataInstance

	return master_data and master_data.id or ""
end

local function localized_talent_name(talent, fallback)
	local display_name = talent and talent.display_name

	if type(display_name) == "string" and display_name ~= "" then
		return Localize(display_name)
	end

	return fallback or "Unknown"
end

local function sanitize_display_text(text)
	text = tostring(text or "")
	text = text:gsub("{#.-}", "")
	text = text:gsub("%s+", " ")
	text = text:gsub("^%s+", "")
	text = text:gsub("%s+$", "")

	return text
end

local function normalized_talent_name(talent, fallback)
	return sanitize_display_text(localized_talent_name(talent, fallback))
end

local function weapon_slot_name(item)
	if item.item_type == "WEAPON_MELEE" then
		return "melee"
	end

	if item.item_type == "WEAPON_RANGED" then
		return "ranged"
	end

	return "unknown"
end

local function weapon_sort_key(slot_name)
	if slot_name == "melee" then
		return 1
	end

	if slot_name == "ranged" then
		return 2
	end

	return 99
end

local function lookup_trait_item(traitlike)
	local master_item_id = traitlike and traitlike.id

	if not master_item_id then
		return nil
	end

	return MasterItems.get_item(master_item_id)
end

local function traitlike_description(traitlike)
	local trait_item = lookup_trait_item(traitlike)

	if not trait_item then
		return sanitize_display_text(tostring(traitlike and traitlike.id or "unknown"))
	end

	return sanitize_display_text(Items.trait_description(trait_item, traitlike.rarity, traitlike.value) or Items.display_name(trait_item))
end

local function traitlike_name(traitlike)
	local trait_item = lookup_trait_item(traitlike)

	if not trait_item then
		return sanitize_display_text(tostring(traitlike and traitlike.id or "unknown"))
	end

	return sanitize_display_text(Items.display_name(trait_item))
end

local function collect_traitlike_details(traitlikes, source)
	local details = {}
	local count = traitlikes and #traitlikes or 0

	for index = 1, count do
		local traitlike = traitlikes[index]

		details[#details + 1] = {
			id = traitlike.id or "",
			name = traitlike_name(traitlike),
			description = traitlike_description(traitlike),
			rarity = traitlike.rarity,
			source = source,
			value = traitlike.value,
		}
	end

	return details
end

local function collect_weapon_perks(item)
	local details = collect_traitlike_details(item.perks, "perk")
	local perks = {}

	for index = 1, #details do
		perks[index] = details[index].description
	end

	return perks, details
end

local function collect_weapon_blessings(item)
	local blessings = {}
	local traits = item.traits
	local count = traits and #traits or 0

	for index = 1, count do
		local trait = traits[index]

		blessings[#blessings + 1] = {
			description = traitlike_description(trait),
			id = trait.id or "",
			name = traitlike_name(trait),
			rarity = trait.rarity,
			value = trait.value,
		}
	end

	return blessings
end

local function collect_curio_perks(item)
	local perks = {}
	local trait_details = collect_traitlike_details(item.traits, "trait")
	local perk_details = collect_traitlike_details(item.perks, "perk")

	for index = 1, #trait_details do
		perks[#perks + 1] = trait_details[index].description
	end

	for index = 1, #perk_details do
		perks[#perks + 1] = perk_details[index].description
	end

	return perks, trait_details, perk_details
end

local function collect_selected_talents(profile)
	local entries = {}
	local archetype = profile.archetype
	local selected_nodes = profile.selected_nodes or {}
	local talent_definitions = archetype and archetype.talents or {}

	for _, layout_key in ipairs(TALENT_LAYOUT_KEYS) do
		local layout_path = archetype and archetype[layout_key]

		if layout_path then
			local layout = require(layout_path)
			local nodes = layout.nodes or {}

			for index = 1, #nodes do
				local node = nodes[index]
				local points_spent = selected_nodes[node.widget_name]
				local talent_id = node.talent

				if points_spent and points_spent > 0 and talent_id and talent_id ~= "not_selected" then
					local talent_definition = talent_definitions[talent_id]

					entries[#entries + 1] = {
						name = normalized_talent_name(talent_definition, talent_id),
						node_type = node.type or "default",
						points_spent = points_spent,
						talent_id = talent_id,
						widget_name = node.widget_name,
					}
				end
			end
		end
	end

	return entries
end

local function selected_keystone_name(selected_talents)
	for index = 1, #selected_talents do
		local entry = selected_talents[index]

		if entry.node_type == "keystone" then
			return entry.name
		end
	end

	return nil
end

local function collect_class_selections(profile, selected_talents)
	local class_loadout = {
		ability = {},
		blitz = {},
		aura = {},
	}

	CharacterSheet.class_loadout(profile, class_loadout, false, profile.talents, true)

	local selections = {
		keystone = selected_keystone_name(selected_talents),
	}

	for _, slot_name in ipairs(CLASS_SIDE_SLOTS) do
		local slot_data = class_loadout[slot_name]
		local talent = slot_data and slot_data.talent

		selections[slot_name] = talent and normalized_talent_name(talent) or nil
	end

	return selections
end

local function collect_weapon_entries(profile)
	local loadout = profile.loadout or {}
	local entries = {}

	for _, runtime_slot in ipairs(WEAPON_SLOTS) do
		local item = loadout[runtime_slot]

		if item and Items.is_weapon(item.item_type) then
			local perks, perk_details = collect_weapon_perks(item)

			entries[#entries + 1] = {
				blessings = collect_weapon_blessings(item),
				display_name = sanitize_display_text(Items.display_name(item)),
				gear_id = item.gear_id,
				item_type = item.item_type,
				master_item_id = master_item_id(item),
				name = item.weapon_template or master_item_id(item) or Items.display_name(item),
				perk_details = perk_details,
				perks = perks,
				runtime_slot = runtime_slot,
				slot = weapon_slot_name(item),
			}
		end
	end

	table.sort(entries, function(left, right)
		local left_key = weapon_sort_key(left.slot)
		local right_key = weapon_sort_key(right.slot)

		if left_key == right_key then
			return left.runtime_slot < right.runtime_slot
		end

		return left_key < right_key
	end)

	return entries
end

local function collect_curio_entries(profile)
	local loadout = profile.loadout or {}
	local entries = {}

	for _, runtime_slot in ipairs(CURIO_SLOTS) do
		local item = loadout[runtime_slot]

		if item and Items.is_gadget(item.item_type) then
			local perks, runtime_traits, runtime_perks = collect_curio_perks(item)

			entries[#entries + 1] = {
				display_name = sanitize_display_text(Items.display_name(item)),
				gear_id = item.gear_id,
				item_type = item.item_type,
				master_item_id = master_item_id(item),
				name = sanitize_display_text(Items.display_name(item)),
				perks = perks,
				runtime_perks = runtime_perks,
				runtime_slot = runtime_slot,
				runtime_traits = runtime_traits,
			}
		end
	end

	return entries
end

local function collect_build_dump()
	local cached_items = MasterItems.get_cached()

	if not cached_items then
		return nil, "MasterItems cache is not ready yet. Wait until you are in the Mourningstar and try again."
	end

	local player_manager = Managers.player
	local local_player = player_manager and player_manager:local_player(1)

	if not local_player then
		return nil, "Local player is not ready yet. Enter the Mourningstar or a mission and try again."
	end

	local profile = local_player:profile()

	if not profile then
		return nil, "Player profile is not ready yet. Enter the Mourningstar or a mission and try again."
	end

	local selected_talents = collect_selected_talents(profile)
	local class_selections = collect_class_selections(profile, selected_talents)
	local character_name = profile.name or profile.archetype and profile.archetype.name or "unknown"

	local payload = {
		author = character_name,
		character_id = profile.character_id,
		class = profile.archetype and profile.archetype.name or "unknown",
		class_selections = class_selections,
		curios = collect_curio_entries(profile),
		dumped_at = now_iso8601(),
		source_kind = "darktide_runtime_equipped",
		talents = {
			active = selected_talents,
			inactive = {},
		},
		title = character_name .. " equipped build",
		url = "darktide://runtime/equipped",
		weapons = collect_weapon_entries(profile),
	}

	return payload, unique_output_path(payload)
end

mod:command("build_dump", "Dump the current operative's equipped build to raw runtime JSON.", function()
	local payload, output_path_or_err = collect_build_dump()

	if not payload then
		mod:echo("build_dump: " .. output_path_or_err)
		return
	end

	local output_path = output_path_or_err
	local ok, write_err = write_dump_file(output_path, json_encode(payload))

	if not ok then
		mod:echo("build_dump: failed to write " .. output_path .. ": " .. tostring(write_err))
		return
	end

	mod:echo(string.format("build_dump: wrote equipped build to %s", output_path))
end)
