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

async function generateTypes() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const parts = [
    "// Auto-generated from data/ground-truth/schemas/ — do not edit manually.",
    "// Regenerate with: npm run build:types",
    "",
  ];

  const compileOpts = {
    additionalProperties: false,
    bannerComment: "",
    strictIndexSignatures: true,
    cwd: SCHEMAS_DIR,
  };

  for (const file of SCHEMA_FILES) {
    const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, file), "utf8"));
    const ts = await compile(schema, schema.$id || basename(file, ".schema.json"), compileOpts);
    parts.push(ts);
  }

  for (const file of ENTITY_KIND_FILES) {
    const schema = JSON.parse(readFileSync(join(ENTITY_KINDS_DIR, file), "utf8"));
    const ts = await compile(schema, schema.$id || basename(file, ".schema.json"), {
      ...compileOpts,
      cwd: ENTITY_KINDS_DIR,
    });
    parts.push(ts);
  }

  // Deduplicate type declarations that appear multiple times due to $ref resolution.
  // json-schema-to-typescript re-emits referenced types inline when compiling
  // schemas one-at-a-time, so we strip duplicates by tracking seen type names.
  const seen = new Set();
  const deduped = [];
  for (const part of parts) {
    const lines = part.split("\n");
    const filtered = [];
    let skipBlock = false;
    let braceDepth = 0;
    for (const line of lines) {
      const typeMatch = line.match(
        /^export (?:type|interface)\s+(\w+)/,
      );
      if (typeMatch && !skipBlock) {
        const name = typeMatch[1];
        if (seen.has(name)) {
          skipBlock = true;
          braceDepth = 0;
        } else {
          seen.add(name);
        }
      }
      if (skipBlock) {
        // Count braces to find end of type/interface block
        for (const ch of line) {
          if (ch === "{") braceDepth++;
          if (ch === "}") braceDepth--;
        }
        // For type aliases (no braces), the declaration ends at semicolon
        if (
          braceDepth <= 0 &&
          (line.endsWith(";") || line.endsWith("}"))
        ) {
          skipBlock = false;
        }
        continue;
      }
      filtered.push(line);
    }
    deduped.push(filtered.join("\n"));
  }

  writeFileSync(OUTPUT_FILE, deduped.join("\n"));
  console.log(`Generated ${OUTPUT_FILE}`);
}

generateTypes().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
