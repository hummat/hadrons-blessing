import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { classifyKnownUnresolved } from "./non-canonical.js";

describe("classifyKnownUnresolved", () => {
  it("matches runtime curio variant suffixes to the known ambiguous base label", () => {
    const record = classifyKnownUnresolved("Blessed Bullet (Reliquary)", {
      kind: "gadget_item",
      class: "psyker",
      slot: "curio",
    });

    assert.ok(record);
    assert.equal(record.text, "Blessed Bullet");
  });
});
