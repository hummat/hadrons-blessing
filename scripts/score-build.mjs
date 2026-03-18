#!/usr/bin/env node
// Score Darktide build data (output of extract-build.mjs) against build-scoring-data.json.
// Perk parsing/scoring, blessing validation, curio scoring, and CLI scorecard output.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ALIASES_ROOT, ENTITIES_ROOT, listJsonFiles, loadJsonFile } from "./ground-truth/lib/load.mjs";
import { normalizeText } from "./ground-truth/lib/normalize.mjs";
import { scoreFromSynergy, scoreFromCalculator } from "./ground-truth/lib/build-scoring.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "build-scoring-data.json");
const PROVISIONAL_WEAPON_FAMILY_MATCHES = new Map([
  [
    normalizeText("Lucius Mk IV Helbore Lasgun"),
    {
      label: "Lucius Mk IV Helbore Lasgun",
      slot: "ranged",
      weapon_family: "lasgun_p2",
      blessings: {
        "Hot-Shot": { internal: "hot_shot" },
        "Surgical": { internal: "surgical" },
      },
    },
  ],
  [
    normalizeText("Munitorum Mk II Relic Blade"),
    {
      label: "Munitorum Mk II Relic Blade",
      slot: "melee",
      weapon_family: "powersword_2h",
      blessings: {
        Wrath: { internal: "wrath" },
        Overload: { internal: "overload" },
      },
    },
  ],
  [
    normalizeText("Munitorum Mk X Relic Blade"),
    {
      label: "Munitorum Mk X Relic Blade",
      slot: "melee",
      weapon_family: "powersword_2h",
      blessings: {
        "Cranial Grounding": { internal: "cranial_grounding" },
        Heatsink: { internal: "heatsink" },
      },
    },
  ],
  [
    normalizeText("Locke Mk III Spearhead Boltgun"),
    {
      label: "Locke Mk III Spearhead Boltgun",
      slot: "ranged",
      weapon_family: "bolter_p1",
      blessings: {
        "Pinning Fire": { internal: "pinning_fire" },
        Puncture: { internal: "puncture" },
      },
    },
  ],
  [
    normalizeText("Tigrus Mk XV Heavy Eviscerator"),
    {
      label: "Tigrus Mk XV Heavy Eviscerator",
      slot: "melee",
      weapon_family: "chainsword_2h",
      blessings: {
        Wrath: { internal: "wrath" },
        Bloodthirsty: { internal: "bloodthirsty" },
      },
    },
  ],
  [
    normalizeText("Godwyn-Branx Mk IV Bolt Pistol"),
    {
      label: "Godwyn-Branx Mk IV Bolt Pistol",
      slot: "ranged",
      weapon_family: "boltpistol_p1",
      blessings: {
        "Lethal Proximity": { internal: "lethal_proximity" },
        Puncture: { internal: "puncture" },
      },
    },
  ],
  [
    normalizeText("Orox Mk II Battle Maul & Slab Shield"),
    {
      label: "Orox Mk II Battle Maul & Slab Shield",
      slot: "melee",
      weapon_family: "ogryn_powermaul_slabshield",
      blessings: {
        "Brutal Momentum": { internal: "brutal_momentum" },
        Skullcrusher: { internal: "skullcrusher" },
      },
    },
  ],
  [
    normalizeText("Foe-Rend Mk V Ripper Gun"),
    {
      label: "Foe-Rend Mk V Ripper Gun",
      slot: "ranged",
      weapon_family: "ogryn_rippergun",
      blessings: {
        "Inspiring Barrage": { internal: "inspiring_barrage" },
        "Blaze Away": { internal: "blaze_away" },
      },
    },
  ],
]);

let _data = null;
let _weaponLookup = null;

function selectionLabel(value) {
  if (typeof value === "string") {
    return value;
  }

  if (value != null && typeof value === "object" && typeof value.raw_label === "string") {
    return value.raw_label;
  }

  return "";
}

function selectionCanonicalEntityId(value) {
  if (value != null && typeof value === "object" && typeof value.canonical_entity_id === "string") {
    return value.canonical_entity_id;
  }

  return null;
}

