import type {
  AliasSchemaJson,
  EdgeSchemaJson,
  EntityBaseSchemaJson,
  EvidenceSchemaJson,
} from "../generated/schema-types.js";
import {
  ALIASES_ROOT,
  EDGES_ROOT,
  ENTITIES_ROOT,
  EVIDENCE_ROOT,
  listJsonFiles,
  loadJsonFile,
  loadSourceSnapshotManifest,
} from "./load.js";

export interface GroundTruthRegistry {
  entities: EntityBaseSchemaJson[];
  aliases: AliasSchemaJson[];
  edges: EdgeSchemaJson[];
  evidence: EvidenceSchemaJson[];
  source_snapshot_id: string;
}

let _registry: GroundTruthRegistry | null = null;

function loadRecords<T>(root: string): T[] {
  return listJsonFiles(root).flatMap((path) => loadJsonFile(path) as T[]);
}

function loadGroundTruthRegistry(): GroundTruthRegistry {
  if (_registry) {
    return _registry;
  }

  const entities = loadRecords<EntityBaseSchemaJson>(ENTITIES_ROOT);
  const aliases = loadRecords<AliasSchemaJson>(ALIASES_ROOT);
  const edges = loadRecords<EdgeSchemaJson>(EDGES_ROOT);
  const evidence = loadRecords<EvidenceSchemaJson>(EVIDENCE_ROOT);
  const sourceSnapshot = loadSourceSnapshotManifest() as { id: string };

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
