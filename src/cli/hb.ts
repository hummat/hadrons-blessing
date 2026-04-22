#!/usr/bin/env node
import { parseArgs } from "node:util";
import { isCliEntryPoint, runCliMain } from "../lib/cli.js";
import { analyzeTarget, formatAnalyzeJson, formatAnalyzeText } from "../lib/hb-analyze.js";

function usage(): string {
  return [
    "Usage:",
    "  hb analyze <gameslantern-url|build.json> [--json]",
    "",
    "Commands:",
    "  analyze   Run the end-to-end build analysis flow on a Games Lantern URL or build JSON file.",
  ].join("\n");
}

async function runAnalyze(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
    },
    strict: true,
  });

  const target = positionals[0];
  if (!target) {
    throw new Error("Usage: hb analyze <gameslantern-url|build.json> [--json]");
  }

  const result = await analyzeTarget(target);
  process.stdout.write(values.json ? formatAnalyzeJson(result) : `${formatAnalyzeText(result)}\n`);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const [command, ...rest] = argv;

  if (command == null || command === "--help" || command === "help") {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  switch (command) {
    case "analyze":
      await runAnalyze(rest);
      return;
    default:
      throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  }
}

if (isCliEntryPoint(import.meta.url)) {
  await runCliMain("hb", async () => {
    await main();
  });
}
