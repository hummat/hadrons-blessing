# Hover-card content audit — Phase A (scoring cards)

**Issue:** #25
**Date:** 2026-04-19
**Status:** Draft for review — no code touched. Once the copy here is approved, it becomes the source of truth for the Phase A adapters. Phases B–D (scenarios, synergy, perks/blessings/curios) will follow in separate audit docs.

**Audience:** Players fluent in Darktide (enemy names, Toughness/Warp Charges/Auric, perk crafting), not fluent in our internals (no stat families, no "edges", no internal IDs, no code terms).

**Goal:** every label on every card is accurate against the code that produces it AND written so a Havoc-40 player can act on it.

---

## 1. Risk inventory (what the audit must defuse)

One row per dev term that currently leaks or risks leaking into card copy. "Banned" = must not appear in adapter output. "Translate" = appears only as a derived plain-English phrase.

| Dev concept | Source | Player-facing label | Status |
|---|---|---|---|
| `stat_alignment` edge type | `synergy-rules.ts:54` | "stacks the same stat" | translate |
| `trigger_target` edge type | `synergy-rules.ts:156` | "one pick sets up another" | translate |
| `resource_flow` | `synergy-rules.ts:216` | "fuels" (warp charges / grenades / stamina) | translate |
| `stat family` (abstraction) | `synergy-stat-families.ts:6` | "stat category" — one player label per family, see §3 | translate |
| `orphan` / graph-isolated | `build-scoring.ts:142`, `synergy-rules.ts:255` | "standalone pick — doesn't feed others" | translate |
| `anti_synergy` | `synergy-model.ts` | "picks cancel each other out" | translate |
| `concentration` (NHHI) | `synergy-model.ts:266-277` | "focus" — shown only as qualitative descriptor; raw number never shown | translate |
| `coverage_gap` codes (`survivability` / `crit_chance_source` / `warp_charge_producer`) | `synergy-model.ts:213-264` | Plain-English per-code label, see §4 | translate |
| `build_identity` | `synergy-model.ts` | "build profile" | translate |
| `calc_coverage_pct` | `synergy-model.ts:515-529` | "% of non-weapon resolved selections with modeled effects" + note about unmodeled talents/mechanics | translate |
| Perk rating `optimal`/`good`/`neutral`/`avoid` | `score-build.ts:717-730` | "optimal / solid / neutral / avoid" (our rating language) | translate; always qualify "for this class" on curios |
| Perk tier 1..4 | `score-build.ts:315-342` | "T1..T4" (player-visible in crafting) | keep |
| `sustained` / `aimed` / `burst` | `damage-calculator.ts:1090` | Title-cased label + plain-English subtitle | keep, qualify |
| `ranged_close` 12.5m / `ranged_far` 30m / midpoint 21.25m | `damage-calculator.ts:74,366` | "close range" / "medium range (aim distance)" | translate |
| `breed_id` (e.g. `chaos_ogryn_executor`) | `breakpoint-checklist.json` | Game nickname (Crusher) | translate; raw ID never shown |
| Grade cutoffs S≥32 / A≥27 / B≥22 / C≥17 / D<17 | `score-build.ts:857-862` | Show the cutoffs, frame as "our grading" | keep, qualify |
| Composite `/35` | `score-build.ts:855` | "sum of 7 dimensions × 5" | translate |
| Dimension tier names | — | 5 Exemplary · 4 Strong · 3 Solid · 2 Partial · 1 Limited · null Unscorable | committed |

Hard rules: no card contains any raw ID (`foo.talent.bar`, `chaos_ogryn_executor`), no card quotes a raw threshold constant (`0.06`, `1.5 edges/talent`), no card uses the word "family" or "edge" in user-visible text.

---

## 2. Language principles (applied to every Phase A card)

1. Game terms win where they exist (Crusher, Trapper, Toughness, Warp Charge, Auric, Damnation, T1–T4). Dev terms lose.
2. No thresholds in copy. Tier labels (Exemplary / Strong / Solid / Partial / Limited) carry the qualitative meaning; the numeric 1..5 sits next to the label.
3. One sentence per fact value, ~90 char soft cap.
4. Every "what a low score implies" sentence must survive the specialist-build test — it can't mislabel a deliberate one-trick build as bad.
5. Every proxy is named (auric proxies Havoc; damnation proxies the "competent player" floor; 21.25m is a midpoint, not a game-visible range setting).
6. "Our grading", "our checklist", "our ratings" — never "the grade". The product has an opinion; own it.

