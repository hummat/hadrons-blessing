// @ts-nocheck
import { runCliMain } from "../lib/cli.js";
import { buildIndex } from "../lib/ground-truth-index.js";

function parseArgs(argv) {
  return {
    check: argv.includes("--check"),
  };
}

if (import.meta.main) {
  await runCliMain("index:build", async () => {
    await buildIndex(parseArgs(process.argv.slice(2)));
  });
}

export { buildIndex };
