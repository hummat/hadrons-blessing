/**
 * Buff semantic parser — extracts structured effect data from parsed Lua
 * buff templates into calc objects.
 *
 * Turns parseLuaTable output (with stat_buffs, conditional_stat_buffs,
 * proc_stat_buffs, lerped_stat_buffs, etc.) into a flat effects array
 * with resolved magnitudes, conditions, and triggers.
 *
 * Exports:
 *   extractEffects(parsedTemplate, talentSettingsMap, options?) → calc object
 */

import { tagCondition } from "./condition-tagger.mjs";

// -- Helpers ------------------------------------------------------------------

/**
 * Strip "stat_buffs." prefix from a stat key.
 * E.g. "stat_buffs.toughness" -> "toughness".
 * If no prefix, returns the key as-is.
 *
 * @param {string} key
 * @returns {string}
 */
function extractStatKey(key) {
  const prefix = "stat_buffs.";
  if (key.startsWith(prefix)) {
    return key.slice(prefix.length);
  }
  return key;
}

/**
 * Strip "proc_events." prefix from a trigger key.
 * E.g. "proc_events.on_kill" -> "on_kill".
 *
 * @param {string} key
 * @returns {string}
 */
function extractTrigger(key) {
  const prefix = "proc_events.";
  if (key.startsWith(prefix)) {
    return key.slice(prefix.length);
  }
  return key;
}

/**
 * Resolve an alias-prefixed dotted path to its namespace-prefixed form.
 *
 * E.g. "talent_settings_2.combat.ranged_damage" with aliases
 * { talent_settings_2: "psyker_2" } -> "psyker_2.combat.ranged_damage"
 *
 * @param {string} dottedPath
 * @param {object} aliases - { varName: namespace }
 * @returns {string} The resolved path (alias prefix replaced), or original if no alias matches.
 */
function resolveAliasPath(dottedPath, aliases) {
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
 *
 * - number -> { magnitude: number, magnitude_expr: null }
 * - { $ref: "..." } -> resolve alias, look up in settingsMap
 * - { $expr: "...", $op: "..." } -> resolve operands, evaluate if both resolve
 *
 * @param {*} value - Raw magnitude value from parsed template
 * @param {Map<string, number>} settingsMap - TalentSettings flat map
 * @param {object} [aliases={}] - Alias map { varName: namespace }
 * @returns {{ magnitude: number|null, magnitude_expr: string|null }}
 */
function resolveMagnitude(value, settingsMap, aliases = {}) {
  // Literal number
  if (typeof value === "number") {
    return { magnitude: value, magnitude_expr: null };
  }

  // $ref: dotted path reference to TalentSettings
  if (value && typeof value === "object" && value.$ref) {
    const resolved = resolveAliasPath(value.$ref, aliases);
    if (settingsMap.has(resolved)) {
      return { magnitude: settingsMap.get(resolved), magnitude_expr: null };
    }
    return { magnitude: null, magnitude_expr: value.$ref };
  }

  // $expr: arithmetic expression
  if (value && typeof value === "object" && value.$expr) {
    const op = value.$op;
    const parts = value.$expr.split(new RegExp(`\\s*\\${op}\\s*`));
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
    return { magnitude: null, magnitude_expr: value.$expr };
  }

  // Fallback: not a recognized magnitude shape
  return { magnitude: null, magnitude_expr: null };
}

/**
 * Parse an operand: either a literal number string or a settings map lookup.
 * @param {string} operand - Trimmed operand string
 * @param {Map<string, number>} settingsMap
 * @returns {number|null}
 */
function parseOperand(operand, settingsMap) {
  const num = Number(operand);
  if (!Number.isNaN(num) && operand !== "") {
    return num;
  }
  if (settingsMap.has(operand)) {
    return settingsMap.get(operand);
  }
  return null;
}

/**
 * Evaluate a simple binary arithmetic operation.
 * @param {number} left
 * @param {string} op - One of +, -, *, /
 * @param {number} right
 * @returns {number|null}
 */
function evalOp(left, op, right) {
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
 * @param {object} fields
 * @returns {object}
 */
function makeEffect(fields) {
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
 *
 * @param {object} parsedTemplate - JS object produced by parseLuaTable
 * @param {Map<string, number>} talentSettingsMap - Flat dotted-path -> number map
 * @param {object} [options={}]
 * @param {object} [options.aliases] - TalentSettings alias map { varName: namespace }
 * @param {object} [options.localFunctions] - Local function body map { funcName: bodyText }
 * @returns {object} Calc object with effects array and metadata
 */
export function extractEffects(parsedTemplate, talentSettingsMap, options = {}) {
  const aliases = options.aliases || {};
  const localFunctions = options.localFunctions || {};
  const effects = [];

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
    const triggers = [];
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
        effects.push(makeEffect({
          stat: extractStatKey(key),
          magnitude_min: value.min,
          magnitude_max: value.max,
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
        effects.push(makeEffect({
          stat: extractStatKey(key),
          magnitude_min: value.min,
          magnitude_max: value.max,
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
  const calc = { effects };

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
      if (kw && typeof kw === "object" && kw.$ref) {
        const ref = kw.$ref;
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
