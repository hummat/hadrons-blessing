import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  ALIASES_ROOT,
  EDGES_ROOT,
  ENTITIES_ROOT,
  EVIDENCE_ROOT,
  GENERATED_ROOT,
  listJsonFiles,
  loadJsonFile,
} from "./ground-truth/lib/load.mjs";
import { normalizeText } from "./ground-truth/lib/normalize.mjs";
import {
  validateAliasRecord,
  validateEdgeRecord,
  validateEntityRecord,
  validateEvidenceRecord,
  validateSourceSnapshot,
} from "./ground-truth/lib/validate.mjs";

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
  if (fixtureName !== "overlapping-fuzzy-collision") {
    throw new Error(`Unknown bad fixture: ${fixtureName}`);
  }

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
  await buildIndex(parseArgs(process.argv.slice(2)));
}

export { buildIndex };
