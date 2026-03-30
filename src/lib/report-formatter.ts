/**
 * Report formatters for BuildReport objects.
 *
 * Exports six formatters: formatText, formatMarkdown, formatJson (single),
 * formatBatchText, formatBatchMarkdown, formatBatchJson (batch).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReportSlot {
  slot: string;
  label: string | null;
  status: string;
}

export interface ReportPerk {
  name: string;
  tier: number;
}

export interface ReportBlessing {
  label: string;
  known: boolean;
}

export interface ReportWeapon {
  slot: string | null;
  name: string;
  perks: (ReportPerk | null)[];
  blessings: ReportBlessing[];
}

export interface ReportCurioPerk {
  label: string;
  tier: number;
  rating: string;
}

export interface ReportCurio {
  name: string;
  perks: ReportCurioPerk[];
}

export interface ReportProblemEntry {
  field: string;
  label: string;
  reason?: string;
  notes?: string;
  kind?: string;
}

export interface ReportSummary {
  resolved: number;
  unresolved: number;
  non_canonical: number;
  ambiguous: number;
  warnings?: string[];
}

export interface ReportProvenance {
  author?: string;
  source_kind?: string;
}

export interface BuildReport {
  title: string;
  class: string;
  provenance?: ReportProvenance;
  summary: ReportSummary;
  slots: ReportSlot[];
  weapons: ReportWeapon[];
  curios: ReportCurio[];
  perk_optimality?: number | null;
  curio_score?: number | null;
  unresolved: ReportProblemEntry[];
  ambiguous: ReportProblemEntry[];
  non_canonical: ReportProblemEntry[];
}

export interface BatchReport {
  summary: ReportSummary & { build_count: number; total: number };
  reports: BuildReport[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const DIVIDER = "\u2550".repeat(54);

/** Ordered section names — documents render order and serves as extension point. */
export const SECTIONS = ["header", "summary", "slots", "weapons", "scores", "curios", "problems", "warnings"];

function ratingIcon(rating: string): string {
  if (rating === "optimal") return "\u2605";
  if (rating === "good") return "\u2713";
  if (rating === "avoid") return "\u2717";
  return "\u00B7";
}

// ---------------------------------------------------------------------------
// formatText
// ---------------------------------------------------------------------------

