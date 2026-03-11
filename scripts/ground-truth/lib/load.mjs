import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const GROUND_TRUTH_ROOT = join(REPO_ROOT, "data", "ground-truth");
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

export {
  ENTITY_KINDS_ROOT,
  GROUND_TRUTH_ROOT,
  REPO_ROOT,
  SCHEMAS_ROOT,
  SOURCE_SNAPSHOT_MANIFEST_PATH,
  loadJsonFile,
  loadSourceSnapshotManifest,
};
