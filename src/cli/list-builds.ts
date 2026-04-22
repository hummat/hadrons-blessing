// src/cli/list-builds.ts
import { parseArgs } from "node:util";
import { runCliMain } from "../lib/cli.js";
import { listBuilds } from "../lib/build-list.js";
import type { BuildSummary } from "../lib/build-list.js";

const VALID_GRADES = new Set(["S", "A", "B", "C", "D"]);

function formatTable(summaries: BuildSummary[]): string {
  const lines: string[] = [];

  // Header
  const hdr = [
    "Grade".padEnd(6),
    "Score".padEnd(6),
    "Class".padEnd(8),
    "PO".padEnd(4),
    "CE".padEnd(4),
    "TC".padEnd(4),
    "BS".padEnd(4),
    "RC".padEnd(4),
    "BR".padEnd(4),
    "DS".padEnd(4),
    "SV".padEnd(4),
    "Title",
  ];
  lines.push(hdr.join(""));
  lines.push("-".repeat(76));

  for (const s of summaries) {
    const dim = (v: number | null) => v != null ? String(v).padEnd(4) : "-".padEnd(4);
    const row = [
      s.scores.grade.padEnd(6),
      String(s.scores.composite).padEnd(6),
      s.class.padEnd(8),
      dim(s.scores.perk_optimality),
      dim(s.scores.curio_efficiency),
      dim(s.scores.talent_coherence),
      dim(s.scores.blessing_synergy),
      dim(s.scores.role_coverage),
      dim(s.scores.breakpoint_relevance),
      dim(s.scores.difficulty_scaling),
      dim(s.scores.survivability),
      s.title.length > 40 ? s.title.slice(0, 37) + "..." : s.title,
    ];
    lines.push(row.join(""));
  }

  lines.push("");
  lines.push(`${summaries.length} build(s)`);

  return lines.join("\n");
}

await runCliMain("list", async () => {
  const { values, positionals } = parseArgs({
    options: {
      class: { type: "string" },
      weapon: { type: "string" },
      grade: { type: "string" },
      sort: { type: "string" },
      reverse: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  const dir = positionals[0] ?? "data/builds";
  const minGrade = values.grade?.toUpperCase();

  if (minGrade && !VALID_GRADES.has(minGrade)) {
    throw new Error(`Invalid grade: "${values.grade}". Valid grades: S, A, B, C, D`);
  }

  const summaries = listBuilds(dir, {
    class: values.class as string | undefined,
    weapon: values.weapon as string | undefined,
    minGrade,
    sort: values.sort as string | undefined,
    reverse: values.reverse as boolean | undefined,
  });

  if (values.json) {
    console.log(JSON.stringify(summaries, null, 2));
  } else {
    console.log(formatTable(summaries));
  }
});
