import { buildIndex } from "../../build-ground-truth-index.mjs";
import { assertAllowedQueryContext, normalizeText } from "./normalize.mjs";

function tokenize(text) {
  return new Set(normalizeText(text).split(" ").filter(Boolean));
}

function getIndex() {
  return buildIndex({ check: false });
}

function contextMatches(alias, queryContext) {
  const requireAll = alias.context_constraints.require_all;
  const prefer = alias.context_constraints.prefer;
  const explanations = [];

  for (const requirement of requireAll) {
    const actual = queryContext[requirement.key];
    if (actual == null) {
      return {
        ok: false,
        matchedPreferCount: 0,
        explanation: `missing required context ${requirement.key}`,
      };
    }

    if (actual !== requirement.value) {
      return {
        ok: false,
        matchedPreferCount: 0,
        explanation: `required context mismatch for ${requirement.key}: ${actual} != ${requirement.value}`,
      };
    }

    explanations.push(`required ${requirement.key}=${requirement.value}`);
  }

  let matchedPreferCount = 0;

  for (const preference of prefer) {
    const actual = queryContext[preference.key];
    if (actual === preference.value) {
      matchedPreferCount += 1;
      explanations.push(`preferred ${preference.key}=${preference.value}`);
    }
  }

  return {
    ok: true,
    matchedPreferCount,
    explanation: explanations.join(", ") || "no context constraints",
  };
}

function scoreAlias(alias, query, normalizedQuery, queryContext) {
  const context = contextMatches(alias, queryContext);
  if (!context.ok) {
    return null;
  }

  const exactText = alias.text === query;
  const normalizedExact = alias.normalized_text === normalizedQuery;

  if (alias.match_mode === "exact_only" && !exactText && !normalizedExact) {
    return null;
  }

  let matchType = "fuzzy_alias";
  let score = alias.rank_weight;

  if (exactText) {
    matchType = "exact_alias";
    score += 1000;
  } else if (normalizedExact) {
    matchType = "normalized_alias";
    score += 800;
  } else {
    const queryTokens = tokenize(query);
    const aliasTokens = tokenize(alias.text);
    const overlap = [...queryTokens].filter((token) => aliasTokens.has(token)).length;
    const union = new Set([...queryTokens, ...aliasTokens]).size;

    if (overlap === 0) {
      return null;
    }

    score += Math.round((overlap / union) * 100);
  }

  score += context.matchedPreferCount * 25;

  return {
    alias,
    score,
    matchType,
    contextExplanation: context.explanation,
  };
}

function confidenceForCandidate(candidate, entity) {
  if (candidate.matchType === "exact_canonical_id") {
    return "high";
  }

  if (candidate.matchType === "exact_alias") {
    return candidate.alias.confidence;
  }

  if (candidate.matchType === "normalized_alias") {
    return candidate.alias.confidence === "low" ? "low" : "medium";
  }

  if (entity?.status === "partially_resolved") {
    return "low";
  }

  return candidate.score >= 200 ? "medium" : "low";
}

function warningsFor(entity) {
  const warnings = [];

  if (entity.kind === "name_family") {
    warnings.push("resolved_to_name_family");
  }

  if (entity.status === "partially_resolved") {
    warnings.push("partially_resolved_entity");
  }

  return warnings;
}

function collectRefsForEntity(entity, evidence) {
  const refs = [...entity.refs];

  for (const record of evidence) {
    const appliesToEntity =
      (record.subject_type === "entity" && record.subject_id === entity.id) ||
      (record.subject_type === "edge" && record.value === entity.id);

    if (!appliesToEntity) {
      continue;
    }

    for (const ref of record.refs) {
      if (!refs.some((existing) => existing.path === ref.path && existing.line === ref.line)) {
        refs.push(ref);
      }
    }
  }

  return refs;
}