---

## 3. Stat-family glossary (used by multiple dimension cards)

Families are the abstraction players don't have a word for. These are the one-phrase labels every adapter will use consistently.

| Internal name | Player label | What it actually catches (from `synergy-stat-families.ts`) |
|---|---|---|
| `melee_offense` | Melee damage & attack speed | melee damage, attack speed, cleave, lunge, weakspot melee |
| `ranged_offense` | Ranged damage & handling | ranged damage, reload, hip-fire spread, suppression, ammo |
| `general_offense` | Generic damage & power | damage, power, damage-vs-type (elites/hordes/specials), finesse |
| `crit` | Crit chance & crit damage | crit chance, crit damage, crit rending, weakspot crit |
| `toughness` | Toughness pool & regen | toughness, toughness regen, toughness replenish, toughness damage taken |
| `damage_reduction` | Damage reduction | DR vs archetypes, flat damage reduction |
| `mobility` | Mobility | dodge, sprint, stamina-on-dodge, lunge distance |
| `warp_resource` | Warp Charges | warp charge production, block cost, stack effects (psyker) |
| `grenade` | Grenades | extra grenades, grenade cooldown, grenade damage |
| `stamina` | Stamina | max stamina, stamina regen, block cost |
| `utility` | Utility | revive, ability regen, coherency aura buffs, niche effects |

This table itself becomes a hover card in Phase C; Phase A cards only need to cite these labels, never the internal name.

---

## 4. Coverage-gap glossary

Three gap codes exist (`synergy-model.ts:213-264`). Each gets one plain-English line every adapter reuses.

| Code | Trigger (verbatim from source) | Player label | Why it matters |
|---|---|---|---|
| `survivability` | Build's primary stat category is offensive (melee / ranged / general / crit) AND zero Toughness effects AND zero Damage-Reduction effects | "Offense-first with no toughness or DR support" | This build leans into damage and speed without visible toughness or DR support; if its real survivability comes from avoidance/control, the model won't see that here |
| `crit_chance_source` | Build has crit-family effects but no selection provides crit chance | "Crit buffs with no crit chance source" | Your crit damage / crit rending perks have nothing to roll on — they don't pay out without a chance source (talent, weapon trait, or crit-on-hit effect) |
| `warp_charge_producer` | Build consumes warp charges (`warp_charge_block_cost` present) but nothing produces them (`warp_charge_amount > 0`) | "Warp-charge consumer with no producer" | You spend charges but nothing refills them — the effect stalls after the first use |

---

## 5. Truth sheets — per dimension

Each truth sheet captures: what the code computes, what it inputs, what thresholds it uses, what it honestly implies, what the caveats are.

---

### 5.1 Perk Optimality

- **What it is:** How close your weapon perks are to max rolls, averaged across weapons.
- **Source:** `score-build.ts:315-378` (`scorePerk`, `scoreWeaponPerks`), `:817-820` (`perkOptimality` = round of avg per-weapon scores).
- **Inputs:**
  - Each scraped perk string parsed to `{ name, max_value }`.
  - `name` looked up in `data/build-scoring-data.json` → `{ tiers: [...] }`.
  - `max_value` snapped to the nearest tier → perk tier 1..N (usually 4).
  - Per weapon: avgTier across its perks → mapped to 1..5.
  - Scorecard: avg across weapons, rounded.
- **Per-weapon tier→score map** (`score-build.ts:362-374`):
  - avgTier ≥4 → 5
  - avgTier ≥3 → 4
  - avgTier ≥2 → 3
  - avgTier ≥1 → 2
  - else → 1
- **Implies (honest):** 5/5 ≈ every weapon has T4 or near-T4 perks (max rolls, expected for meta builds). ≤3/5 ≈ some perks are under-rolled or sub-max values; you'd gain breakpoint headroom by re-rolling to tier max.
- **Caveats:**
  - Only scores *value-based* perks against tier tables — it doesn't judge whether the perk *type* is well-chosen (that's Role Coverage / Breakpoint Relevance).
  - If a perk string fails to parse, it's silently skipped — score stays optimistic. The scrape extractor is the authority on what perks exist.
