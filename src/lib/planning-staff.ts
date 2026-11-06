export type AssignedStaffEmployee = {
  id: string;
  full_name: string;
  employee_no: string;
  phone: string | null;
  position: string | null;
  department_name: string | null;
};

export type StaffAssignmentGroup = {
  specialty: string;
  names: string[];
  employees: AssignedStaffEmployee[];
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

    const candidate = entry as {
      specialty?: unknown;
      name?: unknown;
      names?: unknown;
      employees?: unknown;
    };
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
      group = { specialty, names: [], employees: [] };
      groups.push(group);
    }

    const employees = Array.isArray(candidate.employees)
      ? candidate.employees.filter(
          (employee): employee is AssignedStaffEmployee =>
            !!employee &&
            typeof employee === "object" &&
            typeof (employee as AssignedStaffEmployee).id === "string" &&
            typeof (employee as AssignedStaffEmployee).full_name === "string",
        )
      : [];
    for (const employee of employees) {
      if (!group.employees.some((existing) => existing.id === employee.id)) {
        group.employees.push({
          id: employee.id,
          full_name: normalizePersonName(employee.full_name),
          employee_no: employee.employee_no ?? "",
          phone: employee.phone ?? null,
          position: employee.position ?? null,
          department_name: employee.department_name ?? null,
        });
      }
    }

    for (const name of [...employees.map((employee) => employee.full_name), ...parsedNames]) {
      const normalizedName = normalizePersonName(name);
      if (
        normalizedName &&
        !group.names.some((existing) => existing.toLocaleLowerCase() === normalizedName.toLocaleLowerCase())
      ) {
        group.names.push(normalizedName);
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
  const nextAssignments = assignments.map((group) => ({
    ...group,
    names: [...group.names],
    employees: [...group.employees],
  }));
  let group = nextAssignments.find((item) => item.specialty === specialty);
  if (!group) {
    group = { specialty, names: [], employees: [] };
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

export function appendStaffEmployee(
  assignments: StaffAssignmentGroup[],
  specialtyValue: string,
  employee: AssignedStaffEmployee,
): { assignments: StaffAssignmentGroup[]; duplicate: boolean } {
  const specialty = normalizePersonName(specialtyValue);
  const employeeName = normalizePersonName(employee.full_name);
  const duplicate = assignments.some(
    (group) =>
      group.employees.some((assigned) => assigned.id === employee.id) ||
      group.names.some((name) => name.toLocaleLowerCase() === employeeName.toLocaleLowerCase()),
  );
  if (duplicate) return { assignments, duplicate: true };

  const nextAssignments = assignments.map((group) => ({
    ...group,
    names: [...group.names],
    employees: [...group.employees],
  }));
  let group = nextAssignments.find((item) => item.specialty === specialty);
  if (!group) {
    group = { specialty, names: [], employees: [] };
    nextAssignments.push(group);
  }
  group.employees.push({ ...employee, full_name: employeeName });
  group.names.push(employeeName);
  return { assignments: nextAssignments, duplicate: false };
}

export function removeStaffEmployee(
  assignments: StaffAssignmentGroup[],
  specialtyValue: string,
  employeeId: string,
): StaffAssignmentGroup[] {
  const specialty = normalizePersonName(specialtyValue);
  return assignments
    .map((group) => {
      if (group.specialty !== specialty) return group;
      const employee = group.employees.find((item) => item.id === employeeId);
      return {
        ...group,
        employees: group.employees.filter((item) => item.id !== employeeId),
        names: employee
          ? group.names.filter((name) => name.toLocaleLowerCase() !== employee.full_name.toLocaleLowerCase())
          : [...group.names],
      };
    })
    .filter((group) => group.names.length > 0);
}