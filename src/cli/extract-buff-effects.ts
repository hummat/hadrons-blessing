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
import type { LuaValue, TemplateBlock } from "../lib/lua-data-reader.js";
import {
  extractEffects,
  extractTiers,
  resolveTemplateChain,
  extractTalentBuffLinks,
} from "../lib/buff-semantic-parser.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;
type TemplateContext = {
  aliases: Record<string, string>;
  localFunctions: Record<string, string>;
  localScalars: Record<string, LuaValue>;
};

const EMPTY_TEMPLATE_CONTEXT: TemplateContext = {
  aliases: {},
  localFunctions: {},
  localScalars: {},
};
const TIER_METADATA_FIELDS = ["active_duration", "child_duration", "max_stacks", "duration"] as const;

await runCliMain("effects:build", async () => {
  const snapshot = validateSourceSnapshot();
  const sourceRoot = snapshot.source_root;
  const snapshotId = snapshot.id;

  // -- Phase 1: Load TalentSettings ------------------------------------------
  const settingsMap = await loadAllTalentSettings(sourceRoot);
  console.log(`Loaded ${settingsMap.size} TalentSettings entries`);

  // -- Phase 2: Load + resolve buff templates --------------------------------
  const allBlocks = [];
  const templateFileContext = new Map<string, TemplateContext>();
  let baseWeaponTraitTemplateBlocks: TemplateBlock[] = [];
  let baseWeaponTraitTemplateContext: TemplateContext = EMPTY_TEMPLATE_CONTEXT;

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
    const { blocks, aliases, localFunctions, localScalars } = result;
    const ctx: TemplateContext = { aliases, localFunctions, localScalars };
    if (basename(filePath) === "base_weapon_trait_buff_templates.lua") {
      baseWeaponTraitTemplateBlocks = blocks;
      baseWeaponTraitTemplateContext = ctx;
    }
    for (const block of blocks) {
      allBlocks.push(block);
      templateFileContext.set(block.name, ctx);
    }
  }

  const externalTemplates = buildBaseWeaponTraitExternalTemplates(baseWeaponTraitTemplateBlocks);
  const externalTemplateContexts = buildBaseWeaponTraitExternalTemplateContexts(
    baseWeaponTraitTemplateBlocks,
    baseWeaponTraitTemplateContext,
  );
  const resolvedTemplates = resolveTemplateChain(allBlocks, externalTemplates);
  const resolvedTemplateContext = buildResolvedTemplateContexts(
    allBlocks,
    templateFileContext,
    externalTemplateContexts,
  );
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

  // -- Phase 4: Load weapon perk buff blocks ---------------------------------
  const weaponPerkBuffs = new Map();
  for (const file of ["weapon_perks_melee.lua", "weapon_perks_ranged.lua"]) {
    const luaSource = readFileSync(join(sourceRoot, "scripts", "settings", "equipment", "weapon_traits", file), "utf8");
    let result;
    try {
      result = extractTemplateBlocks(luaSource);
    } catch (err: unknown) {
      console.warn(`Warning: skipping weapon perk file ${file} — ${(err as Error).message}`);
      continue;
    }

    const ctx: TemplateContext = {
      aliases: result.aliases,
      localFunctions: result.localFunctions,
      localScalars: result.localScalars,
    };
    for (const block of result.blocks) {
      const parsed = block.parsed as AnyRecord | null;
      if (!parsed || typeof parsed !== "object") continue;
      if (!parsed.buffs || typeof parsed.buffs !== "object") continue;

      const buffEntries = [];
      for (const [buffName, tierArray] of Object.entries(parsed.buffs)) {
        if (!Array.isArray(tierArray) || tierArray.length === 0) continue;
        const tiers = tierArray.filter((tier) => tier && typeof tier === "object" && !Array.isArray(tier));
        if (tiers.length === 0) continue;
        buffEntries.push({ buffName, tiers });
      }

      if (buffEntries.length > 0) {
        weaponPerkBuffs.set(block.name, { buffEntries, ctx });
      }
    }
  }

  // -- Phase 5: Load weapon trait tier data ----------------------------------
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

  // -- Phase 6: Load existing entity files -----------------------------------
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

  // -- Phase 7: Match and populate calc fields --------------------------------
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
        const mergedCalc: AnyRecord = { effects: [], buff_template_names: [...buffNames] };
        let mergedMeta: AnyRecord = {};
        for (const bn of buffNames) {
          const template = resolvedTemplates.get(bn);
          if (!template) continue;
          const ctx = resolvedTemplateContext.get(bn) ?? EMPTY_TEMPLATE_CONTEXT;
          const c = extractSemanticCalc(bn, template, settingsMap, ctx, resolvedTemplates, resolvedTemplateContext);
          mergeCalcResults(mergedCalc, c);
          // Carry metadata from last template that has it
          for (const key of ["class_name", "max_stacks", "duration", "active_duration", "keywords"]) {
            if ((c as AnyRecord)[key] !== undefined) mergedMeta[key] = (c as AnyRecord)[key];
          }
        }
        calc = hasCalcData(mergedCalc)
          ? { ...mergedCalc, ...mergedMeta }
          : { buff_template_names: buffNames };
      }
    }

    // Strategy 1b: Special-rule-only nodes with source-backed scalar effects.
    if (TALENT_KINDS.has(kind)) {
      const specialRuleCalc = buildSpecialRuleCalc(internalName, settingsMap);
      if (specialRuleCalc) {
        if (!calc) {
          calc = specialRuleCalc;
        } else {
          mergeCalcResults(calc, specialRuleCalc);
        }
      }
    }

    // Strategy 2: Weapon traits — look up internal_name directly in resolved templates
    if (kind === "weapon_trait" && !calc) {
      const template = resolvedTemplates.get(internalName);
      if (template) {
        const ctx = resolvedTemplateContext.get(internalName) ?? EMPTY_TEMPLATE_CONTEXT;
        calc = extractSemanticCalc(internalName, template, settingsMap, ctx, resolvedTemplates, resolvedTemplateContext);
      }
      // Add tier data if available
      const tiers = tierDataMap.get(internalName);
      if (tiers) {
        const tierCtx = resolvedTemplateContext.get(internalName) ?? EMPTY_TEMPLATE_CONTEXT;
        const baseTemplate = resolvedTemplates.get(internalName);
        const tierResult = buildSemanticTierResults(
          internalName,
          tiers,
          baseTemplate,
          settingsMap,
          tierCtx,
          resolvedTemplates,
          resolvedTemplateContext,
        );
        if (!calc) calc = {};
        calc.tiers = tierResult;
        if (tierResult.length > 0) {
          calc.effects = [...(tierResult[tierResult.length - 1].effects ?? [])];
        }
      }
    }

    // Strategy 3: Weapon perks — use authoritative buff blocks from weapon_perks_*.lua
    if (kind === "weapon_perk" && !calc) {
      const perkBuff = weaponPerkBuffs.get(internalName);
      if (perkBuff) {
        const mergedEffects = [];
        const mergedTiers: AnyRecord[] = [];
        let mergedMeta: AnyRecord = {};
        const buffTemplateNames = perkBuff.buffEntries.map((entry: AnyRecord) => entry.buffName);

        for (const { tiers } of perkBuff.buffEntries) {
          const extractedTiers = extractTiers(tiers, settingsMap, perkBuff.ctx);
          mergeTierResults(mergedTiers, extractedTiers);

          const maxTierTemplate = tiers[tiers.length - 1];
          const extracted = extractEffects(maxTierTemplate, settingsMap, perkBuff.ctx);
          mergedEffects.push(...(extracted.effects ?? []));
          for (const key of ["class_name", "max_stacks", "duration", "active_duration", "keywords"]) {
            if ((extracted as AnyRecord)[key] !== undefined) mergedMeta[key] = (extracted as AnyRecord)[key];
          }
        }

        calc = mergedEffects.length > 0 || mergedTiers.length > 0
          ? {
            effects: mergedEffects,
            tiers: mergedTiers,
            ...mergedMeta,
            buff_template_names: buffTemplateNames,
          }
          : {
            buff_template_names: buffTemplateNames,
          };
      } else {
      const template = resolvedTemplates.get(internalName);
      if (template) {
        const ctx = resolvedTemplateContext.get(internalName) ?? EMPTY_TEMPLATE_CONTEXT;
        calc = extractEffects(template, settingsMap, ctx);
      }
    }
    }

    // Strategy 4: Gadget traits — look up internal_name in resolved templates
    if (kind === "gadget_trait" && !calc) {
      const template = resolvedTemplates.get(internalName);
      if (template) {
        const ctx = resolvedTemplateContext.get(internalName) ?? EMPTY_TEMPLATE_CONTEXT;
        calc = extractSemanticCalc(internalName, template, settingsMap, ctx, resolvedTemplates, resolvedTemplateContext);
      }
    }

    // Strategy 5: Stat nodes — look up attributes.family in resolved templates
    if (kind === "stat_node" && !calc) {
      const family = entity.attributes?.family;
      if (family) {
        const template = resolvedTemplates.get(family);
        if (template) {
          const ctx = resolvedTemplateContext.get(family) ?? EMPTY_TEMPLATE_CONTEXT;
          calc = extractSemanticCalc(family, template, settingsMap, ctx, resolvedTemplates, resolvedTemplateContext);
        }
      }
    }

    // Strategy 6: Existing buff entities — refresh from their source template
    if (kind === "buff" && !calc) {
      const template = resolvedTemplates.get(internalName);
      if (template) {
        const ctx = resolvedTemplateContext.get(internalName) ?? EMPTY_TEMPLATE_CONTEXT;
        calc = extractSemanticCalc(internalName, template, settingsMap, ctx, resolvedTemplates, resolvedTemplateContext);
        calc.buff_template_names = [internalName];
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

  // -- Phase 8: Create buff entities ------------------------------------------
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
        const ctx = resolvedTemplateContext.get(buffName) ?? EMPTY_TEMPLATE_CONTEXT;
        const extracted = extractSemanticCalc(buffName, template, settingsMap, ctx, resolvedTemplates, resolvedTemplateContext);
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

  // -- Phase 9: Write updated entity files ------------------------------------
  for (const filePath of modifiedFiles) {
    const records = entityFileContents.get(filePath as string);
    writeFileSync(filePath as string, JSON.stringify(records, null, 2) + "\n");
  }

  // -- Phase 10: Generate grants_buff edges -----------------------------------
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

  // -- Phase 11: Write edge files ---------------------------------------------
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

  // -- Phase 12: Report summary -----------------------------------------------
  console.log(`Populated: ${populated}, Partial: ${partial}, Zero: ${zero}`);
  console.log(`Created ${newBuffEntities.length} new buff entities`);
  console.log(`Generated ${totalEdges} grants_buff edges`);
});

