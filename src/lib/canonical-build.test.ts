import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertValidCanonicalBuild, validateCanonicalBuild } from "./build-shape.js";
import { canonicalizeScrapedBuild } from "./build-canonicalize.js";
import { canonicalizeBuildFile } from "../cli/canonicalize-build.js";

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

function makeRawBuild(overrides = {}) {
  return {
    url: "https://darktide.gameslantern.com/builds/example",
    title: "Fixture",
    author: "tester",
    class: "psyker",
    weapons: [
      {
        name: "chainsword_p1_m1",
        rarity: "Transcendant",
        perks: ["20-25% Damage (Carapace)"],
        blessings: [{ name: "Blazing Spirit", description: "Ignite on soulblaze crit" }],
      },
      {
        name: "bot_lasgun_killshot",
        rarity: "Transcendant",
        perks: [],
        blessings: [],
      },
    ],
    curios: [
      {
        name: "Blessed Bullet",
        rarity: "Transcendant",
        perks: ["+4-5% Toughness"],
        blessings: [],
      },
    ],
    talents: {
      active: [
        { slug: "venting-shriek", frame: "hex_frame", name: "Venting Shriek", tier: "ability" },
        { slug: "brain-rupture", frame: "hex_frame", name: "Brain Rupture", tier: "ability" },
        { slug: "psykinetics-aura", frame: "square_frame", name: "Psykinetic's Aura", tier: "notable" },
        { slug: "warp-siphon", frame: "circular_frame", name: "Warp Siphon", tier: "keystone" },
        { slug: "warp-rider", frame: "circular_frame", name: "Warp Rider", tier: "talent" },
      ],
      inactive: [],
    },
    class_selections: null,
    description: "Long prose that must not survive canonicalization.",
    ...overrides,
  };
}

function makeRuntimeRawBuild(overrides = {}) {
  return {
    source_kind: "darktide_runtime_equipped",
    dumped_at: "2026-04-22T12:00:00Z",
    url: "darktide://runtime/equipped",
    title: "Severa equipped build",
    author: "Severa",
    class: "psyker",
    weapons: [
      {
        slot: "melee",
        runtime_slot: "slot_primary",
        gear_id: "gear-melee-1",
        master_item_id: "content/items/weapons/player/melee/chainsword_p1_m1",
        name: "chainsword_p1_m1",
        display_name: "Tigrus Mk II Heavy Eviscerator",
        perks: ["20-25% Damage (Carapace)"],
        blessings: [
          {
            id: "content/items/traits/weapon_traits/blazing_spirit",
            name: "Blazing Spirit",
            description: "Ignite on soulblaze crit",
          },
        ],
      },
      {
        slot: "ranged",
        runtime_slot: "slot_secondary",
        gear_id: "gear-ranged-1",
        master_item_id: "content/items/weapons/player/ranged/bot_lasgun_killshot",
        name: "bot_lasgun_killshot",
        display_name: "Accatran Mk VId Recon Lasgun",
        perks: [],
        blessings: [],
      },
    ],
    curios: [
      {
        runtime_slot: "slot_attachment_1",
        gear_id: "gear-curio-1",
        master_item_id: "content/items/gadgets/blessed_bullet_caged",
        name: "Blessed Bullet (Caged)",
        perks: ["+4-5% Toughness"],
      },
    ],
    talents: {
      active: [
        { widget_name: "node-ability", talent_id: "psyker_shout_vent_warp_charge", node_type: "ability", points_spent: 1, name: "Venting Shriek" },
        { widget_name: "node-blitz", talent_id: "psyker_smite_target", node_type: "blitz", points_spent: 1, name: "Brain Rupture" },
        { widget_name: "node-aura", talent_id: "psyker_aura_crit_chance_aura", node_type: "aura", points_spent: 1, name: "Psykinetic's Aura" },
        { widget_name: "node-keystone", talent_id: "psyker_passive_souls_from_elite_kills", node_type: "keystone", points_spent: 1, name: "Warp Siphon" },
        { widget_name: "node-talent", talent_id: "psyker_damage_based_on_warp_charge", node_type: "default", points_spent: 1, name: "Warp Rider" },
      ],
      inactive: [],
    },
    class_selections: {
      ability: "Venting Shriek",
      blitz: "Brain Rupture",
      aura: "Psykinetic's Aura",
      keystone: "Warp Siphon",
    },
    ...overrides,
  };
}

