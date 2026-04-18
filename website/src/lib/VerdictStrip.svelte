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
  const risks: RiskBullet[] = $derived(buildRiskBullets(detail));

  function riskClass(kind: RiskBullet["kind"]): string {
    switch (kind) {
      case "low_dimension":
      case "gaps":
      case "anti_orphan":
      case "low_calc_coverage":
      case "scoring_unavailable":
      case "calc_coverage_missing":
        return "ds-risk-bullets__low";
      case "clean":
        return "ds-risk-bullets__clean";
      case "calc_coverage":
        return "ds-risk-bullets__calc";
    }
  }

  function scoreClass(score: number): string {
    if (score >= 5) return "ds-score--best";
    if (score >= 4) return "ds-score--good";
    if (score >= 3) return "ds-score--mid";
    if (score >= 2) return "ds-score--low";
    return "ds-score--worst";
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
            <span class="ds-score {scoreClass(strength.score)}">{strength.score}/5</span>
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
      {#each risks as risk (risk.kind + risk.text)}
        <li class={riskClass(risk.kind)}>{risk.text}</li>
      {/each}
    </ul>
  </article>
</div>
