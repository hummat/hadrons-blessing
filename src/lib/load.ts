import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REPO_ROOT,
  GROUND_TRUTH_ROOT,
  ENTITIES_ROOT,
  ALIASES_ROOT,
  EDGES_ROOT,
  EVIDENCE_ROOT,
  SCHEMAS_ROOT,
  ENTITY_KINDS_ROOT,
  GENERATED_ROOT,
  GENERATED_INDEX_PATH,
  GENERATED_META_PATH,
  NON_CANONICAL_ROOT,
  SOURCE_SNAPSHOT_MANIFEST_PATH,
  resolveSourceRoot,
} from "./paths.js";

function loadJsonFile(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function loadSourceSnapshotManifest(): unknown {
  return loadJsonFile(SOURCE_SNAPSHOT_MANIFEST_PATH);
}

function listJsonFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(root, name));
}

export {
  // Re-export path constants so existing consumers don't need to change imports
  ALIASES_ROOT,
  EDGES_ROOT,
  ENTITIES_ROOT,
  ENTITY_KINDS_ROOT,
  EVIDENCE_ROOT,
  GENERATED_INDEX_PATH,
  GENERATED_META_PATH,
  GENERATED_ROOT,
  GROUND_TRUTH_ROOT,
  NON_CANONICAL_ROOT,
  REPO_ROOT,
  SCHEMAS_ROOT,
  SOURCE_SNAPSHOT_MANIFEST_PATH,
  resolveSourceRoot,
  // Own exports
  listJsonFiles,
  loadJsonFile,
  loadSourceSnapshotManifest,
};
