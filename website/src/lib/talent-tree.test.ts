import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTalentTreeSpecs, isTalentTreeNodeSelected } from "./talent-tree.ts";

describe("isTalentTreeNodeSelected", () => {
  it("matches stat nodes through their shared family ids", () => {
    const selected = new Set(["shared.stat_node.toughness_boost"]);

    assert.equal(
      isTalentTreeNodeSelected(
        {
          entity_id: "zealot.talent.base_toughness_node_buff_medium_2",
          selection_ids: [
            "zealot.talent.base_toughness_node_buff_medium_2",
            "shared.stat_node.toughness_boost",
          ],
        },
        selected,
      ),
      true,
    );
  });

  it("falls back to entity_id when alternate selection ids are absent", () => {
    const selected = new Set(["zealot.talent.zealot_alpha"]);

    assert.equal(
      isTalentTreeNodeSelected(
        { entity_id: "zealot.talent.zealot_alpha" },
        selected,
      ),
      true,
    );
  });
});

describe("buildTalentTreeSpecs", () => {
  it("returns a single class lattice for normal classes", () => {
    assert.deepEqual(
      buildTalentTreeSpecs("zealot", ["zealot.talent.zealot_alpha"]),
      [{ treeId: "zealot", title: "Talent lattice" }],
    );
  });

  it("adds the broker stimm lattice when a hive scum build includes stimm picks", () => {
    assert.deepEqual(
      buildTalentTreeSpecs("hive_scum", [
        "hive_scum.talent.broker_passive_first_target_damage",
        "hive_scum.talent.broker_stimm_combat_1",
      ]),
      [
        { treeId: "hive_scum", title: "Talent lattice" },
        { treeId: "hive_scum-stimm", title: "Stimm lattice" },
      ],
    );
  });
});
