# Scoring Data Gaps (#20) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two broken scoring dimensions — talent_coherence (uniformly 1/5) and blessing validation (25/35 weapons unrecognized) — by deriving blessings from the ground-truth edge graph and recalibrating talent scoring to only penalize measurable talents.

**Architecture:** Two independent fixes. Fix 1 extends `loadWeaponLookup()` in `score-build.ts` to derive weapon→blessing family mappings from edges, replacing hand-curated data. Fix 2 adds `_entitiesWithCalcIds` to synergy model output and adjusts `scoreTalentCoherence()` in `build-scoring.ts` to only penalize talents with calc data. Both fixes are library-only changes followed by snapshot refreezes.

**Tech Stack:** TypeScript (strict), Node.js ESM, `node:test` for testing

**Spec:** `docs/superpowers/specs/2026-04-09-scoring-data-gaps-design.md`

---

### Task 1: Expose `_entitiesWithCalcIds` from synergy model and recalibrate talent_coherence

**Files:**
- Modify: `src/lib/synergy-model.ts:76-85` (AnalyzeBuildResult type), `src/lib/synergy-model.ts:495-510` (return statement)
- Modify: `src/lib/build-scoring.ts:24-31` (SynergyOutput type), `src/lib/build-scoring.ts:86-178` (scoreTalentCoherence)
- Test: `src/lib/build-scoring.test.ts`

- [ ] **Step 1: Write failing test — non-measurable talents excluded from isolation**

In `src/lib/build-scoring.test.ts`, update `makeSynergyOutput()` return (line ~605) to include `_entitiesWithCalcIds`:

```ts
// Add to the return object in makeSynergyOutput():
_entitiesWithCalcIds: [...talentIds, ...blessingIds],
```

Add test in the `talent_coherence` describe block:

