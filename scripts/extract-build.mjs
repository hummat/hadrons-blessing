#!/usr/bin/env node
// Extract Darktide build data from GamesLantern URLs.
// Requires: playwright (npm i playwright)
//
// Usage:
//   node scripts/extract-build.mjs <url>
//   node scripts/extract-build.mjs <url> --json         # canonical build JSON
//   node scripts/extract-build.mjs <url> --raw-json     # scrape-shaped JSON before canonicalization
//   node scripts/extract-build.mjs <url> --markdown     # canonical markdown summary (default)
//
// Finding builds:
//   The main /builds page only shows the top 20 ranked builds (all classes).
//   Class-specific catalogs live at path-based routes, NOT query params:
//     https://darktide.gameslantern.com/builds/veteran    (not ?class=veteran)
//     https://darktide.gameslantern.com/builds/zealot
//     https://darktide.gameslantern.com/builds/psyker
//     https://darktide.gameslantern.com/builds/ogryn
//     https://darktide.gameslantern.com/builds/arbites
//     https://darktide.gameslantern.com/builds/hive-scum
//   These pages are JS-rendered — WebFetch/curl won't see the listings.
//   To discover builds without a browser, use Google:
//     site:darktide.gameslantern.com/builds veteran

import { chromium } from "playwright";
import { canonicalizeScrapedBuild } from "./ground-truth/lib/build-canonicalize.mjs";
import { extractDescriptionSelections } from "./ground-truth/lib/build-classification.mjs";

const USAGE = `Usage: node scripts/extract-build.mjs <gameslantern-build-url> [--json|--raw-json|--markdown]`;

