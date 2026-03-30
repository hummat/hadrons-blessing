// @ts-nocheck
import { statSync } from "node:fs";
import { parseArgs } from "node:util";
import { runCliMain } from "../lib/cli.js";
import { generateReport, generateBatchReport } from "../lib/build-report.js";
import {
  formatText, formatMarkdown, formatJson,
  formatBatchText, formatBatchMarkdown, formatBatchJson,
} from "../lib/report-formatter.js";

const FORMATTERS = {
  text: { single: formatText, batch: formatBatchText },
  md: { single: formatMarkdown, batch: formatBatchMarkdown },
  json: { single: formatJson, batch: formatBatchJson },
};

if (import.meta.main) {
  await runCliMain("report", async () => {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        format: { type: "string", default: "text" },
      },
    });

    const target = positionals[0];
    if (!target) {
      throw new Error("Usage: npm run report -- <build.json|directory> [--format text|md|json]");
    }

    const format = values.format;
    if (!FORMATTERS[format]) {
      throw new Error(`Unknown format "${format}". Use: text, md, json`);
    }

    const isDir = statSync(target).isDirectory();
    let output;

    if (isDir) {
      const batch = await generateBatchReport(target);
      output = FORMATTERS[format].batch(batch);
    } else {
      const report = await generateReport(target);
      output = FORMATTERS[format].single(report);
    }

    process.stdout.write(output + "\n");
  });
}
