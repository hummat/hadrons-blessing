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
} from "./load.js";
import { normalizeText } from "./normalize.js";
import {
  validateAliasRecord,
  validateEdgeRecord,
  validateEntityRecord,
  validateEvidenceRecord,
  validateSourceSnapshot,
} from "./validate.js";
import type { ValidationResult, SourceSnapshotInfo } from "./validate.js";
import type {
  AliasSchemaJson,
  EdgeSchemaJson,
  EntityBaseSchemaJson,
  EvidenceSchemaJson,
} from "../generated/schema-types.js";

const GENERATED_INDEX_PATH = join(GENERATED_ROOT, "index.json");
const GENERATED_META_PATH = join(GENERATED_ROOT, "meta.json");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShardResult<T> {
  files: string[];
  records: T[];
}

interface Ref {
  path: string;
  line: number;
}

interface RecordWithId {
  id: string;
  source_snapshot_id?: string;
  refs?: Ref[];
  [key: string]: unknown;
}

interface ShardFiles {
  entities: string[];
  aliases: string[];
  edges: string[];
  evidence: string[];
}

interface IndexMeta {
  source_snapshot_id: string;
  input_fingerprint: string;
  shard_manifest: {
    entities: string[];
    aliases: string[];
    edges: string[];
    evidence: string[];
  };
}

export interface GroundTruthIndex {
  meta: IndexMeta;
  entities: EntityBaseSchemaJson[];
  aliases: AliasSchemaJson[];
  edges: EdgeSchemaJson[];
  evidence: EvidenceSchemaJson[];
}

