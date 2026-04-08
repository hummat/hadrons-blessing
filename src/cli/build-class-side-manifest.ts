import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runCliMain } from "../lib/cli.js";
import { buildClassSideManifest } from "../lib/class-side-manifest.js";
import { validateSourceSnapshot } from "../lib/validate.js";

await runCliMain("class-side:build", async () => {
  const snapshot = validateSourceSnapshot();
  const manifest = buildClassSideManifest(snapshot.source_root);
  const outFile = resolve("data/ground-truth/generated/class-tree-manifest.json");
  writeFileSync(outFile, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Wrote ${manifest.length} class-side manifest entries to ${outFile}`);
});
