/**
 * Condition tagger — maps Lua function references ($ref, $call, $func nodes)
 * to human-readable semantic condition tags.
 *
 * Used by the buff semantic parser to annotate effects with their activation
 * conditions (e.g. "wielded", "on_kill", "weapon_keyword:bolter").
 */

/** Sentinel node types from the Lua parser. */
export interface LuaRefNode {
  $ref: string;
}

export interface LuaCallNode {
  $call: string;
  $args: LuaConditionNode[];
}

export interface LuaFuncNode {
  $func: string;
}

export type LuaConditionNode = LuaRefNode | LuaCallNode | LuaFuncNode;

const CONDITIONAL_TAGS: Record<string, string> = {
  "ConditionalFunctions.is_item_slot_wielded": "wielded",
  "ConditionalFunctions.is_item_slot_not_wielded": "not_wielded",
  "ConditionalFunctions.is_sprinting": "sprinting",
  "ConditionalFunctions.is_blocking": "blocking",
  "ConditionalFunctions.is_lunging": "lunging",
  "ConditionalFunctions.is_reloading": "reloading",
  "ConditionalFunctions.is_alternative_fire": "ads_active",
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
 *
 * $func bodies captured by the tokenizer do NOT include the outer
 * `function` keyword or closing `end` — they start with the parameter list.
 */
function tagInlineFunc(body: string): string {
  if (/return\s+\w+\.(?:is_)?active\s*$/.test(body.trim()) ||
      /^\s*function\s*\([^)]*\)\s*\n?\s*return\s+\w+\.active\s*\n?\s*end\s*$/.test(body)) {
    return "active";
  }

  if (/template_data\.active|td\.active|\w+\.active/.test(body) &&
      body.replace(/return\s+\w+\.active/, "").trim().length > "function() end".length) {
    const stripped = body
      .replace(/function\s*\([^)]*\)/, "")
      .replace(/end\s*$/, "")
      .replace(/return\s+\w+\.active/, "")
      .trim();
    if (stripped.length > 0) {
      return "active_and_unknown";
    }
  }

  if (/params\.is_heavy\b|melee_attack_strength\s*==\s*"heavy"/.test(body)) {
    return "during_heavy";
  }

  const slotMatch = body.match(/wielded_slot\s*==\s*"(slot_\w+)"/);
  if (slotMatch) {
    return slotMatch[1];
  }

  const keywordMatch = body.match(/has_weapon_keyword_from_slot\s*\([^,]+,\s*"(\w+)"\s*\)/);
  if (keywordMatch) {
    return `weapon_keyword:${keywordMatch[1]}`;
  }

  if (/alternate_fire_component[.\w]*\.is_active/.test(body)) {
    return "ads_active";
  }

  if (/kind\s*==\s*"windup"/.test(body)) {
    return "during_windup";
  }

  if (/is_reloading|reload_shotgun|reload_state|ranged_load_special/.test(body)) {
    return "during_reload";
  }

  if (/current_toughness_percent/.test(body)) {
    return "threshold:toughness_high";
  }

  if (/stamina.*current_fraction|current_stamina_fraction/.test(body)) {
    if (/conditional_threshold/.test(body)) {
      return "threshold:stamina_full";
    }
    return "threshold:stamina_high";
  }

  if (/current_health|health_percent/.test(body)) {
    if (/health_percent\s*\(\s*\)\s*<|current_health[^>]*</.test(body)) {
      return "threshold:health_low";
    }
    return "threshold:health";
  }

  if (/has_keyword\s*\(\s*keywords\.\w*combat_ability/.test(body) ||
      /has_unique_buff_id\s*\(\s*".*invisibility"/.test(body)) {
    return "ability_active";
  }

  if (/is_perfect_blocking/.test(body)) {
    return "perfect_block";
  }

  if (/method\s*==\s*"sliding"/.test(body)) {
    return "sliding";
  }

  if (/velocity.*STANDING_STILL|standing_still/.test(body)) {
    return "standing_still";
  }

  if (/warp_charge/.test(body)) {
    return "threshold:warp_charge";
  }

  if (/ammo|clip/.test(body)) {
    return "threshold:ammo";
  }

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
 */
export function tagCondition(
  node: LuaConditionNode | null | undefined,
  localFunctions: Record<string, string> = {},
): string {
  if (!node || typeof node !== "object") {
    return "unknown_condition";
  }

  // Named ConditionalFunctions reference
  if ("$ref" in node && node.$ref.startsWith("ConditionalFunctions.")) {
    const tag = CONDITIONAL_TAGS[node.$ref];
    return tag ?? "unknown_condition";
  }

  // Compound all()/any()
  if ("$call" in node && node.$call.startsWith("ConditionalFunctions.")) {
    const combinator = node.$call.endsWith(".all") ? "all" : "any";
    const args = Array.isArray(node.$args) ? node.$args : [];
    const tags = args.map((arg) => tagCondition(arg, localFunctions));
    return `${combinator}:${tags.join("+")}`;
  }

  // Local function variable reference
  if ("$ref" in node && node.$ref in localFunctions) {
    return tagCondition({ $func: localFunctions[node.$ref] }, localFunctions);
  }

  // Inline function body
  if ("$func" in node) {
    return tagInlineFunc(node.$func);
  }

  return "unknown_condition";
}

/**
 * Tag a check_proc node from a parsed Lua buff template.
 *
 * Handles $ref (named CheckProcFunctions), $call (compound all/any),
 * and $func (inline function bodies).
 */
export function tagCheckProc(node: LuaConditionNode | null | undefined): string {
  if (!node || typeof node !== "object") {
    return "unknown_condition";
  }

  // Named CheckProcFunctions reference — strip prefix
  if ("$ref" in node && node.$ref.startsWith("CheckProcFunctions.")) {
    return node.$ref.slice("CheckProcFunctions.".length);
  }

  // Compound all()/any()
  if ("$call" in node && node.$call.startsWith("CheckProcFunctions.")) {
    const combinator = node.$call.endsWith(".all") ? "all" : "any";
    const args = Array.isArray(node.$args) ? node.$args : [];
    const tags = args.map((arg) => tagCheckProc(arg));
    return `${combinator}:${tags.join("+")}`;
  }

  // Inline function body
  if ("$func" in node) {
    return tagInlineFunc(node.$func);
  }

  return "unknown_condition";
}
