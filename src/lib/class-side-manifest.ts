import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TreeNode } from "./lua-tree-parser.js";
import { classifySlugRole, normalizeClassName } from "./build-classification-registry.js";
import { parseLuaTree } from "./lua-tree-parser.js";

export interface ClassifiedClassSideNode {
  slot: "ability" | "blitz" | "aura" | "keystone" | "talents";
  kind: "ability" | "aura" | "keystone" | "talent" | "talent_modifier";
}

export interface ClassSideManifestEntry extends ClassifiedClassSideNode {
  class: string;
  tree_type: string;
  widget_name: string;
  internal_name: string;
  entity_id: string;
  layout_ref: { path: string; line: number };
}

const LAYOUTS_DIR = "scripts/ui/views/talent_builder_view/layouts";
const SUPPORTED_LAYOUTS = [
  { className: "arbites", layoutFile: "adamant_tree.lua" },
  { className: "hive_scum", layoutFile: "broker_tree.lua" },
  { className: "ogryn", layoutFile: "ogryn_tree.lua" },
  { className: "psyker", layoutFile: "psyker_tree.lua" },
  { className: "veteran", layoutFile: "veteran_tree.lua" },
  { className: "zealot", layoutFile: "zealot_tree.lua" },
] as const;

function slugFromInternalName(internalName: string): string {
  return internalName.replace(/_/g, "-");
}

function baseClassificationForType(type: string): ClassifiedClassSideNode {
  if (type === "tactical") {
    return { slot: "blitz", kind: "ability" };
  }

  if (type === "ability") {
    return { slot: "ability", kind: "ability" };
  }

  if (type === "aura") {
    return { slot: "aura", kind: "aura" };
  }

  if (type === "keystone") {
    return { slot: "keystone", kind: "keystone" };
  }

  if (type === "ability_modifier" || type === "tactical_modifier" || type === "keystone_modifier") {
    return { slot: "talents", kind: "talent_modifier" };
  }

  return { slot: "talents", kind: "talent" };
}

export function classifyClassSideNode(
  className: string,
  node: Pick<TreeNode, "talent" | "type">,
): ClassifiedClassSideNode {
  const registryHit = classifySlugRole(className, slugFromInternalName(node.talent));

  if (registryHit) {
    if (registryHit.kind === "blitz") {
      return { slot: registryHit.slot, kind: "ability" };
    }

    return {
      slot: registryHit.slot,
      kind: registryHit.kind,
    };
  }

  return baseClassificationForType(node.type);
}

export function expectedEntityIdForNode(
  className: string,
  classified: ClassifiedClassSideNode,
  internalName: string,
): string {
  const domain = normalizeClassName(className).replace(/\s+/g, "_");
  return `${domain}.${classified.kind}.${internalName}`;
}

function isSelectableNode(node: TreeNode): boolean {
  return node.type !== "start" && node.talent !== "not_selected";
}

export function buildClassSideManifest(sourceRoot: string): ClassSideManifestEntry[] {
  const manifest: ClassSideManifestEntry[] = [];

  for (const { className, layoutFile } of SUPPORTED_LAYOUTS) {
    const layoutPath = join(sourceRoot, LAYOUTS_DIR, layoutFile);
    const layoutRefPath = `${LAYOUTS_DIR}/${layoutFile}`;
    const luaSource = readFileSync(layoutPath, "utf8");
    const nodes = parseLuaTree(luaSource);
    const selectableCount = nodes.filter(isSelectableNode).length;
    if (selectableCount === 0) {
      throw new Error(
        `Layout "${layoutFile}" for class "${className}" parsed to zero selectable nodes - `
        + "parser may be incompatible with current Lua format",
      );
    }

    for (const node of nodes) {
      if (!isSelectableNode(node)) {
        continue;
      }

      const classified = classifyClassSideNode(className, node);
      manifest.push({
        class: className,
        tree_type: node.type,
        widget_name: node.widget_name,
        internal_name: node.talent,
        entity_id: expectedEntityIdForNode(className, classified, node.talent),
        layout_ref: {
          path: layoutRefPath,
          line: node.line,
        },
        ...classified,
      });
    }
  }

  manifest.sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  return manifest;
}
