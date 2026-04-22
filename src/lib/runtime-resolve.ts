import { buildRuntimeIndex } from "./ground-truth-index.js";
import { resolveQueryWithIndex } from "./resolve.js";
import type { ResolveResult } from "./resolve.js";

let _runtimeIndex: ReturnType<typeof buildRuntimeIndex> | null = null;

export function getRuntimeIndex(): ReturnType<typeof buildRuntimeIndex> {
  if (_runtimeIndex) {
    return _runtimeIndex;
  }

  _runtimeIndex = buildRuntimeIndex();
  return _runtimeIndex;
}

export function invalidateRuntimeIndex(): void {
  _runtimeIndex = null;
}

export async function resolveQueryFromShippedData(
  query: string,
  queryContext: unknown,
): Promise<ResolveResult> {
  return resolveQueryWithIndex(query, queryContext, getRuntimeIndex());
}
