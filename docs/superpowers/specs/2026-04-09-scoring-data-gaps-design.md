# Scoring Data Gaps: Blessing Catalog and Talent Coherence (#20)

## Problem

Two scoring dimensions produce uniformly useless results across all 24 builds:

1. **talent_coherence uniformly 1/5.** The isolation penalty (-0.5 per talent with no synergy edges) crushes scores when ~50-60% of talents lack calc data. At 50% coverage (psyker build 09: 26 talents, 15 isolated), the penalty alone (-7.5) overwhelms any base score.

2. **Blessing validation shows "not yet in scoring catalog" for 25/35 weapons.** `build-scoring-data.json` has 23 hand-curated weapons, only 10 with blessing lists. Meanwhile the ground-truth index has 1252 `weapon_has_trait_pool` edges and 606 `instance_of` edges covering all 122 player-facing weapons.

## Scope

- **In scope:** talent_coherence recalibration, blessing catalog derivation from edges, removal of `PROVISIONAL_WEAPON_FAMILY_MATCHES`
- **Out of scope:** blessing_synergy scoring changes (that dimension comes from synergy model output, not the scoring catalog), `build-scoring-data.json` `weapons` section cleanup (role, classes metadata stays)
- **Important:** The blessing fix is diagnostic — it improves validation output and text reports but does not change any 1-5 score dimension. The scoring uplift from this issue is entirely from the talent_coherence fix.

## Design

### Fix 1: Derive blessing pools from ground-truth edges

#### Data flow

The derivation chain is verified complete for all 122 player-facing weapons:

```
weapon entity → (weapon_has_trait_pool) → weapon_trait → (instance_of) → blessing name_family
```

Example: `shared.weapon.forcestaff_p3_m1` → 9 traits → 9 blessing families (warp_flurry, warp_nexus, run_n_gun, etc.).

#### Changes to `score-build.ts`

**Extend `loadWeaponLookup()`** to build two additional maps from edge data:

1. `weaponBlessingPool: Map<weaponEntityId, Map<familyId, traitEntityId>>` — for each weapon, which blessing families are valid and what trait implements them.
2. `blessingFamilyByName: Map<normalizedUiName, familyId>` — from blessing family entities' `ui_name` field, for display-name fallback matching.

Edge data is loaded from `data/ground-truth/edges/*.json`. Only `weapon_has_trait_pool` and `instance_of` edges are needed.

**Preserve `canonical_entity_id` in `normalizedWeaponInput()`** blessing output. Currently `normalizedWeaponInput()` strips blessings down to `{ name, description }`, discarding `canonical_entity_id`. Add it as an optional field:

```ts
interface BlessingInput {
  name: string;
  description: string;
  canonical_entity_id?: string | null;
}
```

**Revise `scoreBlessings()` matching:**

1. Resolve weapon → get `canonical_entity_id` → look up `weaponBlessingPool`
2. For each blessing in the build:
   a. If blessing has `canonical_entity_id` → check if that family ID is in the weapon's pool → `known: true/false`, `internal` from the pool's trait entity ID
   b. Else → normalize `name`, look up in `blessingFamilyByName` to get family ID, check pool → same result
3. Return `BlessingValidation` with `valid` and per-blessing results

This is the **primary** matching path when a weapon resolves through ground-truth. The hand-curated `build-scoring-data.json` blessings become a fallback only for weapons that don't resolve (should be none after this change).

**`internal` field semantics:** The edge-derived `internal` is the full trait entity suffix (e.g., `weapon_trait_bespoke_forcestaff_p3_faster_charge_on_chained_secondary_attacks_parent`). This differs from the hand-curated shortened form (`crit_chance_scaled_on_heat`). The `internal` field is informational — it appears in text/JSON output but doesn't drive scoring logic. Trait entity ID suffix is more precise and traceable.

