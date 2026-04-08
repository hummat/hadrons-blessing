# Class-Side Coverage Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make class-side entity coverage mechanical from Darktide source, make GamesLantern class-side label coverage auditable from a checked-in artifact, and fail `npm run check` when either surface drifts.

**Architecture:** Add a source-backed class manifest builder, use it to drive deterministic class-side entity completeness checks and entity generation, then add a separate GL class-tree label artifact plus alias generation and full-tree resolution audits. Preserve the current entity ID contract, including the existing `tactical -> *.ability.*` convention, to avoid scope creep into a breaking ID migration.

**Tech Stack:** TypeScript ESM, `node:test`, existing source parsers (`lua-tree-parser.ts`, `talent-settings-parser.ts`), existing CLI scaffolding (`runCliMain()`), existing ground-truth index and resolver tests.

**Spec:** `docs/superpowers/specs/2026-04-08-class-side-coverage-automation-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/lib/class-side-manifest.ts` | Pure manifest builder for source-backed class-side nodes and expected entity IDs |
| Create | `src/lib/class-side-manifest.test.ts` | Unit tests for classification, ID generation, and source scanning |
| Create | `src/cli/build-class-side-manifest.ts` | Deterministic source-backed manifest writer |
| Create | `src/lib/gl-class-tree-labels.ts` | Normalization and alias-candidate generation for checked-in GL class-tree labels |
| Create | `src/lib/gl-class-tree-labels.test.ts` | Unit tests for GL label normalization and alias record generation |
| Create | `src/cli/build-gl-class-tree-labels.ts` | Refresh command for the checked-in GL class-tree label artifact |
| Create | `data/ground-truth/generated/class-tree-manifest.json` | Generated source-backed manifest |
| Create | `data/ground-truth/generated/gl-class-tree-labels.json` | Generated checked-in GL class-tree label manifest |
| Modify | `src/cli/expand-entity-coverage.ts` | Merge class-side generated entities from the source manifest |
| Modify | `src/cli/enrich-entity-names.ts` | Merge generated class-side GL aliases into per-class shards |
| Modify | `src/lib/ground-truth.test.ts` | Full-tree completeness and resolution audits |
| Modify | `src/lib/cli.ts` | Setup hints for new commands |
| Modify | `package.json` | Add new npm scripts and wire source-backed manifest build into `check` |
| Modify | `Makefile` | Add `class-side-build` and ensure source-backed manifest generation runs in `check` |
| Modify | `data/ground-truth/aliases/veteran.json` | Regenerated class-side alias shard |
| Modify | `data/ground-truth/aliases/zealot.json` | Regenerated class-side alias shard |
| Modify | `data/ground-truth/aliases/psyker.json` | Regenerated class-side alias shard |
| Modify | `data/ground-truth/aliases/ogryn.json` | Regenerated class-side alias shard |
| Modify | `data/ground-truth/aliases/arbites.json` | Regenerated class-side alias shard |
| Modify | `data/ground-truth/aliases/hive_scum.json` | Regenerated class-side alias shard |
| Modify | `data/ground-truth/entities/veteran.json` | Regenerated class-side entity shard |
| Modify | `data/ground-truth/entities/zealot.json` | Regenerated class-side entity shard |
| Modify | `data/ground-truth/entities/psyker.json` | Regenerated class-side entity shard |
| Modify | `data/ground-truth/entities/ogryn.json` | Regenerated class-side entity shard |
| Modify | `data/ground-truth/entities/arbites.json` | Regenerated class-side entity shard |
| Modify | `data/ground-truth/entities/hive_scum.json` | Regenerated class-side entity shard |

---

### Task 1: Add the source-backed class-side manifest builder

**Files:**
- Create: `src/lib/class-side-manifest.ts`
- Create: `src/lib/class-side-manifest.test.ts`
- Modify: `src/lib/build-classification-registry.ts`

- [ ] **Step 1: Write the failing test for manifest classification**

