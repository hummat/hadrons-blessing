import { loadJsonFile } from "./load.js";
import { classifyKnownUnresolved as defaultClassifyKnownUnresolved } from "./non-canonical.js";
import { resolveQuery as defaultResolveQuery } from "./resolve.js";
import type { ResolveResult } from "./resolve.js";
import { assertValidCanonicalBuild } from "./build-shape.js";
import { classifySelectedNodes, extractDescriptionSelections } from "./build-classification.js";
import { BUILD_CLASSIFICATION_REGISTRY, registryForClass } from "./build-classification-registry.js";
import type { SlotClassification } from "./build-classification-registry.js";
import { parsePerkString } from "./score-build.js";
import type { KnownUnresolvedSchemaJson } from "../generated/schema-types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Selection {
  raw_label: string;
  canonical_entity_id: string | null;
  resolution_status: string;
  value?: PerkValue | null;
}

interface PerkValue {
  min: number;
  max: number;
  unit: string;
}

interface CanonicalWeapon {
  slot: string;
  name: Selection;
  perks: Selection[];
  blessings: Selection[];
}

interface CanonicalCurio {
  name: Selection;
  perks: Selection[];
}

interface Provenance {
  source_kind: string;
  source_url: string;
  author: string;
  scraped_at: string;
}

export interface CanonicalBuild {
  schema_version: number;
  title: string;
  class: Selection;
  provenance: Provenance;
  ability: Selection;
  blitz: Selection;
  aura: Selection;
  keystone: Selection | null;
  talents: Selection[];
  weapons: CanonicalWeapon[];
  curios: CanonicalCurio[];
}

type ClassRegistry = Record<string, SlotClassification>;

type ResolveQueryFn = (text: string, queryContext: unknown) => Promise<ResolveResult>;
type ClassifyKnownUnresolvedFn = (text: string, queryContext: unknown) => KnownUnresolvedSchemaJson | null;

interface CanonicalizeDeps {
  resolveQuery?: ResolveQueryFn;
  classifyKnownUnresolved?: ClassifyKnownUnresolvedFn;
  value?: PerkValue | null;
  provenance?: Partial<Provenance>;
  scrapedAt?: string;
  classificationRegistry?: Record<string, ClassRegistry>;
  classifySlugRole?: ((slug: string, node: Record<string, unknown>) => SlotClassification | null) | null;
}

