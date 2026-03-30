
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCliMain } from "../lib/cli.js";
import { assertValidCanonicalBuild } from "../lib/build-shape.js";
import { toSelection } from "../lib/build-canonicalize.js";
import { loadJsonFile } from "../lib/load.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

interface ReresolveOptions {
  overwriteResolved?: boolean;
  write?: boolean;
  [key: string]: unknown;
}

function expandTargets(targets: string[]): string[] {
  const files: string[] = [];

  for (const target of targets) {
    const stat = statSync(target);
    if (stat.isDirectory()) {
      for (const name of readdirSync(target).filter((entry) => entry.endsWith(".json")).sort()) {
        files.push(join(target, name));
      }
      continue;
    }

    files.push(target);
  }

  return [...new Set(files)];
}

async function reresolveSelection(selection: AnyRecord | null, queryContext: Record<string, unknown>, options: ReresolveOptions = {}) {
  if (selection == null) {
    return null;
  }

  if (selection.resolution_status === "resolved" && !options.overwriteResolved) {
    return selection;
  }

  return toSelection(selection.raw_label, queryContext, {
    ...options,
    ...(selection.value == null ? {} : { value: selection.value }),
  });
}

async function reresolveBuild(build: AnyRecord, options: ReresolveOptions = {}) {
  assertValidCanonicalBuild(build);
  const className = build.class.raw_label;
  const nextBuild = structuredClone(build);

  nextBuild.class = await reresolveSelection(build.class, { kind: "class", class: className }, options);
  nextBuild.ability = await reresolveSelection(build.ability, { kind: "ability", class: className }, options);
  nextBuild.blitz = await reresolveSelection(build.blitz, { kind: "blitz", class: className }, options);
  nextBuild.aura = await reresolveSelection(build.aura, { kind: "aura", class: className }, options);
  nextBuild.keystone = await reresolveSelection(build.keystone, { kind: "keystone", class: className }, options);

  nextBuild.talents = [];
  for (const talent of build.talents) {
    nextBuild.talents.push(await reresolveSelection(talent, { kind: "talent", class: className }, options));
  }

  nextBuild.weapons = [];
  for (const weapon of build.weapons) {
    const nextWeapon = structuredClone(weapon);
    nextWeapon.name = await reresolveSelection(weapon.name, { kind: "weapon", slot: weapon.slot }, options);
    const weaponFamily = nextWeapon.name?.canonical_entity_id?.split(".").pop()?.replace(/_m\d+$/, "") ?? null;
    nextWeapon.perks = [];
    for (const perk of weapon.perks) {
      nextWeapon.perks.push(await reresolveSelection(perk, { kind: "weapon_perk", slot: weapon.slot }, options));
    }
    nextWeapon.blessings = [];
    for (const blessing of weapon.blessings) {
      nextWeapon.blessings.push(await reresolveSelection(
        blessing,
        {
          kind: "weapon_trait",
          slot: weapon.slot,
          ...(weaponFamily == null ? {} : { weapon_family: weaponFamily }),
        },
        options,
      ));
    }
    nextBuild.weapons.push(nextWeapon);
  }

  nextBuild.curios = [];
  for (const curio of build.curios) {
    const nextCurio = structuredClone(curio);
    nextCurio.name = await reresolveSelection(curio.name, {
      kind: "gadget_item",
      slot: "curio",
      class: className,
    }, options);
    nextCurio.perks = [];
    for (const perk of curio.perks) {
      nextCurio.perks.push(await reresolveSelection(perk, { kind: "gadget_trait", slot: "curio" }, options));
    }
    nextBuild.curios.push(nextCurio);
  }

  assertValidCanonicalBuild(nextBuild);
  return nextBuild;
}

async function reresolveBuildTargets(targets: string[], options: ReresolveOptions = {}) {
  const files = expandTargets(targets);
  const results: Array<{ path: string; changed: boolean; build: AnyRecord }> = [];

  for (const filePath of files) {
    const build = loadJsonFile(filePath) as AnyRecord;
    const updatedBuild = await reresolveBuild(build, options);
    const changed = JSON.stringify(build) !== JSON.stringify(updatedBuild);

    if (options.write && changed) {
      writeFileSync(filePath, `${JSON.stringify(updatedBuild, null, 2)}\n`);
    }

    results.push({
      path: filePath,
      changed,
      build: updatedBuild,
    });
  }

  return { files: results };
}

function parseArgs(argv: string[]) {
  const args: { write: boolean; targets: string[] } = {
    write: false,
    targets: [],
  };

  for (const arg of argv) {
    if (arg === "--write") {
      args.write = true;
      continue;
    }

    args.targets.push(arg);
  }

  if (args.targets.length === 0) {
    throw new Error("at least one build path or directory is required");
  }

  return args;
}

if (import.meta.main) {
  await runCliMain("reresolve", async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await reresolveBuildTargets(args.targets, { write: args.write });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });
}

export {
  expandTargets,
  parseArgs,
  reresolveBuild,
  reresolveBuildTargets,
  reresolveSelection,
};
