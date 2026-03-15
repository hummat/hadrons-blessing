# Tree Edge Extraction Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reproducible script that extracts tree edges and tree_node entities from the 6 Darktide `*_tree.lua` files, replacing the hand-authored psyker edges and generating new data for the remaining 5 classes.

**Architecture:** A single extraction script (`scripts/extract-tree-edges.mjs`) parses Lua tree layouts via regex, emits `parent_of`, `belongs_to_tree_node`, and `exclusive_with` edge records plus `tree_node` entity records per class. Output is written to `data/ground-truth/edges/{domain}.json` and `data/ground-truth/entities/{domain}_tree.json`. Integrated into the build pipeline via `npm run edges:build`.

**Tech Stack:** Node.js ESM, no runtime dependencies. Regex-based Lua parsing.

**Spec:** `docs/superpowers/specs/2026-03-15-tree-edge-extraction-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `scripts/ground-truth/lib/lua-tree-parser.mjs` | Parse a `*_tree.lua` file into structured node objects |
| `scripts/ground-truth/lib/tree-edge-generator.mjs` | Transform parsed nodes into edge and entity records |
| `scripts/extract-tree-edges.mjs` | CLI entry point — reads source root, iterates classes, writes output |
| `scripts/tree-edges.test.mjs` | Tests for parser, generator, golden comparisons |
| `data/ground-truth/entities/{domain}_tree.json` | Generated tree_node entities (one per class) |
| `data/ground-truth/edges/{domain}.json` | Generated edge records (one per class) |

---

## Chunk 1: Lua Tree Parser

### Task 1: Lua tree parser — failing tests

**Files:**
- Create: `scripts/tree-edges.test.mjs`
- Create: `scripts/ground-truth/lib/lua-tree-parser.mjs`

- [ ] **Step 1: Write the failing test for `parseLuaTree`**

Create `scripts/tree-edges.test.mjs`:

```js
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { parseLuaTree } from "./ground-truth/lib/lua-tree-parser.mjs";

const SAMPLE_LUA = `
return {
  archetype_name = "test_class",
  nodes = {
    {
      widget_name = "node_aaaa-1111",
      talent = "not_selected",
      type = "start",
      cost = 0,
      max_points = 1,
      icon = "icon_start",
      x = 100,
      y = 200,
      children = {
        "node_bbbb-2222",
        "node_cccc-3333",
      },
      parents = {},
      requirements = {
        all_parents_chosen = false,
        children_unlock_points = 0,
        min_points_spent = 0,
      },
    },
    {
      widget_name = "node_bbbb-2222",
      talent = "test_talent_one",
      type = "default",
      cost = 1,
      max_points = 1,
      group_name = "group_a",
      icon = "icon_one",
      x = 150,
      y = 300,
      children = {},
      parents = {
        "node_aaaa-1111",
      },
      requirements = {
        all_parents_chosen = false,
        children_unlock_points = 0,
        min_points_spent = 0,
      },
    },
    {
      widget_name = "node_cccc-3333",
      talent = "test_talent_two",
      type = "default",
      cost = 1,
      max_points = 1,
      group_name = "group_a",
      icon = "icon_two",
      x = 250,
      y = 300,
      children = {},
      parents = {
        "node_aaaa-1111",
      },
      requirements = {
        all_parents_chosen = false,
        children_unlock_points = 0,
        min_points_spent = 0,
      },
    },
  },
}
`;

