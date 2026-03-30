
import { runCliMain } from "../lib/cli.js";
import { canonicalizeBuildFile } from "../lib/build-canonicalize.js";

interface CanonicalizeArgs {
  inputPath: string;
  provenance: Record<string, string>;
}

function parseArgs(argv: string[]): CanonicalizeArgs {
  let inputPath: string | null = null;
  const provenance: Record<string, string> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source-url") {
      provenance.source_url = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--author") {
      provenance.author = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--scraped-at") {
      provenance.scraped_at = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--source-kind") {
      provenance.source_kind = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (!arg.startsWith("--") && inputPath == null) {
      inputPath = arg;
    }
  }

  if (!inputPath) {
    throw new Error("input build path is required");
  }

  return { inputPath, provenance };
}

if (import.meta.main) {
  await runCliMain("canonicalize", async () => {
    const args = parseArgs(process.argv.slice(2));
    const build = await canonicalizeBuildFile(args.inputPath, { provenance: args.provenance });
    process.stdout.write(`${JSON.stringify(build, null, 2)}\n`);
  });
}

export { canonicalizeBuildFile };
