import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { assertValidCanonicalBuild } from "./build-shape.js";
import { loadJsonFile, REPO_ROOT } from "./load.js";
import {
  parseLuaTable,
  type LuaCall,
  type LuaRef,
  type LuaValue,
} from "./lua-data-reader.js";
import { contextValueMatches, normalizeText } from "./normalize.js";
import { classifyKnownUnresolved } from "./non-canonical.js";
import { loadGroundTruthRegistry } from "./registry.js";
import type {
  AliasSchemaJson,
  BuildSelectionSchemaJson,
  CanonicalBuildSchemaJson,
  EdgeSchemaJson,
  EntityBaseSchemaJson,
} from "../generated/schema-types.js";

export const DEFAULT_BETTERBOTS_PROFILE_PATH = join(
  REPO_ROOT,
  "..",
  "BetterBots",
  "scripts",
  "mods",
  "BetterBots",
  "bot_profiles.lua",
);
export const DEFAULT_BOT_BUILD_DIR = join(REPO_ROOT, "data", "builds", "bot");
export const DEFAULT_BOT_WEAPON_EXPORT_PATH = join(
  REPO_ROOT,
  "data",
  "exports",
  "bot-weapon-recommendations.json",
);
export const DEFAULT_CLASS_TREE_MANIFEST_PATH = join(
  REPO_ROOT,
  "data",
  "ground-truth",
  "generated",
  "class-tree-manifest.json",
);
export const BOT_BUILD_SLUGS = [
  "bot-veteran",
  "bot-zealot",
  "bot-psyker",
  "bot-ogryn",
] as const;

const BETTERBOTS_SOURCE_URL = "https://github.com/hummat/BetterBots";
const LUA_TABLE_NAME = "DEFAULT_PROFILE_TEMPLATES";
const ALIAS_KIND_PRIORITY: Record<string, number> = {
  ui_name: 90,
  community_name: 80,
  gameslantern_name: 70,
  guide_name: 60,
  shorthand: 50,
  stale_name: 10,
  internal_name: 0,
  loc_key: 0,
};

type BetterBotsWeaponSlot = "melee" | "ranged";
type BetterBotsBuildSlot = "ability" | "blitz" | "aura" | "keystone" | "talents";

interface BetterBotsItemOverride {
  id: string;
  rarity: number | null;
  value: number | null;
}

interface BetterBotsCurioTemplate {
  name: string;
  masterItemId: string | null;
  traits: BetterBotsItemOverride[];
}

interface BetterBotsWeaponOverride {
  perks?: BetterBotsItemOverride[];
  traits?: BetterBotsItemOverride[];
}

export interface BetterBotsProfileTemplate {
  className: string;
  archetype: string;
  loadout: Record<BetterBotsWeaponSlot, string>;
  botGestalts: Record<BetterBotsWeaponSlot, string>;
  curios: BetterBotsCurioTemplate[];
  talents: string[];
  weaponOverrides: Partial<Record<BetterBotsWeaponSlot, BetterBotsWeaponOverride>>;
}

export interface BetterBotsWeaponExportEntry {
  template_id: string;
  display_name: string;
  canonical_entity_id: string;
  gestalt: string;
  source_builds: string[];
  bot_notes: string;
}

export interface BetterBotsWeaponExport {
  generated_at: string;
  schema_version: number;
  assumes: "betterbots";
  classes: Record<string, Record<BetterBotsWeaponSlot, BetterBotsWeaponExportEntry>>;
}

export interface BetterBotsArtifacts {
  builds: Record<string, CanonicalBuildSchemaJson>;
  weaponExport: BetterBotsWeaponExport;
}

interface GenerateBetterBotsArtifactsOptions {
  generatedAt?: string;
  sourceUrl?: string;
  author?: string;
}

interface WriteBetterBotsArtifactsOptions extends GenerateBetterBotsArtifactsOptions {
  buildDir?: string;
  exportPath?: string;
}

interface ManifestEntry {
  class: string;
  slot: BetterBotsBuildSlot;
  kind: string;
  internal_name: string;
  entity_id: string;
}

interface RegistryContext {
  entityById: Map<string, EntityBaseSchemaJson>;
  aliasesByEntityId: Map<string, AliasSchemaJson[]>;
  edgesByFromEntityId: Map<string, EdgeSchemaJson[]>;
  classManifestByClassInternal: Map<string, Map<string, ManifestEntry>>;
  gadgetTraitsByInternalName: Map<string, EntityBaseSchemaJson>;
  weaponByInternalName: Map<string, EntityBaseSchemaJson>;
  weaponPerksBySlotAndNormalizedKey: Map<string, EntityBaseSchemaJson[]>;
  weaponTraitsBySlotAndNormalizedKey: Map<string, EntityBaseSchemaJson[]>;
}

type ResolvedBuildSelection = BuildSelectionSchemaJson & {
  canonical_entity_id: string;
  resolution_status: "resolved";
};

interface BetterBotsTableFunction {
  params: string[];
  returnedTable: LuaValue;
}