function makeStubCanonicalizerDeps(overrides = {}) {
  const resolvedIds = new Map([
    ["psyker", "shared.class.psyker"],
    ["veteran", "shared.class.veteran"],
    ["chainsword_p1_m1", "shared.weapon.chainsword_p1_m1"],
    ["bot_lasgun_killshot", "shared.weapon.bot_lasgun_killshot"],
    ["20-25% Damage (Carapace)", "shared.weapon_perk.melee.weapon_trait_melee_common_wield_increased_carapace_damage"],
    ["+4-5% Toughness", "shared.gadget_trait.gadget_toughness_increase"],
    ["Blazing Spirit", "shared.name_family.blessing.blazing_spirit"],
    ["Voice of Command", "veteran.ability.veteran_combat_ability_shout"],
    ["Duty and Honour", "veteran.keystone.veteran_tactical_aid"],
    ["Survivalist", "veteran.aura.veteran_improved_survivalist"],
    ["Warp Rider", "psyker.talent.psyker_damage_based_on_warp_charge"],
    ["Scrier's Gaze", "psyker.ability.psyker_gun"],
    ["Brain Rupture", "psyker.blitz.psyker_smite_target"],
    ["Psykinetic's Aura", "psyker.aura.quell_on_elite_kill_aura"],
    ["Warp Siphon", "psyker.keystone.psyker_overcharge_stance"],
  ]);

  return {
    resolveQuery: async (query) => {
      if (!resolvedIds.has(query)) {
        return {
          resolution_state: "unresolved",
          resolved_entity_id: null,
        };
      }

      return {
        resolution_state: "resolved",
        resolved_entity_id: resolvedIds.get(query),
      };
    },
    classifyKnownUnresolved: (text) => (
      text === "Blessed Bullet"
        ? { text, status: "known_display_only" }
        : null
    ),
    classificationRegistry: {
      psyker: {
        "venting-shriek": { slot: "ability", kind: "ability" },
        "brain-rupture": { slot: "blitz", kind: "blitz" },
        "psykinetics-aura": { slot: "aura", kind: "aura" },
        "warp-siphon": { slot: "keystone", kind: "keystone" },
        "warp-rider": { slot: "talent", kind: "talent" },
      },
    },
    scrapedAt: "2026-03-13T12:00:00Z",
    ...overrides,
  };
}

