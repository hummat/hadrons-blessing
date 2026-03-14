import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { postProcessTalentNodes, slugToName } from "./extract-build.mjs";

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
