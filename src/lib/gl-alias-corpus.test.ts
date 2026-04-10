import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildGlAliasCorpus } from "./gl-alias-corpus.js";

describe("buildGlAliasCorpus", () => {
  it("normalizes weapon, perk, blessing, and talent inputs into one corpus shape", () => {
    const corpus = buildGlAliasCorpus({
      weapons: [
        {
          display_name: "Agripinaa Mk VIII Braced Autogun",
          url_slug: "braced-autogun",
          source_url: "weapon-url",
        },
      ],
      perks: [
        {
          display_name: "4-10% Ranged Weak Spot Damage",
          slot: "ranged",
          source_url: "perk-url",
        },
      ],
      blessings: [
        {
          display_name: "Overpressure",
          effect: "Up to +5% Strength, scaling with remaining Ammunition. Stacks 5 times.",
          source_url: "blessing-url",
          weapon_types: ["Autogun"],
        },
      ],
      classTreeLabels: [
        {
          class: "veteran",
          kind: "talent",
          display_name: "Precision Strikes",
          normalized_text: "precision strikes",
          entity_id: "veteran.talent.veteran_increased_weakspot_damage",
          source_url: "tree-url",
        },
      ],
    });

    assert.equal(corpus.length, 4);
    assert.deepEqual(corpus.map((entry) => entry.domain), [
      "weapon",
      "weapon_perk",
      "weapon_trait",
      "talent",
    ]);
    assert.deepEqual(corpus[2].weapon_type_labels, ["Autogun"]);
    assert.equal(corpus[3].class, "veteran");
  });
});
