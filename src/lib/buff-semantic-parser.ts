/**
 * Buff semantic parser — extracts structured effect data from parsed Lua
 * buff templates into calc objects.
 *
 * Turns parseLuaTable output (with stat_buffs, conditional_stat_buffs,
 * proc_stat_buffs, lerped_stat_buffs, etc.) into a flat effects array
 * with resolved magnitudes, conditions, and triggers.
 *
 * Exports:
 *   extractEffects(parsedTemplate, talentSettingsMap, options?) -> calc object
 *   extractTiers(tierArray, settingsMap, options?) -> array of tier objects
 *   resolveTemplateChain(blocks, externalTemplates?) -> Map<name, resolvedTemplate>
 */

import { tagCondition } from "./condition-tagger.js";
import type { LuaConditionNode } from "./condition-tagger.js";
import { extractTemplateBlocks } from "./lua-data-reader.js";
import type { LuaValue, TemplateBlock } from "./lua-data-reader.js";

// -- Types -------------------------------------------------------------------

interface MagnitudeRef {
  $ref: string;
}

interface MagnitudeExpr {
  $expr: string;
  $op: string;
}

type MagnitudeInput = number | MagnitudeRef | MagnitudeExpr | LuaValue;

interface ResolvedMagnitude {
  magnitude: number | null;
  magnitude_expr: string | null;
}

export interface BuffEffect {
  stat: string;
  magnitude: number | null;
  magnitude_expr: string | null;
  magnitude_min: number | null;
  magnitude_max: number | null;
  condition: string | null;
  trigger: string | null;
  type: string;
}

export interface CalcResult {
  effects: BuffEffect[];
  class_name?: string;
  max_stacks?: number;
  duration?: number;
  active_duration?: number;
  keywords?: string[];
}

export interface TierResult {
  effects: BuffEffect[];
  active_duration?: number;
  child_duration?: number;
  max_stacks?: number;
  duration?: number;
}

interface ExtractEffectsOptions {
  aliases?: Record<string, string>;
  localFunctions?: Record<string, string>;
}

// Parsed template shape — the subset of keys we access from Lua parse output
interface ParsedTemplate {
  stat_buffs?: Record<string, LuaValue>;
  conditional_stat_buffs?: Record<string, LuaValue>;
  conditional_stat_buffs_func?: LuaConditionNode;
  proc_stat_buffs?: Record<string, LuaValue>;
  proc_events?: Record<string, LuaValue>;
  lerped_stat_buffs?: Record<string, LuaValue>;
  conditional_lerped_stat_buffs?: Record<string, LuaValue>;
  conditional_lerped_stat_buffs_func?: LuaConditionNode;
  stepped_stat_buffs?: Record<string, LuaValue>;
  class_name?: string;
  max_stacks?: number;
  duration?: number;
  active_duration?: number;
  keywords?: LuaValue[];
  [key: string]: unknown;
}

interface LerpedValue {
  min: number;
  max: number;
}

// -- Helpers ------------------------------------------------------------------

/**
 * Strip "stat_buffs." prefix from a stat key.
 */
function extractStatKey(key: string): string {
  for (const prefix of ["stat_buffs.", "buff_stat_buffs."]) {
    if (key.startsWith(prefix)) {
      return key.slice(prefix.length);
    }
  }
  return key;
}

/**
 * Strip "proc_events." prefix from a trigger key.
 */
function extractTrigger(key: string): string {
  const prefix = "proc_events.";
  if (key.startsWith(prefix)) {
    return key.slice(prefix.length);
  }
  return key;
}

/**
 * Resolve an alias-prefixed dotted path to its namespace-prefixed form.
 */
function resolveAliasPath(dottedPath: string, aliases: Record<string, string>): string {
  if (!aliases) return dottedPath;
  for (const [varName, namespace] of Object.entries(aliases)) {
    if (dottedPath.startsWith(varName + ".")) {
      return namespace + dottedPath.slice(varName.length);
    }
  }
  return dottedPath;
}

/**
 * Resolve a magnitude value from a parsed buff template field.
 */