**Remove `PROVISIONAL_WEAPON_FAMILY_MATCHES`.** All 8 weapons are verified in ground-truth. Some provisional entries are stale (e.g., Locke Mk III Boltgun lists `puncture` which isn't in its ground-truth trait pool).

#### What stays in `build-scoring-data.json`

The `weapons` section retains `role`, `classes`, and `slot` metadata. The `blessings` sub-objects become unused but are not deleted (they serve as historical reference; no code path reads them after this change).

### Fix 2: Talent coherence — only penalize measurable talents

#### Root cause (verified)

`analyzeBuild()` generates synergy edges only from `withEffects` selections (entities with calc data). Talents without calc data are punished twice: once by inflating the `edges_per_talent` denominator, once by being guaranteed isolated (-0.5 each). Both penalties are bogus for non-measurable talents.

#### Changes to `synergy-model.ts`

Add `_entitiesWithCalcIds: string[]` to the output:

```ts
// In analyzeBuild() return, alongside _resolvedIds:
_entitiesWithCalcIds: withEffects.map((s) => s.id),
```

Update `AnalyzeBuildResult` type to include the new field.

The field exposes all entities (not just talents) with calc data. The scorer filters to talent-side. This keeps classification logic in one place (`classifySelection()` in `build-scoring.ts`).

#### Changes to `build-scoring.ts`

Update `SynergyOutput` type:
```ts
interface SynergyOutput {
  // ... existing fields
  _entitiesWithCalcIds?: string[];
}
```

Revise `scoreTalentCoherence()`:

1. **Measurable talent set:** Intersect `talentPopulation` with `_entitiesWithCalcIds` to get `measurableTalents`.
2. **Isolation penalty:** Only count isolation for talents in `measurableTalents`. A talent without calc data cannot generate edges — being isolated is expected.
3. **Base score denominator:** Compute `edges_per_talent` using `measurableTalents.size` as denominator (not full talent count). Edges only connect measurable talents, so the denominator should match.
4. **Graceful degradation:** If `_entitiesWithCalcIds` is absent (backward compat), fall back to current behavior (penalize all).

**No change to penalty weight (-0.5) or threshold bands.** After the fix, typical scores should range 2-4 depending on actual synergy density. If scores are still compressed, recalibrate thresholds on the corpus as a follow-up.

#### Expected numbers (psyker build 09)

Before: 26 talents, 15 isolated → base 3 - 7.5 = clamped to 1.
After: ~10 measurable talents, ~5 edges → edges_per_talent 0.5 → base 3, ~3 measurable isolated → penalty -1.5, raw 1.5 → score 2.
Well-connected builds with good calc coverage: 3-4.

## Testing

### Unit tests (`build-scoring.test.ts`)

- Update `makeSynergyOutput()` helper to include `_entitiesWithCalcIds`
- Update `scoreTalentCoherence` tests:
  - Test that non-measurable talents are not counted as isolated
  - Test that `edges_per_talent` uses measurable count
  - Test backward compat when `_entitiesWithCalcIds` is absent
- Existing blessing_synergy/role_coverage tests unchanged

### Unit tests (`score-build.test.ts`)

- Update `scoreBlessings` tests for edge-derived matching
- Test canonical_entity_id matching path
- Test display-name fallback matching path
- Test weapon with no ground-truth resolution (hand-curated fallback)

### Integration tests

- Golden score snapshots (`tests/fixtures/ground-truth/scores/`) — refreeze all via `npm run score:freeze`
- Golden synergy snapshots — refreeze via `npm run synergy:freeze` (output shape changes)
- Verify: no build scores uniformly 1/5 on talent_coherence
- Verify: 0 weapons show "not yet in scoring catalog" for builds in the library

### Website

No code changes. `BuildSummary` consumes scores from library — data regeneration (`make website-build`) picks up new scores automatically.

## Verification criteria

1. `npm run score -- data/builds/09-psyker-2026.json --text` shows talent_coherence > 1
2. No weapon in any of the 24 builds shows "not yet in scoring catalog" in score output
3. All 24 score snapshots refreeze cleanly with `npm run score:freeze`
4. `make check` passes (full test suite including source-dependent tests)
5. Score distribution across 24 builds shows talent_coherence variance (not uniformly one value)
