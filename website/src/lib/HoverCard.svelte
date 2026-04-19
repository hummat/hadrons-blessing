<script lang="ts">
  import type { PhaseAScoreHoverCard } from "$lib/hover/scorecard-cards";

  type Props = {
    card: PhaseAScoreHoverCard;
  };

  let { card }: Props = $props();

  function scoreColorClass(value: number | null, max: number): string {
    if (value == null) return "ds-score--null";
    if (max > 5) return "ds-score--composite";
    if (value >= 4) return "ds-score--high";
    if (value >= 3) return "ds-score--mid";
    if (value >= 2) return "ds-score--warn";
    return "ds-score--low";
  }
</script>

<details class="ds-parchment ds-dim-card ds-hovercard ds-hovercard--{card.tone}">
  <summary class="ds-hovercard__summary">
    <div class="ds-label">{card.label}</div>
    <div class="ds-dim-card__head">
      <span class="ds-score {scoreColorClass(card.score, card.max)}">{card.score ?? "—"}</span>
      <span class="ds-numeral-max">/ {card.max}</span>
    </div>
    {#if card.triggerNote}
      <p class="ds-dim-card__note">{card.triggerNote}</p>
    {/if}
  </summary>

  <div class="ds-hovercard__panel">
    <div class="ds-hovercard__head">
      <div>
        <div class="ds-hovercard__title">{card.title}</div>
        <div class="ds-hovercard__subtitle">{card.subtitle}</div>
      </div>
      <span class="ds-stamp ds-stamp--brass">{card.sourceLabel}</span>
    </div>

    <p class="ds-hovercard__summarycopy">{card.summary}</p>

    <dl class="ds-hovercard__facts">
      {#each card.facts as fact}
        <div class="ds-hovercard__fact">
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      {/each}
    </dl>
  </div>
</details>
