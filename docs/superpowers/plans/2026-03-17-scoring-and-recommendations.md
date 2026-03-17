# Build Quality Scoring & Modification Recommendations Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the 3 qualitative null stubs in `generateScorecard()` with synergy-backed 1–5 scores (#9), and add gap analysis + talent/weapon swap recommendations (#10).

**Architecture:** New `build-scoring.mjs` scores synergy output into 3 dimensions. New `build-recommendations.mjs` imports scoring + synergy model to compute swap deltas and coverage gap analysis. CLI entry point `recommend-build.mjs` with formatter layer. Existing `score-build.mjs` orchestrates both mechanical and qualitative scoring.

**Tech Stack:** Node.js ESM, `node:test` for tests, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-03-17-scoring-and-recommendations-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `scripts/ground-truth/lib/build-scoring.mjs` | Create | `scoreFromSynergy()` — synergy output → 3 qualitative 1–5 scores with breakdowns and explanations |
| `scripts/build-scoring.test.mjs` | Create | Unit tests for scoring formulas + golden snapshot tests |
| `scripts/score-build.mjs` | Modify (lines 684–747) | Import `build-scoring.mjs`, wire into `generateScorecard()`, add composite score + letter grade |
| `scripts/ground-truth/lib/build-recommendations.mjs` | Create | `analyzeGaps()`, `swapTalent()`, `swapWeapon()` |
| `scripts/build-recommendations.test.mjs` | Create | Unit + golden tests for recommendations |
| `scripts/ground-truth/lib/recommend-formatter.mjs` | Create | Text/markdown/JSON output formatting |
| `scripts/recommend-build.mjs` | Create | CLI entry point for `npm run recommend` |
| `package.json` | Modify | Add `build-scoring.test.mjs`, `build-recommendations.test.mjs` to test script; add `score`, `recommend`, and `score:freeze` scripts |
| `tests/fixtures/ground-truth/scores/` | Create dir + files | Frozen golden score snapshots |

---

## Task 1: Scoring Module — `talent_coherence`

**Files:**
- Create: `scripts/ground-truth/lib/build-scoring.mjs`
- Create: `scripts/build-scoring.test.mjs`

- [ ] **Step 1: Write failing test for `scoreTalentCoherence` with synthetic synergy data**

```js
// scripts/build-scoring.test.mjs
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { scoreFromSynergy } from "./ground-truth/lib/build-scoring.mjs";

describe("build-scoring", () => {
  describe("talent_coherence", () => {
    it("scores high for dense talent-talent edges", () => {
      // 5 talents, 10 edges between them = edges_per_talent = 2.0
      const synergy = makeSynergyOutput({
        talentIds: ["t.talent.a", "t.talent.b", "t.talent.c", "t.talent.d", "t.talent.e"],
        blessingIds: ["shared.name_family.blessing.x"],
        talentEdges: 10,
        blessingEdges: 3,
        orphans: [],
        concentration: 0.08,
        familyCount: 8,
        coverageGaps: [],
        slotBalance: { melee: 5, ranged: 5 },
      });
      const result = scoreFromSynergy(synergy);
      assert.ok(result.talent_coherence.score >= 4);
    });

    it("penalizes graph-isolated talents", () => {
      // 5 talents but 2 have zero edges
      const synergy = makeSynergyOutput({
        talentIds: ["t.talent.a", "t.talent.b", "t.talent.c", "t.talent.d", "t.talent.e"],
        blessingIds: ["shared.name_family.blessing.x"],
        talentEdges: 3,  // only between a, b, c
        talentEdgeParticipants: ["t.talent.a", "t.talent.b", "t.talent.c"],
        blessingEdges: 1,
        orphans: [],
        concentration: 0.03,
        familyCount: 6,
        coverageGaps: [],
        slotBalance: { melee: 3, ranged: 3 },
      });
      const result = scoreFromSynergy(synergy);
      // 2 isolated talents = -1.0 penalty
      assert.ok(result.talent_coherence.breakdown.graph_isolated_count === 2);
    });

    it("counts trigger_target edges in talent synergy", () => {
      const synergy = makeSynergyOutput({
        talentIds: ["t.talent.a", "t.talent.b", "t.talent.c"],
        blessingIds: [],
        talentEdges: 2,
        talentTriggerEdges: 2,  // these should also count
        blessingEdges: 0,
        orphans: [],
        concentration: 0.05,
        familyCount: 6,
        coverageGaps: [],
        slotBalance: { melee: 3, ranged: 3 },
      });
      const result = scoreFromSynergy(synergy);
      // 4 total talent edges (2 stat_alignment + 2 trigger_target)
      assert.equal(result.talent_coherence.breakdown.talent_edges, 4);
    });

    it("includes abilities and talent_modifiers in talent count", () => {
      const synergy = makeSynergyOutput({
        talentIds: ["t.talent.a", "t.ability.b", "t.talent_modifier.c"],
        blessingIds: [],
        talentEdges: 2,
        blessingEdges: 0,
        orphans: [],
        concentration: 0.05,
        familyCount: 5,
        coverageGaps: [],
        slotBalance: { melee: 2, ranged: 2 },
      });
      const result = scoreFromSynergy(synergy);
      assert.equal(result.talent_coherence.breakdown.talent_count, 3);
    });
  });
});

// Helper: build a minimal synergy output shape for testing.
// Real synergy output comes from analyzeBuild(); this constructs the subset
// that scoreFromSynergy needs, with controllable edge counts.
// Generates both stat_alignment and trigger_target edge types to match real output.
function makeSynergyOutput({
  talentIds = [],
  blessingIds = [],
  talentEdges = 0,
  talentEdgeParticipants = null,
  talentTriggerEdges = 0,  // trigger_target edges between talents
  blessingEdges = 0,
  blessingBlessingEdges = 0,
  orphans = [],
  concentration = 0.05,
  familyCount = 8,
  coverageGaps = [],
  slotBalance = { melee: 5, ranged: 5 },
}) {
  const synergy_edges = [];

  // Generate talent-talent stat_alignment edges
  const tParticipants = talentEdgeParticipants || talentIds;
  for (let i = 0; i < talentEdges; i++) {
    const a = tParticipants[i % tParticipants.length];
    const b = tParticipants[(i + 1) % tParticipants.length];
    synergy_edges.push({
      type: "stat_alignment",
      selections: [a, b],
      families: ["general_offense"],
      strength: 3,
      explanation: `test edge ${i}`,
    });
  }

  // Generate talent-talent trigger_target edges
  for (let i = 0; i < talentTriggerEdges; i++) {
    const a = tParticipants[i % tParticipants.length];
    const b = tParticipants[(i + 1) % tParticipants.length];
    synergy_edges.push({
      type: "trigger_target",
      selections: [a, b],
      families: [],
      strength: 2,
      explanation: `Both activate on test_trigger`,
    });
  }

  // Generate blessing-talent edges
  for (let i = 0; i < blessingEdges; i++) {
    const bl = blessingIds[i % (blessingIds.length || 1)];
    const t = talentIds[i % (talentIds.length || 1)];
    if (bl && t) {
      synergy_edges.push({
        type: "stat_alignment",
        selections: [bl, t],
        families: ["general_offense"],
        strength: 3,
        explanation: `blessing-talent edge ${i}`,
      });
    }
  }

  // Generate blessing-blessing edges
  for (let i = 0; i < blessingBlessingEdges; i++) {
    const a = blessingIds[i % blessingIds.length];
    const b = blessingIds[(i + 1) % blessingIds.length];
    synergy_edges.push({
      type: "stat_alignment",
      selections: [a, b],
      families: ["general_offense"],
      strength: 3,
      explanation: `blessing-blessing edge ${i}`,
    });
  }

  // Build family profile
  const families = [
    "melee_offense", "ranged_offense", "general_offense", "crit",
    "toughness", "damage_reduction", "mobility", "warp_resource",
    "grenade", "stamina", "utility",
  ];
  const family_profile = {};
  for (let i = 0; i < familyCount && i < families.length; i++) {
    family_profile[families[i]] = { count: 2, total_magnitude: 0.1, selections: [] };
  }

  return {
    build: "test build",
    class: "test",
    synergy_edges,
    anti_synergies: [],
    orphans,
    coverage: {
      family_profile,
      slot_balance: {
        melee: { families: [], strength: slotBalance.melee },
        ranged: { families: [], strength: slotBalance.ranged },
      },
      build_identity: Object.keys(family_profile).slice(0, 3),
      coverage_gaps: coverageGaps,
      concentration,
    },
    metadata: {
      entities_analyzed: talentIds.length + blessingIds.length,
      unique_entities_with_calc: talentIds.length + blessingIds.length,
      entities_without_calc: 0,
      opaque_conditions: 0,
      calc_coverage_pct: 1.0,
    },
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/build-scoring.test.mjs`
Expected: FAIL — module `build-scoring.mjs` does not exist yet.

