// scripts/ground-truth/lib/build-recommendations.mjs
// Gap analysis for build recommendations (#10).

import { analyzeBuild } from "./synergy-model.mjs";
import { generateScorecard } from "../../score-build.mjs";

// Map coverage_gap names to descriptive reason strings and suggested families.
const GAP_DESCRIPTORS = {
  survivability: {
    reason: "Build primary identity is melee offense with no toughness or damage reduction investment",
    suggested_families: ["toughness", "damage_reduction"],
  },
  crit_chance_source: {
    reason: "Crit family present but no selection provides a crit chance stat",
    suggested_families: ["crit"],
  },
  warp_charge_producer: {
    reason: "Build consumes warp charges but has no warp charge producer",
    suggested_families: ["warp_resource"],
  },
};

/**
 * Analyze build gaps and return structured recommendation input.
 *
 * @param {object} build - Canonical build JSON
 * @param {{ entities: Map<string, object>, edges: Array<object> }} index - Loaded index
 * @param {{ synergy?: object, scorecard?: object } | null} [precomputed=null] - Precomputed pipeline output
 * @returns {{ gaps: Array<object>, underinvested_families: string[], scorecard: object }}
 */
export function analyzeGaps(build, index, precomputed = null) {
  const synergy = precomputed?.synergy ?? analyzeBuild(build, index);
  const scorecard = precomputed?.scorecard ?? generateScorecard(build, synergy);

  const family_profile = synergy.coverage?.family_profile ?? {};
  const coverage_gaps = synergy.coverage?.coverage_gaps ?? [];
  const slot_balance = synergy.coverage?.slot_balance ?? {};

  // Underinvested families: present in profile but count <= 1
  const underinvested_families = Object.entries(family_profile)
    .filter(([, data]) => data.count <= 1)
    .map(([family]) => family);

  // Structured gap entries from coverage_gaps
  const gaps = coverage_gaps.map((gapName) => {
    const descriptor = GAP_DESCRIPTORS[gapName] ?? {
      reason: gapName,
      suggested_families: [],
    };
    return {
      type: gapName,
      reason: descriptor.reason,
      suggested_families: descriptor.suggested_families,
    };
  });

  // Slot imbalance gap: min/max ratio < 0.3 (both-zero treated as ratio 1.0)
  const melee = slot_balance.melee?.strength ?? 0;
  const ranged = slot_balance.ranged?.strength ?? 0;

  let slot_balance_ratio;
  if (melee === 0 && ranged === 0) {
    slot_balance_ratio = 1.0;
  } else {
    slot_balance_ratio = Math.min(melee, ranged) / Math.max(melee, ranged);
  }

  if (slot_balance_ratio < 0.3) {
    // Weaker slot's families are what should be invested in
    const weakerSlotFamilies =
      melee <= ranged
        ? (slot_balance.melee?.families ?? [])
        : (slot_balance.ranged?.families ?? []);
    gaps.push({
      type: "slot_imbalance",
      reason: `ranged/melee imbalance (mel=${melee}, rng=${ranged})`,
      suggested_families: weakerSlotFamilies,
    });
  }

  return {
    gaps,
    underinvested_families,
    scorecard,
  };
}
