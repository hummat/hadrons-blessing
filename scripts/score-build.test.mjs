import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { parsePerkString, scorePerk, scoreWeaponPerks, scoreBlessings, scoreCurios, generateScorecard } from "./score-build.mjs";

describe("parsePerkString", () => {
  it("parses percentage range perk", () => {
    const result = parsePerkString("10-25% Damage (Flak Armoured)");
    assert.deepEqual(result, { min: 0.10, max: 0.25, name: "Damage (Flak Armoured)" });
  });

  it("parses plus-prefixed perk", () => {
    const result = parsePerkString("+1-2 Stamina");
    assert.deepEqual(result, { min: 1, max: 2, name: "Stamina" });
  });

  it("parses single-value perk", () => {
    const result = parsePerkString("+5% Toughness");
    assert.deepEqual(result, { min: 0.05, max: 0.05, name: "Toughness" });
  });

  it("parses single-value without plus prefix", () => {
    const result = parsePerkString("25% Damage (Flak Armoured)");
    assert.deepEqual(result, { min: 0.25, max: 0.25, name: "Damage (Flak Armoured)" });
  });

  it("returns null for unparseable string", () => {
    const result = parsePerkString("Some random text");
    assert.equal(result, null);
  });
});

describe("scorePerk", () => {
  it("returns tier 4 for max value match", () => {
    const result = scorePerk("Damage (Flak Armoured)", 0.25, "melee");
    assert.equal(result.tier, 4);
  });

  it("returns tier 1 for min value match", () => {
    const result = scorePerk("Damage (Flak Armoured)", 0.10, "melee");
    assert.equal(result.tier, 1);
  });

  it("returns tier 2 for second-tier value", () => {
    const result = scorePerk("Damage (Flak Armoured)", 0.15, "melee");
    assert.equal(result.tier, 2);
  });

  it("returns tier 3 for third-tier value", () => {
    const result = scorePerk("Damage (Flak Armoured)", 0.20, "melee");
    assert.equal(result.tier, 3);
  });

  it("returns null for unknown perk", () => {
    const result = scorePerk("Nonexistent Perk", 0.10, "melee");
    assert.equal(result, null);
  });

  it("returns null for unknown slot", () => {
    const result = scorePerk("Damage (Flak Armoured)", 0.10, "banana");
    assert.equal(result, null);
  });

  it("works with ranged slot", () => {
    const result = scorePerk("Reload Speed", 0.10, "ranged");
    assert.equal(result.tier, 4);
  });

  it("works with curio slot", () => {
    const result = scorePerk("DR vs Gunners", 0.20, "curio");
    assert.equal(result.tier, 4);
  });

  it("finds nearest tier for in-between values", () => {
    // 0.12 is between T1 (0.10) and T2 (0.15), closer to T1
    const result = scorePerk("Damage (Flak Armoured)", 0.12, "melee");
    assert.equal(result.tier, 1);
  });
});

describe("scoreWeaponPerks", () => {
  it("scores a weapon with T4 perks as 5/5", () => {
    const weapon = {
      name: "Some Melee Weapon",
      perks: ["20-25% Damage (Flak Armoured)", "8-10% Damage (Elites)"],
    };
    const result = scoreWeaponPerks(weapon, "melee");
    assert.equal(result.score, 5);
    assert.equal(result.perks.length, 2);
    assert.ok(result.perks.every((p) => p.tier === 4));
  });

  it("scores a weapon with T1 perks as 2/5", () => {
    const weapon = {
      name: "Some Melee Weapon",
      perks: ["10-10% Damage (Flak Armoured)", "4-4% Damage (Elites)"],
    };
    const result = scoreWeaponPerks(weapon, "melee");
    assert.equal(result.score, 2);
    assert.ok(result.perks.every((p) => p.tier === 1));
  });

  it("scores a weapon with mixed tiers", () => {
    const weapon = {
      name: "Some Melee Weapon",
      perks: ["20-25% Damage (Flak Armoured)", "4-4% Damage (Elites)"],
    };
    const result = scoreWeaponPerks(weapon, "melee");
    // T4 + T1 = average 2.5 → score 3
    assert.equal(result.score, 3);
  });

  it("scores a weapon with no perks as 1/5", () => {
    const weapon = {
      name: "Some Melee Weapon",
      perks: [],
    };
    const result = scoreWeaponPerks(weapon, "melee");
    assert.equal(result.score, 1);
  });

  it("scores a weapon with unparseable perks as 1/5", () => {
    const weapon = {
      name: "Some Melee Weapon",
      perks: ["gibberish text"],
    };
    const result = scoreWeaponPerks(weapon, "melee");
    assert.equal(result.score, 1);
  });
});

