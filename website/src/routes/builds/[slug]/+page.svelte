<script lang="ts">
  import { base } from "$app/paths";
  import {
    CLASS_COLORS,
    GRADE_STYLES,
    htkCellClass,
    scoreColor,
  } from "$lib/builds";
  import { DIMENSIONS } from "$lib/dimensions";
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
    action: string;
    profileId: string;
    values: Array<number | null>;
  };

  const DIFFICULTIES = ["uprising", "malice", "heresy", "damnation", "auric"];

  let { data }: Props = $props();

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

  let dimensionCards = $derived.by((): DimensionCard[] => [
    ...DIMENSIONS.map((dimension) => ({
      key: dimension.summary_key,
      label: dimension.label,
      score: data.detail.summary.scores[dimension.summary_key as keyof typeof data.detail.summary.scores] as number | null,
      max: dimension.max,
      explanation: dimension.scorecard_key === "composite_score"
        ? `Grade ${data.detail.summary.scores.grade}`
        : dimension.scorecard_key === "perk_optimality"
          ? "Average weapon perk score across the build."
          : dimension.scorecard_key === "curio_efficiency"
            ? "Curio perk mix quality for the build class."
            : dimensionDetail(dimension.scorecard_key)?.explanations[0] ?? null,
    })),
  ]);

  function perkTierLabel(tier: number | undefined): string {
    return typeof tier === "number" ? `T${tier}` : "T?";
  }

  function formatEdgeSelections(selections: string[]): string {
    if (selections.length === 0) return "\u2014";
    if (selections.length === 1) return selections[0];
    return `${selections[0]} \u2192 ${selections[1]}`;
  }

  function scenarioBreeds(action: BreakpointActionDetail): BreakpointBreedEntry[] {
    return (action.scenarios[selectedScenario]?.breeds ?? [])
      .filter((entry) => entry.difficulty === selectedDifficulty);
  }

  // Collapse scenario/difficulty slices into an actions x breeds matrix for the selected view.
  function weaponMatrix(weapon: BreakpointWeaponDetail): { breeds: string[]; rows: MatrixRow[] } {
    const breedIds = new Set<string>();

    for (const action of weapon.actions) {
      for (const entry of scenarioBreeds(action)) {
        breedIds.add(entry.breed_id);
      }
    }

    const breeds = [...breedIds].sort();
    const rows = weapon.actions
      .map((action) => {
        const hitsByBreed = new Map(scenarioBreeds(action).map((entry) => [entry.breed_id, entry.hitsToKill]));
        return {
          action: action.type,
          profileId: action.profileId,
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

<div class="space-y-8">
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-4">
      <a href={`${base}/`} class="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-amber-300 transition-colors">
        <span aria-hidden="true">←</span>
        Back to builds
      </a>
      <a href={`${base}/compare?builds=${data.detail.slug},`} class="text-sm text-gray-400 hover:text-amber-300 transition-colors">
        Compare with...
      </a>
    </div>

    <section class="rounded-2xl border border-gray-800 bg-gray-900 px-6 py-6">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div class="space-y-3">
          <div class="flex flex-wrap items-center gap-3 text-sm">
            <span class="rounded-full border border-gray-800 bg-gray-950 px-3 py-1 {CLASS_COLORS[data.detail.summary.class] ?? 'text-gray-300'}">
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

        <div class="rounded-xl border border-gray-800 bg-gray-950 px-4 py-3 text-right">
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
    <div class="flex items-baseline justify-between">
      <h2 class="text-xl font-semibold text-gray-100">Scorecard Overview</h2>
      <span class="text-xs uppercase tracking-[0.2em] text-gray-500">Seven dimensions + composite</span>
    </div>

    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {#each dimensionCards as card}
        <article class="rounded-2xl border border-gray-800 bg-gray-900 p-4">
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
        <article class="rounded-2xl border border-gray-800 bg-gray-900 p-5">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h3 class="text-lg font-semibold text-gray-100">{weapon.name}</h3>
              <p class="mt-1 text-sm text-gray-400">{titleCase(weapon.slot ?? "unknown")} slot</p>
            </div>
            <div class="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-right">
              <div class="text-xs uppercase tracking-[0.18em] text-gray-500">Perk Optimality</div>
              <div class="mt-1 text-xl font-bold {scoreColor(weapon.perks.score)}">{weapon.perks.score}/5</div>
            </div>
          </div>

          <div class="mt-5 grid gap-4 lg:grid-cols-2">
            <div class="space-y-3">
              <h4 class="text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">Perks</h4>
              {#if weapon.perks.perks.length > 0}
                <ul class="space-y-2">
                  {#each weapon.perks.perks as perk, index}
                    <li class="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950 px-3 py-2">
                      <div class="min-w-0">
                        <div class="truncate text-sm text-gray-100">{perk?.name ?? `Unknown perk ${index + 1}`}</div>
                        <div class="text-xs text-gray-500">{perk?.value != null ? `${Math.round(perk.value * 100)}% roll` : "No roll data"}</div>
                      </div>
                      <span class="ml-3 rounded border border-gray-700 px-2 py-0.5 text-xs text-gray-300">
                        {perkTierLabel(perk?.tier)}
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
                <ul class="space-y-2">
                  {#each weapon.blessings.blessings as blessing}
                    <li class="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950 px-3 py-2">
                      <div class="min-w-0">
                        <div class="truncate text-sm text-gray-100">{blessing.name}</div>
                        <div class="text-xs text-gray-500">{blessing.internal ?? "No internal mapping"}</div>
                      </div>
                      <span class="ml-3 rounded border px-2 py-0.5 text-xs {blessing.known ? 'border-emerald-800 text-emerald-300' : 'border-yellow-800 text-yellow-300'}">
                        {blessing.known ? "Known" : "Unknown"}
                      </span>
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
      <article class="rounded-2xl border border-gray-800 bg-gray-900 p-5">
        <div class="flex items-baseline justify-between">
          <h3 class="text-lg font-semibold text-gray-100">Synergy Edges</h3>
          <span class="text-sm text-gray-500">{data.detail.synergy.synergy_edges.length} edges</span>
        </div>

        {#if data.detail.synergy.synergy_edges.length > 0}
          <ul class="mt-4 space-y-3">
            {#each data.detail.synergy.synergy_edges as edge}
              <li class="rounded-xl border border-gray-800 bg-gray-950 p-4">
                <div class="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.18em] text-gray-500">
                  <span>{titleCase(edge.type)}</span>
                  <span class="rounded-full border border-gray-700 px-2 py-0.5 text-gray-300">Strength {edge.strength}</span>
                  {#if edge.families.length > 0}
                    <span class="rounded-full border border-gray-700 px-2 py-0.5 text-gray-300">{edge.families.join(", ")}</span>
                  {/if}
                </div>
                <div class="mt-3 font-mono text-sm text-gray-200 break-all">{formatEdgeSelections(edge.selections)}</div>
                <p class="mt-2 text-sm text-gray-400">{edge.explanation}</p>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="mt-4 text-sm text-gray-500">No synergy edges were produced for this build.</p>
        {/if}
      </article>

      <div class="space-y-4">
        <article class="rounded-2xl border border-gray-800 bg-gray-900 p-5">
          <div class="flex items-baseline justify-between">
            <h3 class="text-lg font-semibold text-gray-100">Anti-Synergies</h3>
            <span class="text-sm text-gray-500">{data.detail.synergy.anti_synergies.length}</span>
          </div>

          {#if data.detail.synergy.anti_synergies.length > 0}
            <ul class="mt-4 space-y-3">
              {#each data.detail.synergy.anti_synergies as anti}
                <li class="rounded-xl border p-4 {warningStyle(anti.severity)}">
                  <div class="text-xs uppercase tracking-[0.18em]">{titleCase(anti.type)} • {anti.severity}</div>
                  <p class="mt-2 text-sm">{anti.reason}</p>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="mt-4 text-sm text-gray-500">No anti-synergies flagged.</p>
          {/if}
        </article>

        <article class="rounded-2xl border border-gray-800 bg-gray-900 p-5">
          <div class="flex items-baseline justify-between">
            <h3 class="text-lg font-semibold text-gray-100">Isolated Picks</h3>
            <span class="text-sm text-gray-500">{data.detail.synergy.orphans.length}</span>
          </div>

          {#if data.detail.synergy.orphans.length > 0}
            <ul class="mt-4 space-y-3">
              {#each data.detail.synergy.orphans as orphan}
                <li class="rounded-xl border border-gray-800 bg-gray-950 p-4">
                  <div class="font-mono text-sm text-gray-200 break-all">{orphan.selection}</div>
                  <p class="mt-2 text-sm text-gray-400">{titleCase(orphan.reason)}</p>
                  <p class="mt-1 text-xs text-gray-500">
                    {orphan.resource ? `${orphan.resource} • ` : ""}{orphan.condition}
                  </p>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="mt-4 text-sm text-gray-500">All selections participate in at least one synergy edge.</p>
          {/if}
        </article>
      </div>
    </div>

    <article class="rounded-2xl border border-gray-800 bg-gray-900 p-5">
      <h3 class="text-lg font-semibold text-gray-100">Coverage Stats</h3>

      <div class="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div class="rounded-xl border border-gray-800 bg-gray-950 p-4">
          <div class="text-xs uppercase tracking-[0.18em] text-gray-500">Calc Coverage</div>
          <div class="mt-2 text-2xl font-bold text-gray-100">{data.detail.synergy.metadata.calc_coverage_pct}%</div>
        </div>
        <div class="rounded-xl border border-gray-800 bg-gray-950 p-4">
          <div class="text-xs uppercase tracking-[0.18em] text-gray-500">Entities Analyzed</div>
          <div class="mt-2 text-2xl font-bold text-gray-100">{data.detail.synergy.metadata.entities_analyzed}</div>
        </div>
        <div class="rounded-xl border border-gray-800 bg-gray-950 p-4">
          <div class="text-xs uppercase tracking-[0.18em] text-gray-500">Entities With Calc</div>
          <div class="mt-2 text-2xl font-bold text-gray-100">{data.detail.synergy.metadata.unique_entities_with_calc}</div>
        </div>
        <div class="rounded-xl border border-gray-800 bg-gray-950 p-4">
          <div class="text-xs uppercase tracking-[0.18em] text-gray-500">Opaque Conditions</div>
          <div class="mt-2 text-2xl font-bold text-gray-100">{data.detail.synergy.metadata.opaque_conditions}</div>
        </div>
      </div>

      <div class="mt-4 grid gap-4 xl:grid-cols-3">
        <div class="rounded-xl border border-gray-800 bg-gray-950 p-4">
          <h4 class="text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">Build Identity</h4>
          <p class="mt-3 text-sm text-gray-200">
            {data.detail.synergy.coverage.build_identity.length > 0
              ? data.detail.synergy.coverage.build_identity.join(", ")
              : "None"}
          </p>
          <p class="mt-2 text-xs text-gray-500">Concentration {data.detail.synergy.coverage.concentration}</p>
        </div>

        <div class="rounded-xl border border-gray-800 bg-gray-950 p-4">
          <h4 class="text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">Coverage Gaps</h4>
          <p class="mt-3 text-sm text-gray-200">
            {data.detail.synergy.coverage.coverage_gaps.length > 0
              ? data.detail.synergy.coverage.coverage_gaps.join(", ")
              : "None"}
          </p>
        </div>

        <div class="rounded-xl border border-gray-800 bg-gray-950 p-4">
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
      {#each data.detail.breakpoints.weapons as weapon (weapon.entityId)}
        {@const matrix = weaponMatrix(weapon)}
        <article class="rounded-2xl border border-gray-800 bg-gray-900 p-5 min-w-0 overflow-hidden">
          <div class="flex items-baseline justify-between gap-4">
            <div>
              <h3 class="text-lg font-semibold text-gray-100">{breakpointWeaponLabel(weapon)}</h3>
              <p class="mt-1 text-sm text-gray-400">
                {data.detail.scorecard.weapons.find((candidate) => candidate.canonical_entity_id === weapon.entityId)?.slot ?? "unknown"} weapon
              </p>
            </div>
            <div class="text-xs uppercase tracking-[0.18em] text-gray-500">
              {matrix.rows.length} action rows
            </div>
          </div>

          {#if matrix.rows.length > 0 && matrix.breeds.length > 0}
            <div class="mt-4 overflow-x-auto rounded-xl border border-gray-800">
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
                        <div class="font-medium text-gray-100">{titleCase(row.action)}</div>
                        <div class="text-[11px] text-gray-500">{row.profileId}</div>
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
          {:else}
            <p class="mt-4 text-sm text-gray-500">No breakpoint data is available for this scenario/difficulty slice.</p>
          {/if}
        </article>
      {/each}
    </div>
  </section>
</div>