function normalizedWeaponInput(weapon) {
  return {
    ...weapon,
    name: selectionLabel(weapon?.name),
    perks: (weapon?.perks ?? []).map((perk) => selectionLabel(perk)),
    blessings: (weapon?.blessings ?? []).map((blessing) => ({
      name: selectionLabel(blessing?.name ?? blessing),
      description: typeof blessing?.description === "string" ? blessing.description : "",
    })),
  };
}

function normalizedCurioInput(curio) {
  return {
    ...curio,
    name: selectionLabel(curio?.name),
    perks: (curio?.perks ?? []).map((perk) => selectionLabel(perk)),
  };
}

function extractTemplateBasename(text) {
  if (typeof text !== "string" || !text.includes("/")) {
    return null;
  }

  const basename = text.split("/").pop()?.trim() ?? "";
  return basename.length > 0 ? basename : null;
}

function loadData() {
  if (!_data) {
    _data = JSON.parse(readFileSync(DATA_PATH, "utf-8"));
  }
  return _data;
}

const SLOT_TO_KEY = {
  melee: "melee_perks",
  ranged: "ranged_perks",
  curio: "curio_perks",
};

/**
 * Parse a perk string from the GL scraper into structured form.
 *
 * Supported formats:
 *   "10-25% Damage (Flak Armoured)"  → { min: 0.10, max: 0.25, name: "Damage (Flak Armoured)" }
 *   "+1-2 Stamina"                   → { min: 1, max: 2, name: "Stamina" }
 *   "+5% Toughness"                  → { min: 0.05, max: 0.05, name: "Toughness" }
 *   "25% Damage (Flak Armoured)"     → { min: 0.25, max: 0.25, name: "Damage (Flak Armoured)" }
 *   "+15-20% DR vs Gunners"          → { min: 0.15, max: 0.20, name: "DR vs Gunners" }
 *
 * Returns null if the string cannot be parsed.
 */
export function parsePerkString(str) {
  // Pattern 1: range with percent — "10-25% Name" or "+10-25% Name"
  let m = str.match(/^\+?(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)%\s+(.+)$/);
  if (m) {
    return {
      min: parseFloat(m[1]) / 100,
      max: parseFloat(m[2]) / 100,
      name: normalizePerkName(m[3]),
    };
  }

  // Pattern 2: single percent — "+5% Name" or "25% Name"
  m = str.match(/^\+?(\d+(?:\.\d+)?)%\s+(.+)$/);
  if (m) {
    const val = parseFloat(m[1]) / 100;
    return { min: val, max: val, name: normalizePerkName(m[2]) };
  }

  // Pattern 3: flat range — "+1-2 Name"
  m = str.match(/^\+(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\s+(.+)$/);
  if (m) {
    return {
      min: parseFloat(m[1]),
      max: parseFloat(m[2]),
      name: normalizePerkName(m[3]),
    };
  }

  // Pattern 4: single flat — "+5 Name"
  m = str.match(/^\+(\d+(?:\.\d+)?)\s+(.+)$/);
  if (m) {
    const val = parseFloat(m[1]);
    return { min: val, max: val, name: normalizePerkName(m[2]) };
  }

  return null;
}

/**
 * Normalize GL perk display names to match scoring data catalog keys.
 *
 * GL scraper produces: "Damage (Flak Armoured Enemies)", "Damage (Carapace Armoured Enemies)"
 * Scoring catalog uses: "Damage (Flak Armoured)", "Damage (Carapace)"
 *
 * Also normalizes: "Melee Damage (Elites)" → "Damage (Elites)"
 */
function normalizePerkName(name) {
  return name
    // Weapon perk normalization
    .replace(/ Enemies\)$/, ")")                     // "Damage (Flak Armoured Enemies)" → "Damage (Flak Armoured)"
    .replace(/\(Carapace Armoured\)/, "(Carapace)")  // "Damage (Carapace Armoured)" → "Damage (Carapace)"
    .replace(/^(?:Melee|Ranged) /, "")               // "Melee Damage (Elites)" → "Damage (Elites)"
    // Curio perk normalization
    .replace(/^Damage Resistance \((.+)\)$/, (_, t) => `DR vs ${t.replace("Tox ", "")}`) // "Damage Resistance (Gunners)" → "DR vs Gunners", "Damage Resistance (Tox Flamers)" → "DR vs Flamers"
    .replace(/^Combat Ability Regeneration$/, "Combat Ability Regen")
    .replace(/^Revive Speed \(Ally\)$/, "Revive Speed")
    .replace(/^Max Health$/, "Health");
}

