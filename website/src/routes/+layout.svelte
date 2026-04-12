<script>
  import { base } from "$app/paths";
  import "../app.css";
  let { children } = $props();
</script>

<div class="site-shell">
  <header class="site-header">
    <nav class="site-nav">
      <a href="{base}/" class="site-mark">
        Hadron's Blessing
      </a>
      <a href="{base}/" class="site-nav-link">Builds</a>
    </nav>
  </header>

  <main class="site-main">
    {@render children()}
  </main>

  <footer class="site-footer">
    Source-backed Darktide build analysis
  </footer>
</div>
