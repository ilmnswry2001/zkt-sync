import { escapeHtml } from "./report-print";
import { normalizeStaffAssignments } from "./planning-staff";

type ReportSpecialty = { specialty: string; quantity: number; notes?: string; heavy_equipment?: boolean; equipment_name?: string; equipment_quantity?: number };
type ReportPlan = {
  id: string; site_name: string; request_date: string; requested_by_name: string; applicant_name: string;
  status: string; specialties: ReportSpecialty[]; assigned_staff: unknown;
  final_plan: { title?: string; notes?: string; specialties?: ReportSpecialty[] } | null;
  engineer_notes?: string | null; management_notes?: string | null; planning_notes?: string | null;
};

function metric(label: string, value: unknown) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function signatures(labels: string[]) {
  return `<div class="ops-signatures">${labels.map((label) => `<div><span>${escapeHtml(label)}</span><i></i></div>`).join("")}</div>`;
}

export function finalPlanReportMarkup(plan: ReportPlan, site?: { ctr_code?: string; location?: string | null }) {
  const specialties = plan.final_plan?.specialties?.length ? plan.final_plan.specialties : plan.specialties;
  const assignments = normalizeStaffAssignments(plan.assigned_staff);
  const groups = specialties.map((item) => ({ item, group: assignments.find((group) => group.specialty === item.specialty) }));
  const required = specialties.reduce((total, item) => total + Number(item.quantity || 0), 0);
  const assigned = groups.reduce((total, { group }) => total + (group?.names.length ?? 0), 0);
  const missing = groups.reduce((total, { item, group }) => total + Math.max(0, Number(item.quantity || 0) - (group?.names.length ?? 0)), 0);
  const summary = groups.map(({ item, group }) => `<span><b>${escapeHtml(item.specialty)}</b><em>${group?.names.length ?? 0} / ${Number(item.quantity || 0)}</em></span>`).join("");
  let rowNo = 0;
  const rows = groups.map(({ item, group }) => {
    const extras = [item.heavy_equipment ? `آلية: ${item.equipment_name || "مطلوبة"} · ${Math.max(1, Number(item.equipment_quantity) || 1)}` : "", item.notes].filter(Boolean).join(" · ");
    const names = group?.names ?? [];
    const heading = `<tr class="ops-group-row"><td colspan="5"><strong>${escapeHtml(item.specialty)}</strong><span>المطلوب ${Number(item.quantity || 0)} · الموزّع ${names.length}${extras ? ` · ${escapeHtml(extras)}` : ""}</span></td></tr>`;
    return heading + (names.length ? names.map((name, index) => {
      const employee = group?.employees.filter((employee) => employee.full_name === name)[names.slice(0, index).filter((previous) => previous === name).length];
      return `<tr><td class="ops-num">${++rowNo}</td><td class="ops-name">${escapeHtml(name)}</td><td class="ops-num">${escapeHtml(employee?.employee_no || "—")}</td><td class="ops-phone">${escapeHtml(employee?.phone || "—")}</td><td>${escapeHtml(employee?.department_name || "—")}</td></tr>`;
    }).join("") : `<tr><td colspan="5" class="ops-empty">لم تُدرج أسماء لهذا التخصص</td></tr>`);
  }).join("");
  const notes = [["ملاحظات المهندس", plan.engineer_notes], ["ملاحظات الخطة", plan.final_plan?.notes || plan.management_notes || plan.planning_notes]]
    .filter(([, note]) => note && note !== "-").map(([label, note]) => `<div class="ops-note"><b>${label}</b><p>${escapeHtml(note)}</p></div>`).join("");
  return `<section class="ops-report ops-sheet"><header class="ops-header"><div><span class="ops-kicker">منظومة زِكت / إدارة المشاريع</span><h2>${escapeHtml(plan.final_plan?.title || `خطة العمل — ${plan.site_name}`)}</h2><p>${escapeHtml(plan.site_name)}${site?.location ? ` · ${escapeHtml(site.location)}` : ""}</p></div><div class="ops-document"><b>${plan.status === "finalized" ? "الخطة النهائية" : "كشف توزيع الكوادر"}</b><span>${escapeHtml(plan.request_date)}</span><small>مرجع ${escapeHtml(plan.id.slice(0, 8))}</small></div></header>
  <div class="ops-details">${metric("طالب الخطة", plan.applicant_name || "—")}${metric("منشئ الطلب", plan.requested_by_name || "—")}${metric("كود التكلفة CTR", site?.ctr_code || "—")}</div>
  <div class="ops-metrics">${metric("الكادر المطلوب", required)}${metric("الكادر الموزّع", assigned)}${metric("المتبقي", missing)}${metric("التخصصات", specialties.length)}</div>
  <div class="ops-specialties">${summary}</div><h3>كشف الكادر</h3><table class="ops-roster"><thead><tr><th class="ops-num">#</th><th>اسم الموظف</th><th class="ops-num">الرقم الوظيفي</th><th>رقم الهاتف</th><th>القسم</th></tr></thead><tbody>${rows || '<tr><td colspan="5">لا توجد تخصصات</td></tr>'}</tbody></table>${notes}${signatures(["المهندس / طالب الخطة", "قسم التخطيط", "منسق الكوادر / الاعتماد"])}<footer class="ops-footer"><span>منظومة زِكت · كشف الكوادر</span><span>${escapeHtml(plan.site_name)} / ${escapeHtml(plan.request_date)}</span></footer></section>`;
}

