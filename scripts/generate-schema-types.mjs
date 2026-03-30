#!/usr/bin/env node
// Generate TypeScript interfaces from JSON Schema files.
// Output: src/generated/schema-types.ts

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const SCHEMAS_DIR = join(REPO_ROOT, "data", "ground-truth", "schemas");
const ENTITY_KINDS_DIR = join(SCHEMAS_DIR, "entity-kinds");
const OUTPUT_DIR = join(REPO_ROOT, "src", "generated");
const OUTPUT_FILE = join(OUTPUT_DIR, "schema-types.ts");

const SCHEMA_FILES = [
  "alias.schema.json",
  "build-selection.schema.json",
  "canonical-build.schema.json",
  "calc.schema.json",
  "condition.schema.json",
  "edge.schema.json",
  "entity-base.schema.json",
  "evidence.schema.json",
  "known-unresolved.schema.json",
  "query-context.schema.json",
];

const ENTITY_KIND_FILES = [
  "ability.schema.json",
  "aura.schema.json",
  "buff.schema.json",
  "class.schema.json",
  "gadget-trait.schema.json",
  "keystone.schema.json",
  "name-family.schema.json",
  "talent-modifier.schema.json",
  "talent.schema.json",
  "tree-node.schema.json",
  "weapon-perk.schema.json",
  "weapon-trait.schema.json",
  "weapon.schema.json",
];

async function compileSchema(schema, name, opts, file) {
  try {
    return await compile(schema, name, opts);
  } catch (err) {
    throw new Error(`Failed to compile ${file}: ${err.message}`, { cause: err });
  }
}

/**
 * Deduplicate export type/interface declarations in a combined TypeScript string.
 *
 * Strategy: split the output on `export (type|interface) Name` boundaries,
 * then for each named block keep only the first occurrence.
 *
 * This avoids the fragile brace-counting state machine which silently truncates
 * multi-line union types with inline object members.
 */
function deduplicateDeclarations(source) {
  // Split at every `export type` / `export interface` declaration start.
  // The regex uses a lookahead so the delimiter is kept at the start of each chunk.
  const chunks = source.split(/(?=^export (?:type|interface) \w+)/m);

  const seen = new Set();
  const kept = [];

  for (const chunk of chunks) {
    const match = chunk.match(/^export (?:type|interface) (\w+)/);
    if (match) {
      const name = match[1];
      if (seen.has(name)) continue;
      seen.add(name);
    }
    kept.push(chunk);
  }

  return kept.join("");
}

async function generateTypes() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const header = [
    "// Auto-generated from data/ground-truth/schemas/ — do not edit manually.",
    "// Regenerate with: npm run build:types",
    "",
  ].join("\n");

  const compileOpts = {
    additionalProperties: false,
    bannerComment: "",
    strictIndexSignatures: true,
    cwd: SCHEMAS_DIR,
  };

  const parts = [];

  for (const file of SCHEMA_FILES) {
    const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, file), "utf8"));
    const ts = await compileSchema(
      schema,
      schema.$id || basename(file, ".schema.json"),
      compileOpts,
      file,
    );
    parts.push(ts);
  }

  for (const file of ENTITY_KIND_FILES) {
    const schema = JSON.parse(readFileSync(join(ENTITY_KINDS_DIR, file), "utf8"));
    const ts = await compileSchema(
      schema,
      schema.$id || basename(file, ".schema.json"),
      { ...compileOpts, cwd: ENTITY_KINDS_DIR },
      file,
    );
    parts.push(ts);
  }

  // Deduplicate type declarations that appear multiple times due to $ref resolution.
  // json-schema-to-typescript re-emits referenced types inline when compiling
  // schemas one-at-a-time, so we strip duplicates by tracking seen type names.
  const combined = header + parts.join("\n");
  const output = deduplicateDeclarations(combined);

  writeFileSync(OUTPUT_FILE, output);
  console.log(`Generated ${OUTPUT_FILE}`);
}

generateTypes().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