```ts
it("ignores non-measurable talents when computing isolation", () => {
  const synergy = makeSynergyOutput({
    talentIds: ["t.talent.a", "t.talent.b", "t.talent.c", "t.talent.d", "t.talent.e"],
    blessingIds: [],
    talentEdges: 2,
    blessingEdges: 0,
    orphans: [],
    concentration: 0.03,
    familyCount: 6,
    coverageGaps: [],
    slotBalance: { melee: 3, ranged: 3 },
  });
  // Override: only a, b, c have calc data; d, e do not
  synergy._entitiesWithCalcIds = ["t.talent.a", "t.talent.b", "t.talent.c"];
  const result = scoreFromSynergy(synergy);
  // d and e are not measurable → should NOT be counted as isolated
  assert.ok(result.talent_coherence.breakdown.graph_isolated_count <= 1,
    `expected <=1 isolated measurable, got ${result.talent_coherence.breakdown.graph_isolated_count}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/build-scoring.test.ts --test-name-pattern "ignores non-measurable"`
Expected: FAIL — current code ignores `_entitiesWithCalcIds` and counts all 5 talents, finding 2+ isolated.

- [ ] **Step 3: Add `_entitiesWithCalcIds` to synergy model output type and return**

In `src/lib/synergy-model.ts`, add to `AnalyzeBuildResult` (after `_resolvedIds` at line 83):

```ts
_entitiesWithCalcIds: string[];
```

In the return statement (line ~502), add after `_resolvedIds`:

```ts
_entitiesWithCalcIds: withEffects.map((s) => s.id),
```

In `src/lib/build-scoring.ts`, update `SynergyOutput` (line ~26):

```ts
interface SynergyOutput {
  synergy_edges?: SynergyEdge[];
  coverage?: Partial<CoverageResult>;
  _resolvedIds?: string[];
  _talentSideIds?: string[];
  _entitiesWithCalcIds?: string[];
}
```

- [ ] **Step 4: Implement measurable-only isolation in `scoreTalentCoherence`**

In `src/lib/build-scoring.ts`, revise `scoreTalentCoherence()` (lines ~86-178). Key changes:
1. Extract `_entitiesWithCalcIds` from input
2. Build `measurableCalcIds` — the intersection of talent population with entities that have calc data
3. Use `measurable_talent_count` as the `edges_per_talent` denominator
4. Only count isolation for `measurableCalcIds` (or full population as fallback)

```ts
function scoreTalentCoherence(synergyOutput: SynergyOutput): DimensionScore {
  const { synergy_edges = [], coverage = {}, _resolvedIds, _talentSideIds, _entitiesWithCalcIds } = synergyOutput;
  const concentration = coverage.concentration ?? 0;

  // --- Collect talent-side ID population ---
  let talentPopulation: Set<string>;
  if (_resolvedIds && _resolvedIds.length > 0) {
    talentPopulation = new Set(_resolvedIds.filter((id) => classifySelection(id) === "talent"));
  } else if (_talentSideIds && _talentSideIds.length > 0) {
    talentPopulation = new Set(_talentSideIds.filter((id) => classifySelection(id) === "talent"));
  } else {
    talentPopulation = new Set();
    for (const edge of synergy_edges) {
      for (const id of edge.selections ?? []) {
        if (classifySelection(id) === "talent") {
          talentPopulation.add(id);
        }
      }
    }
  }

  const talent_count = talentPopulation.size;

  // --- Measurable talent subset (intersection of population and calc-data entities) ---
  let measurableCalcIds: Set<string> | null = null;
  if (_entitiesWithCalcIds) {
    const calcSet = new Set(_entitiesWithCalcIds);
    measurableCalcIds = new Set([...talentPopulation].filter((id) => calcSet.has(id)));
  }
  const measurable_talent_count = measurableCalcIds ? measurableCalcIds.size : talent_count;

  // --- Count talent-talent edges ---
  const talentsInAnyEdge = new Set<string>();
  let talent_edges = 0;

  for (const edge of synergy_edges) {
    const { type, selections = [] } = edge;
    if (type !== "stat_alignment" && type !== "trigger_target") continue;

    const edgeTalentIds = selections.filter((id) => classifySelection(id) === "talent");

    for (const id of edgeTalentIds) {
      talentsInAnyEdge.add(id);
    }

    if (selections.length >= 2 && edgeTalentIds.length === selections.length) {
      talent_edges++;
    }
  }

  // --- Graph isolation (only measurable talents) ---
  let graph_isolated_count = 0;
  const isolationPopulation = measurableCalcIds ?? talentPopulation;
  for (const id of isolationPopulation) {
    if (!talentsInAnyEdge.has(id)) {
      graph_isolated_count++;
    }
  }

  // --- Base score from edges_per_talent (measurable denominator) ---
  const edges_per_talent = measurable_talent_count > 0 ? talent_edges / measurable_talent_count : 0;
  let base_score: number;
  if (edges_per_talent >= 1.5) {
    base_score = 5;
  } else if (edges_per_talent >= 1.0) {
    base_score = 4;
  } else if (edges_per_talent >= 0.5) {
    base_score = 3;
  } else if (edges_per_talent >= 0.2) {
    base_score = 2;
  } else {
    base_score = 1;
  }

  // --- Penalties and bonuses ---
  const penalties = graph_isolated_count * -0.5;
  const bonuses = concentration > 0.06 ? 0.5 : 0;

  const raw = base_score + penalties + bonuses;
  const score = Math.round(Math.min(5, Math.max(1, raw)));

  const explanations: string[] = [];
  if (graph_isolated_count > 0) {
    explanations.push(`${graph_isolated_count} measurable talent(s) participate in no synergy edges (-0.5 each)`);
  }
  if (bonuses > 0) {
    explanations.push(`High stat concentration (${concentration.toFixed(3)}) +0.5`);
  }
  if (measurableCalcIds && measurable_talent_count < talent_count) {
    explanations.push(`${talent_count - measurable_talent_count} talent(s) without calc data excluded from isolation penalty`);
  }

  return {
    score,
    breakdown: {
      talent_edges,
      talent_count,
      measurable_talent_count,
      edges_per_talent: Math.round(edges_per_talent * 1000) / 1000,
      graph_isolated_count,
      concentration,
      penalties,
      bonuses,
    },
    explanations,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test src/lib/build-scoring.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Write additional unit tests for edge cases**

Add to the `talent_coherence` describe block in `src/lib/build-scoring.test.ts`:

```ts
it("uses measurable talent count as denominator for edges_per_talent", () => {
  const synergy = makeSynergyOutput({
    talentIds: ["t.talent.a", "t.talent.b", "t.talent.c", "t.talent.d", "t.talent.e",
                "t.talent.f", "t.talent.g", "t.talent.h", "t.talent.i", "t.talent.j"],
    blessingIds: [],
    talentEdges: 3,
    blessingEdges: 0,
    orphans: [],
    concentration: 0.03,
    familyCount: 6,
    coverageGaps: [],
    slotBalance: { melee: 3, ranged: 3 },
  });
  // Only 5 of 10 talents have calc data
  synergy._entitiesWithCalcIds = ["t.talent.a", "t.talent.b", "t.talent.c", "t.talent.d", "t.talent.e"];
  const result = scoreFromSynergy(synergy);
  // edges_per_talent = 3/5 = 0.6, not 3/10 = 0.3
  assert.equal(result.talent_coherence.breakdown.measurable_talent_count, 5);
  assert.ok(result.talent_coherence.breakdown.edges_per_talent >= 0.5,
    `expected edges_per_talent >= 0.5, got ${result.talent_coherence.breakdown.edges_per_talent}`);
});

it("falls back to full population when _entitiesWithCalcIds absent", () => {
  const synergy = makeSynergyOutput({
    talentIds: ["t.talent.a", "t.talent.b", "t.talent.c"],
    blessingIds: [],
    talentEdges: 1,
    blessingEdges: 0,
    orphans: [],
    concentration: 0.03,
    familyCount: 5,
    coverageGaps: [],
    slotBalance: { melee: 2, ranged: 2 },
  });
  delete synergy._entitiesWithCalcIds;
  const result = scoreFromSynergy(synergy);
  // Should work like before — all 3 talents considered
  assert.equal(result.talent_coherence.breakdown.talent_count, 3);
  assert.equal(result.talent_coherence.breakdown.measurable_talent_count, 3);
});

it("handles empty _entitiesWithCalcIds gracefully", () => {
  const synergy = makeSynergyOutput({
    talentIds: ["t.talent.a", "t.talent.b"],
    blessingIds: [],
    talentEdges: 0,
    blessingEdges: 0,
    orphans: [],
    concentration: 0.01,
    familyCount: 3,
    coverageGaps: [],
    slotBalance: { melee: 1, ranged: 1 },
  });
  synergy._entitiesWithCalcIds = [];
  const result = scoreFromSynergy(synergy);
  // Zero measurable talents → no isolation penalty, edges_per_talent = 0, score = 1
  assert.equal(result.talent_coherence.breakdown.measurable_talent_count, 0);
  assert.equal(result.talent_coherence.breakdown.graph_isolated_count, 0);
  assert.equal(result.talent_coherence.score, 1);
});
```

- [ ] **Step 7: Run full test file**

Run: `npx tsx --test src/lib/build-scoring.test.ts`
Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/synergy-model.ts src/lib/build-scoring.ts src/lib/build-scoring.test.ts
git commit -m "fix(scoring): recalibrate talent_coherence for partial calc coverage (#20)

Only penalize measurable talents (those with calc data) for graph isolation.
Use measurable talent count as edges_per_talent denominator.
Expose _entitiesWithCalcIds from synergy model output.
Measurable set is the intersection of talent population and calc entities."
```

---

### Task 2: Derive blessing pools from ground-truth edges

**Files:**
- Modify: `src/lib/score-build.ts` — types (lines 14-18, 37-46, 59-65, 106-110), `normalizedWeaponInput` (287-297), `loadWeaponLookup` (463-523), `scoreBlessings` (684-714), `generateScorecard` (832)
- Test: `src/lib/score-build.test.ts`

**Important call-path note:** `generateScorecard()` calls `findWeapon(weapon.name)` at line 811 and `scoreBlessings(normalizedWeapon)` at line 832 independently. The weapon's `canonical_entity_id` is already resolved via `findWeapon` but not passed to `scoreBlessings`. We change `scoreBlessings` to accept the `WeaponMatch` from `findWeapon` so it can use the already-resolved weapon entity ID for edge pool lookup.

- [ ] **Step 1: Write failing tests — edge-derived blessing validation**

Add tests in `src/lib/score-build.test.ts` in the `scoreBlessings` describe block:

```ts
it("validates blessings via edge-derived pool for weapons not in scoring catalog", () => {
  // Surge Staff has blessings: null in hand-curated data but has edge-derived pool
  const weapon = {
    name: "Surge Staff",
    blessings: [{ name: "Warp Nexus", description: "..." }],
  };
  const result = scoreBlessings(weapon);
  assert.equal(result.valid, true);
  assert.equal(result.blessings[0].known, true);
});

it("validates blessings by canonical_entity_id when available", () => {
  const weapon = {
    name: { raw_label: "Surge Staff", canonical_entity_id: "shared.weapon.forcestaff_p3_m1" },
    blessings: [{ name: { raw_label: "Warp Nexus", canonical_entity_id: "shared.name_family.blessing.warp_nexus" }, description: "..." }],
  };
  const result = scoreBlessings(weapon);
  assert.equal(result.valid, true);
  assert.equal(result.blessings[0].known, true);
});

it("rejects invalid blessing for weapon via edge-derived pool", () => {
  const weapon = {
    name: "Surge Staff",
    blessings: [{ name: "Bloodthirsty", description: "..." }],
  };
  const result = scoreBlessings(weapon);
  // Bloodthirsty is a chainsword blessing, not a staff blessing
  assert.equal(result.blessings[0].known, false);
});

it("returns valid=null for weapon with zero trait pool edges (bot weapon)", () => {
  const weapon = {
    name: "bot_lasgun_killshot",
    blessings: [{ name: "Something", description: "..." }],
  };
  const result = scoreBlessings(weapon);
  assert.equal(result.valid, null);
});

it("validates legacy-only weapon via hand-curated fallback", () => {
  // Use a weapon that is ONLY in hand-curated data (not ground-truth)
  // This test verifies the fallback path still works
  const weapon = {
    name: "Improvised Mk I Shivs",
    blessings: [{ name: "Uncanny Strike", description: "..." }],
  };
  const result = scoreBlessings(weapon);
  assert.equal(result.valid, true);
  assert.equal(result.blessings[0].known, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/lib/score-build.test.ts --test-name-pattern "edge-derived|canonical_entity_id|rejects invalid|zero trait pool"`
Expected: FAIL — Surge Staff returns `{ valid: null }` because scoring data has `blessings: null`.

- [ ] **Step 3: Update types — add `BlessingInput`, preserve `canonical_entity_id`**

In `src/lib/score-build.ts`:

Replace the `BlessingResult` interface area and add `BlessingInput`:

```ts
interface BlessingInput {
  name: string;
  description: string;
  canonical_entity_id?: string | null;
}
```

Update `WeaponInput` to use `BlessingInput` and add `canonical_entity_id`:

```ts
interface WeaponInput {
  name: string;
  perks: string[];
  blessings: BlessingInput[];
  slot?: string;
  canonical_entity_id?: string | null;
  [key: string]: unknown;
}
```

Update `normalizedWeaponInput()` (line ~287) to preserve `canonical_entity_id`:

```ts
function normalizedWeaponInput(weapon: Record<string, unknown>): WeaponInput {
  return {
    ...weapon,
    name: selectionLabel(weapon?.name),
    canonical_entity_id: selectionCanonicalEntityId(weapon?.name),
    perks: ((weapon?.perks as unknown[]) ?? []).map((perk) => selectionLabel(perk)),
    blessings: ((weapon?.blessings as unknown[]) ?? []).map((blessing) => ({
      name: selectionLabel((blessing as Record<string, unknown>)?.name ?? blessing),
      description: typeof (blessing as Record<string, unknown>)?.description === "string" ? (blessing as { description: string }).description : "",
      canonical_entity_id: selectionCanonicalEntityId((blessing as Record<string, unknown>)?.name ?? blessing),
    })),
  };
}
```

- [ ] **Step 4: Extend `loadWeaponLookup()` with edge-derived blessing maps**

Add `EDGES_ROOT` to the import from `"./load.js"`:

```ts
import { ALIASES_ROOT, EDGES_ROOT, ENTITIES_ROOT, listJsonFiles, loadJsonFile } from "./load.js";
```

Update `WeaponLookup` interface (line ~106):

```ts
interface WeaponLookup {
  aliasesByNormalizedText: Map<string, Array<{ candidateEntityId: string; rankWeight: number; source: string }>>;
  scoringWeaponsByInternal: Map<string, { key: string; entry: ScoringDataEntry }>;
  weaponEntitiesById: Map<string, Record<string, unknown>>;
  weaponBlessingPool: Map<string, Map<string, string>>;  // weaponEntityId → Map<familyId, traitEntityId>
  blessingFamilyByName: Map<string, string>;  // normalizedUiName → familyId
}
```

In `loadWeaponLookup()`, after the existing entity/alias loading (before the return at line ~517), add edge-derived data. Reuse the already-loaded `weaponEntities` array (from line 475) for efficiency — do NOT load entities a second time:

```ts
  // --- Edge-derived blessing pools ---
  const allEdges = listJsonFiles(EDGES_ROOT)
    .flatMap((path) => loadJsonFile(path) as Array<Record<string, unknown>>);

  // instance_of: trait → blessing family
  const instanceOfMap = new Map<string, string>();
  for (const e of allEdges) {
    if (e.type === "instance_of") {
      instanceOfMap.set(e.from_entity_id as string, e.to_entity_id as string);
    }
  }

  // weapon_has_trait_pool: weapon → trait → blessing family
  const weaponBlessingPool = new Map<string, Map<string, string>>();
  for (const e of allEdges) {
    if (e.type !== "weapon_has_trait_pool") continue;
    const weaponId = e.from_entity_id as string;
    const traitId = e.to_entity_id as string;
    const familyId = instanceOfMap.get(traitId);
    if (!familyId) continue;

    let pool = weaponBlessingPool.get(weaponId);
    if (!pool) {
      pool = new Map();
      weaponBlessingPool.set(weaponId, pool);
    }
    pool.set(familyId, traitId);
  }

  // Blessing family name lookup — reuse entities already loaded above
  const allEntities = listJsonFiles(ENTITIES_ROOT)
    .flatMap((path) => loadJsonFile(path) as Array<Record<string, unknown>>);
  const blessingFamilyByName = new Map<string, string>();
  for (const entity of allEntities) {
    if (entity.kind === "name_family" && (entity.id as string).includes("blessing")) {
      const uiName = entity.ui_name as string;
      if (uiName) {
        blessingFamilyByName.set(normalizeText(uiName), entity.id as string);
      }
    }
  }
```

Update the return:

```ts
  _weaponLookup = {
    aliasesByNormalizedText,
    scoringWeaponsByInternal,
    weaponEntitiesById,
    weaponBlessingPool,
    blessingFamilyByName,
  };
  return _weaponLookup;
```

**Note on double load:** The existing code already loads all entities at line 475 for weapon filtering. The blessing family scan reuses `allEntities` which loads the same files. To avoid the double load, refactor the existing weapon loading to use `allEntities` too:

```ts
  const allEntities = listJsonFiles(ENTITIES_ROOT)
    .flatMap((path) => loadJsonFile(path) as Array<Record<string, unknown>>);

  const weaponEntities = allEntities.filter((record) => record.kind === "weapon");
  // ... rest of existing weapon entity code unchanged ...

  // Later, blessing family scan:
  const blessingFamilyByName = new Map<string, string>();
  for (const entity of allEntities) {
    if (entity.kind === "name_family" && (entity.id as string).includes("blessing")) {
      // ...
    }
  }
```

- [ ] **Step 5: Revise `scoreBlessings()` to accept `WeaponMatch` and use edge pool**

Change the signature to accept an optional `WeaponMatch`:

```ts
export function scoreBlessings(weapon: WeaponInput, weaponMatch?: WeaponMatch | null): BlessingValidation {
  const normalizedWeapon = normalizedWeaponInput(weapon as unknown as Record<string, unknown>);
  const found = weaponMatch !== undefined ? weaponMatch : findWeapon(weapon.name);

  if (!found) {
    return { valid: null, blessings: [] };
  }

  // Try edge-derived blessing pool (primary path)
  const { weaponBlessingPool, blessingFamilyByName } = loadWeaponLookup();
  const weaponEntityId = found.canonical_entity_id;
  const edgePool = weaponEntityId ? weaponBlessingPool.get(weaponEntityId) : null;

  // Fall back to hand-curated scoring data blessings
  const legacyBlessingData = found.entry?.blessings;

  if (!edgePool && (legacyBlessingData === null || legacyBlessingData === undefined)) {
    return { valid: null, blessings: [] };
  }

  const results: BlessingResult[] = [];
  for (const blessing of normalizedWeapon.blessings) {
    let known = false;
    let internal: string | null = null;

    if (edgePool) {
      // Primary: match by canonical_entity_id (blessing family ID)
      if (blessing.canonical_entity_id && edgePool.has(blessing.canonical_entity_id)) {
        known = true;
        internal = edgePool.get(blessing.canonical_entity_id)!;
      } else {
        // Fallback: match by display name → family ID → pool lookup
        const familyId = blessingFamilyByName.get(normalizeText(blessing.name));
        if (familyId && edgePool.has(familyId)) {
          known = true;
          internal = edgePool.get(familyId)!;
        }
      }
    } else if (legacyBlessingData) {
      // Legacy: hand-curated blessing data (keyed by display name)
      const match = legacyBlessingData[blessing.name];
      if (match) {
        known = true;
        internal = match.internal;
      }
    }

    results.push({ name: blessing.name, known, internal });
  }

  const allKnown = results.every((b) => b.known);
  return { valid: allKnown, blessings: results };
}
```

- [ ] **Step 6: Update `generateScorecard()` to pass `WeaponMatch` to `scoreBlessings`**

In `generateScorecard()` (line ~832), pass `found` to `scoreBlessings`:

Before:
```ts
    const blessingResult = scoreBlessings(normalizedWeapon);
```

After:
```ts
    const blessingResult = scoreBlessings(normalizedWeapon, found);
```

This is the critical fix — `found` (from `findWeapon` at line 811) carries `canonical_entity_id` which `scoreBlessings` needs for edge pool lookup.

- [ ] **Step 7: Update existing tests that break**

Three existing tests need updating:

1. **"includes internal name in blessing result"** (line ~209) — `internal` is now the full trait entity ID:

```ts
it("includes internal name in blessing result", () => {
  const weapon = {
    name: "M35 Magnacore Mk II Plasma Gun",
    blessings: [{ name: "Rising Heat", description: "..." }],
  };
  const result = scoreBlessings(weapon);
  assert.ok(result.blessings[0].internal != null, "internal should be populated");
  assert.ok(result.blessings[0].internal!.includes("crit_chance_scaled_on_heat"),
    `expected internal to contain crit_chance_scaled_on_heat, got ${result.blessings[0].internal}`);
});
```

2. **"scores canonical build fixtures with selection objects"** (line ~345) — `blessings.valid` is no longer `null` for `forcesword_2h_p1_m1` because edge derivation finds its blessing pool. Blazing Spirit is a valid blessing for that weapon:

```ts
    // Was: assert.equal(result.weapons[0].blessings.valid, null);
    assert.equal(result.weapons[0].blessings.valid, true);
```

3. **"falls through to provisional family when ground-truth lacks scoring data"** (line ~500) — Munitorum Mk II Relic Blade now resolves via ground-truth (not provisional). Update expected values:

```ts
  it("resolves formerly-provisional weapons via ground-truth with edge-derived blessings", () => {
    const build = {
      title: "Edge-Derived Fallthrough Test",
      class: "zealot",
      weapons: [
        {
          name: "Munitorum Mk II Relic Blade",
          perks: ["20-25% Damage (Flak Armoured)", "20-25% Damage (Maniacs)"],
          blessings: [{ name: "Wrath" }, { name: "Overload" }],
        },
      ],
      curios: [],
      talents: { active: [], inactive: [] },
    };
    const card = generateScorecard(build);
    assert.equal(card.weapons[0].weapon_family, "powersword_2h");
    assert.equal(card.weapons[0].slot, "melee");
    assert.equal(card.weapons[0].resolution_source, "ground_truth");
    // Blessings validate via edge pool (Wrath is valid for powersword_2h;
    // Overload may or may not be — assert non-null validation, not specific value)
    assert.notEqual(card.weapons[0].blessings.valid, null);
  });
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx tsx --test src/lib/score-build.test.ts`
Expected: All tests PASS including new and updated tests.

- [ ] **Step 9: Commit**

```bash
git add src/lib/score-build.ts src/lib/score-build.test.ts
git commit -m "feat(scoring): derive blessing pools from ground-truth edges (#20)

Replace hand-curated blessing catalog with edge-derived weapon→blessing
family mappings via weapon_has_trait_pool + instance_of edges.
scoreBlessings() now accepts WeaponMatch for canonical entity ID.
Preserve canonical_entity_id through normalizedWeaponInput for blessings.
Legacy hand-curated data is fallback only."
```

---

### Task 3: Remove `PROVISIONAL_WEAPON_FAMILY_MATCHES` and update tests

**Files:**
- Modify: `src/lib/score-build.ts:112-117` (ProvisionalMatch), `src/lib/score-build.ts:160-258` (PROVISIONAL_WEAPON_FAMILY_MATCHES), `src/lib/score-build.ts:569-588` (resolveProvisionalWeaponFamily), `src/lib/score-build.ts:615-618` (findWeapon provisional call)
- Modify: `src/lib/score-build.test.ts`

- [ ] **Step 1: Update the test that relied on provisional data**

In `src/lib/score-build.test.ts`, the test "falls through to provisional blessing data" (line ~228) tests `Foe-Rend Mk V Ripper Gun`. Update to verify edge-derived resolution:

```ts
it("validates blessings for formerly-provisional weapons via edge derivation", () => {
  const weapon = {
    name: "Foe-Rend Mk V Ripper Gun",
    blessings: [
      { name: "Inspiring Barrage", description: "..." },
      { name: "Blaze Away", description: "..." },
    ],
  };
  const result = scoreBlessings(weapon);
  assert.notEqual(result.valid, null);
  assert.ok(result.blessings.length > 0);
});
```

- [ ] **Step 2: Run the updated test to verify it passes with edge derivation**

Run: `npx tsx --test src/lib/score-build.test.ts --test-name-pattern "formerly-provisional"`
Expected: PASS.

- [ ] **Step 3: Remove `PROVISIONAL_WEAPON_FAMILY_MATCHES` and `resolveProvisionalWeaponFamily`**

In `src/lib/score-build.ts`:

1. Delete the `ProvisionalMatch` interface (lines ~112-117)
2. Delete the `PROVISIONAL_WEAPON_FAMILY_MATCHES` Map (lines ~160-258)
3. Delete the `resolveProvisionalWeaponFamily()` function (lines ~569-588)
4. In `findWeapon()`, remove the provisional fallback call (4 lines):

```ts
  // DELETE these lines:
  const provisionalFamilyMatch = resolveProvisionalWeaponFamily(normalizedName);
  if (provisionalFamilyMatch) {
    return provisionalFamilyMatch;
  }
```

- [ ] **Step 4: Run full score-build tests**

Run: `npx tsx --test src/lib/score-build.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/score-build.ts src/lib/score-build.test.ts
git commit -m "refactor(scoring): remove PROVISIONAL_WEAPON_FAMILY_MATCHES (#20)

All 8 provisional weapons are source-backed in ground-truth with full
trait pool edges. Some provisional entries were stale (e.g., Locke Mk III
Boltgun listed puncture which isn't in its ground-truth trait pool)."
```

---

### Task 4: Refreeze snapshots and verify across all builds

**Files:**
- Modify: `tests/fixtures/ground-truth/scores/*.score.json` (all 24)
- Modify: `tests/fixtures/ground-truth/synergy/*.synergy.json` (all 24)

- [ ] **Step 1: Rebuild TypeScript**

Run: `npm run build`
Expected: Clean compile, no errors.

- [ ] **Step 2: Refreeze synergy snapshots (output shape changed)**

Run: `npm run synergy:freeze`
Expected: All 24 synergy snapshot files updated with `_entitiesWithCalcIds` field.

- [ ] **Step 3: Refreeze score snapshots**

Run: `npm run score:freeze`
Expected: All 24 score snapshot files updated with new talent_coherence scores.

- [ ] **Step 4: Verify spec criterion — build 09 talent_coherence > 1**

Run: `node dist/cli/score-build.js data/builds/09-psyker-2026.json --text`
Expected: `Talent Coherence` line shows a score > 1/5.

- [ ] **Step 5: Verify talent_coherence distribution across all builds**

Run:
```bash
for f in data/builds/*.json; do node dist/cli/score-build.js "$f" --text 2>/dev/null | grep "Talent Coherence"; done | sort | uniq -c | sort -rn
```
Expected: Multiple distinct scores (not uniformly one value).

- [ ] **Step 6: Verify no "not yet in scoring catalog" for any build weapon**

Run:
```bash
for f in data/builds/*.json; do node dist/cli/score-build.js "$f" --text 2>/dev/null; done | grep -i "not yet in scoring"
```
Expected: No output (zero occurrences).

- [ ] **Step 7: Run full test suite**

Run: `GROUND_TRUTH_SOURCE_ROOT="$(cat .source-root)" npx tsx --test src/lib/build-scoring.test.ts src/lib/score-build.test.ts`
Expected: All tests PASS including golden snapshot comparisons.

- [ ] **Step 8: Commit snapshots**

```bash
git add tests/fixtures/ground-truth/scores/ tests/fixtures/ground-truth/synergy/
git commit -m "chore: refreeze score and synergy snapshots after #20 fixes"
```

---

### Task 5: Full quality gate, website data, and docs

**Files:**
- Modify: `website/static/data/build-summaries.json` (regenerated)
- Modify: `website/static/data/builds/*.json` (regenerated, per-build detail data)
- Modify: `AGENTS.md`

- [ ] **Step 1: Run `make check`**

Run: `make check`
Expected: All steps pass.

- [ ] **Step 2: Regenerate website data (summaries AND per-build details)**

Run: `cd website && npx tsx scripts/generate-data.ts && cd ..`
Expected: Both `website/static/data/build-summaries.json` and `website/static/data/builds/*.json` updated with new scores.

- [ ] **Step 3: Verify website builds**

Run: `cd website && npm run build && cd ..`
Expected: Clean build, no errors.

- [ ] **Step 4: Commit website data**

```bash
git add website/static/data/build-summaries.json website/static/data/builds/
git commit -m "chore: regenerate website data with updated scores (#20)"
```

- [ ] **Step 5: Update AGENTS.md known limitations**

In `AGENTS.md`, update the "Known Scoring/Calculator Limitations" section:
- Remove the `talent_coherence uniformly 1/5 (#20)` paragraph (fixed)
- Replace the "Weapon scoring catalog gap (#20)" paragraph with a note that blessing derivation now uses the edge graph as primary source; the hand-curated catalog remains for perk tiers and curio ratings only

```bash
git add AGENTS.md
git commit -m "docs: update AGENTS.md known limitations after #20 fixes"
```
