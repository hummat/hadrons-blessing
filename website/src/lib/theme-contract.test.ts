import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

describe("website theme contract", () => {
  it("defines semantic shell and panel classes in app.css", () => {
    const css = read("app.css");
    assert.match(css, /:root\s*\{[\s\S]*--hb-bg-canvas:/);
    assert.match(css, /\.site-shell\b/);
    assert.match(css, /\.panel\b/);
    assert.match(css, /\.panel-strong\b/);
    assert.match(css, /\.panel-muted\b/);
    assert.match(css, /\.form-control\b/);
    assert.match(css, /\.disclosure\b/);
  });

  it("routes consume semantic theme classes instead of raw gray slab recipes", () => {
    const layout = read("routes/+layout.svelte");
    const list = read("routes/+page.svelte");
    const detail = read("routes/builds/[slug]/+page.svelte");
    const compare = read("routes/compare/+page.svelte");

    assert.match(layout, /site-shell/);
    assert.match(layout, /site-header/);
    assert.match(list, /panel/);
    assert.match(list, /form-control/);
    assert.match(detail, /panel-strong/);
    assert.match(detail, /disclosure/);
    assert.match(compare, /panel-strong/);

    assert.ok(!list.includes("bg-gray-900/90"));
    assert.ok(!detail.includes("rounded-2xl border border-gray-800 bg-gray-900"));
    assert.ok(!compare.includes("rounded-2xl border border-gray-800 bg-gray-900 p-5"));
  });
});
