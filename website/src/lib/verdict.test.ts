import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { selectSignatureStrengths, buildRiskBullets, type RiskBullet } from "./verdict.ts";
import type { BuildDetailData, BuildScores, ScorecardQualitative } from "./types.ts";

function makeQualitative(overrides: Partial<Record<keyof ScorecardQualitative, { score: number; explanation: string } | null>> = {}): ScorecardQualitative {
  const build = (key: keyof ScorecardQualitative) => {
    const entry = overrides[key];
    if (entry === undefined) {
      return { score: 3, breakdown: {}, explanations: [`${key} baseline`] };
    }
    if (entry === null) return null;
    return { score: entry.score, breakdown: {}, explanations: [entry.explanation] };
  };
  return {
    talent_coherence: build("talent_coherence"),
    blessing_synergy: build("blessing_synergy"),
    role_coverage: build("role_coverage"),
    breakpoint_relevance: build("breakpoint_relevance"),
    difficulty_scaling: build("difficulty_scaling"),
  };
}

const BASE_SCORES: BuildScores = {
  composite: 20,
  grade: "B",
  perk_optimality: 3,
  curio_efficiency: 3,
  talent_coherence: 3,
  blessing_synergy: 3,
  role_coverage: 3,
  breakpoint_relevance: 3,
  difficulty_scaling: 3,
};

describe("selectSignatureStrengths", () => {
  it("returns the two highest-scoring qualitative dimensions when both are >= 4", () => {
    const qualitative = makeQualitative({
      talent_coherence: { score: 5, explanation: "Strong tree." },
      blessing_synergy: { score: 4, explanation: "Good blessings." },
      role_coverage: { score: 2, explanation: "Narrow." },
    });
    const result = selectSignatureStrengths(qualitative, { ...BASE_SCORES, talent_coherence: 5, blessing_synergy: 4, role_coverage: 2 });

    assert.equal(result.length, 2);
    assert.equal(result[0].key, "talent_coherence");
    assert.equal(result[0].score, 5);
    assert.equal(result[0].explanation, "Strong tree.");
    assert.equal(result[1].key, "blessing_synergy");
    assert.equal(result[1].score, 4);
  });

  it("returns one strength when only one dimension is >= 4", () => {
    const qualitative = makeQualitative({
      talent_coherence: { score: 5, explanation: "Strong tree." },
    });
    const result = selectSignatureStrengths(qualitative, { ...BASE_SCORES, talent_coherence: 5 });

    assert.equal(result.length, 1);
    assert.equal(result[0].key, "talent_coherence");
  });

  it("falls back to the single highest dimension when none are >= 4", () => {
    const qualitative = makeQualitative({
      talent_coherence: { score: 3, explanation: "Fine tree." },
      blessing_synergy: { score: 2, explanation: "Meh." },
      role_coverage: { score: 1, explanation: "Narrow." },
    });
    const result = selectSignatureStrengths(qualitative, { ...BASE_SCORES, talent_coherence: 3, blessing_synergy: 2, role_coverage: 1 });

    assert.equal(result.length, 1);
    assert.equal(result[0].key, "talent_coherence");
    assert.equal(result[0].score, 3);
  });

  it("skips null dimensions in both ranking passes", () => {
    const qualitative = makeQualitative({
      talent_coherence: null,
      blessing_synergy: { score: 4, explanation: "Good blessings." },
    });
    const scores: BuildScores = { ...BASE_SCORES, talent_coherence: null, blessing_synergy: 4 };
    const result = selectSignatureStrengths(qualitative, scores);

    assert.equal(result.length, 1);
    assert.equal(result[0].key, "blessing_synergy");
  });

  it("breaks score ties by QUALITATIVE_LABELS insertion order", () => {
    const qualitative = makeQualitative({
      talent_coherence: { score: 4, explanation: "tc" },
      blessing_synergy: { score: 4, explanation: "bs" },
    });
    const scores: BuildScores = { ...BASE_SCORES, talent_coherence: 4, blessing_synergy: 4 };
    const result = selectSignatureStrengths(qualitative, scores);

    assert.equal(result.length, 2);
    assert.equal(result[0].key, "talent_coherence");
    assert.equal(result[1].key, "blessing_synergy");
  });

  it("returns empty array when every qualitative dimension is null", () => {
    const qualitative = makeQualitative({
      talent_coherence: null,
      blessing_synergy: null,
      role_coverage: null,
      breakpoint_relevance: null,
      difficulty_scaling: null,
    });
    const scores: BuildScores = {
      ...BASE_SCORES,
      talent_coherence: null,
      blessing_synergy: null,
      role_coverage: null,
      breakpoint_relevance: null,
      difficulty_scaling: null,
    };
    assert.deepEqual(selectSignatureStrengths(qualitative, scores), []);
  });
});