async function resolveQuery(query, queryContext, options = {}) {
  const safeQueryContext = assertAllowedQueryContext(queryContext);
  const normalizedQuery = normalizeText(query);
  const index = await getIndex();
  const entitiesById = new Map(index.entities.map((entity) => [entity.id, entity]));

  if (entitiesById.has(query)) {
    const entity = entitiesById.get(query);
    return {
      query,
      query_context: safeQueryContext,
      resolution_state: "resolved",
      resolved_entity_id: entity.id,
      proposed_entity_id: null,
      entity,
      proposed_entity: null,
      match_type: "exact_canonical_id",
      score: 10_000,
      score_margin: 10_000,
      confidence: "high",
      why_this_match: "Exact canonical entity id match.",
      candidate_trace: [
        {
          entity_id: entity.id,
          score: 10_000,
          match_type: "exact_canonical_id",
          context_match_explanation: "canonical id lookup bypassed alias scoring",
        },
      ],
      refs: collectRefsForEntity(entity, index.evidence),
      warnings: warningsFor(entity),
    };
  }

  const bestByEntity = new Map();

  for (const alias of index.aliases) {
    const candidate = scoreAlias(alias, query, normalizedQuery, safeQueryContext);
    if (!candidate) {
      continue;
    }

    const existing = bestByEntity.get(alias.candidate_entity_id);
    if (!existing || candidate.score > existing.score) {
      bestByEntity.set(alias.candidate_entity_id, candidate);
    }
  }

  const ranked = [...bestByEntity.entries()]
    .map(([entityId, candidate]) => ({
      entity_id: entityId,
      entity: entitiesById.get(entityId) ?? null,
      score: candidate.score,
      match_type: candidate.matchType,
      context_match_explanation: candidate.contextExplanation,
      alias: candidate.alias,
    }))
    .filter((candidate) => candidate.entity != null)
    .sort((left, right) => right.score - left.score || left.entity_id.localeCompare(right.entity_id));

  if (ranked.length === 0) {
    return {
      query,
      query_context: safeQueryContext,
      resolution_state: "unresolved",
      resolved_entity_id: null,
      proposed_entity_id: null,
      entity: null,
      proposed_entity: null,
      match_type: "none",
      score: 0,
      score_margin: 0,
      confidence: "low",
      why_this_match: "No canonical id or alias candidate matched the query.",
      candidate_trace: [],
      refs: [],
      warnings: [],
    };
  }

  const [best, second] = ranked;
  const scoreMargin = best.score - (second?.score ?? 0);
  const confidence = confidenceForCandidate(
    {
      matchType: best.match_type,
      alias: best.alias,
      score: best.score,
    },
    best.entity,
  );
  const warnings = warningsFor(best.entity);

  let resolutionState = "resolved";
  let resolvedEntityId = best.entity_id;
  let proposedEntityId = null;

  if (
    best.match_type === "fuzzy_alias" &&
    (best.score < 120 || scoreMargin < 20)
  ) {
    resolutionState = best.score >= 80 ? "ambiguous" : "unresolved";
  }

  if (resolutionState === "ambiguous") {
    resolvedEntityId = null;
    proposedEntityId = best.entity_id;
  } else if (resolutionState === "unresolved") {
    resolvedEntityId = null;
  }

  return {
    query,
    query_context: safeQueryContext,
    resolution_state: resolutionState,
    resolved_entity_id: resolvedEntityId,
    proposed_entity_id: proposedEntityId,
    entity: resolvedEntityId ? best.entity : null,
    proposed_entity: proposedEntityId ? best.entity : null,
    match_type: best.match_type,
    score: best.score,
    score_margin: scoreMargin,
    confidence,
    why_this_match: `Best candidate ${best.entity_id} via ${best.alias.text} (${best.match_type}); ${best.context_match_explanation}.`,
    candidate_trace: ranked.slice(0, 5).map((candidate) => ({
      entity_id: candidate.entity_id,
      score: candidate.score,
      match_type: candidate.match_type,
      context_match_explanation: candidate.context_match_explanation,
    })),
    refs: collectRefsForEntity(best.entity, index.evidence),
    warnings,
  };
}

export { resolveQuery };
