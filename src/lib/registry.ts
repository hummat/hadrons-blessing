// @ts-nocheck
import {
  ALIASES_ROOT,
  EDGES_ROOT,
  ENTITIES_ROOT,
  EVIDENCE_ROOT,
  listJsonFiles,
  loadJsonFile,
  loadSourceSnapshotManifest,
} from "./load.js";

let _registry = null;

function loadRecords(root) {
  return listJsonFiles(root).flatMap((path) => loadJsonFile(path));
}

function loadGroundTruthRegistry() {
  if (_registry) {
    return _registry;
  }

  const entities = loadRecords(ENTITIES_ROOT);
  const aliases = loadRecords(ALIASES_ROOT);
  const edges = loadRecords(EDGES_ROOT);
  const evidence = loadRecords(EVIDENCE_ROOT);
  const sourceSnapshot = loadSourceSnapshotManifest();

  _registry = {
    entities,
    aliases,
    edges,
    evidence,
    source_snapshot_id: sourceSnapshot.id,
  };
  return _registry;
}

export { loadGroundTruthRegistry };
