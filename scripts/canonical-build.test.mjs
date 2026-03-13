import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { assertValidCanonicalBuild, validateCanonicalBuild } from "./ground-truth/lib/build-shape.mjs";

function makeSelection(overrides = {}) {
  return {
    raw_label: "Warp Rider",
    canonical_entity_id: "psyker.talent.psyker_damage_based_on_warp_charge",
    resolution_status: "resolved",
    ...overrides,
  };
}

function makeCanonicalBuild(overrides = {}) {
  return {
    schema_version: 1,
    title: "Fixture",
    class: makeSelection({
      raw_label: "psyker",
      canonical_entity_id: "shared.class.psyker",
    }),
    provenance: {
      source_kind: "gameslantern",
      source_url: "https://darktide.gameslantern.com/builds/example",
      author: "tester",
      scraped_at: "2026-03-13T12:00:00Z",
    },
    ability: makeSelection({
      raw_label: "Venting Shriek",
      canonical_entity_id: "psyker.ability.psyker_shout_vent_warp_charge",
    }),
    blitz: makeSelection({
      raw_label: "Brain Rupture",
      canonical_entity_id: null,
      resolution_status: "unresolved",
    }),
    aura: makeSelection({
      raw_label: "Psykinetic's Aura",
      canonical_entity_id: null,
      resolution_status: "unresolved",
    }),
    keystone: null,
    talents: [
      makeSelection(),
    ],
    weapons: [
      {
        slot: "melee",
        name: makeSelection({
          raw_label: "chainsword_p1_m1",
          canonical_entity_id: "shared.weapon.chainsword_p1_m1",
        }),
        perks: [
          makeSelection({
            raw_label: "20-25% Damage (Carapace)",
            canonical_entity_id: "shared.weapon_perk.melee.weapon_trait_melee_common_wield_increased_carapace_damage",
            value: {
              min: 0.2,
              max: 0.25,
              unit: "percent",
            },
          }),
        ],
        blessings: [
          makeSelection({
            raw_label: "Blazing Spirit",
            canonical_entity_id: "shared.name_family.blessing.blazing_spirit",
          }),
        ],
      },
      {
        slot: "ranged",
        name: makeSelection({
          raw_label: "bot_lasgun_killshot",
          canonical_entity_id: "shared.weapon.bot_lasgun_killshot",
        }),
        perks: [],
        blessings: [],
      },
    ],
    curios: [
      {
        name: makeSelection({
          raw_label: "Blessed Bullet",
          canonical_entity_id: null,
          resolution_status: "non_canonical",
        }),
        perks: [
          makeSelection({
            raw_label: "+4-5% Toughness",
            canonical_entity_id: "shared.gadget_trait.gadget_toughness_increase",
            value: {
              min: 0.04,
              max: 0.05,
              unit: "percent",
            },
          }),
        ],
      },
    ],
    ...overrides,
  };
}

describe("validateCanonicalBuild", () => {
  it("accepts a valid canonical build", () => {
    const result = validateCanonicalBuild(makeCanonicalBuild());
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });

  it("rejects resolved selections with null canonical ids", () => {
    const build = makeCanonicalBuild({
      ability: makeSelection({
        raw_label: "Venting Shriek",
        canonical_entity_id: null,
        resolution_status: "resolved",
      }),
    });
    const result = validateCanonicalBuild(build);
    assert.equal(result.ok, false);
  });

  it("rejects unresolved selections with non-null canonical ids", () => {
    const build = makeCanonicalBuild({
      blitz: makeSelection({
        raw_label: "Brain Rupture",
        canonical_entity_id: "psyker.talent.psyker_damage_based_on_warp_charge",
        resolution_status: "unresolved",
      }),
    });
    const result = validateCanonicalBuild(build);
    assert.equal(result.ok, false);
  });

  it("rejects non-canonical selections with non-null canonical ids", () => {
    const build = makeCanonicalBuild({
      curios: [
        {
          name: makeSelection({
            raw_label: "Blessed Bullet",
            canonical_entity_id: "shared.gadget_trait.gadget_toughness_increase",
            resolution_status: "non_canonical",
          }),
          perks: [],
        },
      ],
    });
    const result = validateCanonicalBuild(build);
    assert.equal(result.ok, false);
  });

  it("accepts quantified value payloads on selection objects", () => {
    const result = validateCanonicalBuild(makeCanonicalBuild());
    assert.equal(result.ok, true);
  });

  it("requires non-null ability, blitz, and aura", () => {
    for (const field of ["ability", "blitz", "aura"]) {
      const result = validateCanonicalBuild(makeCanonicalBuild({
        [field]: null,
      }));
      assert.equal(result.ok, false, `${field} should be required and non-null`);
    }
  });

  it("allows nullable keystone", () => {
    const result = validateCanonicalBuild(makeCanonicalBuild({
      keystone: null,
    }));
    assert.equal(result.ok, true);
  });

  it("rejects builds without exactly one melee and one ranged weapon", () => {
    const duplicateMelee = makeCanonicalBuild({
      weapons: [
        makeCanonicalBuild().weapons[0],
        {
          ...makeCanonicalBuild().weapons[1],
          slot: "melee",
        },
      ],
    });
    const result = validateCanonicalBuild(duplicateMelee);
    assert.equal(result.ok, false);
    assert.match(
      result.errors.map((error) => error.message).join(" "),
      /exactly one melee|exactly one ranged/,
    );
  });
});

describe("assertValidCanonicalBuild", () => {
  it("throws for invalid canonical builds", () => {
    assert.throws(
      () => assertValidCanonicalBuild(makeCanonicalBuild({ ability: null })),
      /Invalid canonical build/,
    );
  });
});