- [ ] **Step 3: Create `build-scoring.mjs` with `scoreFromSynergy` — implement `talent_coherence`**

Create `scripts/ground-truth/lib/build-scoring.mjs`. Implement:
- Helper `classifySelection(id)` — returns `"talent"` for IDs containing `.talent.`, `.ability.`, `.talent_modifier.`, `.stat_node.`; `"blessing"` for `.name_family.blessing.`; `"gadget"` for `.gadget_trait.`; `"other"` otherwise.
- `scoreTalentCoherence(synergyOutput)`:
  1. Identify all unique talent-side selection IDs from `synergy_edges` participants using `classifySelection`.
  2. Also collect all talent-side IDs that appear as entity IDs in the build (from `metadata`). For now, extract from edge participants — full build entity list comes via integration later.
  3. Count edges where BOTH participants are talent-side.
  4. Compute `edges_per_talent`.
  5. Map to 1–5: `>= 1.5 → 5, >= 1.0 → 4, >= 0.5 → 3, >= 0.2 → 2, else → 1`. (Calibration note: with median 10 edges / ~20 talents = 0.5 per talent, score 3 is the median — correct for "decent but not great".)
  6. Count graph-isolated talent-side selections (appear in no `synergy_edges`). Apply -0.5 penalty each.
  7. Bonus: concentration > 0.06 → +0.5.
  8. Clamp [1, 5], round.
  9. Return `{ score, breakdown: { talent_edges, talent_count, edges_per_talent, graph_isolated_count, concentration, penalties, bonuses }, explanations }`.
