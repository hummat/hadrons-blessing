import { resolveQuery } from "./ground-truth/lib/resolve.mjs";
import { runCliMain } from "./ground-truth/lib/cli.mjs";

function parseArgs(argv) {
  const args = {
    query: null,
    context: {},
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--query") {
      args.query = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === "--context") {
      args.context = JSON.parse(argv[index + 1] ?? "{}");
      index += 1;
    }
  }

  if (!args.query) {
    throw new Error("--query is required");
  }

  return args;
}

if (import.meta.main) {
  await runCliMain("resolve", async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await resolveQuery(args.query, args.context);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });
}