interface BetterBotsHelperContext {
  stringConstants: Map<string, string>;
  tableFunctions: Map<string, BetterBotsTableFunction>;
}

function asRecord(value: LuaValue, label: string): Record<string, LuaValue> {
  if (value == null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`Expected ${label} to be a Lua table object`);
  }

  return value as Record<string, LuaValue>;
}

function asString(value: LuaValue, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Expected ${label} to be a non-empty string`);
  }

  return value;
}

function asOptionalNumber(value: LuaValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isLuaCall(value: LuaValue | undefined): value is LuaCall {
  return value != null && !Array.isArray(value) && typeof value === "object" && typeof (value as LuaCall).$call === "string";
}

function isLuaRef(value: LuaValue | undefined): value is LuaRef {
  return value != null && !Array.isArray(value) && typeof value === "object" && typeof (value as LuaRef).$ref === "string";
}

function getEntityAttributeString(entity: EntityBaseSchemaJson, key: string): string | null {
  const attributes = entity.attributes;
  if (attributes == null || typeof attributes !== "object") {
    return null;
  }

  const value = (attributes as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function getEntityCalcTiers(entity: EntityBaseSchemaJson): Array<{
  effects?: Array<{
    magnitude?: unknown;
  }>;
}> {
  const calc = entity.calc;
  if (calc == null || typeof calc !== "object") {
    return [];
  }

  const tiers = (calc as { tiers?: unknown }).tiers;
  return Array.isArray(tiers)
    ? tiers as Array<{
      effects?: Array<{
        magnitude?: unknown;
      }>;
    }>
    : [];
}

function findLuaTableLiteral(source: string, tableName: string): string {
  const marker = `local ${tableName}`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Could not find ${marker} in BetterBots source`);
  }

  const braceStart = source.indexOf("{", markerIndex + marker.length);
  if (braceStart === -1) {
    throw new Error(`Could not find opening brace for ${tableName}`);
  }

  let depth = 0;
  let i = braceStart;
  while (i < source.length) {
    const char = source[i];

    if (char === "\"" || char === "'") {
      i = findStringEnd(source, i, char) + 1;
      continue;
    }

    if (source.startsWith("--[[", i)) {
      const commentEnd = source.indexOf("]]", i + 4);
      if (commentEnd === -1) {
        throw new Error(`Unterminated block comment while reading ${tableName}`);
      }
      i = commentEnd + 2;
      continue;
    }

    if (source.startsWith("--", i)) {
      const newline = source.indexOf("\n", i + 2);
      if (newline === -1) {
        break;
      }
      i = newline + 1;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(braceStart, i + 1);
      }
    }

    i += 1;
  }

  throw new Error(`Unbalanced braces while reading ${tableName}`);
}

function findStringEnd(source: string, start: number, quote: string): number {
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === "\\" && i + 1 < source.length) {
      i += 1;
      continue;
    }
    if (source[i] === quote) {
      return i;
    }
  }

  throw new Error(`Unterminated Lua string literal at offset ${start}`);
}

function extractLocalStringConstants(source: string): Map<string, string> {
  const constants = new Map<string, string>();
  const pattern = /local\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(["'])(.*?)\2/gms;

  for (const match of source.matchAll(pattern)) {
    constants.set(match[1], match[3]);
  }

  return constants;
}

function findLocalFunctionSignature(source: string, functionName: string): { params: string[]; markerIndex: number } | null {
  const signature = new RegExp(`local\\s+function\\s+${functionName}\\s*\\(([^)]*)\\)`, "m");
  const match = signature.exec(source);
  if (!match || match.index == null) {
    return null;
  }

  const params = match[1]
    .split(",")
    .map((param) => param.trim())
    .filter((param) => param.length > 0);

  return {
    params,
    markerIndex: match.index,
  };
}

function findReturnedTableLiteral(source: string, functionName: string): { params: string[]; tableLiteral: string } | null {
  const signature = findLocalFunctionSignature(source, functionName);
  if (!signature) {
    return null;
  }

  const returnIndex = source.indexOf("return", signature.markerIndex);
  if (returnIndex === -1) {
    return null;
  }

  const braceStart = source.indexOf("{", returnIndex);
  if (braceStart === -1) {
    return null;
  }

  let depth = 0;
  let i = braceStart;
  while (i < source.length) {
    const char = source[i];

    if (char === "\"" || char === "'") {
      i = findStringEnd(source, i, char) + 1;
      continue;
    }

    if (source.startsWith("--[[", i)) {
      const commentEnd = source.indexOf("]]", i + 4);
      if (commentEnd === -1) {
        return null;
      }
      i = commentEnd + 2;
      continue;
    }

    if (source.startsWith("--", i)) {
      const newline = source.indexOf("\n", i + 2);
      if (newline === -1) {
        return null;
      }
      i = newline + 1;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          params: signature.params,
          tableLiteral: source.slice(braceStart, i + 1),
        };
      }
    }

    i += 1;
  }

  return null;
}

