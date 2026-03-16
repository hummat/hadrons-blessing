/**
 * Parses Lua table literals into JavaScript objects.
 *
 * Handles the subset of Lua syntax found in Darktide buff/talent template files:
 * nested tables, bracket-subscript keys, inline functions, identifier references,
 * arithmetic expressions, and function calls.
 *
 * Unresolvable constructs are represented as typed sentinel nodes:
 *   { $ref: "dotted.name" }   — identifier / enum reference
 *   { $func: "<body>" }       — inline function literal
 *   { $expr: "<text>" }       — arithmetic expression
 *   { $call: "Name", $args: [...] } — function call
 */

// -- Token types --------------------------------------------------------------

const T = Object.freeze({
  LBRACE: "LBRACE",
  RBRACE: "RBRACE",
  LBRACKET: "LBRACKET",
  RBRACKET: "RBRACKET",
  LPAREN: "LPAREN",
  RPAREN: "RPAREN",
  EQUALS: "EQUALS",
  COMMA: "COMMA",
  NUMBER: "NUMBER",
  STRING: "STRING",
  TRUE: "TRUE",
  FALSE: "FALSE",
  NIL: "NIL",
  IDENT: "IDENT",       // bare or dotted identifier (e.g. "foo" or "foo.bar.baz")
  FUNCTION: "FUNCTION",  // function...end block (body captured as text)
  OP: "OP",              // arithmetic operator: + - * /
  EOF: "EOF",
});

// -- Comment stripping --------------------------------------------------------

/**
 * Strip Lua line comments (--) and block comments (--[[ ... ]]).
 * Preserves string literals from accidental stripping.
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    // Double-quoted string
    if (src[i] === '"') {
      const end = findStringEnd(src, i, '"');
      out += src.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    // Single-quoted string
    if (src[i] === "'") {
      const end = findStringEnd(src, i, "'");
      out += src.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    // Block comment: --[[ ... ]]
    if (src[i] === "-" && src[i + 1] === "-" && src[i + 2] === "[" && src[i + 3] === "[") {
      const closeIdx = src.indexOf("]]", i + 4);
      if (closeIdx !== -1) {
        i = closeIdx + 2;
      } else {
        // Unterminated block comment — skip rest
        i = src.length;
      }
      continue;
    }
    // Line comment: --
    if (src[i] === "-" && src[i + 1] === "-") {
      const nl = src.indexOf("\n", i);
      if (nl !== -1) {
        out += src.slice(nl, nl + 1); // keep the newline
        i = nl + 1;
      } else {
        i = src.length;
      }
      continue;
    }
    out += src[i];
    i++;
  }
  return out;
}

/** Find closing quote, respecting backslash escapes. */
function findStringEnd(src, start, quote) {
  for (let i = start + 1; i < src.length; i++) {
    if (src[i] === "\\" && i + 1 < src.length) {
      i++; // skip escaped char
      continue;
    }
    if (src[i] === quote) return i;
  }
  return src.length - 1; // unterminated — return last index
}

// -- Tokenizer ----------------------------------------------------------------

/**
 * Tokenize Lua source (after comment stripping) into a token array.
 */
