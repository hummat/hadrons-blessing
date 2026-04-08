import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { registryForClass } from "./build-classification-registry.js";

describe("registryForClass", () => {
  it("treats hive_scum as the broker registry alias", () => {
    const brokerRegistry = {
      "vultures-mark": { slot: "keystone", kind: "keystone" as const },
    };
    const hiveScumRegistry = {
      "anarchist": { slot: "aura", kind: "aura" as const },
    };

    const registry = registryForClass("hive_scum", {
      broker: brokerRegistry,
      "hive scum": hiveScumRegistry,
    });

    assert.equal(registry, brokerRegistry);
  });
});
