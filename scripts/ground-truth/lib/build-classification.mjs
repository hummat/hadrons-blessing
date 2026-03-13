import { BUILD_CLASSIFICATION_REGISTRY, classifySlugRole as defaultClassifySlugRole } from "./build-classification-registry.mjs";

const SLOT_PRIORITY = ["ability", "blitz", "aura", "keystone", "talents"];
const DESCRIPTION_SLOTS = ["ability", "blitz", "aura", "keystone"];

function normalizeDescriptionText(description) {
  return String(description ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDescriptionLabel(label) {
  return String(label ?? "")
    .replace(/^["'([{]+/, "")
    .replace(/["')}\].,:;]+$/, "")
    .trim();
}

function firstMatch(description, regex) {
  const match = regex.exec(description);
  return match == null ? null : cleanDescriptionLabel(match[1]);
}

function extractDescriptionSelections(description) {
  const text = normalizeDescriptionText(description);
  const extracted = {
    ability: null,
    blitz: null,
    aura: null,
    keystone: null,
  };

  if (text.length === 0) {
    return extracted;
  }

  const explicitPatterns = [
    { slot: "ability", regex: /\bABILITY\s*[:\-]\s*([^.;|]+)/i },
    { slot: "blitz", regex: /\bBLITZ\s*[:\-]\s*([^.;|]+)/i },
    { slot: "aura", regex: /\b(?:TEAM\s+)?AURA\s*[:\-]\s*([^.;|]+)/i },
    { slot: "keystone", regex: /\bKEYSTONE\s*[:\-]\s*([^.;|]+)/i },
  ];

  for (const { slot, regex } of explicitPatterns) {
    extracted[slot] = firstMatch(text, regex);
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

function classifySelectedNodes(selectedNodes, options = {}) {
  const {
    className = "",
    description = "",
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

  for (const node of selectedNodes ?? []) {
    const role = classifySlugRole(node.slug, node);
    const rawSlot = role?.slot ?? role?.role;
    const slot = rawSlot === "talent" ? "talents" : rawSlot;

    if (!SLOT_PRIORITY.includes(slot)) {
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

  return mergeDescriptionSelections(classified, extractDescriptionSelections(description));
}

export {
  classifySelectedNodes,
  extractDescriptionSelections,
};
