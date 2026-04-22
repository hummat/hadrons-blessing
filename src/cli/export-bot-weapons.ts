// Generate bot weapon recommendations for BetterBots consumption.
// Reads BetterBots DEFAULT_PROFILE_TEMPLATES and writes the export artifact.

import { writeFileSync } from "node:fs";
import {
  DEFAULT_BETTERBOTS_PROFILE_PATH,
  DEFAULT_BOT_WEAPON_EXPORT_PATH,
  generateBetterBotsArtifacts,
  loadBetterBotsProfileTemplates,
} from "../lib/betterbots-sync.js";

const OUTPUT_PATH = process.argv[2] || DEFAULT_BOT_WEAPON_EXPORT_PATH;
const PROFILE_PATH = process.argv[3] || DEFAULT_BETTERBOTS_PROFILE_PATH;

const profiles = loadBetterBotsProfileTemplates(PROFILE_PATH);
const artifacts = generateBetterBotsArtifacts(profiles);

writeFileSync(OUTPUT_PATH, JSON.stringify(artifacts.weaponExport, null, 2) + "\n");
console.log(`Wrote ${OUTPUT_PATH}`);
