import type { KnownUnresolvedSchemaJson, QueryContextSchemaJson } from "../generated/schema-types.js";
import {
  NON_CANONICAL_ROOT,
  listJsonFiles,
  loadJsonFile,
} from "./load.js";
import { assertAllowedQueryContext, contextValueMatches, normalizeText } from "./normalize.js";
import { validateKnownUnresolvedRecord } from "./validate.js";

let _knownUnresolvedRecords: KnownUnresolvedSchemaJson[] | undefined;
const CURIO_VARIANT_SUFFIX_RE = /\s*\((?:caged|casket|reliquary)\)$/i;

function contextMatches(record: KnownUnresolvedSchemaJson, queryContext: QueryContextSchemaJson): boolean {
  for (const requirement of record.context_constraints.require_all) {
    if (!contextValueMatches(
      requirement.key,
      (queryContext as Record<string, unknown>)[requirement.key],
      requirement.value,
    )) {
      return false;
    }
  }

  return true;
}

function normalizeRecord(record: KnownUnresolvedSchemaJson): KnownUnresolvedSchemaJson {
  const normalizedText = normalizeText(record.text);
  if (record.normalized_text !== normalizedText) {
    throw new Error(
      `Known-unresolved normalized_text mismatch for ${record.text}: expected ${normalizedText}, got ${record.normalized_text}`,
    );
  }

  const result = validateKnownUnresolvedRecord(record);
  if (!result.ok) {
    throw new Error(
      `Invalid known-unresolved record ${record.text}: ${JSON.stringify(result.errors)}`,
    );
  }

  return record;
}

function loadKnownUnresolvedRecords(): KnownUnresolvedSchemaJson[] {
  if (_knownUnresolvedRecords) {
    return _knownUnresolvedRecords;
  }

  const records: KnownUnresolvedSchemaJson[] = [];

  for (const file of listJsonFiles(NON_CANONICAL_ROOT)) {
    const payload = loadJsonFile(file);
    if (!Array.isArray(payload)) {
      throw new Error(`Known-unresolved shard must be an array: ${file}`);
    }

    for (const record of payload as KnownUnresolvedSchemaJson[]) {
      records.push(normalizeRecord(record));
    }
  }

  _knownUnresolvedRecords = records;
  return _knownUnresolvedRecords;
}

function candidateNormalizedTexts(text: string, queryContext: QueryContextSchemaJson): string[] {
  const candidates = [normalizeText(text)];

  if (queryContext.kind === "gadget_item" && queryContext.slot === "curio") {
    const stripped = text.replace(CURIO_VARIANT_SUFFIX_RE, "");
    const normalizedStripped = normalizeText(stripped);

    if (normalizedStripped.length > 0 && normalizedStripped !== candidates[0]) {
      candidates.push(normalizedStripped);
    }
  }

  return candidates;
}

function classifyKnownUnresolved(text: string, queryContext: unknown): KnownUnresolvedSchemaJson | null {
  const safeQueryContext = assertAllowedQueryContext(queryContext);
  const normalizedTexts = candidateNormalizedTexts(text, safeQueryContext);
  const candidates = loadKnownUnresolvedRecords()
    .filter((record) => normalizedTexts.includes(record.normalized_text))
    .filter((record) => contextMatches(record, safeQueryContext))
    .sort(
      (left, right) =>
        right.context_constraints.require_all.length -
          left.context_constraints.require_all.length ||
        left.text.localeCompare(right.text),
    );

  return candidates[0] ?? null;
}

export { classifyKnownUnresolved, loadKnownUnresolvedRecords };
