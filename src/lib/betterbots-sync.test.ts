import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./load.js";
import {
  BOT_BUILD_SLUGS,
  DEFAULT_BETTERBOTS_PROFILE_PATH,
  DEFAULT_BOT_BUILD_DIR,
  DEFAULT_BOT_WEAPON_EXPORT_PATH,
  generateBetterBotsArtifacts,
  loadBetterBotsProfileTemplates,
  parseBetterBotsProfileTemplates,
} from "./betterbots-sync.js";

const FIXED_GENERATED_AT = "2026-04-22T00:00:00.000Z";
const HAS_BETTERBOTS = existsSync(DEFAULT_BETTERBOTS_PROFILE_PATH);

function normalizeGeneratedBuildFields(value: unknown): unknown {
  const build = structuredClone(value) as {
    provenance?: {
      scraped_at?: string;
    };
  };
  if (build.provenance) {
    build.provenance.scraped_at = FIXED_GENERATED_AT;
  }
  return build;
}

describe("parseBetterBotsProfileTemplates", () => {
  it("extracts profile tables, loadouts, talents, gestalts, and overrides", () => {
    const profiles = parseBetterBotsProfileTemplates(`
      local DEFAULT_PROFILE_TEMPLATES = {
        veteran = {
          archetype = "veteran",
          loadout = {
            slot_primary = "content/items/weapons/player/melee/chainsword_p1_m1",
            slot_secondary = "content/items/weapons/player/ranged/lasgun_p3_m2",
          },
          bot_gestalts = {
            melee = "linesman",
            ranged = "killshot",
          },
          curios = {
            {
              name = "Blessed Bullet",
              traits = {
                { id = "gadget_innate_toughness_increase", rarity = 4 },
                { id = "gadget_cooldown_reduction", rarity = 4 },
              },
            },
          },
          talents = {
            veteran_combat_ability_stagger_nearby_enemies = 1,
            veteran_improved_tag = 1,
          },
          weapon_overrides = {
            slot_primary = {
              traits = {
                {
                  id = "content/items/traits/bespoke_ogryn_club_p2/staggered_targets_receive_increased_damage_debuff",
                  rarity = 4,
                  value = 1,
                },
              },
              perks = {
                { id = "content/items/perks/melee_common/wield_increase_super_armor_damage", rarity = 4 },
              },
            },
          },
        },
      }
    `);

    assert.deepEqual(Object.keys(profiles), ["veteran"]);
    assert.equal(profiles.veteran.className, "veteran");
    assert.equal(profiles.veteran.loadout.melee, "content/items/weapons/player/melee/chainsword_p1_m1");
    assert.equal(profiles.veteran.loadout.ranged, "content/items/weapons/player/ranged/lasgun_p3_m2");
    assert.equal(profiles.veteran.botGestalts.melee, "linesman");
    assert.equal(profiles.veteran.botGestalts.ranged, "killshot");
    assert.equal(profiles.veteran.curios[0]?.name, "Blessed Bullet");
    assert.equal(profiles.veteran.curios[0]?.traits[0]?.id, "gadget_innate_toughness_increase");
    assert.equal(profiles.veteran.curios[0]?.traits[1]?.id, "gadget_cooldown_reduction");
    assert.deepEqual(profiles.veteran.talents, [
      "veteran_combat_ability_stagger_nearby_enemies",
      "veteran_improved_tag",
    ]);
    assert.equal(
      profiles.veteran.weaponOverrides.melee?.traits?.[0]?.id,
      "content/items/traits/bespoke_ogryn_club_p2/staggered_targets_receive_increased_damage_debuff",
    );
    assert.equal(
      profiles.veteran.weaponOverrides.melee?.perks?.[0]?.id,
      "content/items/perks/melee_common/wield_increase_super_armor_damage",
    );
  });

  it("expands BetterBots helper calls for weapon overrides and curio gadget metadata", () => {
    const profiles = parseBetterBotsProfileTemplates(`
      local BLESSED_BULLET_GADGET_ID = "content/items/gadgets/defensive_gadget_11"
      local BLESSED_BULLET_DISPLAY_NAME = "Blessed Bullet (Reliquary)"

      local function _trait_id(family, effect_name)
        return "content/items/traits/bespoke_" .. family .. "/" .. effect_name
      end

      local function _perk_id(category, perk_name)
        return "content/items/perks/" .. category .. "/" .. perk_name
      end

      local function _trait_override(id)
        return {
          id = id,
          rarity = 4,
          value = 1,
        }
      end

      local function _perk_override(id)
        return {
          id = id,
          rarity = 4,
          value = 1,
        }
      end

      local function _default_curio_entry()
        return {
          name = BLESSED_BULLET_DISPLAY_NAME,
          master_item_id = BLESSED_BULLET_GADGET_ID,
          traits = {
            { id = "gadget_innate_toughness_increase", rarity = 4 },
            { id = "gadget_cooldown_reduction", rarity = 4 },
          },
        }
      end

      local DEFAULT_PROFILE_TEMPLATES = {
        veteran = {
          archetype = "veteran",
          loadout = {
            slot_primary = "content/items/weapons/player/melee/chainsword_p1_m1",
            slot_secondary = "content/items/weapons/player/ranged/lasgun_p3_m2",
          },
          bot_gestalts = {
            melee = "linesman",
            ranged = "killshot",
          },
          curios = {
            _default_curio_entry(),
          },
          talents = {
            veteran_combat_ability_stagger_nearby_enemies = 1,
          },
          weapon_overrides = {
            slot_primary = {
              traits = {
                _trait_override(_trait_id("chainsword_p1", "bleed_on_activated_hit")),
              },
              perks = {
                _perk_override(_perk_id("melee_common", "wield_increase_armored_damage")),
              },
            },
          },
        },
      }
    `);

    assert.equal(profiles.veteran.curios[0]?.name, "Blessed Bullet (Reliquary)");
    assert.equal(profiles.veteran.curios[0]?.masterItemId, "content/items/gadgets/defensive_gadget_11");
    assert.equal(
      profiles.veteran.weaponOverrides.melee?.traits?.[0]?.id,
      "content/items/traits/bespoke_chainsword_p1/bleed_on_activated_hit",
    );
    assert.equal(
      profiles.veteran.weaponOverrides.melee?.perks?.[0]?.id,
      "content/items/perks/melee_common/wield_increase_armored_damage",
    );
  });
});

