import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { isCliEntryPoint, runCliMain } from "../lib/cli.js";
import { analyzeGaps, swapTalent, swapWeapon } from "../lib/build-recommendations.js";
import { loadIndex } from "../lib/synergy-model.js";
import {
  formatGapsText,
  formatGapsJson,
  formatSwapText,
  formatSwapJson,
} from "../lib/recommend-formatter.js";

if (isCliEntryPoint(import.meta.url)) {
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

    let output: string;
    switch (operation) {
      case "analyze-gaps": {
        const gapResult = analyzeGaps(build, index);
        output = values.json
          ? formatGapsJson(gapResult as unknown as Parameters<typeof formatGapsJson>[0])
          : formatGapsText(gapResult as unknown as Parameters<typeof formatGapsText>[0]);
        break;
      }
      case "swap-talent": {
        if (!values.from || !values.to)
          throw new Error("--from and --to required for swap-talent");
        const talentResult = swapTalent(build, index, values.from, values.to);
        output = values.json
          ? formatSwapJson(talentResult as Parameters<typeof formatSwapJson>[0])
          : formatSwapText(talentResult as Parameters<typeof formatSwapText>[0], { from: values.from, to: values.to, kind: "talent" });
        break;
      }
      case "swap-weapon": {
        if (!values.from || !values.to)
          throw new Error("--from and --to required for swap-weapon");
        const weaponResult = swapWeapon(build, index, values.from, values.to);
        output = values.json
          ? formatSwapJson(weaponResult as Parameters<typeof formatSwapJson>[0])
          : formatSwapText(weaponResult as Parameters<typeof formatSwapText>[0], { from: values.from, to: values.to, kind: "weapon" });
        break;
      }
      default:
        throw new Error(
          `Unknown operation: ${operation}. Use: analyze-gaps, swap-talent, swap-weapon`
        );
    }

    process.stdout.write(output + "\n");
  });
}