function buildBetterBotsHelperContext(source: string): BetterBotsHelperContext {
  const tableFunctions = new Map<string, BetterBotsTableFunction>();

  for (const functionName of ["_trait_override", "_perk_override", "_default_curio_entry"]) {
    const definition = findReturnedTableLiteral(source, functionName);
    if (!definition) {
      continue;
    }

    tableFunctions.set(functionName, {
      params: definition.params,
      returnedTable: parseLuaTable(definition.tableLiteral),
    });
  }

  return {
    stringConstants: extractLocalStringConstants(source),
    tableFunctions,
  };
}

function resolveBetterBotsHelperCall(
  call: LuaCall,
  context: BetterBotsHelperContext,
  bindings: Map<string, LuaValue>,
): LuaValue {
  const args = call.$args.map((arg) => resolveBetterBotsLuaValue(arg, context, bindings));

  if (call.$call === "_trait_id") {
    const [family, effectName] = args;
    if (typeof family === "string" && typeof effectName === "string") {
      return `content/items/traits/bespoke_${family}/${effectName}`;
    }
  }

  if (call.$call === "_perk_id") {
    const [category, perkName] = args;
    if (typeof category === "string" && typeof perkName === "string") {
      return `content/items/perks/${category}/${perkName}`;
    }
  }

  const tableFunction = context.tableFunctions.get(call.$call);
  if (!tableFunction) {
    return call;
  }

  const nextBindings = new Map(bindings);
  for (const [index, param] of tableFunction.params.entries()) {
    if (args[index] !== undefined) {
      nextBindings.set(param, args[index]);
    }
  }

  return resolveBetterBotsLuaValue(structuredClone(tableFunction.returnedTable), context, nextBindings);
}

function resolveBetterBotsLuaValue(
  value: LuaValue,
  context: BetterBotsHelperContext,
  bindings: Map<string, LuaValue> = new Map(),
): LuaValue {
  if (Array.isArray(value)) {
    return value.map((entry) => resolveBetterBotsLuaValue(entry, context, bindings));
  }

  if (isLuaCall(value)) {
    return resolveBetterBotsHelperCall(value, context, bindings);
  }

  if (isLuaRef(value)) {
    if (bindings.has(value.$ref)) {
      return bindings.get(value.$ref) as LuaValue;
    }
    if (context.stringConstants.has(value.$ref)) {
      return context.stringConstants.get(value.$ref) as string;
    }
    return value;
  }

  if (value != null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        resolveBetterBotsLuaValue(entryValue, context, bindings),
      ]),
    );
  }

  return value;
}

function parseItemOverrides(value: LuaValue | undefined): BetterBotsItemOverride[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => {
    const record = asRecord(entry, `override entry ${index}`);
    return {
      id: asString(record.id, `override entry ${index}.id`),
      rarity: asOptionalNumber(record.rarity),
      value: asOptionalNumber(record.value),
    };
  });
}

function parseWeaponOverrides(value: LuaValue | undefined): Partial<Record<BetterBotsWeaponSlot, BetterBotsWeaponOverride>> {
  if (value == null) {
    return {};
  }

  const record = asRecord(value, "weapon_overrides");
  const result: Partial<Record<BetterBotsWeaponSlot, BetterBotsWeaponOverride>> = {};

  for (const [slotKey, slot] of [
    ["slot_primary", "melee"],
    ["slot_secondary", "ranged"],
  ] as const) {
    const overrideValue = record[slotKey];
    if (overrideValue == null) {
      continue;
    }

    const overrideRecord = asRecord(overrideValue, `weapon_overrides.${slotKey}`);
    result[slot] = {
      perks: parseItemOverrides(overrideRecord.perks),
      traits: parseItemOverrides(overrideRecord.traits),
    };
  }

  return result;
}

function parseCurios(value: LuaValue | undefined): BetterBotsCurioTemplate[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => {
    const record = asRecord(entry, `curios[${index}]`);
    return {
      name: asString(record.name, `curios[${index}].name`),
      masterItemId: typeof record.master_item_id === "string" ? record.master_item_id : null,
      traits: parseItemOverrides(record.traits),
    };
  });
}

export function parseBetterBotsProfileTemplates(luaSource: string): Record<string, BetterBotsProfileTemplate> {
  const tableLiteral = findLuaTableLiteral(luaSource, LUA_TABLE_NAME);
  const helperContext = buildBetterBotsHelperContext(luaSource);
  const parsed = asRecord(
    resolveBetterBotsLuaValue(parseLuaTable(tableLiteral), helperContext),
    LUA_TABLE_NAME,
  );
  const profiles: Record<string, BetterBotsProfileTemplate> = {};

  for (const [className, rawProfile] of Object.entries(parsed)) {
    const profile = asRecord(rawProfile, `${LUA_TABLE_NAME}.${className}`);
    const loadout = asRecord(profile.loadout, `${className}.loadout`);
    const botGestalts = asRecord(profile.bot_gestalts, `${className}.bot_gestalts`);
    const talents = asRecord(profile.talents, `${className}.talents`);

    profiles[className] = {
      className,
      archetype: asString(profile.archetype, `${className}.archetype`),
      loadout: {
        melee: asString(loadout.slot_primary, `${className}.loadout.slot_primary`),
        ranged: asString(loadout.slot_secondary, `${className}.loadout.slot_secondary`),
      },
      botGestalts: {
        melee: asString(botGestalts.melee, `${className}.bot_gestalts.melee`),
        ranged: asString(botGestalts.ranged, `${className}.bot_gestalts.ranged`),
      },
      curios: parseCurios(profile.curios),
      talents: Object.entries(talents)
        .filter(([, enabled]) => enabled === 1 || enabled === true)
        .map(([internalName]) => internalName),
      weaponOverrides: parseWeaponOverrides(profile.weapon_overrides),
    };
  }

  return profiles;
}