// -- Helpers ------------------------------------------------------------------

function buildBaseWeaponTraitExternalTemplates(blocks: TemplateBlock[]): Map<string, Record<string, LuaValue>> {
  if (blocks.length === 0) {
    return new Map();
  }

  const resolved = resolveTemplateChain(blocks);
  const external = new Map<string, Record<string, LuaValue>>();
  for (const [name, template] of resolved) {
    external.set(`BaseWeaponTraitBuffTemplates.${name}`, template);
  }
  return external;
}

function buildBaseWeaponTraitExternalTemplateContexts(
  blocks: TemplateBlock[],
  ctx: TemplateContext,
): Map<string, TemplateContext> {
  const external = new Map<string, TemplateContext>();
  for (const block of blocks) {
    external.set(`BaseWeaponTraitBuffTemplates.${block.name}`, ctx);
  }
  return external;
}

function buildResolvedTemplateContexts(
  blocks: TemplateBlock[],
  templateFileContext: Map<string, TemplateContext>,
  externalTemplateContexts: Map<string, TemplateContext> = new Map(),
): Map<string, TemplateContext> {
  const blockMap = new Map<string, TemplateBlock>();
  for (const block of blocks) {
    blockMap.set(block.name, block);
  }

  const resolved = new Map<string, TemplateContext>();
  const resolving = new Set<string>();

  const mergeContexts = (base: TemplateContext, own: TemplateContext): TemplateContext => ({
    aliases: { ...base.aliases, ...own.aliases },
    localFunctions: { ...base.localFunctions, ...own.localFunctions },
    localScalars: { ...base.localScalars, ...own.localScalars },
  });

  const resolveContext = (name: string): TemplateContext => {
    if (resolved.has(name)) {
      return resolved.get(name)!;
    }
    if (externalTemplateContexts.has(name)) {
      return externalTemplateContexts.get(name)!;
    }

    const own = templateFileContext.get(name) ?? EMPTY_TEMPLATE_CONTEXT;
    const block = blockMap.get(name);
    if (!block || resolving.has(name)) {
      resolved.set(name, own);
      return own;
    }

    resolving.add(name);
    let merged = own;

    if (block.type === "clone" && block.cloneSource) {
      const base = resolveContext(block.cloneSource);
      merged = mergeContexts(base, own);
    } else if (block.type === "merge" && block.mergeBase) {
      const base = resolveContext(block.mergeBase);
      merged = mergeContexts(base, own);
    }

    resolving.delete(name);
    resolved.set(name, merged);
    return merged;
  };

  for (const block of blocks) {
    resolveContext(block.name);
  }

  return resolved;
}