describe("parseLuaTree", () => {
  it("extracts all nodes from a Lua tree string", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    assert.equal(nodes.length, 3);
  });

  it("extracts widget_name, talent, type, and group_name", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    const start = nodes.find((n) => n.widget_name === "node_aaaa-1111");
    assert.equal(start.talent, "not_selected");
    assert.equal(start.type, "start");
    assert.equal(start.group_name, null);
  });

  it("extracts children arrays", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    const start = nodes.find((n) => n.widget_name === "node_aaaa-1111");
    assert.deepEqual(start.children, ["node_bbbb-2222", "node_cccc-3333"]);
  });

  it("extracts parents arrays", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    const child = nodes.find((n) => n.widget_name === "node_bbbb-2222");
    assert.deepEqual(child.parents, ["node_aaaa-1111"]);
  });

  it("extracts group_name when present", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    const grouped = nodes.find((n) => n.widget_name === "node_bbbb-2222");
    assert.equal(grouped.group_name, "group_a");
  });

  it("treats empty string group_name as null", () => {
    const lua = SAMPLE_LUA.replace('group_name = "group_a"', 'group_name = ""');
    const nodes = parseLuaTree(lua);
    const node = nodes.find((n) => n.widget_name === "node_bbbb-2222");
    assert.equal(node.group_name, null);
  });

  it("extracts line numbers for each node", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    for (const node of nodes) {
      assert.equal(typeof node.line, "number");
      assert.ok(node.line > 0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tree-edges.test.mjs`
Expected: FAIL — `lua-tree-parser.mjs` does not exist.

- [ ] **Step 3: Implement `parseLuaTree`**

Create `scripts/ground-truth/lib/lua-tree-parser.mjs`:

```js
/**
 * Parse a Darktide *_tree.lua file into structured node objects.
 *
 * The Lua files follow a rigid template — flat node tables with
 * string/number/array fields. We use regex extraction rather than
 * a full Lua parser.
 */

function extractStringField(block, fieldName) {
  const match = block.match(new RegExp(`${fieldName}\\s*=\\s*"([^"]*)"`, "m"));
  return match ? match[1] : null;
}

function extractStringArray(block, fieldName) {
  const arrayMatch = block.match(
    new RegExp(`${fieldName}\\s*=\\s*\\{([^}]*)\\}`, "m"),
  );
  if (!arrayMatch) return [];
  const entries = [];
  for (const m of arrayMatch[1].matchAll(/"([^"]+)"/g)) {
    entries.push(m[1]);
  }
  return entries;
}

function parseLuaTree(luaSource) {
  const nodes = [];
  // Split into node blocks by finding each { ... } entry inside nodes = { ... }
  // Each node starts with a top-level { inside the nodes table and ends with },
  // We find nodes by matching widget_name occurrences and extracting the surrounding block.

  const lines = luaSource.split("\n");
  let i = 0;

  while (i < lines.length) {
    const widgetMatch = lines[i].match(/widget_name\s*=\s*"([^"]+)"/);
    if (!widgetMatch) {
      i++;
      continue;
    }

    const widgetName = widgetMatch[1];
    const widgetLine = i + 1; // 1-indexed

    // Find the block boundaries — scan backward to the opening { and forward to the closing },
    let blockStart = i;
    while (blockStart > 0 && !lines[blockStart - 1].match(/^\s*\{$/)) {
      blockStart--;
    }

    let blockEnd = i;
    let depth = 0;
    for (let j = blockStart; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === "{") depth++;
        if (ch === "}") depth--;
      }
      if (depth <= 0) {
        blockEnd = j;
        break;
      }
    }

    const block = lines.slice(blockStart, blockEnd + 1).join("\n");

    nodes.push({
      widget_name: widgetName,
      talent: extractStringField(block, "talent"),
      type: extractStringField(block, "type"),
      group_name: extractStringField(block, "group_name") || null,
      children: extractStringArray(block, "children"),
      parents: extractStringArray(block, "parents"),
      line: widgetLine,
    });

    i = blockEnd + 1;
  }

  return nodes;
}

export { parseLuaTree };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/tree-edges.test.mjs`
Expected: All 6 tests PASS.

- [ ] **Step 5: Test against real Lua file**

Add to `scripts/tree-edges.test.mjs`:

```js
import { readFileSync } from "node:fs";
import { resolveSourceRoot } from "./ground-truth/lib/load.mjs";

const SOURCE_ROOT = resolveSourceRoot();

describe("parseLuaTree against real source", () => {
  it(
    "parses psyker_tree.lua and finds 87 nodes",
    { skip: SOURCE_ROOT == null },
    () => {
      const lua = readFileSync(
        `${SOURCE_ROOT}/scripts/ui/views/talent_builder_view/layouts/psyker_tree.lua`,
        "utf8",
      );
      const nodes = parseLuaTree(lua);
      assert.equal(nodes.length, 87);

      // Every node has a UUID widget_name
      for (const node of nodes) {
        assert.match(node.widget_name, /^node_[0-9a-f-]+$/);
        assert.ok(node.type);
        assert.ok(node.line > 0);
      }
    },
  );

  it(
    "parses veteran_tree.lua successfully",
    { skip: SOURCE_ROOT == null },
    () => {
      const lua = readFileSync(
        `${SOURCE_ROOT}/scripts/ui/views/talent_builder_view/layouts/veteran_tree.lua`,
        "utf8",
      );
      const nodes = parseLuaTree(lua);
      assert.ok(nodes.length > 0);
      assert.ok(nodes.some((n) => n.type === "start"));
    },
  );
});
```

Run: `node --test scripts/tree-edges.test.mjs`
Expected: All tests PASS (including real source tests if `.source-root` is set).

- [ ] **Step 6: Commit**

```bash
git add scripts/ground-truth/lib/lua-tree-parser.mjs scripts/tree-edges.test.mjs
git commit -m "feat: add Lua tree parser with tests"
```

---

## Chunk 2: Edge and Entity Generator

### Task 2: Tree edge and entity generator — failing tests

**Files:**
- Create: `scripts/ground-truth/lib/tree-edge-generator.mjs`
- Modify: `scripts/tree-edges.test.mjs`

- [ ] **Step 1: Write failing tests for edge generation**

Add to `scripts/tree-edges.test.mjs`:

```js
import {
  generateTreeEdges,
  generateTreeNodeEntities,
} from "./ground-truth/lib/tree-edge-generator.mjs";

