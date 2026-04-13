// Unified calculator CLI — run on a build or directory of builds.
// Usage: npm run calc -- <build|dir> [--mode damage|stagger|cleave|toughness] [--json|--text] [--compare <file>] [--freeze]

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { parseArgs } from "node:util";
import { runCliMain } from "../lib/cli.js";
import { loadIndex } from "../lib/synergy-model.js";
import { loadCalculatorData, computeBreakpoints, summarizeBreakpoints } from "../lib/damage-calculator.js";
import { computeStaggerMatrix, loadStaggerSettings } from "../lib/stagger-calculator.js";
import { computeCleaveMatrix } from "../lib/cleave-calculator.js";
import { computeSurvivability } from "../lib/toughness-calculator.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

// ── Shared display mappings ───────────────────────────────────────────

/** Checklist enemies — the key breeds players care about for breakpoint analysis. */
const CHECKLIST_BREEDS = [
  "renegade_berzerker",
  "chaos_ogryn_executor",
  "chaos_poxwalker",
  "renegade_executor",
  "chaos_ogryn_bulwark",
  "renegade_netgunner",
  "chaos_hound",
  "chaos_poxwalker_bomber",
  "renegade_sniper",
];

/** Human-readable breed names with community armor classification. */
const BREED_DISPLAY: Record<string, { name: string; armor: string | null }> = {
  renegade_berzerker: { name: "Rager", armor: "Flak" },
  chaos_ogryn_executor: { name: "Crusher", armor: "Carapace" },
  chaos_poxwalker: { name: "Poxwalker", armor: null },
  renegade_executor: { name: "Mauler", armor: "Flak" },
  chaos_ogryn_bulwark: { name: "Bulwark", armor: "Carapace" },
  renegade_netgunner: { name: "Trapper", armor: "Flak" },
  chaos_hound: { name: "Hound", armor: null },
  chaos_poxwalker_bomber: { name: "Bomber", armor: null },
  renegade_sniper: { name: "Sniper", armor: "Flak" },
};

/** Scenario display labels. */
const SCENARIO_DISPLAY: Record<string, string> = {
  sustained: "Sustained (body)",
  aimed: "Aimed (head)",
  burst: "Burst (head+crit)",
};

// ── Shared helpers ────────────────────────────────────────────────────

function selectionLabel(value: unknown): string {
  if (typeof value === "string") return value;
  if (value != null && typeof value === "object" && typeof (value as Record<string, unknown>).raw_label === "string") {
    return (value as Record<string, unknown>).raw_label as string;
  }
  return "";
}

/** JSON replacer that preserves Infinity as the string "Infinity" (and null stays null). */
function calcReplacer(_key: string, value: unknown): unknown {
  if (value === Infinity) return "Infinity";
  return value;
}

// ── Damage mode helpers ───────────────────────────────────────────────

function formatHitsToKill(htk: number | null | undefined): string {
  if (htk == null) return "N/A (no data)";
  if (!Number.isFinite(htk)) return "\u221E (negated)";
  return `${htk} hit${htk !== 1 ? "s" : ""}`;
}

/**
 * Extract damnation hitsToKill for checklist breeds per scenario from a weapon's summary.
 * Returns Map<breedId, Map<scenario, hitsToKill>>.
 */
function extractChecklistBreakpoints(weaponResult: AnyRecord): Map<string, Map<string, number>> {
  const table = new Map<string, Map<string, number>>();

  for (const breedId of CHECKLIST_BREEDS) {
    const scenarioMap = new Map<string, number>();

    for (const action of weaponResult.actions) {
      for (const [scenarioName, scenarioData] of Object.entries(action.scenarios) as Array<[string, AnyRecord]>) {
        const entry = scenarioData.breeds.find(
          (b: AnyRecord) => b.breed_id === breedId && b.difficulty === "damnation",
        );
        if (!entry) continue;

        const existing = scenarioMap.get(scenarioName);
        // Keep the lowest hitsToKill (best action) for each scenario
        if (existing == null || entry.hitsToKill < existing) {
          scenarioMap.set(scenarioName, entry.hitsToKill);
        }
      }
    }

    if (scenarioMap.size > 0) {
      table.set(breedId, scenarioMap);
    }
  }

  return table;
}

