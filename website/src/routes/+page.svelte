<script lang="ts">
  import { goto } from "$app/navigation";
  import { base } from "$app/paths";
  import { buildSlugFromFile } from "$lib/builds";
  import { DIMENSIONS } from "$lib/dimensions";
  import { filterAndSort } from "$lib/filter-sort";

  let { data } = $props();

  let classFilter = $state("");
  let weaponFilter = $state("");
  let gradeFilter = $state("");
  let sortKey = $state("composite");
  let sortDesc = $state(true);
  let selectedBuilds = $state<string[]>([]);

  const CLASSES = ["veteran", "zealot", "psyker", "ogryn", "arbites", "hive scum"];
  const GRADES = ["S", "A", "B", "C", "D"];

  const HEADER_ABBR: Record<string, string> = {
    perk_optimality: "Prk",
    curio_efficiency: "Cur",
    talent_coherence: "Tal",
    blessing_synergy: "Bls",
    role_coverage: "Rol",
    breakpoint_relevance: "BP",
    difficulty_scaling: "Scl",
  };

  const DIM_COLUMNS = DIMENSIONS.filter((d) => d.summary_key !== "composite").map((dimension) => ({
    key: dimension.summary_key,
    label: dimension.label,
    abbr: HEADER_ABBR[dimension.summary_key] ?? dimension.label,
  }));

  const SORT_OPTIONS = [
    { value: "composite", label: "Overall score" },
    ...DIM_COLUMNS.map((col) => ({ value: col.key, label: col.label })),
  ];

  function titleCase(value: string): string {
    return value
      .split(/[_\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function classKey(cls: string): string {
    return cls.replace(/\s+/g, "-").toLowerCase();
  }

  function dimCellClass(value: number | null): string {
    if (value == null) return "hb-ledger-dim hb-ledger-dim--null";
    if (value >= 4) return "hb-ledger-dim hb-ledger-dim--high";
    if (value >= 3) return "hb-ledger-dim hb-ledger-dim--mid";
    if (value >= 2) return "hb-ledger-dim hb-ledger-dim--warn";
    return "hb-ledger-dim hb-ledger-dim--low";
  }

  function buildTitleBySlug(slug: string): string {
    const match = data.builds.find((b) => buildSlugFromFile(b.file) === slug);
    return match?.title ?? slug;
  }

  let filtered = $derived(
    filterAndSort(data.builds, {
      class: classFilter || undefined,
      weapon: weaponFilter || undefined,
      minGrade: gradeFilter || undefined,
      sort: sortKey,
      reverse: !sortDesc,
    }),
  );

  let hasActiveFilters = $derived(Boolean(classFilter || weaponFilter || gradeFilter));
  let compareReady = $derived(selectedBuilds.length === 2);
  let sortLabel = $derived(SORT_OPTIONS.find((o) => o.value === sortKey)?.label ?? "Overall score");

  function toggleSort(key: string) {
    if (sortKey === key) {
      sortDesc = !sortDesc;
    } else {
      sortKey = key;
      sortDesc = true;
    }
  }

  function setSort(event: Event) {
    sortKey = (event.target as HTMLSelectElement).value;
    sortDesc = true;
  }

  function toggleSelected(slug: string) {
    if (selectedBuilds.includes(slug)) {
      selectedBuilds = selectedBuilds.filter((v) => v !== slug);
      return;
    }
    if (selectedBuilds.length >= 2) return;
    selectedBuilds = [...selectedBuilds, slug];
  }

  function clearFilters() {
    classFilter = "";
    weaponFilter = "";
    gradeFilter = "";
  }

  function clearSelection() {
    selectedBuilds = [];
  }

  async function compareSelected() {
    if (selectedBuilds.length !== 2) return;
    const [a, b] = selectedBuilds;
    selectedBuilds = [];
    await goto(`${base}/compare?builds=${a},${b}`);
  }
</script>

<svelte:head>
  <title>Manifest — Hadron's Blessing</title>
</svelte:head>

<div class="dataslate-root">
  <section class="hb-reveal">
    <div class="section-heading">
      <h2>Commander's Manifest</h2>
      <div class="section-rule"></div>
      <div class="section-meta">
        {filtered.length} of {data.builds.length} records · sorted by {sortLabel} {sortDesc ? "↓" : "↑"}
      </div>
    </div>
  </section>

  <section class="hb-reveal d1 hb-query-bar" aria-label="Cogitator query">
    <div class="hb-query-grid">
      <label class="field-stack">
        <span class="field-label">Class</span>
        <select bind:value={classFilter} class="form-control">
          <option value="">All classes</option>
          {#each CLASSES as cls}
            <option value={cls}>{titleCase(cls)}</option>
          {/each}
        </select>
      </label>

      <label class="field-stack">
        <span class="field-label">Weapon</span>
        <input
          type="text"
          bind:value={weaponFilter}
          placeholder="Search by weapon or family…"
          class="form-control"
        />
      </label>

      <label class="field-stack">
        <span class="field-label">Minimum grade</span>
        <select bind:value={gradeFilter} class="form-control">
          <option value="">Any grade</option>
          {#each GRADES as grade}
            <option value={grade}>{grade}+</option>
          {/each}
        </select>
      </label>

      <label class="field-stack">
        <span class="field-label">Sort by</span>
        <select onchange={setSort} value={sortKey} class="form-control">
          {#each SORT_OPTIONS as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </label>

      <button
        type="button"
        class="button-secondary"
        onclick={clearFilters}
        disabled={!hasActiveFilters}
        aria-disabled={!hasActiveFilters}
      >
        Reset
      </button>
    </div>
  </section>

  <section class="hb-reveal d2 hb-ledger" aria-label="Build manifest">
    {#if filtered.length === 0}
      <p class="hb-ledger-empty">The cogitator finds no records matching that query.</p>
    {:else}
      <table class="hb-ledger-table">
        <thead>
          <tr>
            <th aria-label="Select for comparison"></th>
            <th>
              <button
                type="button"
                class="hb-ledger-sort"
                class:hb-ledger-sort--active={sortKey === "composite"}
                onclick={() => toggleSort("composite")}
              >
                Score
                {#if sortKey === "composite"}<span class="hb-ledger-sort__mark">{sortDesc ? "▼" : "▲"}</span>{/if}
              </button>
            </th>
            <th>Record</th>
            <th>Class</th>
            <th>Loadout</th>
            {#each DIM_COLUMNS as col}
              <th>
                <button
                  type="button"
                  class="hb-ledger-sort"
                  class:hb-ledger-sort--active={sortKey === col.key}
                  onclick={() => toggleSort(col.key)}
                  title={col.label}
                >
                  {col.abbr}
                  {#if sortKey === col.key}<span class="hb-ledger-sort__mark">{sortDesc ? "▼" : "▲"}</span>{/if}
                </button>
              </th>
            {/each}
            <th>Grade</th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as build (build.file)}
            {@const slug = buildSlugFromFile(build.file)}
            {@const isSelected = selectedBuilds.includes(slug)}
            <tr class:hb-ledger-row--selected={isSelected}>
              <td>
                <input
                  type="checkbox"
                  class="hb-ledger-cmp"
                  aria-label={`Select ${build.title} for comparison`}
                  checked={isSelected}
                  disabled={!isSelected && selectedBuilds.length >= 2}
                  onchange={() => toggleSelected(slug)}
                />
              </td>
              <td>
                <span class="hb-ledger-score mono-num">
                  {build.scores.composite}<span class="hb-ledger-score__max">/35</span>
                </span>
              </td>
              <td>
                <a class="hb-ledger-title" href={`${base}/builds/${slug}`}>{build.title}</a>
                {#if build.keystone || build.ability}
                  <div class="hb-ledger-sub">
                    {#if build.keystone}{build.keystone}{/if}
                    {#if build.keystone && build.ability} · {/if}
                    {#if build.ability}{build.ability}{/if}
                  </div>
                {/if}
              </td>
              <td>
                <span class={`class-chip ${classKey(build.class)}`}>{titleCase(build.class)}</span>
              </td>
              <td>
                {#each build.weapons as weapon}
                  <div class="hb-ledger-weapon-line">
                    <span class="hb-ledger-weapon-slot">{titleCase(weapon.slot ?? "Wpn")}</span>
                    <span>{weapon.name}</span>
                  </div>
                {/each}
              </td>
              {#each DIM_COLUMNS as col}
                {@const val = build.scores[col.key as keyof typeof build.scores]}
                <td class={dimCellClass(val as number | null)}>
                  {val ?? "—"}
                </td>
              {/each}
              <td class="hb-ledger-grade-cell">
                <span class={`grade grade--sm ${build.scores.grade.toLowerCase()}`}>{build.scores.grade}</span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
</div>

<aside
  class="hb-compare-tray"
  class:hb-compare-tray--active={selectedBuilds.length > 0}
  aria-live="polite"
>
  <span>Queue · {selectedBuilds.length}/2</span>
  <div class="hb-compare-tray__slots">
    {#each [0, 1] as idx}
      {@const slug = selectedBuilds[idx]}
      {#if idx === 1}<span class="hb-compare-tray__joiner">×</span>{/if}
      <span class="hb-compare-tray__slot" class:hb-compare-tray__slot--filled={Boolean(slug)}>
        {slug ? buildTitleBySlug(slug) : idx === 0 ? "Select first" : "Select second"}
      </span>
    {/each}
  </div>
  <button type="button" class="hb-compare-tray__clear" onclick={clearSelection}>Clear</button>
  <button type="button" class="hb-compare-tray__go" disabled={!compareReady} onclick={() => void compareSelected()}>
    Compare
  </button>
</aside>