function buildSemanticTierResults(
  templateName: string,
  tierArray: AnyRecord[],
  baseTemplate: AnyRecord | undefined,
  settingsMap: Map<string, number>,
  ctx: TemplateContext,
  resolvedTemplates: Map<string, AnyRecord>,
  templateFileContext: Map<string, TemplateContext>,
): AnyRecord[] {
  return tierArray.map((tierObj) => {
    const mergedTemplate = baseTemplate ? deepMergeRecords(baseTemplate, tierObj) : deepClone(tierObj);
    const calc = extractSemanticCalc(
      templateName,
      mergedTemplate,
      settingsMap,
      ctx,
      resolvedTemplates,
      templateFileContext,
    );
    const tier: AnyRecord = {
      effects: [...(calc.effects ?? [])],
    };
    for (const field of TIER_METADATA_FIELDS) {
      if (mergedTemplate[field] !== undefined) {
        tier[field] = mergedTemplate[field];
      }
    }
    return tier;
  });
}

function extractSemanticCalc(
  templateName: string,
  template: AnyRecord,
  settingsMap: Map<string, number>,
  ctx: TemplateContext,
  resolvedTemplates: Map<string, AnyRecord>,
  templateFileContext: Map<string, TemplateContext>,
  seen = new Set<string>(),
): AnyRecord {
  if (seen.has(templateName)) {
    return {};
  }

  const nextSeen = new Set(seen);
  nextSeen.add(templateName);

  const calc = extractEffects(template, settingsMap, ctx) as AnyRecord;
  calc.effects = [...(calc.effects ?? [])];
  const trigger = extractPrimaryTrigger(template);

  applyTemplateConditionOverrides(calc, template);

  mergeCalcResults(calc, extractKeywordCalc(template));
  mergeCalcResults(calc, extractAmmoReplenishmentCalc(template, settingsMap, ctx, trigger));
  mergeCalcResults(calc, extractAbilityChargeCalc(template, settingsMap, ctx, trigger));
  mergeCalcResults(calc, extractAmmoToClipCalc(template, settingsMap, ctx, trigger));
  mergeCalcResults(calc, extractOverheatReductionCalc(template, settingsMap, ctx, trigger));

  const childBuffName = typeof template.child_buff_template === "string"
    ? template.child_buff_template
    : null;
  if (childBuffName) {
    const childTemplate = resolvedTemplates.get(childBuffName);
    if (childTemplate) {
      const childCtx = templateFileContext.get(childBuffName) ?? EMPTY_TEMPLATE_CONTEXT;
      const childTemplateForCalc = template.overheat_reduction !== undefined && childTemplate.overheat_reduction === undefined
        ? { ...deepClone(childTemplate), overheat_reduction: template.overheat_reduction }
        : childTemplate;
      const childCalc = extractSemanticCalc(
        childBuffName,
        childTemplateForCalc,
        settingsMap,
        childCtx,
        resolvedTemplates,
        templateFileContext,
        nextSeen,
      );
      mergeCalcResults(calc, { ...childCalc, effects: inheritEffectContext(childCalc.effects ?? [], { trigger }) });
    }
  }

  const targetBuffData = asRecord(template.target_buff_data);
  if (targetBuffData) {
    const targetBuffName = resolveTargetBuffName(templateName, targetBuffData);
    if (targetBuffName) {
      const targetTemplate = resolvedTemplates.get(targetBuffName);
      if (targetTemplate) {
        const targetCtx = templateFileContext.get(targetBuffName) ?? EMPTY_TEMPLATE_CONTEXT;
        const targetCalc = extractSemanticCalc(
          targetBuffName,
          targetTemplate,
          settingsMap,
          targetCtx,
          resolvedTemplates,
          templateFileContext,
          nextSeen,
        );
        const stackCount = resolveTargetBuffStackCount(targetBuffData, settingsMap, ctx);
        mergeCalcResults(calc, {
          ...targetCalc,
          effects: inheritEffectContext(scaleEffects(targetCalc.effects ?? [], stackCount), { trigger }),
        });
      }
    }
  }

  for (const internallyControlled of extractInternallyControlledBuffNames(template)) {
    const internalTemplate = resolvedTemplates.get(internallyControlled);
    if (!internalTemplate) continue;
    const internalCtx = templateFileContext.get(internallyControlled) ?? EMPTY_TEMPLATE_CONTEXT;
    const internalCalc = extractSemanticCalc(
      internallyControlled,
      internalTemplate,
      settingsMap,
      internalCtx,
      resolvedTemplates,
      templateFileContext,
      nextSeen,
    );
    mergeCalcResults(calc, {
      ...internalCalc,
      effects: inheritEffectContext(internalCalc.effects ?? [], { trigger }),
    });
  }

  return calc;
}