- Stub `scoreBlessingSynergy` and `scoreRoleCoverage` returning `{ score: 1, breakdown: {}, explanations: [] }`.
- Export `scoreFromSynergy(synergyOutput)` calling all three.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/build-scoring.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/build-scoring.mjs scripts/build-scoring.test.mjs
git commit -m "Add talent_coherence scoring with graph-isolation penalty (#9)"
```

---

## Task 2: Scoring Module — `blessing_synergy`

**Files:**
- Modify: `scripts/ground-truth/lib/build-scoring.mjs`
- Modify: `scripts/build-scoring.test.mjs`

- [ ] **Step 1: Write failing tests for `blessing_synergy`**

Add to `scripts/build-scoring.test.mjs`:

```js
describe("blessing_synergy", () => {
  it("scores high for many blessing-talent edges", () => {
    const synergy = makeSynergyOutput({
      talentIds: ["t.talent.a", "t.talent.b", "t.talent.c"],
      blessingIds: ["shared.name_family.blessing.x", "shared.name_family.blessing.y"],
      talentEdges: 3,
      blessingEdges: 8,  // 4 per blessing = high density
      blessingBlessingEdges: 1,
      orphans: [],
      concentration: 0.05,
      familyCount: 8,
      coverageGaps: [],
      slotBalance: { melee: 5, ranged: 5 },
    });
    const result = scoreFromSynergy(synergy);
    assert.ok(result.blessing_synergy.score >= 4);
  });

  it("penalizes graph-isolated blessings", () => {
    // Manually construct synergy output where blessing.y has zero edges.
    // Can't rely on makeSynergyOutput cycling — build edges manually.
    const synergy = makeSynergyOutput({
      talentIds: ["t.talent.a"],
      blessingIds: ["shared.name_family.blessing.x", "shared.name_family.blessing.y"],
      talentEdges: 0,
      blessingEdges: 0,  // no auto-generated blessing edges
      blessingBlessingEdges: 0,
      orphans: [],
      concentration: 0.05,
      familyCount: 8,
      coverageGaps: [],
      slotBalance: { melee: 5, ranged: 5 },
    });
    // Manually add 2 edges only for blessing.x, leaving blessing.y isolated
    synergy.synergy_edges.push(
      { type: "stat_alignment", selections: ["shared.name_family.blessing.x", "t.talent.a"], families: ["general_offense"], strength: 3, explanation: "test" },
      { type: "stat_alignment", selections: ["shared.name_family.blessing.x", "t.talent.a"], families: ["crit"], strength: 2, explanation: "test" },
    );
    const result = scoreFromSynergy(synergy);
    assert.equal(result.blessing_synergy.breakdown.orphaned_blessings, 1);  // blessing.y is isolated
  });

  it("gives bonus for blessing-blessing edges", () => {
    const withBB = makeSynergyOutput({
      talentIds: ["t.talent.a"],
      blessingIds: ["shared.name_family.blessing.x", "shared.name_family.blessing.y"],
      talentEdges: 0,
      blessingEdges: 4,
      blessingBlessingEdges: 1,
      orphans: [],
      concentration: 0.05,
      familyCount: 8,
      coverageGaps: [],
      slotBalance: { melee: 5, ranged: 5 },
    });
    const withoutBB = makeSynergyOutput({
      talentIds: ["t.talent.a"],
      blessingIds: ["shared.name_family.blessing.x", "shared.name_family.blessing.y"],
      talentEdges: 0,
      blessingEdges: 4,
      blessingBlessingEdges: 0,
      orphans: [],
      concentration: 0.05,
      familyCount: 8,
      coverageGaps: [],
      slotBalance: { melee: 5, ranged: 5 },
    });
    const resultWith = scoreFromSynergy(withBB);
    const resultWithout = scoreFromSynergy(withoutBB);
    assert.ok(resultWith.blessing_synergy.score >= resultWithout.blessing_synergy.score);
  });

  it("scores 1 when no blessings present", () => {
    const synergy = makeSynergyOutput({
      talentIds: ["t.talent.a"],
      blessingIds: [],
      talentEdges: 0,
      blessingEdges: 0,
      orphans: [],
      concentration: 0.05,
      familyCount: 8,
      coverageGaps: [],
      slotBalance: { melee: 5, ranged: 5 },
    });
    const result = scoreFromSynergy(synergy);
    assert.equal(result.blessing_synergy.score, 1);
  });
});
```

- [ ] **Step 2: Run test to verify failures**

Run: `node --test scripts/build-scoring.test.mjs`
Expected: New blessing_synergy tests fail (stub returns score 1 for all).

- [ ] **Step 3: Implement `scoreBlessingSynergy`**

In `build-scoring.mjs`:
1. Collect all blessing IDs from edge participants using `classifySelection`.
2. Count edges where at least one participant is a blessing (`blessing_edges`).
3. Count edges where BOTH participants are blessings (`blessing_blessing_edges`).
4. `edges_per_blessing = blessing_edges / blessing_count`. If 0 blessings, score 1.
5. Map to 1–5: `>= 3.5 → 5, >= 2.5 → 4, >= 1.5 → 3, >= 0.5 → 2, else → 1`.
6. Bonus: `blessing_blessing_edges > 0` → +0.5.
7. Penalty: graph-isolated blessings (appear in zero edges) → -1 each.
8. Clamp [1, 5], round.

- [ ] **Step 4: Run tests**

Run: `node --test scripts/build-scoring.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/build-scoring.mjs scripts/build-scoring.test.mjs
git commit -m "Add blessing_synergy scoring with graph-isolation penalty (#9)"
```

---

## Task 3: Scoring Module — `role_coverage`

**Files:**
- Modify: `scripts/ground-truth/lib/build-scoring.mjs`
- Modify: `scripts/build-scoring.test.mjs`

- [ ] **Step 1: Write failing tests for `role_coverage`**

```js
describe("role_coverage", () => {
  it("scores 5 for 9+ active families with no gaps", () => {
    const synergy = makeSynergyOutput({
      talentIds: ["t.talent.a"],
      blessingIds: [],
      talentEdges: 0,
      blessingEdges: 0,
      orphans: [],
      concentration: 0.03,
      familyCount: 9,
      coverageGaps: [],
      slotBalance: { melee: 5, ranged: 5 },
    });
    const result = scoreFromSynergy(synergy);
    assert.equal(result.role_coverage.score, 5);
  });

  it("penalizes coverage gaps", () => {
    const synergy = makeSynergyOutput({
      talentIds: ["t.talent.a"],
      blessingIds: [],
      talentEdges: 0,
      blessingEdges: 0,
      orphans: [],
      concentration: 0.03,
      familyCount: 9,
      coverageGaps: ["survivability"],
      slotBalance: { melee: 5, ranged: 5 },
    });
    const result = scoreFromSynergy(synergy);
    assert.equal(result.role_coverage.score, 4);  // 5 - 1 gap
  });

  it("penalizes severe slot imbalance", () => {
    const synergy = makeSynergyOutput({
      talentIds: ["t.talent.a"],
      blessingIds: [],
      talentEdges: 0,
      blessingEdges: 0,
      orphans: [],
      concentration: 0.03,
      familyCount: 9,
      coverageGaps: [],
      slotBalance: { melee: 10, ranged: 1 },  // ratio 0.1 < 0.3
    });
    const result = scoreFromSynergy(synergy);
    assert.equal(result.role_coverage.score, 4);  // 5 - 1 imbalance
  });

  it("treats zero/zero slot balance as ratio 1.0", () => {
    const synergy = makeSynergyOutput({
      talentIds: ["t.talent.a"],
      blessingIds: [],
      talentEdges: 0,
      blessingEdges: 0,
      orphans: [],
      concentration: 0.03,
      familyCount: 9,
      coverageGaps: [],
      slotBalance: { melee: 0, ranged: 0 },
    });
    const result = scoreFromSynergy(synergy);
    assert.equal(result.role_coverage.breakdown.slot_balance_ratio, 1.0);
  });

  it("scores low for few families", () => {
    const synergy = makeSynergyOutput({
      talentIds: ["t.talent.a"],
      blessingIds: [],
      talentEdges: 0,
      blessingEdges: 0,
      orphans: [],
      concentration: 0.03,
      familyCount: 3,
      coverageGaps: [],
      slotBalance: { melee: 2, ranged: 2 },
    });
    const result = scoreFromSynergy(synergy);
    assert.equal(result.role_coverage.score, 2);
  });
});
```

- [ ] **Step 2: Run test to verify failures**

Run: `node --test scripts/build-scoring.test.mjs`
Expected: role_coverage tests fail (stub returns 1).

- [ ] **Step 3: Implement `scoreRoleCoverage`**

1. `active_families = Object.keys(coverage.family_profile).length`.
2. Base: `>= 9 → 5, >= 7 → 4, >= 5 → 3, >= 3 → 2, else → 1`.
3. Penalty: each `coverage_gap` → -1.
4. Slot balance ratio: `min(melee, ranged) / max(melee, ranged)`. Both 0 → 1.0. Ratio < 0.3 → -1.
5. Clamp [1, 5], round.

- [ ] **Step 4: Run tests**

Run: `node --test scripts/build-scoring.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/build-scoring.mjs scripts/build-scoring.test.mjs
git commit -m "Add role_coverage scoring with gap and imbalance penalties (#9)"
```

---

## Task 4: Integrate Scoring into `generateScorecard()`

**Files:**
- Modify: `scripts/score-build.mjs` (lines 684–747, 819–843)
- Modify: `scripts/score-build.test.mjs`

- [ ] **Step 1: Write failing test for qualitative scores in scorecard**

Add to `scripts/score-build.test.mjs`:

```js
import { analyzeBuild, loadIndex } from "./ground-truth/lib/synergy-model.mjs";