function makeDetail(overrides: {
  qualitative?: Partial<ScorecardQualitative>;
  scores?: Partial<BuildScores>;
  coverageGaps?: string[];
  antiSynergies?: number;
  orphans?: number;
  calcCoveragePct?: number | null;
} = {}): BuildDetailData {
  return {
    slug: "test",
    summary: {
      file: "test.json",
      title: "Test",
      class: "zealot",
      ability: null,
      keystone: null,
      weapons: [],
      scores: {
        composite: 20,
        grade: "B",
        perk_optimality: 3,
        curio_efficiency: 3,
        talent_coherence: 3,
        blessing_synergy: 3,
        role_coverage: 3,
        breakpoint_relevance: 3,
        difficulty_scaling: 3,
        ...(overrides.scores ?? {}),
      },
    },
    scorecard: {
      title: "Test",
      class: "zealot",
      perk_optimality: 3,
      curio_efficiency: 3,
      composite_score: 20,
      letter_grade: "B",
      weapons: [],
      curios: { score: 3, perks: [] },
      qualitative: {
        talent_coherence: { score: 3, breakdown: {}, explanations: ["tc"] },
        blessing_synergy: { score: 3, breakdown: {}, explanations: ["bs"] },
        role_coverage: { score: 3, breakdown: {}, explanations: ["rc"] },
        breakpoint_relevance: { score: 3, breakdown: {}, explanations: ["br"] },
        difficulty_scaling: { score: 3, breakdown: {}, explanations: ["ds"] },
        ...(overrides.qualitative ?? {}),
      },
      bot_flags: [],
    },
    synergy: {
      build: "test",
      class: "zealot",
      synergy_edges: [],
      anti_synergies: Array.from({ length: overrides.antiSynergies ?? 0 }, () => ({
        type: "x", selections: [], reason: "r", severity: "minor",
      })),
      orphans: Array.from({ length: overrides.orphans ?? 0 }, () => ({
        selection: "s", reason: "r", condition: "c",
      })),
      coverage: {
        family_profile: {},
        slot_balance: { melee: { families: [], strength: 0 }, ranged: { families: [], strength: 0 } },
        build_identity: [],
        coverage_gaps: overrides.coverageGaps ?? [],
        concentration: 0,
      },
      _resolvedIds: [],
      metadata: {
        entities_analyzed: 10,
        unique_entities_with_calc: 4,
        entities_without_calc: 6,
        opaque_conditions: 0,
        // Default is well above the 0.6 low-coverage threshold so tests that
        // assert "clean verdict" don't accidentally trip the low-coverage risk.
        calc_coverage_pct: overrides.calcCoveragePct === undefined ? 0.85 : overrides.calcCoveragePct,
      },
    },
    breakpoints: { weapons: [], metadata: { quality: 380, scenarios: [], timestamp: "" } },
    structure: {
      slots: {
        ability: { id: null, name: null },
        blitz: { id: null, name: null },
        aura: { id: null, name: null },
        keystone: { id: null, name: null },
      },
      talents: [],
      weapons: [],
      curio_perks: [],
    },
  };
}

