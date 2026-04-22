<script module lang="ts">
  let activeCloser: (() => void) | null = null;
</script>

<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import type { PhaseAScoreHoverCard } from "$lib/hover/scorecard-cards";

  // Portal action — moves the element to document.body so position: fixed
  // escapes any transformed/animated ancestor (e.g. .hb-reveal).
  function portal(node: HTMLElement) {
    if (typeof document === "undefined") return { destroy() {} };
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }

  type Props = { card: PhaseAScoreHoverCard };
  let { card }: Props = $props();

  let triggerEl = $state<HTMLButtonElement | null>(null);
  let panelEl = $state<HTMLDivElement | null>(null);
  let open = $state(false);
  let top = $state(0);
  let left = $state(0);
  let arrow = $state<"top" | "bottom">("top");
  let ready = $state(false);

  let enterTimer: ReturnType<typeof setTimeout> | null = null;
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;

  const close = () => {
    open = false;
    ready = false;
    if (activeCloser === close) activeCloser = null;
  };

  function show() {
    if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
    if (enterTimer) clearTimeout(enterTimer);
    enterTimer = setTimeout(async () => {
      if (activeCloser && activeCloser !== close) activeCloser();
      activeCloser = close;
      open = true;
      await tick();
      reposition();
    }, 110);
  }

  function hide() {
    if (enterTimer) { clearTimeout(enterTimer); enterTimer = null; }
    if (leaveTimer) clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => { close(); }, 90);
  }

  function reposition() {
    if (!triggerEl || !panelEl) return;
    const a = triggerEl.getBoundingClientRect();
    const pw = panelEl.offsetWidth;
    const ph = panelEl.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 12;

    let nextTop = a.bottom + gap;
    let nextArrow: "top" | "bottom" = "top";
    if (nextTop + ph > vh - 16 && a.top - gap - ph > 16) {
      nextTop = a.top - gap - ph;
      nextArrow = "bottom";
    }
    let nextLeft = a.left + a.width / 2 - pw / 2;
    nextLeft = Math.max(16, Math.min(vw - pw - 16, nextLeft));

    top = nextTop;
    left = nextLeft;
    arrow = nextArrow;
    ready = true;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open) close(); else show();
    } else if (e.key === "Escape" && open) {
      close();
    }
  }

  function onWindowKey(e: KeyboardEvent) {
    if (e.key === "Escape" && open) close();
  }

  function onScrollOrResize() {
    if (open) reposition();
  }

  $effect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("keydown", onWindowKey);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("keydown", onWindowKey);
    };
  });

  onDestroy(() => {
    if (activeCloser === close) activeCloser = null;
    if (enterTimer) clearTimeout(enterTimer);
    if (leaveTimer) clearTimeout(leaveTimer);
  });

  function toneClass(score: number | null, max: number): string {
    if (score == null) return "hb-dim-tile--null";
    const pct = score / max;
    if (pct >= 0.85) return "hb-dim-tile--high";
    if (pct >= 0.65) return "hb-dim-tile--mid";
    if (pct >= 0.5)  return "hb-dim-tile--warn";
    return "hb-dim-tile--low";
  }

  const tilePct = $derived(card.score != null ? (card.score / card.max) * 100 : 0);
  const tileToneCls = $derived(toneClass(card.score, card.max));
  const panelToneCls = $derived(card.tone === "warn" || card.tone === "danger" ? "hover-card--warn" : "");

  function factClass(fact: { label: string }, i: number): string {
    const parts: string[] = [];
    if (i === 0) parts.push("hc-fact--first");
    const lower = fact.label.toLowerCase();
    if (lower.includes("caveat") || lower.includes("gap")) parts.push("hc-fact--warn");
    return parts.join(" ");
  }
</script>

<button
  bind:this={triggerEl}
  type="button"
  class="hc-anchor hb-dim-tile {tileToneCls}"
  class:open
  style="--pct: {tilePct}%;"
  onmouseenter={show}
  onmouseleave={hide}
  onfocus={show}
  onblur={hide}
  onkeydown={onKey}
  aria-haspopup="dialog"
  aria-expanded={open}
>
  <span class="hb-dim-tile__label">{card.label}</span>
  <span class="hb-dim-tile__num mono-num">
    {card.score ?? "—"}<span class="max">/{card.max}</span>
  </span>
  {#if card.triggerNote}
    <span class="hb-dim-tile__note">{card.triggerNote}</span>
  {/if}
  <span class="hc-cue">hover</span>
</button>

{#if open}
  <div
    bind:this={panelEl}
    use:portal
    class="hover-card {panelToneCls} hover-card--arrow-{arrow}"
    class:ready
    role="dialog"
    tabindex="-1"
    aria-label={card.title}
    style="top: {top}px; left: {left}px;"
    onmouseenter={() => { if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; } }}
    onmouseleave={hide}
  >
    <span class="hc-corner tl"></span>
    <span class="hc-corner tr"></span>
    <span class="hc-corner bl"></span>
    <span class="hc-corner br"></span>

    <header class="hc-head">
      <div class="hc-title">{card.title}</div>
      <div class="hc-sub">{card.subtitle}</div>
    </header>

    <div class="hc-summary">{card.summary}</div>

    <div class="hc-facts">
      {#each card.facts as fact, i (fact.label + i)}
        <div class="hc-fact {factClass(fact, i)}">
          <div class="hc-fact-label">{fact.label}</div>
          <div class="hc-fact-value">{fact.value}</div>
        </div>
      {/each}
    </div>

    <footer class="hc-foot">
      <span class="hc-source">source · {card.sourceLabel}</span>
      <span class="hc-hint">ESC to dismiss</span>
    </footer>
  </div>
{/if}
