import { BUILD_CLASSIFICATION_REGISTRY, classifySlugRole as defaultClassifySlugRole } from "./build-classification-registry.mjs";

import { normalizeText } from "./normalize.mjs";

const SLOT_PRIORITY = ["ability", "blitz", "aura", "keystone", "talents"];
const DESCRIPTION_SLOTS = ["ability", "blitz", "aura", "keystone"];

function normalizeDescriptionText(description) {
  return String(description ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDescriptionLabel(label) {
  return String(label ?? "")
    .split(/\s*->\s*/)[0]
    .replace(/^["'([{]+/, "")
    .replace(/["')}\].,:;]+$/, "")
    .trim();
}

function firstMatch(description, regex) {
  const match = regex.exec(description);
  return match == null ? null : cleanDescriptionLabel(match[1]);
}

function extractDescriptionSelections(description) {
  const extracted = {
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

  const multilinePatterns = [
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

  const explicitPatterns = [
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

function mergeDescriptionSelections(classified, descriptionSelections) {
  for (const slot of DESCRIPTION_SLOTS) {
    if (classified[slot] != null || descriptionSelections[slot] == null) {
      continue;
    }

    classified[slot] = {
      slug: null,
      frame: null,
      tier: slot,
      name: descriptionSelections[slot],
      source: "description",
    };
  }

  return classified;
}

function mergeExplicitSelections(classified, explicitSelections) {
  for (const slot of DESCRIPTION_SLOTS) {
    const label = String(explicitSelections?.[slot] ?? "").trim();
    if (classified[slot] != null || label.length === 0) {
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

function normalizedExplicitSelectionNames(explicitSelections) {
  const names = new Set();

  for (const slot of DESCRIPTION_SLOTS) {
    const label = String(explicitSelections?.[slot] ?? "").trim();
    if (label.length === 0) {
      continue;
    }

    names.add(normalizeText(label));
  }

  return names;
}

function classifySelectedNodes(selectedNodes, options = {}) {
  const {
    className = "",
    description = "",
    explicitSelections = null,
    preserveUnclassifiedAsTalents = false,
    classificationRegistry = BUILD_CLASSIFICATION_REGISTRY,
    classifySlugRole = (slug) => defaultClassifySlugRole(className, slug, classificationRegistry),
  } = options;

  const classified = {
    ability: null,
    blitz: null,
    aura: null,
    keystone: null,
    talents: [],
  };
  const explicitSelectionNames = normalizedExplicitSelectionNames(explicitSelections);

  for (const node of selectedNodes ?? []) {
    const role = classifySlugRole(node.slug, node);
    const rawSlot = role?.slot ?? role?.role;
    const slot = rawSlot === "talent" ? "talents" : rawSlot;

    if (!SLOT_PRIORITY.includes(slot)) {
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

  mergeExplicitSelections(classified, explicitSelections);
  return mergeDescriptionSelections(classified, extractDescriptionSelections(description));
}

export {
  classifySelectedNodes,
  extractDescriptionSelections,
};
