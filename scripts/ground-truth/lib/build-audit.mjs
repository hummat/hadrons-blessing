import { basename } from "node:path";
import { buildIndex } from "../../build-ground-truth-index.mjs";
import { assertValidCanonicalBuild } from "./build-shape.mjs";
import { classifyKnownUnresolved } from "./non-canonical.mjs";
import { resolveQuery } from "./resolve.mjs";

function isCanonicalBuild(build) {
  return Number.isInteger(build?.schema_version)
    && build.schema_version >= 1
    && build?.provenance != null
    && Array.isArray(build?.weapons)
    && Array.isArray(build?.curios);
}

function createAudit(buildPath) {
  return {
    build: basename(buildPath),
    resolved: [],
    ambiguous: [],
    non_canonical: [],
    unresolved: [],
    warnings: [],
  };
}

async function resolveField(field, text, queryContext) {
  const result = await resolveQuery(text, queryContext);

  return {
    field,
    text,
    resolution_state: result.resolution_state,
    resolved_entity_id: result.resolved_entity_id,
    proposed_entity_id: result.proposed_entity_id,
    match_type: result.match_type,
    confidence: result.confidence,
    warnings: result.warnings,
  };
}

function toNonCanonicalEntry(result, record) {
  return {
    ...result,
    non_canonical_kind: record.non_canonical_kind,
    provenance: record.provenance,
    notes: record.notes,
    warnings: [...new Set([...result.warnings, "known_non_canonical_label"])],
  };
}

function appendAuditEntry(audit, result, queryContext) {
  if (result.resolution_state === "resolved") {
    audit.resolved.push(result);
    return;
  }

  if (result.resolution_state === "ambiguous") {
    audit.ambiguous.push(result);
    return;
  }

  const nonCanonicalRecord = classifyKnownUnresolved(result.text, queryContext);
  if (nonCanonicalRecord) {
    audit.non_canonical.push(toNonCanonicalEntry(result, nonCanonicalRecord));
    return;
  }

  audit.unresolved.push(result);
}

function finalizeAudit(audit) {
  audit.warnings = [
    ...new Set(
      [
        ...audit.resolved,
        ...audit.ambiguous,
        ...audit.non_canonical,
        ...audit.unresolved,
      ].flatMap((entry) => entry.warnings),
    ),
  ].sort();
  audit.resolved.sort((left, right) => left.field.localeCompare(right.field));
  audit.ambiguous.sort((left, right) => left.field.localeCompare(right.field));
  audit.non_canonical.sort((left, right) => left.field.localeCompare(right.field));
  audit.unresolved.sort((left, right) => left.field.localeCompare(right.field));
  return audit;
}

function inferredWeaponFamily(selection) {
  const internalName = selection?.canonical_entity_id?.split(".").pop() ?? null;
  if (internalName == null) {
    return null;
  }

  return internalName.replace(/_m\d+$/, "");
}

function selectionResult(field, selection, overrides = {}) {
  return {
    field,
    text: selection.raw_label,
    resolution_state: selection.resolution_status,
    resolved_entity_id: selection.canonical_entity_id,
    proposed_entity_id: null,
    match_type: null,
    confidence: null,
    warnings: [],
    ...overrides,
  };
}

async function auditPersistedSelection(audit, field, selection, queryContext, index) {
  if (selection == null) {
    return;
  }

  if (selection.resolution_status === "resolved") {
    const entityExists = index.entities.some((entity) => entity.id === selection.canonical_entity_id);
    if (entityExists) {
      audit.resolved.push(selectionResult(field, selection, {
        match_type: "persisted_canonical_id",
        confidence: "high",
      }));
      return;
    }

    audit.unresolved.push(selectionResult(field, selection, {
      resolution_state: "unresolved",
      resolved_entity_id: null,
      warnings: ["stale_canonical_id"],
      match_type: "stale_canonical_id",
      confidence: "low",
    }));
    return;
  }

  const reResolved = await resolveField(field, selection.raw_label, queryContext);
  const persistenceWarning = selection.resolution_status === "non_canonical"
    ? "persisted_non_canonical_selection"
    : "persisted_unresolved_selection";

  if (reResolved.resolution_state === "ambiguous" && selection.resolution_status === "non_canonical") {
    audit.non_canonical.push(selectionResult(field, selection, {
      resolution_state: "non_canonical",
      warnings: [persistenceWarning],
    }));
    return;
  }

  appendAuditEntry(audit, {
    ...reResolved,
    warnings: [...new Set([...(reResolved.warnings ?? []), persistenceWarning])],
  }, queryContext);
}

async function auditCanonicalBuild(buildPath, build) {
  assertValidCanonicalBuild(build);
  const index = await buildIndex({ check: false });
  const audit = createAudit(buildPath);
  const className = build.class.raw_label;

  await auditPersistedSelection(audit, "class", build.class, {
    kind: "class",
    class: className,
  }, index);
  await auditPersistedSelection(audit, "ability", build.ability, {
    kind: "ability",
    class: className,
  }, index);
  await auditPersistedSelection(audit, "blitz", build.blitz, {
    kind: "blitz",
    class: className,
  }, index);
  await auditPersistedSelection(audit, "aura", build.aura, {
    kind: "aura",
    class: className,
  }, index);
  await auditPersistedSelection(audit, "keystone", build.keystone, {
    kind: "keystone",
    class: className,
  }, index);

  for (const [talentIndex, talent] of build.talents.entries()) {
    await auditPersistedSelection(audit, `talents[${talentIndex}]`, talent, {
      kind: "talent",
      class: className,
    }, index);
  }

  for (const [weaponIndex, weapon] of build.weapons.entries()) {
    await auditPersistedSelection(audit, `weapons[${weaponIndex}].name`, weapon.name, {
      kind: "weapon",
      slot: weapon.slot,
    }, index);

    const weaponFamily = inferredWeaponFamily(weapon.name);

    for (const [blessingIndex, blessing] of weapon.blessings.entries()) {
      await auditPersistedSelection(
        audit,
        `weapons[${weaponIndex}].blessings[${blessingIndex}].name`,
        blessing,
        {
          kind: "weapon_trait",
          slot: weapon.slot,
          ...(weaponFamily == null ? {} : { weapon_family: weaponFamily }),
        },
        index,
      );
    }

    for (const [perkIndex, perk] of weapon.perks.entries()) {
      await auditPersistedSelection(audit, `weapons[${weaponIndex}].perks[${perkIndex}]`, perk, {
        kind: "weapon_perk",
        slot: weapon.slot,
      }, index);
    }
  }

  for (const [curioIndex, curio] of build.curios.entries()) {
    await auditPersistedSelection(audit, `curios[${curioIndex}].name`, curio.name, {
      kind: "gadget_item",
      slot: "curio",
      class: className,
    }, index);

    for (const [perkIndex, perk] of curio.perks.entries()) {
      await auditPersistedSelection(audit, `curios[${curioIndex}].perks[${perkIndex}]`, perk, {
        kind: "gadget_trait",
        slot: "curio",
      }, index);
    }
  }

  return finalizeAudit(audit);
}

export {
  appendAuditEntry,
  auditCanonicalBuild,
  createAudit,
  finalizeAudit,
  isCanonicalBuild,
  resolveField,
};
