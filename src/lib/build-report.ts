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
import { loadJsonFile } from "./load.js";
import { auditBuildFile } from "./audit-build-file.js";
import { generateScorecard } from "./score-build.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SlotDescriptor {
  slot: string;
  label: string;
  entity_id: string | null;
  status: string;
}

interface TalentDescriptor {
  label: string;
  entity_id: string | null;
  status: string;
}

interface PerkDescriptor {
  name: string;
  tier: number;
  value: number;
}

interface BlessingDescriptor {
  label: string;
  known: boolean;
}

interface WeaponReport {
  name: string;
  slot: string | null;
  entity_id: string | null;
  perk_score: number | null;
  perks: Array<PerkDescriptor | null>;
  blessings: BlessingDescriptor[];
}

interface CurioPerkDescriptor {
  label: string;
  tier: number;
  rating: string;
}

interface CurioReport {
  name: string;
  perks: CurioPerkDescriptor[];
}

interface Summary {
  total: number;
  resolved: number;
  ambiguous: number;
  unresolved: number;
  non_canonical: number;
  warnings: string[];
}

interface UnresolvedEntry {
  field: string;
  label: string;
  reason: string;
}

interface AmbiguousEntry {
  field: string;
  label: string;
  candidates: unknown[];
}

interface NonCanonicalEntry {
  field: string;
  label: string;
  kind: string | null;
  notes: string | null;
}

interface BuildReport {
  title: string;
  class: string;
  provenance: Record<string, unknown> | null;
  slots: SlotDescriptor[];
  talents: TalentDescriptor[];
  weapons: WeaponReport[];
  curios: CurioReport[];
  perk_optimality: number;
  curio_score: number;
  summary: Summary;
  unresolved: UnresolvedEntry[];
  ambiguous: AmbiguousEntry[];
  non_canonical: NonCanonicalEntry[];
}

interface BatchReport {
  summary: {
    build_count: number;
    total: number;
    resolved: number;
    ambiguous: number;
    unresolved: number;
    non_canonical: number;
  };
  reports: BuildReport[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function selectionLabel(selection: unknown): string {
  if (typeof selection === "string") return selection;
  if (selection != null && typeof selection === "object" && typeof (selection as { raw_label?: unknown }).raw_label === "string") {
    return (selection as { raw_label: string }).raw_label;
  }
  return "(unknown)";
}

function selectionStatus(selection: unknown): string {
  if (typeof selection === "string") return "resolved";
  if (selection != null && typeof selection === "object" && typeof (selection as { resolution_status?: unknown }).resolution_status === "string") {
    return (selection as { resolution_status: string }).resolution_status;
  }
  return "resolved";
}

function selectionEntityId(selection: unknown): string | null {
  if (selection != null && typeof selection === "object" && typeof (selection as { canonical_entity_id?: unknown }).canonical_entity_id === "string") {
    return (selection as { canonical_entity_id: string }).canonical_entity_id;
  }
  return null;
}

function buildSlot(slotName: string, selection: unknown): SlotDescriptor {
  return {
    slot: slotName,
    label: selectionLabel(selection),
    entity_id: selectionEntityId(selection),
    status: selectionStatus(selection),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateReport(buildPath: string): Promise<BuildReport> {
  const build = loadJsonFile(buildPath) as Record<string, unknown>;
  const audit = await auditBuildFile(buildPath);
  const scorecard = generateScorecard(build);

  // --- Header ---
  const className = selectionLabel(build.class);
  const title = build.title as string;
  const provenance = (build.provenance as Record<string, unknown>) ?? null;

  // --- Structural slots ---
  const slots: SlotDescriptor[] = [
    buildSlot("ability", build.ability),
    buildSlot("blitz", build.blitz),
    buildSlot("aura", build.aura),
    buildSlot("keystone", build.keystone),
  ];

  // --- Talents ---
  const talents: TalentDescriptor[] = ((build.talents as unknown[]) ?? []).map((t) => ({
    label: selectionLabel(t),
    entity_id: selectionEntityId(t),
    status: selectionStatus(t),
  }));

  // --- Weapons ---
  const weapons: WeaponReport[] = ((build.weapons as Array<Record<string, unknown>>) ?? []).map((buildWeapon, weaponIndex) => {
    const scorecardWeapon = scorecard.weapons[weaponIndex];

    const perks: Array<PerkDescriptor | null> = ((scorecardWeapon?.perks?.perks ?? []) as Array<{ name: string; tier: number; value: number } | null>).map((p) => {
      if (p == null) return null;
      return { name: p.name, tier: p.tier, value: p.value };
    });

    const blessings: BlessingDescriptor[] = ((scorecardWeapon?.blessings?.blessings ?? []) as Array<{ name: string; known: boolean }>).map((b) => ({
      label: b.name,
      known: b.known,
    }));

    return {
      name: selectionLabel(buildWeapon.name),
      slot: (buildWeapon.slot as string) ?? scorecardWeapon?.slot ?? null,
      entity_id: selectionEntityId(buildWeapon.name),
      perk_score: scorecardWeapon?.perks?.score ?? null,
      perks,
      blessings,
    };
  });

  // --- Curios ---
  const flatCurioPerks = (scorecard.curios?.perks ?? []) as Array<{ name: string; tier: number; rating: string }>;
  let perkOffset = 0;
  const curios: CurioReport[] = ((build.curios as Array<Record<string, unknown>>) ?? []).map((buildCurio) => {
    const perkCount = ((buildCurio.perks as unknown[]) ?? []).length;
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

  const summary: Summary = {
    total,
    resolved: resolvedCount,
    ambiguous: ambiguousCount,
    unresolved: unresolvedCount,
    non_canonical: nonCanonicalCount,
    warnings: audit.warnings ?? [],
  };

  // --- Problem arrays ---
  const unresolved: UnresolvedEntry[] = audit.unresolved.map((entry) => ({
    field: entry.field,
    label: entry.text,
    reason: entry.match_type ?? "none",
  }));
  const ambiguous: AmbiguousEntry[] = audit.ambiguous.map((entry) => ({
    field: entry.field,
    label: entry.text,
    candidates: [],
  }));
  const non_canonical: NonCanonicalEntry[] = audit.non_canonical.map((entry) => ({
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

export async function generateBatchReport(dirPath: string): Promise<BatchReport> {
  const files = readdirSync(dirPath)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const reports: BuildReport[] = [];
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
