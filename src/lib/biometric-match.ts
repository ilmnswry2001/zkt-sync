export type BiometricMatchResults = {
  presentIds: Set<string>;
  presentBySpecialty: Map<string, number>;
  totalPresent: number;
  totalPlanned: number;
};

export function summarizeBiometricMatch(
  employees: { id: string; specialty: string }[],
  punchedIds: ReadonlySet<string>,
): BiometricMatchResults {
  const unique = new Map(employees.map((employee) => [employee.id, employee]));
  const presentIds = new Set<string>();
  const presentBySpecialty = new Map<string, number>();
  for (const employee of unique.values()) {
    if (!punchedIds.has(employee.id)) continue;
    presentIds.add(employee.id);
    const specialty = employee.specialty.trim();
    presentBySpecialty.set(specialty, (presentBySpecialty.get(specialty) ?? 0) + 1);
  }
  return { presentIds, presentBySpecialty, totalPresent: presentIds.size, totalPlanned: unique.size };
}