/**
 * Look up a perk by name and value in the scoring data, determine its tier.
 *
 * @param {string} name   - Perk display name (e.g. "Damage (Flak Armoured)")
 * @param {number} value  - The perk's numeric value (decimal for percentages)
 * @param {string} slot   - "melee", "ranged", or "curio"
 * @returns {{ name: string, tier: number, value: number } | null}
 */
export function scorePerk(name, value, slot) {
  const data = loadData();
  const key = SLOT_TO_KEY[slot];
  if (!key) return null;

  const catalog = data[key];
  if (!catalog) return null;

  const perkDef = catalog[name];
  if (!perkDef) return null;

  const tiers = perkDef.tiers; // [T1, T2, T3, T4]
  let bestTier = 1;
  let bestDist = Math.abs(value - tiers[0]);

  for (let i = 1; i < tiers.length; i++) {
    const dist = Math.abs(value - tiers[i]);
    if (dist < bestDist) {
      bestDist = dist;
      bestTier = i + 1; // 1-indexed
    }
  }

  return { name, tier: bestTier, value };
}

/**
 * Score all perks on a weapon/curio.
 *
 * Uses the MAX value from the perk string range (the T4 end of what the GL
 * scraper reports) to determine the tier for each perk.
 *
 * Scoring (1-5):
 *   5: All perks T4
 *   4: All T3-T4
 *   3: Mix of T2-T4, or average tier ~2.5
 *   2: T1-T2 perks
 *   1: Missing perks, unparseable, or completely unknown
 *
 * @param {{ name: string, perks: string[] }} weapon
 * @param {string} slot - "melee", "ranged", or "curio"
 * @returns {{ score: number, perks: Array<{ name: string, tier: number, value: number } | null> }}
 */
export function scoreWeaponPerks(weapon, slot) {
  if (!weapon.perks || weapon.perks.length === 0) {
    return { score: 1, perks: [] };
  }

  const scored = [];
  for (const perkStr of weapon.perks) {
    const parsed = parsePerkString(perkStr);
    if (!parsed) {
      scored.push(null);
      continue;
    }
    const result = scorePerk(parsed.name, parsed.max, slot);
    scored.push(result);
  }

  const valid = scored.filter((p) => p !== null);
  if (valid.length === 0) {
    return { score: 1, perks: scored };
  }

  const avgTier = valid.reduce((sum, p) => sum + p.tier, 0) / valid.length;

  // Map average tier to 1-5 score
  // T4 avg → 5, T3-T4 avg → 4, T2-T3 avg → 3, T1-T2 avg → 2, below → 1
  let score;
  if (avgTier >= 4) {
    score = 5;
  } else if (avgTier >= 3) {
    score = 4;
  } else if (avgTier >= 2) {
    score = 3;
  } else if (avgTier >= 1) {
    score = 2;
  } else {
    score = 1;
  }

  return { score, perks: scored };
}

