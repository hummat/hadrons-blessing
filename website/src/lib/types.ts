export interface WeaponSummary {
  name: string;
  slot: string | null;
  family: string | null;
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
