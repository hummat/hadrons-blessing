import { basename } from "node:path";
import { normalizeText } from "./normalize.js";
import { normalizeClassName } from "./build-classification-registry.js";

export interface ScrapedTalentNode {
  slug?: string;
  name?: string;
  icon?: string;
  frame?: string;
}

export interface GlClassTreeLabelEntry {
  class: string;
  kind: "ability" | "blitz" | "aura" | "keystone" | "talent";
  internal_name: string;
  entity_id: string;
  display_name: string;
  normalized_text: string;
  source_url: string;
  asset_url: string;
  slug: string;
}

function isFrameAsset(url: string): boolean {
  return url.includes("/images/sites/darktide/talents/frames/");
}

export function entityKindFromAssetUrl(url: string | undefined): "ability" | "aura" | "keystone" | "talent" | "talent_modifier" | null {
  if (!url || isFrameAsset(url)) {
    return null;
  }

  if (url.includes("/ability/") || url.includes("/tactical/")) {
    return "ability";
  }

  if (url.includes("/aura/")) {
    return "aura";
  }

  if (url.includes("/keystone/")) {
    return "keystone";
  }

  if (url.includes("/ability_modifier/") || url.includes("/tactical_modifier/") || url.includes("/keystone_modifier/")) {
    return "talent_modifier";
  }

  if (url.includes("/default/")) {
    return "talent";
  }

  return null;
}

function resolverKindFromAssetUrl(url: string | undefined): "ability" | "blitz" | "aura" | "keystone" | "talent" | null {
  if (!url || isFrameAsset(url)) {
    return null;
  }

  if (url.includes("/ability/")) {
    return "ability";
  }

  if (url.includes("/tactical/")) {
    return "blitz";
  }

  if (url.includes("/aura/")) {
    return "aura";
  }

  if (url.includes("/keystone/")) {
    return "keystone";
  }

  if (url.includes("/ability_modifier/") || url.includes("/tactical_modifier/") || url.includes("/keystone_modifier/") || url.includes("/default/")) {
    return "talent";
  }

  return null;
}

export function internalNameFromScrapedNode(node: ScrapedTalentNode): string | null {
  const candidate = node.icon && !isFrameAsset(node.icon) ? node.icon : node.frame;
  if (!candidate || isFrameAsset(candidate)) {
    return null;
  }

  return basename(candidate).replace(/\.webp$/, "");
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

export function normalizedClassDomain(className: string): string {
  return normalizeClassName(className).replace(/\s+/g, "_");
}

export function buildGlClassTreeLabelEntry(
  className: string,
  node: ScrapedTalentNode,
  sourceUrl: string,
): GlClassTreeLabelEntry | null {
  const assetUrl = node.icon && !isFrameAsset(node.icon) ? node.icon : node.frame;
  const entityKind = entityKindFromAssetUrl(assetUrl);
  const kind = resolverKindFromAssetUrl(assetUrl);
  const internalName = internalNameFromScrapedNode(node);

  if (!kind || !entityKind || !internalName || !node.name) {
    return null;
  }

  const domain = normalizedClassDomain(className);
  return {
    class: domain,
    kind,
    internal_name: internalName,
    entity_id: `${domain}.${entityKind}.${internalName}`,
    display_name: node.name,
    normalized_text: normalizeText(node.name),
    source_url: sourceUrl,
    asset_url: assetUrl!,
    slug: node.slug ?? "",
  };
}
