const BUILD_CLASSIFICATION_REGISTRY = {
  psyker: {},
  veteran: {},
  zealot: {},
  ogryn: {},
  arbites: {},
  adamant: {},
  broker: {},
  "hive scum": {},
};

function normalizeClassName(className) {
  return String(className ?? "")
    .trim()
    .toLowerCase();
}

function registryForClass(className, classificationRegistry = BUILD_CLASSIFICATION_REGISTRY) {
  const normalized = normalizeClassName(className);

  if (normalized === "adamant") {
    return classificationRegistry.arbites ?? classificationRegistry.adamant ?? {};
  }

  if (normalized === "hive scum") {
    return classificationRegistry.broker ?? classificationRegistry["hive scum"] ?? {};
  }

  return classificationRegistry[normalized] ?? {};
}

function classifySlugRole(className, slug, classificationRegistry = BUILD_CLASSIFICATION_REGISTRY) {
  const registry = registryForClass(className, classificationRegistry);
  return registry[slug] ?? null;
}

export {
  BUILD_CLASSIFICATION_REGISTRY,
  classifySlugRole,
  normalizeClassName,
  registryForClass,
};
