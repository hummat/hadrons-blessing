import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildClassSideManifest, type ClassSideManifestEntry } from "../lib/class-side-manifest.js";
import { validateSourceSnapshot } from "../lib/validate.js";
import { ENTITIES_ROOT, EDGES_ROOT, listJsonFiles } from "../lib/load.js";
import { runCliMain } from "../lib/cli.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

// --- Filename parsing ---

export function parseWeaponFilename(filename: string) {
  const base = filename.replace(/\.lua$/, "");
  const match = base.match(/^(.+)_(p\d+)_(m\d+)$/);
  if (!match) return null;
  return { family: match[1], pSeries: match[2], mark: match[3], internalName: base };
}

export function parseBespokeFilename(filename: string) {
  const base = filename.replace(/\.lua$/, "");
  const match = base.match(/^weapon_traits_bespoke_(.+)_(p\d+)$/);
  if (!match) return null;
  return { family: match[1], pSeries: match[2] };
}

export function extractConceptSuffix(internalName: string, family: string, pSeries: string) {
  const prefix = `weapon_trait_bespoke_${family}_${pSeries}_`;
  let suffix = internalName.startsWith(prefix) ? internalName.slice(prefix.length) : internalName;
  if (suffix.endsWith("_parent")) suffix = suffix.slice(0, -7);
  return suffix;
}

// --- Slot detection ---

export function detectSlot(luaSource: string) {
  if (/keywords\s*=\s*\{[^}]*"ranged"/s.test(luaSource)) return "ranged";
  if (/keywords\s*=\s*\{[^}]*"melee"/s.test(luaSource)) return "melee";
  const ammoMatch = luaSource.match(/ammo_template\s*=\s*"([^"]+)"/);
  if (ammoMatch) return ammoMatch[1] === "no_ammo" ? "melee" : "ranged";
  return "melee";
}

// --- Entity ID builders ---

export function weaponEntityId(internalName: string) { return `shared.weapon.${internalName}`; }
export function traitEntityId(internalName: string) { return `shared.weapon_trait.${internalName}`; }
export function perkEntityId(internalName: string, slot: string) { return `shared.weapon_perk.${slot}.${internalName}`; }
export function gadgetTraitEntityId(internalName: string) { return `shared.gadget_trait.${internalName}`; }
export function nameFamilyEntityId(slug: string) { return `shared.name_family.blessing.${slug}`; }

// --- Entity record factories ---

function makeBaseEntity(id: string, kind: string, internalName: string, refPath: string, refLine: number, snapshotId: string, attributes: AnyRecord) {
  return {
    id, kind, domain: "shared", internal_name: internalName,
    loc_key: null, ui_name: null, status: "source_backed",
    refs: [{ path: refPath, line: refLine }],
    source_snapshot_id: snapshotId, attributes, calc: {},
  };
}

export function makeWeaponEntity(internalName: string, family: string, pSeries: string, slot: string, refPath: string, snapshotId: string) {
  return makeBaseEntity(weaponEntityId(internalName), "weapon", internalName, refPath, 1, snapshotId, { weapon_family: `${family}_${pSeries}`, slot });
}

export function makeTraitEntity(internalName: string, family: string, pSeries: string, slot: string, refPath: string, refLine: number, snapshotId: string) {
  return makeBaseEntity(traitEntityId(internalName), "weapon_trait", internalName, refPath, refLine, snapshotId, { weapon_family: `${family}_${pSeries}`, slot });
}

export function makePerkEntity(internalName: string, slot: string, refPath: string, refLine: number, snapshotId: string) {
  return makeBaseEntity(perkEntityId(internalName, slot), "weapon_perk", internalName, refPath, refLine, snapshotId, { slot });
}

export function makeGadgetTraitEntity(internalName: string, refPath: string, refLine: number, snapshotId: string) {
  return makeBaseEntity(gadgetTraitEntityId(internalName), "gadget_trait", internalName, refPath, refLine, snapshotId, { slot: "curio" });
}

export function makeNameFamilyEntity(slug: string, refPath: string, refLine: number, snapshotId: string) {
  return {
    id: nameFamilyEntityId(slug), kind: "name_family", domain: "shared",
    internal_name: null, loc_key: null, ui_name: null, status: "partially_resolved",
    refs: [{ path: refPath, line: refLine }],
    source_snapshot_id: snapshotId, attributes: { family_type: "blessing" }, calc: {},
  };
}

// --- Edge record factories ---

function makeBaseEdge(id: string, type: string, fromEntityId: string, toEntityId: string, snapshotId: string) {
  return {
    id, type, from_entity_id: fromEntityId, to_entity_id: toEntityId,
    source_snapshot_id: snapshotId,
    conditions: { predicates: [], aggregation: "additive", stacking_mode: "binary", exclusive_scope: null },
    calc: {}, evidence_ids: [],
  };
}

