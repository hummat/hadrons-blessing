// @ts-nocheck
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import {
  ALIASES_ROOT,
  EDGES_ROOT,
  ENTITIES_ROOT,
  EVIDENCE_ROOT,
  GENERATED_ROOT,
  REPO_ROOT,
  listJsonFiles,
  loadJsonFile,
} from "../lib/load.js";
import { normalizeText } from "../lib/normalize.js";
import {
  validateAliasRecord,
  validateEdgeRecord,
  validateEntityRecord,
  validateEvidenceRecord,
  validateSourceSnapshot,
} from "../lib/validate.js";
import { runCliMain } from "../lib/cli.js";

const GENERATED_INDEX_PATH = join(GENERATED_ROOT, "index.json");
const GENERATED_META_PATH = join(GENERATED_ROOT, "meta.json");

function readShardDirectory(root) {
  const files = listJsonFiles(root);
  const records = [];

  for (const file of files) {
    const payload = loadJsonFile(file);
    if (!Array.isArray(payload)) {
      throw new Error(`Ground-truth shard must be an array: ${file}`);
    }

    for (const record of payload) {
      records.push(record);
    }
  }

  return { files, records };
}

function validateRecords(records, validateRecord, label) {
  for (const record of records) {
    const result = validateRecord(record);
    if (!result.ok) {
      throw new Error(
        `Invalid ${label} record ${record.id ?? record.text}: ${JSON.stringify(result.errors)}`,
      );
    }
  }
}

function ensureUniqueIds(records, label) {
  const seen = new Set();

  for (const record of records) {
    if (seen.has(record.id)) {
      throw new Error(`Duplicate ${label} id: ${record.id}`);
    }

    seen.add(record.id);
  }
}

function ensureRecordSnapshotIds(records, label, sourceSnapshotId) {
  for (const record of records) {
    if (record.source_snapshot_id !== sourceSnapshotId) {
      throw new Error(
        `${label} record has mismatched source snapshot id: ${record.id} -> ${record.source_snapshot_id}`,
      );
    }
  }
}

function ensurePathInRoot(root, path) {
  const resolvedPath = resolve(root, path);
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;

  if (resolvedPath !== root && !resolvedPath.startsWith(normalizedRoot)) {
    throw new Error(`Ref escapes root: ${path}`);
  }

  return resolvedPath;
}