function applyTemplateConditionOverrides(calc: AnyRecord, template: AnyRecord) {
  if (!Array.isArray(calc.effects) || calc.effects.length === 0) {
    return;
  }

  const updateFunc = template.update_func;
  if (!(updateFunc && typeof updateFunc === "object" && typeof updateFunc.$func === "string")) {
    return;
  }

  if (!updateFunc.$func.includes("_is_in_weapon_alternate_fire_with_stamina(")) {
    return;
  }

  for (const effect of calc.effects) {
    if (!String(effect.type ?? "").startsWith("conditional_")) {
      continue;
    }
    if (effect.condition === "active" || effect.condition === "active_and_unknown" || effect.condition === "unknown_condition") {
      effect.condition = "ads_with_stamina";
    }
  }
}

function mergeCalcResults(target: AnyRecord, incoming: AnyRecord | null | undefined) {
  if (!incoming) return;

  appendUniqueEffects(target, incoming.effects ?? []);

  for (const key of ["class_name", "max_stacks", "duration", "active_duration"]) {
    if (incoming[key] !== undefined) {
      target[key] = incoming[key];
    }
  }

  if (Array.isArray(incoming.keywords) && incoming.keywords.length > 0) {
    target.keywords = [...new Set([...(target.keywords ?? []), ...incoming.keywords])];
  }

  if (Array.isArray(incoming.buff_template_names) && incoming.buff_template_names.length > 0) {
    target.buff_template_names = [...new Set([...(target.buff_template_names ?? []), ...incoming.buff_template_names])];
  }
}

