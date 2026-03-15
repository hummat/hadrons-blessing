import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EDGES_ROOT, ENTITIES_ROOT } from "./ground-truth/lib/load.mjs";
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
    const luaRelPath = `${TREE_DIR}/${luaPrefix}_tree.lua`;
    const luaAbsPath = join(sourceRoot, luaRelPath);
    const luaSource = readFileSync(luaAbsPath, "utf8");
    const nodes = parseLuaTree(luaSource);

    const edges = generateTreeEdges(nodes, domain, snapshotId);
    const entities = generateTreeNodeEntities(nodes, domain, snapshotId, luaRelPath);

    const edgesPath = join(EDGES_ROOT, `${domain}.json`);
    writeFileSync(edgesPath, JSON.stringify(edges, null, 2) + "\n");

    const entitiesPath = join(ENTITIES_ROOT, `${domain}_tree.json`);
    writeFileSync(entitiesPath, JSON.stringify(entities, null, 2) + "\n");

    const primaryCount = entities.filter((e) => e.status === "source_backed").length;
    const implicitCount = entities.filter((e) => e.status === "partially_resolved").length;

    console.log(
      `${domain}: ${edges.length} edges, ${primaryCount} primary nodes, ${implicitCount} implicit nodes`,
    );

    totalEdges += edges.length;
    totalEntities += entities.length;
  }

  console.log(`\nTotal: ${totalEdges} edges, ${totalEntities} entities across ${Object.keys(DOMAIN_MAP).length} classes`);
});
