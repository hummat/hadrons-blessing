const BUILD_CLASSIFICATION_REGISTRY = {
  psyker: {
    "brain-rupture": { slot: "blitz", kind: "blitz" },
    "empowered-psionics": { slot: "keystone", kind: "keystone" },
    "psykinetics-aura": { slot: "aura", kind: "aura" },
    "scriers-gaze": { slot: "ability", kind: "ability" },
    "venting-shriek": { slot: "ability", kind: "ability" },
    "warp-rider": { slot: "talents", kind: "talent" },
    "warp-siphon": { slot: "keystone", kind: "keystone" },
  },
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