- **Never leak:** raw stat internal names (`armored_damage`), the JSON path.

---

### 5.2 Curio Efficiency

- **What it is:** Whether your curio perks fit your class's usual toolkit.
- **Source:** `score-build.ts:689-763` (`scoreCurios`).
- **Inputs:**
  - Each curio perk rated against:
    - class-specific `optimal` list
    - class-specific `good` list
    - universal `_universal_optimal`, `_universal_good`, `_universal_avoid`
  - Perk tier from the value (same `scorePerk` path as weapons).
- **Rating map (per perk):**
  - in `avoid` set → `"avoid"`
  - in optimal sets → `"optimal"`
  - in good sets → `"good"`
  - else → `"neutral"`
- **Score map (`:740-760`):**
  - Any `avoid` perk present → score = 1 (hard fail)
  - `optimalCount == total` AND avgTier ≥3.5 → 5
  - desirableRatio (`optimal + good` / total) ≥0.8 AND avgTier ≥3 → 4
  - desirableRatio ≥0.5 AND avgTier ≥2.5 → 3
  - else → 2
- **Implies (honest):** 5/5 ≈ every curio perk is class-optimal and near-max. 3/5 ≈ at least half are class-appropriate but some are sub-tier or off-profile. 1/5 ≈ an outright bad pick (universal avoid list).
- **Caveats:**
  - "Fit" is our opinion per class. A Psyker stacking stamina regen may have a reason (DMR kiting) but we'll mark it neutral. The rating is a starting point, not a verdict.
  - `neutral` perks don't hurt the score but don't help either.
- **Never leak:** the internal rating sets, the `_universal_avoid` name.

---

### 5.3 Talent Coherence

