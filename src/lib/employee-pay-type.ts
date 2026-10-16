const DAILY_ROLE_NAMES = ["ريكر", "كوسرجي", "عامل", "نجار", "مسعف", "منقذ"];

function normalizeRole(value: string | null | undefined) {
  return (value ?? "")
    .toLocaleLowerCase("ar")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .trim()
    .replace(/^ال/, "");
}

export function getEmployeePayType(
  employee: {
    pay_type?: string | null;
    position?: string | null;
    wage_rates?: { title?: string | null } | null;
  },
): "daily" | "monthly" {
  const roles = [employee.position, employee.wage_rates?.title].map(normalizeRole);
  if (
    roles.some((role) =>
      DAILY_ROLE_NAMES.some((name) => {
        const normalizedName = normalizeRole(name);
        return role === normalizedName || role.startsWith(`${normalizedName} `);
      }),
    )
  ) {
    return "daily";
  }
  return employee.pay_type === "daily" ? "daily" : "monthly";
}
