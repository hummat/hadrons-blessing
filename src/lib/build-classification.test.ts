import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { classifySelectedNodes } from "./build-classification.js";

describe("classifySelectedNodes", () => {
  it("routes veteran close-and-kill to the aura slot even when GL marks it as a talent", () => {
    const classified = classifySelectedNodes(
      [
        { slug: "infiltrate", name: "Infiltrate", tier: "ability" },
        { slug: "smoke-grenade", name: "Smoke Grenade", tier: "notable" },
        { slug: "close-and-kill", name: "Close and Kill", tier: "talent" },
        { slug: "marksmans-focus", name: "Marksman's Focus", tier: "keystone" },
        { slug: "demolition-team", name: "Demolition Team", tier: "talent" },
      ],
      {
        className: "veteran",
        preserveUnclassifiedAsTalents: true,
      },
    );

    assert.equal(classified.ability?.name, "Infiltrate");
    assert.equal(classified.blitz?.name, "Smoke Grenade");
    assert.equal(classified.aura?.name, "Close and Kill");
    assert.equal(classified.keystone?.name, "Marksman's Focus");
    assert.deepEqual(classified.talents.map((node) => node.name), ["Demolition Team"]);
  });
});