`src/lib/class-side-manifest.test.ts`:
```ts
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  classifyClassSideNode,
  expectedEntityIdForNode,
} from "./class-side-manifest.js";

describe("class-side manifest classification", () => {
  it("routes tactical nodes to blitz slot while preserving current ability entity IDs", () => {
    const classified = classifyClassSideNode("veteran", {
      widget_name: "node_frag",
      talent: "veteran_grenade_apply_bleed",
      type: "tactical",
      group_name: null,
      children: [],
      parents: [],
      line: 1279,
    });

    assert.equal(classified.slot, "blitz");
    assert.equal(classified.kind, "ability");
    assert.equal(
      expectedEntityIdForNode("veteran", classified),
      "veteran.ability.veteran_grenade_apply_bleed",
    );
  });

  it("routes arbites companion-focus keystones into talents", () => {
    const classified = classifyClassSideNode("arbites", {
      widget_name: "node_dog",
      talent: "go_get_em",
      type: "keystone",
      group_name: "dog_1",
      children: [],
      parents: [],
      line: 900,
    });

    assert.equal(classified.slot, "talents");
    assert.equal(classified.kind, "keystone");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test src/lib/class-side-manifest.test.ts`
Expected: FAIL with `Cannot find module './class-side-manifest.js'`

- [ ] **Step 3: Write the minimal manifest builder**

`src/lib/class-side-manifest.ts`:
```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseLuaTree, type TreeNode } from "./lua-tree-parser.js";
import { classifySlugRole, normalizeClassName } from "./build-classification-registry.js";

export interface ClassSideManifestEntry {
  class: string;
  widget_name: string;
  tree_type: string;
  slot: "ability" | "blitz" | "aura" | "keystone" | "talents";
  kind: "ability" | "aura" | "keystone" | "talent" | "talent_modifier";
  internal_name: string;
  entity_id: string;
  layout_ref: { path: string; line: number };
}

export function classifyClassSideNode(className: string, node: TreeNode) {
  const slug = node.talent.replace(/_/g, "-");
  const registryHit = classifySlugRole(className, slug);
  if (registryHit) {
    const kind = registryHit.kind === "blitz" ? "ability" : registryHit.kind;
    return { slot: registryHit.slot, kind };
  }

  if (node.type === "tactical") return { slot: "blitz" as const, kind: "ability" as const };
  if (node.type === "ability") return { slot: "ability" as const, kind: "ability" as const };
  if (node.type === "aura") return { slot: "aura" as const, kind: "aura" as const };
  if (node.type === "keystone") return { slot: "keystone" as const, kind: "keystone" as const };
  if (node.type === "ability_modifier" || node.type === "tactical_modifier" || node.type === "keystone_modifier") {
    return { slot: "talents" as const, kind: "talent_modifier" as const };
  }
  return { slot: "talents" as const, kind: "talent" as const };
}

export function expectedEntityIdForNode(className: string, classified: { kind: string }, internalName?: string) {
  const domain = normalizeClassName(className).replace(/\s+/g, "_");
  return `${domain}.${classified.kind}.${internalName ?? ""}`.replace(/\.$/, "");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test src/lib/class-side-manifest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/class-side-manifest.ts src/lib/class-side-manifest.test.ts
git commit -m "feat: add class-side source manifest builder"
```

---

### Task 2: Add the source-backed manifest CLI and wire it into local quality gates

**Files:**
- Create: `src/cli/build-class-side-manifest.ts`
- Modify: `src/lib/cli.ts`
- Modify: `package.json`
- Modify: `Makefile`

- [ ] **Step 1: Write the failing CLI integration test**

Append to `src/lib/class-side-manifest.test.ts`:
```ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildClassSideManifest } from "./class-side-manifest.js";

describe("class-side manifest integration", () => {
  it("builds entries for every supported class layout", () => {
    const manifest = buildClassSideManifest("/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code");
    const classes = new Set(manifest.map((entry) => entry.class));

    assert.deepEqual(
      [...classes].sort(),
      ["arbites", "hive_scum", "ogryn", "psyker", "veteran", "zealot"],
    );
    assert.equal(
      manifest.some((entry) => entry.entity_id === "veteran.ability.veteran_grenade_apply_bleed"),
      true,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code npx tsx --test src/lib/class-side-manifest.test.ts`
Expected: FAIL because `buildClassSideManifest` is not exported yet

- [ ] **Step 3: Implement the CLI and package wiring**

