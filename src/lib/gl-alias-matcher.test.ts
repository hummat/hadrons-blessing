import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildIndex } from "./ground-truth-index.js";
import { matchCorpusEntry } from "./gl-alias-matcher.js";

describe("matchCorpusEntry", () => {
  it("matches a ranged weak spot perk corpus entry by kind and slot", async () => {
    const result = await matchCorpusEntry(
      {
        domain: "weapon_perk",
        raw_label: "4-10% Ranged Weak Spot Damage",
        normalized_label: "4 10 ranged weak spot damage",
        source_url: "perk-url",
        source_kind: "gl-perk",
        slot: "ranged",
      },
      await buildIndex({ check: false }),
    );

    assert.equal(result.state, "high_confidence_match");
    assert.equal(
      result.candidate_entity_id,
      "shared.weapon_perk.ranged.weapon_trait_ranged_increase_weakspot_damage",
    );
  });

  it("matches all currently unmatched Games Lantern perk label variants", async () => {
    const index = await buildIndex({ check: false });
    const cases = [
      {
        raw_label: "1-2 Stamina (Weapon is Active)",
        normalized_label: "1 2 stamina weapon is active",
        slot: "ranged",
        expected: "shared.weapon_perk.ranged.weapon_trait_ranged_increase_stamina",
      },
      {
        raw_label: "4-10% Increased Melee Damage (Specialists)",
        normalized_label: "4 10 increased melee damage specialists",
        slot: "melee",
        expected: "shared.weapon_perk.melee.weapon_trait_increase_damage_specials",
      },
      {
        raw_label: "4-10% Melee Damage (Groaners, Poxwalkers)",
        normalized_label: "4 10 melee damage groaners poxwalkers",
        slot: "melee",
        expected: "shared.weapon_perk.melee.weapon_trait_increase_damage_hordes",
      },
      {
        raw_label: "4-10% Ranged Damage (Groaners, Poxwalkers)",
        normalized_label: "4 10 ranged damage groaners poxwalkers",
        slot: "ranged",
        expected: "shared.weapon_perk.ranged.weapon_trait_ranged_increase_damage_hordes",
      },
      {
        raw_label: "Increase Ranged Critical Strike Chance by 2-5%",
        normalized_label: "increase ranged critical strike chance by 2 5",
        slot: "ranged",
        expected: "shared.weapon_perk.ranged.weapon_trait_ranged_increase_crit_chance",
      },
    ];

    for (const testCase of cases) {
      const result = await matchCorpusEntry(
        {
          domain: "weapon_perk",
          raw_label: testCase.raw_label,
          normalized_label: testCase.normalized_label,
          source_url: "perk-url",
          source_kind: "gl-perk",
          slot: testCase.slot,
        },
        index,
      );

      assert.equal(result.state, "high_confidence_match", testCase.raw_label);
      assert.equal(result.candidate_entity_id, testCase.expected, testCase.raw_label);
    }
  });

  it("classifies blessing matches as review_required when more than one family remains", async () => {
    const result = await matchCorpusEntry(
      {
        domain: "weapon_trait",
        raw_label: "Generic Fury",
        normalized_label: "generic fury",
        source_url: "blessing-url",
        source_kind: "gl-blessing",
        description: "+5% Damage. Stacks 5 times.",
        weapon_type_labels: ["Autopistol", "Bolter"],
      },
      await buildIndex({ check: false }),
    );

    assert.equal(result.state, "review_required");
    assert.ok(result.candidates.length > 1);
  });

  it("matches curated Games Lantern blessing labels to source-backed families", async () => {
    const index = await buildIndex({ check: false });
    const cases = [
      {
        raw_label: "Charmed Reload",
        normalized_label: "charmed reload",
        description: "5 bullets loaded from Reserve on Critical Hit.",
        weapon_type_labels: ["Twin-Linked Heavy Stubber"],
        expected: "shared.name_family.blessing.ammo_from_reserve_on_crit",
      },
      {
        raw_label: "Puncture",
        normalized_label: "puncture",
        description: "Ranged hits add 4 stacks of bleed to enemies.",
        weapon_type_labels: ["Bolt Pistol", "Spearhead Boltgun"],
        expected: "shared.name_family.blessing.bleed_on_ranged",
      },
      {
        raw_label: "Hand-Cannon",
        normalized_label: "hand cannon",
        description: "+60% Rending on Critical Hit.",
        weapon_type_labels: ["Quickdraw Stub Revolver"],
        expected: "shared.name_family.blessing.puncture",
      },
      {
        raw_label: "Headtaker",
        normalized_label: "headtaker",
        description: "+5% Strength for 3.5s on Hit. Stacks 5 times.",
        weapon_type_labels: ["Combat Axe", "Tactical Axe", "Delver's Pickaxe"],
        expected: "shared.name_family.blessing.increase_power_on_hit",
      },
      {
        raw_label: "Quickflame",
        normalized_label: "quickflame",
        description: "+36% Reload Speed if empty.",
        weapon_type_labels: ["Purgation Flamer"],
        expected: "shared.name_family.blessing.faster_reload_on_empty_clip",
      },
      {
        raw_label: "Rampage",
        normalized_label: "rampage",
        description: "Hitting at least 3 enemies with an attack, increases your damage by +36% for 3.5 seconds.",
        weapon_type_labels: ["Power Sword"],
        expected: "shared.name_family.blessing.rampage",
      },
      {
        raw_label: "Savage Sweep",
        normalized_label: "savage sweep",
        description: "Hitting at least 3 enemies with an attack, increases your cleave by +200% for 3 seconds.",
        weapon_type_labels: ["Assault Chainsword", "Heavy Sword"],
        expected: "shared.name_family.blessing.wrath",
      },
      {
        raw_label: "Slaughterer",
        normalized_label: "slaughterer",
        description: "+8% Strength for 4.5s on Kill. Stacks 5 times.",
        weapon_type_labels: ["Power Sword", "Delver's Pickaxe"],
        expected: "shared.name_family.blessing.increase_power_on_kill",
      },
      {
        raw_label: "Wrath",
        normalized_label: "wrath",
        description: "+40% Cleave on Hit. Stacks 5 times.",
        weapon_type_labels: ["Assault Chainsword", "Heavy Sword"],
        expected: "shared.name_family.blessing.chained_hits_increases_melee_cleave",
      },
      {
        raw_label: "Agile",
        normalized_label: "agile",
        description: "Refreshed Dodge Efficiency on Weak Spot Hit. +10% Melee Weakspot Damage.",
        weapon_type_labels: ["Tactical Axe", "Duelling Sword"],
        expected: "shared.name_family.blessing.weakspot_hit_resets_dodge_count",
      },
      {
        raw_label: "All or Nothing",
        normalized_label: "all or nothing",
        description: "Up to +40% Strength, as Stamina depletes.",
        weapon_type_labels: ["Combat Axe", "Tactical Axe"],
        expected: "shared.name_family.blessing.power_bonus_scaled_on_stamina",
      },
      {
        raw_label: "Armourbane",
        normalized_label: "armourbane",
        description: "Adds 8-12 stacks of 2.5% Brittleness to hit enemies, based on charge level.",
        weapon_type_labels: ["Helbore Lasgun"],
        expected: "shared.name_family.blessing.targets_receive_rending_debuff_on_charged_shots",
      },
      {
        raw_label: "Focused Cooling",
        normalized_label: "focused cooling",
        description: "+60% Heat generation on Critical Hit.",
        weapon_type_labels: ["Plasma Gun"],
        expected: "shared.name_family.blessing.gets_hot",
      },
      {
        raw_label: "Bladed Momentum",
        normalized_label: "bladed momentum",
        description: "Hitting multiple enemies in one sweep gives +8% Rending for 4s. Stacks 5 times.",
        weapon_type_labels: ["Heavy Sword"],
        expected: "shared.name_family.blessing.rending_on_multiple_hits",
      },
      {
        raw_label: "Deathblow",
        normalized_label: "deathblow",
        description: "+15% Melee Weak Spot Damage. Weak Spot Kills ignore Enemy Hit Mass.",
        weapon_type_labels: ["Heavy Sword"],
        expected: "shared.name_family.blessing.brutal_momentum",
      },
      {
        raw_label: "Weight of Fire",
        normalized_label: "weight of fire",
        description: "Chaining Charged Attacks reduces their Charge Time by -12%. Stacks 5 times.",
        weapon_type_labels: ["Helbore Lasgun"],
        expected: "shared.name_family.blessing.warp_flurry",
      },
      {
        raw_label: "Sunder",
        normalized_label: "sunder",
        description: "Increased Cleave and +20% Heavy Melee Attack Damage on Energised Attacks.",
        weapon_type_labels: ["Power Sword"],
        expected: "shared.name_family.blessing.pass_past_armor_on_weapon_special",
      },
      {
        raw_label: "Syphon",
        normalized_label: "syphon",
        description: "Hitting at least 3 enemies with an attack while weapon Special is active, regains +16% Toughness.",
        weapon_type_labels: ["Relic Blade"],
        expected: "shared.name_family.blessing.weapon_trait_bespoke_powersword_2h_p1_regain_toughness_on_multiple_hits_by_weapon_special",
      },
    ];

    for (const testCase of cases) {
      const result = await matchCorpusEntry(
        {
          domain: "weapon_trait",
          raw_label: testCase.raw_label,
          normalized_label: testCase.normalized_label,
          source_url: "blessing-url",
          source_kind: "gl-blessing",
          description: testCase.description,
          weapon_type_labels: testCase.weapon_type_labels,
        },
        index,
      );

      assert.equal(result.state, "high_confidence_match", testCase.raw_label);
      assert.equal(result.candidate_entity_id, testCase.expected, testCase.raw_label);
    }
  });
});