// These tests require the ground-truth index (synergy analysis needs entities + edges).
// Skip when GROUND_TRUTH_SOURCE_ROOT is not set, like the synergy tests do.
const HAS_SOURCE = !!process.env.GROUND_TRUTH_SOURCE_ROOT;

describe("generateScorecard qualitative scores", { skip: !HAS_SOURCE && "requires GROUND_TRUTH_SOURCE_ROOT" }, () => {
  // Load index once for this describe block
  let index;
  function getSynergy(build) {
    if (!index) index = loadIndex();
    return analyzeBuild(build, index);
  }

  it("populates talent_coherence, blessing_synergy, role_coverage when synergy passed", () => {
    const build = JSON.parse(readFileSync("scripts/builds/08-gandalf-melee-wizard.json", "utf-8"));
    const synergy = getSynergy(build);
    const card = generateScorecard(build, synergy);
    assert.notEqual(card.qualitative.talent_coherence, null);
    assert.notEqual(card.qualitative.blessing_synergy, null);
    assert.notEqual(card.qualitative.role_coverage, null);
    assert.ok(card.qualitative.talent_coherence.score >= 1);
    assert.ok(card.qualitative.talent_coherence.score <= 5);
  });

  it("keeps qualitative null when no synergy passed", () => {
    const build = JSON.parse(readFileSync("scripts/builds/08-gandalf-melee-wizard.json", "utf-8"));
    const card = generateScorecard(build);  // no synergy argument
    assert.equal(card.qualitative.talent_coherence, null);
    assert.equal(card.qualitative.blessing_synergy, null);
  });

  it("keeps breakpoint_relevance and difficulty_scaling null", () => {
    const build = JSON.parse(readFileSync("scripts/builds/08-gandalf-melee-wizard.json", "utf-8"));
    const synergy = getSynergy(build);
    const card = generateScorecard(build, synergy);
    assert.equal(card.qualitative.breakpoint_relevance, null);
    assert.equal(card.qualitative.difficulty_scaling, null);
  });

  it("includes composite score and letter grade", () => {
    const build = JSON.parse(readFileSync("scripts/builds/08-gandalf-melee-wizard.json", "utf-8"));
    const synergy = getSynergy(build);
    const card = generateScorecard(build, synergy);
    assert.ok(typeof card.composite_score === "number");
    assert.ok(typeof card.letter_grade === "string");
    assert.ok(["S", "A", "B", "C", "D"].includes(card.letter_grade));
  });

  it("does not change perk_optimality or curio_efficiency", () => {
    const build = JSON.parse(readFileSync("scripts/builds/08-gandalf-melee-wizard.json", "utf-8"));
    const synergy = getSynergy(build);
    const card = generateScorecard(build, synergy);
    assert.ok(typeof card.perk_optimality === "number");
    assert.ok(typeof card.curio_efficiency === "number");
  });
});
```

- [ ] **Step 2: Run test to verify failures**

Run: `node --test scripts/score-build.test.mjs`
Expected: FAIL — qualitative values are null, no composite_score field.

- [ ] **Step 3: Wire scoring into `generateScorecard()`**

In `scripts/score-build.mjs`:
1. Add **lazy** imports at the top (dynamic `import()` to avoid loading heavyweight synergy index unconditionally):
   ```js
   let _scoreFromSynergy = null;
   let _synergy = null;
   async function loadSynergyModules() {
     if (!_scoreFromSynergy) {
       _scoreFromSynergy = (await import("./ground-truth/lib/build-scoring.mjs")).scoreFromSynergy;
       _synergy = await import("./ground-truth/lib/synergy-model.mjs");
     }
     return { scoreFromSynergy: _scoreFromSynergy, ..._synergy };
   }
   ```
   **Rationale:** `loadIndex()` reads all ground-truth entity/edge files. Existing tests and consumers that only use perk/curio scoring must not pay this cost. Dynamic import ensures the synergy modules are only loaded when qualitative scoring is actually requested.

2. Modify `generateScorecard(build, synergyOutput = null)`:
   - **When `synergyOutput` is passed:** call `scoreFromSynergy(synergyOutput)` synchronously (modules already loaded by caller).
   - **When `synergyOutput` is null:** qualitative fields remain null stubs (same as current behavior). Callers wanting qualitative scores must pass synergy output explicitly.
   - This keeps `generateScorecard` synchronous and backward-compatible. The CLI entry point at the bottom of the file is the only place that runs the full pipeline (load index → analyze → score).
   - Keep `breakpoint_relevance: null, difficulty_scaling: null`.
3. Compute composite score: sum of all non-null dimension scores. Only dimensions with non-null values are counted. If qualitative scores are null (no synergy passed), composite only includes perk_optimality + curio_efficiency.
4. Scale to /35: `scaled = Math.round(composite * 7 / scoredDimensionCount)` (average per dimension × 7 total dimensions). With 5 scored dims and max 25, this maps to 35. Apply letter grade thresholds from rubric: `>= 32 → S, >= 27 → A, >= 22 → B, >= 17 → C, else → D`.
5. Add `composite_score` and `letter_grade` fields to the returned scorecard.
6. Update the CLI entry point to load synergy modules and pass synergy output to `generateScorecard`.
7. Update `formatScorecardText()` to display the qualitative scores and letter grade.

**Import note:** `build-scoring.mjs` is imported lazily via dynamic `import()`. This means existing `score-build.test.mjs` tests continue to work without `GROUND_TRUTH_SOURCE_ROOT` set — they never trigger synergy loading.

- [ ] **Step 4: Run tests**

Run: `node --test scripts/score-build.test.mjs`
Expected: PASS (both new and existing tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/score-build.mjs scripts/score-build.test.mjs scripts/ground-truth/lib/build-scoring.mjs
git commit -m "Wire qualitative scoring into generateScorecard (#9)"
```