describe("generateBetterBotsArtifacts", () => {
  it("reflects the current shipped BetterBots lineup", { skip: !HAS_BETTERBOTS }, () => {
    const profiles = loadBetterBotsProfileTemplates(DEFAULT_BETTERBOTS_PROFILE_PATH);
    const artifacts = generateBetterBotsArtifacts(profiles, { generatedAt: FIXED_GENERATED_AT });

    assert.equal(artifacts.weaponExport.classes.veteran.ranged.template_id, "lasgun_p3_m2");
    assert.equal(artifacts.weaponExport.classes.zealot.melee.template_id, "chainaxe_p1_m2");
    assert.equal(artifacts.weaponExport.classes.psyker.ranged.template_id, "forcestaff_p3_m1");
    assert.equal(artifacts.weaponExport.classes.ogryn.melee.template_id, "ogryn_club_p2_m3");
    assert.equal(artifacts.weaponExport.classes.ogryn.ranged.template_id, "ogryn_rippergun_p1_m2");

    assert.equal(
      artifacts.builds["bot-veteran"].weapons.find((weapon) => weapon.slot === "ranged")?.name.canonical_entity_id,
      "shared.weapon.lasgun_p3_m2",
    );
    assert.equal(
      artifacts.builds["bot-zealot"].weapons.find((weapon) => weapon.slot === "ranged")?.name.canonical_entity_id,
      "shared.weapon.stubrevolver_p1_m2",
    );
    assert.equal(
      artifacts.builds["bot-psyker"].ability.canonical_entity_id,
      "psyker.ability.psyker_combat_ability_stance",
    );
    assert.equal(
      artifacts.builds["bot-ogryn"].keystone?.canonical_entity_id,
      "ogryn.keystone.ogryn_passive_heavy_hitter",
    );
    assert.equal(artifacts.builds["bot-veteran"].curios.length, 3);
    assert.equal(artifacts.builds["bot-veteran"].curios[0]?.name.raw_label, "Blessed Bullet (Reliquary)");
    assert.equal(
      artifacts.builds["bot-veteran"].curios[0]?.perks[0]?.canonical_entity_id,
      "shared.gadget_trait.gadget_innate_toughness_increase",
    );
    assert.equal(
      artifacts.builds["bot-veteran"].curios[0]?.perks[1]?.canonical_entity_id,
      "shared.gadget_trait.gadget_cooldown_reduction",
    );
    assert.equal(
      artifacts.builds["bot-veteran"].weapons.find((weapon) => weapon.slot === "melee")?.perks[0]?.canonical_entity_id,
      "shared.weapon_perk.melee.weapon_trait_melee_common_wield_increased_armored_damage",
    );
    assert.equal(
      artifacts.builds["bot-veteran"].weapons.find((weapon) => weapon.slot === "ranged")?.blessings[0]?.canonical_entity_id,
      "shared.name_family.blessing.burninating_on_crit",
    );
  });

  it("keeps checked-in bot artifacts in sync with BetterBots when the repo is present", { skip: !HAS_BETTERBOTS }, () => {
    const profiles = loadBetterBotsProfileTemplates(DEFAULT_BETTERBOTS_PROFILE_PATH);
    const artifacts = generateBetterBotsArtifacts(profiles, { generatedAt: FIXED_GENERATED_AT });

    const checkedInExport = JSON.parse(readFileSync(DEFAULT_BOT_WEAPON_EXPORT_PATH, "utf8")) as Record<string, unknown>;
    checkedInExport.generated_at = FIXED_GENERATED_AT;
    assert.deepEqual(artifacts.weaponExport, checkedInExport);

    for (const slug of BOT_BUILD_SLUGS) {
      const checkedInBuild = normalizeGeneratedBuildFields(
        JSON.parse(readFileSync(join(DEFAULT_BOT_BUILD_DIR, `${slug}.json`), "utf8")),
      );
      assert.deepEqual(normalizeGeneratedBuildFields(artifacts.builds[slug]), checkedInBuild, `drift for ${slug}`);
    }
  });
});

describe("betterbots sync paths", () => {
  it("keeps the expected repo-relative BetterBots source contract", () => {
    assert.equal(
      DEFAULT_BETTERBOTS_PROFILE_PATH,
      join(REPO_ROOT, "..", "BetterBots", "scripts", "mods", "BetterBots", "bot_profiles.lua"),
    );
  });
});
