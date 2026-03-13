import { BUILD_CLASSIFICATION_REGISTRY, classifySlugRole as defaultClassifySlugRole } from "./build-classification-registry.mjs";

const SLOT_PRIORITY = ["ability", "blitz", "aura", "keystone", "talents"];

function classifySelectedNodes(selectedNodes, options = {}) {
  const {
    className = "",
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

  return classified;
}

export { classifySelectedNodes };