---

## Task 5: Golden Score Snapshots

**Files:**
- Create: `tests/fixtures/ground-truth/scores/` directory
- Modify: `scripts/build-scoring.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Generate golden snapshots for 5 builds**

Select 5 diverse builds: `01` (veteran), `04` (zealot), `08` (psyker), `13` (ogryn), `15` (arbites).

Write a freeze script in `package.json`:
```json
"score:freeze": "for f in 01 04 08 13 15; do node -e \"const {readFileSync}=require('fs'); const {generateScorecard}=require('./scripts/score-build.mjs'); const b=JSON.parse(readFileSync('scripts/builds/'+process.argv[1]+'-*.json'.replace('*',''),'utf-8')); console.log(JSON.stringify(generateScorecard(b),null,2))\" $f > tests/fixtures/ground-truth/scores/$f.score.json; done"
```

Actually — simpler approach: write a small freeze helper inline in the test or as a one-off script, then freeze each build by running `generateScorecard` and writing the output. Use `node -e` or a dedicated freeze command.

- [ ] **Step 2: Create snapshot directory and freeze 5 builds**

```bash
mkdir -p tests/fixtures/ground-truth/scores
```

Write a small `scripts/freeze-scores.mjs`. This requires `GROUND_TRUTH_SOURCE_ROOT` to be set (same as `synergy:freeze`), since it runs the full synergy pipeline:

```js
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { generateScorecard } from "./score-build.mjs";
import { analyzeBuild, loadIndex } from "./ground-truth/lib/synergy-model.mjs";

const BUILDS = ["01", "04", "08", "13", "15"];
const BUILDS_DIR = "scripts/builds";
const OUT_DIR = "tests/fixtures/ground-truth/scores";

const index = loadIndex();

for (const prefix of BUILDS) {
  const file = readdirSync(BUILDS_DIR).find(f => f.startsWith(prefix) && f.endsWith(".json"));
  if (!file) { console.error(`No build for prefix ${prefix}`); continue; }
  const build = JSON.parse(readFileSync(join(BUILDS_DIR, file), "utf-8"));
  const synergy = analyzeBuild(build, index);
  const card = generateScorecard(build, synergy);
  writeFileSync(join(OUT_DIR, `${prefix}.score.json`), JSON.stringify(card, null, 2) + "\n");
  console.log(`Frozen: ${prefix} → ${card.letter_grade} (${card.composite_score})`);
}
```

Run: `GROUND_TRUTH_SOURCE_ROOT=$(cat .source-root) node scripts/freeze-scores.mjs`

- [ ] **Step 3: Add golden snapshot regression test**

In `scripts/build-scoring.test.mjs`, add:

```js
import { readdirSync, readFileSync } from "node:fs";
import { generateScorecard } from "./score-build.mjs";
import { analyzeBuild, loadIndex } from "./ground-truth/lib/synergy-model.mjs";

const HAS_SOURCE = !!process.env.GROUND_TRUTH_SOURCE_ROOT;

describe("golden score snapshots", { skip: !HAS_SOURCE && "requires GROUND_TRUTH_SOURCE_ROOT" }, () => {
  const SCORES_DIR = "tests/fixtures/ground-truth/scores";
  const files = readdirSync(SCORES_DIR).filter(f => f.endsWith(".score.json"));
  const index = loadIndex();

  for (const file of files) {
    const prefix = file.replace(".score.json", "");
    it(`matches snapshot for build ${prefix}`, () => {
      const expected = JSON.parse(readFileSync(`${SCORES_DIR}/${file}`, "utf-8"));
      const buildFile = readdirSync("scripts/builds").find(f => f.startsWith(prefix) && f.endsWith(".json"));
      const build = JSON.parse(readFileSync(`scripts/builds/${buildFile}`, "utf-8"));
      const synergy = analyzeBuild(build, index);
      const actual = generateScorecard(build, synergy);

      // Compare qualitative scores
      assert.equal(actual.qualitative.talent_coherence.score, expected.qualitative.talent_coherence.score);
      assert.equal(actual.qualitative.blessing_synergy.score, expected.qualitative.blessing_synergy.score);
      assert.equal(actual.qualitative.role_coverage.score, expected.qualitative.role_coverage.score);
      assert.equal(actual.composite_score, expected.composite_score);
      assert.equal(actual.letter_grade, expected.letter_grade);

      // Mechanical scores unchanged
      assert.equal(actual.perk_optimality, expected.perk_optimality);
      assert.equal(actual.curio_efficiency, expected.curio_efficiency);
    });
  }
});
```

- [ ] **Step 4: Add test file to `package.json` test script and add `score:freeze`**

Add `scripts/build-scoring.test.mjs` to the `test` script in `package.json`.
Add `"score:freeze": "node scripts/freeze-scores.mjs"`.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass including new golden snapshots.

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/ground-truth/scores/ scripts/freeze-scores.mjs scripts/build-scoring.test.mjs package.json
git commit -m "Add golden score snapshots for 5 builds (#9)"
```

---

## Task 6: Gap Analysis — `analyzeGaps`

**Files:**
- Create: `scripts/ground-truth/lib/build-recommendations.mjs`
- Create: `scripts/build-recommendations.test.mjs`

- [ ] **Step 1: Write failing tests for `analyzeGaps`**

```js
// scripts/build-recommendations.test.mjs
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { analyzeGaps } from "./ground-truth/lib/build-recommendations.mjs";
import { loadIndex } from "./ground-truth/lib/synergy-model.mjs";

describe("build-recommendations", () => {
  describe("analyzeGaps", () => {
    it("returns gap analysis for a real build", () => {
      const build = JSON.parse(readFileSync("scripts/builds/08-gandalf-melee-wizard.json", "utf-8"));
      const index = loadIndex();
      const result = analyzeGaps(build, index);
      assert.ok(Array.isArray(result.gaps));
      assert.ok(Array.isArray(result.underinvested_families));
      assert.ok(result.scorecard !== undefined);
    });

    it("identifies underinvested families", () => {
      const build = JSON.parse(readFileSync("scripts/builds/08-gandalf-melee-wizard.json", "utf-8"));
      const index = loadIndex();
      const result = analyzeGaps(build, index);
      // Underinvested = active but <= 1 selection
      for (const fam of result.underinvested_families) {
        assert.ok(typeof fam === "string");
      }
    });

    it("includes scorecard in output", () => {
      const build = JSON.parse(readFileSync("scripts/builds/08-gandalf-melee-wizard.json", "utf-8"));
      const index = loadIndex();
      const result = analyzeGaps(build, index);
      assert.ok(typeof result.scorecard.composite_score === "number");
    });
  });
});
```

