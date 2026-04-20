<script lang="ts">
  import { base } from "$app/paths";
  import { isTalentTreeNodeSelected } from "$lib/talent-tree";

  // Portal action — moves the node to document.body so position: fixed escapes
  // any transformed/animated ancestor (e.g. `.hb-reveal`).
  function portal(node: HTMLElement) {
    if (typeof document === "undefined") return { destroy() {} };
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }

  type TreeNode = {
    widget_name: string;
    entity_id: string | null;
    selection_ids: string[];
    talent_internal_name: string | null;
    type: string;
    group_name: string | null;
    x: number;
    y: number;
    cost: number;
    max_points: number;
    icon_key: string | null;
    gradient_color: string | null;
    children: string[];
    parents: string[];
  };

  type TreeDag = {
    domain: string;
    archetype_name: string | null;
    canvas: { width: number; height: number };
    nodes: TreeNode[];
  };

  type IconAsset = { entity_id: string; image_path: string };
  type LabelMap = Record<string, { display_name: string }>;

  type Props = {
    classDomain: string; // "veteran" | "zealot" | ...
    selectedEntityIds: ReadonlySet<string>;
    treeId?: string;
    title?: string;
  };
  let {
    classDomain,
    selectedEntityIds,
    treeId = undefined,
    title = "Talent lattice",
  }: Props = $props();
  let resolvedTreeId = $derived(treeId ?? classDomain);

  let dag = $state<TreeDag | null>(null);
  let iconByEntityId = $state<Record<string, string>>({});
  let labels = $state<LabelMap>({});
  let loadError = $state<string | null>(null);
  let loadToken = 0;

  // Hover — cursor-anchored tooltip, no pan/zoom.
  let hoverWidget = $state<string | null>(null);
  let hoverScreen = $state<{ x: number; y: number } | null>(null);

  // ------------------------------------------------------------------ loaders

  async function loadAll(requestedTreeId: string) {
    const token = ++loadToken;
    dag = null;
    loadError = null;

    try {
      const [treeRes, labelsRes, iconsRes] = await Promise.all([
        fetch(`${base}/data/trees/${requestedTreeId}.json`),
        fetch(`${base}/data/talent-labels.json`),
        fetch(`${base}/data/icon-assets.json`),
      ]);
      if (!treeRes.ok) throw new Error(`tree fetch: HTTP ${treeRes.status}`);
      const nextDag = await treeRes.json() as TreeDag;
      const nextLabels = labelsRes.ok ? await labelsRes.json() as LabelMap : labels;
      if (iconsRes.ok) {
        const records = await iconsRes.json() as Record<string, IconAsset>;
        const map: Record<string, string> = {};
        for (const key of Object.keys(records)) {
          map[key] = records[key].image_path;
        }
        if (token !== loadToken) return;
        dag = nextDag;
        labels = nextLabels;
        iconByEntityId = map;
        return;
      }
      if (token !== loadToken) return;
      dag = nextDag;
      labels = nextLabels;
    } catch (error) {
      if (token !== loadToken) return;
      loadError = error instanceof Error ? error.message : String(error);
    }
  }

  $effect(() => {
    void loadAll(resolvedTreeId);
  });

  // ------------------------------------------------------------------ derived

  // Start nodes aren't part of the player-visible lattice — they're implicit
  // roots the GL client also hides. Dropping them also silently drops any
  // edge whose endpoint is a start node (via the edge-derivation below).
  let visibleNodes = $derived.by(() => {
    if (!dag) return [] as TreeNode[];
    return dag.nodes.filter((n) => n.type !== "start");
  });

  let nodeByWidget = $derived.by(() => {
    const map = new Map<string, TreeNode>();
    for (const node of visibleNodes) map.set(node.widget_name, node);
    return map;
  });

  // Deduplicated parent→child edge list (only edges between visible nodes).
  let edges = $derived.by(() => {
    const out: Array<{ from: TreeNode; to: TreeNode; key: string }> = [];
    const seen = new Set<string>();
    for (const node of visibleNodes) {
      for (const childWidget of node.children) {
        const child = nodeByWidget.get(childWidget);
        if (!child) continue;
        const key = `${node.widget_name}→${childWidget}`;
        const reverseKey = `${childWidget}→${node.widget_name}`;
        if (seen.has(key) || seen.has(reverseKey)) continue;
        seen.add(key);
        out.push({ from: node, to: child, key });
      }
    }
    return out;
  });

  function isSelected(node: TreeNode): boolean {
    return isTalentTreeNodeSelected(node, selectedEntityIds);
  }

  function nodeRadius(node: TreeNode): number {
    if (node.type === "keystone") return 48;
    if (node.type.endsWith("_modifier")) return 30;
    if (node.type === "ability" || node.type === "aura" || node.type === "tactical") return 44;
    if (node.type === "start") return 32;
    return 38;
  }

  function iconFor(node: TreeNode): string | null {
    if (node.entity_id && iconByEntityId[node.entity_id]) {
      return `${base}${iconByEntityId[node.entity_id]}`;
    }
    return null;
  }

  function labelFor(node: TreeNode): string {
    if (node.entity_id && labels[node.entity_id]?.display_name) {
      return labels[node.entity_id].display_name;
    }
    if (node.type === "stat" && node.talent_internal_name) {
      return formatStatNodeName(node.talent_internal_name);
    }
    return node.talent_internal_name ?? node.widget_name.slice(0, 10);
  }

  // Parse stat-node internal names like `base_toughness_boost_node_buff_low_1`
  // into "Toughness Boost (low +1)". GL doesn't label stat nodes, so without
  // this the tooltip shows raw snake_case, which is useless.
  const STAT_TIER_PATTERNS = [
    /_node_buff_low_(\d+)$/,
    /_node_buff_medium_(\d+)$/,
    /_node_buff_high_(\d+)$/,
    /_node_buff_(\d+)$/,
    /_node_low_(\d+)$/,
    /_node_medium_(\d+)$/,
    /_node_high_(\d+)$/,
    /_node_(\d+)$/,
  ];
  function formatStatNodeName(internal: string): string {
    let family = internal;
    let tier: string | null = null;
    let variant: string | null = null;
    for (const pattern of STAT_TIER_PATTERNS) {
      const match = internal.match(pattern);
      if (match) {
        family = internal.slice(0, match.index);
        variant = match[1];
        // Derive tier label from the matched tier word.
        const tierWord = pattern.source.match(/(low|medium|high)/);
        if (tierWord) tier = tierWord[1];
        break;
      }
    }
    const display = family
      .replace(/^base_/, "")
      .split("_")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    if (tier && variant) return `${display} (${tier} ${variant})`;
    if (tier) return `${display} (${tier})`;
    if (variant) return `${display} (${variant})`;
    return display;
  }

  function typeChip(type: string): string {
    if (type === "keystone") return "KEYSTONE";
    if (type === "ability") return "ABILITY";
    if (type === "aura") return "AURA";
    if (type === "tactical") return "BLITZ";
    if (type === "ability_modifier") return "ABILITY ·";
    if (type === "keystone_modifier") return "KEYSTONE ·";
    if (type === "tactical_modifier") return "BLITZ ·";
    if (type === "start") return "START";
    return "TALENT";
  }

  // ------------------------------------------------------------------ hover

  function onNodeEnter(e: MouseEvent, widget: string) {
    hoverWidget = widget;
    hoverScreen = { x: e.clientX, y: e.clientY };
  }

  function onNodeMove(e: MouseEvent) {
    if (hoverWidget) hoverScreen = { x: e.clientX, y: e.clientY };
  }

  function onNodeLeave() {
    hoverWidget = null;
    hoverScreen = null;
  }

  let hoveredNode = $derived(hoverWidget ? nodeByWidget.get(hoverWidget) ?? null : null);
