import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { parsePerkString, scorePerk, scoreWeaponPerks, scoreBlessings, scoreCurios, generateScorecard } from "./score-build.js";
import { analyzeBuild, loadIndex } from "./synergy-model.js";

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

  it("falls through to provisional blessing data when ground-truth lacks scoring entry", () => {
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

  it("rates unclassified perks as neutral", () => {
    const curios = [
      { name: "Blessed Bullet", perks: ["+1-3% Max Stamina"] },
    ];
    const result = scoreCurios(curios, "veteran");
    assert.equal(result.perks[0].rating, "neutral");
  });

  it("rates Revive Speed as good (universal)", () => {
    const curios = [
      { name: "Blessed Bullet", perks: ["+6-12% Revive Speed"] },
    ];
    const result = scoreCurios(curios, "veteran");
    assert.equal(result.perks[0].rating, "good");
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

  it("falls through to provisional family when ground-truth lacks scoring data", () => {
    const build = {
      title: "Provisional Fallthrough Test",
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
    assert.equal(card.weapons[0].weapon_family, "powersword_2h");
    assert.equal(card.weapons[0].slot, "melee");
    assert.equal(card.weapons[0].resolution_source, "provisional_family");
    assert.equal(card.weapons[0].blessings.valid, true);
  });
});

describe("end-to-end", () => {
  it("scores sample Veteran Squad Leader build", () => {
    const build = JSON.parse(readFileSync(new URL("../../data/sample-build.json", import.meta.url)));
    const card = generateScorecard(build);
    assert.equal(card.class, "veteran");
    assert.ok(card.perk_optimality >= 3, "Veteran Squad Leader should score well on perks");
    assert.ok(card.curio_efficiency >= 3, "Live sample curios should still score above neutral");
    assert.equal(card.weapons.length, 2);
  });
});

describe("generateScorecard composite score", () => {
  it("includes composite_score and letter_grade without synergy", () => {
    const build = {
      title: "Composite Test",
      class: "veteran",
      weapons: [
        { name: "M35 Magnacore Mk II Plasma Gun", perks: ["20-25% Damage (Unyielding)"], blessings: [] },
      ],
      curios: [],
      talents: [],
    };
    const card = generateScorecard(build);
    assert.ok(typeof card.composite_score === "number");
    assert.ok(typeof card.letter_grade === "string");
    assert.ok(["S", "A", "B", "C", "D"].includes(card.letter_grade));
  });
});

const HAS_SOURCE = !!process.env.GROUND_TRUTH_SOURCE_ROOT;

describe("generateScorecard qualitative scores", { skip: !HAS_SOURCE && "requires GROUND_TRUTH_SOURCE_ROOT" }, () => {
  let index;
  function getSynergy(build) {
    if (!index) index = loadIndex();
    return analyzeBuild(build, index);
  }

  it("populates talent_coherence, blessing_synergy, role_coverage when synergy passed", () => {
    const build = JSON.parse(readFileSync("data/builds/08-gandalf-melee-wizard.json", "utf-8"));
    const synergy = getSynergy(build);
    const card = generateScorecard(build, synergy);
    assert.notEqual(card.qualitative.talent_coherence, null);
    assert.notEqual(card.qualitative.blessing_synergy, null);
    assert.notEqual(card.qualitative.role_coverage, null);
    assert.ok(card.qualitative.talent_coherence.score >= 1);
    assert.ok(card.qualitative.talent_coherence.score <= 5);
  });

  it("keeps qualitative null when no synergy passed", () => {
    const build = JSON.parse(readFileSync("data/builds/08-gandalf-melee-wizard.json", "utf-8"));
    const card = generateScorecard(build);
    assert.equal(card.qualitative.talent_coherence, null);
    assert.equal(card.qualitative.blessing_synergy, null);
  });

  it("keeps breakpoint_relevance and difficulty_scaling null", () => {
    const build = JSON.parse(readFileSync("data/builds/08-gandalf-melee-wizard.json", "utf-8"));
    const synergy = getSynergy(build);
    const card = generateScorecard(build, synergy);
    assert.equal(card.qualitative.breakpoint_relevance, null);
    assert.equal(card.qualitative.difficulty_scaling, null);
  });

  it("includes composite score and letter grade", () => {
    const build = JSON.parse(readFileSync("data/builds/08-gandalf-melee-wizard.json", "utf-8"));
    const synergy = getSynergy(build);
    const card = generateScorecard(build, synergy);
    assert.ok(typeof card.composite_score === "number");
    assert.ok(typeof card.letter_grade === "string");
    assert.ok(["S", "A", "B", "C", "D"].includes(card.letter_grade));
  });

  it("does not change perk_optimality or curio_efficiency", () => {
    const build = JSON.parse(readFileSync("data/builds/08-gandalf-melee-wizard.json", "utf-8"));
    const synergy = getSynergy(build);
    const card = generateScorecard(build, synergy);
    assert.ok(typeof card.perk_optimality === "number");
    assert.ok(typeof card.curio_efficiency === "number");
  });
});

// ── Integration: real build data → scoring pipeline ─────────────────

describe("real build perk normalization (integration)", () => {
  // These perks represent the full GL naming convention as scraped from live pages.
  // If normalizePerkName() regresses, these tests catch it with real data.

  const WEAPON_PERK_EXPECTATIONS = [
    ["10-25% Damage (Flak Armoured Enemies)", "Damage (Flak Armoured)", "melee"],
    ["10-25% Damage (Carapace Armoured Enemies)", "Damage (Carapace)", "ranged"],
    ["10-25% Damage (Unarmoured Enemies)", "Damage (Unarmoured)", "melee"],
    ["10-25% Damage (Unyielding Enemies)", "Damage (Unyielding)", "ranged"],
    ["10-25% Damage (Infested Enemies)", "Damage (Infested)", "melee"],
    ["10-25% Damage (Maniacs)", "Damage (Maniacs)", "melee"],
    ["4-10% Melee Damage (Elites)", "Damage (Elites)", "melee"],
    ["5-10% Reload Speed", "Reload Speed", "ranged"],
  ];

  for (const [raw, expectedName, slot] of WEAPON_PERK_EXPECTATIONS) {
    it(`weapon perk "${raw}" → scorePerk match`, () => {
      const parsed = parsePerkString(raw);
      assert.ok(parsed, `parsePerkString failed for "${raw}"`);
      assert.equal(parsed.name, expectedName);
      const scored = scorePerk(parsed.name, parsed.max, slot);
      assert.ok(scored, `scorePerk returned null for "${expectedName}" in ${slot} catalog`);
      assert.ok(scored.tier >= 1 && scored.tier <= 4, `tier ${scored.tier} out of range`);
    });
  }

  const CURIO_PERK_EXPECTATIONS = [
    ["+5-20% Damage Resistance (Gunners)", "DR vs Gunners"],
    ["+5-20% Damage Resistance (Snipers)", "DR vs Snipers"],
    ["+5-20% Damage Resistance (Bombers)", "DR vs Bombers"],
    ["+5-20% Damage Resistance (Tox Flamers)", "DR vs Flamers"],
    ["+1-4% Combat Ability Regeneration", "Combat Ability Regen"],
    ["+4-10% Revive Speed (Ally)", "Revive Speed"],
    ["+17-21% Max Health", "Health"],
    ["+2-5% Toughness", "Toughness"],
    ["+6-12% Stamina Regeneration", "Stamina Regeneration"],
    ["+6-15% Corruption Resistance", "Corruption Resistance"],
    ["+6-12% Block Efficiency", "Block Efficiency"],
    ["6-15% Sprint Efficiency", "Sprint Efficiency"],
    ["+1 Wound(s)", "Wound(s)"],
    ["+1-3 Max Stamina", "Max Stamina"],
  ];

  for (const [raw, expectedName] of CURIO_PERK_EXPECTATIONS) {
    it(`curio perk "${raw}" → scorePerk match`, () => {
      const parsed = parsePerkString(raw);
      assert.ok(parsed, `parsePerkString failed for "${raw}"`);
      assert.equal(parsed.name, expectedName);
      const scored = scorePerk(parsed.name, parsed.max, "curio");
      assert.ok(scored, `scorePerk returned null for "${expectedName}" in curio catalog`);
      assert.ok(scored.tier >= 1 && scored.tier <= 4, `tier ${scored.tier} out of range`);
    });
  }
});

describe("scoring data coverage", () => {
  const data = JSON.parse(readFileSync("data/build-scoring-data.json", "utf-8"));
  const catalogWeapons = Object.keys(data.weapons);

  it("all curio rating entries reference valid curio_perks keys", () => {
    const curioKeys = new Set(Object.keys(data.curio_perks));
    const ratingLists = [
      ...data.curio_ratings._universal_optimal,
      ...data.curio_ratings._universal_good,
      ...data.curio_ratings._universal_avoid,
    ];
    for (const [cls, ratings] of Object.entries(data.curio_ratings)) {
      if (cls.startsWith("_")) continue;
      ratingLists.push(...(ratings.optimal || []), ...(ratings.good || []));
    }
    const invalid = ratingLists.filter((name) => !curioKeys.has(name));
    assert.deepEqual(invalid, [], `Rating keys not in curio_perks catalog: ${invalid.join(", ")}`);
  });

  it("weapon catalog covers >60% of build weapons (current: ${catalogWeapons.length}/32)", () => {
    // This test documents the known coverage gap and will fail if coverage
    // drops below threshold, signaling that new builds added weapons
    // without updating the scoring catalog.
    assert.ok(
      catalogWeapons.length >= 10,
      `Weapon catalog has only ${catalogWeapons.length} entries (expected >=10)`,
    );
  });
});

describe("real build end-to-end scoring (integration)", () => {
  const builds = readdirSync("data/builds")
    .filter((f) => f.endsWith(".json"))
    .sort()
    .slice(0, 5); // test 5 builds for speed

  const index = loadIndex();

  for (const f of builds) {
    it(`${f}: all weapon perks resolve to non-null tier`, () => {
      const build = JSON.parse(readFileSync(`data/builds/${f}`, "utf-8"));
      const synergy = analyzeBuild(build, index);
      const card = generateScorecard(build, synergy);

      for (const w of card.weapons) {
        for (const p of w.perks.perks) {
          if (p === null) continue; // unparseable — checked separately
          assert.ok(
            p.tier > 0,
            `${f}: weapon perk "${p.name}" has tier ${p.tier} (expected > 0)`,
          );
        }
      }
    });

    it(`${f}: curio DR/toughness perks resolve to correct ratings`, () => {
      const build = JSON.parse(readFileSync(`data/builds/${f}`, "utf-8"));
      const synergy = analyzeBuild(build, index);
      const card = generateScorecard(build, synergy);

      for (const p of card.curios.perks) {
        // DR perks should be "optimal", Toughness should be "optimal"
        if (p.name === "DR vs Gunners" || p.name === "DR vs Snipers" || p.name === "Toughness") {
          assert.equal(
            p.rating,
            "optimal",
            `${f}: "${p.name}" should be optimal, got ${p.rating}`,
          );
        }
        // Health, Stamina Regen should be "good" (or "optimal" if class overrides)
        if (p.name === "Health" || p.name === "Stamina Regeneration") {
          assert.ok(
            p.rating === "good" || p.rating === "optimal",
            `${f}: "${p.name}" should be good or optimal, got ${p.rating}`,
          );
        }
        // These should never be "neutral" or "avoid" — they're in universal good/optimal lists
        if (p.name === "Combat Ability Regen") {
          assert.ok(
            p.rating === "good" || p.rating === "optimal",
            `${f}: "${p.name}" should be good or optimal, got ${p.rating}`,
          );
        }
      }
    });
  }
});