function appendUniqueEffects(target: AnyRecord, effects: AnyRecord[]) {
  if (!Array.isArray(effects) || effects.length === 0) return;
  const current = Array.isArray(target.effects) ? target.effects : [];
  const seen = new Set(current.map((effect: AnyRecord) => JSON.stringify(effect)));
  for (const effect of effects) {
    const key = JSON.stringify(effect);
    if (seen.has(key)) continue;
    current.push(effect);
    seen.add(key);
  }
  target.effects = current;
}

function hasCalcData(calc: AnyRecord): boolean {
  return (Array.isArray(calc.effects) && calc.effects.length > 0)
    || (Array.isArray(calc.tiers) && calc.tiers.length > 0)
    || (Array.isArray(calc.buff_template_names) && calc.buff_template_names.length > 0);
}

function extractKeywordCalc(template: AnyRecord): AnyRecord | null {
  const keywords = [
    ...extractKeywordNames(template.keywords),
    ...extractKeywordNames(template.conditional_keywords),
  ];
  if (!keywords.includes("count_as_dodge_vs_ranged")) {
    return null;
  }

  return {
    effects: [
      // Keep the family/linkage signal without pretending a boolean keyword is a +100% scalar bonus.
      makeSyntheticEffect("count_as_dodge_vs_ranged", 0, null, "stat_buff"),
    ],
  };
}

