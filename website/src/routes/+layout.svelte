<script>
  import { base } from "$app/paths";
  import "../app.css";
  let { children } = $props();
</script>

<div class="min-h-screen flex flex-col">
  <header class="bg-gray-900 border-b border-gray-800 px-6 py-4">
    <nav class="max-w-7xl mx-auto flex items-center gap-6">
      <a href="{base}/" class="text-xl font-bold text-amber-400 hover:text-amber-300 transition-colors">
        Hadron's Blessing
      </a>
      <a href="{base}/" class="text-gray-400 hover:text-gray-200 text-sm transition-colors">Builds</a>
    </nav>
  </header>

  <main class="flex-1 max-w-7xl mx-auto w-full px-6 py-8">
    {@render children()}
  </main>

  <footer class="bg-gray-900 border-t border-gray-800 px-6 py-4 text-center text-gray-500 text-xs">
    Source-backed Darktide build analysis
  </footer>
</div>
