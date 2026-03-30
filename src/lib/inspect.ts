import { loadGroundTruthRegistry } from "./registry.js";
import type {
  AliasSchemaJson,
  EdgeSchemaJson,
  EntityBaseSchemaJson,
  EvidenceSchemaJson,
} from "../generated/schema-types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InspectResult {
  id: string;
  entity: EntityBaseSchemaJson;
  aliases: AliasSchemaJson[];
  evidence: EvidenceSchemaJson[];
  edges: EdgeSchemaJson[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function inspectEntity(id: string): InspectResult | null {
  const registry = loadGroundTruthRegistry();
  const entity = registry.entities.find((record) => record.id === id) ?? null;

  if (!entity) {
    return null;
  }

  const aliases = registry.aliases
    .filter((record) => record.candidate_entity_id === id)
    .sort((left, right) => left.text.localeCompare(right.text));
  const evidence = registry.evidence
    .filter((record) => record.subject_id === id)
    .sort((left, right) => left.id.localeCompare(right.id));
  const edges = registry.edges
    .filter((record) => record.from_entity_id === id || record.to_entity_id === id)
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    id,
    entity,
    aliases,
    evidence,
    edges,
  };
}

export { inspectEntity };
