const CLASS_DOMAIN_BY_INTERNAL_NAME: Record<string, string> = {
  adamant: "arbites",
  broker: "hive_scum",
  ogryn: "ogryn",
  psyker: "psyker",
  veteran: "veteran",
  zealot: "zealot",
};

export function resolveClassDomain(classEntityId: string | null | undefined): string | null {
  if (!classEntityId) return null;

  const internalName = classEntityId.split(".").pop();
  if (!internalName) return null;

  return CLASS_DOMAIN_BY_INTERNAL_NAME[internalName] ?? null;
}
