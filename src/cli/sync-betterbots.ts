// Sync BetterBots-derived artifacts into hadrons-blessing.
// Writes canonical bot build fixtures and the bot weapon export from
// BetterBots DEFAULT_PROFILE_TEMPLATES.

import {
  DEFAULT_BETTERBOTS_PROFILE_PATH,
  DEFAULT_BOT_BUILD_DIR,
  DEFAULT_BOT_WEAPON_EXPORT_PATH,
  syncBetterBotsArtifacts,
} from "../lib/betterbots-sync.js";

const BUILD_DIR = process.argv[2] || DEFAULT_BOT_BUILD_DIR;
const EXPORT_PATH = process.argv[3] || DEFAULT_BOT_WEAPON_EXPORT_PATH;
const PROFILE_PATH = process.argv[4] || DEFAULT_BETTERBOTS_PROFILE_PATH;

const artifacts = syncBetterBotsArtifacts(PROFILE_PATH, {
  buildDir: BUILD_DIR,
  exportPath: EXPORT_PATH,
});

console.log(
  `Wrote ${Object.keys(artifacts.builds).length} bot builds to ${BUILD_DIR} and export to ${EXPORT_PATH}`,
);