export function loadBetterBotsProfileTemplates(
  profilePath: string = DEFAULT_BETTERBOTS_PROFILE_PATH,
): Record<string, BetterBotsProfileTemplate> {
  return parseBetterBotsProfileTemplates(readFileSync(profilePath, "utf8"));
}

function loadRegistryContext(): RegistryContext {
  const registry = loadGroundTruthRegistry();
  const entityById = new Map(registry.entities.map((entity) => [entity.id, entity]));
  const aliasesByEntityId = new Map<string, AliasSchemaJson[]>();
  const edgesByFromEntityId = new Map<string, EdgeSchemaJson[]>();

  for (const alias of registry.aliases) {
    if (!aliasesByEntityId.has(alias.candidate_entity_id)) {
      aliasesByEntityId.set(alias.candidate_entity_id, []);
    }
    aliasesByEntityId.get(alias.candidate_entity_id)!.push(alias);
  }

  for (const edge of registry.edges) {
    if (!edgesByFromEntityId.has(edge.from_entity_id)) {
      edgesByFromEntityId.set(edge.from_entity_id, []);
    }
    edgesByFromEntityId.get(edge.from_entity_id)!.push(edge);
  }

  const manifestEntries = loadJsonFile(DEFAULT_CLASS_TREE_MANIFEST_PATH) as ManifestEntry[];
  const classManifestByClassInternal = new Map<string, Map<string, ManifestEntry>>();
  for (const entry of manifestEntries) {
    if (!classManifestByClassInternal.has(entry.class)) {
      classManifestByClassInternal.set(entry.class, new Map());
    }
    classManifestByClassInternal.get(entry.class)!.set(entry.internal_name, entry);
  }

  const gadgetTraitsByInternalName = new Map<string, EntityBaseSchemaJson>();
  const weaponByInternalName = new Map<string, EntityBaseSchemaJson>();
  const weaponPerksBySlotAndNormalizedKey = new Map<string, EntityBaseSchemaJson[]>();
  const weaponTraitsBySlotAndNormalizedKey = new Map<string, EntityBaseSchemaJson[]>();

  for (const entity of registry.entities) {
    if (entity.kind === "gadget_trait" && typeof entity.internal_name === "string") {
      gadgetTraitsByInternalName.set(entity.internal_name, entity);
    }

    if (entity.kind === "weapon" && typeof entity.internal_name === "string") {
      weaponByInternalName.set(entity.internal_name, entity);
    }

    if (
      (entity.kind === "weapon_perk" || entity.kind === "weapon_trait") &&
      typeof entity.internal_name === "string"
    ) {
      const slot = getEntityAttributeString(entity, "slot") ?? "unknown";
      const key = `${slot}:${normalizedInternalName(entity.internal_name)}`;
      const targetMap = entity.kind === "weapon_perk"
        ? weaponPerksBySlotAndNormalizedKey
        : weaponTraitsBySlotAndNormalizedKey;

      if (!targetMap.has(key)) {
        targetMap.set(key, []);
      }
      targetMap.get(key)!.push(entity);
    }
  }

  return {
    entityById,
    aliasesByEntityId,
    edgesByFromEntityId,
    classManifestByClassInternal,
    gadgetTraitsByInternalName,
    weaponByInternalName,
    weaponPerksBySlotAndNormalizedKey,
    weaponTraitsBySlotAndNormalizedKey,
  };
}

function normalizedInternalName(value: string): string {
  return normalizeText(value)
    .split(" ")
    .map((token) => TOKEN_NORMALIZATION[token] ?? token)
    .join(" ");
}

const TOKEN_NORMALIZATION: Record<string, string> = {
  increase: "increase",
  increased: "increase",
  reduce: "reduce",
  reduced: "reduce",
  armoured: "armored",
  recieve: "receive",
  recieves: "receive",
  received: "receive",
  targets: "target",
};

const BETTERBOTS_WEAPON_MODIFIER_ID_ALIASES: Partial<
  Record<"weapon_perk" | "weapon_trait", Record<string, string[]>>
> = {
  weapon_perk: {
    wield_increase_elite_enemy_damage: ["increase_damage_elites", "ranged_increase_damage_elites"],
  },
  weapon_trait: {
    armor_rending_from_dot_burning: ["burned_targets_receive_rending_debuff"],
  },
};

