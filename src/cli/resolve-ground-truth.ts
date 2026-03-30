import { resolveQuery } from "../lib/resolve.js";
import { runCliMain } from "../lib/cli.js";

function parseArgs(argv: string[]) {
  const args: { query: string | null; context: Record<string, unknown> } = {
    query: null,
    context: {},
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--query") {
      args.query = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === "--context") {
      args.context = JSON.parse(argv[index + 1] ?? "{}") as Record<string, unknown>;
      index += 1;
    }
  }

  if (!args.query) {
    throw new Error("--query is required");
  }

  return args as { query: string; context: Record<string, unknown> };
}

if (import.meta.main) {
  await runCliMain("resolve", async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await resolveQuery(args.query, args.context);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });
}
