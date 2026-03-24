import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSourceSnapshot } from "./ground-truth/lib/validate.mjs";
import { ENTITIES_ROOT, EDGES_ROOT, listJsonFiles } from "./ground-truth/lib/load.mjs";
import { runCliMain } from "./ground-truth/lib/cli.mjs";

// --- Filename parsing ---

export function parseWeaponFilename(filename) {
  const base = filename.replace(/\.lua$/, "");
  const match = base.match(/^(.+)_(p\d+)_(m\d+)$/);
  if (!match) return null;
  return { family: match[1], pSeries: match[2], mark: match[3], internalName: base };
}

export function parseBespokeFilename(filename) {
  const base = filename.replace(/\.lua$/, "");
  const match = base.match(/^weapon_traits_bespoke_(.+)_(p\d+)$/);
  if (!match) return null;
  return { family: match[1], pSeries: match[2] };
}

export function extractConceptSuffix(internalName, family, pSeries) {
  const prefix = `weapon_trait_bespoke_${family}_${pSeries}_`;
  let suffix = internalName.startsWith(prefix) ? internalName.slice(prefix.length) : internalName;
  if (suffix.endsWith("_parent")) suffix = suffix.slice(0, -7);
  return suffix;
}

// --- Slot detection ---

export function detectSlot(luaSource) {
  if (/keywords\s*=\s*\{[^}]*"ranged"/s.test(luaSource)) return "ranged";
  if (/keywords\s*=\s*\{[^}]*"melee"/s.test(luaSource)) return "melee";
  const ammoMatch = luaSource.match(/ammo_template\s*=\s*"([^"]+)"/);
  if (ammoMatch) return ammoMatch[1] === "no_ammo" ? "melee" : "ranged";
  return "melee";
}

// --- Entity ID builders ---

export function weaponEntityId(internalName) { return `shared.weapon.${internalName}`; }
export function traitEntityId(internalName) { return `shared.weapon_trait.${internalName}`; }
export function perkEntityId(internalName, slot) { return `shared.weapon_perk.${slot}.${internalName}`; }
export function gadgetTraitEntityId(internalName) { return `shared.gadget_trait.${internalName}`; }
export function nameFamilyEntityId(slug) { return `shared.name_family.blessing.${slug}`; }

// --- Entity record factories ---

function makeBaseEntity(id, kind, internalName, refPath, refLine, snapshotId, attributes) {
  return {
    id, kind, domain: "shared", internal_name: internalName,
    loc_key: null, ui_name: null, status: "source_backed",
    refs: [{ path: refPath, line: refLine }],
    source_snapshot_id: snapshotId, attributes, calc: {},
  };
}

export function makeWeaponEntity(internalName, family, pSeries, slot, refPath, snapshotId) {
  return makeBaseEntity(weaponEntityId(internalName), "weapon", internalName, refPath, 1, snapshotId, { weapon_family: `${family}_${pSeries}`, slot });
}

export function makeTraitEntity(internalName, family, pSeries, slot, refPath, refLine, snapshotId) {
  return makeBaseEntity(traitEntityId(internalName), "weapon_trait", internalName, refPath, refLine, snapshotId, { weapon_family: `${family}_${pSeries}`, slot });
}

export function makePerkEntity(internalName, slot, refPath, refLine, snapshotId) {
  return makeBaseEntity(perkEntityId(internalName, slot), "weapon_perk", internalName, refPath, refLine, snapshotId, { slot });
}

export function makeGadgetTraitEntity(internalName, refPath, refLine, snapshotId) {
  return makeBaseEntity(gadgetTraitEntityId(internalName), "gadget_trait", internalName, refPath, refLine, snapshotId, { slot: "curio" });
}

export function makeNameFamilyEntity(slug, refPath, refLine, snapshotId) {
  return {
    id: nameFamilyEntityId(slug), kind: "name_family", domain: "shared",
    internal_name: null, loc_key: null, ui_name: null, status: "partially_resolved",
    refs: [{ path: refPath, line: refLine }],
    source_snapshot_id: snapshotId, attributes: { family_type: "blessing" }, calc: {},
  };
}

// --- Edge record factories ---

function makeBaseEdge(id, type, fromEntityId, toEntityId, snapshotId) {
  return {
    id, type, from_entity_id: fromEntityId, to_entity_id: toEntityId,
    source_snapshot_id: snapshotId,
    conditions: { predicates: [], aggregation: "additive", stacking_mode: "binary", exclusive_scope: null },
    calc: {}, evidence_ids: [],
  };
}

export function makeInstanceOfEdge(traitEntityId, familyEntityId, traitInternalName, snapshotId) {
  return makeBaseEdge(`shared.edge.instance_of.${traitInternalName}`, "instance_of", traitEntityId, familyEntityId, snapshotId);
}

