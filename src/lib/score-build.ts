// Score Darktide build data (output of extract-build) against build-scoring-data.json.
// Perk parsing/scoring, blessing validation, curio scoring, and scorecard generation.

import { readFileSync } from "node:fs";
import { SCORING_DATA_PATH } from "./paths.js";
import { ALIASES_ROOT, ENTITIES_ROOT, listJsonFiles, loadJsonFile } from "./load.js";
import { normalizeText } from "./normalize.js";
import { scoreFromSynergy, scoreFromCalculator } from "./build-scoring.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedPerk {
  min: number;
  max: number;
  name: string;
}

interface ScoredPerk {
  name: string;
  tier: number;
  value: number;
}

interface PerkValue {
  min: number;
  max: number;
  unit: string;
}

interface WeaponPerkResult {
  score: number;
  perks: Array<ScoredPerk | null>;
}

interface BlessingResult {
  name: string;
  known: boolean;
  internal: string | null;
}

interface BlessingValidation {
  valid: boolean | null;
  blessings: BlessingResult[];
}

interface CurioPerkResult {
  name: string;
  tier: number;
  rating: string;
}

interface CurioResult {
  score: number;
  perks: CurioPerkResult[];
}

interface WeaponInput {
  name: string;
  perks: string[];
  blessings: Array<{ name: string; description: string }>;
  slot?: string;
  [key: string]: unknown;
}

interface CurioInput {
  name: string;
  perks: string[];
  [key: string]: unknown;
}

interface ScoringDataEntry {
  internal?: string;
  slot?: string;
  blessings?: Record<string, { internal: string }> | null;
  [key: string]: unknown;
}

interface ScoringData {
  weapons?: Record<string, ScoringDataEntry>;
  melee_perks?: Record<string, { tiers: number[] }>;
  ranged_perks?: Record<string, { tiers: number[] }>;
  curio_perks?: Record<string, { tiers: number[] }>;
  curio_ratings?: Record<string, {
    optimal?: string[];
    good?: string[];
  } & {
    _universal_optimal?: string[];
    _universal_good?: string[];
    _universal_avoid?: string[];
  }>;
  [key: string]: unknown;
}

interface WeaponMatch {
  key: string | null;
  entry: ScoringDataEntry | null;
  canonical_entity_id: string | null;
  internal_name: string | null;
  weapon_family: string | null;
  slot: string | null;
  resolution_source: string;
}

interface WeaponLookup {
  aliasesByNormalizedText: Map<string, Array<{ candidateEntityId: string; rankWeight: number; source: string }>>;
  scoringWeaponsByInternal: Map<string, { key: string; entry: ScoringDataEntry }>;
  weaponEntitiesById: Map<string, Record<string, unknown>>;
}

interface ProvisionalMatch {
  label: string;
  slot: string;
  weapon_family: string;
  blessings: Record<string, { internal: string }>;
}

interface DimensionScore {
  score: number;
  breakdown: Record<string, unknown>;
  explanations: string[];
}

interface ScorecardWeapon {
  name: string;
  slot: string | null;
  canonical_entity_id: string | null;
  internal_name: string | null;
  weapon_family: string | null;
  resolution_source: string | null;
  perks: WeaponPerkResult;
  blessings: BlessingValidation;
}

interface Qualitative {
  blessing_synergy: DimensionScore | null;
  talent_coherence: DimensionScore | null;
  breakpoint_relevance: { score: number; breakdown: unknown; explanations: string[] } | null;
  role_coverage: DimensionScore | null;
  difficulty_scaling: { score: number; breakdown: unknown; explanations: string[] } | null;
}

