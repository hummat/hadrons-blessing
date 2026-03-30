/**
 * Text/JSON formatters for recommendation output.
 * Pattern matches report-formatter.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GapEntry {
  type: string;
  reason: string;
  suggested_families: string[];
}

export interface Scorecard {
  title?: string;
  letter_grade: string;
  composite_score: number;
}

export interface GapAnalysisResult {
  gaps: GapEntry[];
  underinvested_families: string[];
  scorecard: Scorecard;
}

export interface ScoreDelta {
  talent_coherence?: number | null;
  blessing_synergy?: number | null;
  role_coverage?: number | null;
  composite?: number | null;
}

export interface SynergyEdge {
  type: string;
  selections?: string[];
  families?: string[];
}

export interface BlessingImpact {
  retained: string[];
  removed: string[];
  available: string[];
}

export interface SwapDeltaResult {
  valid: boolean;
  reason?: string;
  score_delta?: ScoreDelta;
  gained_edges?: SynergyEdge[];
  lost_edges?: SynergyEdge[];
  resolved_orphans?: string[];
  new_orphans?: string[];
  blessing_impact?: BlessingImpact;
}

export interface SwapMeta {
  from?: string;
  to?: string;
  kind?: "talent" | "weapon";
}

// ---------------------------------------------------------------------------
// formatGapsText
// ---------------------------------------------------------------------------

/**
 * Format gap analysis result as human-readable text.
 */
export function formatGapsText(result: GapAnalysisResult): string {
  const lines: string[] = [];
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
 */
export function formatGapsJson(result: GapAnalysisResult): string {
  return JSON.stringify(result, null, 2);
}

// ---------------------------------------------------------------------------
// formatSwapText
// ---------------------------------------------------------------------------

/**
 * Format a swap delta result (talent or weapon) as human-readable text.
 */
export function formatSwapText(result: SwapDeltaResult, meta: SwapMeta = {}): string {
  const from = meta.from ?? "?";
  const to = meta.to ?? "?";
  const lines: string[] = [];

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
 */
export function formatSwapJson(result: SwapDeltaResult): string {
  return JSON.stringify(result, null, 2);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDelta(value: number | null | undefined): string {
  if (value == null) return "  0";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}`;
}

function formatEdgeSelections(edge: SynergyEdge): string {
  const sels = edge.selections ?? [];
  if (sels.length === 2) {
    return `${sels[0]} ↔ ${sels[1]}`;
  }
  return sels.join(", ");
}
