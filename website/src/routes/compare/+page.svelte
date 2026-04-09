<script lang="ts">
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { base } from "$app/paths";
  import { page } from "$app/state";
  import { CLASS_COLORS, GRADE_STYLES, htkCellClass, scoreColor } from "$lib/builds";
  import {
    computeBreakpointDiff,
    computeScoreDeltas,
    computeSetDiff,
    computeSlotDiff,
    computeSynergyEdgeDiff,
    talentEntries,
    weaponEntries,
  } from "$lib/compare";
  import { DIMENSIONS } from "$lib/dimensions";
  import type { BuildDetailData, BuildSummary } from "$lib/types";

  type Props = {
    data: {
      builds: BuildSummary[];
    };
  };

  type TabKey = "overview" | "talents" | "weapons" | "synergy" | "breakpoints";

  const TABS: Array<{ key: TabKey; label: string }> = [
    { key: "overview", label: "Overview" },
    { key: "talents", label: "Talents" },
    { key: "weapons", label: "Weapons" },
    { key: "synergy", label: "Synergy" },
    { key: "breakpoints", label: "Breakpoints" },
  ];

  const DIFFICULTIES = ["uprising", "malice", "heresy", "damnation", "auric"];

  let { data }: Props = $props();

  let activeTab = $state<TabKey>("overview");
  let buildASlug = $state("");
  let buildBSlug = $state("");
  let buildA = $state<BuildDetailData | null>(null);
  let buildB = $state<BuildDetailData | null>(null);
  let loadingA = $state(false);
  let loadingB = $state(false);
  let errorA = $state<string | null>(null);
  let errorB = $state<string | null>(null);
  let selectedScenario = $state("sustained");
  let selectedDifficulty = $state("damnation");

  let requestA = 0;
  let requestB = 0;

  const availableScenarios = $derived.by(() => {
    const values = new Set<string>();
    for (const detail of [buildA, buildB]) {
      for (const scenario of detail?.breakpoints.metadata.scenarios ?? []) {
        values.add(scenario);
      }
    }
    return [...values];
  });

  const scoreDeltas = $derived(buildA && buildB ? computeScoreDeltas(buildA, buildB) : []);
  const slotDiffs = $derived(buildA && buildB ? computeSlotDiff(buildA.structure, buildB.structure) : []);
  const talentDiff = $derived(buildA && buildB ? computeSetDiff(talentEntries(buildA), talentEntries(buildB)) : null);
  const weaponDiff = $derived(buildA && buildB ? computeSetDiff(weaponEntries(buildA), weaponEntries(buildB)) : null);
  const synergyDiff = $derived(buildA && buildB ? computeSynergyEdgeDiff(buildA.synergy, buildB.synergy) : null);
  const breakpointDiff = $derived(
    buildA && buildB
      ? computeBreakpointDiff(
          buildA.breakpoints,
          buildB.breakpoints,
          selectedScenario,
          selectedDifficulty,
          buildA.scorecard.weapons,
          buildB.scorecard.weapons,
        )
      : [],
  );

  const buildBOptions = $derived.by(() => {
    if (!buildA || buildBSlug) return data.builds;
    return data.builds.filter((build) => build.class === buildA.summary.class);
  });

  function parseBuildsParam(value: string | null): [string, string] {
    const [a = "", b = ""] = (value ?? "").split(",", 2);
    return [a, b];
  }

  function titleCase(value: string): string {
    return value
      .split(/[_\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function formatDelta(value: number | null): string {
    if (value == null) return "\u2014";
    if (value === 0) return "0";
    return value > 0 ? `+${value}` : `${value}`;
  }

  function deltaColor(value: number | null): string {
    if (value == null || value === 0) return "text-gray-500";
    return value > 0 ? "text-emerald-400" : "text-red-400";
  }

  function scoreValue(detail: BuildDetailData | null, key: string): number | null {
    if (!detail) return null;
    return detail.summary.scores[key as keyof typeof detail.summary.scores] as number | null;
  }

  function buildHref(slug: string): string {
    return `${base}/builds/${slug}`;
  }

  function sharedWeaponPeer(compareKey: string): ReturnType<typeof weaponEntries>[number] | null {
    if (!buildB) return null;
    return weaponEntries(buildB).find((weapon) => weapon.compare_key === compareKey) ?? null;
  }

  function antiSynergyKey(entry: { type: string; selections: string[]; reason: string }): string {
    return `${entry.type}::${entry.reason}::${[...entry.selections].sort().join("|")}`;
  }

  async function syncUrl(nextA: string, nextB: string): Promise<void> {
    const builds = `${nextA},${nextB}`;
    if (page.url.searchParams.get("builds") === builds) return;
    await goto(`${base}/compare?builds=${builds}`, {
      replaceState: true,
      noScroll: true,
      keepFocus: true,
    });
  }

  async function updateBuilds(nextA: string, nextB: string): Promise<void> {
    buildASlug = nextA;
    buildBSlug = nextB;
    await syncUrl(nextA, nextB);
  }

  async function fetchBuild(slot: "a" | "b", slug: string): Promise<void> {
    const current = slot === "a" ? ++requestA : ++requestB;

    if (slot === "a") {
      buildA = null;
      errorA = null;
      loadingA = slug.length > 0;
    } else {
      buildB = null;
      errorB = null;
      loadingB = slug.length > 0;
    }

    if (!slug) return;

    try {
      const res = await fetch(`${base}/data/builds/${slug}.json`);
      if (!res.ok) {
        throw new Error(res.status === 404 ? "Build not found" : `Failed to load build (${res.status})`);
      }

      const detail = await res.json() as BuildDetailData;

      if (slot === "a") {
        if (current !== requestA) return;
        buildA = detail;
        errorA = null;
      } else {
        if (current !== requestB) return;
        buildB = detail;
        errorB = null;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load build";
      if (slot === "a") {
        if (current !== requestA) return;
        errorA = message;
      } else {
        if (current !== requestB) return;
        errorB = message;
      }
    } finally {
      if (slot === "a" && current === requestA) loadingA = false;
      if (slot === "b" && current === requestB) loadingB = false;
    }
  }

  $effect(() => {
    const [nextA, nextB] = parseBuildsParam(page.url.searchParams.get("builds"));
    if (buildASlug !== nextA) buildASlug = nextA;
    if (buildBSlug !== nextB) buildBSlug = nextB;
  });

  $effect(() => {
    if (!browser) return;
    void fetchBuild("a", buildASlug);
  });

  $effect(() => {
    if (!browser) return;
    void fetchBuild("b", buildBSlug);
  });

  $effect(() => {
    if (!availableScenarios.includes(selectedScenario)) {
      selectedScenario = availableScenarios[0] ?? "sustained";
    }
  });
</script>

<svelte:head>
  <title>Compare Builds — Hadron's Blessing</title>
</svelte:head>

<div class="space-y-6">
  <div class="space-y-3">
    <a href={`${base}/`} class="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-amber-300 transition-colors">
      <span aria-hidden="true">←</span>
      Back to builds
    </a>
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-bold text-gray-50">Compare Builds</h1>
      {#if buildA && buildB && buildA.summary.class !== buildB.summary.class}
        <span class="rounded-full border border-amber-800 bg-amber-950/40 px-3 py-1 text-xs uppercase tracking-[0.18em] text-amber-200">
          Cross-class comparison
        </span>
      {/if}
      {#if buildASlug && buildASlug === buildBSlug}
        <span class="rounded-full border border-gray-700 bg-gray-900 px-3 py-1 text-xs text-gray-300">
          Comparing build with itself — all deltas will be zero.
        </span>
      {/if}
    </div>
  </div>

  <section class="rounded-2xl border border-gray-800 bg-gray-900 p-5">
    <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-end">
      <label class="space-y-2">
        <span class="text-sm font-medium text-gray-300">Build A</span>
        <select
          bind:value={buildASlug}
          onchange={() => void syncUrl(buildASlug, buildBSlug)}
          class="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-amber-600 focus:outline-none"
        >
          <option value="">Select build…</option>
          {#each data.builds as build}
            <option value={build.file.replace(/\.json$/, "")}>{build.title}</option>
          {/each}
        </select>
      </label>

      <button
        type="button"
        onclick={() => void updateBuilds(buildBSlug, buildASlug)}
        class="rounded-lg border border-gray-700 bg-gray-950 px-4 py-2 text-sm text-gray-200 transition-colors hover:border-amber-700 hover:text-amber-200"
      >
        Swap A ↔ B
      </button>

      <label class="space-y-2">
        <span class="text-sm font-medium text-gray-300">Build B</span>
        <select
          bind:value={buildBSlug}
          onchange={() => void syncUrl(buildASlug, buildBSlug)}
          class="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-amber-600 focus:outline-none"
        >
          <option value="">Select build…</option>
          {#each buildBOptions as build}
            <option value={build.file.replace(/\.json$/, "")}>{build.title}</option>
          {/each}
        </select>
      </label>
    </div>
  </section>

  {#if loadingA && loadingB && !buildA && !buildB}
    <div class="rounded-2xl border border-gray-800 bg-gray-900 px-6 py-10 text-center text-gray-400">
      Loading builds...
    </div>
  {/if}

  <div class="flex flex-wrap gap-2">
    {#each TABS as tab}
      <button
        type="button"
        onclick={() => (activeTab = tab.key)}
        class="rounded-full border px-3 py-1.5 text-sm transition-colors {activeTab === tab.key ? 'border-amber-700 bg-amber-950/50 text-amber-200' : 'border-gray-800 bg-gray-900 text-gray-400 hover:text-gray-200'}"
      >
        {tab.label}
      </button>
    {/each}
  </div>

  {#if activeTab === "overview"}
    <section class="space-y-4 rounded-2xl border border-gray-800 bg-gray-900 p-5">
      <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)]">
        <article class="rounded-xl border border-gray-800 bg-gray-950 p-4">
          {#if buildA}
            <div class="space-y-3">
              <div class="flex flex-wrap items-center gap-3">
                <span class="rounded-full border border-gray-800 bg-gray-900 px-3 py-1 text-xs uppercase tracking-[0.18em] {CLASS_COLORS[buildA.summary.class] ?? 'text-gray-300'}">
                  {titleCase(buildA.summary.class)}
                </span>
                <span class="inline-block rounded border px-2 py-0.5 text-xs font-bold {GRADE_STYLES[buildA.summary.scores.grade] ?? ''}">
                  {buildA.summary.scores.grade}
                </span>
              </div>
              <div>
                <a href={buildHref(buildA.slug)} class="text-lg font-semibold text-gray-100 hover:text-amber-300 transition-colors">
                  {buildA.summary.title}
                </a>
                <p class="mt-1 text-sm text-gray-400">{buildA.summary.weapons.map((weapon) => weapon.name).join(" / ")}</p>
              </div>
            </div>
          {:else if errorA}
            <p class="text-sm text-red-300">{errorA}</p>
          {:else}
            <p class="text-sm text-gray-500">Select a build for side A.</p>
          {/if}
        </article>

        <div class="hidden md:block"></div>

        <article class="rounded-xl border border-gray-800 bg-gray-950 p-4">
          {#if buildB}
            <div class="space-y-3">
              <div class="flex flex-wrap items-center gap-3">
                <span class="rounded-full border border-gray-800 bg-gray-900 px-3 py-1 text-xs uppercase tracking-[0.18em] {CLASS_COLORS[buildB.summary.class] ?? 'text-gray-300'}">
                  {titleCase(buildB.summary.class)}
                </span>
                <span class="inline-block rounded border px-2 py-0.5 text-xs font-bold {GRADE_STYLES[buildB.summary.scores.grade] ?? ''}">
                  {buildB.summary.scores.grade}
                </span>
              </div>
              <div>
                <a href={buildHref(buildB.slug)} class="text-lg font-semibold text-gray-100 hover:text-amber-300 transition-colors">
                  {buildB.summary.title}
                </a>
                <p class="mt-1 text-sm text-gray-400">{buildB.summary.weapons.map((weapon) => weapon.name).join(" / ")}</p>
              </div>
            </div>
          {:else if errorB}
            <p class="text-sm text-red-300">{errorB}</p>
          {:else}
            <p class="text-sm text-gray-500">Select a build for side B.</p>
          {/if}
        </article>
      </div>

      <div class="space-y-2">
        {#each DIMENSIONS as dimension}
          {@const delta = scoreDeltas.find((row) => row.dimension === dimension.scorecard_key)?.delta ?? null}
          <div class="grid gap-2 rounded-xl border border-gray-800 bg-gray-950 px-4 py-3 md:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)] md:items-center">
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm text-gray-400">{dimension.label}</span>
              <span class="tabular-nums {scoreColor(scoreValue(buildA, dimension.summary_key))}">
                {scoreValue(buildA, dimension.summary_key) ?? "\u2014"} / {dimension.max}
              </span>
            </div>
            <div class="text-center text-sm font-medium tabular-nums {deltaColor(delta)}">
              {formatDelta(delta)}
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm text-gray-400 md:hidden">{dimension.label}</span>
              <span class="tabular-nums {scoreColor(scoreValue(buildB, dimension.summary_key))}">
                {scoreValue(buildB, dimension.summary_key) ?? "\u2014"} / {dimension.max}
              </span>
            </div>
          </div>
        {/each}
      </div>

      {#if slotDiffs.length > 0}
        <div class="rounded-xl border border-gray-800 bg-gray-950 p-4">
          <div class="mb-3 text-sm font-medium text-gray-200">Slot Diff Summary</div>
          <div class="flex flex-wrap gap-2 text-sm">
            {#each slotDiffs as slot}
              <span class="rounded-full border px-3 py-1 {slot.changed ? 'border-amber-700 bg-amber-950/40 text-amber-200' : 'border-gray-800 bg-gray-900 text-gray-400'}">
                {slot.label}: {slot.a.name ?? "\u2014"} → {slot.b.name ?? "\u2014"}
              </span>
            {/each}
          </div>
        </div>
      {/if}
    </section>
  {/if}

  {#if activeTab === "talents"}
    {#if talentDiff}
      <section class="space-y-4 rounded-2xl border border-gray-800 bg-gray-900 p-5">
        <div class="grid gap-4 md:grid-cols-3">
          <article class="rounded-xl border border-gray-800 bg-gray-950 p-4">
            <h2 class="mb-3 text-sm font-medium text-gray-200">Only in A</h2>
            <div class="space-y-2 text-sm text-gray-300">
              {#each talentDiff.only_a as entry}
                <div>{entry.name}</div>
              {:else}
                <div class="text-gray-500">None</div>
              {/each}
            </div>
          </article>
          <article class="rounded-xl border border-gray-800 bg-gray-950 p-4">
            <h2 class="mb-3 text-sm font-medium text-gray-200">Shared</h2>
            <div class="space-y-2 text-sm text-gray-300">
              {#each talentDiff.shared as entry}
                <div>{entry.name}</div>
              {:else}
                <div class="text-gray-500">None</div>
              {/each}
            </div>
          </article>
          <article class="rounded-xl border border-gray-800 bg-gray-950 p-4">
            <h2 class="mb-3 text-sm font-medium text-gray-200">Only in B</h2>
            <div class="space-y-2 text-sm text-gray-300">
              {#each talentDiff.only_b as entry}
                <div>{entry.name}</div>
              {:else}
                <div class="text-gray-500">None</div>
              {/each}
            </div>
          </article>
        </div>

        <div class="grid gap-2 md:grid-cols-2">
          {#each slotDiffs as slot}
            <div class="rounded-xl border border-gray-800 bg-gray-950 px-4 py-3 text-sm">
              <div class="font-medium text-gray-200">{slot.label}</div>
              <div class="mt-1 text-gray-400">A: {slot.a.name ?? "\u2014"}</div>
              <div class="text-gray-400">B: {slot.b.name ?? "\u2014"}</div>
            </div>
          {/each}
        </div>
      </section>
    {:else}
      <div class="rounded-2xl border border-gray-800 bg-gray-900 px-6 py-10 text-center text-gray-400">
        Select two builds to compare talents.
      </div>
    {/if}
  {/if}

  {#if activeTab === "weapons"}
    {#if weaponDiff}
      <section class="space-y-4 rounded-2xl border border-gray-800 bg-gray-900 p-5">
        <div class="grid gap-4 md:grid-cols-3">
          <article class="rounded-xl border border-gray-800 bg-gray-950 p-4">
            <h2 class="mb-3 text-sm font-medium text-gray-200">Only in A</h2>
            <div class="space-y-3">
              {#each weaponDiff.only_a as weapon}
                <div class="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm">
                  <div class="font-medium text-gray-100">{weapon.name}</div>
                  <div class="text-gray-400">{weapon.slot ?? "\u2014"} · {weapon.family ?? "\u2014"}</div>
                </div>
              {:else}
                <div class="text-sm text-gray-500">None</div>
              {/each}
            </div>
          </article>
          <article class="rounded-xl border border-gray-800 bg-gray-950 p-4">
            <h2 class="mb-3 text-sm font-medium text-gray-200">Shared</h2>
            <div class="space-y-3">
              {#each weaponDiff.shared as weapon}
                {@const peer = sharedWeaponPeer(weapon.compare_key)}
                {@const blessingDiff = peer ? computeSetDiff(weapon.blessings, peer.blessings) : null}
                <div class="rounded-lg border border-gray-800 bg-gray-900 px-3 py-3 text-sm">
                  <div class="font-medium text-gray-100">{weapon.name}</div>
                  <div class="text-gray-400">{weapon.slot ?? "\u2014"} · {weapon.family ?? "\u2014"}</div>
                  {#if blessingDiff}
                    <div class="mt-2 text-xs text-gray-400">
                      Only A: {blessingDiff.only_a.map((entry) => entry.name).join(", ") || "\u2014"}
                    </div>
                    <div class="text-xs text-gray-400">
                      Shared: {blessingDiff.shared.map((entry) => entry.name).join(", ") || "\u2014"}
                    </div>
                    <div class="text-xs text-gray-400">
                      Only B: {blessingDiff.only_b.map((entry) => entry.name).join(", ") || "\u2014"}
                    </div>
                  {/if}
                </div>
              {:else}
                <div class="text-sm text-gray-500">None</div>
              {/each}
            </div>
          </article>
          <article class="rounded-xl border border-gray-800 bg-gray-950 p-4">
            <h2 class="mb-3 text-sm font-medium text-gray-200">Only in B</h2>
            <div class="space-y-3">
              {#each weaponDiff.only_b as weapon}
                <div class="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm">
                  <div class="font-medium text-gray-100">{weapon.name}</div>
                  <div class="text-gray-400">{weapon.slot ?? "\u2014"} · {weapon.family ?? "\u2014"}</div>
                </div>
              {:else}
                <div class="text-sm text-gray-500">None</div>
              {/each}
            </div>
          </article>
        </div>
      </section>
    {:else}
      <div class="rounded-2xl border border-gray-800 bg-gray-900 px-6 py-10 text-center text-gray-400">
        Select two builds to compare weapons.
      </div>
    {/if}
  {/if}

  {#if activeTab === "synergy"}
    {#if buildA && buildB && synergyDiff}
      {@const antiA = buildA.synergy.anti_synergies.filter((entry) => !buildB.synergy.anti_synergies.some((other) => antiSynergyKey(other) === antiSynergyKey(entry)))}
      {@const antiB = buildB.synergy.anti_synergies.filter((entry) => !buildA.synergy.anti_synergies.some((other) => antiSynergyKey(other) === antiSynergyKey(entry)))}
      <section class="space-y-4 rounded-2xl border border-gray-800 bg-gray-900 p-5">
        <div class="grid gap-4 md:grid-cols-3">
          <article class="rounded-xl border border-gray-800 bg-gray-950 p-4">
            <h2 class="mb-3 text-sm font-medium text-gray-200">Only in A</h2>
            <div class="space-y-3">
              {#each synergyDiff.only_a as edge}
                <div class="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm">
                  <div class="font-medium text-gray-100">{edge.type}</div>
                  <div class="text-gray-400">{edge.selections.join(" → ")}</div>
                  <div class="text-xs text-gray-500">{edge.families.join(", ")}</div>
                </div>
              {:else}
                <div class="text-sm text-gray-500">None</div>
              {/each}
            </div>
          </article>
          <article class="rounded-xl border border-gray-800 bg-gray-950 p-4">
            <h2 class="mb-3 text-sm font-medium text-gray-200">Shared</h2>
            <div class="space-y-3">
              {#each synergyDiff.shared as edge}
                <div class="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm">
                  <div class="font-medium text-gray-100">{edge.type}</div>
                  <div class="text-gray-400">{edge.selections.join(" → ")}</div>
                  <div class="text-xs text-gray-500">{edge.families.join(", ")}</div>
                </div>
              {:else}
                <div class="text-sm text-gray-500">None</div>
              {/each}
            </div>
          </article>
          <article class="rounded-xl border border-gray-800 bg-gray-950 p-4">
            <h2 class="mb-3 text-sm font-medium text-gray-200">Only in B</h2>
            <div class="space-y-3">
              {#each synergyDiff.only_b as edge}
                <div class="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm">
                  <div class="font-medium text-gray-100">{edge.type}</div>
                  <div class="text-gray-400">{edge.selections.join(" → ")}</div>
                  <div class="text-xs text-gray-500">{edge.families.join(", ")}</div>
                </div>
              {:else}
                <div class="text-sm text-gray-500">None</div>
              {/each}
            </div>
          </article>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <article class="rounded-xl border border-gray-800 bg-gray-950 p-4">
            <h2 class="mb-3 text-sm font-medium text-gray-200">Anti-Synergies Only in A</h2>
            <div class="space-y-2 text-sm text-gray-300">
              {#each antiA as entry}
                <div>{entry.reason}</div>
              {:else}
                <div class="text-gray-500">None</div>
              {/each}
            </div>
          </article>
          <article class="rounded-xl border border-gray-800 bg-gray-950 p-4">
            <h2 class="mb-3 text-sm font-medium text-gray-200">Anti-Synergies Only in B</h2>
            <div class="space-y-2 text-sm text-gray-300">
              {#each antiB as entry}
                <div>{entry.reason}</div>
              {:else}
                <div class="text-gray-500">None</div>
              {/each}
            </div>
          </article>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <article class="rounded-xl border border-gray-800 bg-gray-950 p-4 text-sm">
            <h2 class="mb-3 font-medium text-gray-200">Coverage A</h2>
            <div class="text-gray-400">Calc coverage: {buildA.synergy.metadata.calc_coverage_pct}%</div>
            <div class="text-gray-400">Entities analyzed: {buildA.synergy.metadata.entities_analyzed}</div>
            <div class="text-gray-400">Build identity: {buildA.synergy.coverage.build_identity.join(", ") || "\u2014"}</div>
            <div class="text-gray-400">Coverage gaps: {buildA.synergy.coverage.coverage_gaps.join(", ") || "\u2014"}</div>
          </article>
          <article class="rounded-xl border border-gray-800 bg-gray-950 p-4 text-sm">
            <h2 class="mb-3 font-medium text-gray-200">Coverage B</h2>
            <div class="text-gray-400">Calc coverage: {buildB.synergy.metadata.calc_coverage_pct}%</div>
            <div class="text-gray-400">Entities analyzed: {buildB.synergy.metadata.entities_analyzed}</div>
            <div class="text-gray-400">Build identity: {buildB.synergy.coverage.build_identity.join(", ") || "\u2014"}</div>
            <div class="text-gray-400">Coverage gaps: {buildB.synergy.coverage.coverage_gaps.join(", ") || "\u2014"}</div>
          </article>
        </div>
      </section>
    {:else}
      <div class="rounded-2xl border border-gray-800 bg-gray-900 px-6 py-10 text-center text-gray-400">
        Select two builds to compare synergy.
      </div>
    {/if}
  {/if}

  {#if activeTab === "breakpoints"}
    {#if buildA && buildB}
      <section class="space-y-4 rounded-2xl border border-gray-800 bg-gray-900 p-5">
        <div class="flex flex-wrap gap-3">
          <label class="space-y-1">
            <span class="text-xs uppercase tracking-[0.18em] text-gray-500">Scenario</span>
            <select bind:value={selectedScenario} class="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-amber-600 focus:outline-none">
              {#each availableScenarios as scenario}
                <option value={scenario}>{titleCase(scenario)}</option>
              {/each}
            </select>
          </label>
          <label class="space-y-1">
            <span class="text-xs uppercase tracking-[0.18em] text-gray-500">Difficulty</span>
            <select bind:value={selectedDifficulty} class="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-amber-600 focus:outline-none">
              {#each DIFFICULTIES as difficulty}
                <option value={difficulty}>{titleCase(difficulty)}</option>
              {/each}
            </select>
          </label>
        </div>

        <div class="overflow-x-auto rounded-xl border border-gray-800">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-gray-950 text-left text-gray-400">
                <th class="px-4 py-3 font-medium">Breed / Action</th>
                <th class="px-4 py-3 font-medium">Build A</th>
                <th class="px-4 py-3 font-medium">Delta</th>
                <th class="px-4 py-3 font-medium">Build B</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-900">
              {#each breakpointDiff as row}
                <tr>
                  <td class="px-4 py-3 text-gray-200">
                    {titleCase(row.breed_id)} / {titleCase(row.action_category)}
                  </td>
                  <td class="px-4 py-3">
                    <span class="inline-flex rounded px-2 py-1 {htkCellClass(row.a_htk)}">
                      {row.a_htk ?? "\u2014"}
                    </span>
                    <span class="ml-2 text-gray-400">{row.a_weapon ?? ""}</span>
                  </td>
                  <td class="px-4 py-3 font-medium tabular-nums {deltaColor(row.delta)}">
                    {formatDelta(row.delta)}
                  </td>
                  <td class="px-4 py-3">
                    <span class="inline-flex rounded px-2 py-1 {htkCellClass(row.b_htk)}">
                      {row.b_htk ?? "\u2014"}
                    </span>
                    <span class="ml-2 text-gray-400">{row.b_weapon ?? ""}</span>
                  </td>
                </tr>
              {:else}
                <tr>
                  <td colspan="4" class="px-4 py-6 text-center text-gray-500">No breakpoint rows for this scenario/difficulty.</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <p class="text-sm text-gray-400">Lower HTK is better. Green delta = Build B kills faster.</p>
      </section>
    {:else}
      <div class="rounded-2xl border border-gray-800 bg-gray-900 px-6 py-10 text-center text-gray-400">
        Select two builds to compare breakpoints.
      </div>
    {/if}
  {/if}
</div>
