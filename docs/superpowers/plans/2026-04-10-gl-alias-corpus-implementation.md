# GL Alias Corpus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a checked-in Games Lantern alias corpus for weapons, perks, blessings, and class-side labels, then generate only high-confidence aliases into the existing resolver shards.

**Architecture:** Extend the existing GL scrape surface instead of replacing it. Keep runtime resolution unchanged; add generation-time corpus artifacts, graph-backed matchers, and a review artifact for ambiguous or unmatched entries. Use deterministic parsing and graph narrowing first, then limited heuristic scoring only inside already-valid blessing candidates.

**Tech Stack:** TypeScript, Node.js ESM, Playwright, existing ground-truth JSON shards, `tsx --test`, existing CLI runners in `src/cli/`

---

## File Map

**Create:**

- `src/lib/gl-alias-corpus.ts`
  Builds normalized corpus records from generated GL scrape artifacts and class-tree labels.
- `src/lib/gl-alias-corpus.test.ts`
  Unit tests for corpus normalization and domain accounting.
- `src/lib/gl-alias-matcher.ts`
  Graph-backed matching and review classification for weapons, perks, blessings, and talents.
- `src/lib/gl-alias-matcher.test.ts`
  Unit tests for candidate narrowing, confidence classification, and blessing matching.
- `src/cli/build-gl-alias-corpus.ts`
  CLI that reads generated scrape outputs and writes `gl-alias-corpus.json`.
- `src/cli/build-gl-aliases.ts`
  CLI that reads the corpus plus ground-truth shards, writes high-confidence aliases, and emits `gl-alias-review.json`.

**Modify:**

- `src/cli/scrape-gl-catalog.ts`
  Extend scraper output from weapons + blessing overview to weapons + perks + blessing overview + blessing detail corpus inputs.
- `src/lib/scrape-gl-catalog.test.ts`
  Add parser tests for perks and blessing detail pages.
- `src/cli/enrich-entity-names.ts`
  Delegate shared GL alias writing to the corpus/alias builder path instead of ad hoc hardcoded-only logic.
- `src/lib/enrich-entity-names.test.ts`
  Update tests for delegated alias generation and preserved existing enrichments.
- `src/lib/ground-truth.test.ts`
  Add integration assertions for corpus-derived aliases and exact GL-formatted perk strings.
- `package.json`
  Add `gl:corpus:build` and `gl:aliases:build` scripts and wire the supported refresh path.

**Generated outputs:**

- `data/ground-truth/generated/gl-weapons.json`
- `data/ground-truth/generated/gl-perks.json`
- `data/ground-truth/generated/gl-blessings.json`
- `data/ground-truth/generated/gl-alias-corpus.json`
- `data/ground-truth/generated/gl-alias-review.json`

### Task 1: Extend the GL scraper surface

**Files:**
- Modify: `src/cli/scrape-gl-catalog.ts`
- Test: `src/lib/scrape-gl-catalog.test.ts`

- [ ] **Step 1: Write the failing parser tests for perks and blessing details**

```ts
describe("parsePerkRows", () => {
  it("parses perk label and slot from the GL perk table", () => {
    const rows = [
      ["4-10% Ranged Weak Spot Damage", "Ranged"],
      ["4-10% Melee Weak Spot Damage", "Melee"],
    ];

    assert.deepEqual(parsePerkRows(rows), [
      {
        display_name: "4-10% Ranged Weak Spot Damage",
        slot: "ranged",
        source_url: "https://darktide.gameslantern.com/weapon-perks",
      },
      {
        display_name: "4-10% Melee Weak Spot Damage",
        slot: "melee",
        source_url: "https://darktide.gameslantern.com/weapon-perks",
      },
    ]);
  });
});

describe("parseBlessingDetailPage", () => {
  it("extracts blessing name and effect text from the detail page body", () => {
    const html = `
      <h3>Overwhelming Fire</h3>
      <p>+10% Strength for every 4 Single Target Hits. Lasts 2s and Stacks 5 times.</p>
    `;

    assert.deepEqual(parseBlessingDetailPage(html, "https://darktide.gameslantern.com/blessings/overwhelming-fire"), {
      display_name: "Overwhelming Fire",
      effect: "+10% Strength for every 4 Single Target Hits. Lasts 2s and Stacks 5 times.",
      source_url: "https://darktide.gameslantern.com/blessings/overwhelming-fire",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/scrape-gl-catalog.test.ts`
