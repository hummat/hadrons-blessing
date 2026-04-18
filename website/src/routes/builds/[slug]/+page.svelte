<script lang="ts">
  import { base } from "$app/paths";
  import { htkCellClass } from "$lib/builds";
  import { DIMENSIONS } from "$lib/dimensions";
  import {
    buildBreakpointPanels,
    buildBreakpointActionLabels,
    buildSelectionLabelMap,
    rewriteExplanation,
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
  } from "$lib/types";
  import VerdictStrip from "$lib/VerdictStrip.svelte";

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
  const blessingMap = $derived.by(() => {
    const map: Record<string, string> = {};
    for (const weapon of data.detail.structure.weapons) {
      for (const blessing of weapon.blessings) {
        const slug = blessing.id?.split(".").at(-1);
        if (!slug) continue;
        map[slug] = blessing.name;
      }
    }
    return map;
  });

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

  function dimensionExplanation(key: string): string | null {
    if (key === "composite") return `Grade ${data.detail.summary.scores.grade}`;
    if (key === "perk_optimality") return "Average weapon perk score across the build.";
    if (key === "curio_efficiency") return "Curio perk mix quality for the build class.";

    const detail = dimensionDetail(key);
    const explanation = detail?.explanations[0] ?? null;
    if (!explanation) return null;
    return rewriteExplanation(key, explanation, blessingMap);
  }

  function coverageLabels(values: string[]): string {
    return values.length > 0 ? values.map((value) => formatCoverageLabel(value)).join(", ") : "None";
  }

  function dsScoreColor(value: number | null, composite = false): string {
    if (value == null) return "ds-score--null";
    if (composite) return "ds-score--composite";
    if (value >= 4) return "ds-score--high";
    if (value >= 3) return "ds-score--mid";
    if (value >= 2) return "ds-score--warn";
    return "ds-score--low";
  }

  function dsHtkCell(value: number | null): string {
    const raw = htkCellClass(value);
    if (raw.includes("best")) return "ds-htk--best";
    if (raw.includes("mid")) return "ds-htk--mid";
    if (raw.includes("worst")) return "ds-htk--worst";
    return "ds-htk--null";
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
</script>

<svelte:head>
  <title>{data.detail.summary.title} — Hadron's Blessing</title>
</svelte:head>

<div class="dataslate-root">
  <div class="ds-page">
    <nav class="ds-reveal ds-crumbs" aria-label="Breadcrumbs">
      <a href={`${base}/`} class="ds-crumb">
        <span aria-hidden="true">◄</span>
        Return to archive
      </a>
      <a href={`${base}/compare?builds=${data.detail.slug},`} class="ds-crumb">
        Cross-reference ▸
      </a>
    </nav>

    <section class="ds-reveal">
      <article class="ds-parchment ds-hero">
        <span class="ds-corner ds-corner--tl"></span>
        <span class="ds-corner ds-corner--tr"></span>
        <span class="ds-corner ds-corner--bl"></span>
        <span class="ds-corner ds-corner--br"></span>

        <div class="ds-hero-layout">
          <div>
            <div class="ds-hero-meta">
              <span class="ds-class-chip">{titleCase(data.detail.summary.class)}</span>
              {#if data.detail.summary.ability}
                <span class="ds-label">Ability <span class="ds-body" style="margin-left:0.45rem">{data.detail.summary.ability}</span></span>
              {/if}
              {#if data.detail.summary.keystone}
                <span class="ds-label">Keystone <span class="ds-body" style="margin-left:0.45rem">{data.detail.summary.keystone}</span></span>
              {/if}
            </div>

            <h1 class="ds-title-epic">{data.detail.summary.title}</h1>

            <p class="ds-hero-weapons">
              {data.detail.summary.weapons.map((weapon) => weapon.name).join("  /  ")}
            </p>
          </div>

          <div class="ds-hero-grade">
            <div class="ds-seal-wrap">
              <div class="ds-seal">
                <span class="ds-grade-letter">{data.detail.summary.scores.grade}</span>
              </div>
            </div>
            <div class="ds-seal-caption">Purity &middot; Rating</div>
            <div class="ds-hero-score">{data.detail.summary.scores.composite} / 35</div>
          </div>
        </div>
      </article>
    </section>

    <section class="ds-reveal ds-section">
      <header class="ds-section-heading">
        <div class="ds-section-heading__copy">
          <span class="ds-label ds-label--parchment">Verdict</span>
          <h2 class="ds-h2">Field Assessment</h2>
        </div>
        <div class="ds-rule"><span class="ds-rule__mark">✠</span></div>
      </header>

      <VerdictStrip detail={data.detail} {blessingMap} />
    </section>

    <section class="ds-reveal ds-section">
      <header class="ds-section-heading">
        <div class="ds-section-heading__copy">
          <span class="ds-label ds-label--parchment">Declared Loadout</span>
          <h2 class="ds-h2">Ordo Manifest</h2>
        </div>
        <div class="ds-rule"><span class="ds-rule__mark">✠</span></div>
      </header>

      <div class="ds-structure">
        <article class="ds-parchment ds-panel">
          <h3 class="ds-h3">Core Slots</h3>
          <div class="ds-rule ds-rule--standalone"><span class="ds-rule__mark">❖</span></div>
          <div class="ds-slot-grid">
            <div class="ds-slot">
              <div class="ds-label">Ability</div>
              <div class="ds-slot__name">{data.detail.structure.slots.ability.name ?? "\u2014"}</div>
            </div>
            <div class="ds-slot">
              <div class="ds-label">Blitz</div>
              <div class="ds-slot__name">{data.detail.structure.slots.blitz.name ?? "\u2014"}</div>
            </div>
            <div class="ds-slot">
              <div class="ds-label">Aura</div>
              <div class="ds-slot__name">{data.detail.structure.slots.aura.name ?? "\u2014"}</div>
            </div>
            <div class="ds-slot">
              <div class="ds-label">Keystone</div>
              <div class="ds-slot__name">{data.detail.structure.slots.keystone.name ?? "\u2014"}</div>
            </div>
          </div>
        </article>

        <article class="ds-parchment ds-panel">
          <div style="display:grid;gap:1.5rem;grid-template-columns:minmax(0,1fr);">
            <div>
              <h3 class="ds-h3">Talents</h3>
              <div class="ds-rule ds-rule--standalone"><span class="ds-rule__mark">❖</span></div>
              <div class="ds-chip-cloud">
                {#each data.detail.structure.talents as talent}
                  <span class="ds-stamp">{talent.name}</span>
                {:else}
                  <span class="ds-body ds-body--faint">No talent list in payload.</span>
                {/each}
              </div>
            </div>

            <div>
              <h3 class="ds-h3">Curio Perks</h3>
              <div class="ds-rule ds-rule--standalone"><span class="ds-rule__mark">❖</span></div>
              <div class="ds-chip-cloud">
                {#each data.detail.structure.curio_perks as perk}
                  <span class="ds-stamp">{perk.name}</span>
                {:else}
                  <span class="ds-body ds-body--faint">No curio perks in payload.</span>
                {/each}
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>

    <section class="ds-reveal ds-section">
      <header class="ds-section-heading">
        <div class="ds-section-heading__copy">
          <span class="ds-label ds-label--parchment">Armoury Record</span>
          <h2 class="ds-h2">Weapons</h2>
        </div>
        <div class="ds-rule"><span class="ds-rule__mark">✠</span></div>
      </header>

      <div class="ds-weapon-grid">
        {#each data.detail.scorecard.weapons as weapon (weapon.canonical_entity_id ?? weapon.name)}
          <article class="ds-parchment ds-panel">
            <div class="ds-weapon-head">
              <div>
                <h3 class="ds-h3">{weapon.name}</h3>
                <div class="ds-label" style="margin-top:0.35rem">{titleCase(weapon.slot ?? "unknown")} slot</div>
              </div>
              <div class="ds-weapon-perk-score">
                <div class="ds-label">Perk Optimality</div>
                <div class="ds-weapon-perk-score__value">{weapon.perks.score}/5</div>
              </div>
            </div>

            <div class="ds-weapon-lists">
              <div>
                <div class="ds-label" style="margin-bottom:0.6rem">Perks</div>
                {#if weapon.perks.perks.length > 0}
                  <div class="ds-chip-cloud" style="margin-top:0">
                    {#each weapon.perks.perks as perk}
                      <span class="ds-perk-stamp">
                        <span>{perk.name}</span>
                        <span class="ds-perk-stamp__tier">
                          {perkTierLabel(perk.tier)}{perk.value != null ? ` · ${Math.round(perk.value * 100)}%` : ""}
                        </span>
                      </span>
                    {/each}
                  </div>
                {:else}
                  <p class="ds-body ds-body--faint">No weapon perks scored.</p>
                {/if}
              </div>

              <div>
                <div class="ds-label" style="margin-bottom:0.6rem">Blessings</div>
                {#if weapon.blessings.blessings.length > 0}
                  <div class="ds-chip-cloud" style="margin-top:0">
                    {#each weapon.blessings.blessings as blessing}
                      <span class="ds-perk-stamp">
                        <span>{blessing.name}</span>
                        {#if !blessing.known}
                          <span class="ds-catalog-gap">Catalog gap</span>
                        {/if}
                      </span>
                    {/each}
                  </div>
                {:else}
                  <p class="ds-body ds-body--faint">This weapon family is not yet in the blessing scoring catalog.</p>
                {/if}
              </div>
            </div>
          </article>
        {/each}
      </div>
    </section>

    <section class="ds-reveal ds-section">
      <header class="ds-section-heading">
        <div class="ds-section-heading__copy">
          <span class="ds-label ds-label--parchment">Cross-Reference</span>
          <h2 class="ds-h2">Synergy</h2>
        </div>
        <div class="ds-rule"><span class="ds-rule__mark">✠</span></div>
      </header>

      <div class="ds-synergy-grid">
        <article class="ds-parchment ds-panel">
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:1rem">
            <h3 class="ds-h3">Synergy Edges</h3>
            <span class="ds-label">{data.detail.synergy.synergy_edges.length} edges</span>
          </div>
          <div class="ds-rule ds-rule--standalone"><span class="ds-rule__mark">❖</span></div>

          {#if data.detail.synergy.synergy_edges.length > 0}
            <div>
              {#each synergyPreview as edge}
                <div class="ds-edge">
                  <div class="ds-edge-head">
                    <span class="ds-stamp--ink ds-stamp">{titleCase(edge.type)}</span>
                    <span class="ds-stamp ds-stamp--brass">Strength {edge.strength}</span>
                    {#if edge.families.length > 0}
                      <span class="ds-stamp ds-stamp--brass">{edge.families.map((family) => formatCoverageLabel(family)).join(", ")}</span>
                    {/if}
                  </div>
                  <div class="ds-edge-selections">{formatEdgeSelections(edge.selections)}</div>
                  <p class="ds-edge-explanation">{edge.explanation}</p>
                </div>
              {/each}
            </div>
            {#if hiddenSynergyCount > 0}
              <details class="ds-discl">
                <summary>Show {hiddenSynergyCount} more synergy edge{hiddenSynergyCount === 1 ? "" : "s"}</summary>
                <div style="margin-top:0.8rem">
                  {#each data.detail.synergy.synergy_edges.slice(synergyPreviewLimit) as edge}
                    <div class="ds-edge">
                      <div class="ds-edge-head">
                        <span class="ds-stamp--ink ds-stamp">{titleCase(edge.type)}</span>
                        <span class="ds-stamp ds-stamp--brass">Strength {edge.strength}</span>
                        {#if edge.families.length > 0}
                          <span class="ds-stamp ds-stamp--brass">{edge.families.map((family) => formatCoverageLabel(family)).join(", ")}</span>
                        {/if}
                      </div>
                      <div class="ds-edge-selections">{formatEdgeSelections(edge.selections)}</div>
                      <p class="ds-edge-explanation">{edge.explanation}</p>
                    </div>
                  {/each}
                </div>
              </details>
            {/if}
          {:else}
            <p class="ds-body ds-body--faint">No synergy edges were produced for this build.</p>
          {/if}
        </article>

        <div style="display:flex;flex-direction:column;gap:1rem">
          <article class="ds-parchment ds-panel">
            <div style="display:flex;align-items:baseline;justify-content:space-between;gap:1rem">
              <h3 class="ds-h3">Anti-Synergies</h3>
              <span class="ds-label">{data.detail.synergy.anti_synergies.length}</span>
            </div>
            <div class="ds-rule ds-rule--standalone"><span class="ds-rule__mark">❖</span></div>

            {#if data.detail.synergy.anti_synergies.length > 0}
              <div class="ds-chip-cloud" style="margin-top:0.4rem">
                {#each antiSynergyCounts as entry}
                  <span class="ds-stamp ds-stamp--blood">
                    {entry.name}{entry.count > 1 ? ` ×${entry.count}` : ""}
                  </span>
                {/each}
              </div>
              <details class="ds-discl">
                <summary>Detailed findings</summary>
                <div style="margin-top:0.8rem;display:flex;flex-direction:column;gap:0.6rem">
                  {#each data.detail.synergy.anti_synergies as anti}
                    <div class="ds-edge">
                      <div class="ds-label" style="color:var(--ds-blood)">{titleCase(anti.type)} &middot; {anti.severity}</div>
                      <p class="ds-edge-explanation" style="margin-top:0.4rem;color:var(--ds-ink)">{anti.reason}</p>
                    </div>
                  {/each}
                </div>
              </details>
            {:else}
              <p class="ds-body ds-body--faint">No anti-synergies flagged.</p>
            {/if}
          </article>

          <article class="ds-parchment ds-panel">
            <div style="display:flex;align-items:baseline;justify-content:space-between;gap:1rem">
              <h3 class="ds-h3">Isolated Picks</h3>
              <span class="ds-label">{data.detail.synergy.orphans.length}</span>
            </div>
            <div class="ds-rule ds-rule--standalone"><span class="ds-rule__mark">❖</span></div>

            {#if data.detail.synergy.orphans.length > 0}
              <div class="ds-chip-cloud" style="margin-top:0.4rem">
                {#each orphanCounts as orphan}
                  <span class="ds-stamp">
                    {orphan.name}{orphan.count > 1 ? ` ×${orphan.count}` : ""}
                  </span>
                {/each}
              </div>
              <details class="ds-discl">
                <summary>Reasons for isolation</summary>
                <div style="margin-top:0.8rem;display:flex;flex-direction:column;gap:0.6rem">
                  {#each data.detail.synergy.orphans as orphan}
                    <div class="ds-edge">
                      <div class="ds-edge-selections">{formatSelectionText(orphan.selection, selectionLabels)}</div>
                      <p class="ds-edge-explanation">{titleCase(orphan.reason)}</p>
                      <p class="ds-label" style="margin-top:0.2rem">
                        {orphan.resource ? `${orphan.resource} · ` : ""}{orphan.condition}
                      </p>
                    </div>
                  {/each}
                </div>
              </details>
            {:else}
              <p class="ds-body ds-body--faint">All selections participate in at least one synergy edge.</p>
            {/if}
          </article>
        </div>
      </div>

      <details class="ds-discl">
        <summary>Analytical coverage audit</summary>
        <article class="ds-parchment ds-panel" style="margin-top:0.8rem">
          <div class="ds-coverage-grid">
            <div class="ds-coverage-cell">
              <div class="ds-label">Calc Coverage</div>
              <div class="ds-coverage-cell__value">{formatCoverageFraction(data.detail.synergy.metadata.calc_coverage_pct)}</div>
            </div>
            <div class="ds-coverage-cell">
              <div class="ds-label">Entities Analyzed</div>
              <div class="ds-coverage-cell__value">{data.detail.synergy.metadata.entities_analyzed}</div>
            </div>
            <div class="ds-coverage-cell">
              <div class="ds-label">Entities With Calc</div>
              <div class="ds-coverage-cell__value">{data.detail.synergy.metadata.unique_entities_with_calc}</div>
            </div>
            <div class="ds-coverage-cell">
              <div class="ds-label">Opaque Conditions</div>
              <div class="ds-coverage-cell__value">{data.detail.synergy.metadata.opaque_conditions}</div>
            </div>
          </div>

          <div class="ds-coverage-grid" style="grid-template-columns:1fr;margin-top:1rem">
            <div class="ds-coverage-cell" style="background:rgba(26,15,8,0.05)">
              <div class="ds-label">Build Identity</div>
              <p class="ds-body" style="margin-top:0.55rem">{coverageLabels(data.detail.synergy.coverage.build_identity)}</p>
              <p class="ds-label" style="margin-top:0.4rem">Concentration {data.detail.synergy.coverage.concentration}</p>
            </div>
            <div class="ds-coverage-cell" style="background:rgba(26,15,8,0.05)">
              <div class="ds-label">Coverage Gaps</div>
              <p class="ds-body" style="margin-top:0.55rem">{coverageLabels(data.detail.synergy.coverage.coverage_gaps)}</p>
            </div>
            <div class="ds-coverage-cell" style="background:rgba(26,15,8,0.05)">
              <div class="ds-label">Slot Balance</div>
              <p class="ds-body" style="margin-top:0.55rem">
                Melee {data.detail.synergy.coverage.slot_balance.melee.strength} &middot; Ranged {data.detail.synergy.coverage.slot_balance.ranged.strength}
              </p>
            </div>
          </div>
        </article>
      </details>
    </section>

    <section class="ds-reveal ds-section">
      <header class="ds-section-heading">
        <div class="ds-section-heading__copy">
          <span class="ds-label ds-label--parchment">Assessment</span>
          <h2 class="ds-h2">Seven Dimensions &amp; Composite</h2>
        </div>
        <div class="ds-rule"><span class="ds-rule__mark">✠</span></div>
      </header>

      <details class="ds-discl">
        <summary>
          Composite {data.detail.summary.scores.composite} / 35 &middot; Grade {data.detail.summary.scores.grade} &middot; show full scorecard
        </summary>
        <div class="ds-dim-grid" style="margin-top:0.9rem">
          {#each dimensionCards as card}
            <article class="ds-parchment ds-dim-card">
              <div class="ds-label">{card.label}</div>
              <div class="ds-dim-card__head">
                <span class="ds-score {dsScoreColor(card.score, card.key === 'composite')}">{card.score ?? "\u2014"}</span>
                <span class="ds-numeral-max">/ {card.max}</span>
              </div>
              {#if card.explanation}
                <p class="ds-dim-card__note">{card.explanation}</p>
              {/if}
            </article>
          {/each}
        </div>
      </details>
    </section>

    <section class="ds-reveal ds-section">
      <header class="ds-section-heading">
        <div class="ds-section-heading__copy">
          <span class="ds-label ds-label--parchment">Machine-Verified</span>
          <h2 class="ds-h2">Cogitator &mdash; Breakpoint Matrix</h2>
        </div>
        <div class="ds-rule"><span class="ds-rule__mark">✠</span></div>
      </header>

      <div class="ds-cogitator-wrap">
        <div class="ds-cogitator-head">
          <div>
            <div class="ds-cogitator-title">Cogitator Output</div>
            <div class="ds-cogitator-subtitle">
              Slice &mdash; {titleCase(selectedScenario)} / {titleCase(selectedDifficulty)}
            </div>
          </div>

          <div class="ds-cogitator-controls">
            {#each availableScenarios as scenario}
              <button
                class="ds-cogitator-btn {selectedScenario === scenario ? 'ds-cogitator-btn--active' : ''}"
                onclick={() => (selectedScenario = scenario)}
                type="button"
              >
                {titleCase(scenario)}
              </button>
            {/each}
            <select
              bind:value={selectedDifficulty}
              class="ds-cogitator-select"
            >
              {#each DIFFICULTIES as difficulty}
                <option value={difficulty}>{titleCase(difficulty)}</option>
              {/each}
            </select>
          </div>
        </div>

        {#each breakpointPanels as panel (panel.entityId ?? panel.name)}
          {@const matrix = panel.weapon ? weaponMatrix(panel.weapon) : { breeds: [], rows: [] }}
          <div class="ds-cogitator-panel">
            <div class="ds-cogitator-panel-head">
              <div>
                <div class="ds-cogitator-weapon-name">{panel.name}</div>
                <div class="ds-cogitator-weapon-slot">{panel.slot ?? "unknown"} weapon</div>
              </div>
              <div class="ds-cogitator-meta">
                {panel.status === "unsupported" ? "Unsupported" : `${matrix.rows.length} action rows`}
              </div>
            </div>

            {#if panel.status === "supported" && panel.weapon && matrix.rows.length > 0 && matrix.breeds.length > 0}
              <div class="ds-cogitator-table-wrap">
                <table class="ds-cogitator-table">
                  <thead>
                    <tr>
                      <th>Action</th>
                      {#each matrix.breeds as breed}
                        <th>{titleCase(breed)}</th>
                      {/each}
                    </tr>
                  </thead>
                  <tbody>
                    {#each matrix.rows as row}
                      <tr>
                        <td><span class="ds-action-label">{row.label}</span></td>
                        {#each row.values as value}
                          <td>
                            <span class="ds-htk {dsHtkCell(value)}">{value ?? "\u2014"}</span>
                          </td>
                        {/each}
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {:else if panel.message}
              <p class="ds-cogitator-empty">{panel.message}</p>
            {:else}
              <p class="ds-cogitator-empty">No breakpoint data is available for this scenario/difficulty slice.</p>
            {/if}
          </div>
        {/each}
      </div>
    </section>
  </div>
</div>