- [ ] **Step 2: Run test to verify failures**

Run: `node --test scripts/build-recommendations.test.mjs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `analyzeGaps`**

Create `scripts/ground-truth/lib/build-recommendations.mjs`:

```js
import { analyzeBuild } from "./synergy-model.mjs";
import { scoreFromSynergy } from "./build-scoring.mjs";
import { generateScorecard } from "../../score-build.mjs";

export function analyzeGaps(build, index, precomputed = null) {
  const synergy = precomputed?.synergy ?? analyzeBuild(build, index);
  const scorecard = precomputed?.scorecard ?? generateScorecard(build, synergy);
  // ... implementation
}
```

**Import chain:** `build-recommendations.mjs` → `score-build.mjs` → `build-scoring.mjs`. Also `build-recommendations.mjs` → `synergy-model.mjs`. No circular dependencies. `score-build.mjs` is large (843 lines) but only the exported functions are called; the CLI entry point is guarded by `import.meta.main`.

The `scorecard` field in the output is the **full** scorecard from `generateScorecard()`, including mechanical scores (`perk_optimality`, `curio_efficiency`) and qualitative scores. This gives consumers a complete picture.

Implementation:
1. Run `analyzeBuild()` + `generateScorecard(build, synergy)` (or use precomputed).
2. Read `coverage.family_profile` — families with `count <= 1` are underinvested.
3. Read `coverage.coverage_gaps` — map each to a structured gap entry with `type`, `reason`, `suggested_families`.
4. Check `slot_balance` — if ratio < 0.3, add a slot_imbalance gap.
5. Return `{ gaps, underinvested_families, scorecard }`.

- [ ] **Step 4: Run tests**

Run: `node --test scripts/build-recommendations.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/build-recommendations.mjs scripts/build-recommendations.test.mjs
git commit -m "Add analyzeGaps recommendation operation (#10)"
```

---

## Task 7: Tree Reachability Validation

**Files:**
- Modify: `scripts/ground-truth/lib/build-recommendations.mjs`
- Modify: `scripts/build-recommendations.test.mjs`

- [ ] **Step 0: Research real entity IDs for test fixtures**

Before writing tests, read the psyker edge data to find concrete IDs for test fixtures:

```bash
# Find a talent that's in the Gandalf build
node -e "const b=JSON.parse(require('fs').readFileSync('scripts/builds/08-gandalf-melee-wizard.json','utf-8')); console.log(b.talents.slice(0,5).map(t=>t.canonical_entity_id))"

# Find belongs_to_tree_node mappings for those talents
node -e "const edges=require('./data/ground-truth/edges/psyker.json'); const btn=edges.filter(e=>e.type==='belongs_to_tree_node'); console.log(btn.slice(0,5).map(e=>e.from_entity_id+' → '+e.to_entity_id))"

# Find parent_of edges to get parent/child tree node pairs
node -e "const edges=require('./data/ground-truth/edges/psyker.json'); const po=edges.filter(e=>e.type==='parent_of'); console.log(po.slice(0,5).map(e=>e.from_entity_id+' → '+e.to_entity_id))"

# Find exclusive_with pairs (psyker has 6)
node -e "const edges=require('./data/ground-truth/edges/psyker.json'); const ex=edges.filter(e=>e.type==='exclusive_with'); ex.forEach(e=>console.log(e.from_entity_id+' <-> '+e.to_entity_id))"
```

Record the IDs discovered here and use them in the tests below. The implementer MUST fill in real IDs before running tests — placeholder IDs will cause resolution errors, not meaningful test failures.

- [ ] **Step 1: Write failing tests for tree reachability using real IDs**

```js
// Use IDs discovered in Step 0. Example structure:
describe("tree reachability", () => {
  it("validates a reachable talent swap", () => {
    const build = JSON.parse(readFileSync("scripts/builds/08-gandalf-melee-wizard.json", "utf-8"));
    const index = loadIndex();
    // REPLACE with real talent ID from Step 0 — a talent adjacent to one in the build
    const REACHABLE_TALENT = "psyker.talent.FILL_FROM_STEP_0";
    const result = validateTreeReachability(build, index, REACHABLE_TALENT);
    assert.equal(result.reachable, true);
  });

  it("rejects talent with unselected parent", () => {
    const index = loadIndex();
    // Empty build — no talents selected, so any non-root talent is unreachable
    const emptyBuild = {
      class: { canonical_entity_id: "shared.class.psyker", raw_label: "psyker" },
      talents: [], ability: null, blitz: null, aura: null, keystone: null,
      weapons: [], curios: [],
    };
    // REPLACE with a real deep talent from Step 0
    const DEEP_TALENT = "psyker.talent.FILL_FROM_STEP_0";
    const result = validateTreeReachability(emptyBuild, index, DEEP_TALENT);
    assert.equal(result.reachable, false);
  });

  it("rejects talent that conflicts with exclusive_with", () => {
    const index = loadIndex();
    // REPLACE with real exclusive pair from Step 0
    const EXCLUSIVE_A = "psyker.tree_node.FILL_FROM_STEP_0";
    const EXCLUSIVE_B = "psyker.tree_node.FILL_FROM_STEP_0";
    // Build a minimal build with EXCLUSIVE_A selected, try to add EXCLUSIVE_B
    // ...test implementation using real IDs...
  });
});
```

- [ ] **Step 2: Run tests to verify failures**

Run: `node --test scripts/build-recommendations.test.mjs`

- [ ] **Step 3: Implement `validateTreeReachability(build, index, newTalentId)`**

In `build-recommendations.mjs`:
1. Extract the class domain from the build.
2. Load edges for that domain.
3. Build lookup maps: `talentToTreeNode` (from `belongs_to_tree_node`), `treeNodeParents` (inverse of `parent_of`), `exclusivePairs` (from `exclusive_with`).
4. Find the new talent's tree node via `belongs_to_tree_node`.
5. If no tree node found, return `{ reachable: true, reason: "no tree data" }` (fail open — talent may be valid but unmapped).
6. Walk `parent_of` upward from the tree node. Collect all ancestor tree nodes.
7. Map current build talents → tree nodes. Check that every ancestor is either root or has a build talent mapped to it.
8. Check `exclusive_with` — if any exclusive partner of the new talent's tree node is in the build (excluding the talent being removed), reject.
9. Return `{ reachable: boolean, reason: string }`.

- [ ] **Step 4: Run tests**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/build-recommendations.mjs scripts/build-recommendations.test.mjs
git commit -m "Add tree reachability validation for talent swaps (#10)"
```

