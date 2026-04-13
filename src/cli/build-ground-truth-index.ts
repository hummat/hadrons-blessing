import { runCliMain } from "../lib/cli.js";
import { buildIndex } from "../lib/ground-truth-index.js";

function parseArgs(argv: string[]) {
  const check = argv.includes("--check");
  return {
    check,
    writeGenerated: !check,
  };
}

if (import.meta.main) {
  await runCliMain("index:build", async () => {
    await buildIndex(parseArgs(process.argv.slice(2)));
  });
}

export { buildIndex };