const BETTERBOTS_INTERNAL_NAME_ALIASES: Record<string, Record<string, string>> = {
  zealot: {
    zealot_dash: "zealot_attack_speed_post_ability",
  },
};

const ENTITY_DISPLAY_LABEL_OVERRIDES: Record<string, string> = {
  gadget_innate_health_increase: "Health",
  gadget_innate_max_wounds_increase: "Wound(s)",
  gadget_innate_toughness_increase: "Toughness",
  gadget_stamina_increase: "Max Stamina",
};

const BETTERBOTS_CURIO_RAW_LABELS: Record<string, string> = {
  gadget_cooldown_reduction: "+1-4% Combat Ability Regeneration",
  gadget_damage_reduction_vs_gunners: "+5-20% Damage Resistance (Gunners)",
  gadget_innate_toughness_increase: "+13-17% Toughness",
  gadget_stamina_regeneration: "+6-12% Stamina Regeneration",
};

function classDisplayName(className: string): string {
  return className.charAt(0).toUpperCase() + className.slice(1);
}

function buildSlugForClass(className: string): string {
  return `bot-${className}`;
}

function entityDisplayLabel(
  entity: EntityBaseSchemaJson,
  context: Record<string, string>,
  registryContext: RegistryContext,
): string {
  if (typeof entity.ui_name === "string" && entity.ui_name.trim().length > 0) {
    return entity.ui_name;
  }

  const aliases = registryContext.aliasesByEntityId.get(entity.id) ?? [];
  const matching = aliases.filter((alias) => aliasMatchesContext(alias, context));
  const sorted = matching.sort((left, right) => compareAliases(left, right, context));
  const best = sorted[0];

  if (best) {
    return best.text;
  }

  if (typeof entity.internal_name === "string" && ENTITY_DISPLAY_LABEL_OVERRIDES[entity.internal_name]) {
    return ENTITY_DISPLAY_LABEL_OVERRIDES[entity.internal_name];
  }

  if (typeof entity.internal_name === "string" && entity.internal_name.length > 0) {
    return entity.internal_name;
  }

  return entity.id;
}

function aliasMatchesContext(alias: AliasSchemaJson, context: Record<string, string>): boolean {
  for (const requirement of alias.context_constraints.require_all) {
    const actual = context[requirement.key];
    if (!contextValueMatches(requirement.key, actual, requirement.value)) {
      return false;
    }
  }

  return true;
}

function compareAliases(
  left: AliasSchemaJson,
  right: AliasSchemaJson,
  context: Record<string, string>,
): number {
  const leftPrefer = preferredConstraintCount(left, context);
  const rightPrefer = preferredConstraintCount(right, context);
  if (leftPrefer !== rightPrefer) {
    return rightPrefer - leftPrefer;
  }

  const leftPriority = ALIAS_KIND_PRIORITY[left.alias_kind] ?? 0;
  const rightPriority = ALIAS_KIND_PRIORITY[right.alias_kind] ?? 0;
  if (leftPriority !== rightPriority) {
    return rightPriority - leftPriority;
  }

  if (left.rank_weight !== right.rank_weight) {
    return right.rank_weight - left.rank_weight;
  }

  return left.text.localeCompare(right.text);
}

function preferredConstraintCount(alias: AliasSchemaJson, context: Record<string, string>): number {
  return alias.context_constraints.prefer.filter((preference) =>
    contextValueMatches(preference.key, context[preference.key], preference.value)
  ).length;
}

function selectionFromEntity(
  entity: EntityBaseSchemaJson,
  context: Record<string, string>,
  registryContext: RegistryContext,
  value?: { min: number; max: number; unit: string },
): ResolvedBuildSelection {
  return {
    raw_label: entityDisplayLabel(entity, context, registryContext),
    canonical_entity_id: entity.id,
    resolution_status: "resolved" as const,
    ...(value == null ? {} : { value }),
  };
}

function requireEntity(entityId: string, registryContext: RegistryContext): EntityBaseSchemaJson {
  const entity = registryContext.entityById.get(entityId);
  if (!entity) {
    throw new Error(`Missing entity ${entityId}`);
  }
  return entity;
}

function classSelection(
  className: string,
  registryContext: RegistryContext,
): ResolvedBuildSelection {
  return selectionFromEntity(
    requireEntity(`shared.class.${className}`, registryContext),
    { class: className, kind: "class" },
    registryContext,
  );
}

function resolveClassSideSelection(
  className: string,
  internalName: string,
  registryContext: RegistryContext,
): { slot: BetterBotsBuildSlot; selection: ResolvedBuildSelection } {
  const manifest = registryContext.classManifestByClassInternal.get(className);
  const canonicalInternalName = BETTERBOTS_INTERNAL_NAME_ALIASES[className]?.[internalName] ?? internalName;
  const entry = manifest?.get(canonicalInternalName);
  if (!entry) {
    throw new Error(`Missing class-side manifest entry for ${className}.${internalName}`);
  }

  const entity = requireEntity(entry.entity_id, registryContext);
  const context = {
    class: className,
    kind: entry.kind,
  };

  return {
    slot: entry.slot,
    selection: selectionFromEntity(entity, context, registryContext),
  };
}

