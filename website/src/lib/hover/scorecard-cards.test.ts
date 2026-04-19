import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildPhaseAScoreHoverCards } from "./scorecard-cards.ts";
import { tierLabelForScore } from "./tiers.ts";
import type { BuildDetailData } from "../types.ts";

const root = resolve(import.meta.dirname, "../../..");

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8")) as T;
}

function loadDetail(slug: string): BuildDetailData {
  return readJson<BuildDetailData>(`static/data/builds/${slug}.json`);
}

function cloneDetail(detail: BuildDetailData): BuildDetailData {
  return JSON.parse(JSON.stringify(detail)) as BuildDetailData;
}

function findCard(detail: BuildDetailData, key: string) {
  const card = buildPhaseAScoreHoverCards(detail).find((entry) => entry.key === key);
  assert.ok(card, `expected card ${key}`);
  return card;
}

describe("tier labels", () => {
  it("uses the approved score labels", () => {
    assert.equal(tierLabelForScore(5), "Exemplary");
    assert.equal(tierLabelForScore(4), "Strong");
    assert.equal(tierLabelForScore(3), "Solid");
    assert.equal(tierLabelForScore(2), "Partial");
    assert.equal(tierLabelForScore(1), "Limited");
    assert.equal(tierLabelForScore(null), "Unscorable");
  });
});

describe("buildPhaseAScoreHoverCards", () => {
  it("matches the approved representative snapshot", () => {
    const detail = loadDetail("10-psyker-electrokinetic-staff");
    const actual = buildPhaseAScoreHoverCards(detail);
    const expected = readJson("src/lib/hover/__snapshots__/scorecard-cards.10-psyker-electrokinetic-staff.json");
    assert.deepEqual(actual, expected);
  });

  it("shows the specialist caveat only when role coverage is low or a gap is present", () => {
    const broadBuild = loadDetail("10-psyker-electrokinetic-staff");
    const broadRoleCard = findCard(broadBuild, "role_coverage");
    assert.ok(!broadRoleCard.facts.some((fact) => fact.label === "Specialist caveat"));

    const narrowBuild = cloneDetail(broadBuild);
    narrowBuild.summary.scores.role_coverage = 3;
    if (narrowBuild.scorecard.qualitative.role_coverage) {
      narrowBuild.scorecard.qualitative.role_coverage.score = 3;
      narrowBuild.scorecard.qualitative.role_coverage.breakdown = {
        active_families: 4,
        total_families: 11,
        coverage_gaps: [],
        slot_balance_ratio: 0.92,
      };
    }
    const narrowRoleCard = findCard(narrowBuild, "role_coverage");
    assert.ok(narrowRoleCard.facts.some((fact) => fact.label === "Specialist caveat"));

    const gappedBuild = cloneDetail(broadBuild);
    gappedBuild.synergy.coverage.coverage_gaps = ["crit_chance_source"];
    if (gappedBuild.scorecard.qualitative.role_coverage) {
      gappedBuild.scorecard.qualitative.role_coverage.breakdown = {
        active_families: 7,
        total_families: 11,
        coverage_gaps: ["crit_chance_source"],
        slot_balance_ratio: 0.88,
      };
    }
    const gappedRoleCard = findCard(gappedBuild, "role_coverage");
    assert.ok(gappedRoleCard.facts.some((fact) => fact.label === "Specialist caveat"));
  });

  it("marks the grade as provisional only below the 60% effect-modeled coverage threshold", () => {
    const detail = loadDetail("10-psyker-electrokinetic-staff");
    const stableComposite = findCard(detail, "composite");
    assert.ok(!stableComposite.facts.some((fact) => fact.label === "Coverage caveat"));

    const lowCoverage = cloneDetail(detail);
    lowCoverage.synergy.metadata.calc_coverage_pct = 0.59;
    const provisionalComposite = findCard(lowCoverage, "composite");
    assert.ok(
      provisionalComposite.facts.some(
        (fact) =>
          fact.label === "Coverage caveat" &&
          /letter can overstate the build/i.test(fact.value),
      ),
    );
  });
});
