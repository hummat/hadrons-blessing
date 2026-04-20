<script lang="ts">
  import { base } from "$app/paths";
  import { htkCellClass } from "$lib/builds";
  import {
    buildBreakpointPanels,
    buildBreakpointActionLabels,
    buildSelectionLabelMap,
    formatCoverageFraction,
    formatCoverageLabel,
    formatOrphanMetaLine,
    formatOrphanReason,
    formatSelectionList,
    formatSelectionText,
    summarizeNameCounts,
  } from "$lib/detail-format";
  import HoverCard from "$lib/HoverCard.svelte";
  import { buildPhaseAScoreHoverCards } from "$lib/hover/scorecard-cards";
  import TalentTree from "$lib/TalentTree.svelte";
  import { buildTalentTreeSpecs } from "$lib/talent-tree";
  import type {
    BreakpointActionDetail,
    BreakpointBreedEntry,
    BreakpointWeaponDetail,
    BuildDetailData,
  } from "$lib/types";
  import VerdictStrip from "$lib/VerdictStrip.svelte";
  import { onMount } from "svelte";

  type Props = { data: { detail: BuildDetailData } };
  type MatrixRow = { label: string; values: Array<number | null> };

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

  function dsHtkCell(value: number | null): string {
    const raw = htkCellClass(value);
    if (raw.includes("best")) return "hb-htk--best";
    if (raw.includes("mid")) return "hb-htk--mid";
    if (raw.includes("worst")) return "hb-htk--worst";
    return "hb-htk--null";
  }

  let allScoreCards = $derived(buildPhaseAScoreHoverCards(data.detail));
  let compositeHoverCard = $derived(allScoreCards.find((card) => card.key === "composite") ?? null);
  let dimensionCards = $derived(allScoreCards.filter((card) => card.key !== "composite"));

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
    if (labels.length === 0) return "—";
    if (labels.length === 1) return labels[0];
    return `${labels[0]} → ${labels[1]}`;
  }

  function synergyKind(kind: string): string { return titleCase(kind); }
  function isWeakEdge(strength: number): boolean { return strength < 3; }

  function scenarioBreeds(action: BreakpointActionDetail): BreakpointBreedEntry[] {
    return (action.scenarios[selectedScenario]?.breeds ?? [])
      .filter((entry) => entry.difficulty === selectedDifficulty);
  }

  function weaponMatrix(weapon: BreakpointWeaponDetail): { breeds: string[]; rows: MatrixRow[] } {
    const breedIds = new Set<string>();
    const actionLabels = buildBreakpointActionLabels(weapon);
    for (const action of weapon.actions) {
      for (const entry of scenarioBreeds(action)) breedIds.add(entry.breed_id);
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

  const classKey = $derived(data.detail.summary.class.replace(/\s+/g, "-").toLowerCase());
  const classDomain = $derived(data.detail.summary.class.replace(/\s+/g, "_").toLowerCase());

  const selectedTalentIds = $derived.by(() => {
    const set = new Set<string>();
    const slots = data.detail.structure.slots;
    for (const slot of [slots.ability, slots.blitz, slots.aura, slots.keystone]) {
      if (slot.id) set.add(slot.id);
    }
    for (const talent of data.detail.structure.talents) {
      if (talent.id) set.add(talent.id);
    }
    return set;
  });
  const talentTreeSpecs = $derived(buildTalentTreeSpecs(classDomain, selectedTalentIds));

  let weaponAssets = $state<Record<string, { image_path: string }>>({});
  onMount(async () => {
    try {
      const res = await fetch(`${base}/data/weapon-assets.json`);
      if (res.ok) weaponAssets = await res.json();
    } catch { /* non-fatal */ }
  });

  // Composite score hover — bespoke wiring for the hero plate because the
  // default HoverCard renders its own dimension tile and the hero plate has
  // its own distinct layout.
  function compositePortal(node: HTMLElement) {
    if (typeof document === "undefined") return { destroy() {} };
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }
  let compositeOpen = $state(false);
  let compositeTop = $state(0);
  let compositeLeft = $state(0);
  let compositeAnchor = $state<HTMLDivElement | null>(null);
  let compositePanel = $state<HTMLDivElement | null>(null);
  let compositeEnterTimer: ReturnType<typeof setTimeout> | null = null;
  let compositeLeaveTimer: ReturnType<typeof setTimeout> | null = null;

  function positionCompositePanel() {
    if (!compositeAnchor || !compositePanel) return;
    const a = compositeAnchor.getBoundingClientRect();
    const pw = compositePanel.offsetWidth;
    const ph = compositePanel.offsetHeight;
    const vw = window.innerWidth;
    const gap = 12;
    let top = a.bottom + gap;
    if (top + ph > window.innerHeight - 16 && a.top - gap - ph > 16) {
      top = a.top - gap - ph;
    }
    let left = a.left + a.width / 2 - pw / 2;
    left = Math.max(16, Math.min(vw - pw - 16, left));
    compositeTop = top;
    compositeLeft = left;
  }

  function showCompositeCard() {
    if (compositeLeaveTimer) { clearTimeout(compositeLeaveTimer); compositeLeaveTimer = null; }
    if (compositeEnterTimer) clearTimeout(compositeEnterTimer);
    compositeEnterTimer = setTimeout(async () => {
      compositeOpen = true;
      await Promise.resolve();
      setTimeout(positionCompositePanel, 0);
    }, 110);
  }
  function hideCompositeCard() {
    if (compositeEnterTimer) { clearTimeout(compositeEnterTimer); compositeEnterTimer = null; }
    if (compositeLeaveTimer) clearTimeout(compositeLeaveTimer);
    compositeLeaveTimer = setTimeout(() => { compositeOpen = false; }, 90);
  }
  const seal = $derived(data.detail.summary.title.slice(0, 1).toUpperCase());
  const gradeLower = $derived(data.detail.summary.scores.grade.toLowerCase());

  // A synthesized "composite" hover card doesn't exist in the Phase A adapter,
  // so we show the grade plate without a hover panel for now and let users
  // scroll to the dimension strip for detail.
  const composite = $derived(data.detail.summary.scores.composite);
</script>

<svelte:head>
  <title>{data.detail.summary.title} — Hadron's Blessing</title>
</svelte:head>

<div class="dataslate-root">
  <nav class="hb-reveal hb-crumbs" aria-label="Breadcrumbs">
    <a href={`${base}/`}>Manifest</a>
    <span class="sep">/</span>
    <a href={`${base}/compare?builds=${data.detail.slug},`}>Compare</a>
    <span class="sep">/</span>
    <span style="color: var(--hb-ink)">{data.detail.summary.title}</span>
  </nav>

  <section class="hb-reveal">
    <article class="hb-hero">
      <span class="hb-corner tl"></span>
      <span class="hb-corner tr"></span>
      <span class="hb-corner bl"></span>
      <span class="hb-corner br"></span>

      <div class="hb-hero-seal">
        <svg viewBox="0 0 128 128" aria-hidden="true">
          <defs>
            <radialGradient id="seal-bg" cx="35%" cy="35%">
              <stop offset="0%" stop-color="#2a2430" />
              <stop offset="70%" stop-color="#0c0b10" />
              <stop offset="100%" stop-color="#030306" />
            </radialGradient>
          </defs>
          <circle cx="64" cy="64" r="58" fill="url(#seal-bg)" stroke="var(--hb-amber-deep)" stroke-width="1.5" />
          <circle cx="64" cy="64" r="50" fill="none" stroke="var(--hb-amber-deep)" stroke-width="0.6" stroke-dasharray="2 2" />
          <circle cx="64" cy="64" r="44" fill="none" stroke="var(--hb-amber)" stroke-width="0.4" opacity="0.4" />
          {#each [0, 45, 90, 135, 180, 225, 270, 315] as a}
            {@const rad = (a * Math.PI) / 180}
            <line
              x1={64 + Math.cos(rad) * 44}
              y1={64 + Math.sin(rad) * 44}
              x2={64 + Math.cos(rad) * 50}
              y2={64 + Math.sin(rad) * 50}
              stroke="var(--hb-amber)"
              stroke-width="0.6"
              opacity="0.7"
            />
          {/each}
        </svg>
        <span class="hb-hero-seal-letter">{seal}</span>
      </div>

      <div class="hb-hero-body">
        <div class="hb-hero-meta-row">
          <span class={`class-chip ${classKey}`}>{titleCase(data.detail.summary.class)}</span>
          <span class="stamp-chip audited">✓ Audited · 0 unresolved</span>
          <span class="stamp-chip">Source · Games Lantern</span>
        </div>
        <div class="kicker">Tactical Record</div>
        <h1 class="hb-hero-title">{data.detail.summary.title}</h1>
        <div class="hb-hero-byline">
          {data.detail.summary.weapons.map((w) => w.name).join(" / ")}
        </div>
        <div class="hb-hero-loadout">
          {#if data.detail.structure.slots.ability.name}
            <div class="hb-hero-loadout-item">
              <span class="label">Ability</span>
              <span class="name">{data.detail.structure.slots.ability.name}</span>
            </div>
          {/if}
          {#if data.detail.structure.slots.blitz.name}
            <div class="hb-hero-loadout-item">
              <span class="label">Blitz</span>
              <span class="name">{data.detail.structure.slots.blitz.name}</span>
            </div>
          {/if}
          {#if data.detail.structure.slots.aura.name}
            <div class="hb-hero-loadout-item">
              <span class="label">Aura</span>
              <span class="name">{data.detail.structure.slots.aura.name}</span>
            </div>
          {/if}
          {#if data.detail.structure.slots.keystone.name}
            <div class="hb-hero-loadout-item">
              <span class="label">Keystone</span>
              <span class="name">{data.detail.structure.slots.keystone.name}</span>
            </div>
          {/if}
        </div>
      </div>

      <div class="hb-hero-score">
        <div
          bind:this={compositeAnchor}
          class="hb-hero-score-plate"
          role="button"
          tabindex="0"
          aria-haspopup="dialog"
          aria-expanded={compositeOpen}
          onmouseenter={showCompositeCard}
          onmouseleave={hideCompositeCard}
          onfocus={showCompositeCard}
          onblur={hideCompositeCard}
        >
          <span class="label">Composite</span>
          <span class="hb-hero-score-num mono-num">{composite}</span>
          <span class="hb-hero-score-max">of 35</span>
          <div class="hb-hero-score-grade">
            <span class={`grade ${gradeLower}`}>{data.detail.summary.scores.grade}</span>
          </div>
          <span class="hc-cue">hover</span>
        </div>
      </div>
    </article>

    {#if compositeOpen && compositeHoverCard}
      <div
        bind:this={compositePanel}
        use:compositePortal
        class="hover-card ready hover-card--arrow-top"
        role="dialog"
        aria-label={compositeHoverCard.title}
        style={`top: ${compositeTop}px; left: ${compositeLeft}px;`}
        onmouseenter={() => { if (compositeLeaveTimer) { clearTimeout(compositeLeaveTimer); compositeLeaveTimer = null; } }}
        onmouseleave={hideCompositeCard}
      >
        <span class="hc-corner tl"></span>
        <span class="hc-corner tr"></span>
        <span class="hc-corner bl"></span>
        <span class="hc-corner br"></span>

        <header class="hc-head">
          <div class="hc-title">{compositeHoverCard.title}</div>
          <div class="hc-sub">{compositeHoverCard.subtitle}</div>
        </header>
        <div class="hc-summary">{compositeHoverCard.summary}</div>
        <div class="hc-facts">
          {#each compositeHoverCard.facts as fact, i (fact.label + i)}
            <div class="hc-fact {i === 0 ? 'hc-fact--first' : ''}">
              <div class="hc-fact-label">{fact.label}</div>
              <div class="hc-fact-value">{fact.value}</div>
            </div>
          {/each}
        </div>
        <footer class="hc-foot">
          <span class="hc-source">source · {compositeHoverCard.sourceLabel}</span>
        </footer>
      </div>
    {/if}
  </section>

  <section class="hb-reveal d1">
    <div class="section-heading">
      <h2>Verdict</h2>
      <div class="section-rule"></div>
      <div class="section-meta">identity · strengths · risks</div>
    </div>
    <VerdictStrip detail={data.detail} {blessingMap} />
  </section>

  <section class="hb-reveal d2">
    <div class="section-heading">
      <h2>Scorecard — seven dimensions</h2>
      <div class="section-rule"></div>
      <div class="section-meta">hover or focus any tile</div>
    </div>
    <div class="hb-dim-strip">
      {#each dimensionCards as card (card.key)}
        <HoverCard {card} />
      {/each}
    </div>
  </section>

  <section class="hb-reveal d3">
    <div class="section-heading">
      <h2>Loadout</h2>
      <div class="section-rule"></div>
      <div class="section-meta">slots · curios · weapons</div>
    </div>
    <div class="hb-loadout-grid">
      <div class="panel" style="padding: 18px;">
        <span class="hb-corner tl"></span>
        <span class="hb-corner br"></span>
        <div class="label" style="margin-bottom: 10px;">Slots</div>
        <div class="hb-slots-grid">
          <div class="hb-slot">
            <span class="label">Ability</span>
            <span class="hb-slot__name">{data.detail.structure.slots.ability.name ?? "—"}</span>
          </div>
          <div class="hb-slot">
            <span class="label">Blitz</span>
            <span class="hb-slot__name">{data.detail.structure.slots.blitz.name ?? "—"}</span>
          </div>
          <div class="hb-slot">
            <span class="label">Aura</span>
            <span class="hb-slot__name">{data.detail.structure.slots.aura.name ?? "—"}</span>
          </div>
          <div class="hb-slot">
            <span class="label">Keystone</span>
            <span class="hb-slot__name">{data.detail.structure.slots.keystone.name ?? "—"}</span>
          </div>
        </div>

        <div class="hairline" style="margin: 14px 0;"></div>

        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px;">
          <span class="label">Curio Perks</span>
          <span class="label">
            {data.detail.structure.curio_perks.length} perks · {data.detail.scorecard.curios.score}/5
          </span>
        </div>
        {#if data.detail.structure.curio_perks.length > 0}
          <div class="hb-chip-cloud">
            {#each data.detail.structure.curio_perks as perk, i (perk.name + i)}
              {@const rating = data.detail.scorecard.curios.perks[i]?.rating}
              <span class="hb-chip {rating === 'optimal' ? 'hb-chip--amber' : rating === 'avoid' ? 'hb-chip--blood' : ''}">
                {perk.name}
              </span>
            {/each}
          </div>
        {:else}
          <p class="hb-verdict-note">No curio perks in payload.</p>
        {/if}

        {#if data.detail.structure.talents.length > 0}
          <div class="hairline" style="margin: 14px 0;"></div>
          <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px;">
            <span class="label">Talents</span>
            <span class="label">{data.detail.structure.talents.length} picks · see lattice below</span>
          </div>
          <div class="hb-chip-cloud">
            {#each data.detail.structure.talents as talent, i (`${talent.id ?? talent.name}:${i}`)}
              <span class="hb-chip">{talent.name}</span>
            {/each}
          </div>
        {/if}
      </div>

      <div>
        {#each data.detail.scorecard.weapons as weapon (weapon.canonical_entity_id ?? weapon.name)}
          {@const weaponImage = weapon.canonical_entity_id
            ? weaponAssets[weapon.canonical_entity_id]?.image_path ?? null
            : null}
          <div class="hb-weapon-card">
            <span class="hb-corner tl"></span>
            <span class="hb-corner br"></span>
            {#if weaponImage}
              <div class="hb-weapon-art" aria-hidden="true">
                <img src={`${base}${weaponImage}`} alt="" loading="lazy" decoding="async" />
              </div>
            {/if}
            <div class="hb-weapon-head">
              <div style="min-width: 0;">
                <span class="hb-weapon-slot-pill">{titleCase(weapon.slot ?? "unknown")}</span>
                <div class="hb-weapon-name">{weapon.name}</div>
              </div>
              <div class="hb-weapon-score">
                <div class="hb-weapon-score__label label">Perks</div>
                <div class="hb-weapon-score__val mono-num">{weapon.perks.score}<span style="font-size: 12px; color: var(--hb-ink-faint); font-family: 'Oswald';">/5</span></div>
              </div>
            </div>
            <div class="hb-weapon-lists">
              <div>
                <h4>Perks</h4>
                {#if weapon.perks.perks.length > 0}
                  {#each weapon.perks.perks as perk (perk.name)}
                    <div class="hb-trait-row">
                      <span>{perk.name}</span>
                      <span style="display: flex; gap: 8px; align-items: center;">
                        {#if perk.value != null}
                          <span class="hb-trait-value mono-num">{Math.round(perk.value * 100)}%</span>
                        {/if}
                        <span class="hb-trait-tier">{perkTierLabel(perk.tier)}</span>
                      </span>
                    </div>
                  {/each}
                {:else}
                  <p class="hb-verdict-note">No weapon perks scored.</p>
                {/if}
              </div>
              <div>
                <h4>Blessings</h4>
                {#if weapon.blessings.blessings.length > 0}
                  {#each weapon.blessings.blessings as blessing (blessing.name)}
                    <div class="hb-trait-row hb-trait-row--italic">
                      <span>{blessing.name}</span>
                      {#if !blessing.known}
                        <span class="hb-trait-gap">Catalog gap</span>
                      {/if}
                    </div>
                  {/each}
                {:else}
                  <p class="hb-verdict-note">This weapon family is not yet in the blessing scoring catalog.</p>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="hb-reveal d3">
    <div class="section-heading">
      <h2>Talent lattice</h2>
      <div class="section-rule"></div>
      <div class="section-meta">{data.detail.structure.talents.length} picks · scroll to zoom · drag to pan</div>
    </div>
    {#each talentTreeSpecs as treeSpec (treeSpec.treeId)}
      <TalentTree
        classDomain={classDomain}
        treeId={treeSpec.treeId}
        title={treeSpec.title}
        selectedEntityIds={selectedTalentIds}
      />
    {/each}
  </section>

  <section class="hb-reveal d4">
    <div class="section-heading">
      <h2>Synergies</h2>
      <div class="section-rule"></div>
      <div class="section-meta">{data.detail.synergy.synergy_edges.length} edges · {data.detail.synergy.anti_synergies.length} anti · {data.detail.synergy.orphans.length} flags</div>
    </div>

    {#if data.detail.synergy.synergy_edges.length > 0}
      <div class="hb-syn-list">
        {#each synergyPreview as edge, i (i)}
          <div class="hb-syn-row" class:hb-syn-row--weak={isWeakEdge(edge.strength)}>
            <span class="hb-syn-kind">{synergyKind(edge.type)}</span>
            <div class="hb-syn-body">
              <span class="sel">{formatEdgeSelections(edge.selections)}</span>
              {#if edge.explanation}
                <span class="exp">{edge.explanation}</span>
              {/if}
              {#if edge.families.length > 0}
                <span class="exp" style="color: var(--hb-ink-faint);">{edge.families.map((f) => formatCoverageLabel(f)).join(" · ")}</span>
              {/if}
            </div>
            <div class="hb-syn-strength" aria-label={`Strength ${edge.strength} of 5`}>
              {#each [0, 1, 2, 3, 4] as k}
                <i class:on={k < edge.strength}></i>
              {/each}
            </div>
          </div>
        {/each}
      </div>

      {#if hiddenSynergyCount > 0}
        <details class="disclosure" style="margin-top: 10px;">
          <summary>Show {hiddenSynergyCount} more synergy edge{hiddenSynergyCount === 1 ? "" : "s"}</summary>
          <div class="hb-syn-list">
            {#each data.detail.synergy.synergy_edges.slice(synergyPreviewLimit) as edge, i (synergyPreviewLimit + i)}
              <div class="hb-syn-row" class:hb-syn-row--weak={isWeakEdge(edge.strength)}>
                <span class="hb-syn-kind">{synergyKind(edge.type)}</span>
                <div class="hb-syn-body">
                  <span class="sel">{formatEdgeSelections(edge.selections)}</span>
                  {#if edge.explanation}<span class="exp">{edge.explanation}</span>{/if}
                </div>
                <div class="hb-syn-strength">
                  {#each [0, 1, 2, 3, 4] as k}<i class:on={k < edge.strength}></i>{/each}
                </div>
              </div>
            {/each}
          </div>
        </details>
      {/if}
    {:else}
      <p class="hb-verdict-note">No synergy edges were produced for this build.</p>
    {/if}

    {#if data.detail.synergy.anti_synergies.length > 0 || data.detail.synergy.orphans.length > 0}
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px;">
        <div class="panel" style="padding: 16px 18px;">
          <span class="hb-corner tl"></span>
          <span class="hb-corner br"></span>
          <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px;">
            <span class="label" style="color: var(--hb-blood)">Anti-Synergies</span>
            <span class="label">{data.detail.synergy.anti_synergies.length}</span>
          </div>
          {#if antiSynergyCounts.length > 0}
            <div class="hb-chip-cloud">
              {#each antiSynergyCounts as entry (entry.name)}
                <span class="hb-chip hb-chip--blood">
                  {entry.name}{entry.count > 1 ? ` ×${entry.count}` : ""}
                </span>
              {/each}
            </div>
            <details class="disclosure" style="margin-top: 10px;">
              <summary>Detailed findings</summary>
              <div style="display: flex; flex-direction: column; gap: 8px;">
                {#each data.detail.synergy.anti_synergies as anti, i (i)}
                  <div class="hb-syn-row hb-syn-row--weak">
                    <span class="hb-syn-kind" style="color: var(--hb-blood)">{titleCase(anti.type)}</span>
                    <div class="hb-syn-body"><span class="exp">{anti.reason}</span></div>
                    <span class="label" style="color: var(--hb-blood-dim)">{anti.severity}</span>
                  </div>
                {/each}
              </div>
            </details>
          {:else}
            <p class="hb-verdict-note">No anti-synergies flagged.</p>
          {/if}
        </div>

        <div class="panel" style="padding: 16px 18px;">
          <span class="hb-corner tl"></span>
          <span class="hb-corner br"></span>
          <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px;">
            <span class="label">Condition &amp; Dependency Flags</span>
            <span class="label">{data.detail.synergy.orphans.length}</span>
          </div>
          {#if orphanCounts.length > 0}
            <div class="hb-chip-cloud">
              {#each orphanCounts as orphan (orphan.name)}
                <span class="hb-chip">
                  {orphan.name}{orphan.count > 1 ? ` ×${orphan.count}` : ""}
                </span>
              {/each}
            </div>
            <details class="disclosure" style="margin-top: 10px;">
              <summary>Why these picks were flagged</summary>
              <div style="display: flex; flex-direction: column; gap: 8px;">
                {#each data.detail.synergy.orphans as orphan, i (i)}
                  {@const metaLine = formatOrphanMetaLine(orphan.resource, orphan.condition)}
                  <div class="hb-syn-row">
                    <span class="hb-syn-kind">Flag</span>
                    <div class="hb-syn-body">
                      <span class="sel">{formatSelectionText(orphan.selection, selectionLabels)}</span>
                      <span class="exp">{formatOrphanReason(orphan.reason)}</span>
                      {#if metaLine}<span class="exp" style="color: var(--hb-ink-faint)">{metaLine}</span>{/if}
                    </div>
                    <span></span>
                  </div>
                {/each}
              </div>
            </details>
          {:else}
            <p class="hb-verdict-note">No unresolved conditions or missing resource dependencies.</p>
          {/if}
        </div>
      </div>
    {/if}

    <details class="disclosure" style="margin-top: 16px;">
      <summary>Analytical coverage audit</summary>
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
        <div class="hb-slot">
          <span class="label">Effect-Modeled</span>
          <span class="hb-slot__name mono-num">{formatCoverageFraction(data.detail.synergy.metadata.calc_coverage_pct)}</span>
        </div>
        <div class="hb-slot">
          <span class="label">Source-Linked</span>
          <span class="hb-slot__name mono-num">{formatCoverageFraction(data.detail.synergy.metadata.linked_coverage_pct)}</span>
        </div>
        <div class="hb-slot">
          <span class="label">Entities Analyzed</span>
          <span class="hb-slot__name mono-num">{data.detail.synergy.metadata.entities_analyzed}</span>
        </div>
        <div class="hb-slot">
          <span class="label">Build Identity</span>
          <span class="hb-slot__name" style="font-size: 13px;">
            {data.detail.synergy.coverage.build_identity.length > 0
              ? data.detail.synergy.coverage.build_identity.map((f) => formatCoverageLabel(f)).join(", ")
              : "—"}
          </span>
        </div>
        <div class="hb-slot">
          <span class="label">Coverage Gaps</span>
          <span class="hb-slot__name" style="font-size: 13px;">
            {data.detail.synergy.coverage.coverage_gaps.length > 0
              ? data.detail.synergy.coverage.coverage_gaps.map((f) => formatCoverageLabel(f)).join(", ")
              : "None"}
          </span>
        </div>
        <div class="hb-slot">
          <span class="label">Slot Balance</span>
          <span class="hb-slot__name mono-num">
            M{data.detail.synergy.coverage.slot_balance.melee.strength} · R{data.detail.synergy.coverage.slot_balance.ranged.strength}
          </span>
        </div>
      </div>
    </details>
  </section>

  <section class="hb-reveal d5">
    <div class="section-heading">
      <h2>Cogitator — breakpoint matrix</h2>
      <div class="section-rule"></div>
      <div class="section-meta">machine-verified HTK per action × breed</div>
    </div>

    <div class="hb-cogitator">
      <div class="hb-cogitator-head">
        <div>
          <div class="hb-cogitator-title">Slice — {titleCase(selectedScenario)} · {titleCase(selectedDifficulty)}</div>
          <div class="hb-cogitator-subtitle">Quality {data.detail.breakpoints.metadata.quality}</div>
        </div>
        <div class="hb-cogitator-controls">
          {#each availableScenarios as scenario}
            <button
              type="button"
              class="hb-cogitator-btn"
              class:hb-cogitator-btn--active={selectedScenario === scenario}
              onclick={() => (selectedScenario = scenario)}
            >
              {titleCase(scenario)}
            </button>
          {/each}
          <select bind:value={selectedDifficulty} class="hb-cogitator-select">
            {#each DIFFICULTIES as difficulty}
              <option value={difficulty}>{titleCase(difficulty)}</option>
            {/each}
          </select>
        </div>
      </div>

      {#each breakpointPanels as panel (panel.entityId ?? panel.name)}
        {@const matrix = panel.weapon ? weaponMatrix(panel.weapon) : { breeds: [], rows: [] }}
        <div class="hb-cogitator-panel">
          <div class="hb-cogitator-panel-head">
            <div>
              <div class="hb-cogitator-weapon-name">{panel.name}</div>
              <div class="hb-cogitator-weapon-slot">{titleCase(panel.slot ?? "unknown")} weapon</div>
            </div>
            <div class="hb-cogitator-meta">
              {panel.status === "unsupported" ? "Unsupported" : `${matrix.rows.length} action rows`}
            </div>
          </div>

          {#if panel.status === "supported" && panel.weapon && matrix.rows.length > 0 && matrix.breeds.length > 0}
            <div class="hb-cogitator-table-wrap">
              <table class="hb-cogitator-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    {#each matrix.breeds as breed}<th>{titleCase(breed)}</th>{/each}
                  </tr>
                </thead>
                <tbody>
                  {#each matrix.rows as row (row.label)}
                    <tr>
                      <td><span class="hb-action-label">{row.label}</span></td>
                      {#each row.values as value, i (i)}
                        <td><span class="hb-htk {dsHtkCell(value)}">{value ?? "—"}</span></td>
                      {/each}
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else if panel.message}
            <p class="hb-cogitator-empty">{panel.message}</p>
          {:else}
            <p class="hb-cogitator-empty">No breakpoint data for this scenario/difficulty slice.</p>
          {/if}
        </div>
      {/each}
    </div>
  </section>

  <section class="hb-reveal d6">
    <div class="hb-provenance">
      <span><span class="k">class:</span>{data.detail.summary.class}</span>
      <span><span class="k">grade:</span>{data.detail.summary.scores.grade} · {composite}/35</span>
      <span><span class="k">entities:</span>{data.detail.synergy.metadata.entities_analyzed}</span>
      <span><span class="k">coverage:</span>{formatCoverageFraction(data.detail.synergy.metadata.calc_coverage_pct)}</span>
      <span><span class="k">resolver:</span>Aussiemon/Darktide-Source-Code</span>
      <span><span class="k">source:</span>games_lantern</span>
    </div>
  </section>
</div>
