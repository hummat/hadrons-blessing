export const DIMENSIONS = [
  { scorecard_key: "composite_score", summary_key: "composite", label: "Overall", max: 40 },
  { scorecard_key: "perk_optimality", summary_key: "perk_optimality", label: "Perks", max: 5 },
  { scorecard_key: "curio_efficiency", summary_key: "curio_efficiency", label: "Curios", max: 5 },
  { scorecard_key: "talent_coherence", summary_key: "talent_coherence", label: "Talents", max: 5 },
  { scorecard_key: "blessing_synergy", summary_key: "blessing_synergy", label: "Blessings", max: 5 },
  { scorecard_key: "role_coverage", summary_key: "role_coverage", label: "Role", max: 5 },
  { scorecard_key: "breakpoint_relevance", summary_key: "breakpoint_relevance", label: "Breakpoints", max: 5 },
  { scorecard_key: "difficulty_scaling", summary_key: "difficulty_scaling", label: "Scaling", max: 5 },
  { scorecard_key: "survivability", summary_key: "survivability", label: "Survivability", max: 5 },
] as const;