- **What it is:** How tightly your talent picks feed each other — do they stack the same stats or set each other up, or do they work in isolation?
- **Source:** `build-scoring.ts:87-204` (`scoreTalentCoherence`).
- **Inputs:**
  - Talent population: all picks classified as talent (includes `.talent.`, `.ability.`, `.talent_modifier.`, `.stat_node.`).
  - Synergy edges between two talents (both of `stat_alignment` or `trigger_target` type count).
  - `edges_per_talent = talent-talent edges / measurable talent count`.
  - `concentration` (0..1 NHHI — how focused on few stat categories).
  - Graph-isolated count = talents that appear in zero synergy edges (excludes talents with no calculable effects, so cosmetic/narrative talents don't falsely penalise).
- **Score map:**
  - Base: `edges_per_talent` ≥1.5→5, ≥1.0→4, ≥0.5→3, ≥0.2→2, else→1.
  - `-0.5` per isolated talent.
  - `+0.5` if `concentration > 0.06` (focused build bonus).
  - Clamp [1,5], round to nearest int.
- **Implies (honest):** 5/5 ≈ nearly every talent either stacks the same category or chains into another pick; the build has a thesis. 2-3/5 ≈ a core works but supporting picks are scattered. 1/5 ≈ mostly independent picks — each one is individually fine but they don't amplify each other.
- **Caveats:**
  - **Only scores the synergies we can simulate.** Teammate-coherency buffs, positional effects, and narrative talents (hard-to-quantify) don't produce edges even when they're genuinely useful. A low score ≠ a bad build — it may be a build whose synergy isn't machine-readable.
  - Concentration is a tiebreaker; no raw number shown.
- **Never leak:** "edges", "stat_alignment", "trigger_target", the 0.06 threshold, `concentration` as a number.

---

### 5.4 Blessing Synergy

- **What it is:** Whether your blessings feed into your talents and each other, or sit alone on their weapons.
- **Source:** `build-scoring.ts:211-324` (`scoreBlessingSynergy`).
- **Inputs:**
  - Blessing population = selections classified as blessing (family-level IDs).
  - `blessing_edges` = edges where at least one participant is a blessing.
  - `blessing_blessing_edges` = edges where every participant is a blessing (cross-weapon blessing synergy).
  - `orphaned_blessings` = blessings in zero synergy edges.
- **Score map:**
  - Base: `edges_per_blessing` ≥3.5→5, ≥2.5→4, ≥1.5→3, ≥0.5→2, else→1.
  - `+0.5` if any blessing-blessing edge exists.
  - `-1` per orphaned blessing.
  - Clamp [1,5].
- **Implies (honest):** 5/5 ≈ every blessing either amplifies a talent you picked or another blessing (e.g. weapon blessings that feed crit → crit-scaled talents). 2-3/5 ≈ blessings are individually strong but picked for the weapon, not woven into the rest of the build. 1/5 ≈ most blessings don't interact with the build — they're just weapon-native picks.
- **Caveats:**
  - A blessing that's perfect for its weapon but has no model-visible synergy with your talents gets no credit. That's a limitation of the simulator, not necessarily a build flaw.
  - Blessings resolve at family level (not per-weapon-trait instance) — two copies of Rampage on both weapons show as one blessing.
- **Never leak:** "edges", the `0.5` / `3.5` thresholds.

---

### 5.5 Role Coverage

- **What it is:** How broad your build is across stat categories, and whether you've got the basics you're obviously missing.
- **Source:** `build-scoring.ts:333-390` (`scoreRoleCoverage`).
- **Inputs:**
  - `active_families` = count of the 11 stat categories that have at least one buff effect (see §3).
  - `coverage_gaps` = list of the three gap checks from §4 (survivability / crit_chance_source / warp_charge_producer) that fire.
  - `slot_balance` = melee-side vs ranged-side coverage strength. Ratio (min/max) below 0.3 = severe imbalance.
- **Score map:**
  - Base: `active_families` ≥9→5, ≥7→4, ≥5→3, ≥3→2, else→1.
  - `-1` per coverage gap.
  - `-1` if slot-balance ratio < 0.3.
  - Clamp [1,5].
- **Implies (honest):** 5/5 ≈ covers most stat categories with no glaring gaps. 2-3/5 ≈ narrow build — fine for a specialist, but check the risk panel for what's missing. 1/5 ≈ extremely one-note AND has a clear gap (no survivability investment, or dead crit perks, or a warp-charge consumer with no producer).
- **Specialist caveat (MUST be in the card):** "Narrow is not the same as bad — a dedicated elite-killer or horde-clear build will score here as low and still be effective at its job. Check what's gapped, not just the number."
- **Never leak:** family internal names, the NHHI formula, the 0.3 ratio threshold.

---

### 5.6 Breakpoint Relevance

- **What it is:** How many of the community-standard Damnation breakpoints your build actually hits, weighted by importance.
- **Source:** `breakpoint-checklist.ts:187-251` (`scoreBreakpointRelevance`), `data/ground-truth/breakpoint-checklist.json`.
- **Inputs:**
  - Damage entries only (not stagger/cleave — those feed their own checks).
  - For each entry: "best HTK across all your weapons" vs the entry's `max_hits` target at the entry's scenario/difficulty/hitzone.
  - Each entry has a weight: high=3, medium=2, low=1.
  - `weightedHits / weightedTotal` → 1..5.
- **Score map:**
  - ratio ≥0.85 → 5
  - ≥0.65 → 4
  - ≥0.45 → 3
  - ≥0.25 → 2
  - else → 1
- **Current checklist entries (10 damage entries, 3 stagger, 2 cleave — breakpoint_relevance uses the 10 damage ones):** one-shot Rager head, two-hit Rager body, two-hit Crusher, one-shot Trapper, one-shot Hound, one-shot Bomber body, horde one-shot body, three-hit Mauler, two-hit Bulwark, one-shot Sniper. High-priority: Ragers + Crushers. All scenarios are Damnation-level; Auric is scored separately by Difficulty Scaling.
- **Implies (honest):** 5/5 ≈ you hit nearly all of a Havoc-meta player's muscle-memory breakpoints. 3/5 ≈ you hit the common ones but miss two or three key ones (often a specific breed your weapon choice doesn't handle). 1/5 ≈ your time-to-kill is consistently over the expected hit budget — horde/elite fights run long.
- **Caveats (MUST be in the card):**
  - **Our checklist, not the game's.** The list is a curated sample, not exhaustive; it's derived from what the community considers decisive. If your build kills a breed we don't test, we can't credit you.
  - **Damnation-level.** Scaled to auric = Difficulty Scaling's job.
  - **Some weapon families aren't fully modelled** (flamers, force staves, projectiles — #22). Their per-weapon breakpoint panels may show **Unsupported**, and the score can under-credit those builds rather than proving they're weak.
