/**
 * Pipeline entry point: extract buff effects from Darktide Lua source,
 * populate calc fields on existing entities, create buff entities,
 * and generate grants_buff edges.
 *
 * Usage: node scripts/extract-buff-effects.mjs
 *        npm run effects:build
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { validateSourceSnapshot } from "../lib/validate.js";
import { ENTITIES_ROOT, EDGES_ROOT, listJsonFiles } from "../lib/load.js";
import { runCliMain } from "../lib/cli.js";
import { loadAllTalentSettings } from "../lib/talent-settings-parser.js";
import { extractTemplateBlocks } from "../lib/lua-data-reader.js";
import {
  extractEffects,
  extractTiers,
  resolveTemplateChain,
  extractTalentBuffLinks,
} from "../lib/buff-semantic-parser.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

await runCliMain("effects:build", async () => {
  const snapshot = validateSourceSnapshot();
  const sourceRoot = snapshot.source_root;
  const snapshotId = snapshot.id;

  // -- Phase 1: Load TalentSettings ------------------------------------------
  const settingsMap = await loadAllTalentSettings(sourceRoot);
  console.log(`Loaded ${settingsMap.size} TalentSettings entries`);

  // -- Phase 2: Load + resolve buff templates --------------------------------
  const allBlocks = [];
  /** @type {Map<string, { aliases: object, localFunctions: object }>} templateName → file context */
  const templateFileContext = new Map();

  const buffTemplateFiles = collectBuffTemplateFiles(sourceRoot);

  for (const filePath of buffTemplateFiles) {
    const luaSource = readFileSync(filePath, "utf8");
    let result;
    try {
      result = extractTemplateBlocks(luaSource);
    } catch (err: unknown) {
      console.warn(`Warning: skipping ${basename(filePath)} — ${(err as Error).message}`);
      continue;
    }
    const { blocks, aliases, localFunctions } = result;
    for (const block of blocks) {
      allBlocks.push(block);
      templateFileContext.set(block.name, { aliases, localFunctions });
    }
  }

  const resolvedTemplates = resolveTemplateChain(allBlocks);
  console.log(`Resolved ${resolvedTemplates.size} buff templates`);

  // -- Phase 3: Load talent → buff_template_name links -----------------------
  const talentLinks = new Map();
  const talentDir = join(sourceRoot, "scripts", "settings", "ability", "archetype_talents", "talents");
  const talentFiles = readdirSync(talentDir).filter((f) => f.endsWith("_talents.lua")).sort();

  for (const file of talentFiles) {
    const luaSource = readFileSync(join(talentDir, file), "utf8");
    let links;
    try {
      links = extractTalentBuffLinks(luaSource);
    } catch (err: unknown) {
      console.warn(`Warning: skipping talent file ${file} — ${(err as Error).message}`);
      continue;
    }
    for (const [talentName, buffNames] of links) {
      talentLinks.set(talentName, buffNames);
    }
  }

  // -- Phase 4: Load weapon trait tier data ----------------------------------
  /** @type {Map<string, object[]>} traitName → 4-element tier array */
  const tierDataMap = new Map();
  const weaponTraitDir = join(sourceRoot, "scripts", "settings", "equipment", "weapon_traits");
  const bespokeFiles = readdirSync(weaponTraitDir)
    .filter((f) => f.startsWith("weapon_traits_bespoke_") && f.endsWith(".lua"))
    .sort();

  for (const file of bespokeFiles) {
    const luaSource = readFileSync(join(weaponTraitDir, file), "utf8");
    let result;
    try {
      result = extractTemplateBlocks(luaSource);
    } catch (err: unknown) {
      console.warn(`Warning: skipping trait file ${file} — ${(err as Error).message}`);
      continue;
    }

    for (const block of result.blocks) {
      const parsed = block.parsed as AnyRecord | null;
      if (!parsed || typeof parsed !== "object") continue;
      if (!parsed.buffs || typeof parsed.buffs !== "object") continue;

      // The buffs subtable has keys that are buff template names,
      // each containing a 4-element tier array.
      for (const [buffKey, tierArray] of Object.entries(parsed.buffs)) {
        if (Array.isArray(tierArray) && tierArray.length === 4) {
          tierDataMap.set(block.name, tierArray);
        }
      }
    }
  }

  // -- Phase 5: Load existing entity files -----------------------------------
  /** @type {Map<string, { entity: object, file: string, index: number }>} */
  const entityIndex = new Map();
  /** @type {Map<string, object[]>} filePath → entity array */
  const entityFileContents = new Map();
  const modifiedFiles = new Set();

  for (const filePath of listJsonFiles(ENTITIES_ROOT)) {
    const records = JSON.parse(readFileSync(filePath, "utf8"));
    entityFileContents.set(filePath, records);
    for (let i = 0; i < records.length; i++) {
      entityIndex.set(records[i].id, { entity: records[i], file: filePath, index: i });
    }
  }

  // -- Phase 6: Match and populate calc fields --------------------------------
  const TALENT_KINDS = new Set(["talent", "ability", "aura", "keystone", "talent_modifier"]);
  let populated = 0;
  let partial = 0;
  let zero = 0;

  for (const [entityId, entry] of entityIndex) {
    const entity = entry.entity;
    const kind = entity.kind;
    const internalName = entity.internal_name;
    if (!internalName) continue;

    let calc: AnyRecord | null = null;

    // Strategy 1: Talents — use talentLinks to find buff template names
    if (TALENT_KINDS.has(kind)) {
      const buffNames = talentLinks.get(internalName);
      if (buffNames && buffNames.length > 0) {
        // Merge effects from all referenced buff templates
        const mergedEffects = [];
        let mergedMeta: AnyRecord = {};
        for (const bn of buffNames) {
          const template = resolvedTemplates.get(bn);
          if (!template) continue;
          const ctx = templateFileContext.get(bn) || { aliases: {}, localFunctions: {} };
          const c = extractEffects(template, settingsMap, ctx);
          mergedEffects.push(...c.effects);
          // Carry metadata from last template that has it
          for (const key of ["class_name", "max_stacks", "duration", "active_duration", "keywords"]) {
            if ((c as AnyRecord)[key] !== undefined) mergedMeta[key] = (c as AnyRecord)[key];
          }
        }
        if (mergedEffects.length > 0) {
          calc = { effects: mergedEffects, ...mergedMeta, buff_template_names: buffNames };
        } else {
          // We have links but extracted no effects — still record the template names
          calc = { buff_template_names: buffNames };
        }
      }
    }

    // Strategy 2: Weapon traits — look up internal_name directly in resolved templates
    if (kind === "weapon_trait" && !calc) {
      const template = resolvedTemplates.get(internalName);
      if (template) {
        const ctx = templateFileContext.get(internalName) || { aliases: {}, localFunctions: {} };
        calc = extractEffects(template, settingsMap, ctx);
      }
      // Add tier data if available
      const tiers = tierDataMap.get(internalName);
      if (tiers) {
        const tierCtx = templateFileContext.get(internalName) || { aliases: {}, localFunctions: {} };
        const tierResult = extractTiers(tiers, settingsMap, tierCtx);
        if (!calc) calc = {};
        calc.tiers = tierResult;
      }
    }

    // Strategy 3: Weapon perks — look up internal_name in resolved templates
    if (kind === "weapon_perk" && !calc) {
      const template = resolvedTemplates.get(internalName);
      if (template) {
        const ctx = templateFileContext.get(internalName) || { aliases: {}, localFunctions: {} };
        calc = extractEffects(template, settingsMap, ctx);
      }
    }

    // Strategy 4: Gadget traits — look up internal_name in resolved templates
    if (kind === "gadget_trait" && !calc) {
      const template = resolvedTemplates.get(internalName);
      if (template) {
        const ctx = templateFileContext.get(internalName) || { aliases: {}, localFunctions: {} };
        calc = extractEffects(template, settingsMap, ctx);
      }
    }

    // Strategy 5: Stat nodes — look up attributes.family in resolved templates
    if (kind === "stat_node" && !calc) {
      const family = entity.attributes?.family;
      if (family) {
        const template = resolvedTemplates.get(family);
        if (template) {
          const ctx = templateFileContext.get(family) || { aliases: {}, localFunctions: {} };
          calc = extractEffects(template, settingsMap, ctx);
        }
      }
    }

    // Sanitize calc metadata to match schema expectations
    if (calc) {
      sanitizeCalcMetadata(calc as AnyRecord);
    }

    // Apply calc to entity
    if (calc) {
      // Check if any effects have null magnitude (partial)
      const hasNullMagnitude = calc.effects?.some((e: AnyRecord) =>
        e.magnitude === null && e.magnitude_expr !== null
      );
      // Only update if there's actual data
      const hasData = (calc.effects && calc.effects.length > 0) ||
        (calc.tiers && calc.tiers.length > 0) ||
        (calc.buff_template_names && calc.buff_template_names.length > 0);
      if (hasData) {
        entity.calc = calc;
        modifiedFiles.add(entry.file);
        populated++;
        if (hasNullMagnitude) partial++;
      } else {
        zero++;
      }
    }
  }

  // -- Phase 7: Create buff entities ------------------------------------------
  const newBuffEntities: AnyRecord[] = [];
  const buffEntityFile = join(ENTITIES_ROOT, "shared-buffs.json");
  const existingBuffs = entityFileContents.get(buffEntityFile) || [];

  for (const [talentName, buffNames] of talentLinks) {
    // Find the talent entity to determine domain
    let talentEntity = null;
    for (const [, entry] of entityIndex) {
      if (entry.entity.internal_name === talentName && TALENT_KINDS.has(entry.entity.kind)) {
        talentEntity = entry.entity;
        break;
      }
    }
    if (!talentEntity) continue;

    for (const buffName of buffNames) {
      const buffId = `${talentEntity.domain}.buff.${buffName}`;
      // Skip if already in entity index
      if (entityIndex.has(buffId)) continue;
      // Skip if already created this run
      if (newBuffEntities.some((e) => e.id === buffId)) continue;

      // Extract calc from the resolved template if available
      let buffCalc: AnyRecord = {};
      const template = resolvedTemplates.get(buffName);
      if (template) {
        const ctx = templateFileContext.get(buffName) || { aliases: {}, localFunctions: {} };
        const extracted = extractEffects(template, settingsMap, ctx);
        sanitizeCalcMetadata(extracted);
        if (extracted.effects && extracted.effects.length > 0) {
          buffCalc = extracted;
        }
      }

      const buffEntity = {
        id: buffId,
        kind: "buff",
        domain: talentEntity.domain,
        internal_name: buffName,
        loc_key: null,
        ui_name: null,
        status: "source_backed",
        refs: [],
        source_snapshot_id: snapshotId,
        attributes: {},
        calc: buffCalc,
      };

      newBuffEntities.push(buffEntity);
      entityIndex.set(buffId, {
        entity: buffEntity,
        file: buffEntityFile,
        index: existingBuffs.length + newBuffEntities.length - 1,
      });
    }
  }

  // Merge new buff entities into the file content
  if (newBuffEntities.length > 0) {
    const existing = entityFileContents.get(buffEntityFile) || [];
    const merged = [...existing, ...newBuffEntities];
    entityFileContents.set(buffEntityFile, merged);
    modifiedFiles.add(buffEntityFile);
  }

  // -- Phase 8: Write updated entity files ------------------------------------
  for (const filePath of modifiedFiles) {
    const records = entityFileContents.get(filePath as string);
    writeFileSync(filePath as string, JSON.stringify(records, null, 2) + "\n");
  }

  // -- Phase 9: Generate grants_buff edges ------------------------------------
  /** @type {Map<string, object[]>} domain → edge records */
  const newEdgesByDomain = new Map();

  for (const [talentName, buffNames] of talentLinks) {
    // Find the talent entity
    let talentEntity = null;
    for (const [, entry] of entityIndex) {
      if (entry.entity.internal_name === talentName && TALENT_KINDS.has(entry.entity.kind)) {
        talentEntity = entry.entity;
        break;
      }
    }
    if (!talentEntity) continue;

    for (const buffName of buffNames) {
      const buffId = `${talentEntity.domain}.buff.${buffName}`;

      // Only create edge if both entities exist
      if (!entityIndex.has(talentEntity.id) || !entityIndex.has(buffId)) continue;

      const edgeId = `${talentEntity.id}--grants_buff--${buffId}`;
      const edge = {
        id: edgeId,
        type: "grants_buff",
        from_entity_id: talentEntity.id,
        to_entity_id: buffId,
        source_snapshot_id: snapshotId,
        conditions: {
          predicates: [],
          aggregation: "additive",
          stacking_mode: "binary",
          exclusive_scope: null,
        },
        calc: {},
        evidence_ids: [],
      };

      const domain = talentEntity.domain;
      if (!newEdgesByDomain.has(domain)) {
        newEdgesByDomain.set(domain, []);
      }
      newEdgesByDomain.get(domain).push(edge);
    }
  }

  // -- Phase 10: Write edge files ---------------------------------------------
  let totalEdges = 0;

  for (const [domain, newEdges] of newEdgesByDomain) {
    const edgeFile = join(EDGES_ROOT, `${domain}.json`);
    let existing = [];
    try {
      existing = JSON.parse(readFileSync(edgeFile, "utf8"));
    } catch {
      // File may not exist yet — start empty
    }

    // Filter out existing grants_buff edges for idempotent re-runs
    const filtered = existing.filter((e: AnyRecord) => e.type !== "grants_buff");
    const merged = [...filtered, ...newEdges];
    writeFileSync(edgeFile, JSON.stringify(merged, null, 2) + "\n");
    totalEdges += newEdges.length;
  }

  // -- Phase 11: Report summary -----------------------------------------------
  console.log(`Populated: ${populated}, Partial: ${partial}, Zero: ${zero}`);
  console.log(`Created ${newBuffEntities.length} new buff entities`);
  console.log(`Generated ${totalEdges} grants_buff edges`);
});

