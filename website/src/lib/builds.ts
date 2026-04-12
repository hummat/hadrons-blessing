export const CLASS_COLORS: Record<string, string> = {
  veteran: "text-class-veteran",
  zealot: "text-class-zealot",
  psyker: "text-class-psyker",
  ogryn: "text-class-ogryn",
  arbites: "text-class-arbites",
  "hive scum": "text-class-scum",
};

export const GRADE_STYLES: Record<string, string> = {
  S: "grade-badge grade-badge--s",
  A: "grade-badge grade-badge--a",
  B: "grade-badge grade-badge--b",
  C: "grade-badge grade-badge--c",
  D: "grade-badge grade-badge--d",
};

export function buildSlugFromFile(file: string): string {
  return file.endsWith(".json") ? file.slice(0, -5) : file;
}

export function scoreColor(v: number | string | null): string {
  if (v == null) return "score-value score-value--null";
  const n = typeof v === "string" ? 0 : v;
  if (n >= 4) return "score-value score-value--high";
  if (n >= 3) return "score-value score-value--mid";
  if (n >= 2) return "score-value score-value--warn";
  return "score-value score-value--low";
}

export function htkCellClass(htk: number | null): string {
  if (htk == null) return "htk-cell htk-cell--null";
  if (htk <= 1) return "htk-cell htk-cell--best";
  if (htk === 2) return "htk-cell htk-cell--mid";
  return "htk-cell htk-cell--worst";
}
