# Tree Edge Extraction Pipeline

> Date: 2026-03-15
> Status: Approved

## Problem

Only psyker has tree edges (249 hand-authored records). The other 5 classes (veteran, zealot, ogryn, arbites, hive_scum) have no edge data. The psyker edges were created in a one-shot session with no reproducible tooling — if the source changes or mistakes are found, re-derivation is manual.

Tree edges are prerequisite for talent path validation, per-instance stat node resolution, and BetterBots #38 (talent-aware bot behavior).

## Constraints

- Zero runtime dependencies. The extraction script uses only Node.js builtins.
- The Lua tree files (`*_tree.lua`) follow a rigid template: flat node tables with string/number/array fields. No nested tables beyond `children[]`/`parents[]`. Regex-based parsing is sufficient.
- Domain names in the Lua filenames differ from entity domains: `adamant` → `arbites`, `broker` → `hive_scum`. Others are identity-mapped.
- The script must read the source root via `resolveSourceRoot()` (env var → `.source-root` file).
- Generated output must pass the existing index builder validation (referential integrity, snapshot ID matching).

## Design

### Extraction script

`scripts/extract-tree-edges.mjs` — reads all 6 `*_tree.lua` files from the pinned source root.

**Parsing**: Regex-based extraction of node blocks. Each node yields its `widget_name` (UUID), `talent` (internal name or `"not_selected"`), `type` (start/default/keystone/ability/etc.), `group_name` (optional), and `children[]` array.

**Domain mapping**:

| Lua filename prefix | Entity domain |
|---------------------|---------------|
| `adamant`           | `arbites`     |
| `broker`            | `hive_scum`   |
| `ogryn`             | `ogryn`       |
| `psyker`            | `psyker`      |
| `veteran`           | `veteran`     |
| `zealot`            | `zealot`      |

### Edge types generated

**`parent_of`** — one edge per entry in a node's `children[]` array. Represents the directed tree DAG.
- ID: `{domain}.edge.parent_of.{parent_uuid}.{child_uuid}`
- From: `{domain}.tree_node.node_{parent_uuid}`
- To: `{domain}.tree_node.node_{child_uuid}`

**`belongs_to_tree_node`** — links a talent/ability/keystone entity to its containing tree node. Skipped for start nodes (`talent = "not_selected"`).
- ID: `{domain}.edge.belongs_to_tree_node.{talent_internal_name}`
- From: `{domain}.{kind}.{talent_internal_name}`
- To: `{domain}.tree_node.node_{uuid}`
- Kind inference from node `type`:

| Tree node type       | Entity kind       |
|----------------------|-------------------|
| `"ability"`          | `ability`         |
| `"aura"`             | `aura`            |
| `"keystone"`         | `keystone`        |
| `"tactical"`         | `ability`         |
| `"ability_modifier"` | `talent_modifier` |
| `"tactical_modifier"`| `talent_modifier` |
| `"keystone_modifier"`| `talent_modifier` |
| `"default"`          | `talent`          |
| `"stat"`             | `talent`          |
| `"start"`            | skipped           |

**`exclusive_with`** — pairwise edges between all nodes sharing a `group_name`. Ordered lexicographically by UUID to avoid duplicates (A↔B emitted once, not both A→B and B→A).
- ID: `{domain}.edge.exclusive_with.{uuid_a}.{uuid_b}` (where `uuid_a < uuid_b`)
- From: `{domain}.tree_node.node_{uuid_a}`
- To: `{domain}.tree_node.node_{uuid_b}`

All edges carry the standard boilerplate: `conditions` with empty predicates, `additive` aggregation, `binary` stacking, `null` exclusive_scope. Empty `calc: {}` and `evidence_ids: []`.

### Tree node entities

The script also emits tree_node entity records into dedicated shards: `data/ground-truth/entities/{domain}_tree.json`.

Each node in the Lua file becomes an entity with the full schema shape:

```json
{
  "id": "{domain}.tree_node.node_{uuid}",
  "domain": "{domain}",
  "kind": "tree_node",
  "internal_name": "node_{uuid}",
  "loc_key": null,
  "ui_name": null,
  "status": "source_backed",
  "source_snapshot_id": "darktide-source.dbe7035",
  "refs": [{ "path": "scripts/ui/views/talent_builder_view/layouts/{class}_tree.lua", "line": N }],
  "attributes": {
    "tree_type": "{node_type}",
    "talent_internal_name": "{talent}" | null,
    "group_name": "{group_name}" | null,
    "exclusive_group": null,
    "children": ["{child_uuid}", ...],
    "parents": ["{parent_uuid}", ...]
  },
  "calc": {}
}
```

Nodes referenced in `children[]`/`parents[]` arrays but not defined as primary nodes in the tree (implicit references) get `tree_type: "implicit_reference"`, `talent_internal_name: null`, `status: "partially_resolved"`, empty `children`/`parents` arrays, and refs pointing to their first occurrence line.

Separate `_tree.json` shards keep generated output isolated from hand-authored entity records. The generator owns these files entirely — re-running replaces them.

### Psyker migration

Psyker's existing hand-authored tree_node entities live in two files:
- `entities/psyker.json` — 87 tree_nodes (with `status: "source_backed"`, alongside talents/abilities/etc.)
- `entities/psyker-implicit-tree-nodes.json` — 22 tree_nodes (with `tree_type: "implicit_reference"`, `status: "partially_resolved"`)

Both are consolidated into the generator-owned `entities/psyker_tree.json`. The generator produces both primary and implicit tree_node entities from a single parse pass. `edges/psyker.json` is replaced by generated output.

Tree_node records are removed from `entities/psyker.json`; `entities/psyker-implicit-tree-nodes.json` is deleted entirely.

### CLI integration

- `npm run edges:build` — calls `scripts/extract-tree-edges.mjs`
- Added as a step in `make check`, runs before `index:build`
- Uses `resolveSourceRoot()` for source path resolution

### Validation

No new validation logic. The existing index builder validates:
- Edge `from_entity_id` and `to_entity_id` reference real entities
- Edge `source_snapshot_id` matches the manifest
- Edge `evidence_ids` reference real evidence records (vacuously true — all empty)

### Tests

- **Psyker golden test**: generated psyker `belongs_to_tree_node` and `parent_of` edges must match the existing hand-authored set. `exclusive_with` edges are new (the hand-authored set has none) — tested separately for correct pairwise count from known `group_name` data.
- **Coverage fixture**: at least one non-psyker class gets an `expected-{domain}-tree-coverage.json` with expected edge/entity counts
- **`exclusive_with` test**: verify pairwise generation from `group_name` fields on a known class
- **Idempotency test**: running the generator twice produces identical output

### Source refs

Every generated entity includes a `refs` entry pointing to the exact line in the `*_tree.lua` file where the node's `widget_name` appears. Edges do not carry `refs` (the edge schema does not include this field).

## Out of scope

- Evidence records for edges (forward-looking, no consumer yet)
- Populating `conditions` or `calc` with real game logic data
- Per-instance stat node resolution (depends on tree edges but is a separate feature)
- `requires` edges for `min_points_spent` / `children_unlock_points` constraints (can be added later from the same source data)
