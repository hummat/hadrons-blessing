import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { postProcessTalentNodes, slugToName, validateRawScrape } from "../cli/extract-build.js";

describe("slugToName", () => {
  it("keeps known special-case Games Lantern names readable", () => {
    assert.equal(slugToName("scriers-gaze"), "Scrier's Gaze");
    assert.equal(slugToName("marksmans-focus"), "Marksman's Focus");
  });
});

describe("postProcessTalentNodes", () => {
  it("preserves source hints while deriving name and tier", () => {
    const [activeTalent] = postProcessTalentNodes([
      {
        slug: "exploit-weakness",
        frame: "/images/sites/darktide/talents/frames/circular_frame.webp",
        icon: "https://gameslantern.com/storage/sites/darktide/exporter/talents/veteran/default/veteran_crits_apply_rending.webp",
      },
    ]);

    assert.deepEqual(activeTalent, {
      slug: "exploit-weakness",
      frame: "/images/sites/darktide/talents/frames/circular_frame.webp",
      icon: "https://gameslantern.com/storage/sites/darktide/exporter/talents/veteran/default/veteran_crits_apply_rending.webp",
      name: "Exploit Weakness",
      tier: "talent",
    });
  });

  it("promotes known passive keystones without dropping icon hints", () => {
    const [keystone] = postProcessTalentNodes([
      {
        slug: "focus-target",
        frame: "/images/sites/darktide/talents/frames/circular_frame.webp",
        icon: "https://gameslantern.com/storage/sites/darktide/exporter/talents/veteran/keystone/veteran_improved_tag.webp",
      },
    ]);

    assert.equal(keystone.name, "Focus Target");
    assert.equal(keystone.tier, "keystone");
    assert.match(keystone.icon, /veteran_improved_tag\.webp$/);
  });
});

describe("validateRawScrape", () => {
  it("returns empty array for complete scrape", () => {
    const raw = {
      title: "Test Build",
      class: "veteran",
      weapons: [{ name: "Weapon" }],
      talents: { active: [{ slug: "talent" }], inactive: [] },
    };
    assert.deepEqual(validateRawScrape(raw), []);
  });

  it("reports all missing fields for empty scrape", () => {
    const raw = {
      title: "",
      class: "",
      weapons: [],
      talents: { active: [], inactive: [] },
    };
    const problems = validateRawScrape(raw);
    assert.equal(problems.length, 4);
    assert.ok(problems.includes("title not found"));
    assert.ok(problems.includes("class not detected"));
    assert.ok(problems.includes("no weapons extracted"));
    assert.ok(problems.includes("no talents extracted"));
  });

  it("reports only missing fields for partial scrape", () => {
    const raw = {
      title: "Test Build",
      class: "veteran",
      weapons: [{ name: "Weapon" }],
      talents: { active: [], inactive: [] },
    };
    assert.deepEqual(validateRawScrape(raw), ["no talents extracted"]);
  });

  it("accepts inactive-only talent scrapes", () => {
    const raw = {
      title: "Test Build",
      class: "veteran",
      weapons: [{ name: "Weapon" }],
      talents: { active: [], inactive: [{ slug: "talent" }] },
    };
    assert.deepEqual(validateRawScrape(raw), []);
  });
});
