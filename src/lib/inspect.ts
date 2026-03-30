// @ts-nocheck
import { loadGroundTruthRegistry } from "./registry.js";

function inspectEntity(id) {
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
