#!/usr/bin/env node

import { runCliMain } from "./ground-truth/lib/cli.mjs";
import { canonicalizeBuildFile } from "./ground-truth/lib/build-canonicalize.mjs";

function parseArgs(argv) {
  const args = {
    inputPath: null,
    provenance: {},
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source-url") {
      args.provenance.source_url = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--author") {
      args.provenance.author = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--scraped-at") {
      args.provenance.scraped_at = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--source-kind") {
      args.provenance.source_kind = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (!arg.startsWith("--") && args.inputPath == null) {
      args.inputPath = arg;
    }
  }

  if (!args.inputPath) {
    throw new Error("input build path is required");
  }

  return args;
}

if (import.meta.main) {
  await runCliMain("canonicalize", async () => {
    const args = parseArgs(process.argv.slice(2));
    const build = await canonicalizeBuildFile(args.inputPath, { provenance: args.provenance });
    process.stdout.write(`${JSON.stringify(build, null, 2)}\n`);
  });
}

export { canonicalizeBuildFile };