export function makeInstanceOfEdge(traitEntityId: string, familyEntityId: string, traitInternalName: string, snapshotId: string) {
  return makeBaseEdge(`shared.edge.instance_of.${traitInternalName}`, "instance_of", traitEntityId, familyEntityId, snapshotId);
}

export function makeWeaponHasTraitPoolEdge(weaponEntityId: string, traitEntityId: string, weaponInternalName: string, traitInternalName: string, snapshotId: string) {
  return makeBaseEdge(`shared.edge.weapon_has_trait_pool.${weaponInternalName}.${traitInternalName}`, "weapon_has_trait_pool", weaponEntityId, traitEntityId, snapshotId);
}

// --- Concept-suffix map builder ---

export function buildConceptFamilyMap(edges: AnyRecord[], entityMap: Map<string, AnyRecord>) {
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

export function scanWeaponMarks(sourceRoot: string) {
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

export function scanBespokeTraits(sourceRoot: string, weaponMarks: AnyRecord[]) {
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

export function scanPerks(sourceRoot: string) {
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

export function scanGadgetTraits(sourceRoot: string) {
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

// --- Main orchestrator ---

const SHARED_WEAPONS_FILE = join(ENTITIES_ROOT, "shared-weapons.json");
const SHARED_NAMES_FILE = join(ENTITIES_ROOT, "shared-names.json");
const SHARED_EDGES_FILE = join(EDGES_ROOT, "shared.json");

function classEntityFilePath(className: string) {
  return join(ENTITIES_ROOT, `${className}.json`);
}

function makeClassSideEntity(entry: ClassSideManifestEntry, snapshotId: string) {
  return {
    id: entry.entity_id,
    kind: entry.kind,
    domain: entry.class,
    internal_name: entry.internal_name,
    loc_key: null,
    ui_name: null,
    status: "source_backed",
    refs: [{ path: entry.layout_ref.path, line: entry.layout_ref.line }],
    source_snapshot_id: snapshotId,
    attributes: {
      tree_type: entry.tree_type,
      tree_widget_name: entry.widget_name,
      coverage_slot: entry.slot,
    },
    calc: {},
  };
}

export async function expandEntityCoverage() {
  // --- Phase 1: Inventory ---
  const snapshot = validateSourceSnapshot();
  const sourceRoot = snapshot.source_root;
  const snapshotId = snapshot.id;

  // Load existing entities
  const existingEntities = new Map();
  for (const filePath of listJsonFiles(ENTITIES_ROOT)) {
    const records = JSON.parse(readFileSync(filePath, "utf8"));
    for (const r of records) existingEntities.set(r.id, r);
  }

  // Load existing edges
  const existingEdges = JSON.parse(readFileSync(SHARED_EDGES_FILE, "utf8"));
  const existingEdgeIds = new Set(existingEdges.map((e: AnyRecord) => e.id));

  // Build concept → family map
  const conceptFamilyMap = buildConceptFamilyMap(existingEdges, existingEntities);
  console.log(`  Concept→family map: ${conceptFamilyMap.size} known mappings`);

  // --- Source scanning ---
  const classSideManifest = buildClassSideManifest(sourceRoot);
  const weaponMarks = scanWeaponMarks(sourceRoot);
  const bespokeTraits = scanBespokeTraits(sourceRoot, weaponMarks);
  const perks = scanPerks(sourceRoot);
  const gadgetTraits = scanGadgetTraits(sourceRoot);
  console.log(`  Source scan: ${classSideManifest.length} class-side nodes, ${weaponMarks.length} weapons, ${bespokeTraits.length} traits, ${perks.length} perks, ${gadgetTraits.length} gadget traits`);

  // --- Phase 2: Generate entity shells ---
  const newClassSideEntitiesByFile = new Map<string, AnyRecord[]>();
  const newWeaponEntities = [];
  const newTraitEntities = [];
  const newPerkEntities = [];
  const newGadgetEntities = [];

  for (const entry of classSideManifest) {
    if (existingEntities.has(entry.entity_id)) continue;
    const entity = makeClassSideEntity(entry, snapshotId);
    const filePath = classEntityFilePath(entry.class);
    if (!newClassSideEntitiesByFile.has(filePath)) {
      newClassSideEntitiesByFile.set(filePath, []);
    }
    newClassSideEntitiesByFile.get(filePath)!.push(entity);
    existingEntities.set(entry.entity_id, entity);
  }

  for (const w of weaponMarks) {
    const id = weaponEntityId(w.internalName);
    if (existingEntities.has(id)) continue;
    const entity = makeWeaponEntity(w.internalName, w.family, w.pSeries, w.slot, w.refPath, snapshotId);
    newWeaponEntities.push(entity);
    existingEntities.set(id, entity);
  }

  for (const t of bespokeTraits) {
    const id = traitEntityId(t.internalName);
    // Dedup: also check for _parent variant
    const parentId = traitEntityId(t.internalName + "_parent");
    if (existingEntities.has(id) || existingEntities.has(parentId)) continue;
    const entity = makeTraitEntity(t.internalName, t.family, t.pSeries, t.slot, t.refPath, t.refLine, snapshotId);
    newTraitEntities.push(entity);
    existingEntities.set(id, entity);
  }

  for (const p of perks) {
    const id = perkEntityId(p.internalName, p.slot);
    if (existingEntities.has(id)) continue;
    const entity = makePerkEntity(p.internalName, p.slot, p.refPath, p.refLine, snapshotId);
    newPerkEntities.push(entity);
    existingEntities.set(id, entity);
  }

  for (const g of gadgetTraits) {
    const id = gadgetTraitEntityId(g.internalName);
    if (existingEntities.has(id)) continue;
    const entity = makeGadgetTraitEntity(g.internalName, g.refPath, g.refLine, snapshotId);
    newGadgetEntities.push(entity);
    existingEntities.set(id, entity);
  }

  // --- Phase 3: Generate name_family entities ---
  const newNameFamilies = [];
  const unmappedSuffixes = [];

  // Build bespoke trait grouping: family_pSeries → [trait, ...]
  const bespokeByFamilyP = new Map();
  for (const t of bespokeTraits) {
    const key = `${t.family}_${t.pSeries}`;
    if (!bespokeByFamilyP.has(key)) bespokeByFamilyP.set(key, []);
    bespokeByFamilyP.get(key).push(t);
  }

  for (const t of bespokeTraits) {
    const suffix = extractConceptSuffix(t.internalName, t.family, t.pSeries);
    if (conceptFamilyMap.has(suffix)) continue;
    // Check if name_family already exists with this suffix as slug
    if (existingEntities.has(nameFamilyEntityId(suffix))) {
      conceptFamilyMap.set(suffix, suffix);
      continue;
    }
    // Create new name_family with concept suffix as temporary slug
    const entity = makeNameFamilyEntity(suffix, t.refPath, t.refLine, snapshotId);
    newNameFamilies.push(entity);
    existingEntities.set(entity.id, entity);
    conceptFamilyMap.set(suffix, suffix);
    unmappedSuffixes.push(suffix);
  }

  // --- Phase 4: Generate edges ---
  const newEdges = [];

  // weapon_has_trait_pool: each weapon → all traits in its bespoke file
  for (const w of weaponMarks) {
    const wId = weaponEntityId(w.internalName);
    if (!existingEntities.has(wId)) continue;
    const key = `${w.family}_${w.pSeries}`;
    const traits = bespokeByFamilyP.get(key) || [];
    for (const t of traits) {
      // Resolve trait entity ID (check _parent variant too)
      let tId = traitEntityId(t.internalName);
      if (!existingEntities.has(tId)) {
        const parentId = traitEntityId(t.internalName + "_parent");
        if (existingEntities.has(parentId)) tId = parentId;
        else continue;
      }
      const tInternalName = existingEntities.get(tId).internal_name;
      const edgeId = `shared.edge.weapon_has_trait_pool.${w.internalName}.${tInternalName}`;
      if (existingEdgeIds.has(edgeId)) continue;
      const edge = makeWeaponHasTraitPoolEdge(wId, tId, w.internalName, tInternalName, snapshotId);
      newEdges.push(edge);
      existingEdgeIds.add(edgeId);
    }
  }

  // instance_of: each trait → its name_family
  for (const t of bespokeTraits) {
    let tId = traitEntityId(t.internalName);
    if (!existingEntities.has(tId)) {
      const parentId = traitEntityId(t.internalName + "_parent");
      if (existingEntities.has(parentId)) tId = parentId;
      else continue;
    }
    const tInternalName = existingEntities.get(tId).internal_name;
    const edgeId = `shared.edge.instance_of.${tInternalName}`;
    if (existingEdgeIds.has(edgeId)) continue;

    const suffix = extractConceptSuffix(t.internalName, t.family, t.pSeries);
    const familySlug = conceptFamilyMap.get(suffix);
    if (!familySlug) continue;
    const familyId = nameFamilyEntityId(familySlug);
    if (!existingEntities.has(familyId)) continue;

    const edge = makeInstanceOfEdge(tId, familyId, tInternalName, snapshotId);
    newEdges.push(edge);
    existingEdgeIds.add(edgeId);
  }

  // --- Write-back ---
  for (const [filePath, newEntities] of newClassSideEntitiesByFile) {
    if (newEntities.length === 0) continue;
    let records: AnyRecord[];
    try {
      records = JSON.parse(readFileSync(filePath, "utf8"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        records = [];
      } else {
        throw err;
      }
    }
    records.push(...newEntities);
    records.sort((a: AnyRecord, b: AnyRecord) => String(a.id).localeCompare(String(b.id)));
    writeFileSync(filePath, JSON.stringify(records, null, 2) + "\n");
  }

  const allNewEntities = [...newWeaponEntities, ...newTraitEntities, ...newPerkEntities, ...newGadgetEntities];
  if (allNewEntities.length > 0) {
    const weapons = JSON.parse(readFileSync(SHARED_WEAPONS_FILE, "utf8"));
    weapons.push(...allNewEntities);
    writeFileSync(SHARED_WEAPONS_FILE, JSON.stringify(weapons, null, 2) + "\n");
  }

  if (newNameFamilies.length > 0) {
    const names = JSON.parse(readFileSync(SHARED_NAMES_FILE, "utf8"));
    names.push(...newNameFamilies);
    writeFileSync(SHARED_NAMES_FILE, JSON.stringify(names, null, 2) + "\n");
  }

  if (newEdges.length > 0) {
    existingEdges.push(...newEdges);
    writeFileSync(SHARED_EDGES_FILE, JSON.stringify(existingEdges, null, 2) + "\n");
  }

  // --- Phase 5: Report ---
  console.log("\n=== Entity Coverage Expansion Report ===\n");
  console.log(`Entities generated:`);
  const newClassSideEntities = [...newClassSideEntitiesByFile.values()].flat();
  console.log(`  class-side:    ${newClassSideEntities.length}`);
  console.log(`  weapon:       ${newWeaponEntities.length}`);
  console.log(`  weapon_trait:  ${newTraitEntities.length}`);
  console.log(`  weapon_perk:   ${newPerkEntities.length}`);
  console.log(`  gadget_trait:  ${newGadgetEntities.length}`);
  console.log(`  name_family:   ${newNameFamilies.length}`);
  console.log(`\nEdges generated:`);
  const wtpEdges = newEdges.filter(e => e.type === "weapon_has_trait_pool");
  const ioEdges = newEdges.filter(e => e.type === "instance_of");
  console.log(`  weapon_has_trait_pool: ${wtpEdges.length}`);
  console.log(`  instance_of:          ${ioEdges.length}`);

  if (unmappedSuffixes.length > 0) {
    console.log(`\nUnmapped concept suffixes (need manual name_family assignment):`);
    for (const s of unmappedSuffixes.sort()) console.log(`  - ${s}`);
  }

  // Bespoke files with no matching weapon marks
  const orphanBespoke = [];
  for (const file of readdirSync(join(sourceRoot, BESPOKE_TRAITS_DIR)).filter(f => f.startsWith("weapon_traits_bespoke_")).sort()) {
    const parsed = parseBespokeFilename(file);
    if (!parsed) continue;
    const hasWeapon = weaponMarks.some(w => w.family === parsed.family && w.pSeries === parsed.pSeries);
    if (!hasWeapon) orphanBespoke.push(file);
  }
  if (orphanBespoke.length > 0) {
    console.log(`\nBespoke files with no weapon marks (orphan p-series):`);
    for (const f of orphanBespoke) console.log(`  - ${f}`);
  }

  // Damage profile gap: weapons with entities but no profiles
  const PROFILES_FILE = join(ENTITIES_ROOT, "..", "generated", "damage-profiles.json");
  try {
    const profiles = JSON.parse(readFileSync(PROFILES_FILE, "utf8"));
    const profileWeapons = new Set(profiles.map((p: AnyRecord) => p.source_file).filter(Boolean));
    const missingProfiles = weaponMarks
      .filter(w => !profileWeapons.has(w.internalName) && existingEntities.has(weaponEntityId(w.internalName)))
      .map(w => w.internalName);
    if (missingProfiles.length > 0) {
      console.log(`\nWeapons with no damage profiles (profile gap):`);
      for (const w of missingProfiles.sort()) console.log(`  - ${w}`);
    }
  } catch { /* profiles file may not exist */ }

  const totalEntities = existingEntities.size;
  const totalEdges = existingEdges.length;
  console.log(`\nTotals: ${totalEntities} entities, ${totalEdges} edges`);

  return {
    newClassSideEntities,
    newWeaponEntities, newTraitEntities, newPerkEntities, newGadgetEntities,
    newNameFamilies, newEdges, unmappedSuffixes, orphanBespoke,
  };
}

// --- CLI (guarded so importing for tests doesn't trigger main) ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCliMain("entities:expand", async () => {
    await expandEntityCoverage();
  });
}
