/**
 * Build report data assembly.
 *
 * Joins three data sources into a BuildReport object:
 *   - Build JSON metadata (title, class, provenance)
 *   - Audit results from auditBuildFile() (resolution correctness)
 *   - Scorecard from generateScorecard() (perk/curio ratings)
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { loadJsonFile } from "./load.mjs";
import { auditBuildFile } from "../../audit-build-names.mjs";
import { generateScorecard } from "../../score-build.mjs";

/**
 * Return the display label for a selection (object or plain string).
 */
function selectionLabel(selection) {
  if (typeof selection === "string") return selection;
  if (selection != null && typeof selection === "object" && typeof selection.raw_label === "string") {
    return selection.raw_label;
  }
  return "(unknown)";
}

/**
 * Return the resolution status for a selection.
 */
function selectionStatus(selection) {
  if (typeof selection === "string") return "resolved";
  if (selection != null && typeof selection === "object" && typeof selection.resolution_status === "string") {
    return selection.resolution_status;
  }
  return "resolved";
}

/**
 * Return the canonical entity ID for a selection.
 */
function selectionEntityId(selection) {
  if (selection != null && typeof selection === "object" && typeof selection.canonical_entity_id === "string") {
    return selection.canonical_entity_id;
  }
  return null;
}

/**
 * Build a structural slot descriptor.
 */
function buildSlot(slotName, selection) {
  return {
    slot: slotName,
    label: selectionLabel(selection),
    entity_id: selectionEntityId(selection),
    status: selectionStatus(selection),
  };
}

/**
 * Generate a BuildReport for a canonical build file.
 *
 * @param {string} buildPath - Absolute or relative path to a canonical build JSON file.
 * @returns {Promise<object>} BuildReport object.
 */
export async function generateReport(buildPath) {
  const build = loadJsonFile(buildPath);
  const audit = await auditBuildFile(buildPath);
  const scorecard = generateScorecard(build);

  // --- Header ---
  const className = selectionLabel(build.class);
  const title = build.title;
  const provenance = build.provenance ?? null;

  // --- Structural slots ---
  const slots = [
    buildSlot("ability", build.ability),
    buildSlot("blitz", build.blitz),
    buildSlot("aura", build.aura),
    buildSlot("keystone", build.keystone),
  ];

  // --- Talents ---
  const talents = (build.talents ?? []).map((t) => ({
    label: selectionLabel(t),
    entity_id: selectionEntityId(t),
    status: selectionStatus(t),
  }));

  // --- Weapons ---
  const weapons = (build.weapons ?? []).map((buildWeapon, weaponIndex) => {
    const scorecardWeapon = scorecard.weapons[weaponIndex];

    // Perks: pass through from scorecard (keep .name field as-is)
    const perks = (scorecardWeapon?.perks?.perks ?? []).map((p) => {
      if (p == null) return null;
      return { name: p.name, tier: p.tier, value: p.value };
    });

    // Blessings: normalize from scorecard { name, known, internal } -> { label, known }
    const blessings = (scorecardWeapon?.blessings?.blessings ?? []).map((b) => ({
      label: b.name,
      known: b.known,
    }));

    return {
      name: selectionLabel(buildWeapon.name),
      slot: buildWeapon.slot ?? scorecardWeapon?.slot ?? null,
      entity_id: selectionEntityId(buildWeapon.name),
      perk_score: scorecardWeapon?.perks?.score ?? null,
      perks,
      blessings,
    };
  });

  // --- Curios ---
  // scorecard.curios.perks is FLAT across all curios. Re-group by slicing
  // using build file's per-curio perk count.
  const flatCurioPerks = scorecard.curios?.perks ?? [];
  let perkOffset = 0;
  const curios = (build.curios ?? []).map((buildCurio) => {
    const perkCount = (buildCurio.perks ?? []).length;
    const scoredPerks = flatCurioPerks.slice(perkOffset, perkOffset + perkCount);
    perkOffset += perkCount;

    return {
      name: selectionLabel(buildCurio.name),
      perks: scoredPerks.map((p) => ({
        label: p.name,
        tier: p.tier,
        rating: p.rating,
      })),
    };
  });

  // --- Scoring ---
  const perk_optimality = scorecard.perk_optimality;
  const curio_score = scorecard.curio_efficiency;

  // --- Summary counts from audit buckets ---
  const resolvedCount = audit.resolved.length;
  const ambiguousCount = audit.ambiguous.length;
  const unresolvedCount = audit.unresolved.length;
  const nonCanonicalCount = audit.non_canonical.length;
  const total = resolvedCount + ambiguousCount + unresolvedCount + nonCanonicalCount;

  const summary = {
    total,
    resolved: resolvedCount,
    ambiguous: ambiguousCount,
    unresolved: unresolvedCount,
    non_canonical: nonCanonicalCount,
    warnings: audit.warnings ?? [],
  };

  // --- Problem arrays (top-level) ---
  const unresolved = audit.unresolved.map((entry) => ({
    field: entry.field,
    label: entry.text,
    reason: entry.match_type ?? "none",
  }));
  const ambiguous = audit.ambiguous.map((entry) => ({
    field: entry.field,
    label: entry.text,
    candidates: [],
  }));
  const non_canonical = audit.non_canonical.map((entry) => ({
    field: entry.field,
    label: entry.text,
    kind: entry.non_canonical_kind ?? null,
    notes: entry.notes ?? null,
  }));

  return {
    title,
    class: className,
    provenance,
    slots,
    talents,
    weapons,
    curios,
    perk_optimality,
    curio_score,
    summary,
    unresolved,
    ambiguous,
    non_canonical,
  };
}

/**
 * Generate BuildReports for every JSON file in a directory.
 *
 * @param {string} dirPath - Path to a directory containing canonical build JSON files.
 * @returns {Promise<{summary: object, reports: object[]}>} Batch result with aggregate summary.
 */
export async function generateBatchReport(dirPath) {
  const files = readdirSync(dirPath)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const reports = [];
  for (const file of files) {
    const report = await generateReport(join(dirPath, file));
    reports.push(report);
  }

  const summary = {
    build_count: reports.length,
    total: reports.reduce((s, r) => s + r.summary.total, 0),
    resolved: reports.reduce((s, r) => s + r.summary.resolved, 0),
    ambiguous: reports.reduce((s, r) => s + r.summary.ambiguous, 0),
    unresolved: reports.reduce((s, r) => s + r.summary.unresolved, 0),
    non_canonical: reports.reduce((s, r) => s + r.summary.non_canonical, 0),
  };

  return { summary, reports };
}
