// @ts-nocheck
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { loadGroundTruthRegistry } from "./registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPORT_PATH = join(__dirname, "..", "..", "data", "exports", "bot-weapon-recommendations.json");

describe("bot-weapon-recommendations export", () => {
  it("checked-in artifact is valid JSON with expected schema", () => {
    const data = JSON.parse(readFileSync(EXPORT_PATH, "utf8"));

    assert.equal(data.schema_version, 1);
    assert.equal(data.assumes, "betterbots");
    assert.ok(typeof data.generated_at === "string");
    assert.ok(data.generated_at.length > 0);

    const expectedClasses = ["veteran", "zealot", "psyker", "ogryn"];
    for (const cls of expectedClasses) {
      assert.ok(data.classes[cls], `missing class: ${cls}`);
      assert.ok(data.classes[cls].melee, `missing ${cls}.melee`);
      assert.ok(data.classes[cls].ranged, `missing ${cls}.ranged`);
    }
  });

  it("every weapon entry has required fields", () => {
    const data = JSON.parse(readFileSync(EXPORT_PATH, "utf8"));
    const requiredFields = [
      "template_id",
      "display_name",
      "canonical_entity_id",
      "gestalt",
      "source_builds",
      "bot_notes",
    ];

    for (const [cls, slots] of Object.entries(data.classes)) {
      for (const [slot, weapon] of Object.entries(slots)) {
        for (const field of requiredFields) {
          assert.ok(
            weapon[field] !== undefined,
            `${cls}.${slot} missing field: ${field}`,
          );
        }

        assert.ok(
          weapon.canonical_entity_id.startsWith("shared.weapon."),
          `${cls}.${slot} entity ID should start with shared.weapon.`,
        );
        assert.ok(
          ["linesman", "killshot", "none"].includes(weapon.gestalt),
          `${cls}.${slot} invalid gestalt: ${weapon.gestalt}`,
        );
      }
    }
  });

  it("all template IDs resolve to existing weapon entities", () => {
    const data = JSON.parse(readFileSync(EXPORT_PATH, "utf8"));
    const registry = loadGroundTruthRegistry();
    const entityIds = new Set(registry.entities.map((e) => e.id));

    for (const [cls, slots] of Object.entries(data.classes)) {
      for (const [slot, weapon] of Object.entries(slots)) {
        assert.ok(
          entityIds.has(weapon.canonical_entity_id),
          `${cls}.${slot}: entity ${weapon.canonical_entity_id} not in ground-truth`,
        );
      }
    }
  });
});

describe("export:bot-weapons CLI", () => {
  it("runs without error", () => {
    const tmp = mkdtempSync(join(tmpdir(), "bot-weapons-"));
    const outPath = join(tmp, "bot-weapon-recommendations.json");
    try {
      const result = spawnSync(
        "tsx",
        ["src/cli/export-bot-weapons.ts", outPath],
        { encoding: "utf8", timeout: 10_000 },
      );
      assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
      assert.ok(result.stdout.includes("Wrote"), `unexpected output: ${result.stdout}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