function loadWeaponLookup() {
  if (_weaponLookup) {
    return _weaponLookup;
  }

  const data = loadData();
  const scoringWeaponsByInternal = new Map(
    Object.entries(data.weapons || {})
      .filter(([, entry]) => typeof entry.internal === "string" && entry.internal.length > 0)
      .map(([key, entry]) => [entry.internal, { key, entry }]),
  );

  const weaponEntities = listJsonFiles(ENTITIES_ROOT)
    .flatMap((path) => loadJsonFile(path))
    .filter((record) => record.kind === "weapon");
  const weaponEntityIds = new Set(weaponEntities.map((record) => record.id));
  const weaponEntitiesById = new Map(weaponEntities.map((record) => [record.id, record]));

  const aliases = listJsonFiles(ALIASES_ROOT)
    .flatMap((path) => loadJsonFile(path))
    .filter((record) => weaponEntityIds.has(record.candidate_entity_id));

  const aliasesByNormalizedText = new Map();

  function addAlias(normalizedText, candidateEntityId, rankWeight, source) {
    if (!normalizedText) {
      return;
    }

    const bucket = aliasesByNormalizedText.get(normalizedText) ?? [];
    bucket.push({ candidateEntityId, rankWeight, source });
    aliasesByNormalizedText.set(normalizedText, bucket);
  }

  for (const alias of aliases) {
    addAlias(alias.normalized_text, alias.candidate_entity_id, alias.rank_weight ?? 0, "ground_truth_alias");
  }

  for (const entity of weaponEntities) {
    addAlias(normalizeText(entity.id), entity.id, 1000, "canonical_id");

    for (const field of ["internal_name", "loc_key", "ui_name"]) {
      const value = entity[field];
      if (typeof value === "string" && value.length > 0) {
        addAlias(normalizeText(value), entity.id, field === "internal_name" ? 900 : 800, field);
      }
    }
  }

  _weaponLookup = {
    aliasesByNormalizedText,
    scoringWeaponsByInternal,
    weaponEntitiesById,
  };
  return _weaponLookup;
}

