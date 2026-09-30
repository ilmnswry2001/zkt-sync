export type StaffAssignmentGroup = {
  specialty: string;
  names: string[];
};

export function normalizePersonName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function parsePersonNames(value: string): string[] {
  return value
    .split(/[\n\r,،]+/)
    .map(normalizePersonName)
    .filter(Boolean);
}

export function normalizeStaffAssignments(value: unknown): StaffAssignmentGroup[] {
  if (!Array.isArray(value)) return [];

  const groups: StaffAssignmentGroup[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;

    const candidate = entry as { specialty?: unknown; name?: unknown; names?: unknown };
    const specialty = typeof candidate.specialty === "string"
      ? normalizePersonName(candidate.specialty)
      : "";
    if (!specialty) continue;

    const rawNames = Array.isArray(candidate.names)
      ? candidate.names.filter((name): name is string => typeof name === "string")
      : typeof candidate.name === "string"
        ? [candidate.name]
        : [];
    const parsedNames = rawNames.flatMap(parsePersonNames);
    let group = groups.find((item) => item.specialty === specialty);
    if (!group) {
      group = { specialty, names: [] };
      groups.push(group);
    }

    for (const name of parsedNames) {
      if (!group.names.some((existing) => existing.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        group.names.push(name);
      }
    }
  }

  return groups;
}

export function appendStaffNames(
  assignments: StaffAssignmentGroup[],
  specialtyValue: string,
  rawNames: string,
): { assignments: StaffAssignmentGroup[]; added: string[]; duplicates: string[] } {
  const specialty = normalizePersonName(specialtyValue);
  const names = parsePersonNames(rawNames);
  const nextAssignments = assignments.map((group) => ({ ...group, names: [...group.names] }));
  let group = nextAssignments.find((item) => item.specialty === specialty);
  if (!group) {
    group = { specialty, names: [] };
    nextAssignments.push(group);
  }

  const added: string[] = [];
  const duplicates: string[] = [];
  for (const name of names) {
    if (group.names.some((existing) => existing.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      duplicates.push(name);
      continue;
    }
    group.names = [...group.names, name];
    added.push(name);
  }

  return { assignments: nextAssignments, added, duplicates };
}