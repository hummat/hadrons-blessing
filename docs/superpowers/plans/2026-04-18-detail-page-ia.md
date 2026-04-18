# Detail Page IA Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the build detail page so the verdict lands first — three-tile verdict strip replaces the ledger row, armoury promotes above synergy, seven-dimensions grid and coverage stats panel demote behind progressive disclosure.

**Architecture:** One new helper module (`verdict.ts`) with two pure functions, one new Svelte component (`VerdictStrip.svelte`) that renders three parchment tiles. The page file (`builds/[slug]/+page.svelte`) is reshuffled and two sections get wrapped in `<details>`. No library changes, no new data model, no new routes.

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), Tailwind CSS v4, TypeScript strict, `tsx --test` (node's built-in test runner).

**Spec:** `docs/superpowers/specs/2026-04-18-detail-page-ia-design.md`

---

## File Structure

**Create:**
- `website/src/lib/verdict.ts` — pure helpers (`selectSignatureStrengths`, `buildRiskBullets`, plus the types they produce)
- `website/src/lib/verdict.test.ts` — node:test suite for the helpers
- `website/src/lib/VerdictStrip.svelte` — component that consumes the helpers and renders three parchment tiles

**Modify:**
- `website/src/routes/builds/[slug]/+page.svelte` — remove ledger-entries row, insert VerdictStrip, reorder Armoury above Synergy, demote Seven Dimensions grid behind `<details>`, remove standalone Coverage Stats panel
- `website/src/app.css` — add `.ds-verdict` grid rules (mirrors `.ds-ledger`) and `.ds-risk-bullets` list styles

**Unchanged:**
- `website/src/lib/types.ts` — no new data model
- `website/src/lib/detail-format.ts` — existing helpers still used
- `website/src/lib/dimensions.ts` — reused for label lookup
- `src/**` (library code) — no library changes
- compare route, list route, generate-data pipeline

---

## Task 1: Verdict helper module — signature strengths

**Files:**
- Create: `website/src/lib/verdict.ts`
- Create: `website/src/lib/verdict.test.ts`

- [ ] **Step 1: Write failing tests for `selectSignatureStrengths`**

Create `website/src/lib/verdict.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd website && npm run test -- --test-name-pattern="selectSignatureStrengths"`

Expected: FAIL with `Cannot find module './verdict.ts'` or `selectSignatureStrengths is not a function`.

- [ ] **Step 3: Implement `selectSignatureStrengths`**

Create `website/src/lib/verdict.ts`:

```typescript
import type {
  BuildDetailData,
  BuildScores,
  DimensionScoreDetail,
  ScorecardQualitative,
} from "./types.ts";

export type SignatureStrength = {
  key: keyof ScorecardQualitative;
  label: string;
  score: number;
  explanation: string;
};

const QUALITATIVE_LABELS: Record<keyof ScorecardQualitative, string> = {
  talent_coherence: "Talent Coherence",
  blessing_synergy: "Blessing Synergy",
  role_coverage: "Role Coverage",
  breakpoint_relevance: "Breakpoint Relevance",
  difficulty_scaling: "Difficulty Scaling",
};

type QualitativeEntry = {
  key: keyof ScorecardQualitative;
  detail: DimensionScoreDetail;
  score: number;
};

function collectQualitative(qualitative: ScorecardQualitative, scores: BuildScores): QualitativeEntry[] {
  const entries: QualitativeEntry[] = [];
  for (const key of Object.keys(QUALITATIVE_LABELS) as Array<keyof ScorecardQualitative>) {
    const detail = qualitative[key];
    const score = scores[key];
    if (detail == null || score == null) continue;
    entries.push({ key, detail, score });
  }
  return entries;
}

function toStrength(entry: QualitativeEntry): SignatureStrength {
  return {
    key: entry.key,
    label: QUALITATIVE_LABELS[entry.key],
    score: entry.score,
    explanation: entry.detail.explanations[0] ?? "",
  };
}

export function selectSignatureStrengths(
  qualitative: ScorecardQualitative,
  scores: BuildScores,
): SignatureStrength[] {
  const entries = collectQualitative(qualitative, scores);
  if (entries.length === 0) return [];

  const ranked = [...entries].sort((a, b) => b.score - a.score);
  const topTwo = ranked.filter((entry) => entry.score >= 4).slice(0, 2);
  if (topTwo.length > 0) return topTwo.map(toStrength);

  return [toStrength(ranked[0])];
}
```

- [ ] **Step 4: Re-run tests — confirm pass**

Run: `cd website && npm run test -- --test-name-pattern="selectSignatureStrengths"`

Expected: 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add website/src/lib/verdict.ts website/src/lib/verdict.test.ts
git commit -m "feat(website): add selectSignatureStrengths helper for verdict strip"
```

---

## Task 2: Verdict helper module — risk bullets

**Files:**
- Modify: `website/src/lib/verdict.ts` (append)
- Modify: `website/src/lib/verdict.test.ts` (append)

- [ ] **Step 1: Write failing tests for `buildRiskBullets`**

Merge the new imports into the existing `import` block at the top of `website/src/lib/verdict.test.ts`. The import section should end up as:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { selectSignatureStrengths, buildRiskBullets, type RiskBullet } from "./verdict.ts";
import type { BuildDetailData, BuildScores, ScorecardQualitative } from "./types.ts";
```

Then append the following after the existing `describe("selectSignatureStrengths", …)` block:

```typescript

function makeDetail(overrides: {
  qualitative?: Partial<ScorecardQualitative>;
  scores?: Partial<BuildScores>;
  coverageGaps?: string[];
  antiSynergies?: number;
  orphans?: number;
  calcCoveragePct?: number;
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
        calc_coverage_pct: overrides.calcCoveragePct ?? 50,
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

  it("always includes the calc coverage bullet as the final entry", () => {
    const bullets = buildRiskBullets(makeDetail({ calcCoveragePct: 38 }));
    const last = bullets[bullets.length - 1];
    assert.equal(last.kind, "calc_coverage");
    assert.equal(last.text, "Calc coverage 38%");
  });

  it("emits a single 'Clean verdict' bullet plus calc coverage when no risks trigger", () => {
    const bullets = buildRiskBullets(makeDetail());
    assert.equal(bullets.length, 2);
    assert.equal(bullets[0].kind, "clean");
    assert.equal(bullets[0].text, "Clean verdict \u2014 no flagged risks");
    assert.equal(bullets[1].kind, "calc_coverage");
  });
});
```

- [ ] **Step 2: Run the new tests — confirm they fail**

Run: `cd website && npm run test -- --test-name-pattern="buildRiskBullets"`

Expected: FAIL with `buildRiskBullets is not a function`.

- [ ] **Step 3: Implement `buildRiskBullets` and its types**

Add `import { formatCoverageLabel } from "./detail-format.ts";` to the existing import block at the top of `website/src/lib/verdict.ts` (beside the `./types.ts` import). Then append the rest of the new code to the bottom of the file:

```typescript

export type RiskBullet =
  | { kind: "low_dimension"; text: string }
  | { kind: "gaps"; text: string }
  | { kind: "anti_orphan"; text: string }
  | { kind: "clean"; text: string }
  | { kind: "calc_coverage"; text: string };

// Note: this function is at the bottom of the file and reuses `QUALITATIVE_LABELS`,
// `QualitativeEntry`, and `collectQualitative` defined earlier in Task 1.

function pickLowestQualitative(
  qualitative: ScorecardQualitative,
  scores: BuildScores,
): QualitativeEntry | null {
  const entries = collectQualitative(qualitative, scores);
  if (entries.length === 0) return null;
  return entries.reduce((lowest, entry) => (entry.score < lowest.score ? entry : lowest), entries[0]);
}

export function buildRiskBullets(detail: BuildDetailData): RiskBullet[] {
  const bullets: RiskBullet[] = [];

  const lowest = pickLowestQualitative(detail.scorecard.qualitative, detail.summary.scores);
  if (lowest && lowest.score <= 2) {
    const label = QUALITATIVE_LABELS[lowest.key];
    const explanation = lowest.detail.explanations[0] ?? "";
    bullets.push({
      kind: "low_dimension",
      text: explanation ? `${label} ${lowest.score}/5 \u2014 ${explanation}` : `${label} ${lowest.score}/5`,
    });
  }

  const gaps = detail.synergy.coverage.coverage_gaps;
  if (gaps.length > 0) {
    const formatted = gaps.map((gap) => formatCoverageLabel(gap)).join(" \u00b7 ");
    bullets.push({ kind: "gaps", text: `Gaps: ${formatted}` });
  }

  const antiCount = detail.synergy.anti_synergies.length;
  const orphanCount = detail.synergy.orphans.length;
  if (antiCount > 0 || orphanCount > 0) {
    const antiLabel = `${antiCount} anti-synergies`;
    const orphanLabel = `${orphanCount} isolated pick${orphanCount === 1 ? "" : "s"}`;
    bullets.push({ kind: "anti_orphan", text: `${antiLabel} \u00b7 ${orphanLabel}` });
  }

  if (bullets.length === 0) {
    bullets.push({ kind: "clean", text: "Clean verdict \u2014 no flagged risks" });
  }

  const pct = Math.round(detail.synergy.metadata.calc_coverage_pct);
  bullets.push({ kind: "calc_coverage", text: `Calc coverage ${pct}%` });

  return bullets;
}
```

- [ ] **Step 4: Run full verdict test file — confirm all pass**

Run: `cd website && npm run test -- --test-name-pattern="(selectSignatureStrengths|buildRiskBullets)"`

Expected: all 12 tests passing.

- [ ] **Step 5: Run the full website test suite to check for regressions**

Run: `cd website && npm run test`

Expected: all tests passing (no other tests should have broken).

- [ ] **Step 6: Commit**

```bash
git add website/src/lib/verdict.ts website/src/lib/verdict.test.ts
git commit -m "feat(website): add buildRiskBullets helper for verdict strip"
```

---

## Task 3: VerdictStrip component

**Files:**
- Create: `website/src/lib/VerdictStrip.svelte`
- Modify: `website/src/app.css` (append verdict rules)

- [ ] **Step 1: Add the CSS rules**

Append to `website/src/app.css` — place immediately after the existing `.ds-ledger-card__value--text` block (around line 905):

```css
.ds-verdict {
  display: grid;
  gap: 1.1rem;
  grid-template-columns: minmax(0, 1fr);
}

@media (min-width: 48rem) {
  .ds-verdict { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

.ds-verdict-tile {
  padding: 1.1rem 1.2rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-height: 9.5rem;
}

.ds-verdict-tile__primary {
  font-family: var(--ds-font-display);
  color: var(--ds-ink);
  font-size: 1.05rem;
  line-height: 1.3;
}

.ds-verdict-tile__secondary {
  font-size: 0.85rem;
  color: var(--ds-ink-dim);
}

.ds-verdict-tile__caption {
  font-size: 0.75rem;
  color: var(--ds-ink-dim);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ds-verdict-tile__strength-line {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  color: var(--ds-ink);
  font-weight: 500;
}

.ds-verdict-tile__strength-note {
  font-size: 0.82rem;
  color: var(--ds-ink-dim);
  margin: 0.1rem 0 0.35rem 0;
}

.ds-risk-bullets {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.ds-risk-bullets li {
  font-size: 0.85rem;
  color: var(--ds-ink);
  padding-left: 0.75rem;
  position: relative;
}

.ds-risk-bullets li::before {
  content: "\2022";
  color: var(--ds-brass);
  position: absolute;
  left: 0;
}

.ds-risk-bullets li.ds-risk-bullets__low { color: var(--ds-blood); }
.ds-risk-bullets li.ds-risk-bullets__clean { color: var(--ds-ink-dim); font-style: italic; }
.ds-risk-bullets li.ds-risk-bullets__calc { color: var(--ds-ink-dim); font-size: 0.78rem; }
```

- [ ] **Step 2: Create `VerdictStrip.svelte`**

Create `website/src/lib/VerdictStrip.svelte`:

```svelte
<script lang="ts">
  import type { BuildDetailData } from "./types.ts";
  import { formatCoverageLabel } from "./detail-format.ts";
  import { selectSignatureStrengths, buildRiskBullets, type RiskBullet } from "./verdict.ts";

  type Props = { detail: BuildDetailData };
  let { detail }: Props = $props();

  const identity = $derived(detail.synergy.coverage.build_identity);
  const slotBalance = $derived(detail.synergy.coverage.slot_balance);
  const concentration = $derived(detail.synergy.coverage.concentration);
  const strengths = $derived(selectSignatureStrengths(detail.scorecard.qualitative, detail.summary.scores));
  const risks: RiskBullet[] = $derived(buildRiskBullets(detail));

  function riskClass(kind: RiskBullet["kind"]): string {
    if (kind === "low_dimension") return "ds-risk-bullets__low";
    if (kind === "clean") return "ds-risk-bullets__clean";
    if (kind === "calc_coverage") return "ds-risk-bullets__calc";
    return "";
  }

  const identityLabel = $derived(
    identity.length > 0 ? identity.map((family) => formatCoverageLabel(family)).join(" \u00b7 ") : "Undefined role",
  );
</script>

<div class="ds-verdict">
  <article class="ds-parchment ds-verdict-tile">
    <span class="ds-corner ds-corner--tl"></span>
    <span class="ds-corner ds-corner--br"></span>
    <span class="ds-label">Role Fingerprint</span>
    <div class="ds-verdict-tile__primary">{identityLabel}</div>
    <div class="ds-verdict-tile__secondary">
      Melee {slotBalance.melee.strength} &middot; Ranged {slotBalance.ranged.strength}
    </div>
    <div class="ds-verdict-tile__caption">Concentration {concentration}</div>
  </article>

  <article class="ds-parchment ds-verdict-tile">
    <span class="ds-corner ds-corner--tl"></span>
    <span class="ds-corner ds-corner--br"></span>
    <span class="ds-label">Signature Strengths</span>
    {#if strengths.length > 0}
      {#each strengths as strength (strength.key)}
        <div>
          <div class="ds-verdict-tile__strength-line">
            <span>{strength.label}</span>
            <span class="ds-score ds-score--mid">{strength.score}/5</span>
          </div>
          {#if strength.explanation}
            <p class="ds-verdict-tile__strength-note">{strength.explanation}</p>
          {/if}
        </div>
      {/each}
    {:else}
      <p class="ds-verdict-tile__strength-note">No qualitative dimensions scored.</p>
    {/if}
  </article>

  <article class="ds-parchment ds-verdict-tile">
    <span class="ds-corner ds-corner--tl"></span>
    <span class="ds-corner ds-corner--br"></span>
    <span class="ds-label">Noted Risks</span>
    <ul class="ds-risk-bullets">
      {#each risks as risk, i (i)}
        <li class={riskClass(risk.kind)}>{risk.text}</li>
      {/each}
    </ul>
  </article>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add website/src/lib/VerdictStrip.svelte website/src/app.css
git commit -m "feat(website): add VerdictStrip component and ds-verdict CSS"
```

---

## Task 4: Restructure the detail page

**Files:**
- Modify: `website/src/routes/builds/[slug]/+page.svelte`

This is a single coordinated edit: add the VerdictStrip, remove the ledger row, reorder Armoury above Synergy, wrap Seven Dimensions in `<details>`, remove the standalone Coverage Stats panel (audit fields move into a collapsed block inside the synergy section).

- [ ] **Step 1: Add the VerdictStrip import**

In `website/src/routes/builds/[slug]/+page.svelte`, add the import near the existing imports (after line 21):

```typescript
  import VerdictStrip from "$lib/VerdictStrip.svelte";
```

- [ ] **Step 2: Replace the "Ledger Entries" section with the VerdictStrip**

Find the block starting with `<section class="ds-reveal ds-section">` that has the heading `<h2 class="ds-h2">Ledger Entries</h2>` (lines 244–279 in the current file). Replace the entire `<section>…</section>` with:

```svelte
    <section class="ds-reveal ds-section">
      <header class="ds-section-heading">
        <div class="ds-section-heading__copy">
          <span class="ds-label ds-label--parchment">Verdict</span>
          <h2 class="ds-h2">Field Assessment</h2>
        </div>
        <div class="ds-rule"><span class="ds-rule__mark">✠</span></div>
      </header>

      <VerdictStrip detail={data.detail} />
    </section>
```

- [ ] **Step 3: Move the Armoury Record section above the Synergy section**

In the current file:
- The "Armoury Record / Weapons" section (heading `<h2 class="ds-h2">Weapons</h2>`) lives at lines 369–432.
- The "Cross-Reference / Synergy" section (heading `<h2 class="ds-h2">Synergy</h2>`) lives at lines 434–601.
- The "Assessment / Seven Dimensions & Composite" section lives at lines 344–367.

Reorder so the order becomes:

1. Hero
2. Verdict (new, from Step 2)
3. Ordo Manifest (existing "Declared Loadout / Ordo Manifest" block — unchanged)
4. Armoury Record / Weapons
5. Synergy
6. Seven Dimensions (now wrapped in `<details>` — Step 4)
7. Cogitator Breakpoint Matrix

Cut the Armoury `<section>` (current lines 369–432) and paste it immediately after the Ordo Manifest `<section>` closing tag. Verify: the file ends with the Cogitator `<section>` last.

- [ ] **Step 4: Demote Seven Dimensions grid behind `<details>`**

Replace the existing "Assessment / Seven Dimensions & Composite" section with a `<details>` wrapper. The new block:

```svelte
    <section class="ds-reveal ds-section">
      <header class="ds-section-heading">
        <div class="ds-section-heading__copy">
          <span class="ds-label ds-label--parchment">Assessment</span>
          <h2 class="ds-h2">Seven Dimensions &amp; Composite</h2>
        </div>
        <div class="ds-rule"><span class="ds-rule__mark">✠</span></div>
      </header>

      <details class="ds-discl">
        <summary>
          Composite {data.detail.summary.scores.composite} / 35 &middot; Grade {data.detail.summary.scores.grade} &middot; show full scorecard
        </summary>
        <div class="ds-dim-grid" style="margin-top:0.9rem">
          {#each dimensionCards as card}
            <article class="ds-parchment ds-dim-card">
              <div class="ds-label">{card.label}</div>
              <div class="ds-dim-card__head">
                <span class="ds-score {dsScoreColor(card.score, card.key === 'composite')}">{card.score ?? "\u2014"}</span>
                <span class="ds-numeral-max">/ {card.max}</span>
              </div>
              {#if card.explanation}
                <p class="ds-dim-card__note">{card.explanation}</p>
              {/if}
            </article>
          {/each}
        </div>
      </details>
    </section>
```

Position this new section between Synergy and Cogitator. After the reorder the page should read: Hero → Verdict → Ordo Manifest → Armoury → Synergy → Seven Dimensions (collapsed) → Cogitator.

- [ ] **Step 5: Collapse the standalone Coverage Stats panel into a disclosure inside Synergy**

Find the Coverage Stats panel inside the Synergy section (currently lines 560–600 — `<h3 class="ds-h3">Coverage Stats</h3>` inside an `<article class="ds-parchment ds-panel">`). Wrap its *contents* in a `<details>` and move it inside the synergy section so it appears after the synergy-edges / anti-synergies / orphans grid. The new block:

```svelte
      <details class="ds-discl">
        <summary>Analytical coverage audit</summary>
        <article class="ds-parchment ds-panel" style="margin-top:0.8rem">
          <div class="ds-coverage-grid">
            <div class="ds-coverage-cell">
              <div class="ds-label">Calc Coverage</div>
              <div class="ds-coverage-cell__value">{formatCoverageFraction(data.detail.synergy.metadata.calc_coverage_pct)}</div>
            </div>
            <div class="ds-coverage-cell">
              <div class="ds-label">Entities Analyzed</div>
              <div class="ds-coverage-cell__value">{data.detail.synergy.metadata.entities_analyzed}</div>
            </div>
            <div class="ds-coverage-cell">
              <div class="ds-label">Entities With Calc</div>
              <div class="ds-coverage-cell__value">{data.detail.synergy.metadata.unique_entities_with_calc}</div>
            </div>
            <div class="ds-coverage-cell">
              <div class="ds-label">Opaque Conditions</div>
              <div class="ds-coverage-cell__value">{data.detail.synergy.metadata.opaque_conditions}</div>
            </div>
          </div>

          <div class="ds-coverage-grid" style="grid-template-columns:1fr;margin-top:1rem">
            <div class="ds-coverage-cell" style="background:rgba(26,15,8,0.05)">
              <div class="ds-label">Build Identity</div>
              <p class="ds-body" style="margin-top:0.55rem">{coverageLabels(data.detail.synergy.coverage.build_identity)}</p>
              <p class="ds-label" style="margin-top:0.4rem">Concentration {data.detail.synergy.coverage.concentration}</p>
            </div>
            <div class="ds-coverage-cell" style="background:rgba(26,15,8,0.05)">
              <div class="ds-label">Coverage Gaps</div>
              <p class="ds-body" style="margin-top:0.55rem">{coverageLabels(data.detail.synergy.coverage.coverage_gaps)}</p>
            </div>
            <div class="ds-coverage-cell" style="background:rgba(26,15,8,0.05)">
              <div class="ds-label">Slot Balance</div>
              <p class="ds-body" style="margin-top:0.55rem">
                Melee {data.detail.synergy.coverage.slot_balance.melee.strength} &middot; Ranged {data.detail.synergy.coverage.slot_balance.ranged.strength}
              </p>
            </div>
          </div>
        </article>
      </details>
```

Delete the original Coverage Stats `<article>` block (the full `<article class="ds-parchment ds-panel">…<h3>Coverage Stats</h3>…</article>` and everything inside).

- [ ] **Step 6: Verify the file compiles — run the SvelteKit dev check**

Run: `cd website && npm run build`

Expected: build succeeds, no Svelte or TypeScript errors. If the file is broken, check for:
- Orphaned closing tags after the cut-and-paste reorder
- Missing import of `VerdictStrip`
- Stale references to removed Ledger cards

- [ ] **Step 7: Run the test suite**

Run: `cd website && npm run test`

Expected: all tests pass — no test file touches the page structure directly, so no new breakage is expected.

- [ ] **Step 8: Commit**

```bash
git add website/src/routes/builds/[slug]/+page.svelte
git commit -m "feat(website): reorder detail page verdict-first (#26)

Verdict strip replaces ledger entries row. Armoury promotes above synergy.
Seven-dimensions grid and coverage stats panel now sit behind <details>.
"
```

---

## Task 5: Full verification — build + suite + manual Playwright

**Files:** none modified.

- [ ] **Step 1: Run the full website pipeline**

Run (from repo root): `make website-build`

Expected: library compile → data generation → SvelteKit build, all green. Output artifacts land in `website/build/`.

- [ ] **Step 2: Start the dev server**

Run: `cd website && npm run dev`

Expected: dev server listens on `http://localhost:5173` (or whichever port Vite chooses — read the startup log).

- [ ] **Step 3: Playwright — high-scoring build (clean verdict)**

Use the MCP Playwright tools. URL: `http://localhost:5173/builds/17-arbites-busted` (adjust port from Step 2 if needed).

Verify in order:
1. Navigate and take a full-page screenshot.
2. Confirm the Verdict section sits immediately below the hero (before Ordo Manifest).
3. Confirm the "Noted Risks" tile contains the text `Clean verdict — no flagged risks` and a `Calc coverage NN%` line.
4. Confirm the Armoury/Weapons section appears above the Synergy section.
5. Click the "Composite … show full scorecard" `<summary>` — the dimension grid expands.
6. Click the "Analytical coverage audit" `<summary>` inside synergy — the coverage grid expands.

If any expectation fails, capture the screenshot and diagnose before continuing.

- [ ] **Step 4: Playwright — mid/low-scoring build (triggers all risks)**

URL: `http://localhost:5173/builds/12-psyker-trauma-voidblast`.

Verify:
1. "Noted Risks" tile contains a low-dimension line (colored with `ds-blood`), a gaps line, an anti-synergies/isolated-picks line, and the calc-coverage line. It should NOT contain "Clean verdict".
2. Signature Strengths tile shows at least one dimension (fallback path is exercised when no qualitative score hits 4).
3. Role Fingerprint tile shows at least one family and a slot-balance line.

- [ ] **Step 5: Shut down the dev server and commit any incidental fixes**

If Steps 3–4 surfaced bugs (misplaced sections, missing text), fix them in `+page.svelte` or `VerdictStrip.svelte`, re-run Step 1, and commit the fix separately:

```bash
git add <files>
git commit -m "fix(website): <what broke> in verdict strip"
```

If everything passed, no commit needed in this task.

---

## Self-Review

**Spec coverage check:**

- "Verdict strip — three tiles under hero" → Task 3 (component) + Task 4 Step 2 (insertion).
- "Role Fingerprint tile with build_identity, slot balance, concentration" → Task 3.
- "Signature Strengths picks ≥4 (up to 2), falls back to top-1" → Task 1.
- "Noted Risks bullets (lowest ≤2, gaps, anti/orphan counts, calc coverage, clean-verdict fallback)" → Task 2.
- "Armoury promoted above synergy" → Task 4 Step 3.
- "Seven Dimensions grid collapsed by default" → Task 4 Step 4.
- "Coverage Stats panel absorbed into synergy `<details>`" → Task 4 Step 5.
- "No new color tokens, reuse Dataslate palette" → Task 3 CSS uses existing `--ds-ink`, `--ds-ink-dim`, `--ds-brass`, `--ds-blood`.
- "node:test via tsx --test" → Task 1 and Task 2 tests.
- "Playwright verification on 2 representative builds" → Task 5.
- "make website-build passes" → Task 5 Step 1.

No gaps.

**Placeholder scan:** no TBDs, no "similar to above" — every step has its own code block.

**Type consistency:** `selectSignatureStrengths(qualitative, scores)` — both tests and implementation call it with two args. `buildRiskBullets(detail)` — both tests and implementation call it with the full detail object. `RiskBullet` kinds match between helper impl and the component's `riskClass` mapping.

---

## Out of scope (reminders)

- No list-route or compare-route changes.
- No hover cards for talents or weapons.
- No scoring / synergy / calculator changes.
- No new color tokens.
- No automated Playwright regression suite — Task 5 is manual verification only.