function resolveMagnitude(
  value: MagnitudeInput,
  settingsMap: Map<string, number>,
  aliases: Record<string, string> = {},
): ResolvedMagnitude {
  // Literal number
  if (typeof value === "number") {
    return { magnitude: value, magnitude_expr: null };
  }

  // $ref: dotted path reference to TalentSettings
  if (value && typeof value === "object" && "$ref" in value && (value as MagnitudeRef).$ref) {
    const ref = (value as MagnitudeRef).$ref;
    const resolved = resolveAliasPath(ref, aliases);
    if (settingsMap.has(resolved)) {
      return { magnitude: settingsMap.get(resolved)!, magnitude_expr: null };
    }
    return { magnitude: null, magnitude_expr: ref };
  }

  // $expr: arithmetic expression
  if (value && typeof value === "object" && "$expr" in value && (value as MagnitudeExpr).$expr) {
    const exprValue = value as MagnitudeExpr;
    const op = exprValue.$op;
    const parts = exprValue.$expr.split(new RegExp(`\\s*\\${op}\\s*`));
    if (parts.length === 2) {
      const leftPath = resolveAliasPath(parts[0].trim(), aliases);
      const rightPath = resolveAliasPath(parts[1].trim(), aliases);

      const leftVal = parseOperand(leftPath, settingsMap);
      const rightVal = parseOperand(rightPath, settingsMap);

      if (leftVal !== null && rightVal !== null) {
        const result = evalOp(leftVal, op, rightVal);
        if (result !== null) {
          return { magnitude: result, magnitude_expr: null };
        }
      }
    }
    return { magnitude: null, magnitude_expr: exprValue.$expr };
  }

  // Fallback: not a recognized magnitude shape
  return { magnitude: null, magnitude_expr: null };
}

/**
 * Parse an operand: either a literal number string or a settings map lookup.
 */
function parseOperand(operand: string, settingsMap: Map<string, number>): number | null {
  const num = Number(operand);
  if (!Number.isNaN(num) && operand !== "") {
    return num;
  }
  if (settingsMap.has(operand)) {
    return settingsMap.get(operand)!;
  }
  return null;
}

/**
 * Evaluate a simple binary arithmetic operation.
 */
function evalOp(left: number, op: string, right: number): number | null {
  switch (op) {
    case "+": return left + right;
    case "-": return left - right;
    case "*": return left * right;
    case "/": return right !== 0 ? left / right : null;
    default: return null;
  }
}

/**
 * Build an effect object with the standard shape.
 */
function makeEffect(fields: Partial<BuffEffect> & { stat: string; type: string }): BuffEffect {
  return {
    stat: fields.stat,
    magnitude: fields.magnitude ?? null,
    magnitude_expr: fields.magnitude_expr ?? null,
    magnitude_min: fields.magnitude_min ?? null,
    magnitude_max: fields.magnitude_max ?? null,
    condition: fields.condition ?? null,
    trigger: fields.trigger ?? null,
    type: fields.type,
  };
}

// -- Main export --------------------------------------------------------------

/**
 * Extract structured effects from a parsed Lua buff template.
 */
