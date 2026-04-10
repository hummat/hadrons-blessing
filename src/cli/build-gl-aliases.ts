import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runCliMain } from "../lib/cli.js";
import { ALIASES_ROOT, GENERATED_ROOT } from "../lib/load.js";
import { buildGlAliases } from "../lib/gl-alias-writer.js";
import { mergeAliases } from "./enrich-entity-names.js";
import type { GlAliasCorpusEntry } from "../lib/gl-alias-corpus.js";
import type { AliasSchemaJson } from "../generated/schema-types.js";

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function mergeAliasesIntoFile(path: string, generatedAliases: AliasSchemaJson[]): void {
  if (generatedAliases.length === 0) {
    return;
  }

  const existingAliases = existsSync(path) ? readJsonFile<AliasSchemaJson[]>(path) : [];
  const result = mergeAliases(existingAliases, generatedAliases);
  writeFileSync(path, `${JSON.stringify(result.merged, null, 2)}\n`);
  console.log(`${path}: ${result.added} added, ${result.updated} updated (${generatedAliases.length} generated)`);
}

await runCliMain("gl:aliases:build", async () => {
  const corpusPath = resolve(GENERATED_ROOT, "gl-alias-corpus.json");
  const corpus = readJsonFile<GlAliasCorpusEntry[]>(corpusPath);
  const result = await buildGlAliases({ corpus });

  mergeAliasesIntoFile(resolve(ALIASES_ROOT, "shared-guides.json"), result.sharedAliases);
  for (const [className, aliases] of result.classAliases) {
    mergeAliasesIntoFile(resolve(ALIASES_ROOT, `${className}.json`), aliases);
  }

  writeFileSync(
    resolve(GENERATED_ROOT, "gl-alias-review.json"),
    `${JSON.stringify(result.review, null, 2)}\n`,
  );
  console.log(
    `Review: ${result.review.matched.length} matched, ${result.review.required.length} required, ${result.review.unmatched.length} unmatched`,
  );
});