// -- Helpers ------------------------------------------------------------------

/**
 * Sanitize calc metadata fields to match the calc schema.
 *
 * Fields like `active_duration`, `duration`, `max_stacks` may be $ref objects
 * if the underlying Lua value was an unresolvable reference. The schema
 * requires these to be number|null, so we coerce non-numeric values to null.
 *
 * `class_name` must be string|null.
 *
 * @param {object} calc - The calc object to sanitize in place.
 */
function sanitizeCalcMetadata(calc: AnyRecord) {
  for (const field of ["active_duration", "duration"]) {
    if (field in calc && typeof calc[field] !== "number") {
      calc[field] = null;
    }
  }
  if ("max_stacks" in calc && typeof calc.max_stacks !== "number") {
    calc.max_stacks = null;
  }
  if ("class_name" in calc && typeof calc.class_name !== "string") {
    calc.class_name = null;
  }

  // Remove empty effects arrays (schema requires minItems: 1 if present)
  if (Array.isArray(calc.effects) && calc.effects.length === 0) {
    delete calc.effects;
  }

  // Sanitize effect numeric fields — $ref/$expr objects must become null
  if (Array.isArray(calc.effects)) {
    for (const eff of calc.effects) {
      for (const field of ["magnitude", "magnitude_min", "magnitude_max"]) {
        if (field in eff && eff[field] !== null && typeof eff[field] !== "number") {
          // Preserve the expression as magnitude_expr if not already set
          if (!eff.magnitude_expr && eff[field]?.$expr) {
            eff.magnitude_expr = eff[field].$expr;
          } else if (!eff.magnitude_expr && eff[field]?.$ref) {
            eff.magnitude_expr = eff[field].$ref;
          }
          eff[field] = null;
        }
      }
    }
  }

  // Also sanitize tier metadata and tier effects
  if (Array.isArray(calc.tiers)) {
    for (const tier of calc.tiers) {
      for (const field of ["active_duration", "duration", "child_duration"]) {
        if (field in tier && typeof tier[field] !== "number") {
          tier[field] = null;
        }
      }
      if ("max_stacks" in tier && typeof tier.max_stacks !== "number") {
        tier.max_stacks = null;
      }
      if (Array.isArray(tier.effects)) {
        for (const eff of tier.effects) {
          for (const field of ["magnitude", "magnitude_min", "magnitude_max"]) {
            if (field in eff && eff[field] !== null && typeof eff[field] !== "number") {
              if (!eff.magnitude_expr && eff[field]?.$expr) {
                eff.magnitude_expr = eff[field].$expr;
              } else if (!eff.magnitude_expr && eff[field]?.$ref) {
                eff.magnitude_expr = eff[field].$ref;
              }
              eff[field] = null;
            }
          }
        }
      }
    }
  }
}

/**
 * Collect all buff template Lua files from the source root.
 * @param {string} sourceRoot
 * @returns {string[]}
 */
function collectBuffTemplateFiles(sourceRoot: string) {
  const files = [];
  const buffDir = join(sourceRoot, "scripts", "settings", "buff");

  // Archetype buff templates
  const archetypeDir = join(buffDir, "archetype_buff_templates");
  for (const f of readdirSync(archetypeDir).filter((f) => f.endsWith(".lua")).sort()) {
    files.push(join(archetypeDir, f));
  }

  // Weapon traits buff templates
  const weaponTraitsDir = join(buffDir, "weapon_traits_buff_templates");
  for (const f of readdirSync(weaponTraitsDir).filter((f) => f.endsWith(".lua")).sort()) {
    files.push(join(weaponTraitsDir, f));
  }

  // Top-level buff files
  for (const name of [
    "gadget_buff_templates.lua",
    "player_buff_templates.lua",
    "common_buff_templates.lua",
    "weapon_buff_templates.lua",
  ]) {
    const p = join(buffDir, name);
    if (existsSync(p)) {
      files.push(p);
    }
  }

  return files;
}
