import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runCliMain } from "../lib/cli.js";
import { buildGlAliasCorpus } from "../lib/gl-alias-corpus.js";
import { GENERATED_ROOT } from "../lib/load.js";

function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) {
    return fallback;
  }

  return JSON.parse(readFileSync(path, "utf8")) as T;
}

await runCliMain("gl:corpus:build", async () => {
  const catalogPath = resolve(GENERATED_ROOT, "gl-catalog.json");
  const catalog = readJsonFile<{ weapons?: unknown[]; perks?: unknown[]; blessings?: unknown[] }>(
    catalogPath,
    {},
  );
  const weapons = readJsonFile<unknown[]>(
    resolve(GENERATED_ROOT, "gl-weapons.json"),
    catalog.weapons ?? [],
  );
  const perks = readJsonFile<unknown[]>(
    resolve(GENERATED_ROOT, "gl-perks.json"),
    catalog.perks ?? [],
  );
  const blessings = readJsonFile<unknown[]>(
    resolve(GENERATED_ROOT, "gl-blessings.json"),
    catalog.blessings ?? [],
  );
  const classTreeLabels = readJsonFile<unknown[]>(
    resolve(GENERATED_ROOT, "gl-class-tree-labels.json"),
    [],
  );

  const corpus = buildGlAliasCorpus({
    weapons: weapons as any,
    perks: perks as any,
    blessings: blessings as any,
    classTreeLabels: classTreeLabels as any,
  });

  mkdirSync(GENERATED_ROOT, { recursive: true });
  writeFileSync(
    resolve(GENERATED_ROOT, "gl-alias-corpus.json"),
    `${JSON.stringify(corpus, null, 2)}\n`,
  );
  console.log(`Wrote ${corpus.length} GL alias corpus entries`);
});