const SNAPSHOT_ID = "darktide-source.test";
const TEST_DOMAIN = "testclass";
const LUA_PATH = "scripts/ui/views/talent_builder_view/layouts/testclass_tree.lua";

// Reuse SAMPLE_LUA from Task 1 (3 nodes: start + 2 default in group_a)

describe("generateTreeEdges", () => {
  it("generates parent_of edges from children arrays", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    const edges = generateTreeEdges(nodes, TEST_DOMAIN, SNAPSHOT_ID);
    const parentOf = edges.filter((e) => e.type === "parent_of");
    // start node has 2 children → 2 parent_of edges
    assert.equal(parentOf.length, 2);
    assert.ok(parentOf.some((e) =>
      e.id === `${TEST_DOMAIN}.edge.parent_of.node_aaaa-1111.node_bbbb-2222`
    ));
  });

  it("generates belongs_to_tree_node edges for non-start nodes", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    const edges = generateTreeEdges(nodes, TEST_DOMAIN, SNAPSHOT_ID);
    const belongs = edges.filter((e) => e.type === "belongs_to_tree_node");
    // 2 non-start nodes → 2 belongs_to edges
    assert.equal(belongs.length, 2);
    assert.ok(belongs.some((e) =>
      e.from_entity_id === `${TEST_DOMAIN}.talent.test_talent_one`
    ));
  });

  it("skips belongs_to_tree_node for start nodes", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    const edges = generateTreeEdges(nodes, TEST_DOMAIN, SNAPSHOT_ID);
    const belongs = edges.filter((e) => e.type === "belongs_to_tree_node");
    assert.ok(!belongs.some((e) =>
      e.from_entity_id.includes("not_selected")
    ));
  });

  it("generates exclusive_with edges from group_name", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    const edges = generateTreeEdges(nodes, TEST_DOMAIN, SNAPSHOT_ID);
    const exclusive = edges.filter((e) => e.type === "exclusive_with");
    // 2 nodes in group_a → C(2,2) = 1 exclusive_with edge
    assert.equal(exclusive.length, 1);
    // Lexicographic order: bbbb < cccc
    assert.equal(
      exclusive[0].id,
      `${TEST_DOMAIN}.edge.exclusive_with.node_bbbb-2222.node_cccc-3333`,
    );
  });

  it("produces edges with correct conditions boilerplate", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    const edges = generateTreeEdges(nodes, TEST_DOMAIN, SNAPSHOT_ID);
    for (const edge of edges) {
      assert.deepEqual(edge.conditions, {
        predicates: [],
        aggregation: "additive",
        stacking_mode: "binary",
        exclusive_scope: null,
      });
      assert.deepEqual(edge.calc, {});
      assert.deepEqual(edge.evidence_ids, []);
      assert.equal(edge.source_snapshot_id, SNAPSHOT_ID);
    }
  });
});