- **Never leak:** raw weights, `breed_id`, `max_hits`, `hit_zone`, `weightedHits` / `weightedTotal` numbers (the breakdown can show them as "N/M breakpoints met" — a clean ratio, never the weighted figure).

---

### 5.7 Difficulty Scaling

- **What it is:** Do your key breakpoints still hold at Auric, or do they break down on the harder difficulty?
- **Source:** `breakpoint-checklist.ts:262-335` (`scoreDifficultyScaling`).
- **Inputs:**
  - Only the `weight: "high"` damage entries from the checklist.
  - For each: best HTK across your weapons at Damnation vs at Auric, compared to the entry's `max_hits` target.
  - Ratios: `damnationRatio = damnationMet/total`, `auricRatio = auricMet/total`.
- **Score map:**
  - auricRatio ≥0.8 → 5
  - auricRatio ≥0.5 → 4
  - damnationRatio ≥0.8 → 3
  - damnationRatio ≥0.5 → 2
  - else → 1
- **Implies (honest):** 5/5 ≈ the build's key breakpoints survive Auric scaling — it's stable under the harder HP pools. 3/5 ≈ holds at Damnation but 20-50% of your key breakpoints break at Auric; you'll notice tougher elites. 1/5 ≈ breaks at Damnation already — consistent under-kills.
- **Caveats (MUST be in the card):**
  - **Auric, not Havoc.** Havoc layers additional resistances (havoc modifiers, modifier stacks) that we don't model. Auric is the harder-but-modeled floor. If the build is Havoc-tuned, Auric holding is a good sign but not a guarantee.
  - Only the high-priority entries count — miss a low-priority breakpoint and this score is unaffected.
- **Never leak:** the 0.8 / 0.5 thresholds, `auricRatio` raw number, `high/medium/low` weight vocabulary.

---

### 5.8 Composite & Grade

- **What it is:** The overall score; a single number our grading bands land on.
- **Source:** `score-build.ts:843-862`.
- **Inputs:**
  - Sum of the up-to-7 dimensions.
  - Missing dimensions scaled proportionally: `compositeScore = round(rawSum * 7 / scoredCount)` — equivalent to treating a missing dimension as "the average of the others" rather than 0 or 5.
  - Bounded [7, 35] in practice.
- **Grade cutoffs:**
  - S ≥ 32
  - A ≥ 27
  - B ≥ 22
  - C ≥ 17
  - D < 17
- **Implies (honest):** Grade compresses seven very different axes into one letter. Two builds with the same grade can have very different profiles (e.g. B from high Breakpoint Relevance with low Role Coverage ≠ B from balanced mids). The grade is a starting point; the dimensions are the story.
- **Caveats (MUST be in the card):**
  - **Our grading, not community consensus.** Cutoffs are ours; they're calibrated against the 24 fixture meta builds.
  - **Unscorable dimensions** happen when a weapon family isn't modelled or a calculator isn't populated; the composite is then scaled from the dimensions we *could* score, which can overstate the letter. Low effect-modeled coverage is the signal to distrust the grade.
- **Never leak:** `rawSum * 7 / scoredCount` as an exposed formula — turn it into "scaled if a dimension wasn't scoreable".

---

## 6. Card copy — Phase A, ready to redline

Format per card: exact strings the adapter will produce. `{placeholders}` are live data. Anything in italics is a template selection depending on score tier.

Card metadata shape:
```
{
  title: string,
  subtitle?: string,
  summary: string,       // one sentence, what it measures
  facts: [               // flat key/value rows
    { label, value },
    ...
  ],
  sourceLabel: "scorecard" | "calculator" | "synergy model",
  tone?: "default" | "warn" | "danger",
}
```

Tier labels mapping (used by every dimension card): `5 Exemplary · 4 Strong · 3 Solid · 2 Partial · 1 Limited · null Unscorable`.