describe("scoreBlessings", () => {
  it("validates known blessing on known weapon", () => {
    const weapon = {
      name: "M35 Magnacore Mk II Plasma Gun",
      blessings: [{ name: "Rising Heat", description: "..." }],
    };
    const result = scoreBlessings(weapon);
    assert.equal(result.valid, true);
    assert.equal(result.blessings[0].known, true);
  });

  it("flags unknown blessing", () => {
    const weapon = {
      name: "M35 Magnacore Mk II Plasma Gun",
      blessings: [{ name: "Fake Blessing", description: "..." }],
    };
    const result = scoreBlessings(weapon);
    assert.equal(result.blessings[0].known, false);
  });

  it("returns valid=null for weapon with null blessings in data", () => {
    const weapon = {
      name: "Voidstrike Staff",
      blessings: [{ name: "Something", description: "..." }],
    };
    const result = scoreBlessings(weapon);
    assert.equal(result.valid, null);
    assert.deepEqual(result.blessings, []);
  });

  it("returns valid=null for unknown weapon", () => {
    const weapon = {
      name: "Totally Unknown Weapon XYZ",
      blessings: [{ name: "Something", description: "..." }],
    };
    const result = scoreBlessings(weapon);
    assert.equal(result.valid, null);
    assert.deepEqual(result.blessings, []);
  });

  it("validates all blessings and sets valid=true when all known", () => {
    const weapon = {
      name: "M35 Magnacore Mk II Plasma Gun",
      blessings: [
        { name: "Rising Heat", description: "..." },
        { name: "Gets Hot!", description: "..." },
      ],
    };
    const result = scoreBlessings(weapon);
    assert.equal(result.valid, true);
    assert.equal(result.blessings.length, 2);
    assert.ok(result.blessings.every((b) => b.known === true));
  });

  it("sets valid=false when any blessing is unknown", () => {
    const weapon = {
      name: "M35 Magnacore Mk II Plasma Gun",
      blessings: [
        { name: "Rising Heat", description: "..." },
        { name: "Fake One", description: "..." },
      ],
    };
    const result = scoreBlessings(weapon);
    assert.equal(result.valid, false);
  });

  it("fuzzy matches weapon name (data key substring of weapon name)", () => {
    const weapon = {
      name: "Improvised Mk I Shivs",
      blessings: [{ name: "Uncanny Strike", description: "..." }],
    };
    const result = scoreBlessings(weapon);
    assert.equal(result.valid, true);
    assert.equal(result.blessings[0].known, true);
  });

  it("includes internal name in blessing result", () => {
    const weapon = {
      name: "M35 Magnacore Mk II Plasma Gun",
      blessings: [{ name: "Rising Heat", description: "..." }],
    };
    const result = scoreBlessings(weapon);
    assert.equal(result.blessings[0].internal, "crit_chance_scaled_on_heat");
  });

  it("matches weapon internal names through ground-truth aliases", () => {
    const weapon = {
      name: "dual_shivs_p1_m1",
      blessings: [{ name: "Uncanny Strike", description: "..." }],
    };
    const result = scoreBlessings(weapon);
    assert.equal(result.valid, true);
    assert.equal(result.blessings[0].known, true);
  });

  it("validates blessings for provisional family fallback weapons", () => {
    const weapon = {
      name: "Foe-Rend Mk V Ripper Gun",
      blessings: [
        { name: "Inspiring Barrage", description: "..." },
        { name: "Blaze Away", description: "..." },
      ],
    };
    const result = scoreBlessings(weapon);
    assert.equal(result.valid, true);
    assert.deepEqual(
      result.blessings.map((blessing) => blessing.known),
      [true, true],
    );
  });
});

