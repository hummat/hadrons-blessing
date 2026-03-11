const ALLOWED_QUERY_CONTEXT_KEYS = new Set([
  "domain",
  "kind",
  "class",
  "weapon_family",
  "slot",
  "source",
]);

function normalizeText(input) {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[_/-]+/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function assertAllowedQueryContext(context) {
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

  return context;
}

export { ALLOWED_QUERY_CONTEXT_KEYS, assertAllowedQueryContext, normalizeText };
