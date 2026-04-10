import { normalizeText } from "./normalize.js";

export interface GlCorpusWeaponInput {
  display_name: string;
  source_url?: string;
  url_slug?: string;
}

export interface GlCorpusPerkInput {
  display_name: string;
  slot: string;
  source_url: string;
}

export interface GlCorpusBlessingInput {
  display_name: string;
  effect?: string;
  source_url: string;
  weapon_types?: string[];
  weapon_type_labels?: string[];
}

export interface GlCorpusClassTreeInput {
  class: string;
  kind: "ability" | "blitz" | "aura" | "keystone" | "talent";
  display_name: string;
  normalized_text?: string;
  entity_id: string;
  source_url?: string;
}

export interface GlCorpusInput {
  weapons: GlCorpusWeaponInput[];
  perks: GlCorpusPerkInput[];
  blessings: GlCorpusBlessingInput[];
  classTreeLabels: GlCorpusClassTreeInput[];
}

export interface GlAliasCorpusEntry {
  domain: "weapon" | "weapon_perk" | "weapon_trait" | "talent";
  raw_label: string;
  normalized_label: string;
  source_url: string;
  source_kind: string;
  slot?: string;
  class?: string;
  description?: string;
  weapon_type_labels?: string[];
  metadata?: Record<string, unknown>;
}

export function buildGlAliasCorpus(input: GlCorpusInput): GlAliasCorpusEntry[] {
  return [
    ...input.weapons.map((weapon) => ({
      domain: "weapon" as const,
      raw_label: weapon.display_name,
      normalized_label: normalizeText(weapon.display_name),
      source_url: weapon.source_url ?? "https://darktide.gameslantern.com/weapons",
      source_kind: "gl-weapon",
      metadata: weapon.url_slug ? { url_slug: weapon.url_slug } : undefined,
    })),
    ...input.perks.map((perk) => ({
      domain: "weapon_perk" as const,
      raw_label: perk.display_name,
      normalized_label: normalizeText(perk.display_name),
      source_url: perk.source_url,
      source_kind: "gl-perk",
      slot: perk.slot,
    })),
    ...input.blessings.map((blessing) => ({
      domain: "weapon_trait" as const,
      raw_label: blessing.display_name,
      normalized_label: normalizeText(blessing.display_name),
      source_url: blessing.source_url,
      source_kind: "gl-blessing",
      description: blessing.effect,
      weapon_type_labels: blessing.weapon_type_labels ?? blessing.weapon_types ?? [],
    })),
    ...input.classTreeLabels.map((label) => ({
      domain: "talent" as const,
      raw_label: label.display_name,
      normalized_label: label.normalized_text ?? normalizeText(label.display_name),
      source_url: label.source_url ?? "",
      source_kind: "gl-class-tree",
      class: label.class,
      metadata: { entity_id: label.entity_id, kind: label.kind },
    })),
  ];
}