Expected: FAIL with missing exports like `parsePerkRows` / `parseBlessingDetailPage`

- [ ] **Step 3: Implement the new pure parsing helpers**

```ts
function parsePerkRows(rows: Array<[string, string]>) {
  return rows
    .filter(([label, slot]) => label.trim().length > 0 && /^(Melee|Ranged)$/i.test(slot.trim()))
    .map(([displayName, slot]) => ({
      display_name: displayName.trim(),
      slot: slot.trim().toLowerCase(),
      source_url: "https://darktide.gameslantern.com/weapon-perks",
    }));
}

function parseBlessingDetailPage(html: string, sourceUrl: string) {
  const nameMatch = html.match(/<h3[^>]*>([^<]+)<\/h3>/i);
  const effectMatch = html.match(/<p[^>]*>([^<]+)<\/p>/i);
  if (!nameMatch || !effectMatch) {
    throw new Error(`Unable to parse blessing detail page: ${sourceUrl}`);
  }

  return {
    display_name: nameMatch[1].trim(),
    effect: effectMatch[1].trim(),
    source_url: sourceUrl,
  };
}
```

- [ ] **Step 4: Add the scrape orchestration for the new artifacts**

```ts
const PERKS_URL = "https://darktide.gameslantern.com/weapon-perks";

async function scrapePerksTable(page: Page) {
  await page.goto(PERKS_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("table", { timeout: 30_000 });
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll("table tr"))
      .slice(1)
      .map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.innerText.trim())),
  );
  return parsePerkRows(rows as Array<[string, string]>);
}

async function scrapeBlessingDetails(page: Page, blessings: Array<{ slug: string; source_url: string }>) {
  const details = [];
  for (const blessing of blessings) {
    await page.goto(blessing.source_url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector("h3", { timeout: 30_000 });
    const html = await page.content();
    details.push(parseBlessingDetailPage(html, blessing.source_url));
  }
  return details;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/lib/scrape-gl-catalog.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli/scrape-gl-catalog.ts src/lib/scrape-gl-catalog.test.ts
git commit -m "feat: extend GL scraper surface for alias corpus"
```

### Task 2: Build the unified GL alias corpus