</script>

<section class="hb-tree-shell" aria-label="Talent tree">
  <header class="hb-tree-head">
    <div>
      <span class="hb-tree-title">{title}</span>
      <span class="hb-tree-sub">{dag?.archetype_name ?? classDomain} · {dag ? dag.nodes.length : "…"} nodes</span>
    </div>
    <div class="hb-tree-legend">
      <span class="hb-tree-legend-dot hb-tree-legend-dot--sel"></span> selected
      <span class="hb-tree-legend-dot hb-tree-legend-dot--avail"></span> available
    </div>
  </header>

  <div
    class="hb-tree-viewport"
    style={dag ? `aspect-ratio: ${dag.canvas.width} / ${dag.canvas.height};` : undefined}
    aria-label="Talent tree viewport"
  >
    {#if loadError}
      <p class="hb-tree-error">Could not load talent lattice: {loadError}</p>
    {:else if !dag}
      <p class="hb-tree-loading">Loading lattice…</p>
    {:else}
      <svg
        class="hb-tree-svg"
        viewBox={`0 0 ${dag.canvas.width} ${dag.canvas.height}`}
        preserveAspectRatio="xMidYMid meet"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter id="hb-node-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <clipPath id="hb-node-clip-sm"><circle cx="0" cy="0" r="26" /></clipPath>
          <clipPath id="hb-node-clip-md"><circle cx="0" cy="0" r="32" /></clipPath>
          <clipPath id="hb-node-clip-lg"><circle cx="0" cy="0" r="40" /></clipPath>
        </defs>

        <g>
          <!-- Edges -->
          <g class="hb-tree-edges">
            {#each edges as edge (edge.key)}
              {@const selA = isSelected(edge.from)}
              {@const selB = isSelected(edge.to)}
              {@const bothSelected = selA && selB}
              <line
                x1={edge.from.x}
                y1={edge.from.y}
                x2={edge.to.x}
                y2={edge.to.y}
                class="hb-tree-edge"
                class:hb-tree-edge--sel={bothSelected}
              />
            {/each}
          </g>

          <!-- Nodes -->
          <g class="hb-tree-nodes">
            {#each visibleNodes as node (node.widget_name)}
              {@const r = nodeRadius(node)}
              {@const selected = isSelected(node)}
              {@const icon = iconFor(node)}
              {@const clipId = r <= 30 ? "hb-node-clip-sm" : r <= 38 ? "hb-node-clip-md" : "hb-node-clip-lg"}
              <g
                transform={`translate(${node.x}, ${node.y})`}
                class="hb-tree-node"
                class:hb-tree-node--sel={selected}
                class:hb-tree-node--dim={!selected}
                class:hb-tree-node--keystone={node.type === "keystone"}
                role="button"
                tabindex="0"
                aria-label={labelFor(node)}
                onmouseenter={(e) => onNodeEnter(e, node.widget_name)}
                onmousemove={onNodeMove}
                onmouseleave={onNodeLeave}
                onfocus={(e) => {
                  const bbox = (e.currentTarget as SVGGElement).getBoundingClientRect();
                  onNodeEnter(
                    { clientX: bbox.left + bbox.width / 2, clientY: bbox.top } as MouseEvent,
                    node.widget_name,
                  );
                }}
                onblur={onNodeLeave}
              >
                <circle class="hb-tree-node-ring" r={r} />
                {#if icon}
                  <image
                    href={icon}
                    x={-r + 4}
                    y={-r + 4}
                    width={(r - 4) * 2}
                    height={(r - 4) * 2}
                    clip-path={`url(#${clipId})`}
                    preserveAspectRatio="xMidYMid slice"
                  />
                {:else}
                  <circle r={r - 4} class="hb-tree-node-fill" />
                  <text class="hb-tree-node-glyph" text-anchor="middle" dy="0.35em">
                    {typeChip(node.type).charAt(0)}
                  </text>
                {/if}
                {#if selected}
                  <circle r={r + 4} class="hb-tree-node-halo" filter="url(#hb-node-glow)" />
                {/if}
              </g>
            {/each}
          </g>
        </g>
      </svg>
    {/if}

    {#if hoveredNode && hoverScreen}
      <div
        use:portal
        class="hb-tree-tip"
        style={`left: ${hoverScreen.x + 16}px; top: ${hoverScreen.y + 16}px;`}
        role="status"
      >
        <div class="hb-tree-tip-sub">{typeChip(hoveredNode.type)}</div>
        <div class="hb-tree-tip-title">{labelFor(hoveredNode)}</div>
        {#if hoveredNode.cost > 0}
          <div class="hb-tree-tip-foot">Cost · {hoveredNode.cost} · {isSelected(hoveredNode) ? "selected" : "not taken"}</div>
        {:else}
          <div class="hb-tree-tip-foot">{isSelected(hoveredNode) ? "selected" : "not taken"}</div>
        {/if}
      </div>
    {/if}
  </div>
</section>

<style>
  .hb-tree-shell {
    background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(0,0,0,0.12));
    border: 1px solid var(--hb-line);
    border-radius: 2px;
    overflow: hidden;
    display: flex; flex-direction: column;
  }

  .hb-tree-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px;
    background: linear-gradient(180deg, rgba(255,255,255,0.02), transparent);
    border-bottom: 1px solid var(--hb-line);
    gap: 12px;
  }
  .hb-tree-title {
    font-family: "Cormorant Garamond", serif;
    font-style: italic;
    font-size: 16px;
    color: var(--hb-ink);
  }
  .hb-tree-sub {
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    color: var(--hb-ink-faint);
    margin-left: 10px;
  }
  .hb-tree-legend {
    display: flex; align-items: center; gap: 8px;
    font-family: "Oswald", sans-serif;
    font-size: 10px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--hb-ink-faint);
  }
  .hb-tree-legend-dot {
    display: inline-block; width: 8px; height: 8px;
    border-radius: 50%;
    margin-right: 4px;
    vertical-align: middle;
  }
  .hb-tree-legend-dot--sel { background: var(--hb-amber); box-shadow: 0 0 6px var(--hb-amber-glow); }
  .hb-tree-legend-dot--avail { background: var(--hb-ink-ghost); }

  .hb-tree-viewport {
    position: relative;
    width: 100%;
    /* aspect-ratio is set inline from dag.canvas dims; fallback keeps the box alive
       while loading */
    aspect-ratio: 16 / 9;
    background:
      radial-gradient(ellipse at center, rgba(255,170,80,0.03), transparent 70%),
      #050608;
  }
  .hb-tree-svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  .hb-tree-loading,
  .hb-tree-error {
    position: absolute; inset: 0;
    display: grid; place-items: center;
    font-family: "Oswald", sans-serif;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: var(--hb-ink-faint);
    font-size: 12px;
  }
  .hb-tree-error { color: var(--hb-blood); text-transform: none; letter-spacing: 0; }

  /* Edges */
  .hb-tree-edge {
    stroke: color-mix(in oklch, var(--hb-amber) 18%, transparent);
    stroke-width: 1.5;
    fill: none;
  }
  .hb-tree-edge--sel {
    stroke: var(--hb-amber);
    stroke-width: 2;
  }

  /* Nodes */
  .hb-tree-node-ring {
    fill: #0a0c10;
    stroke: var(--hb-line-strong);
    stroke-width: 2;
  }
  .hb-tree-node--sel .hb-tree-node-ring {
    stroke: var(--hb-amber);
    stroke-width: 2.5;
  }
  .hb-tree-node--keystone .hb-tree-node-ring {
    stroke-width: 3;
  }
  .hb-tree-node--dim image { opacity: 0.55; filter: grayscale(0.5) brightness(0.8); }
  .hb-tree-node--sel image { opacity: 1; filter: none; }
  .hb-tree-node-fill { fill: #12161c; }
  .hb-tree-node-glyph {
    fill: var(--hb-ink-faint);
    font-family: "Oswald", sans-serif;
    font-size: 14px;
    letter-spacing: 0.18em;
    pointer-events: none;
  }
  .hb-tree-node-halo {
    fill: none;
    stroke: color-mix(in oklch, var(--hb-amber) 60%, transparent);
    stroke-width: 2;
  }
  .hb-tree-node { cursor: pointer; }
  .hb-tree-node:focus { outline: none; }
  .hb-tree-node:focus .hb-tree-node-ring { stroke: var(--hb-amber-glow); }

  /* Tooltip */
  .hb-tree-tip {
    position: fixed;
    z-index: 9998;
    min-width: 220px;
    max-width: 300px;
    padding: 10px 12px;
    background: linear-gradient(180deg, rgba(20,14,8,0.96), rgba(8,10,14,0.96));
    border: 1px solid var(--hb-amber-deep);
    border-radius: 2px;
    box-shadow: 0 12px 30px rgba(0,0,0,0.6);
    pointer-events: none;
    color: var(--hb-ink);
  }
  .hb-tree-tip-sub {
    font-family: "Oswald", sans-serif;
    font-size: 9px;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: var(--hb-amber);
    margin-bottom: 4px;
  }
  .hb-tree-tip-title {
    font-family: "Cormorant Garamond", serif;
    font-style: italic;
    font-size: 15px;
    line-height: 1.25;
    color: var(--hb-ink);
  }
  .hb-tree-tip-foot {
    font-family: "JetBrains Mono", monospace;
    font-size: 10.5px;
    color: var(--hb-ink-faint);
    margin-top: 6px;
  }
</style>
