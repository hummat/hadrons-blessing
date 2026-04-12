<script lang="ts">
  import { base } from "$app/paths";
  import {
    CLASS_COLORS,
    GRADE_STYLES,
    htkCellClass,
    scoreColor,
  } from "$lib/builds";
  import { DIMENSIONS } from "$lib/dimensions";
  import {
    buildBreakpointPanels,
    buildBreakpointActionLabels,
    buildSelectionLabelMap,
    formatCoverageFraction,
    formatCoverageLabel,
    formatSelectionList,
    formatSelectionText,
    summarizeNameCounts,
  } from "$lib/detail-format";
  import type {
    BreakpointActionDetail,
    BreakpointBreedEntry,
    BreakpointWeaponDetail,
    BuildDetailData,
    DimensionScoreDetail,
    ScorecardWeaponDetail,
  } from "$lib/types";

  type Props = {
    data: {
      detail: BuildDetailData;
    };
  };

  type DimensionCard = {
    key: string;
    label: string;
    score: number | null;
    max: number;
    explanation: string | null;
  };

  type MatrixRow = {
    label: string;
    values: Array<number | null>;
  };

  const DIFFICULTIES = ["uprising", "malice", "heresy", "damnation", "auric"];

  let { data }: Props = $props();
  const selectionLabels = $derived(buildSelectionLabelMap(data.detail));

  const availableScenarios = $derived(data.detail.breakpoints.metadata.scenarios);

  let selectedScenario = $state("sustained");
  let selectedDifficulty = $state("damnation");

  $effect(() => {
    if (!availableScenarios.includes(selectedScenario)) {
      selectedScenario = availableScenarios[0] ?? "sustained";
    }
  });

  function titleCase(value: string): string {
    return value
      .split(/[_\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function dimensionDetail(key: string): DimensionScoreDetail | null {
    return data.detail.scorecard.qualitative[key as keyof typeof data.detail.scorecard.qualitative] ?? null;
  }

  function blessingNameFromSlug(slug: string): string {
    for (const weapon of data.detail.structure.weapons) {
      for (const blessing of weapon.blessings) {
        if ((blessing.id?.split(".").at(-1) ?? "") === slug) {
          return blessing.name;
        }
      }
    }
    return titleCase(slug);
  }

  function dimensionExplanation(key: string): string | null {
    if (key === "composite") return `Grade ${data.detail.summary.scores.grade}`;
    if (key === "perk_optimality") return "Average weapon perk score across the build.";
    if (key === "curio_efficiency") return "Curio perk mix quality for the build class.";

    const detail = dimensionDetail(key);
    const explanation = detail?.explanations[0] ?? null;
    if (!explanation) return null;

    if (key === "blessing_synergy" && explanation.startsWith("Blessings with synergy edges: ")) {
      const names = explanation
        .slice("Blessings with synergy edges: ".length)
        .split(",")
        .map((entry) => blessingNameFromSlug(entry.trim()))
        .join(", ");
      return `Connected blessings: ${names}`;
    }

    return explanation;
  }

  function coverageLabels(values: string[]): string {
    return values.length > 0 ? values.map((value) => formatCoverageLabel(value)).join(", ") : "None";
  }

  let dimensionCards = $derived.by((): DimensionCard[] => [
    ...DIMENSIONS.map((dimension) => ({
      key: dimension.summary_key,
      label: dimension.label,
      score: data.detail.summary.scores[dimension.summary_key as keyof typeof data.detail.summary.scores] as number | null,
      max: dimension.max,
      explanation: dimensionExplanation(dimension.scorecard_key),
    })),
  ]);

  const synergyPreviewLimit = 6;
  let synergyPreview = $derived(data.detail.synergy.synergy_edges.slice(0, synergyPreviewLimit));
  let hiddenSynergyCount = $derived(Math.max(data.detail.synergy.synergy_edges.length - synergyPreviewLimit, 0));
  let antiSynergyCounts = $derived(
    summarizeNameCounts(data.detail.synergy.anti_synergies.map((entry) => ({ name: entry.reason }))),
  );
  let orphanCounts = $derived(
    summarizeNameCounts(
      data.detail.synergy.orphans.map((entry) => ({
        name: formatSelectionText(entry.selection, selectionLabels),
      })),
    ),
  );
  let breakpointPanels = $derived(buildBreakpointPanels(data.detail));

  function perkTierLabel(tier: number | undefined): string {
    return typeof tier === "number" ? `T${tier}` : "T?";
  }

  function formatEdgeSelections(selections: string[]): string {
    const labels = formatSelectionList(selections, selectionLabels);
    if (labels.length === 0) return "\u2014";
    if (labels.length === 1) return labels[0];
    return `${labels[0]} \u2192 ${labels[1]}`;
  }

  function scenarioBreeds(action: BreakpointActionDetail): BreakpointBreedEntry[] {
    return (action.scenarios[selectedScenario]?.breeds ?? [])
      .filter((entry) => entry.difficulty === selectedDifficulty);
  }

  // Collapse scenario/difficulty slices into an actions x breeds matrix for the selected view.
  function weaponMatrix(weapon: BreakpointWeaponDetail): { breeds: string[]; rows: MatrixRow[] } {
    const breedIds = new Set<string>();
    const actionLabels = buildBreakpointActionLabels(weapon);

    for (const action of weapon.actions) {
      for (const entry of scenarioBreeds(action)) {
        breedIds.add(entry.breed_id);
      }
    }

    const breeds = [...breedIds].sort();
    const rows = weapon.actions
      .map((action, index) => {
        const hitsByBreed = new Map(scenarioBreeds(action).map((entry) => [entry.breed_id, entry.hitsToKill]));
        return {
          label: actionLabels[index],
          values: breeds.map((breedId) => hitsByBreed.get(breedId) ?? null),
        };
      })
      .filter((row) => row.values.some((value) => value != null));

    return { breeds, rows };
  }

  function breakpointWeaponLabel(weapon: BreakpointWeaponDetail): string {
    return data.detail.scorecard.weapons.find((candidate) => candidate.canonical_entity_id === weapon.entityId)?.name
      ?? weapon.entityId;
  }

  function warningStyle(severity: string): string {
    if (severity === "high") return "border-red-800 bg-red-950/40 text-red-200";
    if (severity === "medium") return "border-yellow-800 bg-yellow-950/30 text-yellow-100";
    return "border-gray-800 bg-gray-900 text-gray-200";
  }
</script>

<svelte:head>
  <title>{data.detail.summary.title} — Hadron's Blessing</title>
</svelte:head>

<div class="page-stack">
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-4">
      <a href={`${base}/`} class="crumb-link inline-flex items-center gap-2">
        <span aria-hidden="true">←</span>
        Back to builds
      </a>
      <a href={`${base}/compare?builds=${data.detail.slug},`} class="crumb-link">
        Compare with...
      </a>
    </div>

    <section class="panel-strong hero-panel px-6 py-6">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div class="space-y-3">
          <div class="flex flex-wrap items-center gap-3 text-sm">
            <span class="panel-muted px-3 py-1 {CLASS_COLORS[data.detail.summary.class] ?? 'text-gray-300'}">
              {titleCase(data.detail.summary.class)}
            </span>
            {#if data.detail.summary.ability}
              <span class="text-gray-400">Ability: <span class="text-gray-200">{data.detail.summary.ability}</span></span>
            {/if}
            {#if data.detail.summary.keystone}
              <span class="text-gray-400">Keystone: <span class="text-gray-200">{data.detail.summary.keystone}</span></span>
            {/if}
          </div>

          <div>
            <h1 class="text-3xl font-bold text-gray-50">{data.detail.summary.title}</h1>
            <p class="mt-2 text-sm text-gray-400">
              {data.detail.summary.weapons.map((weapon) => weapon.name).join(" / ")}
            </p>
          </div>
        </div>

        <div class="panel-muted px-4 py-3 text-right">
          <div class="text-xs uppercase tracking-[0.2em] text-gray-500">Grade</div>
          <div class="mt-2 flex items-center justify-end gap-3">
            <span class="inline-block rounded border px-3 py-1 text-lg font-bold {GRADE_STYLES[data.detail.summary.scores.grade] ?? ''}">
              {data.detail.summary.scores.grade}
            </span>
            <div class="text-sm text-gray-400">
              <div class="text-gray-200">{data.detail.summary.scores.composite}/35</div>
              <div>Composite score</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>

  <section class="space-y-4">
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <article class="panel p-4">
        <div class="text-xs uppercase tracking-[0.18em] text-gray-500">Weapons</div>
        <div class="mt-2 text-2xl font-bold text-gray-100">{data.detail.summary.weapons.length}</div>
        <p class="mt-2 text-sm text-gray-400">{data.detail.summary.weapons.map((weapon) => weapon.name).join(" / ")}</p>
      </article>
      <article class="panel p-4">
        <div class="text-xs uppercase tracking-[0.18em] text-gray-500">Synergy Edges</div>
        <div class="mt-2 text-2xl font-bold text-gray-100">{data.detail.synergy.synergy_edges.length}</div>
        <p class="mt-2 text-sm text-gray-400">
          {data.detail.synergy.anti_synergies.length} anti-synergies · {data.detail.synergy.orphans.length} isolated picks
        </p>
      </article>
      <article class="panel p-4">
        <div class="text-xs uppercase tracking-[0.18em] text-gray-500">Calc Coverage</div>
        <div class="mt-2 text-2xl font-bold text-gray-100">{formatCoverageFraction(data.detail.synergy.metadata.calc_coverage_pct)}</div>
        <p class="mt-2 text-sm text-gray-400">{data.detail.synergy.metadata.unique_entities_with_calc} entities with calculator support</p>
      </article>
      <article class="panel p-4">
        <div class="text-xs uppercase tracking-[0.18em] text-gray-500">Build Identity</div>
        <div class="mt-2 text-base font-semibold text-gray-100">
          {coverageLabels(data.detail.synergy.coverage.build_identity)}
        </div>
        <p class="mt-2 text-sm text-gray-400">Concentration {data.detail.synergy.coverage.concentration}</p>
      </article>
    </div>

    <div class="flex items-baseline justify-between">
      <h2 class="text-xl font-semibold text-gray-100">Build Structure</h2>
      <span class="text-xs uppercase tracking-[0.2em] text-gray-500">Guide-facing selections</span>
    </div>

    <div class="grid gap-4 xl:grid-cols-[1.1fr_1.4fr]">
      <article class="panel p-5">
        <h3 class="text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">Core Slots</h3>
        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <div class="panel-muted p-4">
            <div class="text-xs uppercase tracking-[0.18em] text-gray-500">Ability</div>
            <div class="mt-2 text-sm text-gray-100">{data.detail.structure.slots.ability.name ?? "\u2014"}</div>
          </div>
          <div class="panel-muted p-4">
            <div class="text-xs uppercase tracking-[0.18em] text-gray-500">Blitz</div>
            <div class="mt-2 text-sm text-gray-100">{data.detail.structure.slots.blitz.name ?? "\u2014"}</div>
          </div>
          <div class="panel-muted p-4">
            <div class="text-xs uppercase tracking-[0.18em] text-gray-500">Aura</div>
            <div class="mt-2 text-sm text-gray-100">{data.detail.structure.slots.aura.name ?? "\u2014"}</div>
          </div>
          <div class="panel-muted p-4">
            <div class="text-xs uppercase tracking-[0.18em] text-gray-500">Keystone</div>
            <div class="mt-2 text-sm text-gray-100">{data.detail.structure.slots.keystone.name ?? "\u2014"}</div>
          </div>
        </div>
      </article>

      <article class="panel p-5">
        <div class="grid gap-5 lg:grid-cols-2">
          <div>
            <h3 class="text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">Talents</h3>
            <div class="mt-4 flex flex-wrap gap-2">
              {#each data.detail.structure.talents as talent}
                <span class="panel-muted px-3 py-1 text-sm text-gray-200">
                  {talent.name}
                </span>
              {:else}
                <span class="text-sm text-gray-500">No talent list in payload.</span>
              {/each}
            </div>
          </div>

          <div>
            <h3 class="text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">Curio Perks</h3>
            <div class="mt-4 flex flex-wrap gap-2">
              {#each data.detail.structure.curio_perks as perk}
                <span class="panel-muted px-3 py-1 text-sm text-gray-200">
                  {perk.name}
                </span>
              {:else}
                <span class="text-sm text-gray-500">No curio perks in payload.</span>
              {/each}
            </div>
          </div>
        </div>
      </article>
    </div>
  </section>

  <section class="space-y-4">
    <div class="flex items-baseline justify-between">
      <h2 class="text-xl font-semibold text-gray-100">Scorecard Overview</h2>
      <span class="text-xs uppercase tracking-[0.2em] text-gray-500">Seven dimensions + composite</span>
    </div>

    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {#each dimensionCards as card}
        <article class="panel p-4">
          <div class="text-xs uppercase tracking-[0.18em] text-gray-500">{card.label}</div>
          <div class="mt-3 flex items-end justify-between">
            <div class="text-3xl font-bold {card.key === 'composite' ? 'text-gray-100' : scoreColor(card.score)}">
              {card.score ?? "\u2014"}
            </div>
            <div class="text-sm text-gray-500">/ {card.max}</div>
          </div>
          {#if card.explanation}
            <p class="mt-3 text-sm text-gray-400">{card.explanation}</p>
          {/if}
        </article>
      {/each}
    </div>
  </section>

  <section class="space-y-4">
    <div class="flex items-baseline justify-between">
      <h2 class="text-xl font-semibold text-gray-100">Weapons</h2>
      <span class="text-xs uppercase tracking-[0.2em] text-gray-500">
        Blessing tiers are not present in the precomputed scorecard payload
      </span>
    </div>

    <div class="grid gap-4 xl:grid-cols-2">
      {#each data.detail.scorecard.weapons as weapon (weapon.canonical_entity_id ?? weapon.name)}
        <article class="panel p-5">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h3 class="text-lg font-semibold text-gray-100">{weapon.name}</h3>
              <p class="mt-1 text-sm text-gray-400">{titleCase(weapon.slot ?? "unknown")} slot</p>
            </div>
            <div class="panel-muted px-3 py-2 text-right">
              <div class="text-xs uppercase tracking-[0.18em] text-gray-500">Perk Optimality</div>
              <div class="mt-1 text-xl font-bold {scoreColor(weapon.perks.score)}">{weapon.perks.score}/5</div>
            </div>
          </div>

          <div class="mt-5 grid gap-4 lg:grid-cols-2">
            <div class="space-y-3">
              <h4 class="text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">Perks</h4>
              {#if weapon.perks.perks.length > 0}
                <ul class="flex flex-wrap gap-2">
                  {#each weapon.perks.perks as perk}
                    <li class="panel-muted px-3 py-2 text-sm text-gray-100">
                      <span>{perk.name}</span>
                      <span class="ml-2 text-xs text-gray-500">
                        {perkTierLabel(perk.tier)}{perk.value != null ? ` · ${Math.round(perk.value * 100)}%` : ""}
                      </span>
                    </li>
                  {/each}
                </ul>
              {:else}
                <p class="text-sm text-gray-500">No weapon perks scored.</p>
              {/if}
            </div>

            <div class="space-y-3">
              <h4 class="text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">Blessings</h4>
              {#if weapon.blessings.blessings.length > 0}
                <ul class="flex flex-wrap gap-2">
                  {#each weapon.blessings.blessings as blessing}
                    <li class="panel-muted px-3 py-2 text-sm text-gray-100">
                      <span>{blessing.name}</span>
                      {#if !blessing.known}
                        <span class="ml-2 rounded border border-yellow-800 px-2 py-0.5 text-[11px] text-yellow-300">
                          Catalog gap
                        </span>
                      {/if}
                    </li>
                  {/each}
                </ul>
              {:else}
                <p class="text-sm text-gray-500">This weapon family is not yet in the blessing scoring catalog.</p>
              {/if}
            </div>
          </div>
        </article>
      {/each}
    </div>
  </section>

  <section class="space-y-4">
    <h2 class="text-xl font-semibold text-gray-100">Synergy</h2>

    <div class="grid gap-4 xl:grid-cols-[2fr_1fr]">
      <article class="panel p-5">
        <div class="flex items-baseline justify-between">
          <h3 class="text-lg font-semibold text-gray-100">Synergy Edges</h3>
          <span class="text-sm text-gray-500">{data.detail.synergy.synergy_edges.length} edges</span>
        </div>

        {#if data.detail.synergy.synergy_edges.length > 0}
          <ul class="mt-4 space-y-3">
            {#each synergyPreview as edge}
              <li class="panel-muted p-4">
                <div class="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.18em] text-gray-500">
                  <span>{titleCase(edge.type)}</span>
                  <span class="rounded-full border border-gray-700 px-2 py-0.5 text-gray-300">Strength {edge.strength}</span>
                  {#if edge.families.length > 0}
                    <span class="rounded-full border border-gray-700 px-2 py-0.5 text-gray-300">{edge.families.map((family) => formatCoverageLabel(family)).join(", ")}</span>
                  {/if}
                </div>
                <div class="mt-3 text-sm text-gray-200">{formatEdgeSelections(edge.selections)}</div>
                <p class="mt-2 text-sm text-gray-400">{edge.explanation}</p>
              </li>
            {/each}
          </ul>
          {#if hiddenSynergyCount > 0}
            <details class="disclosure mt-4 p-4">
              <summary class="cursor-pointer text-sm font-medium text-gray-200">
                Show {hiddenSynergyCount} more synergy edge{hiddenSynergyCount === 1 ? "" : "s"}
              </summary>
              <ul class="mt-4 space-y-3">
                {#each data.detail.synergy.synergy_edges.slice(synergyPreviewLimit) as edge}
                  <li class="panel p-4">
                    <div class="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.18em] text-gray-500">
                      <span>{titleCase(edge.type)}</span>
                      <span class="rounded-full border border-gray-700 px-2 py-0.5 text-gray-300">Strength {edge.strength}</span>
                      {#if edge.families.length > 0}
                        <span class="rounded-full border border-gray-700 px-2 py-0.5 text-gray-300">{edge.families.map((family) => formatCoverageLabel(family)).join(", ")}</span>
                      {/if}
                    </div>
                    <div class="mt-3 text-sm text-gray-200">{formatEdgeSelections(edge.selections)}</div>
                    <p class="mt-2 text-sm text-gray-400">{edge.explanation}</p>
                  </li>
                {/each}
              </ul>
            </details>
          {/if}
        {:else}
          <p class="mt-4 text-sm text-gray-500">No synergy edges were produced for this build.</p>
        {/if}
      </article>

      <div class="space-y-4">
        <article class="panel p-5">
          <div class="flex items-baseline justify-between">
            <h3 class="text-lg font-semibold text-gray-100">Anti-Synergies</h3>
            <span class="text-sm text-gray-500">{data.detail.synergy.anti_synergies.length}</span>
          </div>

          {#if data.detail.synergy.anti_synergies.length > 0}
            <div class="mt-4 flex flex-wrap gap-2">
              {#each antiSynergyCounts as entry}
                <span class="rounded-full border border-red-800 bg-red-950/30 px-3 py-1.5 text-sm text-red-200">
                  {entry.name}{entry.count > 1 ? ` ×${entry.count}` : ""}
                </span>
              {/each}
            </div>
            <details class="disclosure mt-4 p-4">
              <summary class="cursor-pointer text-sm font-medium text-gray-200">Show detailed anti-synergy entries</summary>
              <ul class="mt-4 space-y-3">
                {#each data.detail.synergy.anti_synergies as anti}
                  <li class="rounded-xl border p-4 {warningStyle(anti.severity)}">
                    <div class="text-xs uppercase tracking-[0.18em]">{titleCase(anti.type)} • {anti.severity}</div>
                    <p class="mt-2 text-sm">{anti.reason}</p>
                  </li>
                {/each}
              </ul>
            </details>
          {:else}
            <p class="mt-4 text-sm text-gray-500">No anti-synergies flagged.</p>
          {/if}
        </article>

        <article class="panel p-5">
          <div class="flex items-baseline justify-between">
            <h3 class="text-lg font-semibold text-gray-100">Isolated Picks</h3>
            <span class="text-sm text-gray-500">{data.detail.synergy.orphans.length}</span>
          </div>

          {#if data.detail.synergy.orphans.length > 0}
            <div class="mt-4 flex flex-wrap gap-2">
              {#each orphanCounts as orphan}
                <span class="panel-muted px-3 py-1.5 text-sm text-gray-200">
                  {orphan.name}{orphan.count > 1 ? ` ×${orphan.count}` : ""}
                </span>
              {/each}
            </div>
            <details class="disclosure mt-4 p-4">
              <summary class="cursor-pointer text-sm font-medium text-gray-200">Show isolated-pick reasons</summary>
              <ul class="mt-4 space-y-3">
                {#each data.detail.synergy.orphans as orphan}
                  <li class="panel p-4">
                    <div class="text-sm text-gray-200">{formatSelectionText(orphan.selection, selectionLabels)}</div>
                    <p class="mt-2 text-sm text-gray-400">{titleCase(orphan.reason)}</p>
                    <p class="mt-1 text-xs text-gray-500">
                      {orphan.resource ? `${orphan.resource} • ` : ""}{orphan.condition}
                    </p>
                  </li>
                {/each}
              </ul>
            </details>
          {:else}
            <p class="mt-4 text-sm text-gray-500">All selections participate in at least one synergy edge.</p>
          {/if}
        </article>
      </div>
    </div>

    <article class="panel p-5">
      <h3 class="text-lg font-semibold text-gray-100">Coverage Stats</h3>

      <div class="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div class="panel-muted p-4">
          <div class="text-xs uppercase tracking-[0.18em] text-gray-500">Calc Coverage</div>
          <div class="mt-2 text-2xl font-bold text-gray-100">{formatCoverageFraction(data.detail.synergy.metadata.calc_coverage_pct)}</div>
        </div>
        <div class="panel-muted p-4">
          <div class="text-xs uppercase tracking-[0.18em] text-gray-500">Entities Analyzed</div>
          <div class="mt-2 text-2xl font-bold text-gray-100">{data.detail.synergy.metadata.entities_analyzed}</div>
        </div>
        <div class="panel-muted p-4">
          <div class="text-xs uppercase tracking-[0.18em] text-gray-500">Entities With Calc</div>
          <div class="mt-2 text-2xl font-bold text-gray-100">{data.detail.synergy.metadata.unique_entities_with_calc}</div>
        </div>
        <div class="panel-muted p-4">
          <div class="text-xs uppercase tracking-[0.18em] text-gray-500">Opaque Conditions</div>
          <div class="mt-2 text-2xl font-bold text-gray-100">{data.detail.synergy.metadata.opaque_conditions}</div>
        </div>
      </div>

      <div class="mt-4 grid gap-4 xl:grid-cols-3">
        <div class="panel-muted p-4">
          <h4 class="text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">Build Identity</h4>
          <p class="mt-3 text-sm text-gray-200">
            {coverageLabels(data.detail.synergy.coverage.build_identity)}
          </p>
          <p class="mt-2 text-xs text-gray-500">Concentration {data.detail.synergy.coverage.concentration}</p>
        </div>

        <div class="panel-muted p-4">
          <h4 class="text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">Coverage Gaps</h4>
          <p class="mt-3 text-sm text-gray-200">
            {coverageLabels(data.detail.synergy.coverage.coverage_gaps)}
          </p>
        </div>

        <div class="panel-muted p-4">
          <h4 class="text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">Slot Balance</h4>
          <div class="mt-3 space-y-2 text-sm text-gray-200">
            <div>Melee: {data.detail.synergy.coverage.slot_balance.melee.strength} selections</div>
            <div>Ranged: {data.detail.synergy.coverage.slot_balance.ranged.strength} selections</div>
          </div>
        </div>
      </div>
    </article>
  </section>

  <section class="space-y-4">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h2 class="text-xl font-semibold text-gray-100">Breakpoint Matrix</h2>
        <p class="mt-1 text-sm text-gray-400">
          Selected slice: {titleCase(selectedScenario)} / {titleCase(selectedDifficulty)}
        </p>
      </div>

      <div class="flex flex-col gap-3 sm:flex-row">
        <div class="flex flex-wrap gap-2">
          {#each availableScenarios as scenario}
            <button
              class="rounded-lg border px-3 py-2 text-sm transition-colors {selectedScenario === scenario ? 'border-amber-700 bg-amber-950/50 text-amber-200' : 'border-gray-800 bg-gray-900 text-gray-400 hover:text-gray-200'}"
              onclick={() => (selectedScenario = scenario)}
            >
              {titleCase(scenario)}
            </button>
          {/each}
        </div>

        <select
          bind:value={selectedDifficulty}
          class="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-amber-700"
        >
          {#each DIFFICULTIES as difficulty}
            <option value={difficulty}>{titleCase(difficulty)}</option>
          {/each}
        </select>
      </div>
    </div>

    <div class="space-y-6">
      {#each breakpointPanels as panel (panel.entityId ?? panel.name)}
        {@const matrix = panel.weapon ? weaponMatrix(panel.weapon) : { breeds: [], rows: [] }}
        <details class="disclosure p-5 min-w-0 overflow-hidden" open={panel.defaultOpen}>
          <summary class="flex cursor-pointer list-none items-baseline justify-between gap-4">
            <div>
              <h3 class="text-lg font-semibold text-gray-100">{panel.name}</h3>
              <p class="mt-1 text-sm text-gray-400">
                {panel.slot ?? "unknown"} weapon
              </p>
            </div>
            <div class="text-right">
              <div class="text-xs uppercase tracking-[0.18em] text-gray-500">
                {panel.status === "unsupported" ? "Unsupported" : `${matrix.rows.length} action rows`}
              </div>
              <div class="mt-1 text-xs text-gray-600">Expand for matrix</div>
            </div>
          </summary>

          {#if panel.status === "supported" && panel.weapon && matrix.rows.length > 0 && matrix.breeds.length > 0}
            <div class="mt-4 overflow-x-auto panel-muted">
              <table class="min-w-full text-xs">
                <thead class="bg-gray-950 text-gray-400">
                  <tr>
                    <th class="sticky left-0 bg-gray-950 px-3 py-2 text-left font-medium">Action</th>
                    {#each matrix.breeds as breed}
                      <th class="px-3 py-2 font-medium whitespace-nowrap">{titleCase(breed)}</th>
                    {/each}
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-800">
                  {#each matrix.rows as row}
                    <tr class="bg-gray-900">
                      <td class="sticky left-0 bg-gray-900 px-3 py-2">
                        <div class="font-medium text-gray-100">{row.label}</div>
                      </td>
                      {#each row.values as value}
                        <td class="px-3 py-2 text-center tabular-nums {htkCellClass(value)}">
                          {value ?? "\u2014"}
                        </td>
                      {/each}
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else if panel.message}
            <div class="panel-muted mt-4 p-4">
              <p class="text-sm text-gray-400">{panel.message}</p>
            </div>
          {:else}
            <p class="mt-4 text-sm text-gray-500">No breakpoint data is available for this scenario/difficulty slice.</p>
          {/if}
        </details>
      {/each}
    </div>
  </section>
</div>