`src/cli/build-class-side-manifest.ts`:
```ts
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateSourceSnapshot } from "../lib/validate.js";
import { runCliMain } from "../lib/cli.js";
import { buildClassSideManifest } from "../lib/class-side-manifest.js";

await runCliMain("class-side:build", async () => {
  const snapshot = validateSourceSnapshot();
  const manifest = buildClassSideManifest(snapshot.source_root);
  const outFile = resolve("data/ground-truth/generated/class-tree-manifest.json");
  writeFileSync(outFile, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Wrote ${manifest.length} class-side manifest entries to ${outFile}`);
});
```

`package.json`:
```json
{
  "scripts": {
    "class-side:build": "node dist/cli/build-class-side-manifest.js",
    "check": "npm run build && npm run class-side:build && npm run index:build && npm test && npm run index:check"
  }
}
```

`Makefile`:
```make
class-side-build: require-source-root
	GROUND_TRUTH_SOURCE_ROOT="$(GROUND_TRUTH_SOURCE_ROOT)" npm run class-side:build

check: require-source-root build class-side-build edges-build effects-build breeds-build profiles-build stagger-build
	GROUND_TRUTH_SOURCE_ROOT="$(GROUND_TRUTH_SOURCE_ROOT)" npm run check
```

- [ ] **Step 4: Run the CLI and test**

Run: `GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code npm run class-side:build`
Expected: PASS and writes `data/ground-truth/generated/class-tree-manifest.json`

Run: `GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code npx tsx --test src/lib/class-side-manifest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/build-class-side-manifest.ts src/lib/class-side-manifest.ts src/lib/class-side-manifest.test.ts src/lib/cli.ts package.json Makefile data/ground-truth/generated/class-tree-manifest.json
git commit -m "feat: build class-side source manifest"
```

---

### Task 3: Drive class-side entity completeness and generation from the source manifest

**Files:**
- Modify: `src/cli/expand-entity-coverage.ts`
- Modify: `src/lib/ground-truth.test.ts`
- Modify: `data/ground-truth/entities/veteran.json`
- Modify: `data/ground-truth/entities/zealot.json`
- Modify: `data/ground-truth/entities/psyker.json`
- Modify: `data/ground-truth/entities/ogryn.json`
- Modify: `data/ground-truth/entities/arbites.json`
- Modify: `data/ground-truth/entities/hive_scum.json`

- [ ] **Step 1: Write the failing completeness test**

Append to `src/lib/ground-truth.test.ts`:
```ts
it("fails when class-side selectable node coverage is incomplete", async () => {
  const manifest = JSON.parse(
    readFileSync("data/ground-truth/generated/class-tree-manifest.json", "utf8"),
  );
  const index = await buildIndex({ check: false });
  const entityIds = new Set(index.entities.map((entity) => entity.id));

  for (const entry of manifest) {
    assert.equal(
      entityIds.has(entry.entity_id),
      true,
      `missing class-side entity ${entry.entity_id} from ${entry.class}:${entry.internal_name}`,
    );
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code npx tsx --test src/lib/ground-truth.test.ts`
Expected: FAIL with one or more missing class-side entity IDs

- [ ] **Step 3: Extend entity generation to merge manifest-driven class-side entities**

Add to `src/cli/expand-entity-coverage.ts`:
```ts
import { buildClassSideManifest } from "../lib/class-side-manifest.js";

function makeClassSideEntity(entry: ClassSideManifestEntry, snapshotId: string) {
  return {
    id: entry.entity_id,
    kind: entry.kind,
    domain: entry.class,
    internal_name: entry.internal_name,
    loc_key: null,
    ui_name: null,
    status: "source_backed",
    refs: [{ path: entry.layout_ref.path, line: entry.layout_ref.line }],
    source_snapshot_id: snapshotId,
    attributes: {
      tree_type: entry.tree_type,
      tree_widget_name: entry.widget_name,
      coverage_slot: entry.slot,
    },
    calc: {},
  };
}

function mergePreservingCuratedFields(existing: AnyRecord | undefined, generated: AnyRecord) {
  if (!existing) return generated;
  return {
    ...generated,
    loc_key: existing.loc_key ?? generated.loc_key,
    ui_name: existing.ui_name ?? generated.ui_name,
    refs: existing.refs?.length ? existing.refs : generated.refs,
    attributes: { ...generated.attributes, ...existing.attributes },
    calc: existing.calc ?? generated.calc,
  };
}
```

- [ ] **Step 4: Regenerate entities and rerun the test**

Run: `GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code npm run entities:expand`
Expected: PASS and updates class-side entity shards

Run: `GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code npx tsx --test src/lib/ground-truth.test.ts`
Expected: the new completeness test passes

- [ ] **Step 5: Commit**

```bash
git add src/cli/expand-entity-coverage.ts src/lib/ground-truth.test.ts data/ground-truth/entities/*.json
git commit -m "feat: generate class-side entities from source manifest"
```

---

### Task 4: Add the checked-in GamesLantern class-tree label artifact and alias generation

**Files:**
- Create: `src/lib/gl-class-tree-labels.ts`
- Create: `src/lib/gl-class-tree-labels.test.ts`
- Create: `src/cli/build-gl-class-tree-labels.ts`
- Modify: `src/cli/enrich-entity-names.ts`
- Modify: `data/ground-truth/aliases/veteran.json`
- Modify: `data/ground-truth/aliases/zealot.json`
- Modify: `data/ground-truth/aliases/psyker.json`
- Modify: `data/ground-truth/aliases/ogryn.json`
- Modify: `data/ground-truth/aliases/arbites.json`
- Modify: `data/ground-truth/aliases/hive_scum.json`

- [ ] **Step 1: Write the failing GL label normalization test**

`src/lib/gl-class-tree-labels.test.ts`:
```ts
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  normalizeGlClassTreeEntry,
  buildClassSideAliasRecord,
} from "./gl-class-tree-labels.js";

describe("normalizeGlClassTreeEntry", () => {
  it("keeps actual GL display names instead of title-casing slugs", () => {
    const normalized = normalizeGlClassTreeEntry({
      class: "veteran",
      slug: "focus-target",
      slot: "keystone",
      kind: "keystone",
      display_name: "Focus Target!",
      observed_on: "https://darktide.gameslantern.com/builds/veteran",
    });

    assert.equal(normalized.display_name, "Focus Target!");
    assert.equal(normalized.normalized_text, "focus target");
  });

  it("builds class-scoped gameslantern aliases", () => {
    const alias = buildClassSideAliasRecord({
      class: "veteran",
      kind: "keystone",
      display_name: "Focus Target!",
      normalized_text: "focus target",
      entity_id: "veteran.keystone.veteran_improved_tag",
    });

    assert.equal(alias.alias_kind, "gameslantern_name");
    assert.deepEqual(alias.context_constraints.require_all, [
      { key: "class", value: "veteran" },
      { key: "kind", value: "keystone" },
    ]);
    assert.equal(alias.provenance, "gl-class-tree");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test src/lib/gl-class-tree-labels.test.ts`
Expected: FAIL with `Cannot find module './gl-class-tree-labels.js'`

- [ ] **Step 3: Implement GL label normalization and alias merging**

`src/lib/gl-class-tree-labels.ts`:
```ts
import { normalizeText } from "./normalize.js";

export function normalizeGlClassTreeEntry(entry: {
  class: string;
  slug: string;
  slot: string;
  kind: string;
  display_name: string;
  observed_on: string;
}) {
  return {
    ...entry,
    normalized_text: normalizeText(entry.display_name),
  };
}

export function buildClassSideAliasRecord(entry: {
  class: string;
  kind: string;
  display_name: string;
  normalized_text: string;
  entity_id: string;
}) {
  return {
    text: entry.display_name,
    normalized_text: entry.normalized_text,
    candidate_entity_id: entry.entity_id,
    alias_kind: "gameslantern_name",
    match_mode: "fuzzy_allowed",
    provenance: "gl-class-tree",
    confidence: "high",
    context_constraints: {
      require_all: [
        { key: "class", value: entry.class },
        { key: "kind", value: entry.kind },
      ],
      prefer: [],
    },
    rank_weight: 120,
    notes: "",
  };
}
```

`src/cli/enrich-entity-names.ts`:
```ts
import { buildClassSideAliasRecord } from "../lib/gl-class-tree-labels.js";

function mergeClassAliases(existingAliases: AnyRecord[], manifest: AnyRecord[]) {
  const generated = manifest.map((entry) =>
    buildClassSideAliasRecord({
      class: entry.class,
      kind: entry.kind,
      display_name: entry.display_name,
      normalized_text: entry.normalized_text,
      entity_id: entry.entity_id,
    }),
  );
  return mergeAliases(existingAliases, generated);
}
```

- [ ] **Step 4: Build the GL label artifact and regenerate aliases**

Run: `npm run gl-class-tree:build`
Expected: PASS and writes `data/ground-truth/generated/gl-class-tree-labels.json`

Run: `GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code npm run entities:enrich`
Expected: PASS and updates per-class alias shards

Run: `npx tsx --test src/lib/gl-class-tree-labels.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/gl-class-tree-labels.ts src/lib/gl-class-tree-labels.test.ts src/cli/build-gl-class-tree-labels.ts src/cli/enrich-entity-names.ts data/ground-truth/generated/gl-class-tree-labels.json data/ground-truth/aliases/*.json package.json
git commit -m "feat: add class-side GamesLantern alias generation"
```

---

### Task 5: Replace sample-only confidence with full-tree audits

**Files:**
- Modify: `src/lib/ground-truth.test.ts`
- Modify: `src/lib/cli.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing alias-completeness audit**

Append to `src/lib/ground-truth.test.ts`:
```ts
it("fails when class-side GamesLantern alias coverage is incomplete", async () => {
  const manifest = JSON.parse(
    readFileSync("data/ground-truth/generated/gl-class-tree-labels.json", "utf8"),
  );

  for (const entry of manifest) {
    const result = await resolveQuery(entry.display_name, {
      class: entry.class,
      kind: entry.kind,
    });

    assert.equal(result.status, "resolved", `failed to resolve ${entry.class}:${entry.kind}:${entry.display_name}`);
    assert.equal(result.entity?.id, entry.entity_id, `wrong target for ${entry.display_name}`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code npx tsx --test src/lib/ground-truth.test.ts`
Expected: FAIL on at least one unresolved or misresolved class-side GL label

- [ ] **Step 3: Add the round-trip audit and finalize check wiring**

Append to `src/lib/ground-truth.test.ts`:
```ts
it("round-trips representative GL class-side labels through canonicalize and reresolve", async () => {
  for (const [label, context, expectedId] of [
    ["Voice of Command", { class: "veteran", kind: "ability" }, "veteran.ability.veteran_combat_ability_stagger_nearby_enemies"],
    ["Shredder Frag Grenade", { class: "veteran", kind: "blitz" }, "veteran.ability.veteran_grenade_apply_bleed"],
    ["Psykinetic's Aura", { class: "psyker", kind: "aura" }, "psyker.aura.quell_on_elite_kill_aura"],
    ["Focus Target!", { class: "veteran", kind: "keystone" }, "veteran.keystone.veteran_improved_tag"],
  ]) {
    const result = await resolveQuery(label, context);
    assert.equal(result.status, "resolved");
    assert.equal(result.entity?.id, expectedId);
  }
});
```

`src/lib/cli.ts`:
```ts
const SETUP_HINTS: Record<string, string> = {
  "class-side:build": "GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code npm run class-side:build",
  "gl-class-tree:build": "npm run gl-class-tree:build",
  // existing entries...
};
```

- [ ] **Step 4: Run the final verification set**

Run: `GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code npm run class-side:build`
Expected: PASS

Run: `GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code npm run index:build`
Expected: PASS

Run: `GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code npx tsx --test src/lib/ground-truth.test.ts`
Expected: PASS

Run: `GROUND_TRUTH_SOURCE_ROOT=/run/media/matthias/1274B04B74B032F9/git/Darktide-Source-Code npm run check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/ground-truth.test.ts src/lib/cli.ts package.json Makefile
git commit -m "test: enforce full-tree class-side coverage audits"
```

---

## Notes For Execution

- Do not migrate existing class-side entity IDs from `*.ability.*` to `*.blitz.*` in this issue. The manifest should record slot separately while preserving the current canonical ID contract.
- Do not live-scrape GamesLantern during `npm run check`. Refresh the checked-in GL artifact explicitly, then audit against the checked-in file.
- If the manifest builder encounters an unclassified source node, fail fast with the class, widget name, `type`, and `talent` so the registry can be fixed deliberately.
