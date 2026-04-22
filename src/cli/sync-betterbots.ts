// Sync BetterBots-derived artifacts into hadrons-blessing.
// Writes canonical bot build fixtures and the bot weapon export from
// BetterBots DEFAULT_PROFILE_TEMPLATES.

import { isCliEntryPoint, runCliMain } from "../lib/cli.js";
import {
  DEFAULT_BETTERBOTS_PROFILE_PATH,
  DEFAULT_BOT_BUILD_DIR,
  DEFAULT_BOT_WEAPON_EXPORT_PATH,
  syncBetterBotsArtifacts,
} from "../lib/betterbots-sync.js";

export function main(argv: string[] = process.argv.slice(2)): void {
  const buildDir = argv[0] || DEFAULT_BOT_BUILD_DIR;
  const exportPath = argv[1] || DEFAULT_BOT_WEAPON_EXPORT_PATH;
  const profilePath = argv[2] || DEFAULT_BETTERBOTS_PROFILE_PATH;

  const artifacts = syncBetterBotsArtifacts(profilePath, {
    buildDir,
    exportPath,
  });

  process.stderr.write(
    `Wrote ${Object.keys(artifacts.builds).length} bot builds to ${buildDir} and export to ${exportPath}\n`,
  );
}

if (isCliEntryPoint(import.meta.url)) {
  await runCliMain("sync-betterbots", async () => {
    main();
  });
}