describe("buildRiskBullets", () => {
  it("adds a low-dimension bullet when a qualitative score is <= 2", () => {
    const detail = makeDetail({
      qualitative: { role_coverage: { score: 2, breakdown: {}, explanations: ["Narrow role."] } },
      scores: { role_coverage: 2 },
    });
    const bullets = buildRiskBullets(detail);
    assert.ok(bullets.some((b) => b.kind === "low_dimension" && b.text.includes("Role Coverage 2/5")));
  });

  it("does NOT add a low-dimension bullet when every qualitative score is >= 3", () => {
    const detail = makeDetail();
    const bullets = buildRiskBullets(detail);
    assert.ok(!bullets.some((b) => b.kind === "low_dimension"));
  });

  it("adds a gaps bullet when coverage_gaps is non-empty", () => {
    const detail = makeDetail({ coverageGaps: ["survivability", "crit_chance_source"] });
    const bullets = buildRiskBullets(detail);
    const gap = bullets.find((b) => b.kind === "gaps");
    assert.ok(gap);
    assert.equal(gap.text, "Gaps: Survivability \u00b7 Crit chance source");
  });

  it("omits the gaps bullet when coverage_gaps is empty", () => {
    const detail = makeDetail({ coverageGaps: [] });
    const bullets = buildRiskBullets(detail);
    assert.ok(!bullets.some((b) => b.kind === "gaps"));
  });

  it("adds an anti/orphan bullet only when totals > 0", () => {
    const zero = buildRiskBullets(makeDetail());
    assert.ok(!zero.some((b) => b.kind === "anti_orphan"));

    const some = buildRiskBullets(makeDetail({ antiSynergies: 2, orphans: 1 }));
    const bullet = some.find((b) => b.kind === "anti_orphan");
    assert.ok(bullet);
    assert.equal(bullet.text, "2 anti-synergies \u00b7 1 isolated pick");
  });

  it("pluralizes isolated picks correctly", () => {
    const bullets = buildRiskBullets(makeDetail({ antiSynergies: 0, orphans: 3 }));
    const bullet = bullets.find((b) => b.kind === "anti_orphan");
    assert.equal(bullet?.text, "0 anti-synergies \u00b7 3 isolated picks");
  });

  it("formats calc_coverage_pct as a fraction 0..1 (not an already-scaled percent)", () => {
    const fifty = buildRiskBullets(makeDetail({ calcCoveragePct: 0.5 }));
    const fiftyBullet = fifty.find((b) => b.kind === "low_calc_coverage");
    assert.ok(fiftyBullet, "0.5 should emit a low-coverage risk bullet");
    assert.ok(fiftyBullet.text.includes("50%"), `expected "50%" in ${fiftyBullet.text}`);

    const full = buildRiskBullets(makeDetail({ calcCoveragePct: 1 }));
    const fullBullet = full.find((b) => b.kind === "calc_coverage");
    assert.ok(fullBullet);
    assert.equal(fullBullet.text, "Calc coverage 100%");

    const high = buildRiskBullets(makeDetail({ calcCoveragePct: 0.85 }));
    const highBullet = high.find((b) => b.kind === "calc_coverage");
    assert.equal(highBullet?.text, "Calc coverage 85%");
  });

  it("rounds (not truncates) fractional percentages", () => {
    const bullets = buildRiskBullets(makeDetail({ calcCoveragePct: 0.384 }));
    const bullet = bullets.find((b) => b.kind === "low_calc_coverage");
    assert.ok(bullet);
    assert.ok(bullet.text.includes("38%"), `expected rounded "38%" in ${bullet.text}`);
  });

  it("emits a low-coverage risk bullet (not an informational one) when below the 0.6 threshold", () => {
    const bullets = buildRiskBullets(makeDetail({ calcCoveragePct: 0.38 }));
    assert.ok(bullets.some((b) => b.kind === "low_calc_coverage"));
    assert.ok(!bullets.some((b) => b.kind === "calc_coverage"));
  });

  it("low calc coverage suppresses the clean verdict even when everything else is fine", () => {
    // This is the Codex audit finding: 41% / 49% coverage builds were reading as "clean".
    const bullets = buildRiskBullets(makeDetail({ calcCoveragePct: 0.41 }));
    assert.ok(!bullets.some((b) => b.kind === "clean"),
      "low calc coverage must suppress the clean fallback");
    assert.ok(bullets.some((b) => b.kind === "low_calc_coverage"));
  });

  it("emits calc_coverage_missing (and no clean) when coverage is null or NaN", () => {
    const missing = buildRiskBullets(makeDetail({ calcCoveragePct: null }));
    assert.ok(missing.some((b) => b.kind === "calc_coverage_missing"));
    assert.ok(!missing.some((b) => b.kind === "clean"));

    const nan = buildRiskBullets(makeDetail({ calcCoveragePct: NaN }));
    assert.ok(nan.some((b) => b.kind === "calc_coverage_missing"));
    assert.ok(!nan.some((b) => b.kind === "clean"));
  });

  it("emits scoring_unavailable (and no clean) when every qualitative dimension is null", () => {
    const detail = makeDetail({
      qualitative: {
        talent_coherence: null,
        blessing_synergy: null,
        role_coverage: null,
        breakpoint_relevance: null,
        difficulty_scaling: null,
      },
      scores: {
        talent_coherence: null,
        blessing_synergy: null,
        role_coverage: null,
        breakpoint_relevance: null,
        difficulty_scaling: null,
      },
    });
    const bullets = buildRiskBullets(detail);
    assert.ok(bullets.some((b) => b.kind === "scoring_unavailable"));
    assert.ok(!bullets.some((b) => b.kind === "clean"));
  });

  it("emits a single 'Clean verdict' plus informational calc coverage when no risks trigger", () => {
    const bullets = buildRiskBullets(makeDetail());
    assert.equal(bullets.length, 2);
    assert.equal(bullets[0].kind, "clean");
    assert.equal(bullets[0].text, "Clean verdict \u2014 no flagged risks");
    assert.equal(bullets[1].kind, "calc_coverage");
    assert.equal(bullets[1].text, "Calc coverage 85%");
  });

  it("places the informational calc_coverage bullet after all risks", () => {
    const bullets = buildRiskBullets(makeDetail({
      qualitative: { role_coverage: { score: 2, breakdown: {}, explanations: ["Narrow."] } },
      scores: { role_coverage: 2 },
    }));
    const last = bullets[bullets.length - 1];
    assert.equal(last.kind, "calc_coverage");
  });
});
