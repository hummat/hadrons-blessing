import type { PageLoad } from "./$types";
import type { BuildSummary } from "$lib/types";

export const load: PageLoad = async ({ fetch }) => {
  const res = await fetch("/data/build-summaries.json");
  const builds: BuildSummary[] = await res.json();
  return { builds };
};
