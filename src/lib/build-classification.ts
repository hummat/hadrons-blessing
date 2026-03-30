import { BUILD_CLASSIFICATION_REGISTRY, classifySlugRole as defaultClassifySlugRole } from "./build-classification-registry.js";
import type { SlotClassification } from "./build-classification-registry.js";

import { normalizeText } from "./normalize.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StructuralSlot = "ability" | "blitz" | "aura" | "keystone";
type ClassifiedSlot = StructuralSlot | "talents";

interface TalentNode {
  slug?: string;
  name?: string;
  [key: string]: unknown;
}

interface ClassifiedSelection {
  slug: string | null;
  frame: string | null;
  tier: string;
  name: string;
  source: string;
}

interface ClassifiedResult {
  ability: ClassifiedSelection | TalentNode | null;
  blitz: ClassifiedSelection | TalentNode | null;
  aura: ClassifiedSelection | TalentNode | null;
  keystone: ClassifiedSelection | TalentNode | null;
  talents: TalentNode[];
}

interface DescriptionSelections {
  ability: string | null;
  blitz: string | null;
  aura: string | null;
  keystone: string | null;
}

interface ExplicitSelections {
  ability?: string | null;
  blitz?: string | null;
  aura?: string | null;
  keystone?: string | null;
}

type ClassRegistry = Record<string, SlotClassification>;

