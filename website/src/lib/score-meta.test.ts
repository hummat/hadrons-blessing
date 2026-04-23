import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreAxisMeta } from "./score-meta.ts";

describe("scoreAxisMeta", () => {
  it("uses the eight-dimension scale when survivability is present", () => {
    assert.deepEqual(scoreAxisMeta({ survivability: 3 }), {
      hasSurvivabilityAxis: true,
      compositeMax: 40,
      dimensionCount: 8,
    });
  });

  it("falls back to the legacy seven-dimension scale when survivability is absent", () => {
    assert.deepEqual(scoreAxisMeta({ survivability: null }), {
      hasSurvivabilityAxis: false,
      compositeMax: 35,
      dimensionCount: 7,
    });
  });
});