describe("generateTreeNodeEntities", () => {
  it("generates one entity per node", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    const entities = generateTreeNodeEntities(nodes, TEST_DOMAIN, SNAPSHOT_ID, LUA_PATH);
    assert.equal(entities.length, 3);
  });

  it("populates all required fields", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    const entities = generateTreeNodeEntities(nodes, TEST_DOMAIN, SNAPSHOT_ID, LUA_PATH);
    for (const entity of entities) {
      assert.equal(entity.kind, "tree_node");
      assert.equal(entity.domain, TEST_DOMAIN);
      assert.equal(entity.loc_key, null);
      assert.equal(entity.ui_name, null);
      assert.equal(entity.source_snapshot_id, SNAPSHOT_ID);
      assert.ok(entity.refs.length > 0);
      assert.equal(entity.refs[0].path, LUA_PATH);
      assert.deepEqual(entity.calc, {});
      assert.ok(entity.attributes);
      assert.ok(entity.attributes.tree_type);
    }
  });

  it("sets status based on tree_type", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    const entities = generateTreeNodeEntities(nodes, TEST_DOMAIN, SNAPSHOT_ID, LUA_PATH);
    for (const entity of entities) {
      assert.equal(entity.status, "source_backed");
    }
  });

  it("populates attributes with tree structure data", () => {
    const nodes = parseLuaTree(SAMPLE_LUA);
    const entities = generateTreeNodeEntities(nodes, TEST_DOMAIN, SNAPSHOT_ID, LUA_PATH);
    const start = entities.find((e) => e.internal_name === "node_aaaa-1111");
    assert.equal(start.attributes.tree_type, "start");
    assert.equal(start.attributes.talent_internal_name, null); // not_selected
    assert.deepEqual(start.attributes.children, ["node_bbbb-2222", "node_cccc-3333"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tree-edges.test.mjs`
Expected: FAIL — `tree-edge-generator.mjs` does not exist.

- [ ] **Step 3: Implement `generateTreeEdges` and `generateTreeNodeEntities`**

Create `scripts/ground-truth/lib/tree-edge-generator.mjs`:

```js
const TREE_TYPE_TO_KIND = {
  ability: "ability",
  aura: "aura",
  keystone: "keystone",
  tactical: "ability",
  ability_modifier: "talent_modifier",
  tactical_modifier: "talent_modifier",
  keystone_modifier: "talent_modifier",
  default: "talent",
  stat: "talent",
};

const CONDITIONS_BOILERPLATE = {
  predicates: [],
  aggregation: "additive",
  stacking_mode: "binary",
  exclusive_scope: null,
};

function makeEdge(id, type, fromId, toId, snapshotId) {
  return {
    id,
    type,
    from_entity_id: fromId,
    to_entity_id: toId,
    source_snapshot_id: snapshotId,
    conditions: { ...CONDITIONS_BOILERPLATE },
    calc: {},
    evidence_ids: [],
  };
}

function generateTreeEdges(nodes, domain, snapshotId) {
  const edges = [];

  // parent_of edges from children arrays
  for (const node of nodes) {
    for (const childName of node.children) {
      edges.push(
        makeEdge(
          `${domain}.edge.parent_of.${node.widget_name}.${childName}`,
          "parent_of",
          `${domain}.tree_node.${node.widget_name}`,
          `${domain}.tree_node.${childName}`,
          snapshotId,
        ),
      );
    }
  }

  // belongs_to_tree_node edges (talent entity → tree_node)
  for (const node of nodes) {
    if (node.type === "start" || node.talent === "not_selected") continue;
    const kind = TREE_TYPE_TO_KIND[node.type];
    if (!kind) {
      throw new Error(`Unknown tree node type "${node.type}" for widget ${node.widget_name}`);
    }
    edges.push(
      makeEdge(
        `${domain}.edge.belongs_to_tree_node.${node.talent}`,
        "belongs_to_tree_node",
        `${domain}.${kind}.${node.talent}`,
        `${domain}.tree_node.${node.widget_name}`,
        snapshotId,
      ),
    );
  }

  // exclusive_with edges from group_name
  const groups = new Map();
  for (const node of nodes) {
    if (!node.group_name) continue;
    if (!groups.has(node.group_name)) groups.set(node.group_name, []);
    groups.get(node.group_name).push(node.widget_name);
  }
  for (const members of groups.values()) {
    members.sort(); // lexicographic for deterministic pairing
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        edges.push(
          makeEdge(
            `${domain}.edge.exclusive_with.${members[i]}.${members[j]}`,
            "exclusive_with",
            `${domain}.tree_node.${members[i]}`,
            `${domain}.tree_node.${members[j]}`,
            snapshotId,
          ),
        );
      }
    }
  }

  edges.sort((a, b) => a.id.localeCompare(b.id));
  return edges;
}

function generateTreeNodeEntities(nodes, domain, snapshotId, luaPath) {
  const entities = [];

  for (const node of nodes) {
    entities.push({
      id: `${domain}.tree_node.${node.widget_name}`,
      kind: "tree_node",
      domain,
      internal_name: node.widget_name,
      loc_key: null,
      ui_name: null,
      status: "source_backed",
      refs: [{ path: luaPath, line: node.line }],
      source_snapshot_id: snapshotId,
      attributes: {
        tree_type: node.type,
        talent_internal_name: node.talent === "not_selected" ? null : node.talent,
        group_name: node.group_name ?? null,
        exclusive_group: null,
        children: node.children,
        parents: node.parents,
      },
      calc: {},
    });
  }

  entities.sort((a, b) => a.id.localeCompare(b.id));
  return entities;
}

export { generateTreeEdges, generateTreeNodeEntities, TREE_TYPE_TO_KIND };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/tree-edges.test.mjs`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/tree-edge-generator.mjs scripts/tree-edges.test.mjs
git commit -m "feat: add tree edge and entity generator with tests"
```

---

## Chunk 3: Implicit Node Detection and Psyker Golden Test

### Task 3: Detect implicit tree nodes

Nodes referenced in `children[]`/`parents[]` but not defined as primary nodes in the tree are "implicit references." The generator must emit entities for these too.

**Files:**
- Modify: `scripts/ground-truth/lib/tree-edge-generator.mjs`
- Modify: `scripts/tree-edges.test.mjs`

- [ ] **Step 1: Write failing test for implicit node detection**

Add to `scripts/tree-edges.test.mjs`:

```js
const SAMPLE_LUA_WITH_IMPLICIT = `
return {
  archetype_name = "test_class",
  nodes = {
    {
      widget_name = "node_aaaa-1111",
      talent = "not_selected",
      type = "start",
      cost = 0,
      max_points = 1,
      icon = "icon_start",
      x = 100,
      y = 200,
      children = {
        "node_bbbb-2222",
        "node_ffff-9999",
      },
      parents = {},
      requirements = {
        all_parents_chosen = false,
        children_unlock_points = 0,
        min_points_spent = 0,
      },
    },
    {
      widget_name = "node_bbbb-2222",
      talent = "test_talent_one",
      type = "default",
      cost = 1,
      max_points = 1,
      icon = "icon_one",
      x = 150,
      y = 300,
      children = {},
      parents = {
        "node_aaaa-1111",
      },
      requirements = {
        all_parents_chosen = false,
        children_unlock_points = 0,
        min_points_spent = 0,
      },
    },
  },
}
`;

describe("implicit node detection", () => {
  it("creates implicit_reference entities for nodes only in children/parents", () => {
    const nodes = parseLuaTree(SAMPLE_LUA_WITH_IMPLICIT);
    const entities = generateTreeNodeEntities(nodes, TEST_DOMAIN, SNAPSHOT_ID, LUA_PATH);
    const implicit = entities.find((e) => e.internal_name === "node_ffff-9999");
    assert.ok(implicit, "implicit node entity should be created");
    assert.equal(implicit.status, "partially_resolved");
    assert.equal(implicit.attributes.tree_type, "implicit_reference");
    assert.equal(implicit.attributes.talent_internal_name, null);
    assert.deepEqual(implicit.attributes.children, []);
    assert.deepEqual(implicit.attributes.parents, []);
  });

  it("parent_of edges work for implicit child nodes", () => {
    const nodes = parseLuaTree(SAMPLE_LUA_WITH_IMPLICIT);
    const edges = generateTreeEdges(nodes, TEST_DOMAIN, SNAPSHOT_ID);
    const toImplicit = edges.find(
      (e) => e.type === "parent_of" && e.to_entity_id.includes("node_ffff-9999"),
    );
    assert.ok(toImplicit, "parent_of edge to implicit node should exist");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tree-edges.test.mjs`
Expected: FAIL — implicit node entity not created.

- [ ] **Step 3: Add implicit node detection to `generateTreeNodeEntities`**

Modify `scripts/ground-truth/lib/tree-edge-generator.mjs` — add implicit node collection at the end of `generateTreeNodeEntities`:

```js
function generateTreeNodeEntities(nodes, domain, snapshotId, luaPath) {
  const entities = [];
  const definedNames = new Set(nodes.map((n) => n.widget_name));

  // Collect all referenced but undefined node names and their first occurrence line
  const implicitRefs = new Map(); // name → line of first reference
  for (const node of nodes) {
    for (const ref of [...node.children, ...node.parents]) {
      if (!definedNames.has(ref) && !implicitRefs.has(ref)) {
        implicitRefs.set(ref, node.line);
      }
    }
  }

  for (const node of nodes) {
    entities.push({
      id: `${domain}.tree_node.${node.widget_name}`,
      kind: "tree_node",
      domain,
      internal_name: node.widget_name,
      loc_key: null,
      ui_name: null,
      status: "source_backed",
      refs: [{ path: luaPath, line: node.line }],
      source_snapshot_id: snapshotId,
      attributes: {
        tree_type: node.type,
        talent_internal_name: node.talent === "not_selected" ? null : node.talent,
        group_name: node.group_name ?? null,
        exclusive_group: null,
        children: node.children,
        parents: node.parents,
      },
      calc: {},
    });
  }

  // Emit implicit reference entities
  for (const [name, refLine] of implicitRefs) {
    entities.push({
      id: `${domain}.tree_node.${name}`,
      kind: "tree_node",
      domain,
      internal_name: name,
      loc_key: null,
      ui_name: null,
      status: "partially_resolved",
      refs: [{ path: luaPath, line: refLine }],
      source_snapshot_id: snapshotId,
      attributes: {
        tree_type: "implicit_reference",
        talent_internal_name: null,
        group_name: null,
        exclusive_group: null,
        children: [],
        parents: [],
      },
      calc: {},
    });
  }

  entities.sort((a, b) => a.id.localeCompare(b.id));
  return entities;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/tree-edges.test.mjs`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/ground-truth/lib/tree-edge-generator.mjs scripts/tree-edges.test.mjs
git commit -m "feat: detect implicit tree node references"
```

### Task 4: Psyker golden comparison test

Verify the generator reproduces the existing hand-authored psyker edges (for `parent_of` and `belongs_to_tree_node`).

**Files:**
- Modify: `scripts/tree-edges.test.mjs`

- [ ] **Step 1: Write the golden comparison test**

Add to `scripts/tree-edges.test.mjs`:

```js
import { join } from "node:path";
import { REPO_ROOT } from "./ground-truth/lib/load.mjs";

describe("psyker golden comparison", () => {
  it(
    "generated parent_of and belongs_to_tree_node edges match hand-authored psyker edges",
    { skip: SOURCE_ROOT == null },
    () => {
      const lua = readFileSync(
        `${SOURCE_ROOT}/scripts/ui/views/talent_builder_view/layouts/psyker_tree.lua`,
        "utf8",
      );
      const nodes = parseLuaTree(lua);

      const existingEdges = JSON.parse(
        readFileSync(join(REPO_ROOT, "data/ground-truth/edges/psyker.json"), "utf8"),
      );
      const snapshotId = existingEdges[0].source_snapshot_id;

      const generatedEdges = generateTreeEdges(nodes, "psyker", snapshotId);

      // Compare only parent_of and belongs_to_tree_node (exclusive_with is new)
      const existingFiltered = existingEdges
        .filter((e) => e.type === "parent_of" || e.type === "belongs_to_tree_node")
        .sort((a, b) => a.id.localeCompare(b.id));

      const generatedFiltered = generatedEdges
        .filter((e) => e.type === "parent_of" || e.type === "belongs_to_tree_node")
        .sort((a, b) => a.id.localeCompare(b.id));

      assert.equal(generatedFiltered.length, existingFiltered.length,
        `edge count mismatch: generated ${generatedFiltered.length}, existing ${existingFiltered.length}`);

      for (let i = 0; i < existingFiltered.length; i++) {
        assert.deepEqual(generatedFiltered[i], existingFiltered[i],
          `mismatch at edge ${existingFiltered[i].id}`);
      }
    },
  );

  it(
    "generated psyker tree_node entities match existing count",
    { skip: SOURCE_ROOT == null },
    () => {
      const lua = readFileSync(
        `${SOURCE_ROOT}/scripts/ui/views/talent_builder_view/layouts/psyker_tree.lua`,
        "utf8",
      );
      const nodes = parseLuaTree(lua);
      const snapshotId = "darktide-source.dbe7035";
      const luaPath = "scripts/ui/views/talent_builder_view/layouts/psyker_tree.lua";

      const entities = generateTreeNodeEntities(nodes, "psyker", snapshotId, luaPath);

      // 87 primary + 22 implicit = 109 total (check psyker.json + psyker-implicit-tree-nodes.json)
      const existingPrimary = JSON.parse(
        readFileSync(join(REPO_ROOT, "data/ground-truth/entities/psyker.json"), "utf8"),
      ).filter((e) => e.kind === "tree_node");

      const implicitPath = join(REPO_ROOT, "data/ground-truth/entities/psyker-implicit-tree-nodes.json");
      const existingImplicit = JSON.parse(readFileSync(implicitPath, "utf8"));

      const expectedCount = existingPrimary.length + existingImplicit.length;
      assert.equal(entities.length, expectedCount,
        `entity count mismatch: generated ${entities.length}, expected ${expectedCount}`);
    },
  );

  // NOTE: This golden test reads psyker.json tree_nodes and psyker-implicit-tree-nodes.json,
  // which are removed in Task 6 (psyker migration). After migration, update this test to
  // compare against the generated psyker_tree.json entity count instead.

  it(
    "generated exclusive_with edges use correct pairwise count for psyker groups",
    { skip: SOURCE_ROOT == null },
    () => {
      const lua = readFileSync(
        `${SOURCE_ROOT}/scripts/ui/views/talent_builder_view/layouts/psyker_tree.lua`,
        "utf8",
      );
      const nodes = parseLuaTree(lua);
      const edges = generateTreeEdges(nodes, "psyker", "darktide-source.dbe7035");
      const exclusive = edges.filter((e) => e.type === "exclusive_with");
      // All exclusive_with edges should have lexicographically ordered UUIDs
      for (const e of exclusive) {
        const [, , , a, b] = e.id.split(".");
        assert.ok(a < b, `exclusive_with edge not lexicographically ordered: ${e.id}`);
      }
      assert.ok(exclusive.length > 0, "should have at least one exclusive_with edge");
    },
  );
});
```

- [ ] **Step 2: Run test to verify golden comparison passes**

Run: `node --test scripts/tree-edges.test.mjs`
Expected: All tests PASS. If the golden comparison fails, investigate and fix the generator to match the hand-authored data exactly.

- [ ] **Step 3: Commit**

```bash
git add scripts/tree-edges.test.mjs
git commit -m "test: add psyker golden comparison for tree edge generation"
```

---

## Chunk 4: CLI Entry Point and Psyker Migration

### Task 5: CLI entry point — `extract-tree-edges.mjs`

**Files:**
- Create: `scripts/extract-tree-edges.mjs`
- Modify: `package.json`

- [ ] **Step 1: Implement the CLI script**

Create `scripts/extract-tree-edges.mjs`:

```js
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  EDGES_ROOT,
  ENTITIES_ROOT,
} from "./ground-truth/lib/load.mjs";
import { validateSourceSnapshot } from "./ground-truth/lib/validate.mjs";
import { parseLuaTree } from "./ground-truth/lib/lua-tree-parser.mjs";
import {
  generateTreeEdges,
  generateTreeNodeEntities,
} from "./ground-truth/lib/tree-edge-generator.mjs";
import { runCliMain } from "./ground-truth/lib/cli.mjs";

const DOMAIN_MAP = {
  adamant: "arbites",
  broker: "hive_scum",
  ogryn: "ogryn",
  psyker: "psyker",
  veteran: "veteran",
  zealot: "zealot",
};

const TREE_DIR = "scripts/ui/views/talent_builder_view/layouts";

await runCliMain("edges:build", async () => {
  const snapshot = validateSourceSnapshot();
  const sourceRoot = snapshot.source_root;
  const snapshotId = snapshot.id;

  let totalEdges = 0;
  let totalEntities = 0;

  for (const [luaPrefix, domain] of Object.entries(DOMAIN_MAP)) {
    const luaFilename = `${luaPrefix}_tree.lua`;
    const luaPath = join(TREE_DIR, luaFilename);
    const luaFullPath = join(sourceRoot, luaPath);

    const luaSource = readFileSync(luaFullPath, "utf8");
    const nodes = parseLuaTree(luaSource);

    const edges = generateTreeEdges(nodes, domain, snapshotId);
    const entities = generateTreeNodeEntities(nodes, domain, snapshotId, luaPath);

    writeFileSync(
      join(EDGES_ROOT, `${domain}.json`),
      JSON.stringify(edges, null, 2) + "\n",
    );

    writeFileSync(
      join(ENTITIES_ROOT, `${domain}_tree.json`),
      JSON.stringify(entities, null, 2) + "\n",
    );

    totalEdges += edges.length;
    totalEntities += entities.length;
    console.log(`  ${domain}: ${edges.length} edges, ${entities.length} tree_node entities`);
  }

  console.log(`\nTotal: ${totalEdges} edges, ${totalEntities} tree_node entities across ${Object.keys(DOMAIN_MAP).length} classes`);
});
```

- [ ] **Step 2: Add npm script and SETUP_HINTS entry**

Add to `package.json` scripts:

```json
"edges:build": "node scripts/extract-tree-edges.mjs"
```

Add to `SETUP_HINTS` in `scripts/ground-truth/lib/cli.mjs`:

```js
"edges:build":
  "GROUND_TRUTH_SOURCE_ROOT=/path/to/Darktide-Source-Code npm run edges:build",
```

- [ ] **Step 3: Run it and verify output**

Run: `npm run edges:build`
Expected: Prints per-class counts. Creates/overwrites `data/ground-truth/edges/{domain}.json` and `data/ground-truth/entities/{domain}_tree.json` for all 6 classes.

- [ ] **Step 4: Commit the script and npm config (not the generated data yet)**

```bash
git add scripts/extract-tree-edges.mjs package.json
git commit -m "feat: add edges:build CLI entry point"
```

### Task 6: Psyker migration — remove hand-authored tree_node entities

**Files:**
- Modify: `data/ground-truth/entities/psyker.json` — remove tree_node records
- Delete: `data/ground-truth/entities/psyker-implicit-tree-nodes.json`

- [ ] **Step 1: Write a script to strip tree_node entities from psyker.json**

Run inline (one-time migration, not a persistent script):

```bash
node -e "
import { readFileSync, writeFileSync } from 'fs';
const entities = JSON.parse(readFileSync('data/ground-truth/entities/psyker.json', 'utf8'));
const filtered = entities.filter(e => e.kind !== 'tree_node');
console.log('Removed', entities.length - filtered.length, 'tree_node entities from psyker.json');
console.log('Remaining:', filtered.length, 'entities');
writeFileSync('data/ground-truth/entities/psyker.json', JSON.stringify(filtered, null, 2) + '\n');
"
```

Expected: Removed 87 tree_node entities, remaining ~111 entities.

- [ ] **Step 2: Delete the implicit tree nodes file**

```bash
rm data/ground-truth/entities/psyker-implicit-tree-nodes.json
```

- [ ] **Step 3: Run `npm run edges:build` to regenerate psyker tree data**

Run: `npm run edges:build`
Expected: `psyker_tree.json` and `edges/psyker.json` regenerated.

- [ ] **Step 4: Run full test suite to verify nothing broke**

Run: `npm test`
Expected: All tests pass. The index builder should find all entities via the new shard paths.

- [ ] **Step 5: Commit the migration**

```bash
git add data/ground-truth/entities/psyker.json data/ground-truth/entities/psyker_tree.json data/ground-truth/edges/psyker.json
git rm data/ground-truth/entities/psyker-implicit-tree-nodes.json
git commit -m "refactor: migrate psyker tree_node entities to generated shard"
```

---

## Chunk 5: Generate All Classes, Integration, and Makefile

### Task 7: Generate and commit edge data for all 6 classes

**Files:**
- Create: `data/ground-truth/edges/{veteran,zealot,ogryn,arbites,hive_scum}.json`
- Create: `data/ground-truth/entities/{veteran,zealot,ogryn,arbites,hive_scum}_tree.json`

- [ ] **Step 1: Run the generator**

Run: `npm run edges:build`
Expected: All 6 classes processed. Edge files and entity shards written.

- [ ] **Step 2: Run `npm test` to verify index integrity**

Run: `npm test`
Expected: All tests pass. The index builder validates referential integrity of the new edges.

- [ ] **Step 3: Run `npm run index:check` for the full validation pass**

Run: `npm run index:check`
Expected: Pass — all edges reference real entities, snapshot IDs match.

- [ ] **Step 4: Commit the generated data**

```bash
git add data/ground-truth/edges/ data/ground-truth/entities/*_tree.json
git commit -m "feat: generate tree edges and entities for all 6 classes"
```

### Task 8: Makefile integration

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Add `edges-build` target to Makefile**

Add `edges-build` to the `.PHONY` declaration and add the target before the existing `check` target:

```makefile
.PHONY: ... edges-build ...

edges-build: require-source-root
	GROUND_TRUTH_SOURCE_ROOT=$(GROUND_TRUTH_SOURCE_ROOT) npm run edges:build

check: require-source-root edges-build
	GROUND_TRUTH_SOURCE_ROOT=$(GROUND_TRUTH_SOURCE_ROOT) npm run check
```

Note: update the existing `check` target to depend on `edges-build`.

- [ ] **Step 2: Run `make check` to verify end-to-end**

Run: `make check`
Expected: `edges:build` runs first, then `index:build`, tests, and `index:check` all pass.

- [ ] **Step 3: Commit**

```bash
git add Makefile
git commit -m "build: add edges:build to make check pipeline"
```

### Task 9: Idempotency test and test file registration

**Files:**
- Modify: `scripts/tree-edges.test.mjs`
- Modify: `package.json` (add test file to test script)

- [ ] **Step 1: Add idempotency test**

Add to `scripts/tree-edges.test.mjs`:

```js
describe("idempotency", () => {
  it(
    "running the generator twice produces identical output",
    { skip: SOURCE_ROOT == null },
    () => {
      const lua = readFileSync(
        `${SOURCE_ROOT}/scripts/ui/views/talent_builder_view/layouts/psyker_tree.lua`,
        "utf8",
      );
      const nodes = parseLuaTree(lua);
      const snapshotId = "darktide-source.dbe7035";
      const luaPath = "scripts/ui/views/talent_builder_view/layouts/psyker_tree.lua";

      const edges1 = generateTreeEdges(nodes, "psyker", snapshotId);
      const edges2 = generateTreeEdges(nodes, "psyker", snapshotId);
      assert.deepEqual(edges1, edges2);

      const entities1 = generateTreeNodeEntities(nodes, "psyker", snapshotId, luaPath);
      const entities2 = generateTreeNodeEntities(nodes, "psyker", snapshotId, luaPath);
      assert.deepEqual(entities1, entities2);
    },
  );
});
```

- [ ] **Step 2: Register test file in `package.json` test script**

Add `scripts/tree-edges.test.mjs` to the `test` script's file list in `package.json`.

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass, including the new tree-edges test file.

- [ ] **Step 4: Run `make check` for final verification**

Run: `make check`
Expected: Full green — edges:build, index:build, all tests, index:check.

- [ ] **Step 5: Commit**

```bash
git add scripts/tree-edges.test.mjs package.json
git commit -m "test: add idempotency test and register tree-edges test file"
```

### Task 10: Update project memory

- [ ] **Step 1: Update `project_current_state.md` memory with new edge counts and test counts**