export function extractEffects(
  parsedTemplate: ParsedTemplate,
  talentSettingsMap: Map<string, number>,
  options: ExtractEffectsOptions = {},
): CalcResult {
  const aliases = options.aliases || {};
  const localFunctions = options.localFunctions || {};
  const effects: BuffEffect[] = [];

  // 1. stat_buffs -> type: "stat_buff"
  if (parsedTemplate.stat_buffs && typeof parsedTemplate.stat_buffs === "object") {
    for (const [key, value] of Object.entries(parsedTemplate.stat_buffs)) {
      const { magnitude, magnitude_expr } = resolveMagnitude(value, talentSettingsMap, aliases);
      effects.push(makeEffect({
        stat: extractStatKey(key),
        magnitude,
        magnitude_expr,
        type: "stat_buff",
      }));
    }
  }

  // 2. conditional_stat_buffs -> type: "conditional_stat_buff"
  if (parsedTemplate.conditional_stat_buffs && typeof parsedTemplate.conditional_stat_buffs === "object") {
    const condition = parsedTemplate.conditional_stat_buffs_func
      ? tagCondition(parsedTemplate.conditional_stat_buffs_func, localFunctions)
      : null;
    for (const [key, value] of Object.entries(parsedTemplate.conditional_stat_buffs)) {
      const { magnitude, magnitude_expr } = resolveMagnitude(value, talentSettingsMap, aliases);
      effects.push(makeEffect({
        stat: extractStatKey(key),
        magnitude,
        magnitude_expr,
        condition,
        type: "conditional_stat_buff",
      }));
    }
  }

  // 3. proc_stat_buffs -> type: "proc_stat_buff"
  if (parsedTemplate.proc_stat_buffs && typeof parsedTemplate.proc_stat_buffs === "object") {
    // Collect triggers from proc_events
    const triggers: string[] = [];
    if (parsedTemplate.proc_events && typeof parsedTemplate.proc_events === "object") {
      for (const key of Object.keys(parsedTemplate.proc_events)) {
        triggers.push(extractTrigger(key));
      }
    }
    const trigger = triggers.length > 0 ? triggers[0] : null;

    for (const [key, value] of Object.entries(parsedTemplate.proc_stat_buffs)) {
      const { magnitude, magnitude_expr } = resolveMagnitude(value, talentSettingsMap, aliases);
      effects.push(makeEffect({
        stat: extractStatKey(key),
        magnitude,
        magnitude_expr,
        trigger,
        type: "proc_stat_buff",
      }));
    }
  }

  // 4. lerped_stat_buffs -> type: "lerped_stat_buff"
  if (parsedTemplate.lerped_stat_buffs && typeof parsedTemplate.lerped_stat_buffs === "object") {
    for (const [key, value] of Object.entries(parsedTemplate.lerped_stat_buffs)) {
      if (value && typeof value === "object" && "min" in value && "max" in value) {
        const lerped = value as unknown as LerpedValue;
        effects.push(makeEffect({
          stat: extractStatKey(key),
          magnitude_min: lerped.min,
          magnitude_max: lerped.max,
          type: "lerped_stat_buff",
        }));
      } else {
        const { magnitude, magnitude_expr } = resolveMagnitude(value, talentSettingsMap, aliases);
        effects.push(makeEffect({
          stat: extractStatKey(key),
          magnitude,
          magnitude_expr,
          type: "lerped_stat_buff",
        }));
      }
    }
  }

  // 5. conditional_lerped_stat_buffs -> type: "conditional_lerped_stat_buff"
  if (parsedTemplate.conditional_lerped_stat_buffs && typeof parsedTemplate.conditional_lerped_stat_buffs === "object") {
    const condition = parsedTemplate.conditional_lerped_stat_buffs_func
      ? tagCondition(parsedTemplate.conditional_lerped_stat_buffs_func, localFunctions)
      : null;
    for (const [key, value] of Object.entries(parsedTemplate.conditional_lerped_stat_buffs)) {
      if (value && typeof value === "object" && "min" in value && "max" in value) {
        const lerped = value as unknown as LerpedValue;
        effects.push(makeEffect({
          stat: extractStatKey(key),
          magnitude_min: lerped.min,
          magnitude_max: lerped.max,
          condition,
          type: "conditional_lerped_stat_buff",
        }));
      } else {
        const { magnitude, magnitude_expr } = resolveMagnitude(value, talentSettingsMap, aliases);
        effects.push(makeEffect({
          stat: extractStatKey(key),
          magnitude,
          magnitude_expr,
          condition,
          type: "conditional_lerped_stat_buff",
        }));
      }
    }
  }

  // 6. stepped_stat_buffs -> type: "stepped_stat_buff"
  if (parsedTemplate.stepped_stat_buffs && typeof parsedTemplate.stepped_stat_buffs === "object") {
    for (const [key, value] of Object.entries(parsedTemplate.stepped_stat_buffs)) {
      const { magnitude, magnitude_expr } = resolveMagnitude(value, talentSettingsMap, aliases);
      effects.push(makeEffect({
        stat: extractStatKey(key),
        magnitude,
        magnitude_expr,
        type: "stepped_stat_buff",
      }));
    }
  }

  // 7. Metadata
  const calc: CalcResult = { effects };

  if (parsedTemplate.class_name !== undefined) {
    calc.class_name = parsedTemplate.class_name;
  }
  if (parsedTemplate.max_stacks !== undefined) {
    calc.max_stacks = parsedTemplate.max_stacks;
  }
  if (parsedTemplate.duration !== undefined) {
    calc.duration = parsedTemplate.duration;
  }
  if (parsedTemplate.active_duration !== undefined) {
    calc.active_duration = parsedTemplate.active_duration;
  }

  // 8. Keywords
  if (Array.isArray(parsedTemplate.keywords)) {
    const keywords = parsedTemplate.keywords.map((kw) => {
      if (kw && typeof kw === "object" && "$ref" in kw) {
        const ref = (kw as { $ref: string }).$ref;
        const prefix = "keywords.";
        return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
      }
      if (typeof kw === "string") {
        return kw;
      }
      return String(kw);
    });
    calc.keywords = keywords;
  }

  return calc;
}

