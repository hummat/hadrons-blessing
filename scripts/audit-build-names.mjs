import { basename } from "node:path";
import { loadJsonFile } from "./ground-truth/lib/load.mjs";
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

async function auditBuildFile(buildPath) {
  const build = loadJsonFile(buildPath);
  const audit = {
    build: basename(buildPath),
    resolved: [],
    ambiguous: [],
    unresolved: [],
    warnings: [],
  };

  const classResult = await resolveField("class", build.class, {
    kind: "class",
    class: build.class,
  });

  if (classResult.resolution_state === "resolved") {
    audit.resolved.push(classResult);
  } else if (classResult.resolution_state === "ambiguous") {
    audit.ambiguous.push(classResult);
  } else {
    audit.unresolved.push(classResult);
  }

  for (const [weaponIndex, weapon] of build.weapons.entries()) {
    const slot = weaponIndex === 0 ? "melee" : "ranged";
    const weaponResult = await resolveField(
      `weapons[${weaponIndex}].name`,
      weapon.name,
      { kind: "weapon", slot },
    );

    if (weaponResult.resolution_state === "resolved") {
      audit.resolved.push(weaponResult);
    } else if (weaponResult.resolution_state === "ambiguous") {
      audit.ambiguous.push(weaponResult);
    } else {
      audit.unresolved.push(weaponResult);
    }

    const weaponFamily = weaponResult.resolved_entity_id?.split(".").pop()?.replace(/_m\\d+$/, "") ?? null;

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

      if (blessingResult.resolution_state === "resolved") {
        audit.resolved.push(blessingResult);
      } else if (blessingResult.resolution_state === "ambiguous") {
        audit.ambiguous.push(blessingResult);
      } else {
        audit.unresolved.push(blessingResult);
      }
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

      if (perkResult.resolution_state === "resolved") {
        audit.resolved.push(perkResult);
      } else if (perkResult.resolution_state === "ambiguous") {
        audit.ambiguous.push(perkResult);
      } else {
        audit.unresolved.push(perkResult);
      }
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

    if (curioNameResult.resolution_state === "resolved") {
      audit.resolved.push(curioNameResult);
    } else if (curioNameResult.resolution_state === "ambiguous") {
      audit.ambiguous.push(curioNameResult);
    } else {
      audit.unresolved.push(curioNameResult);
    }

    for (const [perkIndex, perk] of curio.perks.entries()) {
      const perkResult = await resolveField(
        `curios[${curioIndex}].perks[${perkIndex}]`,
        perk,
        {
          kind: "gadget_trait",
          slot: "curio",
        },
      );

      if (perkResult.resolution_state === "resolved") {
        audit.resolved.push(perkResult);
      } else if (perkResult.resolution_state === "ambiguous") {
        audit.ambiguous.push(perkResult);
      } else {
        audit.unresolved.push(perkResult);
      }
    }
  }

  audit.warnings = [...new Set(audit.resolved.flatMap((entry) => entry.warnings))].sort();
  audit.resolved.sort((left, right) => left.field.localeCompare(right.field));
  audit.ambiguous.sort((left, right) => left.field.localeCompare(right.field));
  audit.unresolved.sort((left, right) => left.field.localeCompare(right.field));

  return audit;
}

if (import.meta.main) {
  const buildPath = process.argv[2];
  if (!buildPath) {
    throw new Error("build path is required");
  }

  const result = await auditBuildFile(buildPath);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export { auditBuildFile };
