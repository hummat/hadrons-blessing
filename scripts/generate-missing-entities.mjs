#!/usr/bin/env node
/**
 * One-time script to generate the 83 missing talent entities from tree data + source files.
 * Reads tree_node entities to find tree metadata, then searches talents lua for loc_keys.
 *
 * Usage: node scripts/generate-missing-entities.mjs [--dry-run]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseLuaTree } from "./ground-truth/lib/lua-tree-parser.mjs";
import { TREE_TYPE_TO_KIND } from "./ground-truth/lib/tree-edge-generator.mjs";

const SOURCE_ROOT = readFileSync(".source-root", "utf8").trim();
const TREE_DIR = "scripts/ui/views/talent_builder_view/layouts";
const TALENTS_DIR = "scripts/settings/ability/archetype_talents/talents";
const ENTITIES_ROOT = "data/ground-truth/entities";

const DOMAIN_MAP = {
  adamant: "arbites",
  broker: "hive_scum",
  ogryn: "ogryn",
  veteran: "veteran",
  zealot: "zealot",
};

// Get snapshot ID from existing entities
const psykerEntities = JSON.parse(readFileSync(join(ENTITIES_ROOT, "psyker.json"), "utf8"));
const snapshotId = psykerEntities[0].source_snapshot_id;

const dryRun = process.argv.includes("--dry-run");

// Read existing entity IDs across all non-tree files
const existingIds = new Set();
const entityFiles = {};
for (const domain of Object.values(DOMAIN_MAP)) {
  const filePath = join(ENTITIES_ROOT, `${domain}.json`);
  const entities = JSON.parse(readFileSync(filePath, "utf8"));
  entityFiles[domain] = { path: filePath, entities };
  for (const e of entities) existingIds.add(e.id);
}
// Also add psyker
{
  for (const e of psykerEntities) existingIds.add(e.id);
}

let totalGenerated = 0;

for (const [luaPrefix, domain] of Object.entries(DOMAIN_MAP)) {
  // Parse tree lua to get node data
  const treeLuaRelPath = `${TREE_DIR}/${luaPrefix}_tree.lua`;
  const treeLuaAbsPath = join(SOURCE_ROOT, treeLuaRelPath);
  const treeLuaSource = readFileSync(treeLuaAbsPath, "utf8");
  const treeNodes = parseLuaTree(treeLuaSource);

  // Build map: talent_internal_name → tree node data
  const talentToNode = new Map();
  for (const node of treeNodes) {
    if (node.talent !== "not_selected") {
      talentToNode.set(node.talent, node);
    }
  }

  // Read talents lua for loc_key lookups
  const classPrefix = luaPrefix === "adamant" ? "arbites" : (luaPrefix === "broker" ? "hive_scum" : luaPrefix);
  const talentsLuaRelPath = `${TALENTS_DIR}/${classPrefix}_talents.lua`;
  const talentsLuaAbsPath = join(SOURCE_ROOT, talentsLuaRelPath);
  let talentsLuaSource;
  try {
    talentsLuaSource = readFileSync(talentsLuaAbsPath, "utf8");
  } catch {
    // Try with luaPrefix instead
    const altPath = `${TALENTS_DIR}/${luaPrefix}_talents.lua`;
    talentsLuaSource = readFileSync(join(SOURCE_ROOT, altPath), "utf8");
  }

  // Also read base_talents.lua for base stat lookups
  const baseTalentsRelPath = `${TALENTS_DIR}/base_talents.lua`;
  const baseTalentsAbsPath = join(SOURCE_ROOT, baseTalentsRelPath);
  const baseTalentsSource = readFileSync(baseTalentsAbsPath, "utf8");

  // Find missing entities for this domain
  const newEntities = [];

  for (const [talent, node] of talentToNode) {
    const kind = TREE_TYPE_TO_KIND[node.type];
    if (!kind) continue;

    const entityId = `${domain}.${kind}.${talent}`;
    if (existingIds.has(entityId)) continue;

    // This is a missing entity — generate it
    const isBaseStat = talent.startsWith("base_");
    const refs = [{ path: treeLuaRelPath, line: node.line }];
    let locKey = null;

    if (isBaseStat) {
      // Base stat talents: search base_talents.lua for the internal_name
      const baseLine = findTalentLine(baseTalentsSource, talent);
      if (baseLine) {
        refs.push({ path: baseTalentsRelPath, line: baseLine });
      }
      // Base stat talents typically don't have loc_keys
    } else {
      // Class-specific talents: search class talents lua
      const talentLine = findTalentLine(talentsLuaSource, talent);
      if (talentLine) {
        refs.push({ path: talentsLuaRelPath, line: talentLine });
      }
      // Try to find loc_key
      locKey = findLocKey(talentsLuaSource, talent);
    }

    const entity = {
      id: entityId,
      kind,
      domain,
      internal_name: talent,
      loc_key: locKey,
      ui_name: null,
      status: "source_backed",
      refs,
      source_snapshot_id: snapshotId,
      attributes: {
        tree_type: node.type,
        group_name: node.group_name || null,
        tree_widget_name: node.widget_name,
        exclusive_group: null,
      },
      calc: {},
    };

    newEntities.push(entity);
    existingIds.add(entityId);
  }

  if (newEntities.length > 0) {
    console.log(`${domain}: ${newEntities.length} new entities`);
    for (const e of newEntities) {
      console.log(`  + ${e.id} (${e.kind}, tree_type=${e.attributes.tree_type})`);
    }

    if (!dryRun) {
      const { path, entities } = entityFiles[domain];
      entities.push(...newEntities);
      entities.sort((a, b) => a.id.localeCompare(b.id));
      writeFileSync(path, JSON.stringify(entities, null, 2) + "\n");
    }

    totalGenerated += newEntities.length;
  }
}

console.log(`\nTotal: ${totalGenerated} entities generated${dryRun ? " (dry run)" : ""}`);

/**
 * Find the line number where a talent is defined in a Lua source file.
 * Searches for patterns like: talent_name = { or ["talent_name"] =
 */
function findTalentLine(source, talentName) {
  const lines = source.split("\n");
  // Pattern 1: talent_name = {
  // Pattern 2: ["talent_name"] =
  // Pattern 3: = "talent_name"
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      line.includes(`${talentName} =`) ||
      line.includes(`["${talentName}"]`) ||
      line.includes(`= "${talentName}"`)
    ) {
      return i + 1; // 1-indexed
    }
  }
  return null;
}

/**
 * Find loc_key for a talent in the class talents lua.
 * Searches for loc_talent_ patterns near the talent definition.
 */
function findLocKey(source, talentName) {
  const lines = source.split("\n");
  // Find the talent definition block
  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (
      lines[i].includes(`${talentName} =`) ||
      lines[i].includes(`["${talentName}"]`)
    ) {
      startLine = i;
      break;
    }
  }
  if (startLine === -1) return null;

  // Scan forward up to 50 lines for a loc_key
  let braceDepth = 0;
  for (let i = startLine; i < Math.min(startLine + 50, lines.length); i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === "{") braceDepth++;
      if (ch === "}") braceDepth--;
    }

    const locMatch = line.match(/display_name\s*=\s*"(loc_[^"]+)"/);
    if (locMatch) return locMatch[1];

    // Also check for talent-specific loc patterns
    const locMatch2 = line.match(/"(loc_talent_[^"]+)"/);
    if (locMatch2) return locMatch2[1];

    // Stop if we've exited the talent block
    if (braceDepth < 0) break;
  }

  return null;
}
