import { runCliMain } from "./ground-truth/lib/cli.mjs";
import { loadJsonFile } from "./ground-truth/lib/load.mjs";
import {
  appendAuditEntry,
  auditCanonicalBuild,
  createAudit,
  finalizeAudit,
  isCanonicalBuild,
  resolveField,
} from "./ground-truth/lib/build-audit.mjs";

async function auditLegacyBuild(buildPath, build) {
  const audit = createAudit(buildPath);

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

  return finalizeAudit(audit);
}

async function auditBuildFile(buildPath) {
  const build = loadJsonFile(buildPath);

  if (isCanonicalBuild(build)) {
    return auditCanonicalBuild(buildPath, build);
  }

  return auditLegacyBuild(buildPath, build);
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