function templateIdFromContentPath(contentPath: string): string {
  const templateId = basename(contentPath);
  if (!templateId) {
    throw new Error(`Could not derive template id from ${contentPath}`);
  }
  return templateId;
}

function resolveWeaponEntity(
  contentPath: string,
  registryContext: RegistryContext,
): EntityBaseSchemaJson {
  const templateId = templateIdFromContentPath(contentPath);
  const entity = registryContext.weaponByInternalName.get(templateId);
  if (!entity) {
    throw new Error(`No shared weapon entity found for ${contentPath}`);
  }
  return entity;
}

function resolveSharedWeaponModifierEntity(
  itemId: string,
  slot: BetterBotsWeaponSlot,
  registryContext: RegistryContext,
  kind: "weapon_perk" | "weapon_trait",
): EntityBaseSchemaJson {
  const folder = itemId.split("/").at(-2) ?? "";
  const name = itemId.split("/").at(-1) ?? "";
  const targetMap = kind === "weapon_perk"
    ? registryContext.weaponPerksBySlotAndNormalizedKey
    : registryContext.weaponTraitsBySlotAndNormalizedKey;
  const trimmedFolder = folder.endsWith("_common") ? folder.slice(0, -"_common".length) : folder;
  const suffixes = kind === "weapon_trait" ? ["", "_parent"] : [""];
  const modifierNames = [name, ...(BETTERBOTS_WEAPON_MODIFIER_ID_ALIASES[kind]?.[name] ?? [])];

  const candidateInternalNames = [
    ...modifierNames.flatMap((modifierName) => suffixes.map((suffix) => `weapon_trait_${folder}_${modifierName}${suffix}`)),
    ...(trimmedFolder !== folder
      ? modifierNames.flatMap((modifierName) => suffixes.map((suffix) => `weapon_trait_${trimmedFolder}_${modifierName}${suffix}`))
      : []),
    ...modifierNames.flatMap((modifierName) => suffixes.map((suffix) => `weapon_trait_${modifierName}${suffix}`)),
  ];
  const candidateKeys = [
    ...candidateInternalNames.flatMap((internalName) => [
      `${slot}:${normalizedInternalName(internalName)}`,
      `unknown:${normalizedInternalName(internalName)}`,
    ]),
  ];

  const seen = new Set<string>();
  const matches: EntityBaseSchemaJson[] = [];
  for (const key of candidateKeys) {
    for (const entity of targetMap.get(key) ?? []) {
      if (seen.has(entity.id)) {
        continue;
      }
      seen.add(entity.id);
      matches.push(entity);
    }
    if (matches.length === 1) {
      break;
    }
  }

  if (matches.length !== 1) {
    throw new Error(
      `Expected one ${kind} entity for ${itemId} (${candidateKeys.join(" | ")}), found ${matches.length}`,
    );
  }

  return matches[0];
}

function inferPerkValue(
  entity: EntityBaseSchemaJson,
  rarity: number | null,
): { magnitude: number; unit: "percent" | "flat" } | null {
  const tiers = getEntityCalcTiers(entity);
  if (rarity == null || rarity < 1 || rarity > tiers.length) {
    return null;
  }

  const tier = tiers[rarity - 1];
  const effects = Array.isArray(tier?.effects) ? tier.effects : [];
  if (effects.length !== 1 || typeof effects[0]?.magnitude !== "number") {
    return null;
  }

  const magnitude = effects[0].magnitude;
  const unit = Math.abs(magnitude) <= 1 ? "percent" : "flat";
  return { magnitude, unit };
}

function formatNumericValue(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(2).replace(/\.?0+$/, "");
}

function buildPerkSelection(
  slot: BetterBotsWeaponSlot,
  override: BetterBotsItemOverride,
  registryContext: RegistryContext,
): ResolvedBuildSelection {
  const entity = resolveSharedWeaponModifierEntity(override.id, slot, registryContext, "weapon_perk");
  const context = { slot, kind: "weapon_perk" };
  const resolvedValue = inferPerkValue(entity, override.rarity);

  if (!resolvedValue) {
    return selectionFromEntity(entity, context, registryContext);
  }

  return selectionFromEntity(
    entity,
    context,
    registryContext,
    {
      min: resolvedValue.magnitude,
      max: resolvedValue.magnitude,
      unit: resolvedValue.unit,
    },
  );
}

function withPerkRawLabel(
  selection: ResolvedBuildSelection,
): ResolvedBuildSelection {
  if (selection.value == null) {
    return selection;
  }

  const numeric = selection.value.unit === "percent"
    ? formatNumericValue(selection.value.max * 100)
    : formatNumericValue(selection.value.max);
  return {
    ...selection,
    raw_label: selection.value.unit === "percent"
      ? `+${numeric}% ${selection.raw_label}`
      : `+${numeric} ${selection.raw_label}`,
  };
}

