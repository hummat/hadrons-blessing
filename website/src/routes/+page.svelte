<script lang="ts">
  import { filterAndSort } from "$lib/filter-sort";

  let { data } = $props();

  // Filter state
  let classFilter = $state("");
  let weaponFilter = $state("");
  let gradeFilter = $state("");

  // Sort state
  let sortKey = $state("composite");
  let sortDesc = $state(true);

  const CLASSES = ["veteran", "zealot", "psyker", "ogryn", "arbites", "hivescum"];
  const GRADES = ["S", "A", "B", "C", "D"];

  const COLUMNS: { key: string; label: string; abbr?: string }[] = [
    { key: "composite", label: "Overall" },
    { key: "perk_optimality", label: "Perks", abbr: "Prk" },
    { key: "curio_efficiency", label: "Curios", abbr: "Cur" },
    { key: "talent_coherence", label: "Talents", abbr: "Tal" },
    { key: "blessing_synergy", label: "Blessings", abbr: "Bls" },
    { key: "role_coverage", label: "Role", abbr: "Rol" },
    { key: "breakpoint_relevance", label: "Breakpoints", abbr: "BP" },
    { key: "difficulty_scaling", label: "Scaling", abbr: "Scl" },
  ];

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

  const CLASS_COLORS: Record<string, string> = {
    veteran: "text-amber-400",
    zealot: "text-red-400",
    psyker: "text-violet-400",
    ogryn: "text-green-400",
    arbites: "text-blue-400",
    hivescum: "text-yellow-300",
  };

  const GRADE_STYLES: Record<string, string> = {
    S: "text-amber-300 bg-amber-950/50 border-amber-800",
    A: "text-emerald-300 bg-emerald-950/50 border-emerald-800",
    B: "text-sky-300 bg-sky-950/50 border-sky-800",
    C: "text-yellow-300 bg-yellow-950/50 border-yellow-800",
    D: "text-red-300 bg-red-950/50 border-red-800",
  };

  function scoreColor(v: number | string | null): string {
    if (v == null) return "text-gray-600";
    const n = typeof v === "string" ? 0 : v;
    if (n >= 4) return "text-emerald-400";
    if (n >= 3) return "text-sky-400";
    if (n >= 2) return "text-yellow-400";
    return "text-red-400";
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
      <option value={cls}>{cls.charAt(0).toUpperCase() + cls.slice(1)}</option>
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
</div>

<!-- Scorecard Table -->
<div class="overflow-x-auto rounded-lg border border-gray-800">
  <table class="w-full text-sm">
    <thead>
      <tr class="bg-gray-900/80 text-gray-400 text-left">
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
        <tr class="hover:bg-gray-900/40 transition-colors">
          <td class="px-4 py-3 font-medium whitespace-nowrap">{build.title}</td>
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