function isSelectionObject(value) {
  return value != null
    && typeof value === "object"
    && typeof value.raw_label === "string"
    && typeof value.resolution_status === "string"
    && Object.hasOwn(value, "canonical_entity_id");
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

describe("canonicalizeScrapedBuild", () => {
  it("transforms a scrape-shaped build into canonical build JSON", async () => {
    const build = await canonicalizeScrapedBuild(
      makeRawBuild(),
      makeStubCanonicalizerDeps(),
    );

    assert.equal(build.schema_version, 1);
    assert.equal(build.class.raw_label, "psyker");
    assert.equal(build.class.canonical_entity_id, "shared.class.psyker");
    assert.equal(build.ability.raw_label, "Venting Shriek");
    assert.equal(build.blitz.raw_label, "Brain Rupture");
    assert.equal(build.aura.raw_label, "Psykinetic's Aura");
    assert.equal(build.keystone?.raw_label, "Warp Siphon");
    assert.equal(build.talents.length, 1);
    assert.equal(build.talents[0].raw_label, "Warp Rider");
    assert.equal(build.weapons[0].slot, "melee");
    assert.equal(
      build.weapons[0].blessings[0].canonical_entity_id,
      "shared.name_family.blessing.blazing_spirit",
    );
    assert.deepEqual(build.weapons[0].perks[0].value, {
      min: 0.2,
      max: 0.25,
      unit: "percent",
    });
    assert.equal(build.curios[0].name.resolution_status, "non_canonical");
    assert.equal(build.provenance.source_kind, "gameslantern");
    assert.equal("description" in build, false);
    assert.equal(validateCanonicalBuild(build).ok, true);
  });

  it("routes selected class-side nodes by registry-defined slot role", async () => {
    const build = await canonicalizeScrapedBuild(
      makeRawBuild({
        talents: {
          active: [
            { slug: "venting-shriek", frame: "hex_frame", name: "Venting Shriek", tier: "ability" },
            { slug: "brain-rupture", frame: "hex_frame", name: "Brain Rupture", tier: "ability" },
            { slug: "psykinetics-aura", frame: "square_frame", name: "Psykinetic's Aura", tier: "notable" },
            { slug: "warp-rider", frame: "circular_frame", name: "Warp Rider", tier: "talent" },
          ],
          inactive: [],
        },
      }),
      makeStubCanonicalizerDeps(),
    );

    assert.equal(build.ability.raw_label, "Venting Shriek");
    assert.equal(build.blitz.raw_label, "Brain Rupture");
    assert.equal(build.aura.raw_label, "Psykinetic's Aura");
    assert.equal(build.keystone, null);
    assert.deepEqual(
      build.talents.map((selection) => selection.raw_label),
      ["Warp Rider"],
    );
  });

  it("fills missing class-side slots from summary prose when the talent scrape is empty", async () => {
    const build = await canonicalizeScrapedBuild(
      makeRawBuild({
        class: "veteran",
        talents: {
          active: [],
          inactive: [],
        },
        description: "Team support through CC and coherency buffs. Voice of Command + Duty and Honour keystone with Survivalist aura.",
      }),
      makeStubCanonicalizerDeps(),
    );

    assert.equal(build.class.canonical_entity_id, "shared.class.veteran");
    assert.equal(build.ability.raw_label, "Voice of Command");
    assert.equal(build.ability.canonical_entity_id, "veteran.ability.veteran_combat_ability_shout");
    assert.equal(build.aura.raw_label, "Survivalist");
    assert.equal(build.aura.canonical_entity_id, "veteran.aura.veteran_improved_survivalist");
    assert.equal(build.keystone?.raw_label, "Duty and Honour");
    assert.equal(build.keystone?.canonical_entity_id, "veteran.keystone.veteran_tactical_aid");
    assert.equal(build.blitz.raw_label, "Unknown blitz");
    assert.equal(build.blitz.resolution_status, "unresolved");
  });

  it("fills missing class-side slots from explicit description markers", async () => {
    const build = await canonicalizeScrapedBuild(
      makeRawBuild({
        talents: {
          active: [],
          inactive: [],
        },
        description: "ABILITY: Scrier's Gaze. BLITZ: Brain Rupture. TEAM AURA: Psykinetic's Aura. KEYSTONE: Warp Siphon.",
      }),
      makeStubCanonicalizerDeps(),
    );

    assert.equal(build.ability.raw_label, "Scrier's Gaze");
    assert.equal(build.ability.canonical_entity_id, "psyker.ability.psyker_gun");
    assert.equal(build.blitz.raw_label, "Brain Rupture");
    assert.equal(build.blitz.canonical_entity_id, "psyker.blitz.psyker_smite_target");
    assert.equal(build.aura.raw_label, "Psykinetic's Aura");
    assert.equal(build.aura.canonical_entity_id, "psyker.aura.quell_on_elite_kill_aura");
    assert.equal(build.keystone?.raw_label, "Warp Siphon");
    assert.equal(build.keystone?.canonical_entity_id, "psyker.keystone.psyker_overcharge_stance");
  });

  it("parses multiline Games Lantern description headings without swallowing body prose", async () => {
    const build = await canonicalizeScrapedBuild(
      makeRawBuild({
        class: "veteran",
        talents: {
          active: [],
          inactive: [],
        },
        description: [
          "-----",
          "BLITZ: Shredder Frag Grenade",
          "-----",
          "",
          "This blitz is used less for dealing damage and more as crowd control.",
          "",
          "-----",
          "ABILITY: Voice of Command",
          "-----",
          "",
          "The core defining ability of this Veteran build.",
          "",
          "-----",
          "KEYSTONE: Focus Target!",
          "-----",
          "",
          "An amazing keystone that alters the Veteran's default tag function.",
          "",
          "TEAM AURA: Survivalist -> Fire Team",
        ].join("\n"),
      }),
      makeStubCanonicalizerDeps({
        resolveQuery: async (query) => {
          const resolvedIds = new Map([
            ["veteran", "shared.class.veteran"],
            ["Voice of Command", "veteran.ability.veteran_combat_ability_shout"],
            ["Shredder Frag Grenade", "veteran.blitz.veteran_frag_grenade"],
            ["Survivalist", "veteran.aura.veteran_improved_survivalist"],
            ["Focus Target!", "veteran.keystone.veteran_improved_tag"],
          ]);
          return resolvedIds.has(query)
            ? {
              resolution_state: "resolved",
              resolved_entity_id: resolvedIds.get(query),
            }
            : {
              resolution_state: "unresolved",
              resolved_entity_id: null,
            };
        },
      }),
    );

    assert.equal(build.ability.canonical_entity_id, "veteran.ability.veteran_combat_ability_shout");
    assert.equal(build.blitz.canonical_entity_id, "veteran.blitz.veteran_frag_grenade");
    assert.equal(build.aura.canonical_entity_id, "veteran.aura.veteran_improved_survivalist");
    assert.equal(build.keystone?.canonical_entity_id, "veteran.keystone.veteran_improved_tag");
  });

  it("prefers explicit scraped class-side selections over prose fallback", async () => {
    const build = await canonicalizeScrapedBuild(
      makeRawBuild({
        class: "veteran",
        talents: {
          active: [],
          inactive: [],
        },
        class_selections: {
          ability: "Voice of Command",
          blitz: "Frag Grenade",
          aura: "Survivalist",
          keystone: "Duty and Honour",
        },
        description: "ABILITY: Wrong Ability. BLITZ: Wrong Blitz. TEAM AURA: Wrong Aura. KEYSTONE: Wrong Keystone.",
      }),
      makeStubCanonicalizerDeps({
        resolveQuery: async (query) => {
          const resolvedIds = new Map([
            ["veteran", "shared.class.veteran"],
            ["Voice of Command", "veteran.ability.veteran_combat_ability_shout"],
            ["Frag Grenade", "veteran.blitz.veteran_frag_grenade"],
            ["Survivalist", "veteran.aura.veteran_improved_survivalist"],
            ["Duty and Honour", "veteran.keystone.veteran_tactical_aid"],
          ]);
          return resolvedIds.has(query)
            ? {
              resolution_state: "resolved",
              resolved_entity_id: resolvedIds.get(query),
            }
            : {
              resolution_state: "unresolved",
              resolved_entity_id: null,
            };
        },
      }),
    );

    assert.equal(build.ability.raw_label, "Voice of Command");
    assert.equal(build.blitz.raw_label, "Frag Grenade");
    assert.equal(build.aura.raw_label, "Survivalist");
    assert.equal(build.keystone?.raw_label, "Duty and Honour");
  });

  it("canonicalizes runtime build dumps with explicit class-side selections and preserved provenance", async () => {
    const build = await canonicalizeScrapedBuild(
      makeRuntimeRawBuild(),
      makeStubCanonicalizerDeps(),
    );

    assert.equal(build.provenance.source_kind, "darktide_runtime_equipped");
    assert.equal(build.provenance.source_url, "darktide://runtime/equipped");
    assert.equal(build.provenance.scraped_at, "2026-04-22T12:00:00Z");
    assert.equal(build.ability.raw_label, "Venting Shriek");
    assert.equal(build.blitz.raw_label, "Brain Rupture");
    assert.equal(build.aura.raw_label, "Psykinetic's Aura");
    assert.equal(build.keystone?.raw_label, "Warp Siphon");
    assert.deepEqual(
      build.talents.map((selection) => selection.raw_label),
      ["Warp Rider"],
    );
    assert.equal(build.weapons[0].slot, "melee");
    assert.equal(build.weapons[1].slot, "ranged");
    assert.equal(build.curios[0].name.raw_label, "Blessed Bullet (Caged)");
    assert.equal(validateCanonicalBuild(build).ok, true);
  });

  it("falls back to explicit scraped class-side selections when class registry coverage is absent", async () => {
    const build = await canonicalizeScrapedBuild(
      makeRawBuild({
        class: "veteran",
        talents: {
          active: [
            { slug: "voice-of-command", frame: "hex_frame", name: "Voice Of Command", tier: "ability" },
            { slug: "shredder-frag-grenade", frame: "square_frame", name: "Shredder Frag Grenade", tier: "notable" },
            { slug: "survivalist", frame: "circular_frame", name: "Survivalist", tier: "talent" },
            { slug: "focus-target", frame: "circular_frame", name: "Focus Target", tier: "keystone" },
            { slug: "exploit-weakness", frame: "circular_frame", name: "Exploit Weakness", tier: "talent" },
          ],
          inactive: [],
        },
        class_selections: {
          ability: "Voice of Command",
          blitz: "Shredder Frag Grenade",
          aura: "Survivalist",
          keystone: "Focus Target!",
        },
      }),
      makeStubCanonicalizerDeps({
        resolveQuery: async (query) => {
          const resolvedIds = new Map([
            ["veteran", "shared.class.veteran"],
            ["Voice of Command", "veteran.ability.veteran_combat_ability_shout"],
            ["Shredder Frag Grenade", "veteran.blitz.veteran_frag_grenade"],
            ["Survivalist", "veteran.aura.veteran_improved_survivalist"],
            ["Focus Target!", "veteran.keystone.veteran_improved_tag"],
            ["Focus Target", "veteran.keystone.veteran_improved_tag"],
          ]);
          return resolvedIds.has(query)
            ? {
              resolution_state: "resolved",
              resolved_entity_id: resolvedIds.get(query),
            }
            : {
              resolution_state: "unresolved",
              resolved_entity_id: null,
            };
        },
        classificationRegistry: {
          psyker: makeStubCanonicalizerDeps().classificationRegistry.psyker,
          veteran: {},
        },
      }),
    );

    assert.equal(build.ability.canonical_entity_id, "veteran.ability.veteran_combat_ability_shout");
    assert.equal(build.blitz.canonical_entity_id, "veteran.blitz.veteran_frag_grenade");
    assert.equal(build.aura.canonical_entity_id, "veteran.aura.veteran_improved_survivalist");
    assert.equal(build.keystone?.canonical_entity_id, "veteran.keystone.veteran_improved_tag");
    assert.deepEqual(build.talents, [
      {
        raw_label: "Exploit Weakness",
        canonical_entity_id: null,
        resolution_status: "unresolved",
      },
    ]);
  });

  it("preserves unclassified nodes as talents when explicit class selections exist but registry coverage is partial", async () => {
    const build = await canonicalizeScrapedBuild(
      makeRawBuild({
        class: "veteran",
        talents: {
          active: [
            { slug: "voice-of-command", frame: "hex_frame", name: "Voice Of Command", tier: "ability" },
            { slug: "shredder-frag-grenade", frame: "square_frame", name: "Shredder Frag Grenade", tier: "notable" },
            { slug: "survivalist", frame: "circular_frame", name: "Survivalist", tier: "talent" },
            { slug: "focus-target", frame: "circular_frame", name: "Focus Target", tier: "keystone" },
            { slug: "demolition-team", frame: "circular_frame", name: "Demolition Team", tier: "talent" },
          ],
          inactive: [],
        },
        class_selections: {
          ability: "Voice of Command",
          blitz: "Shredder Frag Grenade",
          aura: "Survivalist",
          keystone: "Focus Target!",
        },
      }),
      makeStubCanonicalizerDeps({
        resolveQuery: async (query) => {
          const resolvedIds = new Map([
            ["veteran", "shared.class.veteran"],
            ["Voice of Command", "veteran.ability.veteran_combat_ability_shout"],
            ["Shredder Frag Grenade", "veteran.blitz.veteran_frag_grenade"],
            ["Survivalist", "veteran.aura.veteran_improved_survivalist"],
            ["Focus Target!", "veteran.keystone.veteran_improved_tag"],
            ["Focus Target", "veteran.keystone.veteran_improved_tag"],
          ]);
          return resolvedIds.has(query)
            ? {
              resolution_state: "resolved",
              resolved_entity_id: resolvedIds.get(query),
            }
            : {
              resolution_state: "unresolved",
              resolved_entity_id: null,
            };
        },
        classificationRegistry: {
          psyker: makeStubCanonicalizerDeps().classificationRegistry.psyker,
          veteran: {
            "voice-of-command": { slot: "ability", kind: "ability" },
            "shredder-frag-grenade": { slot: "blitz", kind: "blitz" },
            "survivalist": { slot: "aura", kind: "aura" },
            "focus-target": { slot: "keystone", kind: "keystone" },
          },
        },
      }),
    );

    assert.equal(build.ability.raw_label, "Voice of Command");
    assert.equal(build.blitz.raw_label, "Shredder Frag Grenade");
    assert.equal(build.aura.raw_label, "Survivalist");
    assert.equal(build.keystone?.raw_label, "Focus Target!");
    assert.deepEqual(build.talents, [
      {
        raw_label: "Demolition Team",
        canonical_entity_id: null,
        resolution_status: "unresolved",
      },
    ]);
  });

  it("preserves unclassified nodes as talents when description fallback exists but registry coverage is partial", async () => {
    const build = await canonicalizeScrapedBuild(
      makeRawBuild({
        class: "veteran",
        talents: {
          active: [
            { slug: "voice-of-command", frame: "hex_frame", name: "Voice of Command", tier: "ability" },
            { slug: "shredder-frag-grenade", frame: "square_frame", name: "Shredder Frag Grenade", tier: "notable" },
            { slug: "survivalist", frame: "circular_frame", name: "Survivalist", tier: "talent" },
            { slug: "focus-target", frame: "circular_frame", name: "Focus Target", tier: "keystone" },
            { slug: "demolition-team", frame: "circular_frame", name: "Demolition Team", tier: "talent" },
          ],
          inactive: [],
        },
        class_selections: null,
        description: [
          "-----",
          "BLITZ: Shredder Frag Grenade",
          "-----",
          "-----",
          "ABILITY: Voice of Command",
          "-----",
          "-----",
          "KEYSTONE: Focus Target!",
          "-----",
          "TEAM AURA: Survivalist -> Fire Team",
        ].join("\n"),
      }),
      makeStubCanonicalizerDeps({
        resolveQuery: async (query) => {
          const resolvedIds = new Map([
            ["veteran", "shared.class.veteran"],
            ["Voice of Command", "veteran.ability.veteran_combat_ability_shout"],
            ["Shredder Frag Grenade", "veteran.blitz.veteran_frag_grenade"],
            ["Survivalist", "veteran.aura.veteran_improved_survivalist"],
            ["Focus Target!", "veteran.keystone.veteran_improved_tag"],
            ["Focus Target", "veteran.keystone.veteran_improved_tag"],
          ]);
          return resolvedIds.has(query)
            ? {
              resolution_state: "resolved",
              resolved_entity_id: resolvedIds.get(query),
            }
            : {
              resolution_state: "unresolved",
              resolved_entity_id: null,
            };
        },
        classificationRegistry: {
          psyker: makeStubCanonicalizerDeps().classificationRegistry.psyker,
          veteran: {
            "voice-of-command": { slot: "ability", kind: "ability" },
            "shredder-frag-grenade": { slot: "blitz", kind: "blitz" },
            "survivalist": { slot: "aura", kind: "aura" },
            "focus-target": { slot: "keystone", kind: "keystone" },
          },
        },
      }),
    );

    assert.equal(build.ability.canonical_entity_id, "veteran.ability.veteran_combat_ability_shout");
    assert.equal(build.blitz.canonical_entity_id, "veteran.blitz.veteran_frag_grenade");
    assert.equal(build.aura.canonical_entity_id, "veteran.aura.veteran_improved_survivalist");
    assert.equal(build.keystone?.canonical_entity_id, "veteran.keystone.veteran_improved_tag");
    assert.deepEqual(build.talents, [
      {
        raw_label: "Demolition Team",
        canonical_entity_id: null,
        resolution_status: "unresolved",
      },
    ]);
  });
});

describe("canonicalizeBuildFile", () => {
  it("canonicalizes an already-scraped build JSON without Playwright", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hb-canonicalize-"));
    const inputPath = join(tempDir, "raw-build.json");
    writeFileSync(inputPath, JSON.stringify(makeRawBuild(), null, 2));

    const build = await canonicalizeBuildFile(
      inputPath,
      makeStubCanonicalizerDeps(),
    );

    assert.equal(build.title, "Fixture");
    assert.equal(build.weapons[1].name.canonical_entity_id, "shared.weapon.bot_lasgun_killshot");
    assert.equal(build.curios[0].perks[0].canonical_entity_id, "shared.gadget_trait.gadget_toughness_increase");
  });
});