function resolveGroundTruthWeapon(weaponName) {
  const { aliasesByNormalizedText, scoringWeaponsByInternal, weaponEntitiesById } = loadWeaponLookup();
  const candidateQueries = [weaponName];
  const templateBasename = extractTemplateBasename(weaponName);

  if (templateBasename != null && templateBasename !== weaponName) {
    candidateQueries.push(templateBasename);
  }

  let candidates = [];
  for (const candidateQuery of candidateQueries) {
    candidates = aliasesByNormalizedText.get(normalizeText(candidateQuery)) ?? [];
    if (candidates.length > 0) {
      break;
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  const best = [...candidates].sort(
    (left, right) =>
      right.rankWeight - left.rankWeight
      || left.candidateEntityId.localeCompare(right.candidateEntityId),
  )[0];
  const entity = weaponEntitiesById.get(best.candidateEntityId);
  if (!entity) {
    return null;
  }

  const scoringRecord = scoringWeaponsByInternal.get(entity.internal_name) ?? null;

  return {
    key: scoringRecord?.key ?? null,
    entry: scoringRecord?.entry ?? null,
    canonical_entity_id: entity.id,
    internal_name: entity.internal_name,
    weapon_family: entity.attributes?.weapon_family ?? null,
    slot: entity.attributes?.slot ?? null,
    resolution_source: "ground_truth",
  };
}

function resolveProvisionalWeaponFamily(weaponName) {
  const match = PROVISIONAL_WEAPON_FAMILY_MATCHES.get(normalizeText(weaponName));
  if (!match) {
    return null;
  }

  return {
    key: match.label,
    entry: {
      internal: match.weapon_family,
      slot: match.slot,
      blessings: match.blessings,
    },
    canonical_entity_id: null,
    internal_name: null,
    weapon_family: match.weapon_family,
    slot: match.slot,
    resolution_source: "provisional_family",
  };
}

/**
 * Normalize a weapon name for fallback fuzzy matching against scoring data:
 * lowercase, collapse whitespace.
 */
function normalizeName(name) {
  return selectionLabel(name).toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Find a weapon in the data by name, using fuzzy matching.
 *
 * Matching strategy (in order):
 *   1. Exact match on key
 *   2. Substring: data key contained in weapon name or vice versa
 *   3. Word containment: all words of the shorter name appear in the longer name
 *
 * @param {string} weaponName
 * @returns {{ key: string, entry: object } | null}
 */
function findWeapon(weaponName) {
  const canonicalEntityId = selectionCanonicalEntityId(weaponName);
  if (canonicalEntityId) {
    const directMatch = resolveGroundTruthWeapon(canonicalEntityId);
    if (directMatch?.entry) {
      return directMatch;
    }
  }

  const normalizedName = selectionLabel(weaponName);
  const groundTruthMatch = resolveGroundTruthWeapon(normalizedName);
  if (groundTruthMatch?.entry) {
    return groundTruthMatch;
  }

  const provisionalFamilyMatch = resolveProvisionalWeaponFamily(normalizedName);
  if (provisionalFamilyMatch) {
    return provisionalFamilyMatch;
  }

  // Ground-truth resolved the entity but had no scoring data —
  // return it so callers get metadata (family, slot) even without scores.
  if (groundTruthMatch) {
    return groundTruthMatch;
  }

  const data = loadData();
  const weapons = data.weapons;
  if (!weapons) return null;

  // Exact match first
  if (weapons[normalizedName]) {
    return {
      key: normalizedName,
      entry: weapons[normalizedName],
      canonical_entity_id: null,
      internal_name: weapons[normalizedName].internal ?? null,
      weapon_family: null,
      slot: weapons[normalizedName].slot ?? null,
      resolution_source: "legacy_scoring",
    };
  }

  const normalized = normalizeName(normalizedName);
  const inputWords = normalized.split(" ");

  for (const [key, entry] of Object.entries(weapons)) {
    const normKey = normalizeName(key);

    // Substring match
    if (normalized.includes(normKey) || normKey.includes(normalized)) {
      return {
        key,
        entry,
        canonical_entity_id: null,
        internal_name: entry.internal ?? null,
        weapon_family: null,
        slot: entry.slot ?? null,
        resolution_source: "legacy_scoring",
      };
    }

    // Word containment: all words of the shorter name appear in the longer,
    // and at least 50% of the longer name's words are matched (prevents false
    // positives on short generic inputs like "Gun" or "Mk II").
    const keyWords = normKey.split(" ");
    const shorter = keyWords.length <= inputWords.length ? keyWords : inputWords;
    const longer = keyWords.length <= inputWords.length ? inputWords : keyWords;
    if (shorter.length >= 2 && shorter.every((w) => longer.includes(w))) {
      const matchRatio = shorter.length / longer.length;
      if (matchRatio >= 0.5) {
        return {
          key,
          entry,
          canonical_entity_id: null,
          internal_name: entry.internal ?? null,
          weapon_family: null,
          slot: entry.slot ?? null,
          resolution_source: "legacy_scoring",
        };
      }
    }
  }

  return null;
}

/**
 * Validate blessings on a weapon against the scoring data.
 *
 * @param {{ name: string, blessings: Array<{ name: string, description: string }> }} weapon
 * @returns {{ valid: boolean|null, blessings: Array<{ name: string, known: boolean, internal: string|null }> }}
 */
export function scoreBlessings(weapon) {
  const normalizedWeapon = normalizedWeaponInput(weapon);
  const found = findWeapon(normalizedWeapon.name);

  // Unknown weapon — can't validate
  if (!found) {
    return { valid: null, blessings: [] };
  }

  if (!found.entry) {
    return { valid: null, blessings: [] };
  }

  const blessingData = found.entry.blessings;

  // Weapon exists but has no blessing data (null)
  if (blessingData === null || blessingData === undefined) {
    return { valid: null, blessings: [] };
  }

  const results = [];
  for (const blessing of normalizedWeapon.blessings) {
    const match = blessingData[blessing.name];
    results.push({
      name: blessing.name,
      known: !!match,
      internal: match ? match.internal : null,
    });
  }

  const allKnown = results.every((b) => b.known);
  return { valid: allKnown, blessings: results };
}

/**
 * Score curio perks against class-specific ratings.
 *
 * Flattens all perks across all curios, parses each, checks against
 * class optimal/good lists and universal avoid list, then scores 1-5.
 *
 * @param {Array<{ name: string, perks: string[] }>} curios
 * @param {string} className - e.g. "veteran", "zealot"
 * @returns {{ score: number, perks: Array<{ name: string, tier: number, rating: string }> }}
 */
export function scoreCurios(curios, className) {
  const data = loadData();
  const ratings = data.curio_ratings;
  if (!ratings) return { score: 1, perks: [] };

  const normalizedClassName = selectionLabel(className);
  const classRatings = ratings[normalizedClassName] || {};
  const universalOptimal = ratings._universal_optimal || [];
  const universalGood = ratings._universal_good || [];
  const universalAvoid = ratings._universal_avoid || [];

  const classOptimal = classRatings.optimal || [];
  const classGood = classRatings.good || [];

  // Combine class + universal lists (class-specific takes priority)
  const optimalSet = new Set([...classOptimal, ...universalOptimal]);
  const goodSet = new Set([...classGood, ...universalGood]);
  const avoidSet = new Set(universalAvoid);

  const perkResults = [];

  for (const curio of curios.map(normalizedCurioInput)) {
    if (!curio.perks) continue;
    for (const perkStr of curio.perks) {
      const parsed = parsePerkString(perkStr);
      if (!parsed) {
        perkResults.push({ name: perkStr, tier: 0, rating: "neutral" });
        continue;
      }

      const scored = scorePerk(parsed.name, parsed.max, "curio");
      const tier = scored ? scored.tier : 0;

      let rating;
      if (avoidSet.has(parsed.name)) {
        rating = "avoid";
      } else if (optimalSet.has(parsed.name)) {
        rating = "optimal";
      } else if (goodSet.has(parsed.name)) {
        rating = "good";
      } else {
        rating = "neutral";
      }

      perkResults.push({ name: parsed.name, tier, rating });
    }
  }

  if (perkResults.length === 0) {
    return { score: 1, perks: [] };
  }

  // Score 1-5 based on rating + tier combination
  const hasAvoid = perkResults.some((p) => p.rating === "avoid");
  if (hasAvoid) {
    return { score: 1, perks: perkResults };
  }

  const optimalCount = perkResults.filter((p) => p.rating === "optimal").length;
  const goodCount = perkResults.filter((p) => p.rating === "good").length;
  const total = perkResults.length;
  const avgTier = perkResults.reduce((sum, p) => sum + p.tier, 0) / total;
  const desirableRatio = (optimalCount + goodCount) / total;

  let score;
  if (optimalCount === total && avgTier >= 3.5) {
    score = 5;
  } else if (desirableRatio >= 0.8 && avgTier >= 3) {
    score = 4;
  } else if (desirableRatio >= 0.5 && avgTier >= 2.5) {
    score = 3;
  } else {
    score = 2;
  }

  return { score, perks: perkResults };
}

/**
 * Generate a full scorecard for a build.
 *
 * Calls scoreWeaponPerks, scoreBlessings, scoreCurios and assembles the result.
 *
 * @param {{ title: string, class: string, weapons: Array, curios: Array, talents: object }} build
 * @param {object|null} [synergyOutput=null] - Output from analyzeBuild() in synergy-model.mjs
 * @param {object|null} [calcOutput=null] - { matrix } from computeBreakpoints()
 * @returns {object} Scorecard object
 */
export function generateScorecard(build, synergyOutput = null, calcOutput = null) {
  const weaponResults = [];
  const perkScores = [];
  const normalizedClassName = selectionLabel(build.class);

  for (const weapon of build.weapons || []) {
    const normalizedWeapon = normalizedWeaponInput(weapon);
    const found = findWeapon(weapon.name);
    const slot = found ? found.slot : null;

    // Score perks — use slot from data, or try both catalogs if unknown
    let perkResult;
    if (slot) {
      perkResult = scoreWeaponPerks(normalizedWeapon, slot);
    } else {
      // Slot unknown — try both catalogs, pick whichever resolves more perks.
      // This can misclassify if a weapon has perks common to both slots.
      // Prefer weapon.slot from build data when available.
      const buildSlot = weapon.slot;
      if (buildSlot === "melee" || buildSlot === "ranged") {
        perkResult = scoreWeaponPerks(normalizedWeapon, buildSlot);
      } else {
        const rangedResult = scoreWeaponPerks(normalizedWeapon, "ranged");
        const meleeResult = scoreWeaponPerks(normalizedWeapon, "melee");
        const rangedResolved = rangedResult.perks.filter((p) => p !== null).length;
        const meleeResolved = meleeResult.perks.filter((p) => p !== null).length;
        perkResult = rangedResolved >= meleeResolved ? rangedResult : meleeResult;
      }
    }

    perkScores.push(perkResult.score);

    const blessingResult = scoreBlessings(normalizedWeapon);

    weaponResults.push({
      name: normalizedWeapon.name,
      slot,
      canonical_entity_id: found?.canonical_entity_id ?? null,
      internal_name: found?.internal_name ?? null,
      weapon_family: found?.weapon_family ?? null,
      resolution_source: found?.resolution_source ?? null,
      perks: perkResult,
      blessings: blessingResult,
    });
  }

  const curioResult = scoreCurios(build.curios || [], normalizedClassName);

  // Average perk scores across weapons, or 1 if none
  const perkOptimality =
    perkScores.length > 0
      ? Math.round(perkScores.reduce((a, b) => a + b, 0) / perkScores.length)
      : 1;

  // Populate qualitative scores from synergy output when available
  const qualitative = {
    blessing_synergy: null,
    talent_coherence: null,
    breakpoint_relevance: null,
    role_coverage: null,
    difficulty_scaling: null,
  };

  if (synergyOutput != null) {
    const scores = scoreFromSynergy(synergyOutput);
    qualitative.talent_coherence = scores.talent_coherence;
    qualitative.blessing_synergy = scores.blessing_synergy;
    qualitative.role_coverage = scores.role_coverage;
  }

  if (calcOutput != null) {
    const calcScores = scoreFromCalculator(calcOutput);
    qualitative.breakpoint_relevance = calcScores.breakpoint_relevance;
    qualitative.difficulty_scaling = calcScores.difficulty_scaling;
  }

  // Composite score: average non-null dimension scores, projected to /35
  const dimensionScores = [
    perkOptimality,
    curioResult.score,
    qualitative.talent_coherence?.score,
    qualitative.blessing_synergy?.score,
    qualitative.role_coverage?.score,
    qualitative.breakpoint_relevance?.score,
    qualitative.difficulty_scaling?.score,
  ].filter((s) => s != null);

  const scoredCount = dimensionScores.length;
  const rawSum = dimensionScores.reduce((a, b) => a + b, 0);
  const compositeScore = Math.round(rawSum * 7 / scoredCount);

  let letterGrade;
  if (compositeScore >= 32) letterGrade = "S";
  else if (compositeScore >= 27) letterGrade = "A";
  else if (compositeScore >= 22) letterGrade = "B";
  else if (compositeScore >= 17) letterGrade = "C";
  else letterGrade = "D";

  return {
    title: build.title,
    class: normalizedClassName,
    perk_optimality: perkOptimality,
    curio_efficiency: curioResult.score,
    composite_score: compositeScore,
    letter_grade: letterGrade,
    weapons: weaponResults,
    curios: curioResult,
    qualitative,
    bot_flags: [],
  };
}

/**
 * Format scorecard as human-readable text.
 */
function formatScorecardText(card) {
  const lines = [];
  lines.push(`=== ${card.title} (${card.class}) ===`);
  lines.push("");
  lines.push("MECHANICAL SCORES:");
  lines.push(`  Perk Optimality:      ${card.perk_optimality}/5`);
  lines.push(`  Curio Efficiency:     ${card.curio_efficiency}/5`);
  lines.push("  Breakpoint Relevance: -/5  (requires qualitative assessment)");
  lines.push("");
  lines.push("WEAPONS:");

  for (const w of card.weapons) {
    const slotTag = w.slot ? `[${w.slot}]` : "[?]";
    lines.push(`  ${slotTag} ${w.name}`);

    // Perks line
    const perkParts = [];
    for (const p of w.perks.perks) {
      if (p === null) {
        perkParts.push("? (unknown)");
      } else {
        perkParts.push(`+${p.name} (T${p.tier}) \u2713`);
      }
    }
    if (perkParts.length > 0) {
      lines.push(`    Perks: ${perkParts.join(", ")}`);
    }

    // Blessings line
    const blessingParts = [];
    for (const b of w.blessings.blessings) {
      blessingParts.push(`${b.name} ${b.known ? "\u2713" : "(?)"}`);
    }
    if (blessingParts.length > 0) {
      lines.push(`    Blessings: ${blessingParts.join(", ")}`);
    }
  }

  lines.push("");
  lines.push("CURIOS:");
  for (const p of card.curios.perks) {
    const tierStr = p.tier > 0 ? `(T${p.tier})` : "(?)";
    const check = p.rating === "avoid" ? "\u2717" : "\u2713";
    lines.push(`  ${p.name} ${tierStr} ${check} ${p.rating}`);
  }

  lines.push("");
  const hasQualitative = card.qualitative.talent_coherence != null || card.qualitative.blessing_synergy != null || card.qualitative.role_coverage != null;
  const hasCalc = card.qualitative.breakpoint_relevance != null || card.qualitative.difficulty_scaling != null;
  if (hasQualitative || hasCalc) {
    lines.push("QUALITATIVE SCORES:");
    const tc = card.qualitative.talent_coherence;
    const bs = card.qualitative.blessing_synergy;
    const rc = card.qualitative.role_coverage;
    const br = card.qualitative.breakpoint_relevance;
    const ds = card.qualitative.difficulty_scaling;
    lines.push(`  Talent Coherence:     ${tc ? tc.score + "/5" : "-/5"}`);
    lines.push(`  Blessing Synergy:     ${bs ? bs.score + "/5" : "-/5"}`);
    lines.push(`  Role Coverage:        ${rc ? rc.score + "/5" : "-/5"}`);
    lines.push(`  Breakpoint Relevance: ${br ? br.score + "/5" : "-/5  (requires calculator)"}`);
    lines.push(`  Difficulty Scaling:   ${ds ? ds.score + "/5" : "-/5  (requires calculator)"}`);
  } else {
    lines.push("QUALITATIVE (fill manually):");
    lines.push("  Blessing Synergy:     _/5");
    lines.push("  Talent Coherence:     _/5");
    lines.push("  Role Coverage:        _/5");
    lines.push("  Difficulty Scaling:   _/5");
  }

  lines.push("");
  lines.push(`COMPOSITE: ${card.composite_score}/35 (${card.letter_grade})`);

  lines.push("");
  lines.push("BOT FLAGS: (fill manually)");
  lines.push("  [ ] BOT:NO_DODGE");
  lines.push("  [ ] BOT:NO_WEAKSPOT");
  lines.push("  [ ] BOT:NO_PERIL_MGT");
  lines.push("  [ ] BOT:NO_POSITIONING");
  lines.push("  [ ] BOT:NO_BLOCK_TIMING");
  lines.push("  [ ] BOT:AIM_DEPENDENT");
  lines.push("  [ ] BOT:ABILITY_OK");
  lines.push("  [ ] BOT:ABILITY_MISSING");

  return lines.join("\n");
}

// CLI entry point — only when executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      text: { type: "boolean", default: false },
    },
  });

  const buildPath = positionals[0];
  if (!buildPath) {
    console.error("Usage: node scripts/score-build.mjs <build.json> [--json|--text]");
    process.exit(1);
  }

  const build = JSON.parse(readFileSync(buildPath, "utf-8"));

  // Load synergy for qualitative scoring (dynamic import to keep module lightweight for library consumers)
  let synergyOutput = null;
  let index = null;
  try {
    const { analyzeBuild, loadIndex } = await import("./ground-truth/lib/synergy-model.mjs");
    index = loadIndex();
    synergyOutput = analyzeBuild(build, index);
  } catch {
    // Synergy unavailable (e.g. missing GROUND_TRUTH_SOURCE_ROOT) — proceed without qualitative scores
  }

  // Load calculator output for breakpoint scoring (graceful degradation)
  let calcOutput = null;
  try {
    const { loadCalculatorData, computeBreakpoints } = await import("./ground-truth/lib/damage-calculator.mjs");
    if (!index) {
      const { loadIndex } = await import("./ground-truth/lib/synergy-model.mjs");
      index = loadIndex();
    }
    const calcData = loadCalculatorData();
    const matrix = computeBreakpoints(build, index, calcData);
    calcOutput = { matrix };
  } catch {
    // Calculator data not available — proceed without breakpoint scores
  }

  const card = generateScorecard(build, synergyOutput, calcOutput);

  if (values.text) {
    console.log(formatScorecardText(card));
  } else {
    console.log(JSON.stringify(card, null, 2));
  }
}
