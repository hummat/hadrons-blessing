import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildBreakpointPanels,
  buildBreakpointActionLabels,
  buildSelectionLabelMap,
  formatCoverageFraction,
  formatCoverageLabel,
  formatSelectionList,
  formatSelectionText,
  summarizeNameCounts,
} from "./detail-format.ts";
import type { BuildDetailData } from "./types.ts";

function makeDetail(): BuildDetailData {
  return {
    slug: "sample",
    summary: {
      file: "sample.json",
      title: "Sample",
      class: "psyker",
      ability: "Scrier's Gaze",
      keystone: "Warp Siphon",
      weapons: [
        { name: "Force Sword", slot: "melee", family: "forcesword" },
        { name: "Inferno Staff", slot: "ranged", family: "forcestaff" },
      ],
      scores: {
        composite: 30,
        grade: "A",
        perk_optimality: 5,
        curio_efficiency: 4,
        talent_coherence: 4,
        blessing_synergy: 5,
        role_coverage: 4,
        breakpoint_relevance: 5,
        difficulty_scaling: 4,
      },
    },
    scorecard: {
      title: "Sample",
      class: "psyker",
      perk_optimality: 5,
      curio_efficiency: 4,
      composite_score: 30,
      letter_grade: "A",
      weapons: [
        {
          name: "Force Sword",
          slot: "melee",
          canonical_entity_id: "shared.weapon.forcesword",
          internal_name: null,
          weapon_family: null,
          resolution_source: null,
          perks: { score: 5, perks: [] },
          blessings: { valid: true, blessings: [] },
        },
        {
          name: "Inferno Staff",
          slot: "ranged",
          canonical_entity_id: "shared.weapon.inferno_staff",
          internal_name: null,
          weapon_family: null,
          resolution_source: null,
          perks: { score: 4, perks: [] },
          blessings: { valid: true, blessings: [] },
        },
      ],
      curios: { score: 4, perks: [] },
      qualitative: {
        blessing_synergy: null,
        talent_coherence: null,
        breakpoint_relevance: null,
        role_coverage: null,
        difficulty_scaling: null,
      },
      bot_flags: [],
    },
    synergy: {
      build: "Sample",
      class: "psyker",
      synergy_edges: [],
      anti_synergies: [],
      orphans: [],
      coverage: {
        family_profile: {},
        slot_balance: {
          melee: { families: [], strength: 0 },
          ranged: { families: [], strength: 0 },
        },
        build_identity: [],
        coverage_gaps: [],
        concentration: 0,
      },
      _resolvedIds: [],
      metadata: {
        entities_analyzed: 0,
        unique_entities_with_calc: 0,
        entities_without_calc: 0,
        opaque_conditions: 0,
        calc_coverage_pct: 0.51,
      },
    },
    breakpoints: {
      weapons: [
        {
          entityId: "shared.weapon.forcesword",
          slot: 1,
          actions: [
            { type: "light_attack", profileId: "light_force_sword_a", scenarios: {} },
            { type: "light_attack", profileId: "light_force_sword_b", scenarios: {} },
            { type: "heavy_attack", profileId: "heavy_force_sword", scenarios: {} },
          ],
          summary: { bestLight: null, bestHeavy: null, bestSpecial: null },
        },
      ],
      metadata: { quality: 0.8, scenarios: ["sustained"], timestamp: "now" },
    },
    structure: {
      slots: {
        ability: { id: "psyker.ability.scriers_gaze", name: "Scrier's Gaze" },
        blitz: { id: null, name: null },
        aura: { id: null, name: null },
        keystone: { id: "psyker.keystone.warp_siphon", name: "Warp Siphon" },
      },
      talents: [
        { id: "shared.stat_node.toughness_boost", name: "Toughness Boost 4" },
        { id: "shared.stat_node.toughness_boost", name: "Toughness Boost 5" },
        { id: "psyker.talent.warp_rider", name: "Warp Rider" },
      ],
      weapons: [
        {
          id: "shared.weapon.forcesword",
          name: "Force Sword",
          slot: "melee",
          family: "forcesword",
          blessings: [{ id: "shared.name_family.blessing.wrath", name: "Wrath" }],
        },
        {
          id: "shared.weapon.inferno_staff",
          name: "Inferno Staff",
          slot: "ranged",
          family: "forcestaff",
          blessings: [],
        },
      ],
      curio_perks: [
        { id: "shared.gadget_trait.gadget_toughness_increase", name: "+17% Toughness" },
      ],
    },
  };
}

