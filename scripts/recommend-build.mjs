import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runCliMain } from "./ground-truth/lib/cli.mjs";
import { analyzeGaps, swapTalent, swapWeapon } from "./ground-truth/lib/build-recommendations.mjs";
import { loadIndex } from "./ground-truth/lib/synergy-model.mjs";
import {
  formatGapsText,
  formatGapsJson,
  formatSwapText,
  formatSwapJson,
} from "./ground-truth/lib/recommend-formatter.mjs";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runCliMain("recommend", async () => {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        json: { type: "boolean", default: false },
        from: { type: "string" },
        to: { type: "string" },
      },
    });

    const operation = positionals[0];
    const buildPath = positionals[1];
    if (!operation || !buildPath) {
      throw new Error(
        "Usage: npm run recommend -- <analyze-gaps|swap-talent|swap-weapon> <build.json> [--from id --to id] [--json]"
      );
    }

    const build = JSON.parse(readFileSync(buildPath, "utf-8"));
    const index = loadIndex();

    let result, output;
    switch (operation) {
      case "analyze-gaps":
        result = analyzeGaps(build, index);
        output = values.json ? formatGapsJson(result) : formatGapsText(result);
        break;
      case "swap-talent":
        if (!values.from || !values.to)
          throw new Error("--from and --to required for swap-talent");
        result = swapTalent(build, index, values.from, values.to);
        output = values.json
          ? formatSwapJson(result)
          : formatSwapText(result, { from: values.from, to: values.to, kind: "talent" });
        break;
      case "swap-weapon":
        if (!values.from || !values.to)
          throw new Error("--from and --to required for swap-weapon");
        result = swapWeapon(build, index, values.from, values.to);
        output = values.json
          ? formatSwapJson(result)
          : formatSwapText(result, { from: values.from, to: values.to, kind: "weapon" });
        break;
      default:
        throw new Error(
          `Unknown operation: ${operation}. Use: analyze-gaps, swap-talent, swap-weapon`
        );
    }

    process.stdout.write(output + "\n");
  });
}
