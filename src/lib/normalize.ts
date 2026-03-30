import type { QueryContextSchemaJson } from "../generated/schema-types.js";

export type QueryContext = QueryContextSchemaJson;

const ALLOWED_QUERY_CONTEXT_KEYS: ReadonlySet<string> = new Set([
  "domain",
  "kind",
  "class",
  "weapon_family",
  "slot",
  "source",
]);

function normalizeText(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[_/-]+/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function assertAllowedQueryContext(context: unknown): QueryContext {
  if (context == null) {
    return {};
  }

  if (typeof context !== "object" || Array.isArray(context)) {
    throw new TypeError("query_context must be an object");
  }

  for (const key of Object.keys(context)) {
    if (!ALLOWED_QUERY_CONTEXT_KEYS.has(key)) {
      throw new TypeError(`Unsupported query_context key: ${key}`);
    }
  }

  return context as QueryContext;
}

export { ALLOWED_QUERY_CONTEXT_KEYS, assertAllowedQueryContext, normalizeText };