interface BuildIndexOptions {
  check?: boolean;
  writeGenerated?: boolean;
  injectBadFixture?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readShardDirectory<T>(root: string): ShardResult<T> {
  const files = listJsonFiles(root);
  const records: T[] = [];

  for (const file of files) {
    const payload = loadJsonFile(file);
    if (!Array.isArray(payload)) {
      throw new Error(`Ground-truth shard must be an array: ${file}`);
    }

    for (const record of payload as T[]) {
      records.push(record);
    }
  }

  return { files, records };
}

function validateRecords<T extends { id?: string; text?: string }>(
  records: T[],
  validateRecord: (record: unknown) => ValidationResult,
  label: string,
): void {
  for (const record of records) {
    const result = validateRecord(record);
    if (!result.ok) {
      throw new Error(
        `Invalid ${label} record ${record.id ?? record.text}: ${JSON.stringify(result.errors)}`,
      );
    }
  }
}

function ensureUniqueIds<T extends { id: string }>(records: T[], label: string): void {
  const seen = new Set<string>();

  for (const record of records) {
    if (seen.has(record.id)) {
      throw new Error(`Duplicate ${label} id: ${record.id}`);
    }

    seen.add(record.id);
  }
}

function ensureRecordSnapshotIds<T extends { id: string; source_snapshot_id?: string }>(
  records: T[],
  label: string,
  sourceSnapshotId: string,
): void {
  for (const record of records) {
    if ((record as unknown as any).source_snapshot_id !== sourceSnapshotId) {
      throw new Error(
        `${label} record has mismatched source snapshot id: ${record.id} -> ${(record as unknown as any).source_snapshot_id}`,
      );
    }
  }
}

function ensurePathInRoot(root: string, path: string): string {
  const resolvedPath = resolve(root, path);
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;

  if (resolvedPath !== root && !resolvedPath.startsWith(normalizedRoot)) {
    throw new Error(`Ref escapes root: ${path}`);
  }

  return resolvedPath;
}

function resolveRefPath(path: string, roots: string[]): string | null {
  for (const root of roots) {
    const candidate = ensurePathInRoot(root, path);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function ensureRefsResolve<T extends { id: string; refs: Ref[] }>(records: T[], label: string, roots: string[]): void {
  const lineCountCache = new Map<string, number>();

  function lineCountFor(path: string): number {
    const cached = lineCountCache.get(path);
    if (cached != null) {
      return cached;
    }

    const lineCount = readFileSync(path, "utf8").split("\n").length;
    lineCountCache.set(path, lineCount);
    return lineCount;
  }

  for (const record of records) {
    for (const ref of record.refs ?? []) {
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

function ensureReferentialIntegrity({ entities, aliases, edges, evidence }: {
  entities: EntityBaseSchemaJson[];
  aliases: AliasSchemaJson[];
  edges: EdgeSchemaJson[];
  evidence: EvidenceSchemaJson[];
}): void {
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

      const evidenceRecord = evidenceMap.get(evidenceId)!;
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

    if (record.value_type === "entity_id" && !entityIds.has(record.value as string)) {
      throw new Error(
        `Evidence value entity does not exist: ${record.id} -> ${record.value}`,
      );
    }

    if (record.subject_type === "edge") {
      const edge = edgeMap.get(record.subject_id)!;
      if (!edge.evidence_ids.includes(record.id)) {
        throw new Error(
          `Edge evidence is not referenced by its subject edge: ${record.id} -> ${record.subject_id}`,
        );
      }
    }
  }
}

function materializeSyntheticAliases(entities: EntityBaseSchemaJson[]): AliasSchemaJson[] {
  const aliases: AliasSchemaJson[] = [];

  for (const entity of entities) {
    for (const [field, aliasKind, matchMode] of [
      ["internal_name", "internal_name", "exact_only"],
      ["loc_key", "loc_key", "exact_only"],
      ["ui_name", "ui_name", "fuzzy_allowed"],
    ] as const) {
      const value = (entity as any)[field];
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
      } as AliasSchemaJson);
    }
  }

  return aliases;
}

function normalizeAliasRecord(record: AliasSchemaJson): AliasSchemaJson {
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

function detectUnsafeAliasCollisions(aliases: AliasSchemaJson[]): void {
  const buckets = new Map<string, AliasSchemaJson[]>();

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

function injectBadFixture(index: GroundTruthIndex, fixtureName: string): void {
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
      } as AliasSchemaJson,
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
      } as AliasSchemaJson,
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
    } as unknown as EdgeSchemaJson);
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
    } as unknown as EvidenceSchemaJson);
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
    } as unknown as EvidenceSchemaJson);
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
    } as unknown as EdgeSchemaJson);
    return;
  }

  if (fixtureName === "mismatched-entity-source-snapshot-id") {
    (index.entities[0] as any).source_snapshot_id = "darktide-source.bad-fixture";
    return;
  }

  if (fixtureName === "mismatched-edge-source-snapshot-id") {
    (index.edges[0] as any).source_snapshot_id = "darktide-source.bad-fixture";
    return;
  }

  if (fixtureName === "mismatched-evidence-source-snapshot-id") {
    (index.evidence[0] as any).source_snapshot_id = "darktide-source.bad-fixture";
    return;
  }

  if (fixtureName === "edge-evidence-subject-mismatch") {
    const edge = index.edges.find((record) => record.evidence_ids.length > 0);
    if (!edge) {
      throw new Error("Need an edge with evidence ids to inject an evidence subject mismatch");
    }

    const evidenceRecord = index.evidence.find((record) => record.id === edge.evidence_ids[0])!;
    (evidenceRecord as any).subject_id = index.edges.find((record) => record.id !== edge.id)?.id ?? edge.id;
    return;
  }

  if (fixtureName === "orphaned-edge-subject-evidence") {
    const evidenceRecord = index.evidence.find((record) => record.subject_type === "edge");
    if (!evidenceRecord) {
      throw new Error("Need edge-subject evidence to inject an orphaned edge evidence record");
    }

    const edge = index.edges.find((record) => record.id === evidenceRecord.subject_id)!;
    (edge as any).evidence_ids = edge.evidence_ids.filter((id: string) => id !== evidenceRecord.id);
    return;
  }

  if (fixtureName === "missing-entity-ref-path") {
    const entity = index.entities.find((record) => (record as any).refs!.length > 0);
    if (!entity) {
      throw new Error("Need an entity with refs to inject a missing entity ref path");
    }

    (entity as any).refs = [{ path: "scripts/missing_ground_truth_fixture.lua", line: 1 }];
    return;
  }

  if (fixtureName === "missing-evidence-ref-path") {
    const evidenceRecord = index.evidence.find((record) => record.refs.length > 0);
    if (!evidenceRecord) {
      throw new Error("Need evidence with refs to inject a missing evidence ref path");
    }

    (evidenceRecord as any).refs = [{ path: "scripts/missing_ground_truth_fixture.lua", line: 1 }];
    return;
  }

  if (fixtureName === "out-of-range-entity-ref-line") {
    const entity = index.entities.find((record) => (record as any).refs!.length > 0);
    if (!entity) {
      throw new Error("Need an entity with refs to inject an out-of-range entity ref line");
    }

    (entity as any).refs = [{ ...(entity as any).refs![0], line: 999999 }];
    return;
  }

  if (fixtureName === "out-of-range-evidence-ref-line") {
    const evidenceRecord = index.evidence.find((record) => record.refs.length > 0);
    if (!evidenceRecord) {
      throw new Error("Need evidence with refs to inject an out-of-range evidence ref line");
    }

    (evidenceRecord as any).refs = [{ ...evidenceRecord.refs[0], line: 999999 }];
    return;
  }

  throw new Error(`Unknown bad fixture: ${fixtureName}`);
}

