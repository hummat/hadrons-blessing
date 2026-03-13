#!/usr/bin/env node

import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalizeBuildFile } from "./canonicalize-build.mjs";
import { loadJsonFile } from "./ground-truth/lib/load.mjs";

const FIXTURES_ROOT = "scripts/builds";
const MIGRATION_SCRAPED_AT = "2026-03-13T00:00:00Z";
const SAMPLE_BUILD = loadJsonFile("scripts/sample-build.json");

const FIXTURE_PROVENANCE_OVERRIDES = {
  "01-veteran-squad-leader.json": {
    source_url: SAMPLE_BUILD.url,
    author: SAMPLE_BUILD.author,
  },
};

function fixtureFiles() {
  return readdirSync(FIXTURES_ROOT)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

function provenanceForFixture(fileName, rawBuild) {
  const explicit = FIXTURE_PROVENANCE_OVERRIDES[fileName] ?? {};
  const fallbackAuthor = String(rawBuild.author ?? "").trim() || "unknown";
  return {
    source_kind: "gameslantern",
    source_url: explicit.source_url ?? `legacy-fixture://scripts/builds/${fileName}`,
    author: explicit.author ?? fallbackAuthor,
    scraped_at: MIGRATION_SCRAPED_AT,
  };
}

async function migrateFixture(fileName) {
  const inputPath = join(FIXTURES_ROOT, fileName);
  const rawBuild = loadJsonFile(inputPath);
  if (rawBuild?.schema_version === 1) {
    return rawBuild;
  }

  const canonicalBuild = await canonicalizeBuildFile(inputPath, {
    provenance: provenanceForFixture(fileName, rawBuild),
  });

  writeFileSync(inputPath, `${JSON.stringify(canonicalBuild, null, 2)}\n`);
  return canonicalBuild;
}

async function migrateAllFixtures() {
  const results = [];

  for (const fileName of fixtureFiles()) {
    results.push({
      file: fileName,
      build: await migrateFixture(fileName),
    });
  }

  return results;
}

if (import.meta.main) {
  const results = await migrateAllFixtures();
  process.stderr.write(`Migrated ${results.length} build fixtures to canonical shape.\n`);
}

export {
  FIXTURE_PROVENANCE_OVERRIDES,
  FIXTURES_ROOT,
  MIGRATION_SCRAPED_AT,
  migrateAllFixtures,
  migrateFixture,
  provenanceForFixture,
};