// ── Damage mode text formatter ────────────────────────────────────────

function formatCalcText(matrix: AnyRecord, build: AnyRecord): string {
  const lines: string[] = [];
  const buildTitle = build.title || "Untitled Build";
  const buildClass = selectionLabel(build.class);

  lines.push(`\u2550\u2550\u2550 BUILD: ${buildTitle} (${buildClass}) \u2550\u2550\u2550`);
  lines.push("");

  const scenarioNames: string[] = matrix.metadata.scenarios;

  for (const weapon of matrix.weapons) {
    const weaponBuild = (build.weapons ?? [])[weapon.slot];
    const weaponName = weaponBuild ? selectionLabel(weaponBuild.name) : weapon.entityId;
    const slotLabel = weaponBuild?.slot ?? (weapon.entityId.includes("ranged") ? "ranged" : "melee");

    lines.push(`\u2500\u2500\u2500 ${weaponName} (${slotLabel}) \u2500\u2500\u2500`);

    const breakpoints = extractChecklistBreakpoints(weapon);

    // Column headers
    const scenarioHeaders = scenarioNames.map((s) => SCENARIO_DISPLAY[s] ?? s);
    const colWidth = 20;
    const nameColWidth = 24;
    const header =
      "".padEnd(nameColWidth) +
      scenarioHeaders.map((h) => h.padEnd(colWidth)).join("");
    lines.push(header);

    for (const breedId of CHECKLIST_BREEDS) {
      const scenarioMap = breakpoints.get(breedId);
      if (!scenarioMap) continue;

      const breedInfo = BREED_DISPLAY[breedId];
      const displayName = breedInfo?.name ?? breedId;
      const nameCell = breedInfo?.armor
        ? `${displayName} (${breedInfo.armor})`
        : displayName;

      const cells = scenarioNames.map((s) => {
        const htk = scenarioMap.get(s);
        return htk != null ? formatHitsToKill(htk) : "-";
      });

      const row =
        nameCell.padEnd(nameColWidth) +
        cells.map((c) => c.padEnd(colWidth)).join("");
      lines.push(row);
    }

    lines.push("");
  }

  // Summary section
  const summaries = summarizeBreakpoints(matrix as Parameters<typeof summarizeBreakpoints>[0]) as AnyRecord[];
  if (summaries.length > 0) {
    lines.push("BREAKPOINT SUMMARY (Damnation):");

    for (const weapon of matrix.weapons) {
      const weaponSummaries = summaries.filter((s: AnyRecord) => s.weaponId === weapon.entityId);
      if (weaponSummaries.length === 0) continue;

      const weaponBuild = (build.weapons ?? [])[weapon.slot];
      const weaponName = weaponBuild ? selectionLabel(weaponBuild.name) : weapon.entityId;
      lines.push(`  ${weaponName}:`);

      for (const s of weaponSummaries) {
        const breedEntries = Object.entries(s.keyBreakpoints as Record<string, number | null>)
          .filter(([, htk]) => htk != null)
          .map(([breedId, htk]) => {
            const name = BREED_DISPLAY[breedId]?.name ?? breedId;
            return `${formatHitsToKill(htk)} ${name}`;
          });
        if (breedEntries.length > 0) {
          const label = `${s.category} (${SCENARIO_DISPLAY[s.scenario] ?? s.scenario})`;
          lines.push(`    ${label}: ${breedEntries.join(", ")}`);
        }
      }
    }
  }

  return lines.join("\n");
}

// ── Compare formatter (damage mode only) ─────────────────────────────

