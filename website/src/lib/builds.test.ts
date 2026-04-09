import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSlugFromFile, htkCellClass, scoreColor } from "./builds.ts";

describe("buildSlugFromFile", () => {
  it("strips the .json extension from build filenames", () => {
    assert.equal(buildSlugFromFile("17-arbites-busted.json"), "17-arbites-busted");
  });

  it("leaves filenames without .json unchanged", () => {
    assert.equal(buildSlugFromFile("already-a-slug"), "already-a-slug");
  });
});

describe("scoreColor", () => {
  it("maps high scores to green", () => {
    assert.equal(scoreColor(5), "text-emerald-400");
  });

  it("maps null scores to muted gray", () => {
    assert.equal(scoreColor(null), "text-gray-600");
  });
});

describe("htkCellClass", () => {
  it("marks 1 HTK as green", () => {
    assert.equal(htkCellClass(1), "bg-emerald-950/50 text-emerald-300");
  });

  it("marks 2 HTK as yellow", () => {
    assert.equal(htkCellClass(2), "bg-yellow-950/50 text-yellow-300");
  });

  it("marks 3+ HTK as red", () => {
    assert.equal(htkCellClass(4), "bg-red-950/50 text-red-300");
  });

  it("marks unknown HTK as gray", () => {
    assert.equal(htkCellClass(null), "bg-gray-900 text-gray-500");
  });
});
