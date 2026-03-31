// Generate bot weapon recommendations for BetterBots consumption.
// Reads a curated per-class weapon map, validates against ground-truth entities,
// and writes data/exports/bot-weapon-recommendations.json.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGroundTruthRegistry } from "../lib/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_PATH = join(__dirname, "..", "..", "data", "exports", "bot-weapon-recommendations.json");
const OUTPUT_PATH = process.argv[2] || DEFAULT_OUTPUT_PATH;

// Curated per-class weapon selections.
// Evaluated against BetterBots bot-incompatibility criteria:
//   dodge-dependent, block-timing-dependent, weapon-special-dependent, weakspot-aim-dependent
// BetterBots already handles: ADS, peril/overheat, force staves, melee selection.
const CURATED_WEAPONS = {
  veteran: {
    melee: {
      template_id: "combatsword_p2_m1",
      display_name: 'Catachan Mk VII "Devil\'s Claw" Sword',
      gestalt: "linesman",
      source_builds: ["03-veteran-sharpshooter-2026"],
      bot_notes: "Simple melee with wide cleave, no dodge/block/weakspot dependency",
    },
    ranged: {
      template_id: "plasmagun_p1_m1",
      display_name: "M35 Magnacore Mk II Plasma Gun",
      gestalt: "killshot",
      source_builds: ["01-veteran-havoc40-2026", "02-veteran-meta-plasma"],
      bot_notes:
        "High damage charged shots, no weakspot dependency — used in 2 of 3 meta builds, peril managed by BetterBots",
    },
  },
  zealot: {
    melee: {
      template_id: "powersword_2h_p1_m2",
      display_name: "Munitorum Mk X Relic Blade",
      gestalt: "linesman",
      source_builds: ["05-zealot-meta-havoc40"],
      bot_notes: "Best cleave melee from S-rank build, no dodge/block dependency",
    },
    ranged: {
      template_id: "flamer_p1_m1",
      display_name: "Artemia Mk III Purgation Flamer",
      gestalt: "killshot",
      source_builds: ["05-zealot-meta-havoc40"],
      bot_notes: "Area denial spray, no aim/dodge/block dependency — S-rank build choice",
    },
  },
  psyker: {
    melee: {
      template_id: "forcesword_2h_p1_m1",
      display_name: "Covenant Mk VI Blaze Force Greatsword",
      gestalt: "linesman",
      source_builds: ["09-psyker-2026"],
      bot_notes: "Wide cleave force melee, no dodge/block dependency",
    },
    ranged: {
      template_id: "forcestaff_p4_m1",
      display_name: "Equinox Mk III Voidblast Force Staff",
      gestalt: "killshot",
      source_builds: ["09-psyker-2026"],
      bot_notes: "AoE blast staff, no weakspot dependency — peril managed by BetterBots",
    },
  },
  ogryn: {
    melee: {
      template_id: "ogryn_powermaul_p1_m1",
      display_name: "Achlys Mk I Power Maul",
      gestalt: "linesman",
      source_builds: ["13-ogryn-bonktide"],
      bot_notes: "High stagger melee, simple attack pattern, no dodge/block dependency",
    },
    ranged: {
      template_id: "ogryn_thumper_p1_m2",
      display_name: "Lorenz Mk VI Rumbler",
      gestalt: "killshot",
      source_builds: ["13-ogryn-bonktide", "15-ogryn-shield-tank"],
      bot_notes: "Grenade launcher, area damage, no aim dependency — appears in 2 of 3 ogryn builds",
    },
  },
};

function buildExport() {
  const registry = loadGroundTruthRegistry();
  const entityById = new Map(registry.entities.map((e) => [e.id, e]));

  const classes: Record<string, Record<string, unknown>> = {};
  const errors: string[] = [];

  for (const [className, slots] of Object.entries(CURATED_WEAPONS)) {
    classes[className] = {};

    for (const [slot, weapon] of Object.entries(slots)) {
      const entityId = `shared.weapon.${weapon.template_id}`;
      const entity = entityById.get(entityId);

      if (!entity) {
        errors.push(`${className}.${slot}: entity ${entityId} not found in ground-truth`);
        continue;
      }

      classes[className][slot] = {
        template_id: weapon.template_id,
        display_name: weapon.display_name,
        canonical_entity_id: entityId,
        gestalt: weapon.gestalt,
        source_builds: weapon.source_builds,
        bot_notes: weapon.bot_notes,
      };
    }
  }

  if (errors.length > 0) {
    throw new Error(`Validation errors:\n${errors.join("\n")}`);
  }

  return {
    generated_at: new Date().toISOString(),
    schema_version: 1,
    assumes: "betterbots",
    classes,
  };
}

const result = buildExport();
writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2) + "\n");
console.log(`Wrote ${OUTPUT_PATH}`);