// Slug → display name: "scriers-gaze" → "Scrier's Gaze"
function slugToName(slug) {
  const special = {
    "scriers-gaze": "Scrier's Gaze",
    "psykinetics-aura": "Psykinetic's Aura",
    "marksmans-focus": "Marksman's Focus",
    "vultures-mark": "Vulture's Mark",
    "tis-but-a-scratch": "'Tis But a Scratch",
  };
  if (special[slug]) return special[slug];
  const lowercase = new Set(["a", "an", "and", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "vs"]);
  return slug
    .split("-")
    .map((w, i) => i > 0 && lowercase.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Known passive keystones by GL slug. On GL, keystones use circular_frame
// (same as regular talents), so we need explicit identification to promote them.
// Source: decompiled talent_settings_*.lua + meta-builds-research.md
const KEYSTONES = new Set([
  // Veteran (internal: Sniper's Focus, Weapon Switch, Focus Target)
  "marksmans-focus", "weapons-specialist", "focus-target",
  // Zealot (internal: Fanatic Rage, Quickness, Martyrdom)
  "blazing-piety", "inexorable-judgement", "martyrdom",
  // Psyker
  "warp-siphon", "empowered-psionics", "disrupt-destiny",
  // Ogryn
  "heavy-hitter", "feel-no-pain", "burst-limiter-override",
  // Arbites (Adamant)
  "forceful", "execution-order", "terminus-warrant",
  "go-get-em", "lone-wolf", "unleashed-brutality",
  // Hive Scum (Broker)
  "adrenaline-frenzy", "chemical-dependency", "vultures-mark",
]);

// Frame shape → talent tier.
// hex_frame = ability section (combat ability + modifiers), NOT passive keystones.
// Actual keystones use circular_frame and are promoted via the KEYSTONES set.
function frameTier(href) {
  if (href.includes("hex_frame")) return "ability";
  if (href.includes("square_frame")) return "notable";
  if (href.includes("circular_small")) return "stat";
  if (href.includes("circular_frame")) return "talent";
  return "unknown";
}

function postProcessTalentNodes(nodes) {
  return nodes.map((talent) => {
    const baseTier = frameTier(talent.frame ?? "");
    const tier = baseTier === "talent" && KEYSTONES.has(talent.slug) ? "keystone" : baseTier;
    return {
      ...talent,
      name: slugToName(talent.slug),
      tier,
    };
  });
}

function validateRawScrape(raw) {
  const problems = [];
  if (!raw.title) problems.push("title not found");
  if (!raw.class) problems.push("class not detected");
  if (raw.weapons.length === 0) problems.push("no weapons extracted");
  if (raw.talents.active.length === 0 && raw.talents.inactive.length === 0) {
    problems.push("no talents extracted");
  }
  return problems;
}

async function extractBuild(url) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    // Use domcontentloaded — networkidle can hang on ad networks
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(3_000);

    // Dismiss cookie consent if present
    try {
      await page.click(".fc-confirm-choices", { timeout: 3_000 });
      await page.waitForTimeout(500);
    } catch {
      // no consent dialog
    }

    // Wait for talent tree SVG to render (some builds may not have one)
    try {
      await page.waitForSelector(".ability-active", { timeout: 10_000 });
    } catch {
      // Talent tree may not be present — continue extracting other data
      console.error("Warning: talent tree not found, extracting other data");
    }

    return await page.evaluate(() => {
      // --- Early page validation ---
      const bodyText = document.body?.innerText?.trim() ?? "";
      if (/^404\b/i.test(bodyText) || bodyText.length < 50) {
        return { error: "page_not_found", bodyPreview: bodyText.slice(0, 200) };
      }

      const _diagnostics = {
        sectionStrategy: "primary",
        weaponCardStrategy: "primary",
        weaponCardCount: 0,
        talentCount: 0,
      };

      const result = {
        url: window.location.href,
        title: "",
        author: "",
        class: "",
        weapons: [],
        curios: [],
        talents: { active: [], inactive: [] },
        class_selections: null,
        description: "",
      };

      // --- Title & author ---
      const h1 = document.querySelector("h1");
      if (h1) {
        // Title may contain subtitle on next line — take only first line
        const titleText = h1.textContent.trim();
        const firstLine = titleText.split("\n")[0].trim();
        result.title = firstLine;
      }

      const authorEl = document.querySelector('a[href*="/user/"]');
      if (authorEl) result.author = authorEl.textContent.trim();

      // --- Class ---
      // Class is encoded in the archetype model image URL
      // Pattern: /{class}-{gender}_model.webp where class can be multi-word (e.g., hive-scum)
      const classImg = document.querySelector(
        'img[src*="_model.webp"]'
      );
      if (classImg) {
        const match = classImg.src.match(
          /\/([a-z]+(?:-[a-z]+)*)-(?:male|female)_model\.webp/
        );
        if (match) result.class = match[1].replace(/-/g, " ");
      }
      // Fallback 1: breadcrumb text (e.g. "Arbites Builds")
      if (!result.class) {
        const breadcrumbs = document.querySelectorAll("nav a");
        for (const a of breadcrumbs) {
          const m = a.textContent.match(
            /(Psyker|Veteran|Zealot|Ogryn|Adamant|Arbites|Broker|Hive Scum)\s+Builds/i
          );
          if (m) {
            result.class = m[1].toLowerCase();
            break;
          }
        }
      }
      // Fallback 2: class image URL with broader pattern
      if (!result.class) {
        const anyClassImg = document.querySelector(
          'img[src*="/darktide/"][src*="_model"]'
        );
        if (anyClassImg) {
          const m = anyClassImg.src.match(/\/([^/]+)_model/);
          if (m) result.class = m[1].replace(/-/g, " ");
        }
      }

      // --- Talents ---
      function nodeHref(node) {
        return (
          node?.getAttribute?.("href") ||
          node?.getAttribute?.("xlink:href") ||
          node?.getAttribute?.("src") ||
          ""
        ).trim();
      }

      function extractTalentIcon(anchor, frameHref) {
        if (!anchor) {
          return null;
        }

        for (const node of anchor.querySelectorAll("image, img")) {
          const href = nodeHref(node);
          if (!href || href === frameHref || href.includes("/frames/")) {
            continue;
          }
          return href;
        }

        return null;
      }

      function extractTalents(selector) {
        const nodes = [];
        for (const el of document.querySelectorAll(selector)) {
          const anchor = el.closest("a");
          if (!anchor) continue;
          const href = anchor.getAttribute("href") || "";
          const match = href.match(/\/abilities\/(.+)$/);
          if (!match) continue;
          const frameHref = el.getAttribute("href") || "";
          const icon = extractTalentIcon(anchor, frameHref);
          nodes.push({
            slug: match[1],
            frame: frameHref,
            ...(icon == null ? {} : { icon }),
          });
        }
        return nodes;
      }

      result.talents.active = extractTalents(".ability-active");
      result.talents.inactive = extractTalents(".ability-inactive");

      // --- Sections ---
      // Page uses .mt-8.mb-4 headings ("Weapons", "Curios", etc.)
      // followed by sibling content divs until the next heading.
      function getSection(name) {
        // Primary: Tailwind utility class selector (current GL layout)
        for (const h of document.querySelectorAll(".mt-8.mb-4")) {
          if (h.textContent.trim() === name) return h;
        }

        // Fallback: semantic heading elements with matching text
        for (const el of document.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
          if (el.textContent.trim() === name) {
            _diagnostics.sectionStrategy = "fallback";
            return el;
          }
        }

        // Fallback: short-text block elements acting as section headers
        for (const el of document.querySelectorAll("div, p")) {
          const text = el.textContent.trim();
          if (
            text === name
            && text.length < 30
            && el.nextElementSibling
            && el.children.length <= 2
          ) {
            _diagnostics.sectionStrategy = "fallback";
            return el;
          }
        }

        return null;
      }

      function isSectionHeading(node) {
        return node?.classList?.contains("mt-8") && node?.classList?.contains("mb-4");
      }

      function collectSectionText(name) {
        const heading = getSection(name);
        if (!heading) return "";

        const parts = [];
        let node = heading.nextElementSibling;
        while (node && !isSectionHeading(node)) {
          const text = node.innerText?.trim();
          if (text) {
            parts.push(text);
          }
          node = node.nextElementSibling;
        }

        return parts.join("\n").trim();
      }

      // --- Weapons & Curios ---
      // Both live in a flex-wrap container immediately after their heading.
      // Each item card is a div.max-w-sm inside that container.
      function parseItemCards(sectionName) {
        const heading = getSection(sectionName);
        if (!heading) return [];

        const container = heading.nextElementSibling;
        if (!container) return [];

        // Weapon cards use max-w-sm, curio cards use max-w-[330px]
        let cards = container.querySelectorAll(
          ':scope > div[class*="max-w"]'
        );

        if (cards.length === 0) {
          // Fallback: child divs containing weapon-signature text patterns
          const WEAPON_SIGNATURE = /Transcendant|Anointed|Profane|Redeemed|\d+-\d+%/;
          const fallbackCards = [...container.querySelectorAll(":scope > div")].filter(
            (div) => WEAPON_SIGNATURE.test(div.innerText ?? "")
          );
          if (fallbackCards.length > 0) {
            cards = fallbackCards;
            _diagnostics.weaponCardStrategy = "fallback";
          }
        }

        const items = [];

        for (const card of cards) {
          const text = card.innerText;
          const lines = text
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
          if (lines.length < 2) continue;

          const item = {
            name: lines[0],
            rarity: "",
            perks: [],
            blessings: [],
          };

          const rarities = new Set([
            "Transcendant",
            "Anointed",
            "Profane",
            "Redeemed",
          ]);
          const statBar = /^\[[\d/]+\]%$/;
          const statLabel =
            /^(Warp Resistance|Cleave|Finesse|Defences|Damage|Quell|Charge|Blast|Mobility|Attack Speed|Critical|Stamina|Peril|Dodge|Sprint|Block|Push|First Target|Reload)/;
          const statValue = /^[\d.]+$/;
          const statRange = /^\[[\d. |]+\]$/;

          let i = 1;
          while (i < lines.length) {
            const line = lines[i];

            if (rarities.has(line)) {
              item.rarity = line;
              i++;
              continue;
            }

            // Skip stat bars and labels
            if (
              statBar.test(line) ||
              statLabel.test(line) ||
              statValue.test(line) ||
              statRange.test(line) ||
              line.startsWith("Damage vs ")
            ) {
              i++;
              continue;
            }

            // Perk: "X-Y% Something" or "+X% Something"
            if (line.match(/^\d+-\d+%\s/) || line.match(/^\+\d/)) {
              item.perks.push(line);
              i++;
              continue;
            }

            // Blessing: short capitalized name followed by longer description
            const next = lines[i + 1];
            if (
              line.match(/^[A-Z]/) &&
              line.length < 60 &&
              next &&
              next.length > 15 &&
              !statBar.test(next) &&
              !rarities.has(next)
            ) {
              item.blessings.push({ name: line, description: next });
              i += 2;
              continue;
            }

            i++;
          }

          items.push(item);
        }
        return items;
      }

      result.weapons = parseItemCards("Weapons");
      result.curios = parseItemCards("Curios");

      // --- Description ---
      const sectionDescription = collectSectionText("Description");
      const teaserDescription =
        document.querySelector(".darktide-description")?.innerText?.trim() ?? "";
      result.description = (sectionDescription || teaserDescription).slice(0, 15_000);

      // --- Diagnostics ---
      _diagnostics.weaponCardCount = result.weapons.length;
      _diagnostics.talentCount = result.talents.active.length + result.talents.inactive.length;
      _diagnostics.headings = [
        ...document.querySelectorAll("h1, h2, h3, h4, h5, h6, .mt-8.mb-4"),
      ].map((el) => ({
        tag: el.tagName,
        classes: el.className.slice(0, 100),
        text: el.textContent.trim().slice(0, 80),
      }));
      _diagnostics.selectorHits = {
        "section.mt-8.mb-4": document.querySelectorAll(".mt-8.mb-4").length,
        "cards.max-w": document.querySelectorAll('[class*="max-w"]').length,
        "talent.ability-active": document.querySelectorAll(".ability-active").length,
        "talent.ability-inactive": document.querySelectorAll(".ability-inactive").length,
      };
      _diagnostics.bodyPreview = (document.body?.innerText ?? "").slice(0, 500);
      result._diagnostics = _diagnostics;

      return result;
    });
  } finally {
    await browser.close();
  }
}

