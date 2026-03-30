import { loadGroundTruthRegistry } from "./registry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DomainExpectation {
  domain: string;
  expected_kinds: string[];
  notes: string;
}

interface DomainReport {
  domain: string;
  status: string;
  expected_kinds: string[];
  implemented_kinds: string[];
  entity_count: number;
  alias_count: number;
  edge_count: number;
  evidence_count: number;
  notes: string;
}

interface KindReport {
  kind: string;
  domains: string[];
  entity_count: number;
}

interface CoverageReport {
  source_snapshot_id: string;
  domains: DomainReport[];
  kinds: KindReport[];
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const DOMAIN_EXPECTATIONS: DomainExpectation[] = [
  {
    domain: "shared",
    expected_kinds: [
      "buff",
      "class",
      "gadget_trait",
      "name_family",
      "weapon",
      "weapon_perk",
      "weapon_trait",
    ],
    notes: "Cross-class shared entities currently in scope for resolver/audit work.",
  },
  {
    domain: "psyker",
    expected_kinds: [
      "ability",
      "aura",
      "keystone",
      "talent",
      "talent_modifier",
      "tree_node",
    ],
    notes: "Current class-specific pilot coverage.",
  },
  {
    domain: "veteran",
    expected_kinds: ["ability", "aura", "keystone", "talent", "talent_modifier", "tree_node"],
    notes: "Class-side slot coverage complete; tree edges extracted.",
  },
  {
    domain: "zealot",
    expected_kinds: ["ability", "aura", "keystone", "talent", "talent_modifier", "tree_node"],
    notes: "Class-side slot coverage complete; tree edges extracted.",
  },
  {
    domain: "ogryn",
    expected_kinds: ["ability", "aura", "keystone", "talent", "talent_modifier", "tree_node"],
    notes: "Class-side slot coverage complete; tree edges extracted.",
  },
  {
    domain: "arbites",
    expected_kinds: ["ability", "aura", "keystone", "talent", "talent_modifier", "tree_node"],
    notes: "Class-side slot coverage complete; tree edges extracted.",
  },
  {
    domain: "hive_scum",
    expected_kinds: ["ability", "aura", "keystone", "talent", "talent_modifier", "tree_node"],
    notes: "Class-side slot coverage complete; tree edges extracted.",
  },
];

// ---------------------------------------------------------------------------
// Logic
// ---------------------------------------------------------------------------

function statusFor(expectedKinds: string[], implementedKinds: string[]): string {
  if (implementedKinds.length === 0) {
    return "unsupported";
  }

  const implemented = new Set(implementedKinds);
  return expectedKinds.every((kind) => implemented.has(kind))
    ? "source_backed"
    : "partial";
}

function buildCoverageReport(): CoverageReport {
  const registry = loadGroundTruthRegistry();

  const domains: DomainReport[] = DOMAIN_EXPECTATIONS.map((definition) => {
    const entities = registry.entities.filter((record) => record.domain === definition.domain);
    const entityIds = new Set(entities.map((record) => record.id));
    const implementedKinds = [...new Set(entities.map((record) => record.kind))].sort();
    const aliases = registry.aliases.filter((record) => entityIds.has(record.candidate_entity_id));
    const edges = registry.edges.filter(
      (record) => entityIds.has(record.from_entity_id) || entityIds.has(record.to_entity_id),
    );
    const evidence = registry.evidence.filter((record) => entityIds.has(record.subject_id));

    return {
      domain: definition.domain,
      status: statusFor(definition.expected_kinds, implementedKinds),
      expected_kinds: definition.expected_kinds,
      implemented_kinds: implementedKinds,
      entity_count: entities.length,
      alias_count: aliases.length,
      edge_count: edges.length,
      evidence_count: evidence.length,
      notes: definition.notes,
    };
  });

  const kinds: KindReport[] = [...new Set(registry.entities.map((record) => record.kind))]
    .sort()
    .map((kind) => {
      const entities = registry.entities.filter((record) => record.kind === kind);
      return {
        kind,
        domains: [...new Set(entities.map((record) => record.domain))].sort(),
        entity_count: entities.length,
      };
    });

  return {
    source_snapshot_id: registry.source_snapshot_id,
    domains,
    kinds,
  };
}

export { buildCoverageReport };
