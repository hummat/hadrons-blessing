const BUILD_CLASSIFICATION_REGISTRY = {
  psyker: {
    // Abilities (source type: ability)
    "scriers-gaze": { slot: "ability", kind: "ability" },
    "telekine-shield": { slot: "ability", kind: "ability" },
    "venting-shriek": { slot: "ability", kind: "ability" },
    // Ability modifiers (source type: ability_modifier) -> talents
    "becalming-eruption": { slot: "talents", kind: "talent_modifier" },
    "bolstered-shield": { slot: "talents", kind: "talent_modifier" },
    "creeping-flames": { slot: "talents", kind: "talent_modifier" },
    "enervating-threshold": { slot: "talents", kind: "talent_modifier" },
    "precognition": { slot: "talents", kind: "talent_modifier" },
    "reality-anchor": { slot: "talents", kind: "talent_modifier" },
    "sanctuary": { slot: "talents", kind: "talent_modifier" },
    "telekine-dome": { slot: "talents", kind: "talent_modifier" },
    "warp-rupture-2": { slot: "talents", kind: "talent_modifier" },
    "warp-speed": { slot: "talents", kind: "talent_modifier" },
    "warp-unbound": { slot: "talents", kind: "talent_modifier" },
    // Blitz (source type: tactical)
    "assail": { slot: "blitz", kind: "blitz" },
    "brain-rupture": { slot: "blitz", kind: "blitz" },
    "smite": { slot: "blitz", kind: "blitz" },
    // Auras (source type: aura)
    "kinetic-presence": { slot: "aura", kind: "aura" },
    "prescience": { slot: "aura", kind: "aura" },
    "seers-presence": { slot: "aura", kind: "aura" },
    // Keystones (source type: keystone)
    "disrupt-destiny": { slot: "keystone", kind: "keystone" },
    "empowered-psionics": { slot: "keystone", kind: "keystone" },
    "warp-siphon": { slot: "keystone", kind: "keystone" },
    // Keystone modifiers (source type: keystone_modifier) -> talents
    "bio-lodestone": { slot: "talents", kind: "talent_modifier" },
    "charged-up": { slot: "talents", kind: "talent_modifier" },
    "cruel-fortune": { slot: "talents", kind: "talent_modifier" },
    "essence-harvest": { slot: "talents", kind: "talent_modifier" },
    "in-fire-reborn": { slot: "talents", kind: "talent_modifier" },
    "inner-tranquility": { slot: "talents", kind: "talent_modifier" },
    "lingering-influence": { slot: "talents", kind: "talent_modifier" },
    "overpowering-souls": { slot: "talents", kind: "talent_modifier" },
    "perfectionism": { slot: "talents", kind: "talent_modifier" },
    "psychic-leeching": { slot: "talents", kind: "talent_modifier" },
    "psychic-vampire": { slot: "talents", kind: "talent_modifier" },
    "purloin-providence": { slot: "talents", kind: "talent_modifier" },
    "warp-battery": { slot: "talents", kind: "talent_modifier" },
    // Tactical modifiers (source type: tactical_modifier) -> talents
    "charged-strike": { slot: "talents", kind: "talent_modifier" },
    "enfeeble": { slot: "talents", kind: "talent_modifier" },
    "ethereal-shards": { slot: "talents", kind: "talent_modifier" },
    "kinetic-flayer": { slot: "talents", kind: "talent_modifier" },
    "kinetic-resonance": { slot: "talents", kind: "talent_modifier" },
    "quick-shards": { slot: "talents", kind: "talent_modifier" },
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
  zealot: {
    // Abilities (source type: ability)
    "chorus-of-spiritual-fortitude": { slot: "ability", kind: "ability" },
    "fury-of-the-faithful": { slot: "ability", kind: "ability" },
    "shroudfield": { slot: "ability", kind: "ability" },
    // Ability modifiers (source type: ability_modifier) -> talents
    "ecclesiarchs-call": { slot: "talents", kind: "talent_modifier" },
    "invigorating-revelation": { slot: "talents", kind: "talent_modifier" },
    "master-crafted-shroudfield": { slot: "talents", kind: "talent_modifier" },
    "redoubled-zeal": { slot: "talents", kind: "talent_modifier" },
    "unrelenting-fury": { slot: "talents", kind: "talent_modifier" },
    // Blitz (source type: tactical)
    "blades-of-faith": { slot: "blitz", kind: "blitz" },
    "immolation-grenade": { slot: "blitz", kind: "blitz" },
    "stunstorm-grenade": { slot: "blitz", kind: "blitz" },
    // Auras (source type: aura)
    "beacon-of-purity": { slot: "aura", kind: "aura" },
    "benediction": { slot: "aura", kind: "aura" },
    // Keystones (source type: keystone)
    "blazing-piety": { slot: "keystone", kind: "keystone" },
    "inexorable-judgement": { slot: "keystone", kind: "keystone" },
    "martyrdom": { slot: "keystone", kind: "keystone" },
    // Keystone modifiers (source type: keystone_modifier) -> talents
    "i-shall-not-fall": { slot: "talents", kind: "talent_modifier" },
    "inebriates-poise": { slot: "talents", kind: "talent_modifier" },
    "infectious-zeal": { slot: "talents", kind: "talent_modifier" },
    "invocation-of-death": { slot: "talents", kind: "talent_modifier" },
    "maniac": { slot: "talents", kind: "talent_modifier" },
    "martyrs-purpose": { slot: "talents", kind: "talent_modifier" },
    "pious-cut-throat": { slot: "talents", kind: "talent_modifier" },
    "restorative-verses": { slot: "talents", kind: "talent_modifier" },
    "righteous-warrior": { slot: "talents", kind: "talent_modifier" },
    "stalwart": { slot: "talents", kind: "talent_modifier" },
  },
  ogryn: {
    // Abilities (source type: ability)
    "indomitable": { slot: "ability", kind: "ability" },
    "loyal-protector": { slot: "ability", kind: "ability" },
    "point-blank-barrage": { slot: "ability", kind: "ability" },
    // Ability modifiers (source type: ability_modifier) -> talents
    "bullet-bravado": { slot: "talents", kind: "talent_modifier" },
    "hail-of-fire": { slot: "talents", kind: "talent_modifier" },
    "just-getting-started": { slot: "talents", kind: "talent_modifier" },
    "light-em-up": { slot: "talents", kind: "talent_modifier" },
    "no-pain-2": { slot: "talents", kind: "talent_modifier" },
    "pulverise": { slot: "talents", kind: "talent_modifier" },
    "stomping-boots": { slot: "talents", kind: "talent_modifier" },
    "trample": { slot: "talents", kind: "talent_modifier" },
    "valuable-distraction": { slot: "talents", kind: "talent_modifier" },
    // Blitz (source type: tactical)
    "bombs-away": { slot: "blitz", kind: "blitz" },
    "frag-bomb": { slot: "blitz", kind: "blitz" },
    "big-friendly-rock": { slot: "blitz", kind: "blitz" },
    // Auras (source type: aura)
    "bonebreakers-aura": { slot: "aura", kind: "aura" },
    "coward-culling": { slot: "aura", kind: "aura" },
    "stay-close": { slot: "aura", kind: "aura" },
    // Keystones (source type: keystone)
    "heavy-hitter": { slot: "keystone", kind: "keystone" },
    "feel-no-pain": { slot: "keystone", kind: "keystone" },
    "burst-limiter-override": { slot: "keystone", kind: "keystone" },
    // Keystone modifiers (source type: keystone_modifier) -> talents
    "back-off-2": { slot: "talents", kind: "talent_modifier" },
    "bulletstorm-2": { slot: "talents", kind: "talent_modifier" },
    "dont-feel-a-thing-2": { slot: "talents", kind: "talent_modifier" },
    "good-shootin": { slot: "talents", kind: "talent_modifier" },
    "great-cleaver-2": { slot: "talents", kind: "talent_modifier" },
    "heat-of-battle-2": { slot: "talents", kind: "talent_modifier" },
    "impactful-2": { slot: "talents", kind: "talent_modifier" },
    "just-getting-started-2": { slot: "talents", kind: "talent_modifier" },
    "maximum-firepower": { slot: "talents", kind: "talent_modifier" },
    "pained-outburst": { slot: "talents", kind: "talent_modifier" },
    "strongest": { slot: "talents", kind: "talent_modifier" },
    "toughest": { slot: "talents", kind: "talent_modifier" },
    "unstoppable": { slot: "talents", kind: "talent_modifier" },
    // Tactical modifiers (source type: tactical_modifier) -> talents
    "bigger-box-of-hurt-2": { slot: "talents", kind: "talent_modifier" },
    "that-one-didnt-count-2": { slot: "talents", kind: "talent_modifier" },
  },
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