---

### 6.1 Perk Optimality

- **Title:** Perk Optimality
- **Subtitle:** `{score}/5 {tierLabel} · scorecard`
- **Summary:** How close your weapon perks are to max rolls, averaged across weapons.
- **Facts:**
  - Score — `{score}/5 — {tierLabel}`
  - Range — `1 (low-tier rolls) to 5 (all T4 or near)`
  - Derivation — Each perk snaps to its nearest tier 1–4, averaged per weapon, averaged across weapons.
  - This build — `{weaponCount} weapons · avg perk tier {avgTier}/4` *(if weaponCount>0)*
  - Implies — *if score ≥4:* Near-max rolls across the board — no breakpoint left on the table from sub-tier perks. *if score 3:* Mostly solid rolls; a re-roll or two would earn small breakpoint headroom. *if score ≤2:* Several perks are under-rolled — re-rolling to tier max is usually a cheaper upgrade than swapping builds.
  - Caveat — Judges roll quality, not perk *choice*. A T4 perk on the wrong stat still scores 5 here; Role Coverage and Breakpoint Relevance catch that.
- **sourceLabel:** `scorecard`

---

### 6.2 Curio Efficiency

- **Title:** Curio Efficiency
- **Subtitle:** `{score}/5 {tierLabel} · scorecard`
- **Summary:** Whether your curio perks fit this class's usual toolkit, and whether they're rolled high.
- **Facts:**
  - Score — `{score}/5 — {tierLabel}`
  - Range — `1 (an 'avoid' perk present) to 5 (all class-optimal, all near-max)`
  - Derivation — Each curio perk gets a class-specific rating (optimal / solid / neutral / avoid) plus a tier 1–4 from its roll value.
  - This build — `{optimalCount} optimal · {goodCount} solid · {neutralCount} neutral · {avoidCount} avoid · avg tier {avgTier}/4`
  - Implies — *if score = 5:* Every perk is class-optimal and near-max. *if 3-4:* Most are class-appropriate; some are sub-tier or off-profile. *if 2:* Several neutral picks — you'd gain survivability or damage by swapping to class-standard perks. *if 1:* An 'avoid' perk is dragging the build down (a universal anti-pattern like Curio Drop Chance on a combat curio).
  - Caveat — Our per-class ratings are a starting point. A Psyker running Stamina Regen for kiting, for example, may have a reason — we'll call it neutral.
- **sourceLabel:** `scorecard`

---

### 6.3 Talent Coherence

- **Title:** Talent Coherence
- **Subtitle:** `{score}/5 {tierLabel} · synergy model`
- **Summary:** How tightly your talents feed each other — do they stack the same stats or chain into each other, or do they work in isolation?
- **Facts:**
  - Score — `{score}/5 — {tierLabel}`
  - Range — `1 (scattered picks) to 5 (tightly amplifying core)`
  - Derivation — Count talent-to-talent synergies (same stat category stacked, or one pick setting up another), divided by talent count. Bonus for a focused build; penalty for talents that don't interact with anything.
  - This build — `{talentCount} talents · {pairCount} synergy pairs · {isolatedCount} standalone picks`
  - Implies — *if score ≥4:* Nearly every talent either stacks the same category or chains into another pick — the build has a clear thesis. *if score 3:* A core works, but a few picks are scattered relative to it. *if score ≤2:* Mostly independent picks — individually fine, but they don't amplify each other.
  - Important caveat — Only scores synergies the simulator can see. Teammate-coherency buffs, positional play, and narrative talents don't produce visible synergy pairs even when they genuinely work. A low score can mean "synergy we can't model," not "bad build."
- **sourceLabel:** `synergy model`

---

### 6.4 Blessing Synergy

