/**
 * GL talent slug to build slot classification.
 *
 * Maps GamesLantern talent slugs to their build slot (ability, blitz, aura,
 * keystone, talents) and entity kind for each class.
 */

export interface SlotClassification {
  slot: "ability" | "blitz" | "aura" | "keystone" | "talents";
  kind: "ability" | "blitz" | "aura" | "keystone" | "talent_modifier";
}

type ClassRegistry = Record<string, SlotClassification>;

const BUILD_CLASSIFICATION_REGISTRY: Record<string, ClassRegistry> = {
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
  arbites: {
    // Abilities (source type: ability)
    "break-the-line": { slot: "ability", kind: "ability" },
    "castigators-stance": { slot: "ability", kind: "ability" },
    "nuncio-aquila": { slot: "ability", kind: "ability" },
    // Ability modifiers (source type: ability_modifier) -> talents
    "blessed-armament": { slot: "talents", kind: "talent_modifier" },
    "bloodlust": { slot: "talents", kind: "talent_modifier" },
    "commendation-from-condemnation": { slot: "talents", kind: "talent_modifier" },
    "engage": { slot: "talents", kind: "talent_modifier" },
    "fear-of-justice": { slot: "talents", kind: "talent_modifier" },
    "inspiring-recitation": { slot: "talents", kind: "talent_modifier" },
    "kill-order": { slot: "talents", kind: "talent_modifier" },
    "targeted-brutality": { slot: "talents", kind: "talent_modifier" },
    "writ-of-execution": { slot: "talents", kind: "talent_modifier" },
    // Blitz (source type: tactical)
    "arbites-grenade": { slot: "blitz", kind: "blitz" },
    "remote-detonation": { slot: "blitz", kind: "blitz" },
    "voltaic-shock-mine": { slot: "blitz", kind: "blitz" },
    // Auras (source type: aura)
    "breaking-dissent": { slot: "aura", kind: "aura" },
    "part-of-the-squad": { slot: "aura", kind: "aura" },
    "ruthless-efficiency": { slot: "aura", kind: "aura" },
    // Keystones (source type: keystone)
    "execution-order": { slot: "keystone", kind: "keystone" },
    "forceful": { slot: "keystone", kind: "keystone" },
    "terminus-warrant": { slot: "keystone", kind: "keystone" },
    // Companion focus keystones (source type: keystone, dog_1/lone_wolf groups)
    // These are a secondary keystone system — route to talents to avoid duplicate slot
    "go-get-em": { slot: "talents", kind: "keystone" },
    "lone-wolf": { slot: "talents", kind: "keystone" },
    "unleashed-brutality": { slot: "talents", kind: "keystone" },
    // Keystone modifiers (source type: keystone_modifier) -> talents
    "adamant-will": { slot: "talents", kind: "talent_modifier" },
    "arbites-vigilant": { slot: "talents", kind: "talent_modifier" },
    "dispense-justice": { slot: "talents", kind: "talent_modifier" },
    "efficient-killer": { slot: "talents", kind: "talent_modifier" },
    "judicial-force": { slot: "talents", kind: "talent_modifier" },
    "keeping-protocol": { slot: "talents", kind: "talent_modifier" },
    "malocator": { slot: "talents", kind: "talent_modifier" },
    "no-lenience": { slot: "talents", kind: "talent_modifier" },
    "not-far-behind": { slot: "talents", kind: "talent_modifier" },
    "obstinate": { slot: "talents", kind: "talent_modifier" },
    "targets-acquired": { slot: "talents", kind: "talent_modifier" },
    "terminal-decree": { slot: "talents", kind: "talent_modifier" },
    "will-of-the-lex": { slot: "talents", kind: "talent_modifier" },
    "writ-of-judgement": { slot: "talents", kind: "talent_modifier" },
  },
  adamant: {},
  broker: {
    // Abilities (source type: ability)
    "enhanced-desperado": { slot: "ability", kind: "ability" },
    "rampage": { slot: "ability", kind: "ability" },
    "stimm-supply": { slot: "ability", kind: "ability" },
    // Ability modifiers (source type: ability_modifier) -> talents
    "boiling-blood": { slot: "talents", kind: "talent_modifier" },
    "booby-trap": { slot: "talents", kind: "talent_modifier" },
    "channelled-aggression": { slot: "talents", kind: "talent_modifier" },
    "fast-acting-stimms": { slot: "talents", kind: "talent_modifier" },
    "focused-resolve": { slot: "talents", kind: "talent_modifier" },
    "forges-bellow": { slot: "talents", kind: "talent_modifier" },
    "pick-your-targets": { slot: "talents", kind: "talent_modifier" },
    "practiced-deployment": { slot: "talents", kind: "talent_modifier" },
    "pulverising-strikes": { slot: "talents", kind: "talent_modifier" },
    // Blitz (source type: tactical)
    "blackout": { slot: "blitz", kind: "blitz" },
    "boom-bringer": { slot: "blitz", kind: "blitz" },
    "chem-grenade": { slot: "blitz", kind: "blitz" },
    // Auras (source type: aura)
    "anarchist": { slot: "aura", kind: "aura" },
    "gunslinger-improved": { slot: "aura", kind: "aura" },
    "ruffian": { slot: "aura", kind: "aura" },
    // Keystones (source type: keystone)
    "adrenaline-frenzy": { slot: "keystone", kind: "keystone" },
    "chemical-dependency": { slot: "keystone", kind: "keystone" },
    "vultures-mark": { slot: "keystone", kind: "keystone" },
    // Keystone modifiers (source type: keystone_modifier) -> talents
    "adrenaline-assassin": { slot: "talents", kind: "talent_modifier" },
    "adrenaline-smiter": { slot: "talents", kind: "talent_modifier" },
    "adrenaline-unbound": { slot: "talents", kind: "talent_modifier" },
    "chem-enhanced": { slot: "talents", kind: "talent_modifier" },
    "chem-fortified": { slot: "talents", kind: "talent_modifier" },
    "maxed-out-chems": { slot: "talents", kind: "talent_modifier" },
    "patient-hunter": { slot: "talents", kind: "talent_modifier" },
    "stoked-rage": { slot: "talents", kind: "talent_modifier" },
    "uncontrolled-aggression": { slot: "talents", kind: "talent_modifier" },
    "vultures-dodge": { slot: "talents", kind: "talent_modifier" },
    "vultures-push": { slot: "talents", kind: "talent_modifier" },
  },
  "hive scum": {},
};

function normalizeClassName(className: string | null | undefined): string {
  return String(className ?? "")
    .trim()
    .toLowerCase();
}

function registryForClass(
  className: string | null | undefined,
  classificationRegistry: Record<string, ClassRegistry> = BUILD_CLASSIFICATION_REGISTRY,
): ClassRegistry {
  const normalized = normalizeClassName(className);

  if (normalized === "adamant") {
    return classificationRegistry.arbites ?? classificationRegistry.adamant ?? {};
  }

  if (normalized === "hive scum" || normalized === "hive") {
    return classificationRegistry.broker ?? classificationRegistry["hive scum"] ?? {};
  }

  return classificationRegistry[normalized] ?? {};
}

function classifySlugRole(
  className: string | null | undefined,
  slug: string,
  classificationRegistry: Record<string, ClassRegistry> = BUILD_CLASSIFICATION_REGISTRY,
): SlotClassification | null {
  const registry = registryForClass(className, classificationRegistry);
  return registry[slug] ?? null;
}

export {
  BUILD_CLASSIFICATION_REGISTRY,
  classifySlugRole,
  normalizeClassName,
  registryForClass,
};