describe("scoreCurios", () => {
  it("scores optimal curio perks higher", () => {
    const curios = [
      { name: "Blessed Bullet", perks: ["+15-20% DR vs Gunners", "+4-5% Toughness"] },
    ];
    const result = scoreCurios(curios, "veteran");
    assert.ok(result.score >= 4);
  });

  it("penalizes XP/docket perks", () => {
    const curios = [
      { name: "Blessed Bullet", perks: ["+6-10% Experience", "+4-10% Ordo Dockets"] },
    ];
    const result = scoreCurios(curios, "veteran");
    assert.ok(result.score <= 2);
  });

  it("returns perk details with rating", () => {
    const curios = [
      { name: "Blessed Bullet", perks: ["+15-20% DR vs Gunners"] },
    ];
    const result = scoreCurios(curios, "veteran");
    assert.equal(result.perks.length, 1);
    assert.equal(result.perks[0].name, "DR vs Gunners");
    assert.equal(result.perks[0].rating, "optimal");
    assert.ok(result.perks[0].tier >= 1 && result.perks[0].tier <= 4);
  });

  it("rates universal_avoid perks as avoid", () => {
    const curios = [
      { name: "Blessed Bullet", perks: ["+5-20% Curio Drop Chance"] },
    ];
    const result = scoreCurios(curios, "veteran");
    assert.equal(result.perks[0].rating, "avoid");
  });

  it("rates class good perks as good", () => {
    const curios = [
      { name: "Blessed Bullet", perks: ["+6-12% Stamina Regeneration"] },
    ];
    const result = scoreCurios(curios, "veteran");
    assert.equal(result.perks[0].rating, "good");
  });

  it("rates unknown perks as neutral", () => {
    const curios = [
      { name: "Blessed Bullet", perks: ["+6-12% Revive Speed"] },
    ];
    const result = scoreCurios(curios, "veteran");
    assert.equal(result.perks[0].rating, "neutral");
  });

  it("scores multiple curios together", () => {
    const curios = [
      { name: "C1", perks: ["+15-20% DR vs Gunners", "+4-5% Toughness"] },
      { name: "C2", perks: ["+15-20% DR vs Snipers", "+3-4% Combat Ability Regen"] },
    ];
    const result = scoreCurios(curios, "veteran");
    assert.ok(result.score >= 4);
    assert.equal(result.perks.length, 4);
  });
});

describe("generateScorecard", () => {
  it("preserves canonical metadata for BetterBots content item paths", () => {
    const result = generateScorecard({
      title: "BetterBots profile sample",
      class: "veteran",
      weapons: [
        {
          name: "content/items/weapons/player/melee/chainsword_p1_m1",
          perks: [],
          blessings: [],
        },
        {
          name: "content/items/weapons/player/ranged/bot_lasgun_killshot",
          perks: [],
          blessings: [],
        },
      ],
      curios: [],
      talents: {},
    });

    assert.equal(result.weapons[0].canonical_entity_id, "shared.weapon.chainsword_p1_m1");
    assert.equal(result.weapons[0].internal_name, "chainsword_p1_m1");
    assert.equal(result.weapons[0].resolution_source, "ground_truth");
    assert.equal(result.weapons[1].canonical_entity_id, "shared.weapon.bot_lasgun_killshot");
    assert.equal(result.weapons[1].internal_name, "bot_lasgun_killshot");
    assert.equal(result.weapons[1].resolution_source, "ground_truth");
  });

  it("scores canonical build fixtures with selection objects", () => {
    const result = generateScorecard({
      title: "Canonical fixture sample",
      class: {
        raw_label: "psyker",
        canonical_entity_id: "shared.class.psyker",
        resolution_status: "resolved",
      },
      weapons: [
        {
          name: {
            raw_label: "Covenant Mk VI Blaze Force Greatsword",
            canonical_entity_id: "shared.weapon.forcesword_2h_p1_m1",
            resolution_status: "resolved",
          },
          perks: [
            {
              raw_label: "20-25% Damage (Carapace)",
              canonical_entity_id: "shared.weapon_perk.melee.weapon_trait_melee_common_wield_increased_super_armor_damage",
              resolution_status: "resolved",
            },
          ],
          blessings: [
            {
              raw_label: "Blazing Spirit",
              canonical_entity_id: "shared.name_family.blessing.blazing_spirit",
              resolution_status: "resolved",
            },
          ],
        },
        {
          name: {
            raw_label: "Equinox Mk III Voidblast Force Staff",
            canonical_entity_id: "shared.weapon.forcestaff_p4_m1",
            resolution_status: "resolved",
          },
          perks: [],
          blessings: [],
        },
      ],
      curios: [
        {
          name: {
            raw_label: "Blessed Bullet",
            canonical_entity_id: null,
            resolution_status: "non_canonical",
          },
          perks: [
            {
              raw_label: "+4-5% Toughness",
              canonical_entity_id: "shared.gadget_trait.gadget_toughness_increase",
              resolution_status: "resolved",
            },
          ],
        },
      ],
      talents: [],
    });

    assert.equal(result.class, "psyker");
    assert.equal(result.weapons[0].name, "Covenant Mk VI Blaze Force Greatsword");
    assert.equal(result.weapons[0].canonical_entity_id, "shared.weapon.forcesword_2h_p1_m1");
    assert.equal(result.weapons[0].blessings.valid, null);
    assert.equal(result.curios.perks[0].name, "Toughness");
  });
});