interface Scorecard {
  title: string;
  class: string;
  perk_optimality: number;
  curio_efficiency: number;
  composite_score: number;
  letter_grade: string;
  weapons: ScorecardWeapon[];
  curios: CurioResult;
  qualitative: Qualitative;
  bot_flags: string[];
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const PROVISIONAL_WEAPON_FAMILY_MATCHES = new Map<string, ProvisionalMatch>([
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

let _data: ScoringData | null = null;
let _weaponLookup: WeaponLookup | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function selectionLabel(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value != null && typeof value === "object" && typeof (value as { raw_label?: unknown }).raw_label === "string") {
    return (value as { raw_label: string }).raw_label;
  }

  return "";
}

function selectionCanonicalEntityId(value: unknown): string | null {
  if (value != null && typeof value === "object" && typeof (value as { canonical_entity_id?: unknown }).canonical_entity_id === "string") {
    return (value as { canonical_entity_id: string }).canonical_entity_id;
  }

  return null;
}

function normalizedWeaponInput(weapon: Record<string, unknown>): WeaponInput {
  return {
    ...weapon,
    name: selectionLabel(weapon?.name),
    perks: ((weapon?.perks as unknown[]) ?? []).map((perk) => selectionLabel(perk)),
    blessings: ((weapon?.blessings as unknown[]) ?? []).map((blessing) => ({
      name: selectionLabel((blessing as Record<string, unknown>)?.name ?? blessing),
      description: typeof (blessing as Record<string, unknown>)?.description === "string" ? (blessing as { description: string }).description : "",
    })),
  };
}

function normalizedCurioInput(curio: Record<string, unknown>): CurioInput {
  return {
    ...curio,
    name: selectionLabel(curio?.name),
    perks: ((curio?.perks as unknown[]) ?? []).map((perk) => selectionLabel(perk)),
  };
}

function extractTemplateBasename(text: string): string | null {
  if (typeof text !== "string" || !text.includes("/")) {
    return null;
  }

  const basename = text.split("/").pop()?.trim() ?? "";
  return basename.length > 0 ? basename : null;
}

function loadData(): ScoringData {
  if (!_data) {
    _data = JSON.parse(readFileSync(SCORING_DATA_PATH, "utf-8")) as ScoringData;
  }
  return _data;
}

const SLOT_TO_KEY: Record<string, string> = {
  melee: "melee_perks",
  ranged: "ranged_perks",
  curio: "curio_perks",
};

// ---------------------------------------------------------------------------
// Perk parsing/scoring
// ---------------------------------------------------------------------------

/**
 * Parse a perk string from the GL scraper into structured form.
 */
export function parsePerkString(str: string): ParsedPerk | null {
  // Pattern 1: range with percent
  let m = str.match(/^\+?(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)%\s+(.+)$/);
  if (m) {
    return {
      min: parseFloat(m[1]) / 100,
      max: parseFloat(m[2]) / 100,
      name: normalizePerkName(m[3]),
    };
  }

  // Pattern 2: single percent
  m = str.match(/^\+?(\d+(?:\.\d+)?)%\s+(.+)$/);
  if (m) {
    const val = parseFloat(m[1]) / 100;
    return { min: val, max: val, name: normalizePerkName(m[2]) };
  }

  // Pattern 3: flat range
  m = str.match(/^\+(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\s+(.+)$/);
  if (m) {
    return {
      min: parseFloat(m[1]),
      max: parseFloat(m[2]),
      name: normalizePerkName(m[3]),
    };
  }

  // Pattern 4: single flat
  m = str.match(/^\+(\d+(?:\.\d+)?)\s+(.+)$/);
  if (m) {
    const val = parseFloat(m[1]);
    return { min: val, max: val, name: normalizePerkName(m[2]) };
  }

  return null;
}

/**
 * Normalize GL perk display names to match scoring data catalog keys.
 */
function normalizePerkName(name: string): string {
  return name
    .replace(/ Enemies\)$/, ")")
    .replace(/\(Carapace Armoured\)/, "(Carapace)")
    .replace(/^(?:Melee|Ranged) /, "")
    .replace(/^Damage Resistance \((.+)\)$/, (_, t: string) => `DR vs ${t.replace("Tox ", "")}`)
    .replace(/^Combat Ability Regeneration$/, "Combat Ability Regen")
    .replace(/^Revive Speed \(Ally\)$/, "Revive Speed")
    .replace(/^Max Health$/, "Health");
}

/**
 * Look up a perk by name and value in the scoring data, determine its tier.
 */
export function scorePerk(name: string, value: number, slot: string): ScoredPerk | null {
  const data = loadData();
  const key = SLOT_TO_KEY[slot];
  if (!key) return null;

  const catalog = data[key] as Record<string, { tiers: number[] }> | undefined;
  if (!catalog) return null;

  const perkDef = catalog[name];
  if (!perkDef) return null;

  const tiers = perkDef.tiers;
  let bestTier = 1;
  let bestDist = Math.abs(value - tiers[0]);

  for (let i = 1; i < tiers.length; i++) {
    const dist = Math.abs(value - tiers[i]);
    if (dist < bestDist) {
      bestDist = dist;
      bestTier = i + 1;
    }
  }

  return { name, tier: bestTier, value };
}

/**
 * Score all perks on a weapon/curio.
 */
export function scoreWeaponPerks(weapon: WeaponInput, slot: string): WeaponPerkResult {
  if (!weapon.perks || weapon.perks.length === 0) {
    return { score: 1, perks: [] };
  }

  const scored: Array<ScoredPerk | null> = [];
  for (const perkStr of weapon.perks) {
    const parsed = parsePerkString(perkStr);
    if (!parsed) {
      scored.push(null);
      continue;
    }
    const result = scorePerk(parsed.name, parsed.max, slot);
    scored.push(result);
  }

  const valid = scored.filter((p): p is ScoredPerk => p !== null);
  if (valid.length === 0) {
    return { score: 1, perks: scored };
  }

  const avgTier = valid.reduce((sum, p) => sum + p.tier, 0) / valid.length;

  let score: number;
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

// ---------------------------------------------------------------------------
// Weapon lookup
// ---------------------------------------------------------------------------

function loadWeaponLookup(): WeaponLookup {
  if (_weaponLookup) {
    return _weaponLookup;
  }

  const data = loadData();
  const scoringWeaponsByInternal = new Map(
    Object.entries(data.weapons || {})
      .filter(([, entry]) => typeof entry.internal === "string" && entry.internal!.length > 0)
      .map(([key, entry]) => [entry.internal!, { key, entry }]),
  );

  const weaponEntities = listJsonFiles(ENTITIES_ROOT)
    .flatMap((path) => loadJsonFile(path) as Array<Record<string, unknown>>)
    .filter((record) => record.kind === "weapon");
  const weaponEntityIds = new Set(weaponEntities.map((record) => record.id as string));
  const weaponEntitiesById = new Map(weaponEntities.map((record) => [record.id as string, record]));

  const aliases = listJsonFiles(ALIASES_ROOT)
    .flatMap((path) => loadJsonFile(path) as Array<Record<string, unknown>>)
    .filter((record) => weaponEntityIds.has(record.candidate_entity_id as string));

  const aliasesByNormalizedText = new Map<string, Array<{ candidateEntityId: string; rankWeight: number; source: string }>>();

  function addAlias(normalizedText: string, candidateEntityId: string, rankWeight: number, source: string): void {
    if (!normalizedText) {
      return;
    }

    const bucket = aliasesByNormalizedText.get(normalizedText) ?? [];
    bucket.push({ candidateEntityId, rankWeight, source });
    aliasesByNormalizedText.set(normalizedText, bucket);
  }

  for (const alias of aliases) {
    addAlias(
      alias.normalized_text as string,
      alias.candidate_entity_id as string,
      (alias.rank_weight as number) ?? 0,
      "ground_truth_alias",
    );
  }

  for (const entity of weaponEntities) {
    addAlias(normalizeText(entity.id as string), entity.id as string, 1000, "canonical_id");

    for (const field of ["internal_name", "loc_key", "ui_name"] as const) {
      const value = entity[field];
      if (typeof value === "string" && value.length > 0) {
        addAlias(normalizeText(value), entity.id as string, field === "internal_name" ? 900 : 800, field);
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

function resolveGroundTruthWeapon(weaponName: string): WeaponMatch | null {
  const { aliasesByNormalizedText, scoringWeaponsByInternal, weaponEntitiesById } = loadWeaponLookup();
  const candidateQueries = [weaponName];
  const templateBasename = extractTemplateBasename(weaponName);

  if (templateBasename != null && templateBasename !== weaponName) {
    candidateQueries.push(templateBasename);
  }

  let candidates: Array<{ candidateEntityId: string; rankWeight: number; source: string }> = [];
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

  const scoringRecord = scoringWeaponsByInternal.get(entity.internal_name as string) ?? null;

  return {
    key: scoringRecord?.key ?? null,
    entry: scoringRecord?.entry ?? null,
    canonical_entity_id: entity.id as string,
    internal_name: entity.internal_name as string,
    weapon_family: ((entity.attributes as Record<string, unknown>)?.weapon_family as string) ?? null,
    slot: ((entity.attributes as Record<string, unknown>)?.slot as string) ?? null,
    resolution_source: "ground_truth",
  };
}

function resolveProvisionalWeaponFamily(weaponName: string): WeaponMatch | null {
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
 * Normalize a weapon name for fallback fuzzy matching against scoring data.
 */
function normalizeName(name: unknown): string {
  return selectionLabel(name).toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Find a weapon in the data by name, using fuzzy matching.
 */
function findWeapon(weaponName: unknown): WeaponMatch | null {
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

  if (groundTruthMatch) {
    return groundTruthMatch;
  }

  const data = loadData();
  const weapons = data.weapons;
  if (!weapons) return null;

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

// ---------------------------------------------------------------------------
// Blessing validation
// ---------------------------------------------------------------------------

export function scoreBlessings(weapon: WeaponInput): BlessingValidation {
  const normalizedWeapon = normalizedWeaponInput(weapon as unknown as Record<string, unknown>);
  const found = findWeapon(normalizedWeapon.name);

  if (!found) {
    return { valid: null, blessings: [] };
  }

  if (!found.entry) {
    return { valid: null, blessings: [] };
  }

  const blessingData = found.entry.blessings;

  if (blessingData === null || blessingData === undefined) {
    return { valid: null, blessings: [] };
  }

  const results: BlessingResult[] = [];
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

// ---------------------------------------------------------------------------
// Curio scoring
// ---------------------------------------------------------------------------

export function scoreCurios(curios: Array<Record<string, unknown>>, className: unknown): CurioResult {
  const data = loadData();
  const ratings = data.curio_ratings;
  if (!ratings) return { score: 1, perks: [] };

  const normalizedClassName = selectionLabel(className);
  const classRatings = ratings[normalizedClassName] || {};
  const universalOptimal = (ratings as Record<string, unknown>)._universal_optimal as string[] || [];
  const universalGood = (ratings as Record<string, unknown>)._universal_good as string[] || [];
  const universalAvoid = (ratings as Record<string, unknown>)._universal_avoid as string[] || [];

  const classOptimal = classRatings.optimal || [];
  const classGood = classRatings.good || [];

  const optimalSet = new Set([...classOptimal, ...universalOptimal]);
  const goodSet = new Set([...classGood, ...universalGood]);
  const avoidSet = new Set(universalAvoid);

  const perkResults: CurioPerkResult[] = [];

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

      let rating: string;
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

  const hasAvoid = perkResults.some((p) => p.rating === "avoid");
  if (hasAvoid) {
    return { score: 1, perks: perkResults };
  }

  const optimalCount = perkResults.filter((p) => p.rating === "optimal").length;
  const goodCount = perkResults.filter((p) => p.rating === "good").length;
  const total = perkResults.length;
  const avgTier = perkResults.reduce((sum, p) => sum + p.tier, 0) / total;
  const desirableRatio = (optimalCount + goodCount) / total;

  let score: number;
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

// ---------------------------------------------------------------------------
// Scorecard generation
// ---------------------------------------------------------------------------

export function generateScorecard(
  build: Record<string, unknown>,
  synergyOutput: Record<string, unknown> | null = null,
  calcOutput: { matrix: unknown } | null = null,
): Scorecard {
  const weaponResults: ScorecardWeapon[] = [];
  const perkScores: number[] = [];
  const normalizedClassName = selectionLabel(build.class);

  for (const weapon of (build.weapons as Array<Record<string, unknown>>) || []) {
    const normalizedWeapon = normalizedWeaponInput(weapon);
    const found = findWeapon(weapon.name);
    const slot = found ? found.slot : null;

    let perkResult: WeaponPerkResult;
    if (slot) {
      perkResult = scoreWeaponPerks(normalizedWeapon, slot);
    } else {
      const buildSlot = weapon.slot as string | undefined;
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

  const curioResult = scoreCurios((build.curios as Array<Record<string, unknown>>) || [], normalizedClassName);

  const perkOptimality =
    perkScores.length > 0
      ? Math.round(perkScores.reduce((a, b) => a + b, 0) / perkScores.length)
      : 1;

  const qualitative: Qualitative = {
    blessing_synergy: null,
    talent_coherence: null,
    breakpoint_relevance: null,
    role_coverage: null,
    difficulty_scaling: null,
  };

  if (synergyOutput != null) {
    const scores = scoreFromSynergy(synergyOutput as any);
    qualitative.talent_coherence = scores.talent_coherence;
    qualitative.blessing_synergy = scores.blessing_synergy;
    qualitative.role_coverage = scores.role_coverage;
  }

  if (calcOutput != null) {
    const calcScores = scoreFromCalculator(calcOutput as any);
    qualitative.breakpoint_relevance = calcScores.breakpoint_relevance;
    qualitative.difficulty_scaling = calcScores.difficulty_scaling;
  }

  const dimensionScores = [
    perkOptimality,
    curioResult.score,
    qualitative.talent_coherence?.score,
    qualitative.blessing_synergy?.score,
    qualitative.role_coverage?.score,
    qualitative.breakpoint_relevance?.score,
    qualitative.difficulty_scaling?.score,
  ].filter((s): s is number => s != null);

  const scoredCount = dimensionScores.length;
  const rawSum = dimensionScores.reduce((a, b) => a + b, 0);
  const compositeScore = Math.round(rawSum * 7 / scoredCount);

  let letterGrade: string;
  if (compositeScore >= 32) letterGrade = "S";
  else if (compositeScore >= 27) letterGrade = "A";
  else if (compositeScore >= 22) letterGrade = "B";
  else if (compositeScore >= 17) letterGrade = "C";
  else letterGrade = "D";

  return {
    title: build.title as string,
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
