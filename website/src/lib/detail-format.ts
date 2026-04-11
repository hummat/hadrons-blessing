import type { BreakpointWeaponDetail, BuildDetailData, ScorecardWeaponDetail } from "./types.ts";

export type NameCount = {
  name: string;
  count: number;
};

export type BreakpointPanel = {
  entityId: string | null;
  name: string;
  slot: string | null;
  weapon: BreakpointWeaponDetail | null;
  defaultOpen: boolean;
  status: "supported" | "missing" | "unsupported";
  message: string | null;
};

const COVERAGE_LABELS: Record<string, string> = {
  melee_offense: "Melee offense",
  ranged_offense: "Ranged offense",
  general_offense: "General offense",
  crit: "Crit",
  toughness: "Toughness",
  damage_reduction: "Damage reduction",
  mobility: "Mobility",
  warp_resource: "Warp resource",
  grenade: "Grenade",
  stamina: "Stamina",
  utility: "Utility",
  survivability: "Survivability",
  crit_chance_source: "Crit chance source",
  warp_charge_producer: "Warp charge producer",
  slot_imbalance: "Slot imbalance",
};

function titleCaseWords(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function fallbackLabelFromId(id: string): string {
  const lastSegment = id.split(".").at(-1) ?? id;
  return titleCaseWords(lastSegment);
}

function dedupeNames(entries: string[]): string[] {
  return [...new Set(entries.filter((entry) => entry.length > 0))];
}

export function buildSelectionLabelMap(detail: BuildDetailData): Map<string, string> {
  const namesById = new Map<string, string[]>();

  function add(id: string | null, name: string | null): void {
    if (!id || !name) return;
    const current = namesById.get(id) ?? [];
    current.push(name.trim());
    namesById.set(id, current);
  }

  add(detail.structure.slots.ability.id, detail.structure.slots.ability.name);
  add(detail.structure.slots.blitz.id, detail.structure.slots.blitz.name);
  add(detail.structure.slots.aura.id, detail.structure.slots.aura.name);
  add(detail.structure.slots.keystone.id, detail.structure.slots.keystone.name);

  for (const talent of detail.structure.talents) {
    add(talent.id, talent.name);
  }

  for (const weapon of detail.structure.weapons) {
    add(weapon.id, weapon.name);
    for (const blessing of weapon.blessings) {
      add(blessing.id, blessing.name);
    }
  }

  for (const perk of detail.structure.curio_perks) {
    add(perk.id, perk.name);
  }

  const labelMap = new Map<string, string>();
  for (const [id, rawNames] of namesById.entries()) {
    const names = dedupeNames(rawNames);
    labelMap.set(id, names.length === 1 ? names[0] : fallbackLabelFromId(id));
  }

  return labelMap;
}

export function formatSelectionText(value: string, labels: Map<string, string>): string {
  return labels.get(value) ?? fallbackLabelFromId(value);
}

export function formatSelectionList(values: string[], labels: Map<string, string>): string[] {
  return values.map((value) => formatSelectionText(value, labels));
}

export function formatCoverageLabel(value: string): string {
  return COVERAGE_LABELS[value] ?? titleCaseWords(value);
}

export function formatCoverageFraction(value: number | null | undefined): string {
  if (value == null) return "\u2014";
  return `${Math.round(value * 100)}%`;
}

export function buildBreakpointActionLabels(weapon: BreakpointWeaponDetail): string[] {
  const totals = new Map<string, number>();
  const seen = new Map<string, number>();

  for (const action of weapon.actions) {
    totals.set(action.type, (totals.get(action.type) ?? 0) + 1);
  }

  return weapon.actions.map((action) => {
    const index = (seen.get(action.type) ?? 0) + 1;
    seen.set(action.type, index);
    const base = titleCaseWords(action.type);
    return (totals.get(action.type) ?? 0) > 1 ? `${base} ${index}` : base;
  });
}

export function summarizeNameCounts<T extends { name: string }>(entries: T[]): NameCount[] {
  const counts = new Map<string, number>();
  const ordered: string[] = [];

  for (const entry of entries) {
    const name = entry.name.trim();
    if (!name) continue;
    if (!counts.has(name)) ordered.push(name);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return ordered.map((name) => ({ name, count: counts.get(name) ?? 0 }));
}

export function buildBreakpointPanels(detail: BuildDetailData): BreakpointPanel[] {
  const breakpointById = new Map(detail.breakpoints.weapons.map((weapon) => [weapon.entityId, weapon]));
  const scorecardByName = new Map(detail.scorecard.weapons.map((weapon) => [weapon.name, weapon]));
  const panels = detail.structure.weapons.map((weapon) => {
    const scorecard = scorecardByName.get(weapon.name);
    const breakpointWeapon = breakpointById.get(weapon.id) ?? null;
    return {
      entityId: weapon.id,
      name: weapon.name,
      slot: weapon.slot ?? scorecard?.slot ?? null,
      weapon: breakpointWeapon,
      defaultOpen: true,
      ...breakpointPanelStatus(weapon.slot ?? scorecard?.slot ?? null, breakpointWeapon),
    };
  });

  for (const breakpointWeapon of detail.breakpoints.weapons) {
    if (panels.some((panel) => panel.entityId === breakpointWeapon.entityId)) continue;
    const scorecardFallback = detail.scorecard.weapons.find((weapon) => weapon.canonical_entity_id === breakpointWeapon.entityId);
    panels.push({
      entityId: breakpointWeapon.entityId,
      name: scorecardFallback?.name ?? breakpointWeapon.entityId,
      slot: scorecardFallback?.slot ?? null,
      weapon: breakpointWeapon,
      defaultOpen: true,
      ...breakpointPanelStatus(scorecardFallback?.slot ?? null, breakpointWeapon),
    });
  }

  return panels;
}

function breakpointPanelStatus(
  slot: string | null,
  weapon: BreakpointWeaponDetail | null,
): Pick<BreakpointPanel, "status" | "message"> {
  if (!weapon) {
    return {
      status: "missing",
      message: "No breakpoint data is available for this weapon yet.",
    };
  }

  const actionTypes = weapon.actions.map((action) => action.type);
  if (slot === "ranged" && !actionTypes.some((type) => type.startsWith("shoot"))) {
    return {
      status: "unsupported",
      message: "This weapon's ranged attack pattern is not modeled by the breakpoint calculator yet, so showing the current rows would be misleading.",
    };
  }

  return {
    status: "supported",
    message: null,
  };
}
