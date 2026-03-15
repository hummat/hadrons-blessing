#!/usr/bin/env node
// Generate bot weapon recommendations for BetterBots consumption.
// Reads a curated per-class weapon map, validates against ground-truth entities,
// and writes data/exports/bot-weapon-recommendations.json.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGroundTruthRegistry } from "./ground-truth/lib/registry.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, "..", "data", "exports", "bot-weapon-recommendations.json");

// Curated per-class weapon selections.
// Chosen from meta-builds research BOT:* compatibility analysis.
// See docs/superpowers/specs/2026-03-15-betterBots-integration-contract-design.md
const CURATED_WEAPONS = {
  veteran: {
    melee: {
      template_id: "combatsword_p2_m1",
      display_name: 'Catachan Mk VII "Devil\'s Claw" Sword',
      gestalt: "linesman",
      source_builds: ["03-slinking-veteran"],
      bot_notes: "Simple melee with Rampage+Wrath blessings, no weakspot/dodge dependency",
    },
    ranged: {
      template_id: "autogun_p1_m1",
      display_name: "Agripinaa Mk I Infantry Autogun",
      gestalt: "killshot",
      source_builds: [],
      bot_notes:
        "Simple spray autogun — all 3 veteran meta builds use plasma/helbore (BOT:AIM_DEPENDENT), autogun is the bot-safe fallback",
    },
  },
  zealot: {
    melee: {
      template_id: "powersword_2h_p1_m2",
      display_name: "Munitorum Mk X Relic Blade",
      gestalt: "linesman",
      source_builds: ["04-spicy-meta-zealot"],
      bot_notes: "Best cleave melee from S-rank build (BOT:ABILITY_OK), no dodge/block dependency",
    },
    ranged: {
      template_id: "flamer_p1_m1",
      display_name: "Artemia Mk III Purgation Flamer",
      gestalt: "killshot",
      source_builds: ["04-spicy-meta-zealot"],
      bot_notes: "Area denial spray, no aim dependency — S-rank build choice",
    },
  },
  psyker: {
    melee: {
      template_id: "forcesword_2h_p1_m1",
      display_name: "Covenant Mk VI Blaze Force Greatsword",
      gestalt: "linesman",
      source_builds: ["08-gandalf-melee-wizard"],
      bot_notes: "Simple force melee with wide cleave, standard psyker melee",
    },
    ranged: {
      template_id: "forcestaff_p4_m1",
      display_name: "Equinox Mk III Voidblast Force Staff",
      gestalt: "killshot",
      source_builds: ["08-gandalf-melee-wizard"],
      bot_notes: "AoE blast staff, no charged shot timing dependency",
    },
  },
  ogryn: {
    melee: {
      template_id: "ogryn_powermaul_p1_m1",
      display_name: "Achlys Mk I Power Maul",
      gestalt: "linesman",
      source_builds: ["11-explodegryn"],
      bot_notes: "High stagger melee, simple attack pattern",
    },
    ranged: {
      template_id: "ogryn_thumper_p1_m2",
      display_name: "Lorenz Mk VI Rumbler",
      gestalt: "killshot",
      source_builds: ["11-explodegryn", "12-ogryn-shield-tank"],
      bot_notes: "Grenade launcher, area damage, appears in 2 of 3 ogryn builds",
    },
  },
};

function buildExport() {
  const registry = loadGroundTruthRegistry();
  const entityById = new Map(registry.entities.map((e) => [e.id, e]));

  const classes = {};
  const errors = [];

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
    classes,
  };
}

const result = buildExport();
writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2) + "\n");
console.log(`Wrote ${OUTPUT_PATH}`);
