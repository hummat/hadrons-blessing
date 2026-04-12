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
  it("maps high scores to semantic high-score class", () => {
    assert.equal(scoreColor(5), "score-value score-value--high");
  });

  it("maps null scores to semantic muted class", () => {
    assert.equal(scoreColor(null), "score-value score-value--null");
  });
});

describe("htkCellClass", () => {
  it("marks 1 HTK as best semantic class", () => {
    assert.equal(htkCellClass(1), "htk-cell htk-cell--best");
  });

  it("marks 2 HTK as mid semantic class", () => {
    assert.equal(htkCellClass(2), "htk-cell htk-cell--mid");
  });

  it("marks 3+ HTK as worst semantic class", () => {
    assert.equal(htkCellClass(4), "htk-cell htk-cell--worst");
  });

  it("marks unknown HTK as null semantic class", () => {
    assert.equal(htkCellClass(null), "htk-cell htk-cell--null");
  });
});
