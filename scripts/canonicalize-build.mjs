#!/usr/bin/env node

import { runCliMain } from "./ground-truth/lib/cli.mjs";
import { canonicalizeBuildFile } from "./ground-truth/lib/build-canonicalize.mjs";

if (import.meta.main) {
  await runCliMain("canonicalize", async () => {
    const inputPath = process.argv[2];
    if (!inputPath) {
      throw new Error("input build path is required");
    }

    const build = await canonicalizeBuildFile(inputPath);
    process.stdout.write(`${JSON.stringify(build, null, 2)}\n`);
  });
}

export { canonicalizeBuildFile };
