import { escapeHtml, printReport } from "@/lib/report-print";
import { todayInBaghdad } from "@/lib/date-time";
import { ui } from "@/lib/ui-language";

const dispatchRoles = ["admin", "hr", "supervisor", "planning_officer", "site_admin"];

export const canUseStaffDispatch = (roles: string[]) => roles.some((role) => dispatchRoles.includes(role));

export const dispatchStatuses = ["draft", "confirmed", "completed"] as const;
export type DispatchStatus = (typeof dispatchStatuses)[number];
export const dispatchStatusLabel: Record<DispatchStatus, string> = {
  draft: "مسودة", confirmed: "مؤكدة", completed: "مكتملة",
};

export type DispatchEmployee = {
  id: string;
  full_name: string;
  employee_no: string;
  position: string | null;
  category: string;
  phone1: string | null;
  id_no: string | null;
};

export function tomorrowInBaghdad() {
  const date = new Date(todayInBaghdad() + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function groupDispatchEmployees(employees: readonly DispatchEmployee[]) {
  const groups = new Map<string, DispatchEmployee[]>();
  for (const employee of employees) {
    const group = groups.get(employee.category) ?? [];
    group.push(employee);
    groups.set(employee.category, group);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b, "ar"));
}

type DispatchExport = { date: string; destination: string; title: string; notes: string; employees: DispatchEmployee[] };

export function dispatchMessage({ date, destination, title, notes, employees }: DispatchExport) {
  const sections = groupDispatchEmployees(employees).map(([category, list]) =>
    [
      `🔹 *${category} (${list.length}):*`,
      ...list.map((employee, index) =>
        `${index + 1}. ${employee.full_name} (${employee.position || "—"})${employee.phone1 ? " - " + employee.phone1 : ""}`,
      ),
    ].join("\n"),
  );
  return [
    `📋 *نشرة الكوادر الميدانية ليوم: ${date}*`,
    title,
    `📍 *الموقع / الورشة:* ${destination}`,
    `👥 *إجمالي الكادر:* ${employees.length}`,
    "━━━━━━━━━━━━━━━━━━━", ...sections, "━━━━━━━━━━━━━━━━━━━",
    ...(notes ? [notes] : []),
    "⚠️ يرجى التواجد في الموقع عند الساعة 06:30 صباحاً.",
  ].join("\n");
}

export function printStaffDispatch({ date, destination, title, notes, employees }: DispatchExport) {
  let index = 0;
  const rows = groupDispatchEmployees(employees).map(([category, list]) =>
    `<tr class="ops-group-row"><td colspan="6"><strong>${escapeHtml(category)} · ${list.length}</strong></td></tr>` +
    list.map((employee) => `<tr><td class="ops-num">${++index}</td><td class="ops-name">${escapeHtml(employee.full_name)}</td>
      <td class="ops-num">${escapeHtml(employee.employee_no)}</td><td>${escapeHtml(employee.position || "—")}</td>
      <td dir="ltr">${escapeHtml(employee.phone1 || "—")}</td><td style="min-width:85px"></td></tr>`).join(""),
  ).join("");
  return printReport(title, `<section dir="rtl" class="ops-report ops-sheet">
    <header class="ops-header"><div><span class="ops-kicker">EMAD_tc</span><h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(destination)}</p></div><div class="ops-document"><b>${ui("نشرة الكوادر الميدانية")}</b>
    <span dir="ltr">${escapeHtml(date)}</span><small>${ui("إجمالي الكادر")}: ${employees.length}</small></div></header>
    <h3>${ui("كشف الكادر")}</h3><table class="ops-roster"><thead><tr><th>#</th><th>${ui("اسم الموظف")}</th>
    <th>${ui("الرقم الوظيفي")}</th><th>${ui("العنوان الوظيفي")}</th><th>${ui("رقم الهاتف")}</th><th>${ui("توقيع الحضور")}</th></tr></thead>
    <tbody>${rows}</tbody></table>${notes ? `<div class="ops-note"><p>${escapeHtml(notes)}</p></div>` : ""}
    <div class="ops-signatures"><div><span>${ui("منسق الكوادر")}</span><i></i></div>
    <div><span>${ui("مسؤول الموقع")}</span><i></i></div><div><span>${ui("الاعتماد")}</span><i></i></div></div>
    </section>`);
}
