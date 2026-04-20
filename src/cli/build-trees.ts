import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATED_ROOT, REPO_ROOT } from "../lib/load.js";
import { validateSourceSnapshot } from "../lib/validate.js";
import { parseLuaTree } from "../lib/lua-tree-parser.js";
import { buildTreeDag } from "../lib/tree-dag-builder.js";
import { runCliMain } from "../lib/cli.js";

const TREE_SPECS = [
  { outputKey: "arbites", domain: "arbites", luaRelPath: "scripts/ui/views/talent_builder_view/layouts/adamant_tree.lua" },
  { outputKey: "hive_scum", domain: "hive_scum", luaRelPath: "scripts/ui/views/talent_builder_view/layouts/broker_tree.lua" },
  {
    outputKey: "hive_scum-stimm",
    domain: "hive_scum",
    luaRelPath: "scripts/ui/views/broker_stimm_builder_view/layouts/broker_stimm_tree.lua",
  },
  { outputKey: "ogryn", domain: "ogryn", luaRelPath: "scripts/ui/views/talent_builder_view/layouts/ogryn_tree.lua" },
  { outputKey: "psyker", domain: "psyker", luaRelPath: "scripts/ui/views/talent_builder_view/layouts/psyker_tree.lua" },
  { outputKey: "veteran", domain: "veteran", luaRelPath: "scripts/ui/views/talent_builder_view/layouts/veteran_tree.lua" },
  { outputKey: "zealot", domain: "zealot", luaRelPath: "scripts/ui/views/talent_builder_view/layouts/zealot_tree.lua" },
] as const;
const OUTPUT_ROOT = join(GENERATED_ROOT, "trees");
const SHARED_STAT_NODES_PATH = join(REPO_ROOT, "data", "ground-truth", "entities", "shared-stat-nodes.json");

type SharedStatNode = {
  id: string;
  internal_name: string;
};

function loadSharedStatNodePrefixes(): Record<string, string> {
  const records = JSON.parse(readFileSync(SHARED_STAT_NODES_PATH, "utf8")) as SharedStatNode[];
  const byPrefix: Record<string, string> = {};
  for (const record of records) {
    byPrefix[record.internal_name] = record.id;
  }
  return byPrefix;
}

await runCliMain("trees:build", async () => {
  const snapshot = validateSourceSnapshot();
  const sourceRoot = snapshot.source_root;
  const snapshotId = snapshot.id;
  const sharedStatNodeIdByInternalPrefix = loadSharedStatNodePrefixes();

  if (!existsSync(OUTPUT_ROOT)) {
    mkdirSync(OUTPUT_ROOT, { recursive: true });
  }

  let totalNodes = 0;
  for (const spec of TREE_SPECS) {
    const { domain, luaRelPath, outputKey } = spec;
    const luaAbsPath = join(sourceRoot, luaRelPath);
    const luaSource = readFileSync(luaAbsPath, "utf8");
    const nodes = parseLuaTree(luaSource);

    const dag = buildTreeDag({
      luaSource,
      nodes,
      domain,
      sourceFile: luaRelPath,
      snapshotId,
      sharedStatNodeIdByInternalPrefix,
    });

    const outPath = join(OUTPUT_ROOT, `${outputKey}.json`);
    writeFileSync(outPath, JSON.stringify(dag, null, 2) + "\n");

    const withIcon = dag.nodes.filter((n) => n.icon_key !== null).length;
    console.log(
      `${outputKey}: ${dag.nodes.length} nodes (${withIcon} with icons), canvas ${dag.canvas.width}×${dag.canvas.height}`,
    );
    totalNodes += dag.nodes.length;
  }

  console.log(`\nTotal: ${totalNodes} nodes across ${TREE_SPECS.length} trees`);
});
