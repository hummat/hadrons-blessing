import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

describe("website theme contract (dark tactical dossier)", () => {
  it("defines semantic shell, panel, and tactical surface classes in app.css", () => {
    const css = read("app.css");
    assert.match(css, /:root\s*\{[\s\S]*--hb-bg-canvas:/);
    assert.match(css, /\.site-shell\b/);
    assert.match(css, /\.site-header\b/);
    assert.match(css, /\.panel\b/);
    assert.match(css, /\.panel-strong\b/);
    assert.match(css, /\.panel-muted\b/);
    assert.match(css, /\.form-control\b/);
    assert.match(css, /\.disclosure\b/);
    // Dark tactical vocabulary
    assert.match(css, /\.hb-atmo\b/);
    assert.match(css, /\.hb-hero\b/);
    assert.match(css, /\.hb-dim-tile\b/);
    assert.match(css, /\.hover-card\b/);
    assert.match(css, /\.hb-ledger\b/);
    assert.match(css, /\.hb-cogitator\b/);
    assert.match(css, /--hb-amber:/);
  });

  it("routes consume dark tactical vocabulary", () => {
    const layout = read("routes/+layout.svelte");
    const list = read("routes/+page.svelte");
    const detail = read("routes/builds/[slug]/+page.svelte");
    const compare = read("routes/compare/+page.svelte");

    // Layout exposes the tactical shell
    assert.match(layout, /site-shell/);
    assert.match(layout, /site-header/);
    assert.match(layout, /hb-atmo/);

    // Index uses ledger + query-bar vocabulary
    assert.match(list, /hb-ledger/);
    assert.match(list, /hb-query-bar/);
    assert.match(list, /hb-compare-tray/);

    // Detail page renders hero, dimension strip, hover cards, cogitator
    assert.match(detail, /hb-hero/);
    assert.match(detail, /hb-dim-strip/);
    assert.match(detail, /HoverCard/);
    assert.match(detail, /hb-cogitator/);

    // Compare page still consumes the shared semantic panels
    assert.match(compare, /panel-strong/);
    assert.match(compare, /hb-tab-bar/);

    // No parchment vocabulary leaks
    assert.ok(!list.includes("ds-parchment"), "index should not reference parchment classes");
    assert.ok(!detail.includes("ds-parchment"), "detail should not reference parchment classes");
    assert.ok(!compare.includes("ds-parchment"), "compare should not reference parchment classes");
  });

  it("breakpoint matrix badges are inside td cells, not styled on td itself", () => {
    const detail = read("routes/builds/[slug]/+page.svelte");
    assert.match(detail, /<span class="hb-htk /);
    assert.doesNotMatch(detail, /<td class="[^"]*htk/);
  });
});