function formatCompare(matrixA: AnyRecord, buildA: AnyRecord, matrixB: AnyRecord, buildB: AnyRecord): string {
  const lines: string[] = [];
  lines.push(`\u2550\u2550\u2550 COMPARE: ${buildA.title ?? "Build A"} vs ${buildB.title ?? "Build B"} \u2550\u2550\u2550`);
  lines.push("");

  // Collect damnation breakpoints per weapon per build
  function collectBreakpointMap(matrix: AnyRecord) {
    const result = new Map<string, Map<string, Map<string, number>>>();
    for (const weapon of matrix.weapons) {
      const bp = extractChecklistBreakpoints(weapon);
      result.set(weapon.entityId, bp);
    }
    return result;
  }

  const bpA = collectBreakpointMap(matrixA);
  const bpB = collectBreakpointMap(matrixB);

  // Compare matching weapons
  const allWeaponIds = new Set([...bpA.keys(), ...bpB.keys()]);
  const scenarioNames: string[] = matrixA.metadata.scenarios;

  for (const weaponId of allWeaponIds) {
    const wBpA = bpA.get(weaponId);
    const wBpB = bpB.get(weaponId);

    if (!wBpA && !wBpB) continue;

    lines.push(`--- ${weaponId} ---`);

    if (!wBpA) {
      lines.push("  Only in Build B");
      lines.push("");
      continue;
    }
    if (!wBpB) {
      lines.push("  Only in Build A");
      lines.push("");
      continue;
    }

    // Compare breed breakpoints
    for (const breedId of CHECKLIST_BREEDS) {
      const mapA = wBpA.get(breedId);
      const mapB = wBpB.get(breedId);
      if (!mapA && !mapB) continue;

      const displayName = BREED_DISPLAY[breedId]?.name ?? breedId;
      const diffs: string[] = [];

      for (const scenario of scenarioNames) {
        const htkA = mapA?.get(scenario);
        const htkB = mapB?.get(scenario);
        if (htkA === htkB) continue;

        const label = SCENARIO_DISPLAY[scenario] ?? scenario;
        const aStr = htkA != null ? formatHitsToKill(htkA) : "-";
        const bStr = htkB != null ? formatHitsToKill(htkB) : "-";
        diffs.push(`${label}: ${aStr} \u2192 ${bStr}`);
      }

      if (diffs.length > 0) {
        lines.push(`  ${displayName}: ${diffs.join("; ")}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

// ── Stagger mode helpers ──────────────────────────────────────────────

/**
 * Extract damnation stagger tiers for checklist breeds per action from a weapon's results.
 * Returns Map<breedId, Map<actionType, stagger_tier>>.
 */
function extractChecklistStagger(weaponResult: AnyRecord): Map<string, Map<string, string>> {
  const table = new Map<string, Map<string, string>>();

  for (const breedId of CHECKLIST_BREEDS) {
    const actionMap = new Map<string, string>();

    for (const action of weaponResult.actions) {
      const entry = action.breeds.find(
        (b: AnyRecord) => b.breed_id === breedId && b.difficulty === "damnation",
      );
      if (!entry) continue;

      const tier = entry.stagger_tier ?? "none";
      const existing = actionMap.get(action.type);
      // Keep the best (highest) stagger tier for each action type
      if (existing == null) {
        actionMap.set(action.type, tier);
      }
    }

    if (actionMap.size > 0) {
      table.set(breedId, actionMap);
    }
  }

  return table;
}

/**
 * Collect all unique action types from a weapon's results.
 */
function collectActionTypes(weaponResult: AnyRecord): string[] {
  const types = new Set<string>();
  for (const action of weaponResult.actions) {
    types.add(action.type);
  }
  return [...types];
}

// ── Stagger mode text formatter ───────────────────────────────────────

function formatStaggerText(matrix: AnyRecord, build: AnyRecord): string {
  const lines: string[] = [];
  const buildTitle = build.title || "Untitled Build";

  lines.push(`\u2550\u2550\u2550 Stagger Analysis: ${buildTitle} \u2550\u2550\u2550`);
  lines.push("");

  for (const weapon of matrix.weapons) {
    const weaponBuild = (build.weapons ?? [])[weapon.slot];
    const weaponName = weaponBuild ? selectionLabel(weaponBuild.name) : weapon.entityId;

    lines.push(`Weapon: ${weaponName}`);

    const stagger = extractChecklistStagger(weapon);
    const actionTypes = collectActionTypes(weapon);

    if (actionTypes.length === 0) {
      lines.push("  (no stagger data)");
      lines.push("");
      continue;
    }

    // Pick breeds that have data for this weapon
    const activeBreeds = CHECKLIST_BREEDS.filter((b) => stagger.has(b));
    if (activeBreeds.length === 0) {
      lines.push("  (no stagger data for key breeds)");
      lines.push("");
      continue;
    }

    // Column layout
    const actionColWidth = 18;
    const breedColWidth = 10;

    // Header row
    const header =
      "  " +
      "Action".padEnd(actionColWidth) +
      "\u2502 " +
      activeBreeds
        .map((b) => (BREED_DISPLAY[b]?.name ?? b).padEnd(breedColWidth))
        .join("\u2502 ");
    lines.push(header);

    // Data rows
    for (const actionType of actionTypes) {
      const cells = activeBreeds.map((breedId) => {
        const breedMap = stagger.get(breedId);
        const tier = breedMap?.get(actionType) ?? "none";
        return tier.padEnd(breedColWidth);
      });

      const row =
        "  " +
        actionType.padEnd(actionColWidth) +
        "\u2502 " +
        cells.join("\u2502 ");
      lines.push(row);
    }

    lines.push("");
  }

  return lines.join("\n");
}

// ── Cleave mode text formatter ────────────────────────────────────────

function formatCleaveText(matrix: AnyRecord, build: AnyRecord): string {
  const lines: string[] = [];
  const buildTitle = build.title || "Untitled Build";

  lines.push(`\u2550\u2550\u2550 Cleave Analysis: ${buildTitle} \u2550\u2550\u2550`);
  lines.push("");

  const compositions: string[] = matrix.metadata.compositions_used;

  for (const weapon of matrix.weapons) {
    const weaponBuild = (build.weapons ?? [])[weapon.slot];
    const weaponName = weaponBuild ? selectionLabel(weaponBuild.name) : weapon.entityId;

    lines.push(`Weapon: ${weaponName}`);

    if (weapon.actions.length === 0) {
      lines.push("  (no cleave data)");
      lines.push("");
      continue;
    }

    // Column layout
    const actionColWidth = 18;
    const compColWidth = 32;

    // Header row
    const header =
      "  " +
      "Action".padEnd(actionColWidth) +
      "\u2502 " +
      compositions
        .map((c: string) => c.padEnd(compColWidth))
        .join("\u2502 ");
    lines.push(header);

    // Data rows
    for (const action of weapon.actions) {
      const cells = compositions.map((compName: string) => {
        const comp = action.compositions[compName];
        if (!comp) return "-".padEnd(compColWidth);
        const cell = `${comp.targets_hit} hit / ${comp.targets_killed} killed (budget ${action.cleave_budget.toFixed(1)})`;
        return cell.padEnd(compColWidth);
      });

      const row =
        "  " +
        action.type.padEnd(actionColWidth) +
        "\u2502 " +
        cells.join("\u2502 ");
      lines.push(row);
    }

    lines.push("");
  }

  return lines.join("\n");
}

// ── Toughness mode helpers ────────────────────────────────────────────

/**
 * Format a DR source value as a human-readable percentage.
 */
function formatDRValue(source: AnyRecord): string {
  const { stat, value } = source;
  if (stat === "toughness_damage_taken_modifier") {
    const pct = Math.abs(value) * 100;
    const multiplier = 1 + value;
    const label = value < 0 ? "DR" : "damage increase";
    return `${multiplier.toFixed(2)} (${pct.toFixed(0)}% ${label}, additive)`;
  }
  const multiplier = 1 + value;
  const pct = Math.abs(value) * 100;
  const label = value < 0 ? "DR" : "damage increase";
  return `${multiplier.toFixed(2)} (${pct.toFixed(0)}% ${label})`;
}

// ── Toughness mode text formatter ─────────────────────────────────────

function formatToughnessText(result: AnyRecord, build: AnyRecord): string {
  const lines: string[] = [];
  const buildTitle = build.title || "Untitled Build";

  lines.push(`\u2550\u2550\u2550 Survivability Analysis: ${buildTitle} \u2550\u2550\u2550`);
  lines.push("");

  lines.push(`Class: ${result.class} (${result.difficulty})`);
  lines.push(`  Base HP: ${result.base.health} \u00d7 ${result.base.wounds} wounds = ${result.health_pool}`);
  lines.push(`  Base Toughness: ${result.base.toughness}`);
  if (result.max_toughness !== result.base.toughness) {
    lines.push(`  Max Toughness: ${result.max_toughness}`);
  }
  lines.push("");

  if (result.dr_sources.length > 0) {
    lines.push("DR Sources:");
    for (const src of result.dr_sources) {
      const entity = (src.source_entity as string).padEnd(42);
      const stat = (src.stat as string).padEnd(40);
      lines.push(`  ${entity} ${stat} ${formatDRValue(src)}`);
    }
    lines.push(`  Total DR: ${(result.total_dr * 100).toFixed(1)}%`);
    lines.push("");
  } else {
    lines.push("DR Sources: (none)");
    lines.push("");
  }

  lines.push(`Effective Toughness: ${result.effective_toughness} (base ${result.base.toughness}${result.max_toughness !== result.base.toughness ? `, max ${result.max_toughness}` : ""}, / DR multiplier)`);
  lines.push(`Effective HP: ${result.effective_hp}`);
  if (result.max_health_modifier !== 0) {
    lines.push(`  Health modifier: ${result.max_health_modifier > 0 ? "+" : ""}${(result.max_health_modifier * 100).toFixed(1)}%`);
  }
  lines.push("");

  const stateLabels: Record<string, string> = { dodging: "Dodging", sliding: "Sliding", sprinting: "Sprinting" };
  const stateEntries = Object.entries(result.state_modifiers as Record<string, AnyRecord>);
  if (stateEntries.length > 0) {
    lines.push("State Modifiers:");
    for (const [state, mod] of stateEntries) {
      const label = stateLabels[state] ?? state;
      const dmgMult = (1 - mod.tdr).toFixed(1);
      lines.push(`  ${label}: ${dmgMult}\u00d7 toughness damage \u2192 effective toughness ${mod.effective_toughness}`);
    }
    lines.push("");
  }

  const regen = result.toughness_regen;
  lines.push("Toughness Regen:");
  lines.push(`  Base: ${regen.base_rate.toFixed(1)}/sec (${regen.delay_seconds}s delay after hit)`);

  const coherencyLabels: Record<string, string> = {
    solo: "Solo",
    one_ally: "1 ally",
    two_allies: "2 allies",
    three_allies: "3+ allies",
  };
  for (const [key, label] of Object.entries(coherencyLabels)) {
    if (regen.coherency[key] != null) {
      lines.push(`  ${label}: ${regen.coherency[key].toFixed(1)}/sec`);
    }
  }

  const meleeKillPct = (regen.melee_kill_recovery_percent * 100).toFixed(0);
  lines.push(`  Melee kill: +${regen.melee_kill_recovery.toFixed(1)} (${meleeKillPct}% of max)`);

  return lines.join("\n");
}

// ── Mode configuration ────────────────────────────────────────────────

type Mode = "damage" | "stagger" | "cleave" | "toughness";

interface ComputeDeps {
  index: ReturnType<typeof loadIndex>;
  calcData: ReturnType<typeof loadCalculatorData>;
  staggerSettings: ReturnType<typeof loadStaggerSettings> | Record<string, never>;
}

interface ModeConfig {
  compute: (build: AnyRecord, deps: ComputeDeps) => AnyRecord;
  formatText: (result: AnyRecord, build: AnyRecord) => string;
  freezeDir: string;
  snapshotSuffix: string;
}

const MODE_CONFIG: Record<Mode, ModeConfig> = {
  damage: {
    compute: (build, deps) =>
      computeBreakpoints(
        build,
        deps.index as unknown as Parameters<typeof computeBreakpoints>[1],
        deps.calcData,
      ) as AnyRecord,
    formatText: formatCalcText,
    freezeDir: "tests/fixtures/ground-truth/calc",
    snapshotSuffix: ".calc.json",
  },
  stagger: {
    compute: (build, deps) =>
      computeStaggerMatrix(
        build as Parameters<typeof computeStaggerMatrix>[0],
        deps.index as unknown as Parameters<typeof computeStaggerMatrix>[1],
        deps.calcData as Parameters<typeof computeStaggerMatrix>[2],
        deps.staggerSettings as ReturnType<typeof loadStaggerSettings>,
      ) as AnyRecord,
    formatText: formatStaggerText,
    freezeDir: "tests/fixtures/ground-truth/stagger",
    snapshotSuffix: ".stagger.json",
  },
  cleave: {
    compute: (build, deps) =>
      computeCleaveMatrix(
        build,
        deps.index as unknown as Parameters<typeof computeCleaveMatrix>[1],
        deps.calcData,
      ) as AnyRecord,
    formatText: formatCleaveText,
    freezeDir: "tests/fixtures/ground-truth/cleave",
    snapshotSuffix: ".cleave.json",
  },
  toughness: {
    compute: (build, deps) =>
      computeSurvivability(
        build,
        deps.index as unknown as Parameters<typeof computeSurvivability>[1],
      ) as AnyRecord,
    formatText: formatToughnessText,
    freezeDir: "tests/fixtures/ground-truth/toughness",
    snapshotSuffix: ".toughness.json",
  },
};

// ── CLI ───────────────────────────────────────────────────────────────

await runCliMain("calc", async () => {
  const { values, positionals } = parseArgs({
    options: {
      mode: { type: "string", default: "damage" },
      json: { type: "boolean", default: false },
      text: { type: "boolean", default: false },
      compare: { type: "string" },
      freeze: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values.json && values.text) {
    throw new Error("--json and --text are mutually exclusive");
  }

  const target = positionals[0];
  if (!target) {
    throw new Error(
      "Usage: npm run calc -- <build.json|dir> [--mode damage|stagger|cleave|toughness] [--json|--text|--compare <file>] [--freeze]",
    );
  }

  const mode = (values.mode ?? "damage") as Mode;
  if (!Object.keys(MODE_CONFIG).includes(mode)) {
    throw new Error(`Unknown --mode "${mode}". Valid modes: damage, stagger, cleave, toughness`);
  }

  const modeConfig = MODE_CONFIG[mode];

  const index = loadIndex();
  const calcData = loadCalculatorData();
  const staggerSettings = mode === "stagger" ? loadStaggerSettings() : ({} as Record<string, never>);

  const deps: ComputeDeps = { index, calcData, staggerSettings };

  function processFile(filePath: string) {
    const build = JSON.parse(readFileSync(filePath, "utf-8")) as AnyRecord;
    const result = modeConfig.compute(build, deps);
    return { build, result };
  }

  // Compare mode (damage only)
  if (values.compare) {
    if (mode !== "damage") {
      throw new Error("--compare is only valid with --mode damage");
    }
    const { build: buildA, result: matrixA } = processFile(target);
    const { build: buildB, result: matrixB } = processFile(values.compare as string);

    if (values.json) {
      console.log(JSON.stringify({ buildA: matrixA, buildB: matrixB }, calcReplacer, 2));
    } else {
      console.log(formatCompare(matrixA, buildA, matrixB, buildB));
    }
    return;
  }

  const stat = statSync(target);

  if (stat.isDirectory()) {
    const files = readdirSync(target).filter((f) => f.endsWith(".json")).sort();
    let failures = 0;

    if (values.freeze) {
      mkdirSync(modeConfig.freezeDir, { recursive: true });

      for (const f of files) {
        try {
          const { result } = processFile(join(target, f));
          const prefix = basename(f, ".json");
          writeFileSync(
            join(modeConfig.freezeDir, `${prefix}${modeConfig.snapshotSuffix}`),
            JSON.stringify(result, calcReplacer, 2) + "\n",
          );
          if (mode === "toughness") {
            console.log(`Frozen: ${prefix}`);
          } else {
            const weaponCount = (result.weapons as unknown[]).length;
            console.log(`Frozen: ${prefix} (${weaponCount} weapon${weaponCount !== 1 ? "s" : ""})`);
          }
        } catch (err) {
          console.error(`SKIP ${f}: ${(err as Error).message}`);
          failures++;
        }
      }
      if (failures > 0) console.error(`${failures} build(s) skipped due to errors.`);
      return;
    }

    for (const f of files) {
      try {
        const { build, result } = processFile(join(target, f));
        if (values.json) {
          console.log(JSON.stringify(result, calcReplacer, 2));
        } else {
          console.log(modeConfig.formatText(result, build));
          console.log("");
        }
      } catch (err) {
        console.error(`SKIP ${f}: ${(err as Error).message}`);
        failures++;
      }
    }
    if (failures > 0) console.error(`${failures} build(s) skipped due to errors.`);
  } else {
    const { build, result } = processFile(target);
    if (values.json) {
      console.log(JSON.stringify(result, calcReplacer, 2));
    } else {
      console.log(modeConfig.formatText(result, build));
    }
  }
});