function tokenize(src) {
  const tokens = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    // Whitespace
    if (/\s/.test(ch)) { i++; continue; }

    // Single-char punctuation
    if (ch === "{") { tokens.push({ type: T.LBRACE }); i++; continue; }
    if (ch === "}") { tokens.push({ type: T.RBRACE }); i++; continue; }
    if (ch === "[") { tokens.push({ type: T.LBRACKET }); i++; continue; }
    if (ch === "]") { tokens.push({ type: T.RBRACKET }); i++; continue; }
    if (ch === "(") { tokens.push({ type: T.LPAREN }); i++; continue; }
    if (ch === ")") { tokens.push({ type: T.RPAREN }); i++; continue; }
    if (ch === "=") { tokens.push({ type: T.EQUALS }); i++; continue; }
    if (ch === ",") { tokens.push({ type: T.COMMA }); i++; continue; }

    // Arithmetic operators (except - which needs context)
    if (ch === "+" || ch === "*" || ch === "/") {
      tokens.push({ type: T.OP, value: ch }); i++; continue;
    }

    // String literals
    if (ch === '"' || ch === "'") {
      const end = findStringEnd(src, i, ch);
      const raw = src.slice(i + 1, end);
      tokens.push({ type: T.STRING, value: raw });
      i = end + 1;
      continue;
    }

    // Number literals (including negative: handled contextually via OP "-")
    if (/[0-9]/.test(ch) || (ch === "." && i + 1 < src.length && /[0-9]/.test(src[i + 1]))) {
      let numStr = "";
      while (i < src.length && /[0-9.eE+\-x]/.test(src[i])) {
        numStr += src[i];
        i++;
      }
      tokens.push({ type: T.NUMBER, value: Number(numStr) });
      continue;
    }

    // Minus: could be OP or part of negative number
    if (ch === "-") {
      tokens.push({ type: T.OP, value: "-" });
      i++;
      continue;
    }

    // Identifiers and keywords (including dotted chains like stat_buffs.foo)
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = "";
      while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) {
        ident += src[i];
        i++;
      }

      // function...end: capture the body as opaque text
      if (ident === "function") {
        const funcResult = captureFunctionBody(src, i);
        tokens.push({ type: T.FUNCTION, value: funcResult.body });
        i = funcResult.endPos;
        continue;
      }

      // Absorb dotted chain: foo.bar.baz
      while (i < src.length && src[i] === "." && i + 1 < src.length && /[a-zA-Z_]/.test(src[i + 1])) {
        ident += ".";
        i++;
        while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) {
          ident += src[i];
          i++;
        }
      }

      // Map keywords
      if (ident === "true")  { tokens.push({ type: T.TRUE }); continue; }
      if (ident === "false") { tokens.push({ type: T.FALSE }); continue; }
      if (ident === "nil")   { tokens.push({ type: T.NIL }); continue; }

      tokens.push({ type: T.IDENT, value: ident });
      continue;
    }

    // Skip unknown chars
    i++;
  }

  tokens.push({ type: T.EOF });
  return tokens;
}

/**
 * Capture a function body from `(` through the matching `end`, counting
 * nested function/if/do/for/while...end pairs.
 *
 * @param {string} src  Source text
 * @param {number} pos  Position right after the "function" keyword
 * @returns {{ body: string, endPos: number }}
 */
function captureFunctionBody(src, pos) {
  // The body starts at pos (right after "function")
  const bodyStart = pos;
  let depth = 1;
  let i = pos;

  // We need to track word boundaries to match keywords
  while (i < src.length && depth > 0) {
    const ch = src[i];

    // Skip string literals
    if (ch === '"' || ch === "'") {
      i = findStringEnd(src, i, ch) + 1;
      continue;
    }

    // Check for keyword at word boundary
    if (/[a-zA-Z_]/.test(ch)) {
      let word = "";
      const wStart = i;
      while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) {
        word += src[i];
        i++;
      }

      // Keywords that open a block (need matching end)
      if (word === "function" || word === "if" || word === "do" || word === "for" || word === "while") {
        depth++;
      } else if (word === "end") {
        depth--;
      }
      continue;
    }

    i++;
  }

  // i is now right after the closing "end"
  const body = src.slice(bodyStart, i - 3).trim(); // -3 to strip "end"
  return { body, endPos: i };
}

// -- Parser -------------------------------------------------------------------

/**
 * Parse a Lua table literal string into a JavaScript value.
 *
 * @param {string} luaText - A string containing a Lua table literal, e.g. "{ key = 1, ... }"
 * @returns {Object|Array} The parsed JavaScript object or array
 */
