// @ts-nocheck
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BAD_PREFIX = "bespoke_bespoke_";
const GOOD_PREFIX = "bespoke_";

/**
 * Fix entities and edges that have a doubled `bespoke_bespoke_` prefix.
 * Mutates entities and edges in place.
 *
 * @param {Array<{id: string, internal_name?: string}>} entities
 * @param {Array<{id: string, from_entity_id?: string, to_entity_id?: string}>} edges
 * @returns {{ entitiesFixed: number, edgesFixed: number }}
 */
function fixMalformedSlugs(entities, edges) {
  // Build set of all existing entity IDs before any changes.
  const existingIds = new Set(entities.map((e) => e.id));

  // Check for collisions: would the fixed ID collide with an already-existing entity?
  for (const entity of entities) {
    if (!entity.id.includes(BAD_PREFIX)) continue;
    const fixedId = entity.id.replaceAll(BAD_PREFIX, GOOD_PREFIX);
    if (existingIds.has(fixedId)) {
      throw new Error(`Collision: fixed entity id already exists: ${fixedId}`);
    }
  }

  // Fix entities.
  let entitiesFixed = 0;
  for (const entity of entities) {
    let changed = false;
    if (entity.id.includes(BAD_PREFIX)) {
      entity.id = entity.id.replaceAll(BAD_PREFIX, GOOD_PREFIX);
      changed = true;
    }
    if (entity.internal_name != null && entity.internal_name.includes(BAD_PREFIX)) {
      entity.internal_name = entity.internal_name.replaceAll(BAD_PREFIX, GOOD_PREFIX);
      changed = true;
    }
    if (changed) entitiesFixed++;
  }

  // Fix edges.
  let edgesFixed = 0;
  for (const edge of edges) {
    let changed = false;
    if (edge.id.includes(BAD_PREFIX)) {
      edge.id = edge.id.replaceAll(BAD_PREFIX, GOOD_PREFIX);
      changed = true;
    }
    if (edge.from_entity_id != null && edge.from_entity_id.includes(BAD_PREFIX)) {
      edge.from_entity_id = edge.from_entity_id.replaceAll(BAD_PREFIX, GOOD_PREFIX);
      changed = true;
    }
    if (edge.to_entity_id != null && edge.to_entity_id.includes(BAD_PREFIX)) {
      edge.to_entity_id = edge.to_entity_id.replaceAll(BAD_PREFIX, GOOD_PREFIX);
      changed = true;
    }
    if (changed) edgesFixed++;
  }

  return { entitiesFixed, edgesFixed };
}

function main() {
  const ENTITIES_ROOT = resolve(__dirname, "..", "..", "data", "ground-truth", "entities");
  const EDGES_ROOT = resolve(__dirname, "..", "..", "data", "ground-truth", "edges");

  const weaponsPath = resolve(ENTITIES_ROOT, "shared-weapons.json");
  const namesPath = resolve(ENTITIES_ROOT, "shared-names.json");
  const edgesPath = resolve(EDGES_ROOT, "shared.json");

  const weaponEntities = JSON.parse(readFileSync(weaponsPath, "utf8"));
  const nameEntities = JSON.parse(readFileSync(namesPath, "utf8"));
  const edges = JSON.parse(readFileSync(edgesPath, "utf8"));

  const weaponsResult = fixMalformedSlugs(weaponEntities, []);
  const namesResult = fixMalformedSlugs(nameEntities, []);
  const edgesResult = fixMalformedSlugs([], edges);

  const totalEntities = weaponsResult.entitiesFixed + namesResult.entitiesFixed;
  const totalEdges = edgesResult.edgesFixed;

  if (totalEntities === 0 && totalEdges === 0) {
    console.log("No malformed slugs found. Nothing to do.");
    return;
  }

  writeFileSync(weaponsPath, JSON.stringify(weaponEntities, null, 2) + "\n");
  writeFileSync(namesPath, JSON.stringify(nameEntities, null, 2) + "\n");
  writeFileSync(edgesPath, JSON.stringify(edges, null, 2) + "\n");

  console.log(`Fixed ${totalEntities} entities, ${totalEdges} edges`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}

export { fixMalformedSlugs };