function selectionLabel(selection) {
  if (!selection) {
    return "None";
  }

  if (selection.resolution_status === "resolved") {
    return selection.raw_label;
  }

  return `${selection.raw_label} [${selection.resolution_status}]`;
}

function formatMarkdown(build) {
  const lines = [];
  lines.push(`# ${build.title || "Untitled Build"}`);
  if (build.provenance.author) lines.push(`By **${build.provenance.author}**`);
  lines.push(`Class: **${selectionLabel(build.class)}**`);
  lines.push(`Source: ${build.provenance.source_url}`);
  lines.push("");

  lines.push("## Class Decisions");
  lines.push("");
  lines.push(`**Ability:** ${selectionLabel(build.ability)}`);
  lines.push(`**Blitz:** ${selectionLabel(build.blitz)}`);
  lines.push(`**Aura:** ${selectionLabel(build.aura)}`);
  lines.push(`**Keystone:** ${selectionLabel(build.keystone)}`);
  if (build.talents.length) {
    lines.push(`**Talents:** ${build.talents.map(selectionLabel).join(", ")}`);
  }
  lines.push("");

  if (build.weapons.length) {
    lines.push("## Weapons");
    for (const w of build.weapons) {
      lines.push(`\n### ${selectionLabel(w.name)} (${w.slot})`);
      if (w.perks.length) {
        lines.push("**Perks:**");
        for (const perk of w.perks) lines.push(`- ${selectionLabel(perk)}`);
      }
      if (w.blessings.length) {
        lines.push("**Blessings:**");
        for (const blessing of w.blessings) {
          lines.push(`- ${selectionLabel(blessing)}`);
        }
      }
    }
    lines.push("");
  }

  if (build.curios.length) {
    lines.push("## Curios");
    for (const c of build.curios) {
      const perkLabels = c.perks.map(selectionLabel).join(", ");
      lines.push(`- **${selectionLabel(c.name)}**: ${perkLabels}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const url = argv.find((arg) => !arg.startsWith("--"));
  const format = argv.includes("--raw-json")
    ? "raw-json"
    : argv.includes("--json")
      ? "json"
      : "markdown";

  if (!url || !url.includes("gameslantern.com/builds/")) {
    console.error(USAGE);
    process.exit(1);
  }

  console.error("Extracting build from:", url);
  const rawBuild = await extractBuild(url);

  if (rawBuild.error === "page_not_found") {
    console.error(
      "Error: Build page not found — the build may have been deleted from GamesLantern."
    );
    console.error(`Page content: ${rawBuild.bodyPreview}`);
    process.exit(1);
  }

  rawBuild.talents.active = postProcessTalentNodes(rawBuild.talents.active);
  rawBuild.talents.inactive = postProcessTalentNodes(rawBuild.talents.inactive);

  // Only derive class_selections from description when the talent tree is empty.
  // When active nodes exist, the talent tree classification is more reliable than
  // description prose, which can false-positive on incidental mentions of aura/ability names.
  const hasActiveTalents = rawBuild.talents.active.length > 0;
  if (hasActiveTalents) {
    rawBuild.class_selections = null;
  } else {
    const explicitSelections = extractDescriptionSelections(rawBuild.description);
    rawBuild.class_selections = Object.values(explicitSelections).some((value) => value != null)
      ? explicitSelections
      : null;
  }

  if (format === "raw-json") {
    console.log(JSON.stringify(rawBuild, null, 2));
    return;
  }

  const build = await canonicalizeScrapedBuild(rawBuild);

  if (format === "json") {
    console.log(JSON.stringify(build, null, 2));
  } else {
    console.log(formatMarkdown(build));
  }
}

if (import.meta.main) {
  await main();
}

export { extractBuild, frameTier, main, postProcessTalentNodes, slugToName, validateRawScrape };