describe("detail-format", () => {
  it("maps known selection ids to display names and falls back cleanly for duplicate generic ids", () => {
    const labels = buildSelectionLabelMap(makeDetail());
    assert.equal(labels.get("psyker.ability.scriers_gaze"), "Scrier's Gaze");
    assert.equal(labels.get("shared.weapon.forcesword"), "Force Sword");
    assert.equal(labels.get("shared.name_family.blessing.wrath"), "Wrath");
    assert.equal(labels.get("shared.stat_node.toughness_boost"), "Toughness Boost");
  });

  it("formats selection ids and coverage labels for UI", () => {
    const labels = buildSelectionLabelMap(makeDetail());
    assert.equal(formatSelectionText("psyker.talent.warp_rider", labels), "Warp Rider");
    assert.equal(formatSelectionText("shared.name_family.blessing.warp_charge_power_bonus", labels), "Warp Charge Power Bonus");
    assert.deepEqual(
      formatSelectionList([
        "psyker.talent.warp_rider",
        "shared.name_family.blessing.wrath",
      ], labels),
      ["Warp Rider", "Wrath"],
    );
    assert.equal(formatCoverageLabel("warp_resource"), "Warp resource");
    assert.equal(formatCoverageLabel("crit_chance_source"), "Crit chance source");
  });

  it("formats fractional coverage as a percent string", () => {
    assert.equal(formatCoverageFraction(0.51), "51%");
    assert.equal(formatCoverageFraction(0), "0%");
    assert.equal(formatCoverageFraction(null), "—");
  });

  it("maps known blessing slugs to human names", async () => {
    const module = (await import("./detail-format.ts")) as Record<string, unknown>;
    assert.equal(typeof module.blessingNameFromSlug, "function");

    const blessingNameFromSlug = module.blessingNameFromSlug as (slug: string, map: Record<string, string>) => string;
    assert.equal(
      blessingNameFromSlug("rising_heat", {
        rising_heat: "Rising Heat",
        increase_power_on_kill: "Power Cycler",
      }),
      "Rising Heat",
    );
  });

  it("falls back to title-cased blessing slugs when no build name exists", async () => {
    const module = (await import("./detail-format.ts")) as Record<string, unknown>;
    assert.equal(typeof module.blessingNameFromSlug, "function");

    const blessingNameFromSlug = module.blessingNameFromSlug as (slug: string, map: Record<string, string>) => string;
    assert.equal(blessingNameFromSlug("increase_power_on_kill", {}), "Increase Power On Kill");
  });

  it("leaves non-blessing explanations unchanged", async () => {
    const module = (await import("./detail-format.ts")) as Record<string, unknown>;
    assert.equal(typeof module.rewriteExplanation, "function");

    const rewriteExplanation = module.rewriteExplanation as (
      key: string,
      explanation: string,
      blessingMap: Record<string, string>,
    ) => string;
    assert.equal(
      rewriteExplanation("talent_coherence", "Strong tree routing.", {
        rising_heat: "Rising Heat",
      }),
      "Strong tree routing.",
    );
  });

  it("rewrites blessing synergy explanations with human blessing names", async () => {
    const module = (await import("./detail-format.ts")) as Record<string, unknown>;
    assert.equal(typeof module.rewriteExplanation, "function");

    const rewriteExplanation = module.rewriteExplanation as (
      key: string,
      explanation: string,
      blessingMap: Record<string, string>,
    ) => string;
    assert.equal(
      rewriteExplanation(
        "blessing_synergy",
        "Blessings with synergy edges: increase_power_on_kill, rising_heat, unknown_slug",
        {
          increase_power_on_kill: "Power Cycler",
          rising_heat: "Rising Heat",
        },
      ),
      "Connected blessings: Power Cycler, Rising Heat, Unknown Slug",
    );
  });

  it("builds human action labels without exposing raw profile ids", () => {
    const labels = buildBreakpointActionLabels(makeDetail().breakpoints.weapons[0]);
    assert.deepEqual(labels, ["Light Attack 1", "Light Attack 2", "Heavy Attack"]);
  });

  it("builds breakpoint panels for every scored weapon and defaults them open", () => {
    const panels = buildBreakpointPanels(makeDetail());
    assert.deepEqual(
      panels.map((panel) => ({
        name: panel.name,
        slot: panel.slot,
        hasWeapon: panel.weapon != null,
        defaultOpen: panel.defaultOpen,
        status: panel.status,
      })),
      [
        { name: "Force Sword", slot: "melee", hasWeapon: true, defaultOpen: true, status: "supported" },
        { name: "Inferno Staff", slot: "ranged", hasWeapon: false, defaultOpen: true, status: "missing" },
      ],
    );
  });

  it("anchors breakpoint panels on structure weapon ids when scorecard ids drift", () => {
    const detail = makeDetail();
    detail.scorecard.weapons[0].canonical_entity_id = "shared.weapon.wrong_id";
    detail.structure.weapons = [
      {
        id: "shared.weapon.forcesword",
        name: "Force Sword",
        slot: "melee",
        family: "forcesword",
        blessings: [],
      },
      {
        id: "shared.weapon.inferno_staff",
        name: "Inferno Staff",
        slot: "ranged",
        family: "forcestaff",
        blessings: [],
      },
    ];

    const panels = buildBreakpointPanels(detail);
    assert.equal(panels[0].entityId, "shared.weapon.forcesword");
    assert.equal(panels[0].weapon?.entityId, "shared.weapon.forcesword");
    assert.equal(panels[1].entityId, "shared.weapon.inferno_staff");
  });

  it("marks ranged panels without shoot actions as unsupported instead of showing a fake matrix", () => {
    const detail = makeDetail();
    detail.breakpoints.weapons.push({
      entityId: "shared.weapon.inferno_staff",
      slot: 2,
      actions: [
        { type: "light_attack", profileId: "force_staff_bash", scenarios: {} },
        { type: "heavy_attack", profileId: "heavy_force_staff_bash", scenarios: {} },
      ],
      summary: { bestLight: null, bestHeavy: null, bestSpecial: null },
    });

    const infernoStaffPanel = buildBreakpointPanels(detail).find((panel) => panel.entityId === "shared.weapon.inferno_staff");
    assert.ok(infernoStaffPanel);
    assert.equal(infernoStaffPanel.status, "unsupported");
    assert.match(infernoStaffPanel.message ?? "", /not modeled/i);
  });

  it("summarizes duplicate display names while preserving first-seen order", () => {
    assert.deepEqual(
      summarizeNameCounts([
        { name: "+17% Toughness" },
        { name: "+4% Combat Ability Regeneration" },
        { name: "+17% Toughness" },
        { name: "+17% Toughness" },
      ]),
      [
        { name: "+17% Toughness", count: 3 },
        { name: "+4% Combat Ability Regeneration", count: 1 },
      ],
    );
  });
});
