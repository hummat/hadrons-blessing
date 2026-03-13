import { basename } from "node:path";
import { runCliMain } from "./ground-truth/lib/cli.mjs";
import { loadJsonFile } from "./ground-truth/lib/load.mjs";
import { classifyKnownUnresolved } from "./ground-truth/lib/non-canonical.mjs";
import { resolveQuery } from "./ground-truth/lib/resolve.mjs";

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

async function auditBuildFile(buildPath) {
  const build = loadJsonFile(buildPath);
  const audit = {
    build: basename(buildPath),
    resolved: [],
    ambiguous: [],
    non_canonical: [],
    unresolved: [],
    warnings: [],
  };

  const classResult = await resolveField("class", build.class, {
    kind: "class",
    class: build.class,
  });
  appendAuditEntry(audit, classResult, {
    kind: "class",
    class: build.class,
  });

  for (const [weaponIndex, weapon] of build.weapons.entries()) {
    const slot = weaponIndex === 0 ? "melee" : "ranged";
    const weaponResult = await resolveField(
      `weapons[${weaponIndex}].name`,
      weapon.name,
      { kind: "weapon", slot },
    );
    appendAuditEntry(audit, weaponResult, { kind: "weapon", slot });

    const weaponFamily = weaponResult.resolved_entity_id?.split(".").pop()?.replace(/_m\d+$/, "") ?? null;

    for (const [blessingIndex, blessing] of weapon.blessings.entries()) {
      const blessingResult = await resolveField(
        `weapons[${weaponIndex}].blessings[${blessingIndex}].name`,
        blessing.name,
        {
          kind: "weapon_trait",
          slot,
          ...(weaponFamily ? { weapon_family: weaponFamily } : {}),
        },
      );
      appendAuditEntry(audit, blessingResult, {
        kind: "weapon_trait",
        slot,
        ...(weaponFamily ? { weapon_family: weaponFamily } : {}),
      });
    }

    for (const [perkIndex, perk] of weapon.perks.entries()) {
      const perkResult = await resolveField(
        `weapons[${weaponIndex}].perks[${perkIndex}]`,
        perk,
        {
          kind: "weapon_perk",
          slot,
        },
      );
      appendAuditEntry(audit, perkResult, {
        kind: "weapon_perk",
        slot,
      });
    }
  }

  for (const [curioIndex, curio] of build.curios.entries()) {
    const curioNameResult = await resolveField(
      `curios[${curioIndex}].name`,
      curio.name,
      {
        kind: "gadget_item",
        slot: "curio",
        class: build.class,
      },
    );
    appendAuditEntry(audit, curioNameResult, {
      kind: "gadget_item",
      slot: "curio",
      class: build.class,
    });

    for (const [perkIndex, perk] of curio.perks.entries()) {
      const perkResult = await resolveField(
        `curios[${curioIndex}].perks[${perkIndex}]`,
        perk,
        {
          kind: "gadget_trait",
          slot: "curio",
        },
      );
      appendAuditEntry(audit, perkResult, {
        kind: "gadget_trait",
        slot: "curio",
      });
    }
  }

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

if (import.meta.main) {
  await runCliMain("audit", async () => {
    const buildPath = process.argv[2];
    if (!buildPath) {
      throw new Error("build path is required");
    }

    const result = await auditBuildFile(buildPath);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });
}

export { auditBuildFile };
