/**
 * Text/JSON formatters for recommendation output.
 * Pattern matches report-formatter.mjs.
 */

// ---------------------------------------------------------------------------
// formatGapsText
// ---------------------------------------------------------------------------

/**
 * Format gap analysis result as human-readable text.
 *
 * @param {{ gaps: Array<object>, underinvested_families: string[], scorecard: object }} result
 * @returns {string}
 */
export function formatGapsText(result) {
  const lines = [];
  const sc = result.scorecard;

  lines.push(`=== Gap Analysis: ${sc.title ?? "(unknown)"} ===`);
  lines.push("");

  lines.push(`Grade: ${sc.letter_grade} (${sc.composite_score}/35)`);
  lines.push("");

  if (result.gaps.length > 0) {
    lines.push("COVERAGE GAPS:");
    for (const gap of result.gaps) {
      lines.push(`  [${gap.type}] ${gap.reason}`);
      if (gap.suggested_families.length > 0) {
        lines.push(`    → Consider: ${gap.suggested_families.join(", ")}`);
      }
    }
    lines.push("");
  } else {
    lines.push("No coverage gaps detected.");
    lines.push("");
  }

  if (result.underinvested_families.length > 0) {
    lines.push("UNDERINVESTED FAMILIES:");
    for (const fam of result.underinvested_families) {
      lines.push(`  ${fam} (1 selection)`);
    }
    lines.push("");
  }

  // Slot imbalance is reported inline with gaps; add clean confirmation when none
  const hasSlotImbalance = result.gaps.some((g) => g.type === "slot_imbalance");
  if (!hasSlotImbalance) {
    lines.push("No slot imbalance detected.");
  }

  return lines.join("\n");
}

/**
 * Format gap analysis result as JSON.
 *
 * @param {object} result
 * @returns {string}
 */
export function formatGapsJson(result) {
  return JSON.stringify(result, null, 2);
}

// ---------------------------------------------------------------------------
// formatSwapText
// ---------------------------------------------------------------------------

/**
 * Format a swap delta result (talent or weapon) as human-readable text.
 *
 * @param {{ valid: boolean, reason?: string, score_delta?: object, gained_edges?: Array, lost_edges?: Array, resolved_orphans?: Array, new_orphans?: Array, blessing_impact?: object }} result
 * @param {{ from: string, to: string, kind?: "talent"|"weapon" }} [meta] - Swap identifiers for the header
 * @returns {string}
 */
export function formatSwapText(result, meta = {}) {
  const from = meta.from ?? "?";
  const to = meta.to ?? "?";
  const lines = [];

  lines.push(`=== ${meta.kind === "weapon" ? "Weapon" : "Talent"} Swap: ${from} → ${to} ===`);
  lines.push("");

  if (result.valid === false) {
    lines.push(`Invalid swap: ${result.reason ?? "unknown reason"}`);
    return lines.join("\n");
  }

  // Score delta
  const d = result.score_delta ?? {};
  lines.push("Score Delta:");
  lines.push(`  Talent Coherence:  ${formatDelta(d.talent_coherence)}`);
  lines.push(`  Blessing Synergy:  ${formatDelta(d.blessing_synergy)}`);
  lines.push(`  Role Coverage:     ${formatDelta(d.role_coverage)}`);
  lines.push(`  Composite:         ${formatDelta(d.composite)}`);
  lines.push("");

  // Gained edges
  const gained = result.gained_edges ?? [];
  lines.push(`Gained Synergies (${gained.length}):`);
  if (gained.length > 0) {
    for (const edge of gained) {
      lines.push(`  ${edge.type}: ${formatEdgeSelections(edge)} [${edge.families?.join(", ") ?? ""}]`);
    }
  }
  lines.push("");

  // Lost edges
  const lost = result.lost_edges ?? [];
  lines.push(`Lost Synergies (${lost.length}):`);
  if (lost.length > 0) {
    for (const edge of lost) {
      lines.push(`  ${edge.type}: ${formatEdgeSelections(edge)} [${edge.families?.join(", ") ?? ""}]`);
    }
  }
  lines.push("");

  // Orphan diffs (talent swaps only)
  if (result.resolved_orphans !== undefined) {
    const resolved = result.resolved_orphans ?? [];
    const newOrphans = result.new_orphans ?? [];
    lines.push(`Orphans Resolved: ${resolved.length}`);
    lines.push(`New Orphans: ${newOrphans.length}`);
    lines.push("");
  }

  // Blessing impact (weapon swaps only)
  if (result.blessing_impact) {
    const bi = result.blessing_impact;
    lines.push("Blessing Impact:");
    if (bi.retained.length > 0) {
      lines.push(`  Retained: ${bi.retained.join(", ")}`);
    }
    if (bi.removed.length > 0) {
      lines.push(`  Removed: ${bi.removed.join(", ")}`);
    }
    if (bi.available.length > 0) {
      lines.push(`  Available: ${bi.available.join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format swap delta result as JSON.
 *
 * @param {object} result
 * @returns {string}
 */
export function formatSwapJson(result) {
  return JSON.stringify(result, null, 2);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDelta(value) {
  if (value == null) return "  0";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}`;
}

function formatEdgeSelections(edge) {
  const sels = edge.selections ?? [];
  if (sels.length === 2) {
    return `${sels[0]} ↔ ${sels[1]}`;
  }
  return sels.join(", ");
}
