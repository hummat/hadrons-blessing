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

  const CLASS_CLASS: Record<string, string> = {
    veteran: "ds-ledger-class--veteran",
    zealot: "ds-ledger-class--zealot",
    psyker: "ds-ledger-class--psyker",
    ogryn: "ds-ledger-class--ogryn",
    arbites: "ds-ledger-class--arbites",
    "hive scum": "ds-ledger-class--scum",
  };

  function titleCase(value: string): string {
    return value
      .split(/[_\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function dimCellClass(value: number | null): string {
    if (value == null) return "ds-ledger-dim ds-ledger-dim--null";
    if (value >= 4) return "ds-ledger-dim ds-ledger-dim--high";
    if (value >= 3) return "ds-ledger-dim ds-ledger-dim--mid";
    if (value >= 2) return "ds-ledger-dim ds-ledger-dim--warn";
    return "ds-ledger-dim ds-ledger-dim--low";
  }

  function gradeStampClass(grade: string): string {
    const suffix = grade.toLowerCase();
    return `ds-grade-stamp ds-grade-stamp--${suffix}`;
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
  <title>Commander's Manifest — Hadron's Blessing</title>
</svelte:head>

<div class="dataslate-root ds-manifest" class:ds-manifest--tray-active={selectedBuilds.length > 0}>
  <header class="ds-manifest-head">
    <div class="ds-manifest-head__copy">
      <span class="ds-manifest-kicker">Ordo Tacticae · Fixture Registry</span>
      <h1 class="ds-manifest-title">Commander's Manifest</h1>
    </div>
    <div class="ds-manifest-meta">
      <span>
        <span class="ds-manifest-meta__count">{filtered.length}</span> of {data.builds.length} records
      </span>
      <span aria-hidden="true">·</span>
      <span>Sorted by {sortLabel}{sortDesc ? " ↓" : " ↑"}</span>
    </div>
  </header>

  <section class="ds-query-bar" aria-label="Cogitator query">
    <div class="ds-query-grid">
      <label class="ds-query-cell">
        <span class="ds-label">Class</span>
        <select bind:value={classFilter} class="ds-query-select">
          <option value="">All classes</option>
          {#each CLASSES as cls}
            <option value={cls}>{titleCase(cls)}</option>
          {/each}
        </select>
      </label>

      <label class="ds-query-cell">
        <span class="ds-label">Weapon</span>
        <input
          type="text"
          bind:value={weaponFilter}
          placeholder="Search by weapon or family…"
          class="ds-query-input"
        />
      </label>

      <label class="ds-query-cell">
        <span class="ds-label">Minimum grade</span>
        <select bind:value={gradeFilter} class="ds-query-select">
          <option value="">Any grade</option>
          {#each GRADES as grade}
            <option value={grade}>{grade}+</option>
          {/each}
        </select>
      </label>

      <label class="ds-query-cell">
        <span class="ds-label">Sort by</span>
        <select onchange={setSort} value={sortKey} class="ds-query-select">
          {#each SORT_OPTIONS as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </label>

      <button
        type="button"
        class="ds-query-reset"
        onclick={clearFilters}
        disabled={!hasActiveFilters}
        aria-disabled={!hasActiveFilters}
      >
        Reset query
      </button>
    </div>
  </section>

  <div class="ds-rule ds-rule--standalone"><span class="ds-rule__mark">✦</span></div>

  <section class="ds-ledger" aria-label="Build manifest">
    {#if filtered.length === 0}
      <p class="ds-ledger-empty">The cogitator finds no records matching that query.</p>
    {:else}
      <table class="ds-ledger-table">
        <thead>
          <tr>
            <th class="ds-ledger-cmp-cell" aria-label="Select for comparison"></th>
            <th class="ds-ledger-score-cell">
              <button
                type="button"
                class="ds-ledger-sort {sortKey === 'composite' ? 'ds-ledger-sort--active' : ''}"
                onclick={() => toggleSort("composite")}
              >
                Score
                {#if sortKey === "composite"}<span class="ds-ledger-sort__mark">{sortDesc ? "▼" : "▲"}</span>{/if}
              </button>
            </th>
            <th class="ds-ledger-title-cell">Record</th>
            <th class="ds-ledger-class-cell">Class</th>
            <th class="ds-ledger-loadout-cell">Loadout</th>
            {#each DIM_COLUMNS as col}
              <th>
                <button
                  type="button"
                  class="ds-ledger-sort {sortKey === col.key ? 'ds-ledger-sort--active' : ''}"
                  onclick={() => toggleSort(col.key)}
                  title={col.label}
                >
                  {col.abbr}
                  {#if sortKey === col.key}<span class="ds-ledger-sort__mark">{sortDesc ? "▼" : "▲"}</span>{/if}
                </button>
              </th>
            {/each}
            <th class="ds-ledger-grade-cell">Grade</th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as build (build.file)}
            {@const slug = buildSlugFromFile(build.file)}
            {@const isSelected = selectedBuilds.includes(slug)}
            <tr class={`ds-ledger-row ${isSelected ? "ds-ledger-row--selected" : ""}`}>
              <td class="ds-ledger-cmp-cell">
                <input
                  type="checkbox"
                  class="ds-ledger-cmp"
                  aria-label={`Select ${build.title} for comparison`}
                  checked={isSelected}
                  disabled={!isSelected && selectedBuilds.length >= 2}
                  onchange={() => toggleSelected(slug)}
                />
              </td>
              <td class="ds-ledger-score-cell">
                <span class="ds-ledger-score">
                  {build.scores.composite}<span class="ds-ledger-score__max">/35</span>
                </span>
              </td>
              <td class="ds-ledger-title-cell">
                <a class="ds-ledger-title" href={`${base}/builds/${slug}`}>
                  {build.title}
                </a>
                {#if build.keystone || build.ability}
                  <div class="ds-ledger-sub">
                    {#if build.keystone}{build.keystone}{/if}
                    {#if build.keystone && build.ability} · {/if}
                    {#if build.ability}{build.ability}{/if}
                  </div>
                {/if}
              </td>
              <td class="ds-ledger-class-cell">
                <span class={`ds-ledger-class ${CLASS_CLASS[build.class] ?? ""}`}>
                  {build.class}
                </span>
              </td>
              <td class="ds-ledger-loadout-cell">
                {#each build.weapons as weapon}
                  <div class="ds-ledger-weapon-line">
                    <span class="ds-ledger-weapon-slot">{weapon.slot ?? "Wpn"}</span>
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
              <td class="ds-ledger-grade-cell">
                <span class={gradeStampClass(build.scores.grade)}>{build.scores.grade}</span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
</div>

<aside class={`ds-compare-tray ${selectedBuilds.length > 0 ? "ds-compare-tray--active" : ""}`} aria-live="polite">
  <span class="ds-compare-tray__label">Cogitator queue · {selectedBuilds.length}/2</span>
  <div class="ds-compare-tray__slots">
    {#each [0, 1] as idx}
      {@const slug = selectedBuilds[idx]}
      {#if idx === 1}<span class="ds-compare-tray__joiner">✦</span>{/if}
      <span class={`ds-compare-tray__slot ${slug ? "ds-compare-tray__slot--filled" : "ds-compare-tray__slot--empty"}`}>
        {slug ? buildTitleBySlug(slug) : idx === 0 ? "Select first record" : "Select second record"}
      </span>
    {/each}
  </div>
  <button type="button" class="ds-compare-tray__clear" onclick={clearSelection}>Clear</button>
  <button type="button" class="ds-compare-tray__go" disabled={!compareReady} onclick={() => void compareSelected()}>
    Compare
  </button>
</aside>
