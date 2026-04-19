import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

describe("hover card integration contract", () => {
  it("keeps the primitive self-contained and fact-driven", () => {
    const component = read("lib/HoverCard.svelte");

    assert.match(component, /<details\b/);
    assert.match(component, /card\.summary/);
    assert.match(component, /card\.facts/);
    assert.match(component, /card\.sourceLabel/);
  });

  it("uses the hover-card adapter on the build detail score strip", () => {
    const detail = read("routes/builds/[slug]/+page.svelte");

    assert.match(detail, /import HoverCard from "\$lib\/HoverCard\.svelte"/);
    assert.match(detail, /buildPhaseAScoreHoverCards/);
    assert.match(detail, /<HoverCard \{card\} \/>/);
    assert.doesNotMatch(detail, /card\.explanation/);
  });
});
