import { base } from "$app/paths";
import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import type { BuildDetailData } from "$lib/types";

export const load: PageLoad = async ({ fetch, params }) => {
  const res = await fetch(`${base}/data/builds/${params.slug}.json`);

  if (!res.ok) {
    throw error(404, `Unknown build: ${params.slug}`);
  }

  let detail: BuildDetailData;
  try {
    detail = await res.json();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw error(500, `Corrupt build data for ${params.slug}: ${reason}`);
  }
  return { detail };
};