export function formatText(report: BuildReport): string {
  const lines: string[] = [];

  // Header
  lines.push(DIVIDER);
  lines.push(report.title);
  const meta = [capitalize(report.class)];
  if (report.provenance?.author) meta.push(report.provenance.author);
  if (report.provenance?.source_kind) meta.push(report.provenance.source_kind);
  lines.push(meta.join(" \u00B7 "));
  lines.push(DIVIDER);

  // Summary
  const s = report.summary;
  const parts = [`${s.resolved} resolved`, `${s.unresolved} unresolved`, `${s.non_canonical} non-canonical`];
  if (s.ambiguous > 0) parts.push(`${s.ambiguous} ambiguous`);
  lines.push(parts.join(" \u00B7 "));
  lines.push("");

  // Structural slots
  lines.push("SLOTS");
  for (const slot of report.slots) {
    const label = capitalize(slot.slot);
    const status = slot.status === "resolved" ? "\u2713" : "\u2717";
    lines.push(`  ${label.padEnd(12)} ${slot.label ?? "(none)"} ${status}`);
  }
  lines.push("");

  // Weapons
  lines.push("WEAPONS");
  for (const weapon of report.weapons) {
    const slotTag = weapon.slot ? `[${weapon.slot}]` : "[?]";
    lines.push(`  ${slotTag} ${weapon.name}`);

    if (weapon.perks.length > 0) {
      lines.push("    Perks:");
      for (const p of weapon.perks) {
        if (p == null) {
          lines.push("      (unscored)");
        } else {
          lines.push(`      ${p.name} T${p.tier} \u2713`);
        }
      }
    }

    if (weapon.blessings.length > 0) {
      lines.push("    Blessings:");
      for (const b of weapon.blessings) {
        const icon = b.known ? "\u2713" : "(?)";
        lines.push(`      ${b.label} ${icon}`);
      }
    }
  }
  lines.push("");

  // Scores
  if (report.perk_optimality != null || report.curio_score != null) {
    lines.push("SCORES");
    if (report.perk_optimality != null) {
      lines.push(`  Perk Optimality  ${report.perk_optimality.toFixed(1)}/5`);
    }
    if (report.curio_score != null) {
      lines.push(`  Curio Efficiency ${report.curio_score.toFixed(1)}/5`);
    }
    lines.push("");
  }

  // Curios
  if (report.curios.length > 0) {
    lines.push("CURIOS");
    for (const curio of report.curios) {
      lines.push(`  ${curio.name}:`);
      for (const p of curio.perks) {
        const icon = ratingIcon(p.rating);
        lines.push(`    +${p.label} T${p.tier} ${icon} ${p.rating}`);
      }
    }
    lines.push("");
  }

  // Problems (conditional)
  const hasProblems = report.unresolved.length > 0 || report.ambiguous.length > 0 || report.non_canonical.length > 0;
  if (hasProblems) {
    lines.push("PROBLEMS");
    for (const entry of report.unresolved) {
      lines.push(`  ${entry.field} "${entry.label}" \u2014 ${entry.reason}`);
    }
    for (const entry of report.ambiguous) {
      lines.push(`  ${entry.field} "${entry.label}" \u2014 ambiguous`);
    }
    for (const entry of report.non_canonical) {
      const notes = entry.notes ? ` (${entry.notes})` : "";
      lines.push(`  ${entry.field} "${entry.label}" \u2014 non-canonical: ${entry.kind}${notes}`);
    }
    lines.push("");
  }

  // Warnings (conditional)
  if (report.summary.warnings && report.summary.warnings.length > 0) {
    lines.push(`\u26A0 Warnings: ${report.summary.warnings.join(", ")}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// formatMarkdown
// ---------------------------------------------------------------------------

export function formatMarkdown(report: BuildReport): string {
  const lines: string[] = [];

  // Title
  lines.push(`# ${report.title}`);
  const meta = [capitalize(report.class)];
  if (report.provenance?.author) meta.push(report.provenance.author);
  if (report.provenance?.source_kind) meta.push(report.provenance.source_kind);
  lines.push(`*${meta.join(" \u00B7 ")}*`);
  lines.push("");

  // Summary
  const s = report.summary;
  lines.push(`**${s.resolved}** resolved \u00B7 **${s.unresolved}** unresolved \u00B7 **${s.non_canonical}** non-canonical`);
  lines.push("");

  // Slots
  lines.push("## Structural Slots");
  lines.push("| Slot | Label | Status |");
  lines.push("|------|-------|--------|");
  for (const slot of report.slots) {
    const status = slot.status === "resolved" ? "\u2713" : "\u2717";
    lines.push(`| ${capitalize(slot.slot)} | ${slot.label ?? "\u2014"} | ${status} |`);
  }
  lines.push("");

  // Weapons
  lines.push("## Weapons");
  for (const weapon of report.weapons) {
    const slotTag = weapon.slot ? `[${weapon.slot}]` : "[?]";
    lines.push(`### ${slotTag} ${weapon.name}`);

    if (weapon.perks.length > 0) {
      lines.push("| Perk | Tier |");
      lines.push("|------|------|");
      for (const p of weapon.perks) {
        if (p == null) {
          lines.push("| (unscored) | \u2014 |");
        } else {
          lines.push(`| ${p.name} | T${p.tier} |`);
        }
      }
    }

    if (weapon.blessings.length > 0) {
      lines.push("| Blessing | Known |");
      lines.push("|----------|-------|");
      for (const b of weapon.blessings) {
        const icon = b.known ? "\u2713" : "?";
        lines.push(`| ${b.label} | ${icon} |`);
      }
    }
    lines.push("");
  }

  // Scores
  if (report.perk_optimality != null || report.curio_score != null) {
    lines.push("## Scores");
    if (report.perk_optimality != null) {
      lines.push(`- **Perk Optimality:** ${report.perk_optimality.toFixed(1)}/5`);
    }
    if (report.curio_score != null) {
      lines.push(`- **Curio Efficiency:** ${report.curio_score.toFixed(1)}/5`);
    }
    lines.push("");
  }

  // Curios
  if (report.curios.length > 0) {
    lines.push("## Curios");
    for (const curio of report.curios) {
      lines.push(`**${curio.name}**`);
      if (curio.perks.length > 0) {
        lines.push("| Perk | Tier | Rating |");
        lines.push("|------|------|--------|");
        for (const p of curio.perks) {
          lines.push(`| ${p.label} | T${p.tier} | ${p.rating} |`);
        }
      }
    }
    lines.push("");
  }

  // Problems
  const hasProblems = report.unresolved.length > 0 || report.ambiguous.length > 0 || report.non_canonical.length > 0;
  if (hasProblems) {
    lines.push("## Problems");
    for (const entry of report.unresolved) {
      lines.push(`- \`${entry.field}\` "${entry.label}" \u2014 ${entry.reason}`);
    }
    for (const entry of report.ambiguous) {
      lines.push(`- \`${entry.field}\` "${entry.label}" \u2014 ambiguous`);
    }
    for (const entry of report.non_canonical) {
      const notes = entry.notes ? ` (${entry.notes})` : "";
      lines.push(`- \`${entry.field}\` "${entry.label}" \u2014 non-canonical: ${entry.kind}${notes}`);
    }
    lines.push("");
  }

  // Warnings (conditional)
  if (report.summary.warnings && report.summary.warnings.length > 0) {
    lines.push(`> **Warnings:** ${report.summary.warnings.join(", ")}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// formatJson
// ---------------------------------------------------------------------------

export function formatJson(report: BuildReport): string {
  return JSON.stringify(report, null, 2);
}

// ---------------------------------------------------------------------------
// formatBatchText
// ---------------------------------------------------------------------------

export function formatBatchText(batch: BatchReport): string {
  const lines: string[] = [];

  lines.push(DIVIDER);
  lines.push("BUILD SUMMARY");
  lines.push(DIVIDER);
  lines.push("");

  // Summary table
  const s = batch.summary;
  lines.push(`Builds: ${s.build_count}`);
  lines.push(`Total entries: ${s.total}`);
  lines.push(`Resolved: ${s.resolved}  Unresolved: ${s.unresolved}  Non-canonical: ${s.non_canonical}`);
  if (s.ambiguous > 0) lines.push(`Ambiguous: ${s.ambiguous}`);
  lines.push("");

  // Per-build table header
  const nameWidth = 50;
  lines.push(`${"Build".padEnd(nameWidth)} Res  Unr  NC`);
  lines.push("\u2500".repeat(nameWidth + 18));
  for (const r of batch.reports) {
    const name = r.title.length > nameWidth ? r.title.slice(0, nameWidth - 1) + "\u2026" : r.title;
    const res = String(r.summary.resolved).padStart(4);
    const unr = String(r.summary.unresolved).padStart(4);
    const nc = String(r.summary.non_canonical).padStart(4);
    lines.push(`${name.padEnd(nameWidth)} ${res} ${unr} ${nc}`);
  }
  lines.push("");

  // Per-build details
  lines.push(DIVIDER);
  lines.push("PER-BUILD DETAILS");
  lines.push(DIVIDER);
  lines.push("");

  for (const r of batch.reports) {
    lines.push(formatText(r));
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// formatBatchMarkdown
// ---------------------------------------------------------------------------

export function formatBatchMarkdown(batch: BatchReport): string {
  const lines: string[] = [];
  const s = batch.summary;

  lines.push("# Build Summary");
  lines.push("");
  lines.push(`**${s.build_count}** builds \u00B7 **${s.resolved}** resolved \u00B7 **${s.unresolved}** unresolved \u00B7 **${s.non_canonical}** non-canonical`);
  lines.push("");

  // Summary table
  lines.push("| Build | Resolved | Unresolved | Non-canonical |");
  lines.push("|-------|----------|------------|---------------|");
  for (const r of batch.reports) {
    lines.push(`| ${r.title} | ${r.summary.resolved} | ${r.summary.unresolved} | ${r.summary.non_canonical} |`);
  }
  lines.push("");

  // Per-build details
  for (const r of batch.reports) {
    lines.push("---");
    lines.push("");
    lines.push(formatMarkdown(r));
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// formatBatchJson
// ---------------------------------------------------------------------------

export function formatBatchJson(batch: BatchReport): string {
  return JSON.stringify(batch, null, 2);
}