**Files:**
- Create: `src/lib/gl-alias-corpus.ts`
- Create: `src/lib/gl-alias-corpus.test.ts`
- Create: `src/cli/build-gl-alias-corpus.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing corpus normalization tests**

```ts
describe("buildGlAliasCorpus", () => {
  it("normalizes weapon, perk, blessing, and talent inputs into one corpus shape", () => {
    const corpus = buildGlAliasCorpus({
      weapons: [{ display_name: "Agripinaa Mk VIII Braced Autogun", url_slug: "braced-autogun", source_url: "weapon-url" }],
      perks: [{ display_name: "4-10% Ranged Weak Spot Damage", slot: "ranged", source_url: "perk-url" }],
      blessings: [{ display_name: "Overpressure", effect: "Up to +5% Strength, scaling with remaining Ammunition. Stacks 5 times.", source_url: "blessing-url" }],
      classTreeLabels: [{ class: "veteran", kind: "talent", display_name: "Precision Strikes", normalized_text: "precision strikes", entity_id: "veteran.talent.veteran_increased_weakspot_damage" }],
    });

    assert.equal(corpus.length, 4);
    assert.deepEqual(corpus.map((entry) => entry.domain), ["weapon", "weapon_perk", "weapon_trait", "talent"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/gl-alias-corpus.test.ts`
Expected: FAIL with `Cannot find module '../lib/gl-alias-corpus.js'`

- [ ] **Step 3: Implement the corpus builder**

```ts
export interface GlAliasCorpusEntry {
  domain: "weapon" | "weapon_perk" | "weapon_trait" | "talent";
  raw_label: string;
  normalized_label: string;
  source_url: string;
  source_kind: string;
  slot?: string;
  class?: string;
  description?: string;
  weapon_type_labels?: string[];
}

export function buildGlAliasCorpus(input: GlCorpusInput): GlAliasCorpusEntry[] {
  return [
    ...input.weapons.map((weapon) => ({
      domain: "weapon" as const,
      raw_label: weapon.display_name,
      normalized_label: normalizeText(weapon.display_name),
      source_url: weapon.source_url,
      source_kind: "gl-weapon",
    })),
    ...input.perks.map((perk) => ({
      domain: "weapon_perk" as const,
      raw_label: perk.display_name,
      normalized_label: normalizeText(perk.display_name),
      source_url: perk.source_url,
      source_kind: "gl-perk",
      slot: perk.slot,
    })),
    ...input.blessings.map((blessing) => ({
      domain: "weapon_trait" as const,
      raw_label: blessing.display_name,
      normalized_label: normalizeText(blessing.display_name),
      source_url: blessing.source_url,
      source_kind: "gl-blessing",
      description: blessing.effect,
      weapon_type_labels: blessing.weapon_types ?? [],
    })),
    ...input.classTreeLabels.map((label) => ({
      domain: "talent" as const,
      raw_label: label.display_name,
      normalized_label: label.normalized_text,
      source_url: label.source_url,
      source_kind: "gl-class-tree",
      class: label.class,
    })),
  ];
}
```

- [ ] **Step 4: Add the corpus build CLI and scripts**

```ts
await runCliMain("gl:corpus:build", async () => {
  const weapons = readJsonFile("data/ground-truth/generated/gl-weapons.json");
  const perks = readJsonFile("data/ground-truth/generated/gl-perks.json");
  const blessings = readJsonFile("data/ground-truth/generated/gl-blessings.json");
  const classTreeLabels = readJsonFile("data/ground-truth/generated/gl-class-tree-labels.json");
  const corpus = buildGlAliasCorpus({ weapons, perks, blessings, classTreeLabels });
  writeFileSync("data/ground-truth/generated/gl-alias-corpus.json", JSON.stringify(corpus, null, 2) + "\n");
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/lib/gl-alias-corpus.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/gl-alias-corpus.ts src/lib/gl-alias-corpus.test.ts src/cli/build-gl-alias-corpus.ts package.json
git commit -m "feat: build unified GL alias corpus"
```

### Task 3: Implement graph-backed alias matching

**Files:**
- Create: `src/lib/gl-alias-matcher.ts`
- Create: `src/lib/gl-alias-matcher.test.ts`
- Modify: `src/lib/normalize.ts`

- [ ] **Step 1: Write the failing matcher tests**

```ts
describe("matchCorpusEntry", () => {
  it("matches a ranged weak spot perk corpus entry by kind and slot", async () => {
    const result = await matchCorpusEntry(
      {
        domain: "weapon_perk",
        raw_label: "4-10% Ranged Weak Spot Damage",
        normalized_label: "4 10 ranged weak spot damage",
        source_url: "perk-url",
        source_kind: "gl-perk",
        slot: "ranged",
      },
      await buildIndex({ check: false }),
    );

    assert.equal(result.state, "high_confidence_match");
    assert.equal(result.candidate_entity_id, "shared.weapon_perk.ranged.weapon_trait_ranged_increase_weakspot_damage");
  });

  it("classifies blessing matches as review_required when more than one family remains", async () => {
    const result = await matchCorpusEntry(
      {
        domain: "weapon_trait",
        raw_label: "Generic Fury",
        normalized_label: "generic fury",
        source_url: "blessing-url",
        source_kind: "gl-blessing",
        description: "+5% Damage. Stacks 5 times.",
        weapon_type_labels: ["Autopistol", "Bolter"],
      },
      await buildIndex({ check: false }),
    );

    assert.equal(result.state, "review_required");
    assert.ok(result.candidates.length > 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/gl-alias-matcher.test.ts`
Expected: FAIL with missing matcher module

- [ ] **Step 3: Implement deterministic matching helpers**

```ts
function normalizePerkAliasLabel(text: string) {
  return normalizeText(text)
    .replace(/\bweak spot\b/g, "weakspot")
    .replace(/\b\d+\s+\d+\b/g, "")
    .trim();
}

function scoreBlessingCandidate(entry: GlAliasCorpusEntry, candidate: BlessingCandidate) {
  let score = 0;
  if (entry.description && candidate.descriptionTokens.some((token) => entry.description!.includes(token))) score += 10;
  if (entry.description && /\b5 times\b/i.test(entry.description) && candidate.maxStacks === 5) score += 5;
  if (entry.description && /\b2s\b/i.test(entry.description) && candidate.durationSeconds === 2) score += 5;
  if (entry.weapon_family_candidates?.some((family) => candidate.weaponFamilies.has(family))) score += 20;
  return score;
}

export async function matchCorpusEntry(entry: GlAliasCorpusEntry, index: GroundTruthIndex): Promise<MatchResult> {
  if (entry.domain === "weapon_perk") {
    const alias = index.aliases.find((candidate) =>
      candidate.candidate_entity_id.startsWith("shared.weapon_perk.")
      && candidate.context_constraints.require_all.some((rule) => rule.key === "slot" && rule.value === entry.slot)
      && normalizePerkAliasLabel(candidate.text) === normalizePerkAliasLabel(entry.raw_label),
    );
    if (alias) {
      return { state: "high_confidence_match", candidate_entity_id: alias.candidate_entity_id, candidates: [alias.candidate_entity_id] };
    }
  }

  return classifyBlessingOrReview(entry, index);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/gl-alias-matcher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/gl-alias-matcher.ts src/lib/gl-alias-matcher.test.ts src/lib/normalize.ts
git commit -m "feat: add graph-backed GL alias matcher"
```

### Task 4: Write aliases and the review artifact

**Files:**
- Create: `src/cli/build-gl-aliases.ts`
- Modify: `src/cli/enrich-entity-names.ts`
- Modify: `src/lib/enrich-entity-names.test.ts`

- [ ] **Step 1: Write the failing alias-writer tests**

```ts
describe("buildGlAliases", () => {
  it("writes high-confidence shared aliases and keeps ambiguous entries in review output", async () => {
    const result = await buildGlAliases({
      corpus: [
        {
          domain: "weapon_perk",
          raw_label: "4-10% Ranged Weak Spot Damage",
          normalized_label: "4 10 ranged weak spot damage",
          source_url: "perk-url",
          source_kind: "gl-perk",
          slot: "ranged",
        },
      ],
    });

    assert.ok(result.sharedAliases.some((alias) => alias.text === "4-10% Ranged Weak Spot Damage"));
    assert.deepEqual(result.review.required, []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/enrich-entity-names.test.ts`
Expected: FAIL with missing `buildGlAliases` export or missing review structure

- [ ] **Step 3: Implement alias writing and review output**

```ts
const REVIEW_OUTPUT = "data/ground-truth/generated/gl-alias-review.json";

function buildAliasRecord(entry: GlAliasCorpusEntry, entityId: string): AliasSchemaJson {
  return {
    text: entry.raw_label,
    normalized_text: normalizeText(entry.raw_label),
    candidate_entity_id: entityId,
    alias_kind: "gameslantern_name",
    match_mode: "fuzzy_allowed",
    provenance: entry.source_kind,
    confidence: "high",
    context_constraints: {
      require_all: [
        ...(entry.domain === "weapon_perk" && entry.slot ? [{ key: "slot", value: entry.slot }] : []),
        ...(entry.domain === "talent" && entry.class ? [{ key: "class", value: entry.class }] : []),
      ],
      prefer: [],
    },
    rank_weight: 140,
    notes: `Generated from ${entry.source_url}`,
  };
}

await runCliMain("gl:aliases:build", async () => {
  const corpus = readJsonFile("data/ground-truth/generated/gl-alias-corpus.json");
  const index = await buildIndex({ check: false });
  const review = { matched: [], required: [], unmatched: [] };
  const generatedAliases = [];

  for (const entry of corpus) {
    const result = await matchCorpusEntry(entry, index);
    if (result.state === "high_confidence_match") {
      generatedAliases.push(buildAliasRecord(entry, result.candidate_entity_id!));
      review.matched.push({ entry, candidate_entity_id: result.candidate_entity_id });
    } else if (result.state === "review_required") {
      review.required.push({ entry, candidates: result.candidates });
    } else {
      review.unmatched.push({ entry });
    }
  }

  writeFileSync(REVIEW_OUTPUT, JSON.stringify(review, null, 2) + "\n");
  mergeGeneratedAliasesIntoShards(generatedAliases);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/enrich-entity-names.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/build-gl-aliases.ts src/cli/enrich-entity-names.ts src/lib/enrich-entity-names.test.ts
git commit -m "feat: generate aliases from GL corpus"
```

### Task 5: Add corpus coverage and resolver integration tests

**Files:**
- Modify: `src/lib/ground-truth.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing integration tests**

```ts
it("resolves exact GL perk corpus labels", async () => {
  const result = await resolveQuery("4-10% Ranged Weak Spot Damage", {
    kind: "weapon_perk",
    slot: "ranged",
  });

  assert.equal(result.resolution_state, "resolved");
  assert.equal(result.resolved_entity_id, "shared.weapon_perk.ranged.weapon_trait_ranged_increase_weakspot_damage");
});

it("reports corpus coverage by domain and state", async () => {
  const corpus = JSON.parse(readFileSync("data/ground-truth/generated/gl-alias-corpus.json", "utf8"));
  const review = JSON.parse(readFileSync("data/ground-truth/generated/gl-alias-review.json", "utf8"));

  assert.ok(corpus.length > 0);
  assert.ok(Array.isArray(review.matched));
  assert.ok(Array.isArray(review.required));
  assert.ok(Array.isArray(review.unmatched));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/ground-truth.test.ts`
Expected: FAIL because the new corpus outputs and aliases do not exist yet

- [ ] **Step 3: Wire the supported scripts and keep `check` green**

```json
{
  "scripts": {
    "gl:scrape": "node dist/cli/scrape-gl-catalog.js",
    "gl:corpus:build": "node dist/cli/build-gl-alias-corpus.js",
    "gl:aliases:build": "node dist/cli/build-gl-aliases.js"
  }
}
```

- [ ] **Step 4: Run the targeted tests**

Run: `npm test -- src/lib/ground-truth.test.ts`
Expected: PASS

- [ ] **Step 5: Run the project quality gate**

Run: `GROUND_TRUTH_SOURCE_ROOT=\"$(cat .source-root)\" npm run check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/ground-truth.test.ts package.json
git commit -m "test: enforce GL corpus coverage and resolver integration"
```

### Task 6: Build generated artifacts and verify live sample coverage

**Files:**
- Modify: `data/ground-truth/generated/*.json`
- Modify: `data/ground-truth/aliases/*.json`
- Verify: live GL sample URLs from `#21`

- [ ] **Step 1: Build the generated corpus and alias outputs**

Run:

```bash
npm run build
npm run gl:scrape
npm run gl-class-tree:build
npm run gl:corpus:build
npm run gl:aliases:build
```

Expected:
- all generated JSON files are written
- `gl-alias-review.json` contains explicit `matched`, `required`, and `unmatched` sections

- [ ] **Step 2: Run the known-tail resolver smoke checks**

Run:

```bash
npm run resolve -- --query "Overpressure" --context '{"kind":"weapon_trait","slot":"ranged"}'
npm run resolve -- --query "Overwhelming Fire" --context '{"kind":"weapon_trait","slot":"ranged"}'
npm run resolve -- --query "Murderous Tranquility" --context '{"kind":"weapon_trait","slot":"ranged"}'
npm run resolve -- --query "4-10% Ranged Weak Spot Damage" --context '{"kind":"weapon_perk","slot":"ranged"}'
```

Expected: each command returns `resolution_state: "resolved"` or, for any remaining blessing ambiguity, the exact label appears in `gl-alias-review.json`

- [ ] **Step 3: Run one live-sample pass from the issue**

Run:

```bash
node dist/cli/extract-build.js <one-issue-21-url> --json
node dist/cli/audit-build-names.js <generated-canonical-build.json>
```

Expected: clean except known curio `non_canonical` labels

- [ ] **Step 4: Commit**

```bash
git add data/ground-truth/generated data/ground-truth/aliases
git commit -m "data: refresh GL alias corpus artifacts"
```

## Self-Review

- Spec coverage: scraper artifacts, unified corpus, graph-backed alias generation, review artifact, coverage tests, and live-sample verification are all mapped to tasks.
- Placeholder scan: no `TODO`, `TBD`, or “handle later” gaps remain; every task has exact files, commands, and expected results.
- Type consistency: corpus domains are fixed as `weapon`, `weapon_perk`, `weapon_trait`, and `talent`; review states are fixed as `high_confidence_match`, `review_required`, and `unmatched`.