function buildBlessingSelection(
  slot: BetterBotsWeaponSlot,
  override: BetterBotsItemOverride,
  registryContext: RegistryContext,
): ResolvedBuildSelection {
  const traitEntity = resolveSharedWeaponModifierEntity(override.id, slot, registryContext, "weapon_trait");
  const familyEdge = (registryContext.edgesByFromEntityId.get(traitEntity.id) ?? [])
    .find((edge) => edge.type === "instance_of" && edge.to_entity_id.startsWith("shared.name_family.blessing."));
  if (!familyEdge) {
    throw new Error(`Missing blessing family edge for ${traitEntity.id}`);
  }

  const familyEntity = requireEntity(familyEdge.to_entity_id, registryContext);
  return selectionFromEntity(
    familyEntity,
    { slot, kind: "weapon_trait" },
    registryContext,
  );
}

function stripCurioVariantSuffix(name: string): string {
  return name.replace(/\s*\([^()]*\)\s*$/, "").trim();
}

// Curio items are modeled only as non_canonical display labels today
// (see data/ground-truth/non-canonical/known-unresolved.json — all entries
// are `display_label` kind). BetterBots emits the full variant label, e.g.
// "Blessed Bullet (Reliquary)"; the bare label "Blessed Bullet" is the one
// registered as non_canonical. If neither matches, the selection is unresolved —
// never silently stamped non_canonical.
function resolveCurioNameSelection(
  rawLabel: string,
): BuildSelectionSchemaJson {
  const queryContext = { kind: "gadget_item", slot: "curio" } as const;
  const bareLabel = stripCurioVariantSuffix(rawLabel);
  const candidates = bareLabel && bareLabel !== rawLabel
    ? [rawLabel, bareLabel]
    : [rawLabel];

  for (const candidate of candidates) {
    if (classifyKnownUnresolved(candidate, queryContext)) {
      return {
        raw_label: rawLabel,
        canonical_entity_id: null,
        resolution_status: "non_canonical",
      };
    }
  }

  return {
    raw_label: rawLabel,
    canonical_entity_id: null,
    resolution_status: "unresolved",
  };
}

function buildCurioTraitSelection(
  override: BetterBotsItemOverride,
  registryContext: RegistryContext,
): ResolvedBuildSelection {
  const entity = registryContext.gadgetTraitsByInternalName.get(override.id);
  if (!entity) {
    throw new Error(`Missing gadget_trait entity for ${override.id}`);
  }

  const resolvedValue = inferPerkValue(entity, override.rarity);
  const selection = selectionFromEntity(
    entity,
    { kind: "gadget_trait" },
    registryContext,
    resolvedValue == null
      ? undefined
      : {
        min: resolvedValue.magnitude,
        max: resolvedValue.magnitude,
        unit: resolvedValue.unit,
      },
  );

  if (BETTERBOTS_CURIO_RAW_LABELS[override.id]) {
    return {
      ...selection,
      raw_label: BETTERBOTS_CURIO_RAW_LABELS[override.id],
    };
  }

  return withPerkRawLabel(selection);
}

function buildBotBuild(
  profile: BetterBotsProfileTemplate,
  registryContext: RegistryContext,
  options: GenerateBetterBotsArtifactsOptions,
): CanonicalBuildSchemaJson {
  const className = profile.className;
  let ability = null as ResolvedBuildSelection | null;
  let blitz = null as ResolvedBuildSelection | null;
  let aura = null as ResolvedBuildSelection | null;
  let keystone = null as ResolvedBuildSelection | null;
  const talents: ResolvedBuildSelection[] = [];

  for (const internalName of profile.talents) {
    const resolved = resolveClassSideSelection(className, internalName, registryContext);
    if (resolved.slot === "ability") {
      ability = resolved.selection;
    } else if (resolved.slot === "blitz") {
      blitz = resolved.selection;
    } else if (resolved.slot === "aura") {
      aura = resolved.selection;
    } else if (resolved.slot === "keystone") {
      keystone = resolved.selection;
    } else {
      talents.push(resolved.selection);
    }
  }

  if (!ability || !blitz || !aura) {
    throw new Error(`Incomplete BetterBots profile for ${className}: missing structural selections`);
  }

  const buildWeapon = (
    slot: BetterBotsWeaponSlot,
  ): CanonicalBuildSchemaJson["weapons"][number] => {
    const weaponEntity = resolveWeaponEntity(profile.loadout[slot], registryContext);
    const context = { slot, kind: "weapon" };
    const override = profile.weaponOverrides[slot];

    return {
      slot,
      name: selectionFromEntity(weaponEntity, context, registryContext),
      perks: (override?.perks ?? []).map((item) => withPerkRawLabel(buildPerkSelection(slot, item, registryContext))),
      blessings: (override?.traits ?? []).map((item) => buildBlessingSelection(slot, item, registryContext)),
    };
  };

  const weapons: CanonicalBuildSchemaJson["weapons"] = [
    buildWeapon("melee"),
    buildWeapon("ranged"),
  ];

  const curios: CanonicalBuildSchemaJson["curios"] = profile.curios.map((curio) => ({
    name: resolveCurioNameSelection(curio.name),
    perks: curio.traits.map((trait) => buildCurioTraitSelection(trait, registryContext)),
  }));

  const title = `Bot ${classDisplayName(className)} - ${[
    ability.raw_label,
    ...(keystone ? [keystone.raw_label] : []),
    ...weapons.map((weapon) => weapon.name.raw_label),
  ].join(" + ")}`;

  const build: CanonicalBuildSchemaJson = {
    schema_version: 1,
    title,
    class: classSelection(className, registryContext),
    provenance: {
      source_kind: "curated",
      source_url: options.sourceUrl ?? BETTERBOTS_SOURCE_URL,
      author: options.author ?? "BetterBots",
      scraped_at: options.generatedAt ?? new Date().toISOString(),
    },
    ability,
    blitz,
    aura,
    keystone,
    talents,
    weapons,
    curios,
  };

  assertValidCanonicalBuild(build);
  return build;
}

