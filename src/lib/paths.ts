import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, "package.json"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("Could not find repo root (no package.json found)");
    }
    dir = parent;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = findRepoRoot(__dirname);

// Data paths
export const DATA_ROOT = join(REPO_ROOT, "data");
export const GROUND_TRUTH_ROOT = join(DATA_ROOT, "ground-truth");
export const ENTITIES_ROOT = join(GROUND_TRUTH_ROOT, "entities");
export const ALIASES_ROOT = join(GROUND_TRUTH_ROOT, "aliases");
export const EDGES_ROOT = join(GROUND_TRUTH_ROOT, "edges");
export const EVIDENCE_ROOT = join(GROUND_TRUTH_ROOT, "evidence");
export const NON_CANONICAL_ROOT = join(GROUND_TRUTH_ROOT, "non-canonical");
export const GENERATED_ROOT = join(GROUND_TRUTH_ROOT, "generated");
export const GENERATED_INDEX_PATH = join(GENERATED_ROOT, "index.json");
export const GENERATED_META_PATH = join(GENERATED_ROOT, "meta.json");
export const SCHEMAS_ROOT = join(GROUND_TRUTH_ROOT, "schemas");
export const ENTITY_KINDS_ROOT = join(SCHEMAS_ROOT, "entity-kinds");
export const SOURCE_SNAPSHOT_MANIFEST_PATH = join(
  GROUND_TRUTH_ROOT,
  "source-snapshots",
  "manifest.json",
);
export const BUILDS_ROOT = join(DATA_ROOT, "builds");
export const EXPORTS_ROOT = join(DATA_ROOT, "exports");
export const SCORING_DATA_PATH = join(DATA_ROOT, "build-scoring-data.json");
export const BREAKPOINT_CHECKLIST_PATH = join(GROUND_TRUTH_ROOT, "breakpoint-checklist.json");
export const CLASS_BASE_STATS_PATH = join(GROUND_TRUTH_ROOT, "class-base-stats.json");

// Source root resolution
const SOURCE_ROOT_FILE = join(REPO_ROOT, ".source-root");

export function resolveSourceRoot(explicit?: string): string | null {
  if (explicit) {
    return resolve(explicit);
  }
  if (process.env.GROUND_TRUTH_SOURCE_ROOT) {
    return resolve(process.env.GROUND_TRUTH_SOURCE_ROOT);
  }
  if (existsSync(SOURCE_ROOT_FILE)) {
    const content = readFileSync(SOURCE_ROOT_FILE, "utf8").trim();
    if (content) {
      return resolve(content);
    }
  }
  return null;
}
