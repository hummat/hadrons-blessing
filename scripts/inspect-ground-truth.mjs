import { runCliMain } from "./ground-truth/lib/cli.mjs";
import { inspectEntity } from "./ground-truth/lib/inspect.mjs";

function parseArgs(argv) {
  let id = null;

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--id") {
      id = argv[index + 1] ?? null;
      index += 1;
    }
  }

  if (!id) {
    throw new Error("--id is required");
  }

  return { id };
}

if (import.meta.main) {
  await runCliMain("inspect", async () => {
    const { id } = parseArgs(process.argv.slice(2));
    const result = inspectEntity(id);

    if (!result) {
      throw new Error(`Entity not found: ${id}`);
    }

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });
}
