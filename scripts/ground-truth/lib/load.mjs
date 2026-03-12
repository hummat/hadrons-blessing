import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const GROUND_TRUTH_ROOT = join(REPO_ROOT, "data", "ground-truth");
const ENTITIES_ROOT = join(GROUND_TRUTH_ROOT, "entities");
const ALIASES_ROOT = join(GROUND_TRUTH_ROOT, "aliases");
const EDGES_ROOT = join(GROUND_TRUTH_ROOT, "edges");
const EVIDENCE_ROOT = join(GROUND_TRUTH_ROOT, "evidence");
const NON_CANONICAL_ROOT = join(GROUND_TRUTH_ROOT, "non-canonical");
const GENERATED_ROOT = join(GROUND_TRUTH_ROOT, "generated");
const GENERATED_INDEX_PATH = join(GENERATED_ROOT, "index.json");
const GENERATED_META_PATH = join(GENERATED_ROOT, "meta.json");
const SCHEMAS_ROOT = join(GROUND_TRUTH_ROOT, "schemas");
const ENTITY_KINDS_ROOT = join(SCHEMAS_ROOT, "entity-kinds");
const SOURCE_SNAPSHOT_MANIFEST_PATH = join(
  GROUND_TRUTH_ROOT,
  "source-snapshots",
  "manifest.json",
);

function loadJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function loadSourceSnapshotManifest() {
  return loadJsonFile(SOURCE_SNAPSHOT_MANIFEST_PATH);
}

function listJsonFiles(root) {
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(root, name));
}

export {
  ALIASES_ROOT,
  EDGES_ROOT,
  ENTITY_KINDS_ROOT,
  ENTITIES_ROOT,
  EVIDENCE_ROOT,
  GENERATED_INDEX_PATH,
  GENERATED_META_PATH,
  GENERATED_ROOT,
  GROUND_TRUTH_ROOT,
  NON_CANONICAL_ROOT,
  REPO_ROOT,
  SCHEMAS_ROOT,
  SOURCE_SNAPSHOT_MANIFEST_PATH,
  listJsonFiles,
  loadJsonFile,
  loadSourceSnapshotManifest,
};