function buildBotWeaponExport(
  profile: BetterBotsProfileTemplate,
  build: CanonicalBuildSchemaJson,
): Record<BetterBotsWeaponSlot, BetterBotsWeaponExportEntry> {
  const slug = buildSlugForClass(profile.className);
  const slots = new Map(build.weapons.map((weapon) => [weapon.slot, weapon]));

  return {
    melee: exportEntryForWeapon(profile, slug, slots.get("melee")),
    ranged: exportEntryForWeapon(profile, slug, slots.get("ranged")),
  };
}

function exportEntryForWeapon(
  profile: BetterBotsProfileTemplate,
  slug: string,
  weapon: CanonicalBuildSchemaJson["weapons"][number] | undefined,
): BetterBotsWeaponExportEntry {
  if (!weapon) {
    throw new Error(`Missing weapon entry while exporting ${profile.className}`);
  }

  const slot = weapon.slot as BetterBotsWeaponSlot;
  const canonicalEntityId = weapon.name.canonical_entity_id;
  if (typeof canonicalEntityId !== "string" || canonicalEntityId.length === 0) {
    throw new Error(`Missing canonical weapon entity id while exporting ${profile.className} ${slot}`);
  }

  const templateId = canonicalEntityId.split(".").pop() ?? "";
  return {
    template_id: templateId,
    display_name: weapon.name.raw_label,
    canonical_entity_id: canonicalEntityId,
    gestalt: profile.botGestalts[slot],
    source_builds: [slug],
    bot_notes: `Synced from BetterBots DEFAULT_PROFILE_TEMPLATES for ${profile.className} ${slot}.`,
  };
}

export function generateBetterBotsArtifacts(
  profiles: Record<string, BetterBotsProfileTemplate>,
  options: GenerateBetterBotsArtifactsOptions = {},
): BetterBotsArtifacts {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const registryContext = loadRegistryContext();
  const builds: Record<string, CanonicalBuildSchemaJson> = {};
  const classes: Record<string, Record<BetterBotsWeaponSlot, BetterBotsWeaponExportEntry>> = {};

  for (const className of Object.keys(profiles).sort()) {
    const profile = profiles[className];
    const slug = buildSlugForClass(className);
    const build = buildBotBuild(profile, registryContext, {
      ...options,
      generatedAt,
    });
    builds[slug] = build;
    classes[className] = buildBotWeaponExport(profile, build);
  }

  return {
    builds,
    weaponExport: {
      generated_at: generatedAt,
      schema_version: 1,
      assumes: "betterbots",
      classes,
    },
  };
}

export function writeBetterBotsArtifacts(
  profiles: Record<string, BetterBotsProfileTemplate>,
  options: WriteBetterBotsArtifactsOptions = {},
): BetterBotsArtifacts {
  const artifacts = generateBetterBotsArtifacts(profiles, options);
  const buildDir = options.buildDir ?? DEFAULT_BOT_BUILD_DIR;
  const exportPath = options.exportPath ?? DEFAULT_BOT_WEAPON_EXPORT_PATH;

  mkdirSync(buildDir, { recursive: true });
  for (const [slug, build] of Object.entries(artifacts.builds)) {
    writeFileSync(join(buildDir, `${slug}.json`), JSON.stringify(build, null, 2) + "\n");
  }

  mkdirSync(dirname(exportPath), { recursive: true });
  writeFileSync(exportPath, JSON.stringify(artifacts.weaponExport, null, 2) + "\n");
  return artifacts;
}

export function syncBetterBotsArtifacts(
  profilePath: string = DEFAULT_BETTERBOTS_PROFILE_PATH,
  options: WriteBetterBotsArtifactsOptions = {},
): BetterBotsArtifacts {
  const profiles = loadBetterBotsProfileTemplates(profilePath);
  return writeBetterBotsArtifacts(profiles, options);
}

export function hasLocalBetterBotsRepo(
  profilePath: string = DEFAULT_BETTERBOTS_PROFILE_PATH,
): boolean {
  return existsSync(profilePath);
}