// -- Tier extraction ----------------------------------------------------------

/** Metadata fields to preserve per tier when present. */
const TIER_METADATA_FIELDS = ["active_duration", "child_duration", "max_stacks", "duration"] as const;

/**
 * Extract structured tier data from a blessing's per-tier array.
 */
export function extractTiers(
  tierArray: ParsedTemplate[],
  settingsMap: Map<string, number>,
  options: ExtractEffectsOptions = {},
): TierResult[] {
  return tierArray.map((tierObj) => {
    const calc = extractEffects(tierObj, settingsMap, options);
    const tier: TierResult = { effects: calc.effects };
    for (const field of TIER_METADATA_FIELDS) {
      if (tierObj[field] !== undefined) {
        (tier as unknown as Record<string, unknown>)[field] = tierObj[field];
      }
    }
    return tier;
  });
}

// -- Template chain resolution ------------------------------------------------

/**
 * Deep-copy a plain object (no functions, no circular refs).
 */
function deepCopy<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

interface InlineBlock {
  name: string;
  type: "inline";
  parsed: Record<string, LuaValue>;
  patches: Record<string, LuaValue>;
}

interface CloneBlock {
  name: string;
  type: "clone";
  cloneSource: string;
  cloneExternal?: boolean;
  patches: Record<string, LuaValue>;
}

interface MergeBlock {
  name: string;
  type: "merge";
  mergeInline: Record<string, LuaValue>;
  mergeBase: string;
  mergeBaseExternal?: boolean;
  patches: Record<string, LuaValue>;
}

type TemplateBlockInput = InlineBlock | CloneBlock | MergeBlock | { name: string; type: string; patches: Record<string, LuaValue> };

/**
 * Resolve template inheritance chains (table.clone / table.merge) into
 * concrete template objects.
 */
export function resolveTemplateChain(
  blocks: TemplateBlockInput[],
  externalTemplates: Map<string, Record<string, LuaValue>> = new Map(),
): Map<string, Record<string, LuaValue>> {
  const blockMap = new Map<string, TemplateBlockInput>();
  for (const block of blocks) {
    blockMap.set(block.name, block);
  }

  /** Memoized resolved templates. */
  const resolved = new Map<string, Record<string, LuaValue>>();

  /** Cycle detection. */
  const resolving = new Set<string>();

  function resolve(name: string): Record<string, LuaValue> | null {
    if (resolved.has(name)) {
      return resolved.get(name)!;
    }

    // Check external templates
    if (externalTemplates.has(name)) {
      const ext = deepCopy(externalTemplates.get(name)!);
      resolved.set(name, ext);
      return ext;
    }

    const block = blockMap.get(name);
    if (!block) {
      return null;
    }

    // Cycle guard
    if (resolving.has(name)) {
      return null;
    }
    resolving.add(name);

    let template: Record<string, LuaValue>;

    if (block.type === "inline") {
      const inlineBlock = block as InlineBlock;
      template = deepCopy(inlineBlock.parsed);
      Object.assign(template, inlineBlock.patches);
    } else if (block.type === "clone") {
      const cloneBlock = block as CloneBlock;
      if (cloneBlock.cloneExternal) {
        // Look up in external templates
        const source = externalTemplates.has(cloneBlock.cloneSource)
          ? deepCopy(externalTemplates.get(cloneBlock.cloneSource)!)
          : {};
        template = source;
      } else {
        const source = resolve(cloneBlock.cloneSource);
        template = source ? deepCopy(source) : {};
      }
      Object.assign(template, cloneBlock.patches);
    } else if (block.type === "merge") {
      const mergeBlock = block as MergeBlock;
      // Start with inline data
      template = deepCopy(mergeBlock.mergeInline);
      // Resolve base and overwrite (second-arg-wins)
      if (mergeBlock.mergeBaseExternal) {
        const base = externalTemplates.has(mergeBlock.mergeBase)
          ? deepCopy(externalTemplates.get(mergeBlock.mergeBase)!)
          : null;
        if (base) {
          Object.assign(template, base);
        }
      } else {
        const base = resolve(mergeBlock.mergeBase);
        if (base) {
          Object.assign(template, deepCopy(base));
        }
      }
      Object.assign(template, mergeBlock.patches);
    } else {
      template = {};
    }

    resolving.delete(name);
    resolved.set(name, template);
    return template;
  }

  // Resolve all blocks
  for (const block of blocks) {
    resolve(block.name);
  }

  return resolved;
}

