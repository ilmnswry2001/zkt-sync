import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useProjectExecution } from "@/lib/use-project-execution";
import { todayInBaghdad } from "@/lib/date-time";
import { MetricCard } from "@/components/MetricCard";
import { WorkshopSitePicker } from "@/components/WorkshopManagementFields";
import { workshopSiteLabel, type WorkshopSiteOption } from "@/lib/workshop-management";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { normalizeStaffSearch } from "@/lib/planning-staff";

export function ProjectExecutionPanel({
  date: controlledDate,
  sites,
  siteId,
}: {
  date?: string;
  sites: WorkshopSiteOption[];
  siteId?: string;
}) {
  const [localDate, setDate] = useState(todayInBaghdad());
  const [localSite, setSite] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [limit, setLimit] = useState(25);
  const [expanded, setExpanded] = useState(false);
  const date = controlledDate ?? localDate;
  const site = siteId ?? localSite;
  const execution = useProjectExecution(date);
  const people = execution.data ?? [];
  const scoped = people.filter((p) => !site || p.site_id === site);
  const conflicts = people.filter((p) => p.conflicting).length;
  const unallocated = people.filter((p) => !p.site_id && !p.conflicting).length;
  const rows = scoped.filter(
    (p) =>
      normalizeStaffSearch(`${p.full_name} ${p.employee_no} ${p.specialty}`).includes(
        normalizeStaffSearch(search),
      ) &&
      (status === "all" || (status === "issues" ? !p.site_id : p.assignment_source === status)),
  );
  const labels: Record<string, string> = {
    individual: "توزيع الكادر",
    workshop: "تكليف الورشة",
    plan: "الخطة المعتمدة",
    conflict: "تعارض إسناد",
    unallocated: "دون مركز تكلفة",
  };
  return (
    <section
      id="project-execution-ledger"
      className="space-y-5 rounded-2xl border bg-card p-4 sm:p-6"
      dir="rtl"
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">سجل التنفيذ المتحقق من البصمة</h2>
          <p className="mt-2 max-w-3xl text-xs leading-6 text-muted-foreground">
            شخص واحد ومركز تكلفة واحد في اليوم. الأولوية لتوزيع الكادر المحفوظ، ثم تكليف الورشة، ثم
            الخطة المعتمدة. المقر الدائم لا يحدد وجهة التكلفة تلقائياً. يتحدث السجل كل 30 ثانية وعند
            العودة للصفحة.
          </p>
        </div>
        <Button variant="outline" onClick={() => setExpanded(!expanded)}>
          {expanded ? "إخفاء الأفراد" : "تدقيق الأفراد ومصادر الإسناد"}
        </Button>
      </header>
      {!controlledDate && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-3 text-sm">
            تاريخ التنفيذ
            <Input
              type="date"
              max={todayInBaghdad()}
              value={date}
              onChange={(e) => {
                if (e.target.value) setDate(e.target.value);
              }}
            />
          </label>
          <div className="space-y-3">
            <p className="text-sm">المشروع / CTR</p>
            <WorkshopSitePicker
              label="تصفية المشروع"
              sites={sites}
              value={site}
              onChange={(id) => {
                setSite(id);
                setLimit(25);
              }}
            />
          </div>
        </div>
      )}
      {execution.isError ? (
        <div
          role="alert"
          className="space-y-3 rounded-lg border border-destructive/30 p-4 text-sm text-destructive"
        >
          <p>
            تعذر قراءة سجل التنفيذ. تحقق من تطبيق ملف SQL الخاص بالتكامل. لا تُعتمد أرقام التكلفة
            قبل نجاح القراءة.
          </p>
          <Button variant="outline" onClick={() => void execution.refetch()}>
            إعادة المحاولة
          </Button>
        </div>
      ) : execution.isPending ? (
        <p className="text-sm text-muted-foreground">جارٍ مطابقة الحضور والتكليفات...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard title="حضور ذو بصمة ضمن التصفية" value={scoped.length} tone="info" />
            <MetricCard
              title="مسند إلى CTR ضمن التصفية"
              value={scoped.filter((p) => p.site_id).length}
              tone="success"
            />
            <MetricCard title="تعارض إسناد · جميع المواقع" value={conflicts} tone="destructive" />
            <MetricCard title="بصمة دون إسناد · جميع المواقع" value={unallocated} tone="warning" />
          </div>
          {(conflicts > 0 || unallocated > 0) && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
              <span>
                الأفراد غير المسندين والمتعارضون مستبعدون من تكلفة المشاريع حتى تُراجع وجهتهم.
              </span>
              <Button asChild variant="outline" size="sm">
                <Link to="/attendance">مراجعة توزيع الكادر</Link>
              </Button>
            </div>
          )}
          {expanded && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  aria-label="البحث في سجل التنفيذ"
                  placeholder="ابحث بالاسم، الرقم أو التخصص"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setLimit(25);
                  }}
                />
                <select
                  aria-label="مصدر الإسناد"
                  className="h-10 rounded-lg border bg-background px-3 text-sm"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setLimit(25);
                  }}
                >
                  <option value="all">جميع المصادر</option>
                  <option value="individual">توزيع الكادر</option>
                  <option value="workshop">تكليف الورشة</option>
                  <option value="plan">الخطة المعتمدة</option>
                  <option value="issues">غير مسند / متعارض</option>
                </select>
              </div>
              <div className="max-h-[28rem] overflow-auto rounded-lg border">
                <table aria-label="تفاصيل الحضور وتوجيه التكلفة" className="w-full text-sm">
                  <thead>
                    <tr>
                      <th>الموظف / التخصص</th>
                      <th>المشروع وكود CTR</th>
                      <th>مصدر الإسناد</th>
                      <th>أول بصمة · بغداد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, limit).map((p) => {
                      const target = sites.find((s) => s.id === p.site_id);
                      return (
                        <tr key={p.employee_id}>
                          <td>
                            <p className="font-semibold">{p.full_name}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {p.employee_no} · {p.specialty}
                            </p>
                          </td>
                          <td className="min-w-48 whitespace-normal">
                            {target
                              ? workshopSiteLabel(target)
                              : "مستبعد من التكلفة لحين تحديد الوجهة"}
                          </td>
                          <td>
                            <Badge variant={p.conflicting ? "destructive" : "outline"}>
                              {labels[p.assignment_source] ?? p.assignment_source}
                            </Badge>
                          </td>
                          <td className="whitespace-nowrap">
                            {new Date(p.first_punch).toLocaleTimeString("ar-IQ", {
                              timeZone: "Asia/Baghdad",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!rows.length && (
                  <p className="p-6 text-center text-sm text-muted-foreground">
                    لا يوجد حضور مطابق للفلاتر.
                  </p>
                )}
              </div>
              <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                <span>
                  عرض {Math.min(limit, rows.length)} من {rows.length}
                </span>
                {limit < rows.length && (
                  <Button size="sm" variant="outline" onClick={() => setLimit(limit + 25)}>
                    عرض المزيد
                  </Button>
                )}
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            آخر قراءة:{" "}
            {new Date(execution.dataUpdatedAt).toLocaleTimeString("ar-IQ", {
              timeZone: "Asia/Baghdad",
            })}{" "}
            · البصمات المشبوهة وغير المطابقة لموظف مستبعدة.
          </p>
        </>
      )}
    </section>
  );
}
