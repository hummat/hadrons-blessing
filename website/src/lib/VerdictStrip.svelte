<script lang="ts">
  import type { BuildDetailData } from "./types.ts";
  import { formatCoverageLabel, rewriteExplanation } from "./detail-format.ts";
  import { selectSignatureStrengths, buildRiskBullets, type RiskBullet } from "./verdict.ts";

  type Props = {
    detail: BuildDetailData;
    blessingMap: Record<string, string>;
  };
  let { detail, blessingMap }: Props = $props();

  const identity = $derived(detail.synergy.coverage.build_identity);
  const slotBalance = $derived(detail.synergy.coverage.slot_balance);
  const concentration = $derived(detail.synergy.coverage.concentration);
  const strengths = $derived(
    selectSignatureStrengths(detail.scorecard.qualitative, detail.summary.scores).map((strength) => ({
      ...strength,
      explanation: rewriteExplanation(strength.key, strength.explanation, blessingMap),
    })),
  );
  const risks: RiskBullet[] = $derived(buildRiskBullets(detail, blessingMap));

  function strengthBar(score: number): string {
    const filled = Math.max(0, Math.min(5, Math.round(score)));
    return "▰".repeat(filled) + "▱".repeat(5 - filled);
  }

  function riskLiClass(kind: RiskBullet["kind"]): string {
    if (kind === "clean") return "clean";
    if (kind === "calc_coverage") return "info";
    return "";
  }

  const identityLabel = $derived(
    identity.length > 0 ? identity.map((family) => formatCoverageLabel(family)).join(" · ") : "Undefined role",
  );
</script>

<div class="hb-verdict">
  <article class="panel hb-verdict-tile">
    <span class="hb-corner tl"></span>
    <span class="hb-corner br"></span>
    <div class="hb-verdict-head">
      <h3>Identity</h3>
      <span class="label label-amber">Role</span>
    </div>
    <div class="hb-verdict-body">{identityLabel}</div>
    <div class="hb-verdict-note">
      Melee {slotBalance.melee.strength} · Ranged {slotBalance.ranged.strength} · concentration {concentration}
    </div>
  </article>

  <article class="panel hb-verdict-tile">
    <span class="hb-corner tl"></span>
    <span class="hb-corner br"></span>
    <div class="hb-verdict-head">
      <h3>Strengths</h3>
      <span class="label" style="color: var(--hb-sanct)">{strengths.length} pillars</span>
    </div>
    {#if strengths.length > 0}
      <div style="display: flex; flex-direction: column; gap: 2px;">
        {#each strengths as strength (strength.key)}
          <div class="hb-verdict-line">
            <span>{strength.label}</span>
            <span class="val">{strengthBar(strength.score)}</span>
          </div>
          {#if strength.explanation}
            <div class="hb-verdict-note" style="margin: 2px 0 6px;">{strength.explanation}</div>
          {/if}
        {/each}
      </div>
    {:else}
      <p class="hb-verdict-note">No qualitative dimensions scored.</p>
    {/if}
  </article>

  <article class="panel hb-verdict-tile">
    <span class="hb-corner tl"></span>
    <span class="hb-corner br"></span>
    <div class="hb-verdict-head">
      <h3>Risks</h3>
      <span class="label" style="color: var(--hb-blood)">{risks.length} flags</span>
    </div>
    {#if risks.length > 0}
      <ul class="hb-risk-list">
        {#each risks as risk (risk.kind + risk.text)}
          <li class={riskLiClass(risk.kind)}>{risk.text}</li>
        {/each}
      </ul>
    {:else}
      <p class="hb-verdict-note">No risks flagged.</p>
    {/if}
  </article>
</div>