function extractAmmoReplenishmentCalc(
  template: AnyRecord,
  settingsMap: Map<string, number>,
  ctx: TemplateContext,
  trigger: string | null,
): AnyRecord | null {
  for (const body of getTemplateFunctionBodies(template)) {
    const match = body.match(/Ammo\.add_to_all_slots\([^,]+,\s*([A-Za-z0-9_\.]+)\)/);
    if (!match) continue;
    const amount = resolveNumericLuaValue(match[1], settingsMap, ctx, body);
    if (amount == null) continue;
    return {
      effects: [
        makeSyntheticEffect("ammo_replenishment_percent", amount, trigger, "proc_stat_buff"),
      ],
    };
  }
  return null;
}

function extractAbilityChargeCalc(
  template: AnyRecord,
  settingsMap: Map<string, number>,
  ctx: TemplateContext,
  trigger: string | null,
): AnyRecord | null {
  for (const body of getTemplateFunctionBodies(template)) {
    const match = body.match(/restore_ability_charge\(\s*([^,]+)\s*,\s*([^)]+)\)/);
    if (!match) continue;
    const abilityType = resolveStringLuaValue(match[1], ctx, body);
    if (abilityType !== "grenade_ability") continue;
    const amount = resolveNumericLuaValue(match[2], settingsMap, ctx, body);
    if (amount == null) continue;
    return {
      effects: [
        makeSyntheticEffect("grenade_charge_restored", amount, trigger, "proc_stat_buff"),
      ],
    };
  }
  return null;
}

function extractAmmoToClipCalc(
  template: AnyRecord,
  settingsMap: Map<string, number>,
  ctx: TemplateContext,
  trigger: string | null,
): AnyRecord | null {
  const hasAmmoMoveProc = getTemplateFunctionBodies(template).some((body) => body.includes("Ammo.set_current_ammo_in_clips"));
  if (!hasAmmoMoveProc) {
    return null;
  }
  const amount = resolveNumericLuaValue(template.num_ammmo_to_move, settingsMap, ctx);
  if (amount == null) {
    return null;
  }
  return {
    effects: [
      makeSyntheticEffect("ammo_to_clip_on_crit", amount, trigger, "proc_stat_buff"),
    ],
  };
}

function extractOverheatReductionCalc(
  template: AnyRecord,
  settingsMap: Map<string, number>,
  ctx: TemplateContext,
  trigger: string | null,
): AnyRecord | null {
  const hasImmediateOverheatProc = getTemplateFunctionBodies(template).some((body) => body.includes("Overheat.decrease_immediate"));
  if (!hasImmediateOverheatProc) {
    return null;
  }
  const amount = resolveNumericLuaValue(template.overheat_reduction, settingsMap, ctx);
  if (amount == null) {
    return null;
  }
  return {
    effects: [
      makeSyntheticEffect("overheat_immediate_reduction", amount, trigger, "proc_stat_buff"),
    ],
  };
}