- **Title:** Blessing Synergy
- **Subtitle:** `{score}/5 {tierLabel} · synergy model`
- **Summary:** Whether your blessings feed your talents and each other, or sit alone on their weapons.
- **Facts:**
  - Score — `{score}/5 — {tierLabel}`
  - Range — `1 (blessings work in isolation) to 5 (deeply woven in)`
  - Derivation — Count synergies that involve at least one blessing, per blessing. Bonus if two blessings across your weapons cooperate; penalty per blessing that doesn't interact with anything.
  - This build — `{blessingCount} blessings · {synergyCount} synergies · {orphanedCount} with no interaction`
  - Implies — *if score ≥4:* Blessings amplify your talents or each other (e.g. crit-scaling blessings feeding a crit-scaled talent tree). *if score 3:* Blessings are individually strong but picked for the weapon, not the build. *if score ≤2:* Most blessings don't interact with the rest of the build — they're weapon-native picks.
  - Caveat — A blessing that's perfect for its weapon but has no visible synergy with your talents gets no credit here. That's a limitation of what we can model, not necessarily a build flaw.
- **sourceLabel:** `synergy model`

---

### 6.5 Role Coverage

- **Title:** Role Coverage
- **Subtitle:** `{score}/5 {tierLabel} · synergy model`
- **Summary:** How broad your build is across stat categories, and whether it has any obvious gaps.
- **Facts:**
  - Score — `{score}/5 — {tierLabel}`
  - Range — `1 (very narrow plus a clear gap) to 5 (broad coverage, no gaps)`
  - Derivation — Count the active stat categories out of 11 (Melee damage, Ranged damage, Crit, Toughness, DR, Mobility, Warp Charges, Grenades, Stamina, Utility, generic offense). Subtract for any named gap and for severe melee/ranged imbalance.
  - This build — `{activeFamilies}/11 categories active`*[ · gaps: {gap1}, {gap2}]*`[ · melee-heavy | ranged-heavy | balanced]`
  - Implies — *if score 5:* Broad coverage, no flagged gaps. *if score 3-4:* Narrow or slightly off-balance, but nothing obviously missing. *if score ≤2:* Very narrow AND has a named gap (below).
  - Gaps (when present) — *conditional:* Offense-first with no toughness or DR support — the model sees no visible durability layer. *conditional:* Crit buffs with no crit chance source — your crit damage perks have nothing to roll on. *conditional:* Warp-charge consumer with no producer — charges don't refill.
  - Specialist caveat *(show when score ≤3 or any gap is present)* — Narrow is not the same as bad. A dedicated elite-killer or horde-clear build can score low here and still do its job. Read the gaps, not just the number.
- **sourceLabel:** `synergy model`
- **Tone:** `warn` if any gap is present and score ≤ 2, else `default`.

---

### 6.6 Breakpoint Relevance

- **Title:** Breakpoint Relevance
- **Subtitle:** `{score}/5 {tierLabel} · calculator`
- **Summary:** How many of our Damnation breakpoint checklist entries your build hits, weighted by importance.
- **Facts:**
  - Score — `{score}/5 — {tierLabel}`
  - Range — `1 (most checklist breakpoints missed) to 5 (nearly all met)`
  - Derivation — For each entry, we find your best hits-to-kill across all your weapons at the entry's enemy, hit location, and scenario. If it beats the target, you meet the breakpoint.
  - This build — `{metCount}/{totalCount} breakpoints met`*[ · missing high-priority: {missed1}, {missed2}]*
  - Implies — *if score 5:* You hit the muscle-memory breakpoints — one-shot Trapper/Hound head, two-hit Crusher, two-hit Rager body, etc. *if score 3:* Common ones land; a few key breeds take an extra hit. *if score ≤2:* Time-to-kill runs long — horde and elite fights feel slow.
  - Caveat — Our checklist, not the game's. The list is curated — decisive breakpoints only, not exhaustive. If your weapon kills a breed we don't test, we can't credit you.
  - Coverage caveat — If a weapon family isn't fully modelled yet (flamers, force staves, projectiles), the score can under-credit it. The per-weapon breakpoint panels may show Unsupported.
- **sourceLabel:** `calculator`

---

### 6.7 Difficulty Scaling

