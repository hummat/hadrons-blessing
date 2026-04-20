<script lang="ts">
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { base } from "$app/paths";
  import { page } from "$app/state";
  import { htkCellClass } from "$lib/builds";
  import {
    computeBreakpointDiff,
    computeCurioPerkDiff,
    computeScoreDeltas,
    computeSetDiff,
    computeSlotDiff,
    computeSynergyEdgeDiff,
    talentEntries,
    weaponEntries,
  } from "$lib/compare";
  import {
    buildSelectionLabelMap,
    formatCoverageFraction,
    formatCoverageLabel,
    formatSelectionList,
    summarizeNameCounts,
  } from "$lib/detail-format";
  import { DIMENSIONS } from "$lib/dimensions";
  import type { BuildDetailData, BuildSummary } from "$lib/types";

  type Props = { data: { builds: BuildSummary[] } };
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
      for (const scenario of detail?.breakpoints.metadata.scenarios ?? []) values.add(scenario);
    }
    return [...values];
  });

  const scoreDeltas = $derived(buildA && buildB ? computeScoreDeltas(buildA, buildB) : []);
  const scoredDeltas = $derived(
    scoreDeltas
      .filter((row) => row.delta != null && row.dimension !== "composite_score")
      .sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0)),
  );
  const slotDiffs = $derived(buildA && buildB ? computeSlotDiff(buildA.structure, buildB.structure) : []);
  const curioDiff = $derived(buildA && buildB ? computeCurioPerkDiff(buildA, buildB) : null);
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
  const selectionLabels = $derived.by(() => {
    const labels = new Map<string, string>();
    for (const detail of [buildA, buildB]) {
      if (!detail) continue;
      for (const [id, label] of buildSelectionLabelMap(detail).entries()) {
        if (!labels.has(id)) labels.set(id, label);
      }
    }
    return labels;
  });
  const curioDiffCounts = $derived.by(() => {
    if (!curioDiff) return null;
    return {
      only_a: summarizeNameCounts(curioDiff.only_a),
      shared: summarizeNameCounts(curioDiff.shared),
      only_b: summarizeNameCounts(curioDiff.only_b),
    };
  });

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

  function classKey(cls: string): string {
    return cls.replace(/\s+/g, "-").toLowerCase();
  }

  function formatDelta(value: number | null): string {
    if (value == null) return "—";
    if (value === 0) return "0";
    return value > 0 ? `+${value}` : `${value}`;
  }

  function deltaClass(value: number | null): string {
    if (value == null || value === 0) return "hb-delta--zero";
    return value > 0 ? "hb-delta--pos" : "hb-delta--neg";
  }

  function scoreCellClass(value: number | null): string {
    if (value == null) return "hb-ledger-dim hb-ledger-dim--null";
    if (value >= 4) return "hb-ledger-dim hb-ledger-dim--high";
    if (value >= 3) return "hb-ledger-dim hb-ledger-dim--mid";
    if (value >= 2) return "hb-ledger-dim hb-ledger-dim--warn";
    return "hb-ledger-dim hb-ledger-dim--low";
  }

  function htkClass(value: number | null): string {
    const raw = htkCellClass(value);
    if (raw.includes("best")) return "hb-htk--best";
    if (raw.includes("mid")) return "hb-htk--mid";
    if (raw.includes("worst")) return "hb-htk--worst";
    return "hb-htk--null";
  }

  function scoreValue(detail: BuildDetailData | null, key: string): number | null {
    if (!detail) return null;
    return detail.summary.scores[key as keyof typeof detail.summary.scores] as number | null;
  }

  function buildHref(slug: string): string { return `${base}/builds/${slug}`; }

  function sharedWeaponPeer(compareKey: string): ReturnType<typeof weaponEntries>[number] | null {
    if (!buildB) return null;
    return weaponEntries(buildB).find((weapon) => weapon.compare_key === compareKey) ?? null;
  }

  function antiSynergyKey(entry: { type: string; selections: string[]; reason: string }): string {
    return `${entry.type}::${entry.reason}::${[...entry.selections].sort().join("|")}`;
  }

  function selectionText(values: string[]): string {
    return formatSelectionList(values, selectionLabels).join(" → ");
  }

  function coverageText(values: string[]): string {
    return values.length > 0 ? values.map((value) => formatCoverageLabel(value)).join(", ") : "—";
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

    if (slot === "a") { buildA = null; errorA = null; loadingA = slug.length > 0; }
    else { buildB = null; errorB = null; loadingB = slug.length > 0; }

    if (!slug) return;

    try {
      const res = await fetch(`${base}/data/builds/${slug}.json`);
      if (!res.ok) throw new Error(res.status === 404 ? "Build not found" : `Failed to load build (${res.status})`);
      const detail = await res.json() as BuildDetailData;

      if (slot === "a") {
        if (current !== requestA) return;
        buildA = detail; errorA = null;
      } else {
        if (current !== requestB) return;
        buildB = detail; errorB = null;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load build";
      if (slot === "a") { if (current !== requestA) return; errorA = message; }
      else { if (current !== requestB) return; errorB = message; }
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

  $effect(() => { if (!browser) return; void fetchBuild("a", buildASlug); });
  $effect(() => { if (!browser) return; void fetchBuild("b", buildBSlug); });

  $effect(() => {
    if (!availableScenarios.includes(selectedScenario)) {
      selectedScenario = availableScenarios[0] ?? "sustained";
    }
  });
</script>

<svelte:head>
  <title>Compare Builds — Hadron's Blessing</title>
</svelte:head>

<div class="page-stack page-stack--tight">
  <div class="hb-reveal">
    <a href={`${base}/`} class="crumb-link">← Back to manifest</a>
    <div class="section-heading" style="margin-top: 10px;">
      <h2>Compare Builds</h2>
      <div class="section-rule"></div>
      <div class="section-meta">
        {#if buildA && buildB && buildA.summary.class !== buildB.summary.class}
          Cross-class comparison
        {:else if buildASlug && buildASlug === buildBSlug}
          Same build — deltas all zero
        {:else}
          side-by-side dossier delta
        {/if}
      </div>
    </div>
  </div>

  <section class="panel-strong selection-tray hb-reveal d1">
    <div style="display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: end;">
      <label class="field-stack">
        <span class="field-label">Build A</span>
        <select
          bind:value={buildASlug}
          onchange={() => void syncUrl(buildASlug, buildBSlug)}
          class="form-control"
        >
          <option value="">Select build…</option>
          {#each data.builds as build}
            <option value={build.file.replace(/\.json$/, "")}>{build.title}</option>
          {/each}
        </select>
      </label>

      <button type="button" class="button-secondary" onclick={() => void updateBuilds(buildBSlug, buildASlug)}>
        Swap A ↔ B
      </button>

      <label class="field-stack">
        <span class="field-label">Build B</span>
        <select
          bind:value={buildBSlug}
          onchange={() => void syncUrl(buildASlug, buildBSlug)}
          class="form-control"
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
    <div class="hb-loading">Loading builds…</div>
  {/if}

  <div class="hb-tab-bar">
    {#each TABS as tab}
      <button
        type="button"
        class="hb-tab"
        class:hb-tab--active={activeTab === tab.key}
        onclick={() => (activeTab = tab.key)}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  {#if activeTab === "overview"}
    <section class="panel-strong" style="padding: 20px; display: flex; flex-direction: column; gap: 18px;">
      <div style="display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr) 120px minmax(0, 1fr);">
        <article class="panel-muted" style="padding: 16px;">
          {#if buildA}
            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 10px;">
              <span class={`class-chip ${classKey(buildA.summary.class)}`}>{titleCase(buildA.summary.class)}</span>
              <span class={`grade grade--sm ${buildA.summary.scores.grade.toLowerCase()}`}>{buildA.summary.scores.grade}</span>
            </div>
            <a href={buildHref(buildA.slug)} class="hb-ledger-title">{buildA.summary.title}</a>
            <p class="hb-ledger-sub">{buildA.summary.weapons.map((weapon) => weapon.name).join(" / ")}</p>
          {:else if loadingA}
            <p class="hb-verdict-note">Loading side A…</p>
          {:else if errorA}
            <p class="hb-verdict-note" style="color: var(--hb-blood)">{errorA}</p>
          {:else}
            <p class="hb-verdict-note">Select a build for side A.</p>
          {/if}
        </article>

        <div style="display: grid; place-items: center;">
          <span class="label label-amber">vs</span>
        </div>

        <article class="panel-muted" style="padding: 16px;">
          {#if buildB}
            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 10px;">
              <span class={`class-chip ${classKey(buildB.summary.class)}`}>{titleCase(buildB.summary.class)}</span>
              <span class={`grade grade--sm ${buildB.summary.scores.grade.toLowerCase()}`}>{buildB.summary.scores.grade}</span>
            </div>
            <a href={buildHref(buildB.slug)} class="hb-ledger-title">{buildB.summary.title}</a>
            <p class="hb-ledger-sub">{buildB.summary.weapons.map((weapon) => weapon.name).join(" / ")}</p>
          {:else if loadingB}
            <p class="hb-verdict-note">Loading side B…</p>
          {:else if errorB}
            <p class="hb-verdict-note" style="color: var(--hb-blood)">{errorB}</p>
          {:else}
            <p class="hb-verdict-note">Select a build for side B.</p>
          {/if}
        </article>
      </div>

      {#if scoredDeltas.length > 0}
        <div class="panel-muted" style="padding: 10px 14px; display: flex; gap: 14px; flex-wrap: wrap; align-items: baseline; font-size: 13px;">
          <span class="label">Biggest swing</span>
          <span>{scoredDeltas[0].label}</span>
          <span class={`mono-num ${deltaClass(scoredDeltas[0].delta)}`}>{formatDelta(scoredDeltas[0].delta)}</span>
          {#if scoredDeltas.length > 1}
            <span class="label">Next</span>
            <span>{scoredDeltas[1].label}</span>
            <span class={`mono-num ${deltaClass(scoredDeltas[1].delta)}`}>{formatDelta(scoredDeltas[1].delta)}</span>
          {/if}
        </div>
      {/if}

      <div style="display: flex; flex-direction: column; gap: 6px;">
        {#each DIMENSIONS as dimension}
          {@const delta = scoreDeltas.find((row) => row.dimension === dimension.scorecard_key)?.delta ?? null}
          <div class="panel-muted" style="padding: 10px 14px; display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr) 120px minmax(0, 1fr); align-items: center;">
            <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 10px;">
              <span class="label">{dimension.label}</span>
              <span class={scoreCellClass(scoreValue(buildA, dimension.summary_key))}>
                {scoreValue(buildA, dimension.summary_key) ?? "—"}/{dimension.max}
              </span>
            </div>
            <div class={`mono-num ${deltaClass(delta)}`} style="text-align: center; font-size: 14px;">{formatDelta(delta)}</div>
            <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 10px;">
              <span class="label" style="color: var(--hb-ink-ghost)">{dimension.label}</span>
              <span class={scoreCellClass(scoreValue(buildB, dimension.summary_key))}>
                {scoreValue(buildB, dimension.summary_key) ?? "—"}/{dimension.max}
              </span>
            </div>
          </div>
        {/each}
      </div>

      {#if slotDiffs.length > 0}
        <div class="panel-muted" style="padding: 14px 16px;">
          <div class="label" style="margin-bottom: 8px;">Slot Diff Summary</div>
          <div class="hb-chip-cloud">
            {#each slotDiffs as slot (slot.key)}
              <span class={`hb-chip ${slot.changed ? 'hb-chip--amber' : ''}`}>
                {slot.label}: {slot.a.name ?? "—"} → {slot.b.name ?? "—"}
              </span>
            {/each}
          </div>
        </div>
      {/if}

      {#if curioDiff}
        <div class="panel-muted" style="padding: 14px 16px;">
          <div class="label" style="margin-bottom: 8px;">Curio Perk Diff</div>
          <div style="display: grid; gap: 14px; grid-template-columns: repeat(3, 1fr);">
            <div>
              <div class="label" style="margin-bottom: 6px;">Only A</div>
              {#each curioDiffCounts?.only_a ?? [] as entry (entry.name)}
                <div style="font-size: 13px;">{entry.name}{entry.count > 1 ? ` ×${entry.count}` : ""}</div>
              {:else}
                <div class="hb-verdict-note">None</div>
              {/each}
            </div>
            <div>
              <div class="label" style="margin-bottom: 6px;">Shared</div>
              {#each curioDiffCounts?.shared ?? [] as entry (entry.name)}
                <div style="font-size: 13px;">{entry.name}{entry.count > 1 ? ` ×${entry.count}` : ""}</div>
              {:else}
                <div class="hb-verdict-note">None</div>
              {/each}
            </div>
            <div>
              <div class="label" style="margin-bottom: 6px;">Only B</div>
              {#each curioDiffCounts?.only_b ?? [] as entry (entry.name)}
                <div style="font-size: 13px;">{entry.name}{entry.count > 1 ? ` ×${entry.count}` : ""}</div>
              {:else}
                <div class="hb-verdict-note">None</div>
              {/each}
            </div>
          </div>
        </div>
      {/if}
    </section>
  {/if}

  {#if activeTab === "talents"}
    {#if talentDiff}
      <section class="panel-strong" style="padding: 20px; display: flex; flex-direction: column; gap: 16px;">
        <div style="display: grid; gap: 14px; grid-template-columns: repeat(3, 1fr);">
          <article class="panel-muted" style="padding: 14px 16px;">
            <div class="label" style="margin-bottom: 10px;">Only A</div>
            {#each talentDiff.only_a as entry, i (`${entry.id ?? entry.name}:${i}`)}
              <div style="font-size: 13px;">{entry.name}</div>
            {:else}
              <div class="hb-verdict-note">None</div>
            {/each}
          </article>
          <article class="panel-muted" style="padding: 14px 16px;">
            <div class="label" style="margin-bottom: 10px;">Shared</div>
            {#each talentDiff.shared as entry, i (`${entry.id ?? entry.name}:${i}`)}
              <div style="font-size: 13px;">{entry.name}</div>
            {:else}
              <div class="hb-verdict-note">None</div>
            {/each}
          </article>
          <article class="panel-muted" style="padding: 14px 16px;">
            <div class="label" style="margin-bottom: 10px;">Only B</div>
            {#each talentDiff.only_b as entry, i (`${entry.id ?? entry.name}:${i}`)}
              <div style="font-size: 13px;">{entry.name}</div>
            {:else}
              <div class="hb-verdict-note">None</div>
            {/each}
          </article>
        </div>

        <div style="display: grid; gap: 10px; grid-template-columns: repeat(2, 1fr);">
          {#each slotDiffs as slot (slot.key)}
            <div class="panel-muted" style="padding: 12px 14px;">
              <div class="label">{slot.label}</div>
              <div style="font-size: 13px; margin-top: 4px;"><span class="label-dim">A:</span> {slot.a.name ?? "—"}</div>
              <div style="font-size: 13px;"><span class="label-dim">B:</span> {slot.b.name ?? "—"}</div>
            </div>
          {/each}
        </div>
      </section>
    {:else}
      <div class="hb-loading">Select two builds to compare talents.</div>
    {/if}
  {/if}

  {#if activeTab === "weapons"}
    {#if weaponDiff}
      <section class="panel-strong" style="padding: 20px;">
        <div style="display: grid; gap: 14px; grid-template-columns: repeat(3, 1fr);">
          <article class="panel-muted" style="padding: 14px 16px;">
            <div class="label" style="margin-bottom: 10px;">Only A</div>
            {#each weaponDiff.only_a as weapon (weapon.compare_key)}
              <div class="hb-trait-row" style="margin-bottom: 6px;">
                <span>{weapon.name}</span>
                <span class="hb-trait-tier">{titleCase(weapon.slot ?? "—")}</span>
              </div>
            {:else}
              <div class="hb-verdict-note">None</div>
            {/each}
          </article>
          <article class="panel-muted" style="padding: 14px 16px;">
            <div class="label" style="margin-bottom: 10px;">Shared</div>
            {#each weaponDiff.shared as weapon (weapon.compare_key)}
              {@const peer = sharedWeaponPeer(weapon.compare_key)}
              {@const blessingDiff = peer ? computeSetDiff(weapon.blessings, peer.blessings) : null}
              <div class="hb-trait-row" style="display: flex; flex-direction: column; align-items: stretch; gap: 4px; margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-between;">
                  <span>{weapon.name}</span>
                  <span class="hb-trait-tier">{titleCase(weapon.slot ?? "—")}</span>
                </div>
                {#if blessingDiff}
                  <div style="font-size: 11px; color: var(--hb-ink-dim);">
                    Only A: {blessingDiff.only_a.map((e) => e.name).join(", ") || "—"}
                  </div>
                  <div style="font-size: 11px; color: var(--hb-ink-dim);">
                    Shared: {blessingDiff.shared.map((e) => e.name).join(", ") || "—"}
                  </div>
                  <div style="font-size: 11px; color: var(--hb-ink-dim);">
                    Only B: {blessingDiff.only_b.map((e) => e.name).join(", ") || "—"}
                  </div>
                {/if}
              </div>
            {:else}
              <div class="hb-verdict-note">None</div>
            {/each}
          </article>
          <article class="panel-muted" style="padding: 14px 16px;">
            <div class="label" style="margin-bottom: 10px;">Only B</div>
            {#each weaponDiff.only_b as weapon (weapon.compare_key)}
              <div class="hb-trait-row" style="margin-bottom: 6px;">
                <span>{weapon.name}</span>
                <span class="hb-trait-tier">{titleCase(weapon.slot ?? "—")}</span>
              </div>
            {:else}
              <div class="hb-verdict-note">None</div>
            {/each}
          </article>
        </div>
      </section>
    {:else}
      <div class="hb-loading">Select two builds to compare weapons.</div>
    {/if}
  {/if}

  {#if activeTab === "synergy"}
    {#if buildA && buildB && synergyDiff}
      {@const antiA = buildA.synergy.anti_synergies.filter((entry) => !buildB.synergy.anti_synergies.some((other) => antiSynergyKey(other) === antiSynergyKey(entry)))}
      {@const antiB = buildB.synergy.anti_synergies.filter((entry) => !buildA.synergy.anti_synergies.some((other) => antiSynergyKey(other) === antiSynergyKey(entry)))}
      <section class="panel-strong" style="padding: 20px; display: flex; flex-direction: column; gap: 16px;">
        <div style="display: grid; gap: 14px; grid-template-columns: repeat(3, 1fr);">
          <article class="panel-muted" style="padding: 14px 16px;">
            <div class="label" style="margin-bottom: 10px;">Only A</div>
            {#each synergyDiff.only_a as edge, i (i)}
              <div class="hb-syn-row" style="margin-bottom: 6px;">
                <span class="hb-syn-kind">{titleCase(edge.type)}</span>
                <div class="hb-syn-body">
                  <span class="sel">{selectionText(edge.selections)}</span>
                  <span class="exp" style="color: var(--hb-ink-faint)">{coverageText(edge.families)}</span>
                </div>
                <span></span>
              </div>
            {:else}
              <div class="hb-verdict-note">None</div>
            {/each}
          </article>
          <article class="panel-muted" style="padding: 14px 16px;">
            <div class="label" style="margin-bottom: 10px;">Shared</div>
            {#each synergyDiff.shared as edge, i (i)}
              <div class="hb-syn-row" style="margin-bottom: 6px;">
                <span class="hb-syn-kind">{titleCase(edge.type)}</span>
                <div class="hb-syn-body">
                  <span class="sel">{selectionText(edge.selections)}</span>
                  <span class="exp" style="color: var(--hb-ink-faint)">{coverageText(edge.families)}</span>
                </div>
                <span></span>
              </div>
            {:else}
              <div class="hb-verdict-note">None</div>
            {/each}
          </article>
          <article class="panel-muted" style="padding: 14px 16px;">
            <div class="label" style="margin-bottom: 10px;">Only B</div>
            {#each synergyDiff.only_b as edge, i (i)}
              <div class="hb-syn-row" style="margin-bottom: 6px;">
                <span class="hb-syn-kind">{titleCase(edge.type)}</span>
                <div class="hb-syn-body">
                  <span class="sel">{selectionText(edge.selections)}</span>
                  <span class="exp" style="color: var(--hb-ink-faint)">{coverageText(edge.families)}</span>
                </div>
                <span></span>
              </div>
            {:else}
              <div class="hb-verdict-note">None</div>
            {/each}
          </article>
        </div>

        <div style="display: grid; gap: 14px; grid-template-columns: repeat(2, 1fr);">
          <article class="panel-muted" style="padding: 14px 16px;">
            <div class="label" style="margin-bottom: 10px; color: var(--hb-blood);">Anti-Synergies Only A</div>
            {#each antiA as entry (antiSynergyKey(entry))}
              <div style="font-size: 13px; margin-bottom: 4px;">{entry.reason}</div>
            {:else}
              <div class="hb-verdict-note">None</div>
            {/each}
          </article>
          <article class="panel-muted" style="padding: 14px 16px;">
            <div class="label" style="margin-bottom: 10px; color: var(--hb-blood);">Anti-Synergies Only B</div>
            {#each antiB as entry (antiSynergyKey(entry))}
              <div style="font-size: 13px; margin-bottom: 4px;">{entry.reason}</div>
            {:else}
              <div class="hb-verdict-note">None</div>
            {/each}
          </article>
        </div>

        <div style="display: grid; gap: 14px; grid-template-columns: repeat(2, 1fr);">
          <article class="panel-muted" style="padding: 14px 16px;">
            <div class="label" style="margin-bottom: 10px;">Coverage A</div>
            <div style="font-size: 13px; color: var(--hb-ink-dim); display: flex; flex-direction: column; gap: 3px;">
              <span>Effect-modeled: <span class="mono-num">{formatCoverageFraction(buildA.synergy.metadata.calc_coverage_pct)}</span></span>
              <span>Source-linked: <span class="mono-num">{formatCoverageFraction(buildA.synergy.metadata.linked_coverage_pct)}</span></span>
              <span>Entities: <span class="mono-num">{buildA.synergy.metadata.entities_analyzed}</span></span>
              <span>Identity: {coverageText(buildA.synergy.coverage.build_identity)}</span>
              <span>Gaps: {coverageText(buildA.synergy.coverage.coverage_gaps)}</span>
            </div>
          </article>
          <article class="panel-muted" style="padding: 14px 16px;">
            <div class="label" style="margin-bottom: 10px;">Coverage B</div>
            <div style="font-size: 13px; color: var(--hb-ink-dim); display: flex; flex-direction: column; gap: 3px;">
              <span>Effect-modeled: <span class="mono-num">{formatCoverageFraction(buildB.synergy.metadata.calc_coverage_pct)}</span></span>
              <span>Source-linked: <span class="mono-num">{formatCoverageFraction(buildB.synergy.metadata.linked_coverage_pct)}</span></span>
              <span>Entities: <span class="mono-num">{buildB.synergy.metadata.entities_analyzed}</span></span>
              <span>Identity: {coverageText(buildB.synergy.coverage.build_identity)}</span>
              <span>Gaps: {coverageText(buildB.synergy.coverage.coverage_gaps)}</span>
            </div>
          </article>
        </div>
      </section>
    {:else}
      <div class="hb-loading">Select two builds to compare synergy.</div>
    {/if}
  {/if}

  {#if activeTab === "breakpoints"}
    {#if buildA && buildB}
      <section class="panel-strong" style="padding: 20px; display: flex; flex-direction: column; gap: 14px;">
        <div style="display: flex; gap: 12px; flex-wrap: wrap;">
          <label class="field-stack">
            <span class="field-label">Scenario</span>
            <select bind:value={selectedScenario} class="form-control">
              {#each availableScenarios as scenario}
                <option value={scenario}>{titleCase(scenario)}</option>
              {/each}
            </select>
          </label>
          <label class="field-stack">
            <span class="field-label">Difficulty</span>
            <select bind:value={selectedDifficulty} class="form-control">
              {#each DIFFICULTIES as difficulty}
                <option value={difficulty}>{titleCase(difficulty)}</option>
              {/each}
            </select>
          </label>
        </div>

        <div class="hb-cogitator-table-wrap">
          <table class="hb-cogitator-table">
            <thead>
              <tr>
                <th>Breed / Action</th>
                <th>Build A</th>
                <th>Delta</th>
                <th>Build B</th>
              </tr>
            </thead>
            <tbody>
              {#each breakpointDiff as row, i (i)}
                <tr>
                  <td>
                    <span class="hb-action-label">{titleCase(row.breed_id)} · {titleCase(row.action_category)}</span>
                  </td>
                  <td>
                    <span class="hb-htk {htkClass(row.a_htk)}">{row.a_htk ?? "—"}</span>
                    <span style="margin-left: 8px; color: var(--hb-ink-faint); font-family: 'Inter';">{row.a_weapon ?? ""}</span>
                  </td>
                  <td class={`mono-num ${deltaClass(row.delta)}`}>{formatDelta(row.delta)}</td>
                  <td>
                    <span class="hb-htk {htkClass(row.b_htk)}">{row.b_htk ?? "—"}</span>
                    <span style="margin-left: 8px; color: var(--hb-ink-faint); font-family: 'Inter';">{row.b_weapon ?? ""}</span>
                  </td>
                </tr>
              {:else}
                <tr><td colspan="4" class="hb-cogitator-empty">No breakpoint rows for this slice.</td></tr>
              {/each}
            </tbody>
          </table>
        </div>

        <p class="hb-verdict-note">Lower HTK is better. Green delta = Build B kills faster.</p>
      </section>
    {:else}
      <div class="hb-loading">Select two builds to compare breakpoints.</div>
    {/if}
  {/if}
</div>