function parseLuaTable(luaText) {
  const cleaned = stripComments(luaText);
  const tokens = tokenize(cleaned);
  let pos = 0;

  function peek() { return tokens[pos]; }
  function advance() { return tokens[pos++]; }
  function expect(type) {
    const tok = advance();
    if (tok.type !== type) {
      throw new Error(`Expected ${type}, got ${tok.type} (value: ${JSON.stringify(tok.value)}) at token index ${pos - 1}`);
    }
    return tok;
  }

  function parseValue() {
    const tok = peek();

    if (tok.type === T.LBRACE) {
      return parseTable();
    }
    if (tok.type === T.STRING) {
      advance();
      return tok.value;
    }
    if (tok.type === T.NUMBER) {
      advance();
      return maybeExpr(tok.value, String(tok.value));
    }
    if (tok.type === T.TRUE) { advance(); return true; }
    if (tok.type === T.FALSE) { advance(); return false; }
    if (tok.type === T.NIL) { advance(); return null; }
    if (tok.type === T.FUNCTION) {
      advance();
      return { $func: tok.value };
    }

    // Unary minus before a number → negative literal
    if (tok.type === T.OP && tok.value === "-") {
      advance();
      const next = peek();
      if (next.type === T.NUMBER) {
        advance();
        const numVal = -next.value;
        return maybeExpr(numVal, `-${next.value}`);
      }
      // Minus before an identifier → expression
      if (next.type === T.IDENT) {
        const ref = advance().value;
        const exprText = `-${ref}`;
        return maybeExpr({ $ref: ref }, exprText);
      }
      throw new Error(`Unexpected token after unary minus: ${next.type}`);
    }

    // Identifier (possibly dotted)
    if (tok.type === T.IDENT) {
      advance();
      const ident = tok.value;

      // Check for function call: IDENT(
      if (peek().type === T.LPAREN) {
        return parseFunctionCall(ident);
      }

      // Otherwise it's a reference — but check for arithmetic
      return maybeExpr({ $ref: ident }, ident);
    }

    throw new Error(`Unexpected token: ${tok.type} (value: ${JSON.stringify(tok.value)}) at token index ${pos}`);
  }

  /**
   * After parsing a primary value, check if the next token is an arithmetic
   * operator. If so, consume it and the RHS to produce an $expr node.
   */
  function maybeExpr(leftVal, leftText) {
    if (peek().type === T.OP) {
      const op = advance().value;
      const rightTok = peek();
      let rightText;

      if (rightTok.type === T.NUMBER) {
        advance();
        rightText = String(rightTok.value);
      } else if (rightTok.type === T.IDENT) {
        advance();
        rightText = rightTok.value;
      } else if (rightTok.type === T.OP && rightTok.value === "-") {
        advance();
        const numTok = advance();
        rightText = `-${numTok.value}`;
      } else {
        throw new Error(`Unexpected RHS in expression: ${rightTok.type}`);
      }

      return { $expr: `${leftText} ${op} ${rightText}` };
    }
    return leftVal;
  }

  /**
   * Parse a function call: ident(arg1, arg2, ...)
   */
  function parseFunctionCall(name) {
    expect(T.LPAREN);
    const args = [];
    while (peek().type !== T.RPAREN && peek().type !== T.EOF) {
      args.push(parseValue());
      if (peek().type === T.COMMA) advance();
    }
    expect(T.RPAREN);
    return { $call: name, $args: args };
  }

  /**
   * Parse a table literal: { ... }
   *
   * Determines whether it's an object (has keyed entries) or array (positional only).
   * Mixed tables are treated as objects (positional entries get numeric keys).
   */
  function parseTable() {
    expect(T.LBRACE);

    const entries = [];
    let hasKeys = false;
    let hasPositional = false;

    while (peek().type !== T.RBRACE && peek().type !== T.EOF) {
      const entry = parseTableEntry();
      if (entry.keyed) {
        hasKeys = true;
      } else {
        hasPositional = true;
      }
      entries.push(entry);
      if (peek().type === T.COMMA) advance();
    }

    expect(T.RBRACE);

    // If all entries are positional → array
    if (hasPositional && !hasKeys) {
      return entries.map((e) => e.value);
    }

    // Otherwise → object
    const obj = {};
    let autoIndex = 1;
    for (const e of entries) {
      if (e.keyed) {
        obj[e.key] = e.value;
      } else {
        obj[autoIndex++] = e.value;
      }
    }
    return obj;
  }

  /**
   * Parse a single table entry. Returns { keyed: bool, key?, value }.
   */
  function parseTableEntry() {
    // Bracket-subscript key: [expr] = value
    if (peek().type === T.LBRACKET) {
      advance();
      // Collect key expression tokens until ]
      let keyText = "";
      while (peek().type !== T.RBRACKET && peek().type !== T.EOF) {
        const t = advance();
        if (t.type === T.IDENT) keyText += t.value;
        else if (t.type === T.NUMBER) keyText += String(t.value);
        else if (t.type === T.STRING) keyText += t.value;
      }
      expect(T.RBRACKET);
      expect(T.EQUALS);
      const value = parseValue();
      return { keyed: true, key: keyText, value };
    }

    // Identifier key: name = value (lookahead for =)
    if (peek().type === T.IDENT && pos + 1 < tokens.length && tokens[pos + 1].type === T.EQUALS) {
      const key = advance().value;
      expect(T.EQUALS);
      const value = parseValue();
      return { keyed: true, key, value };
    }

    // Positional value
    const value = parseValue();
    return { keyed: false, value };
  }

  const result = parseValue();
  return result;
}

export { parseLuaTable };
