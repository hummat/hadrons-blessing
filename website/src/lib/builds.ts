export const CLASS_COLORS: Record<string, string> = {
  veteran: "text-amber-400",
  zealot: "text-red-400",
  psyker: "text-violet-400",
  ogryn: "text-green-400",
  arbites: "text-blue-400",
  "hive scum": "text-yellow-300",
};

export const GRADE_STYLES: Record<string, string> = {
  S: "text-amber-300 bg-amber-950/50 border-amber-800",
  A: "text-emerald-300 bg-emerald-950/50 border-emerald-800",
  B: "text-sky-300 bg-sky-950/50 border-sky-800",
  C: "text-yellow-300 bg-yellow-950/50 border-yellow-800",
  D: "text-red-300 bg-red-950/50 border-red-800",
};

export function buildSlugFromFile(file: string): string {
  return file.endsWith(".json") ? file.slice(0, -5) : file;
}

export function scoreColor(v: number | string | null): string {
  if (v == null) return "text-gray-600";
  const n = typeof v === "string" ? 0 : v;
  if (n >= 4) return "text-emerald-400";
  if (n >= 3) return "text-sky-400";
  if (n >= 2) return "text-yellow-400";
  return "text-red-400";
}

export function htkCellClass(htk: number | null): string {
  if (htk == null) return "bg-gray-900 text-gray-500";
  if (htk <= 1) return "bg-emerald-950/50 text-emerald-300";
  if (htk === 2) return "bg-yellow-950/50 text-yellow-300";
  return "bg-red-950/50 text-red-300";
}
