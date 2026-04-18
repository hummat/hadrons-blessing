<script lang="ts">
  import type { BuildDetailData } from "./types.ts";
  import { formatCoverageLabel } from "./detail-format.ts";
  import { selectSignatureStrengths, buildRiskBullets, type RiskBullet } from "./verdict.ts";

  type Props = { detail: BuildDetailData };
  let { detail }: Props = $props();

  const identity = $derived(detail.synergy.coverage.build_identity);
  const slotBalance = $derived(detail.synergy.coverage.slot_balance);
  const concentration = $derived(detail.synergy.coverage.concentration);
  const strengths = $derived(selectSignatureStrengths(detail.scorecard.qualitative, detail.summary.scores));
  const risks: RiskBullet[] = $derived(buildRiskBullets(detail));

  function riskClass(kind: RiskBullet["kind"]): string {
    if (kind === "low_dimension") return "ds-risk-bullets__low";
    if (kind === "clean") return "ds-risk-bullets__clean";
    if (kind === "calc_coverage") return "ds-risk-bullets__calc";
    return "";
  }

  const identityLabel = $derived(
    identity.length > 0 ? identity.map((family) => formatCoverageLabel(family)).join(" \u00b7 ") : "Undefined role",
  );
</script>

<div class="ds-verdict">
  <article class="ds-parchment ds-verdict-tile">
    <span class="ds-corner ds-corner--tl"></span>
    <span class="ds-corner ds-corner--br"></span>
    <span class="ds-label">Role Fingerprint</span>
    <div class="ds-verdict-tile__primary">{identityLabel}</div>
    <div class="ds-verdict-tile__secondary">
      Melee {slotBalance.melee.strength} &middot; Ranged {slotBalance.ranged.strength}
    </div>
    <div class="ds-verdict-tile__caption">Concentration {concentration}</div>
  </article>

  <article class="ds-parchment ds-verdict-tile">
    <span class="ds-corner ds-corner--tl"></span>
    <span class="ds-corner ds-corner--br"></span>
    <span class="ds-label">Signature Strengths</span>
    {#if strengths.length > 0}
      {#each strengths as strength (strength.key)}
        <div>
          <div class="ds-verdict-tile__strength-line">
            <span>{strength.label}</span>
            <span class="ds-score ds-score--mid">{strength.score}/5</span>
          </div>
          {#if strength.explanation}
            <p class="ds-verdict-tile__strength-note">{strength.explanation}</p>
          {/if}
        </div>
      {/each}
    {:else}
      <p class="ds-verdict-tile__strength-note">No qualitative dimensions scored.</p>
    {/if}
  </article>

  <article class="ds-parchment ds-verdict-tile">
    <span class="ds-corner ds-corner--tl"></span>
    <span class="ds-corner ds-corner--br"></span>
    <span class="ds-label">Noted Risks</span>
    <ul class="ds-risk-bullets">
      {#each risks as risk, i (i)}
        <li class={riskClass(risk.kind)}>{risk.text}</li>
      {/each}
    </ul>
  </article>
</div>
