import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { selectSignatureStrengths } from "./verdict.ts";
import type { BuildScores, ScorecardQualitative } from "./types.ts";

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
});
