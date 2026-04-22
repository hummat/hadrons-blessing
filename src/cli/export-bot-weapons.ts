// Generate bot weapon recommendations for BetterBots consumption.
// Reads BetterBots DEFAULT_PROFILE_TEMPLATES and writes the export artifact.

import { writeFileSync } from "node:fs";
import { isCliEntryPoint, runCliMain } from "../lib/cli.js";
import {
  DEFAULT_BETTERBOTS_PROFILE_PATH,
  DEFAULT_BOT_WEAPON_EXPORT_PATH,
  generateBetterBotsArtifacts,
  loadBetterBotsProfileTemplates,
} from "../lib/betterbots-sync.js";

export function main(argv: string[] = process.argv.slice(2)): void {
  const outputPath = argv[0] || DEFAULT_BOT_WEAPON_EXPORT_PATH;
  const profilePath = argv[1] || DEFAULT_BETTERBOTS_PROFILE_PATH;

  const profiles = loadBetterBotsProfileTemplates(profilePath);
  const artifacts = generateBetterBotsArtifacts(profiles);

  writeFileSync(outputPath, JSON.stringify(artifacts.weaponExport, null, 2) + "\n");
  process.stderr.write(`Wrote ${outputPath}\n`);
}

if (isCliEntryPoint(import.meta.url)) {
  await runCliMain("export-bot-weapons", async () => {
    main();
  });
}