// -- Talent-to-buff linking ---------------------------------------------------

/**
 * Extract talent -> buff template links from a talent definition Lua file.
 */
export function extractTalentBuffLinks(talentLuaSource: string): Map<string, string[]> {
  const links = new Map<string, string[]>();
  const lines = talentLuaSource.split("\n");
  const countBraces = (value: string): number => {
    let depth = 0;
    for (const ch of value) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
    }
    return depth;
  };
  const pushLink = (talentName: string, buffName: string): void => {
    const existing = links.get(talentName) ?? [];
    if (!existing.includes(buffName)) {
      existing.push(buffName);
      links.set(talentName, existing);
    }
  };

  // Phase 1: Find the talents block start.
  let talentsLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // Direct key: `talents = {` (at some indentation)
    if (/^\s+talents\s*=\s*\{/.test(lines[i])) {
      talentsLineIdx = i;
      break;
    }
    // Dot-access: `archetype_talents.talents = {`
    if (/\w+\.talents\s*=\s*\{/.test(trimmed)) {
      talentsLineIdx = i;
      break;
    }
  }
  if (talentsLineIdx === -1) return links;

  // Phase 2: Determine the talent-level indent by finding the first key after `talents = {`
  let talentIndent = -1;
  for (let i = talentsLineIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(\t+)(\w+)\s*=\s*\{/);
    if (m) {
      talentIndent = m[1].length;
      break;
    }
    // Skip blank lines and non-key lines
    if (lines[i].trim() && !lines[i].trim().startsWith("--")) break;
  }
  if (talentIndent === -1) return links;

  // Phase 3: Track current talent and direct child blocks that can own buff_template_name.
  let currentTalent: string | null = null;
  let currentDirectBlockDepth = 0;
  let buffArrayDepth = 0;
  let buffArrayNames: string[] = [];
  let insideBuffArray = false;

  for (let i = talentsLineIdx; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect talent-level keys at the determined indent
    const talentMatch = line.match(/^(\t+)(\w+)\s*=\s*\{/);
    if (talentMatch) {
      const indent = talentMatch[1].length;
      if (indent === talentIndent) {
        currentTalent = talentMatch[2];
        currentDirectBlockDepth = 0;
        insideBuffArray = false;
        buffArrayDepth = 0;
        buffArrayNames = [];
        continue;
      }
      if (currentTalent && indent === talentIndent + 1 && currentDirectBlockDepth === 0) {
        currentDirectBlockDepth = countBraces(trimmed);
        continue;
      }
    }

    if (currentTalent && currentDirectBlockDepth > 0) {
      if (insideBuffArray) {
        const inlineNames = trimmed.match(/"([^"]+)"/g);
        if (inlineNames) {
          for (const name of inlineNames) {
            buffArrayNames.push(name.replace(/"/g, ""));
          }
        }
        buffArrayDepth += countBraces(trimmed);
        if (buffArrayDepth <= 0) {
          insideBuffArray = false;
          for (const buffName of buffArrayNames) {
            pushLink(currentTalent, buffName);
          }
          buffArrayNames = [];
        }
      } else {
        const directPropertyMatch = line.match(/^(\t+)buff_template_name\s*=\s*(.+)$/);
        if (directPropertyMatch && directPropertyMatch[1].length === talentIndent + 2) {
          const assignment = directPropertyMatch[2].trim();
          const singleMatch = assignment.match(/^"([^"]+)"/);
          if (singleMatch) {
            pushLink(currentTalent, singleMatch[1]);
          } else if (assignment.startsWith("{")) {
            insideBuffArray = true;
            buffArrayDepth = countBraces(assignment);
            buffArrayNames = [];
            const inlineNames = assignment.match(/"([^"]+)"/g);
            if (inlineNames) {
              for (const name of inlineNames) {
                buffArrayNames.push(name.replace(/"/g, ""));
              }
            }
            if (buffArrayDepth <= 0) {
              insideBuffArray = false;
              for (const buffName of buffArrayNames) {
                pushLink(currentTalent, buffName);
              }
              buffArrayNames = [];
            }
          }
        }
      }

      currentDirectBlockDepth += countBraces(trimmed);
      if (currentDirectBlockDepth <= 0) {
        currentDirectBlockDepth = 0;
        insideBuffArray = false;
        buffArrayDepth = 0;
        buffArrayNames = [];
      }
    }
  }

  return links;
}