---

## Task 8: Talent Swap — `swapTalent`

**Files:**
- Modify: `scripts/ground-truth/lib/build-recommendations.mjs`
- Modify: `scripts/build-recommendations.test.mjs`

- [ ] **Step 0: Research talent swap test IDs**

Reuse the IDs discovered in Task 7 Step 0. Additionally find:
```bash
# Find two adjacent talents: one in the Gandalf build, one not (swap candidate)
# Find a talent on a completely different branch (unreachable swap candidate)
```

Record: `EXISTING_TALENT`, `NEIGHBOR_TALENT` (reachable swap), `UNREACHABLE_TALENT` (different branch, parent not in build).

- [ ] **Step 1: Write failing tests for `swapTalent` using real IDs**

```js
describe("swapTalent", () => {
  it("returns valid delta for a legal talent swap", () => {
    const build = JSON.parse(readFileSync("scripts/builds/08-gandalf-melee-wizard.json", "utf-8"));
    const index = loadIndex();
    // REPLACE with IDs from Step 0
    const result = swapTalent(build, index, "psyker.talent.EXISTING", "psyker.talent.NEIGHBOR");
    assert.equal(result.valid, true);
    assert.ok(typeof result.score_delta.talent_coherence === "number");
    assert.ok(Array.isArray(result.gained_edges));
    assert.ok(Array.isArray(result.lost_edges));
  });

  it("returns invalid for unreachable talent", () => {
    const build = JSON.parse(readFileSync("scripts/builds/08-gandalf-melee-wizard.json", "utf-8"));
    const index = loadIndex();
    // REPLACE with IDs from Step 0
    const result = swapTalent(build, index, "psyker.talent.EXISTING", "psyker.talent.UNREACHABLE");
    assert.equal(result.valid, false);
    assert.ok(typeof result.reason === "string");
  });
});
```

- [ ] **Step 2: Run tests to verify failures**

- [ ] **Step 3: Implement `swapTalent(build, index, oldId, newId)`**

1. Validate `oldId` is in the build (in `talents[]` or structural slots).
2. Call `validateTreeReachability(buildWithoutOld, index, newId)`.
3. If unreachable, return `{ valid: false, reason }`.
4. Deep-clone the build. Replace `oldId` with `newId` in the appropriate location.
5. Run `analyzeBuild(originalBuild, index)` → `scoreFromSynergy()` → original scores.
6. Run `analyzeBuild(modifiedBuild, index)` → `scoreFromSynergy()` → new scores.
7. Compute `score_delta` per dimension: `new.score - original.score`.
8. Diff `synergy_edges`: edges in new but not original → `gained_edges`. Edges in original but not new → `lost_edges`. Compare by `selections` pair + `type`.
9. Check orphans: orphans resolved (in original but not new) and new orphans.
10. Return structured result.

- [ ] **Step 4: Run tests**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/build-recommendations.mjs scripts/build-recommendations.test.mjs
git commit -m "Add swapTalent recommendation operation (#10)"
```

---

## Task 9: Weapon Swap — `swapWeapon`

**Files:**
- Modify: `scripts/ground-truth/lib/build-recommendations.mjs`
- Modify: `scripts/build-recommendations.test.mjs`

- [ ] **Step 0: Research weapon swap test IDs**

```bash
# Find weapons in the Gandalf build with their families
node -e "
const b=JSON.parse(require('fs').readFileSync('scripts/builds/08-gandalf-melee-wizard.json','utf-8'));
b.weapons.forEach(w => console.log(w.name?.canonical_entity_id, w.blessings?.map(bl=>bl.canonical_entity_id)));
"

# Find another weapon in the same family (for same-family swap test)
node -e "
const entities=require('./data/ground-truth/entities/shared.json');
const weapons=entities.filter(e=>e.kind==='weapon');
const families={};
weapons.forEach(w => { const f=w.attributes?.weapon_family; if(f) { families[f]=families[f]||[]; families[f].push(w.id); }});
// Print families with 2+ weapons (swap candidates)
for (const [f,ids] of Object.entries(families)) { if(ids.length>=2) console.log(f+':', ids.join(', ')); }
"

# Find a weapon in a different family (for cross-family swap test)
```

Record: `BUILD_WEAPON_ID`, `SAME_FAMILY_WEAPON_ID`, `DIFF_FAMILY_WEAPON_ID`.

- [ ] **Step 1: Write failing tests for `swapWeapon` using real IDs**

```js
describe("swapWeapon", () => {
  it("returns delta with blessing impact for same-family swap", () => {
    const build = JSON.parse(readFileSync("scripts/builds/08-gandalf-melee-wizard.json", "utf-8"));
    const index = loadIndex();
    // REPLACE with IDs from Step 0
    const result = swapWeapon(build, index, "FILL_BUILD_WEAPON", "FILL_SAME_FAMILY");
    assert.ok(result.valid);
    assert.ok(result.blessing_impact);
    assert.ok(Array.isArray(result.blessing_impact.retained));
  });

  it("removes blessings for cross-family swap", () => {
    const build = JSON.parse(readFileSync("scripts/builds/08-gandalf-melee-wizard.json", "utf-8"));
    const index = loadIndex();
    // REPLACE with IDs from Step 0
    const result = swapWeapon(build, index, "FILL_BUILD_WEAPON", "FILL_DIFF_FAMILY");
    assert.ok(result.valid);
    assert.ok(result.blessing_impact.removed.length > 0);
  });

  it("returns score delta", () => {
    const build = JSON.parse(readFileSync("scripts/builds/08-gandalf-melee-wizard.json", "utf-8"));
    const index = loadIndex();
    // REPLACE with IDs from Step 0
    const result = swapWeapon(build, index, "FILL_BUILD_WEAPON", "FILL_SAME_FAMILY");
    assert.ok(typeof result.score_delta.blessing_synergy === "number");
  });
});
```

- [ ] **Step 2: Run tests to verify failures**

- [ ] **Step 3: Implement `swapWeapon(build, index, oldId, newId)`**

1. Find the weapon entry in `build.weapons[]` matching `oldId`.
2. Resolve old and new weapon entities from index.
3. Determine blessing compatibility:
   a. Same `weapon_family` attribute → retain all blessings.
   b. Different family → check `weapon_has_trait_pool` edges → check `instance_of` edges → fallback: mark all removed.
4. Build `blessing_impact: { retained, removed, available }`.
5. Deep-clone build. Replace weapon. Clear/retain blessings per above.
6. Run synergy → score pipeline on both. Diff.
7. Return `{ valid: true, score_delta, blessing_impact, gained_edges, lost_edges }`.

- [ ] **Step 4: Run tests**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/build-recommendations.mjs scripts/build-recommendations.test.mjs
git commit -m "Add swapWeapon recommendation operation with blessing cascade (#10)"
```