function resolveRefPath(path, roots) {
  for (const root of roots) {
    const candidate = ensurePathInRoot(root, path);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function ensureRefsResolve(records, label, roots) {
  const lineCountCache = new Map();

  function lineCountFor(path) {
    const cached = lineCountCache.get(path);
    if (cached != null) {
      return cached;
    }

    const lineCount = readFileSync(path, "utf8").split("\n").length;
    lineCountCache.set(path, lineCount);
    return lineCount;
  }

  for (const record of records) {
    for (const ref of record.refs) {
      const resolvedPath = resolveRefPath(ref.path, roots);
      if (resolvedPath == null) {
        throw new Error(`${label} ref path does not exist: ${record.id} -> ${ref.path}`);
      }

      const lineCount = lineCountFor(resolvedPath);
      if (ref.line < 1 || ref.line > lineCount) {
        throw new Error(
          `${label} ref line is out of range: ${record.id} -> ${ref.path}:${ref.line}`,
        );
      }
    }
  }
}

function ensureReferentialIntegrity({ entities, aliases, edges, evidence }) {
  const entityIds = new Set(entities.map((record) => record.id));
  const edgeMap = new Map(edges.map((record) => [record.id, record]));
  const edgeIds = new Set(edgeMap.keys());
  const evidenceMap = new Map(evidence.map((record) => [record.id, record]));
  const evidenceIds = new Set(evidence.map((record) => record.id));

  for (const alias of aliases) {
    if (!entityIds.has(alias.candidate_entity_id)) {
      throw new Error(
        `Alias target does not exist: ${alias.text} -> ${alias.candidate_entity_id}`,
      );
    }
  }

  for (const edge of edges) {
    if (!entityIds.has(edge.from_entity_id)) {
      throw new Error(
        `Edge source does not exist: ${edge.id} -> ${edge.from_entity_id}`,
      );
    }

    if (!entityIds.has(edge.to_entity_id)) {
      throw new Error(
        `Edge target does not exist: ${edge.id} -> ${edge.to_entity_id}`,
      );
    }

    for (const evidenceId of edge.evidence_ids) {
      if (!evidenceIds.has(evidenceId)) {
        throw new Error(
          `Edge evidence id does not exist: ${edge.id} -> ${evidenceId}`,
        );
      }

      const evidenceRecord = evidenceMap.get(evidenceId);
      if (
        evidenceRecord.subject_type !== "edge" ||
        evidenceRecord.subject_id !== edge.id
      ) {
        throw new Error(
          `Edge evidence subject mismatch: ${edge.id} -> ${evidenceId}`,
        );
      }
    }
  }

  for (const record of evidence) {
    const subjectExists =
      record.subject_type === "entity"
        ? entityIds.has(record.subject_id)
        : edgeIds.has(record.subject_id);

    if (!subjectExists) {
      throw new Error(
        `Evidence subject does not exist: ${record.id} -> ${record.subject_type}:${record.subject_id}`,
      );
    }

    if (record.value_type === "entity_id" && !entityIds.has(record.value)) {
      throw new Error(
        `Evidence value entity does not exist: ${record.id} -> ${record.value}`,
      );
    }

    if (record.subject_type === "edge") {
      const edge = edgeMap.get(record.subject_id);
      if (!edge.evidence_ids.includes(record.id)) {
        throw new Error(
          `Edge evidence is not referenced by its subject edge: ${record.id} -> ${record.subject_id}`,
        );
      }
    }
  }
}

function materializeSyntheticAliases(entities) {
  const aliases = [];

  for (const entity of entities) {
    for (const [field, aliasKind, matchMode] of [
      ["internal_name", "internal_name", "exact_only"],
      ["loc_key", "loc_key", "exact_only"],
      ["ui_name", "ui_name", "fuzzy_allowed"],
    ]) {
      const value = entity[field];
      if (typeof value !== "string" || value.length === 0) {
        continue;
      }

      aliases.push({
        text: value,
        normalized_text: normalizeText(value),
        candidate_entity_id: entity.id,
        alias_kind: aliasKind,
        match_mode: matchMode,
        provenance: "generator",
        confidence: "high",
        context_constraints: {
          require_all: [],
          prefer: [],
        },
        rank_weight: aliasKind === "ui_name" ? 100 : 120,
        notes: "",
      });
    }
  }

  return aliases;
}

function normalizeAliasRecord(record) {
  const normalizedText = normalizeText(record.text);
  if (record.normalized_text !== normalizedText) {
    throw new Error(
      `Alias normalized_text mismatch for ${record.text}: expected ${normalizedText}, got ${record.normalized_text}`,
    );
  }

  return {
    ...record,
    normalized_text: normalizedText,
  };
}

function detectUnsafeAliasCollisions(aliases) {
  const buckets = new Map();

  for (const alias of aliases) {
    if (alias.match_mode !== "fuzzy_allowed") {
      continue;
    }

    const key = JSON.stringify({
      normalized_text: alias.normalized_text,
      context_constraints: alias.context_constraints,
      rank_weight: alias.rank_weight,
    });

    const bucket = buckets.get(key) ?? [];
    bucket.push(alias);
    buckets.set(key, bucket);
  }

  for (const bucket of buckets.values()) {
    const candidateIds = new Set(bucket.map((alias) => alias.candidate_entity_id));
    if (candidateIds.size > 1) {
      throw new Error(
        `unsafe alias collision: ${bucket[0].normalized_text} -> ${Array.from(candidateIds).join(", ")}`,
      );
    }
  }
}

function injectBadFixture(index, fixtureName) {
  if (fixtureName === "overlapping-fuzzy-collision") {
    const [firstEntity, secondEntity] = index.entities;
    if (!firstEntity || !secondEntity) {
      throw new Error("Need at least two entities to inject a bad alias collision");
    }

    index.aliases.push(
      {
        text: "Collision Alias",
        normalized_text: normalizeText("Collision Alias"),
        candidate_entity_id: firstEntity.id,
        alias_kind: "guide_name",
        match_mode: "fuzzy_allowed",
        provenance: "test-fixture",
        confidence: "medium",
        context_constraints: {
          require_all: [],
          prefer: [],
        },
        rank_weight: 50,
        notes: "",
      },
      {
        text: "Collision Alias",
        normalized_text: normalizeText("Collision Alias"),
        candidate_entity_id: secondEntity.id,
        alias_kind: "guide_name",
        match_mode: "fuzzy_allowed",
        provenance: "test-fixture",
        confidence: "medium",
        context_constraints: {
          require_all: [],
          prefer: [],
        },
        rank_weight: 50,
        notes: "",
      },
    );
    return;
  }

  if (fixtureName === "dangling-edge-target") {
    index.edges.push({
      id: "test.edge.dangling-target",
      type: "instance_of",
      from_entity_id: index.entities[0].id,
      to_entity_id: "missing.entity",
      source_snapshot_id: index.meta.source_snapshot_id,
      conditions: {
        predicates: [],
        aggregation: "additive",
        stacking_mode: "binary",
        exclusive_scope: null,
      },
      calc: {},
      evidence_ids: [],
    });
    return;
  }

  if (fixtureName === "dangling-evidence-subject") {
    index.evidence.push({
      id: "test.evidence.dangling-subject",
      subject_type: "edge",
      subject_id: "missing.edge",
      predicate: "maps_trait_to_family",
      value: index.entities[0].id,
      value_type: "entity_id",
      source_snapshot_id: index.meta.source_snapshot_id,
      refs: [],
      confidence: "low",
      source_kind: "test-fixture",
    });
    return;
  }

  if (fixtureName === "dangling-evidence-value") {
    index.evidence.push({
      id: "test.evidence.dangling-value",
      subject_type: "entity",
      subject_id: index.entities[0].id,
      predicate: "maps_to",
      value: "missing.entity",
      value_type: "entity_id",
      source_snapshot_id: index.meta.source_snapshot_id,
      refs: [],
      confidence: "low",
      source_kind: "test-fixture",
    });
    return;
  }

  if (fixtureName === "dangling-edge-evidence-id") {
    index.edges.push({
      id: "test.edge.dangling-evidence",
      type: "instance_of",
      from_entity_id: index.entities[0].id,
      to_entity_id: index.entities[1].id,
      source_snapshot_id: index.meta.source_snapshot_id,
      conditions: {
        predicates: [],
        aggregation: "additive",
        stacking_mode: "binary",
        exclusive_scope: null,
      },
      calc: {},
      evidence_ids: ["missing.evidence"],
    });
    return;
  }

  if (fixtureName === "mismatched-entity-source-snapshot-id") {
    index.entities[0].source_snapshot_id = "darktide-source.bad-fixture";
    return;
  }

  if (fixtureName === "mismatched-edge-source-snapshot-id") {
    index.edges[0].source_snapshot_id = "darktide-source.bad-fixture";
    return;
  }

  if (fixtureName === "mismatched-evidence-source-snapshot-id") {
    index.evidence[0].source_snapshot_id = "darktide-source.bad-fixture";
    return;
  }

  if (fixtureName === "edge-evidence-subject-mismatch") {
    const edge = index.edges.find((record) => record.evidence_ids.length > 0);
    if (!edge) {
      throw new Error("Need an edge with evidence ids to inject an evidence subject mismatch");
    }

    const evidenceRecord = index.evidence.find((record) => record.id === edge.evidence_ids[0]);
    evidenceRecord.subject_id = index.edges.find((record) => record.id !== edge.id)?.id ?? edge.id;
    return;
  }

  if (fixtureName === "orphaned-edge-subject-evidence") {
    const evidenceRecord = index.evidence.find((record) => record.subject_type === "edge");
    if (!evidenceRecord) {
      throw new Error("Need edge-subject evidence to inject an orphaned edge evidence record");
    }

    const edge = index.edges.find((record) => record.id === evidenceRecord.subject_id);
    edge.evidence_ids = edge.evidence_ids.filter((id) => id !== evidenceRecord.id);
    return;
  }

  if (fixtureName === "missing-entity-ref-path") {
    const entity = index.entities.find((record) => record.refs.length > 0);
    if (!entity) {
      throw new Error("Need an entity with refs to inject a missing entity ref path");
    }

    entity.refs = [{ path: "scripts/missing_ground_truth_fixture.lua", line: 1 }];
    return;
  }

  if (fixtureName === "missing-evidence-ref-path") {
    const evidenceRecord = index.evidence.find((record) => record.refs.length > 0);
    if (!evidenceRecord) {
      throw new Error("Need evidence with refs to inject a missing evidence ref path");
    }

    evidenceRecord.refs = [{ path: "scripts/missing_ground_truth_fixture.lua", line: 1 }];
    return;
  }

  if (fixtureName === "out-of-range-entity-ref-line") {
    const entity = index.entities.find((record) => record.refs.length > 0);
    if (!entity) {
      throw new Error("Need an entity with refs to inject an out-of-range entity ref line");
    }

    entity.refs = [{ ...entity.refs[0], line: 999999 }];
    return;
  }

  if (fixtureName === "out-of-range-evidence-ref-line") {
    const evidenceRecord = index.evidence.find((record) => record.refs.length > 0);
    if (!evidenceRecord) {
      throw new Error("Need evidence with refs to inject an out-of-range evidence ref line");
    }

    evidenceRecord.refs = [{ ...evidenceRecord.refs[0], line: 999999 }];
    return;
  }

  throw new Error(`Unknown bad fixture: ${fixtureName}`);
}

function buildMeta({ shardFiles, sourceSnapshot }) {
  const hasher = createHash("sha256");

  for (const file of [
    ...shardFiles.entities,
    ...shardFiles.aliases,
    ...shardFiles.edges,
    ...shardFiles.evidence,
  ]) {
    hasher.update(basename(file));
    hasher.update("\n");
    hasher.update(readFileSync(file));
    hasher.update("\n");
  }

  return {
    source_snapshot_id: sourceSnapshot.id,
    input_fingerprint: hasher.digest("hex"),
    shard_manifest: {
      entities: shardFiles.entities.map((file) => basename(file)),
      aliases: shardFiles.aliases.map((file) => basename(file)),
      edges: shardFiles.edges.map((file) => basename(file)),
      evidence: shardFiles.evidence.map((file) => basename(file)),
    },
  };
}

async function buildIndex(options = {}) {
  const { check = false, injectBadFixture: badFixtureName } = options;
  const sourceSnapshot = validateSourceSnapshot();

  const entityShards = readShardDirectory(ENTITIES_ROOT);
  const aliasShards = readShardDirectory(ALIASES_ROOT);
  const edgeShards = readShardDirectory(EDGES_ROOT);
  const evidenceShards = readShardDirectory(EVIDENCE_ROOT);

  validateRecords(entityShards.records, validateEntityRecord, "entity");
  validateRecords(edgeShards.records, validateEdgeRecord, "edge");
  validateRecords(evidenceShards.records, validateEvidenceRecord, "evidence");

  const aliases = [
    ...aliasShards.records.map(normalizeAliasRecord),
    ...materializeSyntheticAliases(entityShards.records),
  ];
  validateRecords(aliases, validateAliasRecord, "alias");

  ensureUniqueIds(entityShards.records, "entity");
  ensureUniqueIds(edgeShards.records, "edge");
  ensureUniqueIds(evidenceShards.records, "evidence");

  const index = {
    meta: buildMeta({
      shardFiles: {
        entities: entityShards.files,
        aliases: aliasShards.files,
        edges: edgeShards.files,
        evidence: evidenceShards.files,
      },
      sourceSnapshot,
    }),
    entities: entityShards.records,
    aliases,
    edges: edgeShards.records,
    evidence: evidenceShards.records,
  };

  if (badFixtureName) {
    injectBadFixture(index, badFixtureName);
  }

  ensureRecordSnapshotIds(index.entities, "entity", sourceSnapshot.id);
  ensureRecordSnapshotIds(index.edges, "edge", sourceSnapshot.id);
  ensureRecordSnapshotIds(index.evidence, "evidence", sourceSnapshot.id);
  ensureRefsResolve(index.entities, "entity", [REPO_ROOT, sourceSnapshot.source_root]);
  ensureRefsResolve(index.evidence, "evidence", [REPO_ROOT, sourceSnapshot.source_root]);
  ensureReferentialIntegrity(index);
  detectUnsafeAliasCollisions(index.aliases);

  mkdirSync(GENERATED_ROOT, { recursive: true });

  if (!check) {
    writeFileSync(GENERATED_INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`);
    writeFileSync(GENERATED_META_PATH, `${JSON.stringify(index.meta, null, 2)}\n`);
    return index;
  }

  const current = JSON.stringify(index, null, 2);
  const existing = readFileSync(GENERATED_INDEX_PATH, "utf8");
  const existingMeta = readFileSync(GENERATED_META_PATH, "utf8");

  if (`${current}\n` !== existing) {
    throw new Error("Generated ground-truth index is stale");
  }

  if (`${JSON.stringify(index.meta, null, 2)}\n` !== existingMeta) {
    throw new Error("Generated ground-truth meta is stale");
  }

  return index;
}

function parseArgs(argv) {
  return {
    check: argv.includes("--check"),
  };
}

if (import.meta.main) {
  await runCliMain("index:build", async () => {
    await buildIndex(parseArgs(process.argv.slice(2)));
  });
}

export { buildIndex };