function extractInternallyControlledBuffNames(template: AnyRecord): string[] {
  const names = new Set<string>();
  for (const body of getTemplateFunctionBodies(template)) {
    for (const match of body.matchAll(/add_internally_controlled_buff(?:_with_stacks)?\(\s*["']([^"']+)["']/g)) {
      names.add(match[1]);
    }
  }
  return [...names];
}

function getTemplateFunctionBodies(template: AnyRecord): string[] {
  const bodies: string[] = [];
  for (const key of [
    "proc_func",
    "start_func",
    "update_func",
    "interval_func",
    "stop_func",
    "duration_func",
  ]) {
    const fn = template[key];
    if (fn && typeof fn === "object" && typeof fn.$func === "string") {
      bodies.push(fn.$func);
    }
  }
  return bodies;
}

function extractPrimaryTrigger(template: AnyRecord): string | null {
  const procEvents = asRecord(template.proc_events);
  if (!procEvents) return null;
  const key = Object.keys(procEvents)[0];
  if (!key) return null;
  return key.startsWith("proc_events.") ? key.slice("proc_events.".length) : key;
}

function extractKeywordNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (entry && typeof entry === "object" && typeof (entry as { $ref?: string }).$ref === "string") {
      const ref = (entry as { $ref: string }).$ref;
      return [ref.startsWith("keywords.") ? ref.slice("keywords.".length) : ref];
    }
    return [];
  });
}

function resolveStringLuaValue(value: unknown, ctx: TemplateContext, funcBody?: string): string | null {
  const resolved = resolveLuaValue(value, ctx, funcBody);
  return typeof resolved === "string" ? resolved : null;
}

function resolveNumericLuaValue(
  value: unknown,
  settingsMap: Map<string, number>,
  ctx: TemplateContext,
  funcBody?: string,
): number | null {
  const resolved = resolveLuaValue(value, ctx, funcBody);
  if (typeof resolved === "number") {
    return resolved;
  }
  if (resolved && typeof resolved === "object" && "$ref" in resolved && typeof resolved.$ref === "string") {
    const ref = resolved.$ref;
    if (ref in ctx.localScalars) {
      return resolveNumericLuaValue(ctx.localScalars[ref], settingsMap, ctx, funcBody);
    }
    const resolvedAlias = resolveAliasRef(ref, ctx.aliases);
    return settingsMap.get(resolvedAlias) ?? null;
  }
  return null;
}

function resolveLuaValue(value: unknown, ctx: TemplateContext, funcBody?: string): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const token = value.trim();
  if (/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(token)) {
    return Number(token);
  }
  if ((token.startsWith("\"") && token.endsWith("\"")) || (token.startsWith("'") && token.endsWith("'"))) {
    return token.slice(1, -1);
  }
  if (token in ctx.localScalars) {
    return ctx.localScalars[token];
  }

  if (funcBody) {
    const localMatch = funcBody.match(new RegExp(`local\\s+${token}\\s*=\\s*([^\\n]+)`));
    if (localMatch) {
      return parseSimpleLuaValue(localMatch[1].trim());
    }
  }

  return { $ref: token };
}

function parseSimpleLuaValue(text: string): LuaValue {
  const trimmed = text.trim().replace(/,$/, "");
  if (/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) {
    return Number(trimmed);
  }
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "nil") return null;
  return { $ref: trimmed };
}

function resolveAliasRef(ref: string, aliases: Record<string, string>): string {
  for (const [alias, namespace] of Object.entries(aliases)) {
    if (ref.startsWith(`${alias}.`)) {
      return `${namespace}${ref.slice(alias.length)}`;
    }
  }
  return ref;
}

function scaleEffects(effects: AnyRecord[], factor: number): AnyRecord[] {
  return effects.map((effect) => {
    const scaled = { ...effect };
    for (const field of ["magnitude", "magnitude_min", "magnitude_max"]) {
      if (typeof scaled[field] === "number") {
        scaled[field] *= factor;
      }
    }
    return scaled;
  });
}

