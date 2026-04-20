<script lang="ts">
  import { base } from "$app/paths";
  import { page } from "$app/state";
  import "../app.css";

  let { children } = $props();

  const pathname = $derived(page.url?.pathname ?? "");
  const onManifest = $derived(pathname === `${base}` || pathname === `${base}/`);
  const onCompare = $derived(pathname.startsWith(`${base}/compare`));
  const onDossier = $derived(pathname.startsWith(`${base}/builds/`));
</script>

<div class="hb-atmo" aria-hidden="true"></div>

<div class="site-shell">
  <header class="site-header">
    <nav class="site-nav" aria-label="Primary">
      <a href={`${base}/`} class="site-brand">
        <span class="site-brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32">
            <polygon points="16,2 30,16 16,30 2,16" fill="none" stroke="var(--hb-amber)" stroke-width="1.5" />
            <polygon points="16,8 24,16 16,24 8,16" fill="var(--hb-amber)" opacity="0.35" />
            <circle cx="16" cy="16" r="2" fill="var(--hb-amber-glow)" />
          </svg>
        </span>
        <span>
          <span class="site-brand-title">Hadron's Blessing</span>
          <div class="site-brand-sub">Ordo Tacticae · Build Intelligence</div>
        </span>
      </a>

      <div class="site-nav-links">
        <a
          href={`${base}/`}
          class="site-nav-link"
          class:active={onManifest}
          aria-current={onManifest ? "page" : undefined}
        >
          Manifest
        </a>
        <a
          href={`${base}/compare`}
          class="site-nav-link"
          class:active={onCompare}
          aria-current={onCompare ? "page" : undefined}
        >
          Compare
        </a>
        {#if onDossier}
          <span class="site-nav-link active" aria-current="page">Dossier</span>
        {/if}
      </div>

      <div class="site-status" aria-live="polite">
        <span class="dot" aria-hidden="true"></span>
        <span>Resolver online</span>
      </div>
    </nav>
  </header>

  <main class="site-main">
    {@render children()}
  </main>

  <footer class="site-footer">
    Source-backed Darktide build analysis
  </footer>
</div>
