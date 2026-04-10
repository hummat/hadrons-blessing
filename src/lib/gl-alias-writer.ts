import { buildIndex } from "./ground-truth-index.js";
import { normalizeText } from "./normalize.js";
import { matchCorpusEntry } from "./gl-alias-matcher.js";
import type { GroundTruthIndex } from "./ground-truth-index.js";
import type { GlAliasCorpusEntry } from "./gl-alias-corpus.js";
import type { AliasSchemaJson } from "../generated/schema-types.js";

interface BuildGlAliasesInput {
  corpus: GlAliasCorpusEntry[];
  index?: GroundTruthIndex;
}

export interface GlAliasReview {
  matched: Array<{ entry: GlAliasCorpusEntry; candidate_entity_id: string; reason: string }>;
  required: Array<{ entry: GlAliasCorpusEntry; candidates: string[]; reason: string }>;
  unmatched: Array<{ entry: GlAliasCorpusEntry; reason: string }>;
}

export interface BuildGlAliasesResult {
  sharedAliases: AliasSchemaJson[];
  classAliases: Map<string, AliasSchemaJson[]>;
  review: GlAliasReview;
}

function contextConstraintsFor(entry: GlAliasCorpusEntry) {
  return {
    require_all: [
      ...(entry.domain === "weapon_trait" ? [{ key: "kind", value: "weapon_trait" }] : []),
      ...(entry.slot ? [{ key: "slot", value: entry.slot }] : []),
      ...(entry.class ? [{ key: "class", value: entry.class }] : []),
      ...(entry.metadata?.kind && typeof entry.metadata.kind === "string"
        ? [{ key: "kind", value: entry.metadata.kind }]
        : []),
    ],
    prefer: [],
  };
}

export function buildGeneratedAliasRecord(
  entry: GlAliasCorpusEntry,
  entityId: string,
): AliasSchemaJson {
  return {
    text: entry.raw_label,
    normalized_text: normalizeText(entry.raw_label),
    candidate_entity_id: entityId,
    alias_kind: "gameslantern_name",
    match_mode: "fuzzy_allowed",
    provenance: entry.source_kind,
    confidence: "high",
    context_constraints: contextConstraintsFor(entry),
    rank_weight: 140,
    notes: `Generated from ${entry.source_url}`,
  } as AliasSchemaJson;
}

function shouldWriteAlias(entry: GlAliasCorpusEntry, reason: string): boolean {
  return (
    entry.domain === "weapon_perk"
    || entry.domain === "talent"
    || (entry.domain === "weapon_trait" && reason === "matched normalized blessing family slug")
    || (entry.domain === "weapon_trait" && reason === "matched curated GL blessing label")
  );
}

export async function buildGlAliases(input: BuildGlAliasesInput): Promise<BuildGlAliasesResult> {
  const index = input.index ?? await buildIndex({ check: false });
  const review: GlAliasReview = {
    matched: [],
    required: [],
    unmatched: [],
  };
  const sharedAliases: AliasSchemaJson[] = [];
  const classAliases = new Map<string, AliasSchemaJson[]>();

  for (const entry of input.corpus) {
    const result = await matchCorpusEntry(entry, index);
    if (result.state === "high_confidence_match" && result.candidate_entity_id) {
      if (shouldWriteAlias(entry, result.reason)) {
        const alias = buildGeneratedAliasRecord(entry, result.candidate_entity_id);
        if (entry.domain === "talent" && entry.class) {
          classAliases.set(entry.class, [...(classAliases.get(entry.class) ?? []), alias]);
        } else {
          sharedAliases.push(alias);
        }
      }
      review.matched.push({ entry, candidate_entity_id: result.candidate_entity_id, reason: result.reason });
    } else if (result.state === "review_required") {
      review.required.push({ entry, candidates: result.candidates, reason: result.reason });
    } else {
      review.unmatched.push({ entry, reason: result.reason });
    }
  }

  return { sharedAliases, classAliases, review };
}