describe("generateScorecard", () => {
  it("produces scorecard from sample build", () => {
    const build = {
      title: "Test Build",
      class: "veteran",
      weapons: [
        { name: "M35 Magnacore Mk II Plasma Gun", perks: ["20-25% Damage (Unyielding)", "8-10% Damage (Elites)"], blessings: [{ name: "Rising Heat" }, { name: "Gets Hot!" }] },
        { name: "Lawbringer Mk IIb Power Falchion", perks: ["20-25% Damage (Flak Armoured)", "20-25% Damage (Maniacs)"], blessings: [{ name: "Cranial Grounding" }, { name: "Heatsink" }] },
      ],
      curios: [
        { name: "Blessed Bullet", perks: ["+15-20% DR vs Gunners", "+4-5% Toughness"] },
        { name: "Blessed Bullet", perks: ["+15-20% DR vs Snipers", "+4-5% Toughness"] },
        { name: "Blessed Bullet", perks: ["+2-5% Health", "+3-4% Combat Ability Regen"] },
      ],
      talents: { active: [], inactive: [] },
    };
    const card = generateScorecard(build);
    assert.ok(card.title === "Test Build");
    assert.ok(card.perk_optimality >= 1 && card.perk_optimality <= 5);
    assert.ok(card.curio_efficiency >= 1 && card.curio_efficiency <= 5);
    assert.ok(card.weapons.length === 2);
    assert.ok(card.curios);
  });

  it("includes weapon slot from data lookup", () => {
    const build = {
      title: "Slot Test",
      class: "veteran",
      weapons: [
        { name: "M35 Magnacore Mk II Plasma Gun", perks: [], blessings: [] },
      ],
      curios: [],
      talents: { active: [], inactive: [] },
    };
    const card = generateScorecard(build);
    assert.equal(card.weapons[0].slot, "ranged");
  });

  it("defaults slot to null for unknown weapon", () => {
    const build = {
      title: "Unknown Weapon",
      class: "veteran",
      weapons: [
        { name: "Totally Fake Weapon XYZ", perks: [], blessings: [] },
      ],
      curios: [],
      talents: { active: [], inactive: [] },
    };
    const card = generateScorecard(build);
    assert.equal(card.weapons[0].slot, null);
  });

  it("includes qualitative and bot_flags fields", () => {
    const build = {
      title: "Structure Test",
      class: "zealot",
      weapons: [],
      curios: [],
      talents: { active: [], inactive: [] },
    };
    const card = generateScorecard(build);
    assert.ok(card.qualitative !== undefined);
    assert.equal(card.qualitative.blessing_synergy, null);
    assert.equal(card.qualitative.talent_coherence, null);
    assert.equal(card.qualitative.breakpoint_relevance, null);
    assert.equal(card.qualitative.role_coverage, null);
    assert.equal(card.qualitative.difficulty_scaling, null);
    assert.deepEqual(card.bot_flags, []);
  });

  it("includes canonical weapon metadata from ground-truth resolution", () => {
    const build = {
      title: "Canonical Metadata Test",
      class: "broker",
      weapons: [
        { name: "dual_shivs_p1_m1", perks: [], blessings: [] },
      ],
      curios: [],
      talents: { active: [], inactive: [] },
    };
    const card = generateScorecard(build);
    assert.equal(card.weapons[0].canonical_entity_id, "shared.weapon.dual_shivs_p1_m1");
    assert.equal(card.weapons[0].internal_name, "dual_shivs_p1_m1");
    assert.equal(card.weapons[0].weapon_family, "dual_shivs");
    assert.equal(card.weapons[0].slot, "melee");
    assert.equal(card.weapons[0].resolution_source, "ground_truth");
  });

  it("includes provisional family metadata without minting fake canonical ids", () => {
    const build = {
      title: "Provisional Family Metadata Test",
      class: "zealot",
      weapons: [
        {
          name: "Munitorum Mk II Relic Blade",
          perks: ["20-25% Damage (Flak Armoured)", "20-25% Damage (Maniacs)"],
          blessings: [{ name: "Wrath" }, { name: "Overload" }],
        },
      ],
      curios: [],
      talents: { active: [], inactive: [] },
    };
    const card = generateScorecard(build);
    assert.equal(card.weapons[0].canonical_entity_id, null);
    assert.equal(card.weapons[0].weapon_family, "powersword_2h");
    assert.equal(card.weapons[0].slot, "melee");
    assert.equal(card.weapons[0].resolution_source, "provisional_family");
    assert.equal(card.weapons[0].blessings.valid, true);
  });
});

describe("end-to-end", () => {
  it("scores sample Veteran Squad Leader build", () => {
    const build = JSON.parse(readFileSync(new URL("./sample-build.json", import.meta.url)));
    const card = generateScorecard(build);
    assert.equal(card.class, "veteran");
    assert.ok(card.perk_optimality >= 3, "Veteran Squad Leader should score well on perks");
    assert.ok(card.curio_efficiency >= 4, "DR stacking curios should score high");
    assert.equal(card.weapons.length, 2);
  });
});