describe("checked-in canonical fixtures", () => {
  for (const fixtureName of readdirSync("data/builds").filter((name) => name.endsWith(".json")).sort()) {
    it(`${fixtureName} validates as a canonical build fixture`, () => {
      const build = JSON.parse(readFileSync(join("data/builds", fixtureName), "utf8"));
      const validation = validateCanonicalBuild(build);
      assert.equal(validation.ok, true, validation.errors.map((error) => error.message).join("; "));

      assert.equal(isSelectionObject(build.class), true);
      assert.equal(isSelectionObject(build.ability), true);
      assert.equal(isSelectionObject(build.blitz), true);
      assert.equal(isSelectionObject(build.aura), true);
      assert.equal(build.keystone === null || isSelectionObject(build.keystone), true);
      assert.equal(Array.isArray(build.talents), true);

      for (const weapon of build.weapons) {
        assert.equal(isSelectionObject(weapon.name), true);
        for (const perk of weapon.perks) {
          assert.equal(isSelectionObject(perk), true);
        }
        for (const blessing of weapon.blessings) {
          assert.equal(isSelectionObject(blessing), true);
          if (blessing.resolution_status === "resolved") {
            assert.match(blessing.canonical_entity_id, /^shared\.name_family\.blessing\./);
          }
        }
      }

      for (const curio of build.curios) {
        assert.equal(isSelectionObject(curio.name), true);
        for (const perk of curio.perks) {
          assert.equal(isSelectionObject(perk), true);
        }
      }
    });
  }
});
