<script lang="ts">
  import { goto } from "$app/navigation";
  import { base } from "$app/paths";
  import { buildSlugFromFile, CLASS_COLORS, GRADE_STYLES, scoreColor } from "$lib/builds";
  import { DIMENSIONS } from "$lib/dimensions";
  import { filterAndSort } from "$lib/filter-sort";

  let { data } = $props();

  // Filter state
  let classFilter = $state("");
  let weaponFilter = $state("");
  let gradeFilter = $state("");

  // Sort state
  let sortKey = $state("composite");
  let sortDesc = $state(true);
  let selectedBuilds = $state<string[]>([]);

  const CLASSES = ["veteran", "zealot", "psyker", "ogryn", "arbites", "hive scum"];
  const GRADES = ["S", "A", "B", "C", "D"];

  const ABBR: Record<string, string> = {
    composite: "Ovr",
    perk_optimality: "Prk",
    curio_efficiency: "Cur",
    talent_coherence: "Tal",
    blessing_synergy: "Bls",
    role_coverage: "Rol",
    breakpoint_relevance: "BP",
    difficulty_scaling: "Scl",
  };

  const COLUMNS: { key: string; label: string; abbr?: string }[] = DIMENSIONS.map((dimension) => ({
    key: dimension.summary_key,
    label: dimension.label,
    abbr: ABBR[dimension.summary_key],
  }));

  let filtered = $derived(
    filterAndSort(data.builds, {
      class: classFilter || undefined,
      weapon: weaponFilter || undefined,
      minGrade: gradeFilter || undefined,
      sort: sortKey,
      reverse: !sortDesc,
    }),
  );

  function toggleSort(key: string) {
    if (sortKey === key) {
      sortDesc = !sortDesc;
    } else {
      sortKey = key;
      sortDesc = true;
    }
  }

  function toggleSelected(slug: string) {
    if (selectedBuilds.includes(slug)) {
      selectedBuilds = selectedBuilds.filter((value) => value !== slug);
      return;
    }

    if (selectedBuilds.length >= 2) {
      return;
    }

    selectedBuilds = [...selectedBuilds, slug];
  }

  async function compareSelected() {
    if (selectedBuilds.length !== 2) return;
    const [a, b] = selectedBuilds;
    selectedBuilds = [];
    await goto(`${base}/compare?builds=${a},${b}`);
  }

</script>

<svelte:head>
  <title>Builds — Hadron's Blessing</title>
</svelte:head>

<div class="flex items-baseline justify-between mb-6">
  <h1 class="text-2xl font-bold">Builds</h1>
  <span class="text-gray-500 text-sm">
    {filtered.length} of {data.builds.length} builds
  </span>
</div>

<!-- Filters -->
<div class="flex flex-wrap gap-3 mb-6">
  <select
    bind:value={classFilter}
    class="bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm
           focus:outline-none focus:border-amber-600"
  >
    <option value="">All Classes</option>
    {#each CLASSES as cls}
      <option value={cls}>{cls.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}</option>
    {/each}
  </select>

  <input
    type="text"
    bind:value={weaponFilter}
    placeholder="Filter by weapon..."
    class="bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm w-52
           focus:outline-none focus:border-amber-600"
  />

  <select
    bind:value={gradeFilter}
    class="bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm
           focus:outline-none focus:border-amber-600"
  >
    <option value="">Any Grade</option>
    {#each GRADES as grade}
      <option value={grade}>{grade}+</option>
    {/each}
  </select>

  <button
    type="button"
    onclick={() => void compareSelected()}
    disabled={selectedBuilds.length !== 2}
    class="rounded-md border px-3 py-2 text-sm transition-colors {selectedBuilds.length === 2 ? 'border-amber-700 bg-amber-950/40 text-amber-200 hover:bg-amber-950/60' : 'border-gray-800 bg-gray-900 text-gray-600'}"
  >
    Compare
  </button>
</div>

<!-- Scorecard Table -->
<div class="overflow-x-auto rounded-lg border border-gray-800">
  <table class="w-full text-sm">
    <thead>
      <tr class="bg-gray-900/80 text-gray-400 text-left">
        <th class="px-3 py-3 font-medium text-center">Cmp</th>
        <th class="px-4 py-3 font-medium">Build</th>
        <th class="px-3 py-3 font-medium">Class</th>
        <th class="px-3 py-3 font-medium">Weapons</th>
        {#each COLUMNS as col}
          <th class="px-2 py-3 font-medium whitespace-nowrap">
            <button
              class="hover:text-gray-200 transition-colors"
              onclick={() => toggleSort(col.key)}
            >
              <span class="hidden lg:inline">{col.label}</span>
              <span class="lg:hidden">{col.abbr ?? col.label}</span>
              {#if sortKey === col.key}
                <span class="text-amber-400 ml-0.5">{sortDesc ? "\u25BC" : "\u25B2"}</span>
              {/if}
            </button>
          </th>
        {/each}
        <th class="px-3 py-3 font-medium text-center">Grade</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-gray-900">
      {#each filtered as build (build.file)}
        {@const slug = buildSlugFromFile(build.file)}
        <tr class="hover:bg-gray-900/40 transition-colors">
          <td class="px-3 py-3 text-center">
            <input
              type="checkbox"
              checked={selectedBuilds.includes(slug)}
              disabled={!selectedBuilds.includes(slug) && selectedBuilds.length >= 2}
              onchange={() => toggleSelected(slug)}
              class="h-4 w-4 rounded border-gray-700 bg-gray-900 text-amber-500 focus:ring-amber-600"
            />
          </td>
          <td class="px-4 py-3 font-medium whitespace-nowrap">
            <a
              href={`${base}/builds/${slug}`}
              class="text-gray-100 hover:text-amber-300 transition-colors"
            >
              {build.title}
            </a>
          </td>
          <td class="px-3 py-3 capitalize {CLASS_COLORS[build.class] ?? 'text-gray-400'}">
            {build.class}
          </td>
          <td class="px-3 py-3 text-gray-400 text-xs max-w-52 truncate" title={build.weapons.map((w) => w.name).join(", ")}>
            {build.weapons.map((w) => w.name).join(", ")}
          </td>
          {#each COLUMNS as col}
            {@const val = build.scores[col.key as keyof typeof build.scores]}
            <td class="px-2 py-3 tabular-nums text-center {scoreColor(val)}">
              {val ?? "\u2014"}
            </td>
          {/each}
          <td class="px-3 py-3 text-center">
            <span class="inline-block px-2 py-0.5 rounded border text-xs font-bold
                         {GRADE_STYLES[build.scores.grade] ?? ''}">
              {build.scores.grade}
            </span>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

{#if filtered.length === 0}
  <p class="text-center text-gray-500 py-12">No builds match the current filters.</p>
{/if}