- **Title:** Difficulty Scaling
- **Subtitle:** `{score}/5 {tierLabel} · calculator`
- **Summary:** Do your key breakpoints still hold at Auric, or do they break down on the harder difficulty?
- **Facts:**
  - Score — `{score}/5 — {tierLabel}`
  - Range — `1 (breaks at Damnation already) to 5 (holds through Auric)`
  - Derivation — Tracks only the high-priority breakpoints (Crushers, Ragers). At Damnation vs Auric, how many still land in the expected hit budget?
  - This build — `High-priority breakpoints met: {damnationMet}/{total} at Damnation · {auricMet}/{total} at Auric`*[ · breaks at Auric: {degraded}]*
  - Implies — *if score 5:* Stable through Auric scaling — Crushers and Ragers die on schedule. *if score 3-4:* Holds at Damnation; 20-50% of key breakpoints break at Auric. *if score ≤2:* Already under-killing at Damnation — you'll feel it on elites.
  - Important caveat — Auric is our proxy for high-intensity play. **Havoc** layers resistance modifiers we don't model — holding at Auric is a good sign but not a guarantee at Havoc 40.
- **sourceLabel:** `calculator`

---

### 6.8 Composite Score & Grade

One card — composite and grade together. The score and the letter are the same judgment seen at two resolutions, and splitting them into separate hover targets adds UI noise without adding real information.

#### 6.8 Composite & Grade

- **Title:** Grade {grade} · {composite}/35
- **Subtitle:** `Our grading · scorecard`
- **Summary:** Overall score from the seven dimensions, plus the letter bucket it lands in.
- **Facts:**
  - Score — `{composite}/35 · Grade {grade}`
  - Dimensions contributing — `{scoredCount}/7`
  - Grading bands — `S ≥32 · A ≥27 · B ≥22 · C ≥17 · D <17`
  - Dimensions — Perk Optimality · Curio Efficiency · Talent Coherence · Blessing Synergy · Role Coverage · Breakpoint Relevance · Difficulty Scaling
  - Scaling rule — If a dimension was unscorable (missing calculator data), the composite is scaled up proportionally so missing dimensions don't punish the score. Check calc coverage if this applies.
  - Implies — Two builds with the same composite can look very different — same sum, different shape. The grade is a starting point; read the dimensions for the story.
  - Caveat — Our grading, not community consensus. The cutoffs are calibrated against the 24 fixture meta builds.
  - Coverage caveat *(show when effect-modeled coverage < 60%)* — Some dimensions were unscorable or lightly modelled, so the letter can overstate the build. Treat it as provisional.
- **sourceLabel:** `scorecard`

---

## 7. Tier label mapping (used by every dimension subtitle)

Centralise this so every adapter uses the same words. This lives in `website/src/lib/hover/tiers.ts` when Phase A ships.

| Score | Label |
|---|---|
| 5 | Exemplary |
| 4 | Strong |
| 3 | Solid |
| 2 | Partial |
| 1 | Limited |
| null | Unscorable |

---

## 8. Things I'm NOT committing to in Phase A (defer to later phases)

- Synergy-edge hover cards. Phase C — their vocabulary is the riskiest and needs a dedicated audit of `stat_alignment` / `trigger_target` / `resource_flow` explanations.
- Scenario cards (Sustained / Aimed / Burst). Phase B — they belong with the enemy cards and breakpoint-matrix cards.
- Anti-synergy / orphan detail cards. Phase C.
- Perk / blessing / curio individual cards. Phase D — once adapters exist, the per-perk hover is mostly a tier + value lookup plus the plain-English perk description.
- calc_coverage hover. Phase C (tied to the synergy meta panel).

---

## 9. Resolved adapter decisions

These decisions are now part of the copy contract for Phase A:

1. **Tier labels** — use `Limited`, not `Bare`. `Bare` reads like a judgment; `Limited` reads like constrained coverage.
2. **Grade framing** — keep `Our grading` and explicitly say the bands are calibrated against the 24 fixture meta builds.
3. **Role Coverage specialist caveat** — show it when `score <= 3` or any named gap is present. Broad, obviously healthy builds do not need the extra warning text.
4. **Implication bands** — keep grouped bands (`≥4`, `3`, `≤2`) instead of inventing unique prose for every integer score.
5. **Caveat surfacing** — keep one short inline caveat on the card for the model-limitation dimensions (Talent Coherence, Breakpoint Relevance, Difficulty Scaling). Do not hide the crucial warning behind an expandable-only affordance.
6. **Composite vs Grade** — one unified card, not two adjacent hover targets.

This doc is now the copy contract for the Phase A adapters, `HoverCard.svelte`, and their snapshot tests.