type WorkshopLine = { attended: boolean; role_label: string | null; employee_no_snapshot: string; employee_name_snapshot: string };
export function workshopReportMarkup({ name, date, notes, lines }: { name: string; date: string; notes?: string | null; lines: WorkshopLine[] }) {
  const present = lines.filter((line) => line.attended);
  const roles = new Map<string, { total: number; present: number }>();
  for (const line of lines) {
    const role = line.role_label?.trim() || "بدون صفة";
    const counts = roles.get(role) ?? { total: 0, present: 0 };
    counts.total++; if (line.attended) counts.present++;
    roles.set(role, counts);
  }
  const statistics = [...roles].sort((a, b) => b[1].total - a[1].total).map(([role, counts]) => `<span><b>${escapeHtml(role)}</b><em>${counts.present} / ${counts.total}</em></span>`).join("");
  const rows = present.map((line, index) => `<tr><td class="ops-num">${index + 1}</td><td class="ops-name">${escapeHtml(line.employee_name_snapshot)}</td><td class="ops-num">${escapeHtml(line.employee_no_snapshot)}</td><td>${escapeHtml(line.role_label || "—")}</td></tr>`).join("");
  return `<section class="ops-report ops-sheet"><header class="ops-header"><div><span class="ops-kicker">منظومة زِكت / الجرد اليومي للورش</span><h2>${escapeHtml(name)}</h2><p>سجل حضور الكادر</p></div><div class="ops-document"><b>تقرير الورشة اليومي</b><span>${escapeHtml(date)}</span></div></header><div class="ops-metrics">${metric("إجمالي الكادر", lines.length)}${metric("الحاضرون", present.length)}${metric("الغائبون", lines.length - present.length)}${metric("نسبة الحضور", `${lines.length ? Math.round(present.length / lines.length * 100) : 0}%`)}</div><div class="ops-section-label"><h3>ملخص التخصصات</h3><span>الحاضر / المنسب</span></div><div class="ops-specialties">${statistics}</div><div class="ops-section-label"><h3>كشف الحاضرين</h3><span>${present.length} موظف</span></div><table class="ops-roster"><thead><tr><th class="ops-num">#</th><th>اسم الموظف</th><th class="ops-num">الرقم الوظيفي</th><th>التخصص / الصفة</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="ops-empty">لا يوجد حضور مسجل</td></tr>'}</tbody></table>${notes ? `<div class="ops-note"><b>ملاحظات الورشة</b><p>${escapeHtml(notes)}</p></div>` : ""}${signatures(["مسؤول الورشة", "إعداد الجرد", "التدقيق / الاعتماد"])}<footer class="ops-footer"><span>منظومة زِكت · الجرد اليومي</span><span>${escapeHtml(name)} / ${escapeHtml(date)}</span></footer></section>`;
}