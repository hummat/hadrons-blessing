/**
 * Report formatters for BuildReport objects.
 *
 * Exports six formatters: formatText, formatMarkdown, formatJson (single),
 * formatBatchText, formatBatchMarkdown, formatBatchJson (batch).
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitalize(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const DIVIDER = "═".repeat(54);

function ratingIcon(rating) {
  if (rating === "optimal") return "★";
  if (rating === "good") return "✓";
  if (rating === "avoid") return "✗";
  return "·";
}

// ---------------------------------------------------------------------------
// formatText
// ---------------------------------------------------------------------------

export function formatText(report) {
  const lines = [];

  // Header
  lines.push(DIVIDER);
  lines.push(report.title);
  const meta = [capitalize(report.class)];
  if (report.provenance?.author) meta.push(report.provenance.author);
  if (report.provenance?.source_kind) meta.push(report.provenance.source_kind);
  lines.push(meta.join(" · "));
  lines.push(DIVIDER);

  // Summary
  const s = report.summary;
  const parts = [`${s.resolved} resolved`, `${s.unresolved} unresolved`, `${s.non_canonical} non-canonical`];
  if (s.ambiguous > 0) parts.push(`${s.ambiguous} ambiguous`);
  lines.push(parts.join(" · "));
  lines.push("");

  // Structural slots
  lines.push("SLOTS");
  for (const slot of report.slots) {
    const label = capitalize(slot.slot);
    const status = slot.status === "resolved" ? "✓" : "✗";
    lines.push(`  ${label.padEnd(12)} ${slot.label} ${status}`);
  }
  lines.push("");

  // Talents (compact)
  if (report.talents.length > 0) {
    lines.push(`TALENTS (${report.talents.length})`);
    const names = report.talents.map((t) => t.label);
    lines.push(`  ${names.join(", ")}`);
    lines.push("");
  }

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
          lines.push(`      ${p.name} T${p.tier} ✓`);
        }
      }
    }

    if (weapon.blessings.length > 0) {
      lines.push("    Blessings:");
      for (const b of weapon.blessings) {
        const icon = b.known ? "✓" : "(?)";
        lines.push(`      ${b.label} ${icon}`);
      }
    }
  }
  lines.push("");

  // Scores
  lines.push("SCORES");
  lines.push(`  Perk Optimality  ${report.perk_optimality.toFixed(1)}/5`);
  lines.push(`  Curio Efficiency ${report.curio_score.toFixed(1)}/5`);
  lines.push("");

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
      lines.push(`  ${entry.field} "${entry.label}" — ${entry.reason}`);
    }
    for (const entry of report.ambiguous) {
      lines.push(`  ${entry.field} "${entry.label}" — ambiguous`);
    }
    for (const entry of report.non_canonical) {
      lines.push(`  ${entry.field} "${entry.label}" — non-canonical`);
    }
    lines.push("");
  }

  // Warnings (conditional)
  if (report.summary.warnings && report.summary.warnings.length > 0) {
    lines.push(`⚠ Warnings: ${report.summary.warnings.join(", ")}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// formatMarkdown
// ---------------------------------------------------------------------------

export function formatMarkdown(report) {
  const lines = [];

  // Title
  lines.push(`# ${report.title}`);
  const meta = [capitalize(report.class)];
  if (report.provenance?.author) meta.push(report.provenance.author);
  if (report.provenance?.source_kind) meta.push(report.provenance.source_kind);
  lines.push(`*${meta.join(" · ")}*`);
  lines.push("");

  // Summary
  const s = report.summary;
  lines.push(`**${s.resolved}** resolved · **${s.unresolved}** unresolved · **${s.non_canonical}** non-canonical`);
  lines.push("");

  // Slots
  lines.push("## Structural Slots");
  lines.push("| Slot | Label | Status |");
  lines.push("|------|-------|--------|");
  for (const slot of report.slots) {
    const status = slot.status === "resolved" ? "✓" : "✗";
    lines.push(`| ${capitalize(slot.slot)} | ${slot.label} | ${status} |`);
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
          lines.push("| (unscored) | — |");
        } else {
          lines.push(`| ${p.name} | T${p.tier} |`);
        }
      }
    }

    if (weapon.blessings.length > 0) {
      lines.push("| Blessing | Known |");
      lines.push("|----------|-------|");
      for (const b of weapon.blessings) {
        const icon = b.known ? "✓" : "?";
        lines.push(`| ${b.label} | ${icon} |`);
      }
    }
    lines.push("");
  }

  // Scores
  lines.push("## Scores");
  lines.push(`- **Perk Optimality:** ${report.perk_optimality.toFixed(1)}/5`);
  lines.push(`- **Curio Efficiency:** ${report.curio_score.toFixed(1)}/5`);
  lines.push("");

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
      lines.push(`- \`${entry.field}\` "${entry.label}" — ${entry.reason}`);
    }
    for (const entry of report.ambiguous) {
      lines.push(`- \`${entry.field}\` "${entry.label}" — ambiguous`);
    }
    for (const entry of report.non_canonical) {
      lines.push(`- \`${entry.field}\` "${entry.label}" — non-canonical`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// formatJson
// ---------------------------------------------------------------------------

export function formatJson(report) {
  return JSON.stringify(report, null, 2);
}

// ---------------------------------------------------------------------------
// formatBatchText
// ---------------------------------------------------------------------------

export function formatBatchText(batch) {
  const lines = [];

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
  lines.push("─".repeat(nameWidth + 18));
  for (const r of batch.reports) {
    const name = r.title.length > nameWidth ? r.title.slice(0, nameWidth - 1) + "…" : r.title;
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

export function formatBatchMarkdown(batch) {
  const lines = [];
  const s = batch.summary;

  lines.push("# Build Summary");
  lines.push("");
  lines.push(`**${s.build_count}** builds · **${s.resolved}** resolved · **${s.unresolved}** unresolved · **${s.non_canonical}** non-canonical`);
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

export function formatBatchJson(batch) {
  return JSON.stringify(batch, null, 2);
}