function buildMeta({ shardFiles, sourceSnapshot }: {
  shardFiles: ShardFiles;
  sourceSnapshot: SourceSnapshotInfo;
}): IndexMeta {
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

async function buildIndex(options: BuildIndexOptions = {}): Promise<GroundTruthIndex> {
  const {
    check = false,
    writeGenerated = false,
    injectBadFixture: badFixtureName,
  } = options;

  if (check && writeGenerated) {
    throw new Error("buildIndex cannot verify and write generated artifacts in the same call");
  }

  const sourceSnapshot = validateSourceSnapshot();

  const entityShards = readShardDirectory<EntityBaseSchemaJson>(ENTITIES_ROOT);
  const aliasShards = readShardDirectory<AliasSchemaJson>(ALIASES_ROOT);
  const edgeShards = readShardDirectory<EdgeSchemaJson>(EDGES_ROOT);
  const evidenceShards = readShardDirectory<EvidenceSchemaJson>(EVIDENCE_ROOT);

  validateRecords(entityShards.records as any, validateEntityRecord, "entity");
  validateRecords(edgeShards.records as any, validateEdgeRecord, "edge");
  validateRecords(evidenceShards.records as any, validateEvidenceRecord, "evidence");

  const aliases: AliasSchemaJson[] = [
    ...aliasShards.records.map(normalizeAliasRecord),
    ...materializeSyntheticAliases(entityShards.records),
  ];
  validateRecords(aliases as unknown as any, validateAliasRecord, "alias");

  ensureUniqueIds(entityShards.records as any, "entity");
  ensureUniqueIds(edgeShards.records as any, "edge");
  ensureUniqueIds(evidenceShards.records as any, "evidence");

  const index: GroundTruthIndex = {
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

  ensureRecordSnapshotIds(index.entities as any, "entity", sourceSnapshot.id);
  ensureRecordSnapshotIds(index.edges as any, "edge", sourceSnapshot.id);
  ensureRecordSnapshotIds(index.evidence as any, "evidence", sourceSnapshot.id);
  ensureRefsResolve(index.entities as any, "entity", [REPO_ROOT, sourceSnapshot.source_root]);
  ensureRefsResolve(index.evidence as any, "evidence", [REPO_ROOT, sourceSnapshot.source_root]);
  ensureReferentialIntegrity(index);
  detectUnsafeAliasCollisions(index.aliases);

  mkdirSync(GENERATED_ROOT, { recursive: true });

  if (writeGenerated) {
    writeFileSync(GENERATED_INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`);
    writeFileSync(GENERATED_META_PATH, `${JSON.stringify(index.meta, null, 2)}\n`);
    return index;
  }

  if (!check) {
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

export { buildIndex };
