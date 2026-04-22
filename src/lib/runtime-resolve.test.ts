import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import {
  getRuntimeIndex,
  invalidateRuntimeIndex,
  resolveQueryFromShippedData,
} from "./runtime-resolve.js";

const HAS_SOURCE = typeof process.env.GROUND_TRUTH_SOURCE_ROOT === "string"
  && process.env.GROUND_TRUTH_SOURCE_ROOT.length > 0;

describe("runtime-resolve", { skip: !HAS_SOURCE && "requires GROUND_TRUTH_SOURCE_ROOT" }, () => {
  before(() => {
    invalidateRuntimeIndex();
  });

  after(() => {
    invalidateRuntimeIndex();
  });

  it("memoizes the runtime index across calls", () => {
    const first = getRuntimeIndex();
    const second = getRuntimeIndex();
    assert.equal(first, second, "getRuntimeIndex must return the same instance on repeat calls");
  });

  it("invalidateRuntimeIndex clears the cache", () => {
    const before = getRuntimeIndex();
    invalidateRuntimeIndex();
    const after = getRuntimeIndex();
    assert.notEqual(before, after, "after invalidation a fresh index should be built");
  });

  it("resolveQueryFromShippedData returns a resolve result for a known class name", async () => {
    const result = await resolveQueryFromShippedData("Zealot", { kind: "class" });
    assert.ok(result, "resolver must return a result");
    assert.ok(
      typeof result.resolution_state === "string" && result.resolution_state.length > 0,
      "resolution_state must be populated",
    );
  });

  it("rejects a disallowed query_context key via the underlying resolver", async () => {
    await assert.rejects(
      () => resolveQueryFromShippedData("Anything", { not_a_key: "x" } as unknown as Record<string, string>),
      /query_context|Unsupported/,
    );
  });
});