function resolveTargetBuffStackCount(
  targetBuffData: AnyRecord,
  settingsMap: Map<string, number>,
  ctx: TemplateContext,
): number {
  if (Array.isArray(targetBuffData.threshold_num_stacks_on_proc)) {
    let maxStacks = 1;
    for (const entry of targetBuffData.threshold_num_stacks_on_proc) {
      const record = asRecord(entry);
      if (!record) continue;
      const count = resolveNumericLuaValue(record.num_stacks, settingsMap, ctx);
      if (count != null) {
        maxStacks = Math.max(maxStacks, count);
      }
    }
    return maxStacks;
  }

  const directCount = resolveNumericLuaValue(targetBuffData.num_stacks_on_proc, settingsMap, ctx);
  if (directCount != null) {
    return directCount;
  }

  return 1;
}

function resolveTargetBuffName(templateName: string, targetBuffData: AnyRecord): string | null {
  if (typeof targetBuffData.internal_buff_name === "string") {
    return targetBuffData.internal_buff_name;
  }

  // The live lasgun charged-shot parent keeps the threshold stack override in the
  // equipment-tier table, but the inherited `internal_buff_name = "rending_debuff"`
  // is dropped by the current Lua block parser for the base template. Keep the
  // fix scoped to the known source-backed path instead of guessing broadly.
  if (
    Array.isArray(targetBuffData.threshold_num_stacks_on_proc)
    && templateName === "weapon_trait_bespoke_lasgun_p2_targets_receive_rending_debuff_on_charged_shots"
  ) {
    return "rending_debuff";
  }

  return null;
}

function inheritEffectContext(
  effects: AnyRecord[],
  defaults: { trigger?: string | null; condition?: string | null },
): AnyRecord[] {
  return effects.map((effect) => ({
    ...effect,
    trigger: effect.trigger ?? defaults.trigger ?? null,
    condition: effect.condition ?? defaults.condition ?? null,
  }));
}

function makeSyntheticEffect(
  stat: string,
  magnitude: number,
  trigger: string | null,
  type: string,
): AnyRecord {
  return {
    stat,
    magnitude,
    magnitude_expr: null,
    magnitude_min: null,
    magnitude_max: null,
    condition: null,
    trigger,
    type,
  };
}

function asRecord(value: unknown): AnyRecord | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as AnyRecord
    : null;
}

function isPlainObject(value: unknown): value is AnyRecord {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function deepMergeRecords(base: AnyRecord, override: AnyRecord): AnyRecord {
  const output = deepClone(base);
  for (const [key, value] of Object.entries(override)) {
    const existing = output[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      output[key] = deepMergeRecords(existing, value);
    } else {
      output[key] = deepClone(value);
    }
  }
  return output;
}

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

function mergeTierResults(target: AnyRecord[], incoming: AnyRecord[]) {
  for (let i = 0; i < incoming.length; i++) {
    const tier = incoming[i];
    if (!target[i]) {
      target[i] = {
        ...tier,
        effects: [...(tier.effects ?? [])],
      };
      continue;
    }

    target[i].effects = [...(target[i].effects ?? []), ...(tier.effects ?? [])];
    for (const [key, value] of Object.entries(tier)) {
      if (key === "effects" || value === undefined) continue;
      target[i][key] = value;
    }
  }
}

function buildSpecialRuleCalc(internalName: string, settingsMap: Map<string, number>): AnyRecord | null {
  if (internalName === "psyker_increased_max_souls") {
    const maxSouls = settingsMap.get("psyker_2.offensive_2_1.max_souls_talent");
    if (typeof maxSouls === "number") {
      return {
        effects: [
          {
            stat: "max_souls",
            magnitude: maxSouls,
            magnitude_expr: null,
            magnitude_min: null,
            magnitude_max: null,
            condition: null,
            trigger: null,
            type: "stat_buff",
          },
        ],
      };
    }
  }

  if (internalName === "veteran_aura_gain_ammo_on_elite_kill_improved") {
    const ammoPercent = settingsMap.get("veteran_2.coherency.ammo_replenishment_percent_improved");
    if (typeof ammoPercent === "number") {
      return {
        effects: [
          {
            stat: "ammo_replenishment_percent",
            magnitude: ammoPercent,
            magnitude_expr: null,
            magnitude_min: null,
            magnitude_max: null,
            condition: null,
            trigger: "on_minion_death",
            type: "proc_stat_buff",
          },
        ],
      };
    }
  }

  return null;
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
