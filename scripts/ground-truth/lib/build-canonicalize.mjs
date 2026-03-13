import { loadJsonFile } from "./load.mjs";
import { classifyKnownUnresolved as defaultClassifyKnownUnresolved } from "./non-canonical.mjs";
import { resolveQuery as defaultResolveQuery } from "./resolve.mjs";
import { assertValidCanonicalBuild } from "./build-shape.mjs";
import { classifySelectedNodes } from "./build-classification.mjs";
import { BUILD_CLASSIFICATION_REGISTRY } from "./build-classification-registry.mjs";
import { parsePerkString } from "../../score-build.mjs";

function inferredWeaponFamily(entityId) {
  const internalName = entityId?.split(".").pop() ?? null;
  if (internalName == null) {
    return null;
  }

  return internalName.replace(/_m\d+$/, "");
}

function valueUnitFromRawLabel(rawLabel) {
  return rawLabel.includes("%") ? "percent" : "flat";
}

function placeholderSelection(rawLabel) {
  return {
    raw_label: rawLabel,
    canonical_entity_id: null,
    resolution_status: "unresolved",
  };
}

async function toSelection(rawLabel, queryContext, deps = {}) {
  const text = String(rawLabel ?? "").trim();
  const {
    resolveQuery = defaultResolveQuery,
    classifyKnownUnresolved = defaultClassifyKnownUnresolved,
    value = null,
  } = deps;

  if (text.length === 0) {
    return placeholderSelection("Unknown");
  }

  const result = await resolveQuery(text, queryContext);

  if (result.resolution_state === "resolved" && result.resolved_entity_id) {
    return {
      raw_label: text,
      canonical_entity_id: result.resolved_entity_id,
      resolution_status: "resolved",
      ...(value == null ? {} : { value }),
    };
  }

  const nonCanonicalRecord = classifyKnownUnresolved(text, queryContext);
  if (nonCanonicalRecord) {
    return {
      raw_label: text,
      canonical_entity_id: null,
      resolution_status: "non_canonical",
      ...(value == null ? {} : { value }),
    };
  }

  return {
    raw_label: text,
    canonical_entity_id: null,
    resolution_status: "unresolved",
    ...(value == null ? {} : { value }),
  };
}

async function canonicalizeBlessings(rawBlessings, queryContext, deps = {}) {
  const selections = [];

  for (const blessing of rawBlessings ?? []) {
    const label = typeof blessing === "string" ? blessing : blessing?.name;
    selections.push(await toSelection(label, queryContext, deps));
  }

  return selections;
}

async function canonicalizePerks(rawPerks, queryContext, deps = {}) {
  const selections = [];

  for (const perk of rawPerks ?? []) {
    const parsed = parsePerkString(perk);
    const value = parsed == null
      ? null
      : {
        min: parsed.min,
        max: parsed.max,
        unit: valueUnitFromRawLabel(perk),
      };

    selections.push(await toSelection(perk, queryContext, {
      ...deps,
      value,
    }));
  }

  return selections;
}

async function canonicalizeWeapon(rawWeapon, slot, deps = {}) {
  const nameSelection = await toSelection(rawWeapon.name, { kind: "weapon", slot }, deps);
  const weaponFamily = inferredWeaponFamily(nameSelection.canonical_entity_id);

  return {
    slot,
    name: nameSelection,
    perks: await canonicalizePerks(rawWeapon.perks, { kind: "weapon_perk", slot }, deps),
    blessings: await canonicalizeBlessings(rawWeapon.blessings, {
      kind: "weapon_trait",
      slot,
      ...(weaponFamily == null ? {} : { weapon_family: weaponFamily }),
    }, deps),
  };
}

async function canonicalizeCurio(rawCurio, className, deps = {}) {
  return {
    name: await toSelection(rawCurio.name, {
      kind: "gadget_item",
      class: className,
      slot: "curio",
    }, deps),
    perks: await canonicalizePerks(rawCurio.perks, {
      kind: "gadget_trait",
      slot: "curio",
    }, deps),
  };
}

function classifyBuildNodes(rawBuild, deps = {}) {
  const {
    classificationRegistry = BUILD_CLASSIFICATION_REGISTRY,
    classifySlugRole = null,
  } = deps;

  return classifySelectedNodes(rawBuild?.talents?.active ?? [], {
    className: rawBuild.class,
    classificationRegistry,
    ...(classifySlugRole == null ? {} : { classifySlugRole }),
  });
}

async function canonicalizeScrapedBuild(rawBuild, deps = {}) {
  const classified = classifyBuildNodes(rawBuild, deps);
  const className = String(rawBuild.class ?? "").trim().toLowerCase();

  const build = {
    schema_version: 1,
    title: String(rawBuild.title ?? "").trim() || "Untitled Build",
    class: await toSelection(className, { kind: "class", class: className }, deps),
    provenance: {
      source_kind: "gameslantern",
      source_url: String(rawBuild.url ?? "").trim(),
      author: String(rawBuild.author ?? "").trim() || "unknown",
      scraped_at: deps.scrapedAt ?? new Date().toISOString(),
    },
    ability: classified.ability
      ? await toSelection(classified.ability.name, { kind: "ability", class: className }, deps)
      : placeholderSelection("Unknown ability"),
    blitz: classified.blitz
      ? await toSelection(classified.blitz.name, { kind: "blitz", class: className }, deps)
      : placeholderSelection("Unknown blitz"),
    aura: classified.aura
      ? await toSelection(classified.aura.name, { kind: "aura", class: className }, deps)
      : placeholderSelection("Unknown aura"),
    keystone: classified.keystone
      ? await toSelection(classified.keystone.name, { kind: "keystone", class: className }, deps)
      : null,
    talents: [],
    weapons: [],
    curios: [],
  };

  for (const node of classified.talents) {
    build.talents.push(await toSelection(node.name, { kind: "talent", class: className }, deps));
  }

  const rawWeapons = rawBuild.weapons ?? [];
  for (const [index, weapon] of rawWeapons.entries()) {
    build.weapons.push(await canonicalizeWeapon(weapon, index === 0 ? "melee" : "ranged", deps));
  }

  for (const curio of rawBuild.curios ?? []) {
    build.curios.push(await canonicalizeCurio(curio, className, deps));
  }

  assertValidCanonicalBuild(build);
  return build;
}

async function canonicalizeBuildFile(inputPath, deps = {}) {
  const rawBuild = loadJsonFile(inputPath);
  return canonicalizeScrapedBuild(rawBuild, deps);
}

export {
  canonicalizeBlessings,
  canonicalizeBuildFile,
  canonicalizeCurio,
  canonicalizePerks,
  canonicalizeScrapedBuild,
  canonicalizeWeapon,
  classifyBuildNodes,
  toSelection,
};
