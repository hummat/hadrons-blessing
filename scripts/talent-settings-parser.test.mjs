import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { parseTalentSettings, loadAllTalentSettings } from "./ground-truth/lib/talent-settings-parser.mjs";

describe("parseTalentSettings", () => {
  it("parses flat numeric constants and returns dotted-path map", () => {
    const lua = `
local talent_settings = {
  psyker = {
    glass_cannon = {
      toughness_multiplier = 0.7,
      warp_charge = 0.6,
    },
  },
}
return talent_settings
`;
    const map = parseTalentSettings(lua);
    assert.equal(map.get("psyker.glass_cannon.toughness_multiplier"), 0.7);
    assert.equal(map.get("psyker.glass_cannon.warp_charge"), 0.6);
  });

  it("parses multiple namespace roots from a single file", () => {
    const lua = `
local talent_settings = {
  psyker = {
    foo = { val = 1 },
  },
  psyker_2 = {
    bar = { val = 2 },
  },
  psyker_3 = {
    baz = { val = 3 },
  },
}
return talent_settings
`;
    const map = parseTalentSettings(lua);
    assert.equal(map.get("psyker.foo.val"), 1);
    assert.equal(map.get("psyker_2.bar.val"), 2);
    assert.equal(map.get("psyker_3.baz.val"), 3);
  });

  it("handles negative values", () => {
    const lua = `
local talent_settings = {
  vet = {
    stance = { modifier = -0.15 },
  },
}
return talent_settings
`;
    const map = parseTalentSettings(lua);
    assert.equal(map.get("vet.stance.modifier"), -0.15);
  });

  it("recurses into nested tables but ignores non-numeric leaves", () => {
    const lua = `
local talent_settings = {
  psyker = {
    mixed = {
      val = 1.5,
      name = "test",
      nested = { inner = 2 },
    },
  },
}
return talent_settings
`;
    const map = parseTalentSettings(lua);
    assert.equal(map.get("psyker.mixed.val"), 1.5);
    assert.equal(map.get("psyker.mixed.nested.inner"), 2);
    assert.equal(map.has("psyker.mixed.name"), false);
  });
});

const sourceRoot = process.env.GROUND_TRUTH_SOURCE_ROOT;

describe("loadAllTalentSettings (live)", () => {
  it("loads all TalentSettings files and resolves known paths", { skip: !sourceRoot }, async () => {
    const map = await loadAllTalentSettings(sourceRoot);
    assert.ok(map.size > 500, `Expected >500 entries, got ${map.size}`);
    assert.equal(map.get("psyker_2.passive_1.on_hit_proc_chance"), 1);
  });
});
