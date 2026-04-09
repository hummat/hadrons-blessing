import { base } from "$app/paths";
import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import type { BuildDetailData } from "$lib/types";

export const load: PageLoad = async ({ fetch, params }) => {
  const res = await fetch(`${base}/data/builds/${params.slug}.json`);

  if (!res.ok) {
    throw error(404, `Unknown build: ${params.slug}`);
  }

  const detail: BuildDetailData = await res.json();
  return { detail };
};
