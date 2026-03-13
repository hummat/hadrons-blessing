import { BUILD_CLASSIFICATION_REGISTRY, classifySlugRole as defaultClassifySlugRole } from "./build-classification-registry.mjs";

const SLOT_PRIORITY = ["ability", "blitz", "aura", "keystone"];

function fallbackSlotForNode(node, classified) {
  if (node?.tier === "ability") {
    if (classified.ability == null) {
      return "ability";
    }

    if (classified.blitz == null) {
      return "blitz";
    }
  }

  if (node?.tier === "notable" && classified.aura == null) {
    return "aura";
  }

  if (node?.tier === "keystone" && classified.keystone == null) {
    return "keystone";
  }

  return "talents";
}

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
    const slot = role?.slot ?? role?.role ?? fallbackSlotForNode(node, classified);

    if (slot === "talents") {
      classified.talents.push(node);
      continue;
    }

    if (!SLOT_PRIORITY.includes(slot)) {
      classified.talents.push(node);
      continue;
    }

    if (classified[slot] == null) {
      classified[slot] = node;
      continue;
    }

    classified.talents.push(node);
  }

  return classified;
}

export { classifySelectedNodes };