export function makeWeaponHasTraitPoolEdge(weaponEntityId, traitEntityId, weaponInternalName, traitInternalName, snapshotId) {
  return makeBaseEdge(`shared.edge.weapon_has_trait_pool.${weaponInternalName}.${traitInternalName}`, "weapon_has_trait_pool", weaponEntityId, traitEntityId, snapshotId);
}

// --- Concept-suffix map builder ---

export function buildConceptFamilyMap(edges, entityMap) {
  const map = new Map();
  for (const edge of edges) {
    if (edge.type !== "instance_of") continue;
    const fromEntity = entityMap.get(edge.from_entity_id);
    if (!fromEntity || fromEntity.kind !== "weapon_trait") continue;
    const bespokeMatch = fromEntity.internal_name.match(/^weapon_trait_bespoke_(.+)_(p\d+)_(.+)$/);
    if (!bespokeMatch) continue;
    const [, family, pSeries, conceptRaw] = bespokeMatch;
    const suffix = conceptRaw.replace(/_parent$/, "");
    const familySlug = edge.to_entity_id.split(".").pop();
    if (map.has(suffix) && map.get(suffix) !== familySlug) {
      console.warn(`  Warning: concept suffix "${suffix}" maps to both "${map.get(suffix)}" and "${familySlug}"`);
    }
    map.set(suffix, familySlug);
  }
  return map;
}

// --- Source scanners ---

const WEAPON_TEMPLATES_DIR = "scripts/settings/equipment/weapon_templates";
const BESPOKE_TRAITS_DIR = "scripts/settings/equipment/weapon_traits";
const GADGET_TRAITS_FILE = "scripts/settings/equipment/gadget_traits/gadget_traits_common.lua";

export function scanWeaponMarks(sourceRoot) {
  const results = [];
  const templatesDir = join(sourceRoot, WEAPON_TEMPLATES_DIR);
  const familyDirs = readdirSync(templatesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const dirName of familyDirs) {
    const dirPath = join(templatesDir, dirName);
    const files = readdirSync(dirPath).filter(f => f.endsWith(".lua")).sort();
    for (const file of files) {
      const parsed = parseWeaponFilename(file);
      if (!parsed) continue;
      const fullPath = join(dirPath, file);
      const luaSource = readFileSync(fullPath, "utf8");
      const slot = detectSlot(luaSource);
      const refPath = join(WEAPON_TEMPLATES_DIR, dirName, file);
      results.push({ ...parsed, slot, refPath });
    }
  }
  return results;
}

export function scanBespokeTraits(sourceRoot, weaponMarks) {
  const results = [];
  const traitsDir = join(sourceRoot, BESPOKE_TRAITS_DIR);
  const bespokeFiles = readdirSync(traitsDir)
    .filter(f => f.startsWith("weapon_traits_bespoke_") && f.endsWith(".lua"))
    .sort();

  const familySlotMap = new Map();
  if (weaponMarks) {
    for (const w of weaponMarks) {
      familySlotMap.set(`${w.family}_${w.pSeries}`, w.slot);
    }
  }

  for (const file of bespokeFiles) {
    const parsed = parseBespokeFilename(file);
    if (!parsed) continue;
    const { family, pSeries } = parsed;
    const slot = familySlotMap.get(`${family}_${pSeries}`) || "melee";
    const fullPath = join(traitsDir, file);
    const luaSource = readFileSync(fullPath, "utf8");
    const refPath = join(BESPOKE_TRAITS_DIR, file);

    const lines = luaSource.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^\s*(?:templates|[\w]+)\.(weapon_trait_bespoke_\w+)\s*=/);
      if (match) {
        results.push({
          internalName: match[1],
          family, pSeries, slot,
          refPath, refLine: i + 1,
        });
      }
    }
  }
  return results;
}

export function scanPerks(sourceRoot) {
  const results = [];
  const perkFiles = [
    { file: "weapon_perks_melee.lua", slot: "melee" },
    { file: "weapon_perks_ranged.lua", slot: "ranged" },
  ];
  for (const { file, slot } of perkFiles) {
    const fullPath = join(sourceRoot, BESPOKE_TRAITS_DIR, file);
    const luaSource = readFileSync(fullPath, "utf8");
    const refPath = join(BESPOKE_TRAITS_DIR, file);
    const lines = luaSource.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^\s*[\w]+\.(weapon_trait_\w+)\s*=\s*\{/);
      if (match) {
        results.push({ internalName: match[1], slot, refPath, refLine: i + 1 });
      }
    }
  }
  return results;
}

export function scanGadgetTraits(sourceRoot) {
  const results = [];
  const fullPath = join(sourceRoot, GADGET_TRAITS_FILE);
  const luaSource = readFileSync(fullPath, "utf8");
  const refPath = GADGET_TRAITS_FILE;
  const lines = luaSource.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s*[\w]+\.(gadget_\w+)\s*=/);
    if (match) {
      results.push({ internalName: match[1], refPath, refLine: i + 1 });
    }
  }
  return results;
}