interface ClassifyOptions {
  className?: string;
  description?: string;
  explicitSelections?: ExplicitSelections | null;
  preserveUnclassifiedAsTalents?: boolean;
  classificationRegistry?: Record<string, ClassRegistry>;
  classifySlugRole?: (slug: string, node: TalentNode) => SlotClassification | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SLOT_PRIORITY: ClassifiedSlot[] = ["ability", "blitz", "aura", "keystone", "talents"];
const DESCRIPTION_SLOTS: StructuralSlot[] = ["ability", "blitz", "aura", "keystone"];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function normalizeDescriptionText(description: string | null | undefined): string {
  return String(description ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDescriptionLabel(label: string | null | undefined): string {
  return String(label ?? "")
    .split(/\s*->\s*/)[0]
    .replace(/^["'([{]+/, "")
    .replace(/["')}\].,:;]+$/, "")
    .trim();
}

function firstMatch(description: string, regex: RegExp): string | null {
  const match = regex.exec(description);
  return match == null ? null : cleanDescriptionLabel(match[1]);
}

function extractDescriptionSelections(description: string | null | undefined): DescriptionSelections {
  const extracted: DescriptionSelections = {
    ability: null,
    blitz: null,
    aura: null,
    keystone: null,
  };

  const rawText = String(description ?? "");
  const text = normalizeDescriptionText(rawText);

  if (text.length === 0) {
    return extracted;
  }

  const multilinePatterns: Array<{ slot: StructuralSlot; regex: RegExp }> = [
    { slot: "ability", regex: /(?:^|\n)\s*ABILITY\s*[:\-]\s*([^\n]+?)(?:\s*-{2,}\s*)?(?:\n|$)/im },
    { slot: "blitz", regex: /(?:^|\n)\s*BLITZ\s*[:\-]\s*([^\n]+?)(?:\s*-{2,}\s*)?(?:\n|$)/im },
    { slot: "aura", regex: /(?:^|\n)\s*(?:TEAM\s+)?AURA\s*[:\-]\s*([^\n]+?)(?:\s*-{2,}\s*)?(?:\n|$)/im },
    { slot: "keystone", regex: /(?:^|\n)\s*KEYSTONE\s*[:\-]\s*([^\n]+?)(?:\s*-{2,}\s*)?(?:\n|$)/im },
  ];

  if (rawText.includes("\n")) {
    for (const { slot, regex } of multilinePatterns) {
      extracted[slot] = firstMatch(rawText, regex);
    }
  }

  const explicitPatterns: Array<{ slot: StructuralSlot; regex: RegExp }> = [
    {
      slot: "ability",
      regex: /\bABILITY\s*[:\-]\s*(.+?)(?=\s+\b(?:BLITZ|(?:TEAM\s+)?AURA|KEYSTONE)\b|[.;|\n]|$)/i,
    },
    {
      slot: "blitz",
      regex: /\bBLITZ\s*[:\-]\s*(.+?)(?=\s+\b(?:ABILITY|(?:TEAM\s+)?AURA|KEYSTONE)\b|[.;|\n]|$)/i,
    },
    {
      slot: "aura",
      regex: /\b(?:TEAM\s+)?AURA\s*[:\-]\s*(.+?)(?=\s+\b(?:ABILITY|BLITZ|KEYSTONE)\b|[.;|\n]|$)/i,
    },
    {
      slot: "keystone",
      regex: /\bKEYSTONE\s*[:\-]\s*(.+?)(?=\s+\b(?:ABILITY|BLITZ|(?:TEAM\s+)?AURA)\b|[.;|\n]|$)/i,
    },
  ];

  for (const { slot, regex } of explicitPatterns) {
    extracted[slot] ??= firstMatch(text, regex);
  }

  const groupedSummary = text.match(
    /\b([A-Z][A-Za-z' -]+?)\s*\+\s*([A-Z][A-Za-z' -]+?)\s+keystone(?:\s+with\s+([A-Z][A-Za-z' -]+?)\s+aura)?/i,
  );

  if (groupedSummary != null) {
    extracted.ability ??= cleanDescriptionLabel(groupedSummary[1]);
    extracted.keystone ??= cleanDescriptionLabel(groupedSummary[2]);
    extracted.aura ??= cleanDescriptionLabel(groupedSummary[3]);
  }

  const auraSummary = text.match(/\bwith\s+([A-Z][A-Za-z' -]+?)\s+aura\b/i);
  if (auraSummary != null) {
    extracted.aura ??= cleanDescriptionLabel(auraSummary[1]);
  }

  return extracted;
}

function mergeDescriptionSelections(
  classified: ClassifiedResult,
  descriptionSelections: DescriptionSelections,
): ClassifiedResult {
  for (const slot of DESCRIPTION_SLOTS) {
    if (descriptionSelections[slot] == null) {
      continue;
    }

    // Don't override talent-tree-classified slots (they have a slug from registry lookup).
    const current = classified[slot] as ClassifiedSelection | TalentNode | null;
    if (current && "slug" in current && current.slug != null) {
      continue;
    }

    classified[slot] = {
      slug: null,
      frame: null,
      tier: slot,
      name: descriptionSelections[slot]!,
      source: "description",
    };
  }

  return classified;
}

function mergeExplicitSelections(
  classified: ClassifiedResult,
  explicitSelections: ExplicitSelections | null | undefined,
): ClassifiedResult {
  for (const slot of DESCRIPTION_SLOTS) {
    const label = String(explicitSelections?.[slot] ?? "").trim();
    if (label.length === 0) {
      continue;
    }

    classified[slot] = {
      slug: null,
      frame: null,
      tier: slot,
      name: label,
      source: "scrape",
    };
  }

  return classified;
}

function normalizedExplicitSelectionNames(explicitSelections: ExplicitSelections | null | undefined): Set<string> {
  const names = new Set<string>();

  for (const slot of DESCRIPTION_SLOTS) {
    const label = String(explicitSelections?.[slot] ?? "").trim();
    if (label.length === 0) {
      continue;
    }

    names.add(normalizeText(label));
  }

  return names;
}

function classifySelectedNodes(selectedNodes: TalentNode[] | null | undefined, options: ClassifyOptions = {}): ClassifiedResult {
  const {
    className = "",
    description = "",
    explicitSelections = null,
    preserveUnclassifiedAsTalents = false,
    classificationRegistry = BUILD_CLASSIFICATION_REGISTRY,
    classifySlugRole = (slug: string) => defaultClassifySlugRole(className, slug, classificationRegistry),
  } = options;

  const classified: ClassifiedResult = {
    ability: null,
    blitz: null,
    aura: null,
    keystone: null,
    talents: [],
  };
  const explicitSelectionNames = normalizedExplicitSelectionNames(explicitSelections);

  for (const node of selectedNodes ?? []) {
    const role = classifySlugRole(node.slug ?? "", node);
    const rawSlot = role?.slot ?? (role as { role?: string } | null)?.role;
    const slot: ClassifiedSlot | undefined = rawSlot === "talent" ? "talents" : rawSlot as ClassifiedSlot | undefined;

    if (!slot || !SLOT_PRIORITY.includes(slot)) {
      if (preserveUnclassifiedAsTalents) {
        const normalizedName = normalizeText(node?.name ?? "");
        if (explicitSelectionNames.has(normalizedName)) {
          continue;
        }

        classified.talents.push(node);
        continue;
      }

      throw new Error(`Missing class-side classification for ${className || "unknown"} slug ${node?.slug ?? "<missing>"}`);
    }

    if (classified[slot] == null) {
      if (slot === "talents") {
        classified.talents.push(node);
      } else {
        classified[slot] = node;
      }
      continue;
    }

    if (slot === "talents") {
      classified.talents.push(node);
      continue;
    }

    throw new Error(`Duplicate class-side slot ${slot} for class ${className || "unknown"}`);
  }

  mergeDescriptionSelections(classified, extractDescriptionSelections(description));
  return mergeExplicitSelections(classified, explicitSelections);
}

export {
  classifySelectedNodes,
  extractDescriptionSelections,
};
