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

function normalizeClassContextValue(input: string): string {
  const normalized = normalizeText(input);

  if (normalized === "adamant" || normalized === "arbites") {
    return "arbites";
  }

  if (normalized === "broker" || normalized === "hive scum" || normalized === "hive") {
    return "hive scum";
  }

  return normalized;
}

function contextValueMatches(key: string, actual: unknown, expected: string): boolean {
  if (typeof actual !== "string") {
    return false;
  }

  if (key === "class") {
    return normalizeClassContextValue(actual) === normalizeClassContextValue(expected);
  }

  return actual === expected;
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

export {
  ALLOWED_QUERY_CONTEXT_KEYS,
  assertAllowedQueryContext,
  contextValueMatches,
  normalizeText,
};
