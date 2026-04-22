export interface WeaponSummary {
  name: string;
  slot: string | null;
  family: string | null;
}

export interface BuildStructureSlot {
  id: string | null;
  name: string | null;
}

export interface BuildStructureEntry {
  id: string | null;
  name: string;
}

export interface BuildStructureWeapon {
  id: string;
  name: string;
  slot: string | null;
  family: string | null;
  blessings: BuildStructureEntry[];
}

export interface BuildStructure {
  slots: {
    ability: BuildStructureSlot;
    blitz: BuildStructureSlot;
    aura: BuildStructureSlot;
    keystone: BuildStructureSlot;
  };
  talents: Array<{ id: string; name: string }>;
  weapons: BuildStructureWeapon[];
  curio_perks: BuildStructureEntry[];
}

export interface BuildScores {
  composite: number;
  grade: string;
  perk_optimality: number;
  curio_efficiency: number;
  talent_coherence: number | null;
  blessing_synergy: number | null;
  role_coverage: number | null;
  breakpoint_relevance: number | null;
  difficulty_scaling: number | null;
  survivability?: number | null;
}

export interface BuildSummary {
  file: string;
  title: string;
  class: string;
  ability: string | null;
  keystone: string | null;
  weapons: WeaponSummary[];
  scores: BuildScores;
}

export interface DimensionScoreDetail {
  score: number;
  breakdown: Record<string, unknown>;
  explanations: string[];
}

export interface ScorecardPerk {
  name: string;
  tier: number;
  value?: number;
  rating?: string;
}

export interface ScorecardWeaponPerks {
  score: number;
  perks: ScorecardPerk[];
}

export interface ScorecardBlessing {
  name: string;
  known: boolean;
  internal: string | null;
}

export interface ScorecardBlessings {
  valid: boolean | null;
  blessings: ScorecardBlessing[];
}

export interface ScorecardWeaponDetail {
  name: string;
  slot: string | null;
  canonical_entity_id: string | null;
  internal_name: string | null;
  weapon_family: string | null;
  resolution_source: string | null;
  perks: ScorecardWeaponPerks;
  blessings: ScorecardBlessings;
}

export interface ScorecardCurioPerk {
  name: string;
  tier: number;
  rating: string;
}

export interface ScorecardCurios {
  score: number;
  perks: ScorecardCurioPerk[];
}

export interface ScorecardQualitative {
  blessing_synergy: DimensionScoreDetail | null;
  talent_coherence: DimensionScoreDetail | null;
  breakpoint_relevance: DimensionScoreDetail | null;
  role_coverage: DimensionScoreDetail | null;
  difficulty_scaling: DimensionScoreDetail | null;
  survivability?: DimensionScoreDetail | null;
}

export interface ScorecardDetail {
  title: string;
  class: string;
  perk_optimality: number;
  curio_efficiency: number;
  composite_score: number;
  letter_grade: string;
  weapons: ScorecardWeaponDetail[];
  curios: ScorecardCurios;
  qualitative: ScorecardQualitative;
  bot_flags: string[];
}

export interface SynergyEdgeDetail {
  type: string;
  selections: string[];
  families: string[];
  strength: number;
  explanation: string;
}

export interface AntiSynergyDetail {
  type: string;
  selections: string[];
  reason: string;
  severity: string;
}

export interface OrphanDetail {
  selection: string;
  reason: string;
  condition: string;
  resource?: string;
}

export interface CoverageFamilyProfile {
  count: number;
  total_magnitude: number;
  selections: string[];
}

export interface CoverageResultDetail {
  family_profile: Record<string, CoverageFamilyProfile>;
  slot_balance: {
    melee: { families: string[]; strength: number };
    ranged: { families: string[]; strength: number };
  };
  build_identity: string[];
  coverage_gaps: string[];
  concentration: number;
}

export interface SynergyMetadataDetail {
  entities_analyzed: number;
  unique_entities_with_calc: number;
  unique_entities_with_linked_source: number;
  entities_without_calc: number;
  opaque_conditions: number;
  calc_coverage_pct: number;
  linked_coverage_pct: number;
}

export interface SynergyAnalysisDetail {
  build: string;
  class: string;
  synergy_edges: SynergyEdgeDetail[];
  anti_synergies: AntiSynergyDetail[];
  orphans: OrphanDetail[];
  coverage: CoverageResultDetail;
  _resolvedIds: string[];
  metadata: SynergyMetadataDetail;
}

export interface BreakpointBreedEntry {
  breed_id: string;
  difficulty: string;
  hitsToKill: number | null;
  damage: number;
  hitZone: string;
  effectiveArmorType: string;
  damageEfficiency: string;
}

export interface BreakpointScenarioResult {
  breeds: BreakpointBreedEntry[];
}

export interface BreakpointActionDetail {
  type: string;
  profileId: string;
  scenarios: Record<string, BreakpointScenarioResult>;
}

export interface BreakpointSummaryDetail {
  bestLight: Record<string, unknown> | null;
  bestHeavy: Record<string, unknown> | null;
  bestSpecial: Record<string, unknown> | null;
}

export interface BreakpointWeaponDetail {
  entityId: string;
  slot: number;
  actions: BreakpointActionDetail[];
  summary: BreakpointSummaryDetail;
}

export interface BreakpointMatrixDetail {
  weapons: BreakpointWeaponDetail[];
  metadata: {
    quality: number;
    scenarios: string[];
    timestamp: string;
  };
}

export interface BuildDetailData {
  slug: string;
  summary: BuildSummary;
  scorecard: ScorecardDetail;
  synergy: SynergyAnalysisDetail;
  breakpoints: BreakpointMatrixDetail;
  structure: BuildStructure;
}

export interface CompareScoreDelta {
  dimension: string;
  label: string;
  a: number | null;
  b: number | null;
  delta: number | null;
  max: number;
}

export interface CompareSetDiff<T> {
  only_a: T[];
  only_b: T[];
  shared: T[];
}

export interface CompareSlotDiff {
  key: string;
  label: string;
  a: BuildStructureSlot;
  b: BuildStructureSlot;
  changed: boolean;
}

export type CompareActionCategory = "light" | "heavy" | "special" | "push";

export interface CompareBreakpointDelta {
  breed_id: string;
  action_category: CompareActionCategory;
  a_htk: number | null;
  b_htk: number | null;
  delta: number | null;
  a_weapon: string | null;
  b_weapon: string | null;
}