---

## Task 10: Recommendation Formatter + CLI

**Files:**
- Create: `scripts/ground-truth/lib/recommend-formatter.mjs`
- Create: `scripts/recommend-build.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing test for formatter**

```js
// In build-recommendations.test.mjs or a new recommend-formatter.test.mjs
describe("recommend-formatter", () => {
  it("formats gap analysis as text", () => {
    const gaps = {
      gaps: [{ type: "survivability", reason: "no toughness", suggested_families: ["toughness"] }],
      underinvested_families: ["stamina"],
      scorecard: { composite_score: 20, letter_grade: "B" },
    };
    const text = formatGapsText(gaps);
    assert.ok(text.includes("survivability"));
    assert.ok(text.includes("toughness"));
  });
});
```

- [ ] **Step 2: Run test to verify failure**

- [ ] **Step 3: Implement formatter**

Create `scripts/ground-truth/lib/recommend-formatter.mjs` with:
- `formatGapsText(result)` / `formatGapsMarkdown(result)` / `formatGapsJson(result)`
- `formatSwapText(result)` / `formatSwapMarkdown(result)` / `formatSwapJson(result)`

Follow the pattern from `scripts/ground-truth/lib/report-formatter.mjs`.

- [ ] **Step 4: Create CLI entry point `scripts/recommend-build.mjs`**

```js
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { runCliMain } from "./ground-truth/lib/cli.mjs";
import { analyzeGaps, swapTalent, swapWeapon } from "./ground-truth/lib/build-recommendations.mjs";
import { loadIndex } from "./ground-truth/lib/synergy-model.mjs";
import { formatGapsText, formatGapsJson, formatSwapText, formatSwapJson } from "./ground-truth/lib/recommend-formatter.mjs";

if (import.meta.main) {
  await runCliMain("recommend", async () => {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        json: { type: "boolean", default: false },
        from: { type: "string" },
        to: { type: "string" },
      },
    });

    const operation = positionals[0];
    const buildPath = positionals[1];
    if (!operation || !buildPath) {
      throw new Error("Usage: npm run recommend -- <analyze-gaps|swap-talent|swap-weapon> <build.json> [--from id --to id] [--json]");
    }

    const build = JSON.parse(readFileSync(buildPath, "utf-8"));
    const index = loadIndex();

    let result, output;
    switch (operation) {
      case "analyze-gaps":
        result = analyzeGaps(build, index);
        output = values.json ? formatGapsJson(result) : formatGapsText(result);
        break;
      case "swap-talent":
        if (!values.from || !values.to) throw new Error("--from and --to required for swap-talent");
        result = swapTalent(build, index, values.from, values.to);
        output = values.json ? formatSwapJson(result) : formatSwapText(result);
        break;
      case "swap-weapon":
        if (!values.from || !values.to) throw new Error("--from and --to required for swap-weapon");
        result = swapWeapon(build, index, values.from, values.to);
        output = values.json ? formatSwapJson(result) : formatSwapText(result);
        break;
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }

    process.stdout.write(output + "\n");
  });
}
```

- [ ] **Step 5: Add `score`, `recommend` scripts to `package.json`**

```json
"score": "node scripts/score-build.mjs",
"recommend": "node scripts/recommend-build.mjs"
```

The `score` alias doesn't exist yet — the spec's CLI surface references `npm run score` but package.json only had the long-form `node scripts/score-build.mjs`. Add both.

Also add `scripts/build-recommendations.test.mjs` to the `test` script.

- [ ] **Step 6: Run full test suite + smoke test CLI**

```bash
npm test
npm run recommend -- analyze-gaps scripts/builds/08-gandalf-melee-wizard.json
npm run recommend -- analyze-gaps scripts/builds/08-gandalf-melee-wizard.json --json
```

- [ ] **Step 7: Commit**

```bash
git add scripts/ground-truth/lib/recommend-formatter.mjs scripts/recommend-build.mjs package.json scripts/build-recommendations.test.mjs
git commit -m "Add recommendation CLI with formatter layer (#10)"
```

---

## Task 11: Final Integration — `make check` + AGENTS.md

**Files:**
- Modify: `AGENTS.md`
- Run: `make check`

- [ ] **Step 1: Run `make check`**

```bash
make check
```

Expected: All tests pass, index builds, index check passes.

- [ ] **Step 2: Fix any failures**

If tests fail, fix and re-run. Common issues:
- Import paths
- Snapshot drift (re-freeze with `npm run score:freeze` if scoring thresholds changed)
- Missing test file in `package.json` test script

- [ ] **Step 3: Update AGENTS.md**

Add to Commands section:
```
npm run score -- <build.json> [--json]              # now includes qualitative scores + letter grade
npm run recommend -- analyze-gaps <build.json>
npm run recommend -- swap-talent <build.json> --from <id> --to <id>
npm run recommend -- swap-weapon <build.json> --from <id> --to <id>
npm run score:freeze                                # regenerate golden score snapshots
```

Update Open Issues section: move #9 and #10 to Completed Issues.

Update Synergy Model section if needed to reference scoring.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "Update AGENTS.md: scoring + recommendations commands, close #9 #10"
```

- [ ] **Step 5: Final verification**

```bash
npm test
npm run recommend -- analyze-gaps scripts/builds/04-spicy-meta-zealot.json
npm run score -- scripts/builds/04-spicy-meta-zealot.json --json | head -20
```

Verify qualitative scores are non-null and letter grade appears.