interface RawBuild {
  class?: string;
  title?: string;
  url?: string;
  author?: string;
  description?: string;
  source_kind?: string;
  dumped_at?: string;
  class_selections?: Record<string, string | null>;
  talents?: { active?: Array<{ slug?: string; name?: string; [key: string]: unknown }> };
  weapons?: Array<{
    name?: string;
    perks?: string[];
    blessings?: Array<string | { name?: string; description?: string }>;
    [key: string]: unknown;
  }>;
  curios?: Array<{
    name?: string;
    perks?: string[];
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferredWeaponFamily(entityId: string | null | undefined): string | null {
  const internalName = entityId?.split(".").pop() ?? null;
  if (internalName == null) {
    return null;
  }

  return internalName.replace(/_m\d+$/, "");
}

function valueUnitFromRawLabel(rawLabel: string): string {
  return rawLabel.includes("%") ? "percent" : "flat";
}

function placeholderSelection(rawLabel: string): Selection {
  return {
    raw_label: rawLabel,
    canonical_entity_id: null,
    resolution_status: "unresolved",
  };
}

async function toSelection(
  rawLabel: unknown,
  queryContext: Record<string, unknown>,
  deps: CanonicalizeDeps = {},
): Promise<Selection> {
  const text = String(rawLabel ?? "").trim();
  const {
    resolveQuery = defaultResolveQuery,
    classifyKnownUnresolved = defaultClassifyKnownUnresolved,
    value = null,
  } = deps;

  if (text.length === 0) {
    return placeholderSelection("Unknown");
  }

  const result = await resolveQuery(text, queryContext);

  if (result.resolution_state === "resolved" && result.resolved_entity_id) {
    return {
      raw_label: text,
      canonical_entity_id: result.resolved_entity_id,
      resolution_status: "resolved",
      ...(value == null ? {} : { value }),
    };
  }

  const nonCanonicalRecord = classifyKnownUnresolved(text, queryContext);
  if (nonCanonicalRecord) {
    return {
      raw_label: text,
      canonical_entity_id: null,
      resolution_status: "non_canonical",
      ...(value == null ? {} : { value }),
    };
  }

  return {
    raw_label: text,
    canonical_entity_id: null,
    resolution_status: "unresolved",
    ...(value == null ? {} : { value }),
  };
}

async function canonicalizeBlessings(
  rawBlessings: Array<string | { name?: string; [key: string]: unknown }> | undefined,
  queryContext: Record<string, unknown>,
  deps: CanonicalizeDeps = {},
): Promise<Selection[]> {
  const selections: Selection[] = [];

  for (const blessing of rawBlessings ?? []) {
    const label = typeof blessing === "string" ? blessing : (blessing as { name?: string })?.name;
    const selection = await toSelection(label, queryContext, deps);
    if (
      selection.resolution_status === "resolved"
      && !selection.canonical_entity_id!.startsWith("shared.name_family.blessing.")
    ) {
      selection.resolution_status = "unresolved";
      selection.canonical_entity_id = null;
    }
    selections.push(selection);
  }

  return selections;
}

async function canonicalizePerks(
  rawPerks: string[] | undefined,
  queryContext: Record<string, unknown>,
  deps: CanonicalizeDeps = {},
): Promise<Selection[]> {
  const selections: Selection[] = [];

  for (const perk of rawPerks ?? []) {
    const parsed = parsePerkString(perk);
    const value: PerkValue | null = parsed == null
      ? null
      : {
        min: parsed.min,
        max: parsed.max,
        unit: valueUnitFromRawLabel(perk),
      };

    selections.push(await toSelection(perk, queryContext, {
      ...deps,
      value,
    }));
  }

  return selections;
}

async function canonicalizeWeapon(
  rawWeapon: { name?: string; perks?: string[]; blessings?: Array<string | { name?: string; description?: string }> },
  slot: string,
  deps: CanonicalizeDeps = {},
): Promise<CanonicalWeapon> {
  const nameSelection = await toSelection(rawWeapon.name, { kind: "weapon", slot }, deps);
  const weaponFamily = inferredWeaponFamily(nameSelection.canonical_entity_id);

  return {
    slot,
    name: nameSelection,
    perks: await canonicalizePerks(rawWeapon.perks, { kind: "weapon_perk", slot }, deps),
    blessings: await canonicalizeBlessings(rawWeapon.blessings, {
      kind: "weapon_trait",
      slot,
      ...(weaponFamily == null ? {} : { weapon_family: weaponFamily }),
    }, deps),
  };
}

async function canonicalizeCurio(
  rawCurio: { name?: string; perks?: string[] },
  className: string,
  deps: CanonicalizeDeps = {},
): Promise<CanonicalCurio> {
  return {
    name: await toSelection(rawCurio.name, {
      kind: "gadget_item",
      class: className,
      slot: "curio",
    }, deps),
    perks: await canonicalizePerks(rawCurio.perks, {
      kind: "gadget_trait",
      slot: "curio",
    }, deps),
  };
}

function classifyBuildNodes(rawBuild: RawBuild, deps: CanonicalizeDeps = {}): Record<string, unknown> {
  const {
    classificationRegistry = BUILD_CLASSIFICATION_REGISTRY,
    classifySlugRole = null,
  } = deps;
  const classRegistry = registryForClass(rawBuild.class, classificationRegistry as Record<string, Record<string, SlotClassification>>);
  const descriptionSelections = extractDescriptionSelections(rawBuild?.description ?? "");
  const hasDescriptionFallback = Object.values(descriptionSelections).some((value) => value != null);
  const selectedNodes = rawBuild?.talents?.active ?? [];
  const preserveUnclassifiedAsTalents = selectedNodes.length > 0;

  return classifySelectedNodes(selectedNodes, {
    className: rawBuild.class,
    description: rawBuild?.description ?? "",
    explicitSelections: rawBuild?.class_selections ?? null,
    preserveUnclassifiedAsTalents,
    classificationRegistry: classificationRegistry as Record<string, Record<string, SlotClassification>>,
    ...(classifySlugRole == null ? {} : { classifySlugRole }),
  }) as any;
}

async function canonicalizeScrapedBuild(rawBuild: RawBuild, deps: CanonicalizeDeps = {}): Promise<CanonicalBuild> {
  const classified = classifyBuildNodes(rawBuild, deps) as {
    ability: { name: string } | null;
    blitz: { name: string } | null;
    aura: { name: string } | null;
    keystone: { name: string } | null;
    talents: Array<{ name: string }>;
  };
  const className = String(rawBuild.class ?? "").trim().toLowerCase();
  const rawSourceKind = String(rawBuild.source_kind ?? "").trim();
  const rawDumpedAt = String(rawBuild.dumped_at ?? "").trim();
  const sourceKind = deps.provenance?.source_kind ?? (rawSourceKind || "gameslantern");
  const scrapedAt = deps.provenance?.scraped_at ?? (rawDumpedAt || deps.scrapedAt || new Date().toISOString());
  const provenance: Provenance = {
    source_kind: sourceKind,
    source_url: deps.provenance?.source_url ?? String(rawBuild.url ?? "").trim(),
    author: deps.provenance?.author ?? (String(rawBuild.author ?? "").trim() || "unknown"),
    scraped_at: scrapedAt,
  };

  const build: CanonicalBuild = {
    schema_version: 1,
    title: String(rawBuild.title ?? "").trim() || "Untitled Build",
    class: await toSelection(className, { kind: "class", class: className }, deps),
    provenance,
    ability: classified.ability
      ? await toSelection(classified.ability.name, { kind: "ability", class: className }, deps)
      : placeholderSelection("Unknown ability"),
    blitz: classified.blitz
      ? await toSelection(classified.blitz.name, { kind: "blitz", class: className }, deps)
      : placeholderSelection("Unknown blitz"),
    aura: classified.aura
      ? await toSelection(classified.aura.name, { kind: "aura", class: className }, deps)
      : placeholderSelection("Unknown aura"),
    keystone: classified.keystone
      ? await toSelection(classified.keystone.name, { kind: "keystone", class: className }, deps)
      : null,
    talents: [],
    weapons: [],
    curios: [],
  };

  for (const node of classified.talents) {
    build.talents.push(await toSelection(node.name, { kind: "talent", class: className }, deps));
  }

  const rawWeapons = rawBuild.weapons ?? [];
  for (const [index, weapon] of rawWeapons.entries()) {
    build.weapons.push(await canonicalizeWeapon(weapon, index === 0 ? "melee" : "ranged", deps));
  }

  for (const curio of rawBuild.curios ?? []) {
    build.curios.push(await canonicalizeCurio(curio, className, deps));
  }

  assertValidCanonicalBuild(build);
  return build;
}

async function canonicalizeBuildFile(inputPath: string, deps: CanonicalizeDeps = {}): Promise<CanonicalBuild> {
  const rawBuild = loadJsonFile(inputPath) as RawBuild;
  return canonicalizeScrapedBuild(rawBuild, deps);
}

export {
  canonicalizeBlessings,
  canonicalizeBuildFile,
  canonicalizeCurio,
  canonicalizePerks,
  canonicalizeScrapedBuild,
  canonicalizeWeapon,
  classifyBuildNodes,
  toSelection,
};
