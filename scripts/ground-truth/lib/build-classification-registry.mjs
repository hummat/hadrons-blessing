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
  veteran: {
    // Abilities (source type: ability)
    "voice-of-command": { slot: "ability", kind: "ability" },
    "infiltrate": { slot: "ability", kind: "ability" },
    "executioners-stance": { slot: "ability", kind: "ability" },
    // Ability modifiers (source type: ability_modifier) -> talents
    "hunters-resolve": { slot: "talents", kind: "talent_modifier" },
    "marksman": { slot: "talents", kind: "talent_modifier" },
    "the-bigger-they-are": { slot: "talents", kind: "talent_modifier" },
    "duty-and-honour": { slot: "talents", kind: "talent_modifier" },
    // Blitz (source type: tactical)
    "shredder-frag-grenade": { slot: "blitz", kind: "blitz" },
    "krak-grenade": { slot: "blitz", kind: "blitz" },
    "smoke-grenade": { slot: "blitz", kind: "blitz" },
    // Auras (source type: aura)
    "survivalist": { slot: "aura", kind: "aura" },
    "fire-team": { slot: "aura", kind: "aura" },
    "close-quarters": { slot: "aura", kind: "aura" },
    // Keystones (source type: keystone)
    "marksmans-focus": { slot: "keystone", kind: "keystone" },
    "weapons-specialist": { slot: "keystone", kind: "keystone" },
    "focus-target": { slot: "keystone", kind: "keystone" },
    // Keystone modifiers (source type: keystone_modifier) -> talents
    "tunnel-vision": { slot: "talents", kind: "talent_modifier" },
    "long-range-assassin": { slot: "talents", kind: "talent_modifier" },
    "always-prepared": { slot: "talents", kind: "talent_modifier" },
    "redirect-fire": { slot: "talents", kind: "talent_modifier" },
  },
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
