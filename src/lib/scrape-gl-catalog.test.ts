import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  parseBlessingRows,
  parseWeaponClasses,
  parsePerkRows,
  parseBlessingDetailPage,
  extractUrlSlug,
} from "../cli/scrape-gl-catalog.js";

describe("parseBlessingRows", () => {
  it("parses a single blessing row correctly", () => {
    const rows = [
      ["Bloodthirsty", "On kill: gain stacks.", "Assault Chainsword\nBoltgun"],
    ];
    const result = parseBlessingRows(rows);
    assert.equal(result.length, 1);
    assert.equal(result[0].display_name, "Bloodthirsty");
    assert.equal(result[0].effect, "On kill: gain stacks.");
    assert.deepEqual(result[0].weapon_types, ["Assault Chainsword", "Boltgun"]);
  });

  it("parses multiple rows with the same blessing name", () => {
    const rows = [
      ["Slaughterer", "On kill: +2% power for 5s.", "Chainsword\nForce Sword"],
      ["Slaughterer", "On kill: +2% power for 5s.", "Combat Axe"],
    ];
    const result = parseBlessingRows(rows);
    assert.equal(result.length, 2);
    assert.equal(result[0].display_name, "Slaughterer");
    assert.equal(result[1].display_name, "Slaughterer");
    assert.deepEqual(result[0].weapon_types, ["Chainsword", "Force Sword"]);
    assert.deepEqual(result[1].weapon_types, ["Combat Axe"]);
  });

  it("skips rows with empty name", () => {
    const rows = [
      ["", "Some effect.", "Weapon A"],
      ["ValidBlessing", "Real effect.", "Weapon B"],
    ];
    const result = parseBlessingRows(rows);
    assert.equal(result.length, 1);
    assert.equal(result[0].display_name, "ValidBlessing");
  });

  it("skips rows with empty effect", () => {
    const rows = [
      ["BlessingWithNoEffect", "", "Weapon A"],
      ["GoodBlessing", "Has effect.", "Weapon B"],
    ];
    const result = parseBlessingRows(rows);
    assert.equal(result.length, 1);
    assert.equal(result[0].display_name, "GoodBlessing");
  });

  it("skips rows with both name and effect empty", () => {
    const rows = [
      ["", "", ""],
      ["RealBlessing", "Real effect.", "Weapon Type"],
    ];
    const result = parseBlessingRows(rows);
    assert.equal(result.length, 1);
  });

  it("returns empty array for all-empty input", () => {
    assert.deepEqual(parseBlessingRows([]), []);
  });

  it("splits weapon types on newlines", () => {
    const rows = [
      ["Thrust", "Extra damage.", "Chainsword\nForce Sword\nCombat Axe"],
    ];
    const result = parseBlessingRows(rows);
    assert.deepEqual(result[0].weapon_types, ["Chainsword", "Force Sword", "Combat Axe"]);
  });

  it("handles weapon types with no newlines (single type)", () => {
    const rows = [["Thrust", "Extra damage.", "Chainsword"]];
    const result = parseBlessingRows(rows);
    assert.deepEqual(result[0].weapon_types, ["Chainsword"]);
  });

  it("handles empty weapon_types string", () => {
    const rows = [["Thrust", "Extra damage.", ""]];
    const result = parseBlessingRows(rows);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].weapon_types, [""]);
  });
});

describe("parsePerkRows", () => {
  it("parses perk label and slot from the GL perk table", () => {
    const rows = [
      ["4-10% Ranged Weak Spot Damage", "Ranged"],
      ["4-10% Melee Weak Spot Damage", "Melee"],
    ];

    assert.deepEqual(parsePerkRows(rows), [
      {
        display_name: "4-10% Ranged Weak Spot Damage",
        slot: "ranged",
        source_url: "https://darktide.gameslantern.com/weapon-perks",
      },
      {
        display_name: "4-10% Melee Weak Spot Damage",
        slot: "melee",
        source_url: "https://darktide.gameslantern.com/weapon-perks",
      },
    ]);
  });
});

describe("parseBlessingDetailPage", () => {
  it("extracts blessing name and effect text from the detail page body", () => {
    const html = `
      <h3>Overwhelming Fire</h3>
      <p>+10% Strength for every 4 Single Target Hits. Lasts 2s and Stacks 5 times.</p>
    `;

    assert.deepEqual(parseBlessingDetailPage(html, "https://darktide.gameslantern.com/blessings/overwhelming-fire"), {
      display_name: "Overwhelming Fire",
      effect: "+10% Strength for every 4 Single Target Hits. Lasts 2s and Stacks 5 times.",
      source_url: "https://darktide.gameslantern.com/blessings/overwhelming-fire",
    });
  });
});

describe("parseWeaponClasses", () => {
  it("strips url and keeps name and unlock_level", () => {
    const classes = [
      { name: "Veteran", url: "https://darktide.gameslantern.com/classes/veteran", unlock_level: 1 },
      { name: "Zealot", url: "https://darktide.gameslantern.com/classes/zealot", unlock_level: 3 },
    ];
    const result = parseWeaponClasses(classes);
    assert.equal(result.length, 2);
    assert.deepEqual(result[0], { name: "Veteran", unlock_level: 1 });
    assert.deepEqual(result[1], { name: "Zealot", unlock_level: 3 });
  });

  it("does not include url in output", () => {
    const classes = [
      { name: "Psyker", url: "https://example.com/psyker", unlock_level: 5 },
    ];
    const result = parseWeaponClasses(classes);
    assert.equal("url" in result[0], false);
  });

  it("returns empty array for empty input", () => {
    assert.deepEqual(parseWeaponClasses([]), []);
  });

  it("preserves unlock_level of 0", () => {
    const classes = [{ name: "Ogryn", url: "https://example.com/ogryn", unlock_level: 0 }];
    const result = parseWeaponClasses(classes);
    assert.equal(result[0].unlock_level, 0);
  });
});

describe("extractUrlSlug", () => {
  it("extracts the weapon type slug (2nd path segment)", () => {
    const url = "https://darktide.gameslantern.com/weapons/braced-autogun/agripinaa-mk-viii-braced-autogun";
    assert.equal(extractUrlSlug(url), "braced-autogun");
  });

  it("works for different weapon types", () => {
    assert.equal(
      extractUrlSlug("https://darktide.gameslantern.com/weapons/combat-knife/catachan-mk-iii-combat-knife"),
      "combat-knife",
    );
  });

  it("works with trailing slash", () => {
    const url = "https://darktide.gameslantern.com/weapons/bolter/some-bolter/";
    assert.equal(extractUrlSlug(url), "bolter");
  });

  it("returns empty string for url with no weapon slug", () => {
    const url = "https://darktide.gameslantern.com/weapons/";
    assert.equal(extractUrlSlug(url), "");
  });

  it("handles url with only one path segment after /weapons/", () => {
    const url = "https://darktide.gameslantern.com/weapons/bolter";
    assert.equal(extractUrlSlug(url), "bolter");
  });
});
