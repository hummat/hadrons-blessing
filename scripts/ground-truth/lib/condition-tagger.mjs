/**
 * Condition tagger — maps Lua function references ($ref, $call, $func nodes)
 * to human-readable semantic condition tags.
 *
 * Used by the buff semantic parser to annotate effects with their activation
 * conditions (e.g. "wielded", "on_kill", "weapon_keyword:bolter").
 */

const CONDITIONAL_TAGS = {
  "ConditionalFunctions.is_item_slot_wielded": "wielded",
  "ConditionalFunctions.is_item_slot_not_wielded": "not_wielded",
  "ConditionalFunctions.is_sprinting": "sprinting",
  "ConditionalFunctions.is_blocking": "blocking",
  "ConditionalFunctions.is_lunging": "lunging",
  "ConditionalFunctions.is_reloading": "reloading",
  "ConditionalFunctions.is_alternative_fire": "alt_fire",
  "ConditionalFunctions.has_full_toughness": "full_toughness",
  "ConditionalFunctions.has_stamina": "has_stamina",
  "ConditionalFunctions.has_empty_clip": "empty_clip",
  "ConditionalFunctions.has_high_warp_charge": "high_warp_charge",
  "ConditionalFunctions.has_high_overheat": "high_overheat",
  "ConditionalFunctions.at_max_stacks": "max_stacks",
  "ConditionalFunctions.melee_weapon_special_active": "weapon_special",
  "ConditionalFunctions.is_weapon_using_magazine": "magazine_weapon",
};

/**
 * Tag an inline $func body using heuristic pattern matching.
 * @param {string} body - The Lua function body string.
 * @returns {string} A semantic tag.
 */
function tagInlineFunc(body) {
  // Pure "return template_data.active" / "return td.active"
  if (/^\s*function\s*\([^)]*\)\s*\n?\s*return\s+\w+\.active\s*\n?\s*end\s*$/.test(body)) {
    return "active";
  }

  // template_data.active with additional logic
  if (/template_data\.active|td\.active|\w+\.active/.test(body) &&
      body.replace(/return\s+\w+\.active/, "").trim().length > "function() end".length) {
    // Only trigger if there's actually extra logic beyond the return
    const stripped = body
      .replace(/function\s*\([^)]*\)/, "")
      .replace(/end\s*$/, "")
      .replace(/return\s+\w+\.active/, "")
      .trim();
    if (stripped.length > 0) {
      return "active_and_unknown";
    }
  }

  // wielded_slot with slot name extraction
  const slotMatch = body.match(/wielded_slot\s*==\s*"(slot_\w+)"/);
  if (slotMatch) {
    return slotMatch[1];
  }

  // has_weapon_keyword_from_slot
  const keywordMatch = body.match(/has_weapon_keyword_from_slot\s*\([^,]+,\s*"(\w+)"\s*\)/);
  if (keywordMatch) {
    return `weapon_keyword:${keywordMatch[1]}`;
  }

  // Health threshold
  if (/current_health|health_percent/.test(body)) {
    return "threshold:health";
  }

  // Warp charge threshold
  if (/warp_charge/.test(body)) {
    return "threshold:warp_charge";
  }

  // Ammo/clip threshold
  if (/ammo|clip/.test(body)) {
    return "threshold:ammo";
  }

  // Coherency
  if (/coherency|num_units/.test(body)) {
    return "coherency";
  }

  return "unknown_condition";
}

/**
 * Tag a condition node from a parsed Lua buff template.
 *
 * Handles $ref (named ConditionalFunctions or local variable lookups),
 * $call (compound all/any), and $func (inline function bodies).
 *
 * @param {object} node - A parsed node with $ref, $call/$args, or $func.
 * @param {object} [localFunctions={}] - Map of local variable names to function body strings.
 * @returns {string} A semantic condition tag.
 */
export function tagCondition(node, localFunctions = {}) {
  if (!node || typeof node !== "object") {
    return "unknown_condition";
  }

  // Named ConditionalFunctions reference
  if (node.$ref && node.$ref.startsWith("ConditionalFunctions.")) {
    const tag = CONDITIONAL_TAGS[node.$ref];
    return tag ?? "unknown_condition";
  }

  // Compound all()/any()
  if (node.$call && node.$call.startsWith("ConditionalFunctions.")) {
    const combinator = node.$call.endsWith(".all") ? "all" : "any";
    const args = Array.isArray(node.$args) ? node.$args : [];
    const tags = args.map((arg) => tagCondition(arg, localFunctions));
    return `${combinator}:${tags.join("+")}`;
  }

  // Local function variable reference
  if (node.$ref && node.$ref in localFunctions) {
    return tagCondition({ $func: localFunctions[node.$ref] }, localFunctions);
  }

  // Inline function body
  if (node.$func) {
    return tagInlineFunc(node.$func);
  }

  return "unknown_condition";
}

/**
 * Tag a check_proc node from a parsed Lua buff template.
 *
 * Handles $ref (named CheckProcFunctions), $call (compound all/any),
 * and $func (inline function bodies).
 *
 * @param {object} node - A parsed node with $ref, $call/$args, or $func.
 * @returns {string} A semantic check_proc tag.
 */
export function tagCheckProc(node) {
  if (!node || typeof node !== "object") {
    return "unknown_condition";
  }

  // Named CheckProcFunctions reference — strip prefix
  if (node.$ref && node.$ref.startsWith("CheckProcFunctions.")) {
    return node.$ref.slice("CheckProcFunctions.".length);
  }

  // Compound all()/any()
  if (node.$call && node.$call.startsWith("CheckProcFunctions.")) {
    const combinator = node.$call.endsWith(".all") ? "all" : "any";
    const args = Array.isArray(node.$args) ? node.$args : [];
    const tags = args.map((arg) => tagCheckProc(arg));
    return `${combinator}:${tags.join("+")}`;
  }

  // Inline function body
  if (node.$func) {
    return tagInlineFunc(node.$func);
  }

  return "unknown_condition";
}
