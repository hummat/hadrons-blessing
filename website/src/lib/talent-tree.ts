export type TalentTreeNodeSelection = {
  entity_id: string | null;
  selection_ids?: string[];
};

export type TalentTreeSpec = {
  treeId: string;
  title: string;
};

export function isTalentTreeNodeSelected(
  node: TalentTreeNodeSelection,
  selectedEntityIds: ReadonlySet<string>,
): boolean {
  const selectionIds = node.selection_ids ?? (node.entity_id ? [node.entity_id] : []);
  return selectionIds.some((id) => selectedEntityIds.has(id));
}

export function buildTalentTreeSpecs(
  classDomain: string,
  selectedEntityIds: Iterable<string>,
): TalentTreeSpec[] {
  const specs: TalentTreeSpec[] = [{ treeId: classDomain, title: "Talent lattice" }];

  if (classDomain === "hive_scum" && hasBrokerStimmSelections(selectedEntityIds)) {
    specs.push({ treeId: "hive_scum-stimm", title: "Stimm lattice" });
  }

  return specs;
}

function hasBrokerStimmSelections(selectedEntityIds: Iterable<string>): boolean {
  for (const entityId of selectedEntityIds) {
    if (entityId.startsWith("hive_scum.talent.broker_stimm_")) return true;
  }
  return false;
}
