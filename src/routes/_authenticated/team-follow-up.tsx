import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileText,
  MessageSquare,
  Users,
  XCircle,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/team-follow-up")({
  head: () => ({ meta: [{ title: "متابعة الفريق" }] }),
  component: TeamFollowUpPage,
});

type Department = { id: string; name: string };
type Site = { id: string; name: string; ctr_code: string | null };
type Employee = {
  id: string;
  employee_no: string;
  full_name: string;
  position: string | null;
  department_id: string | null;
  site_id: string | null;
  status: string;
};
type SiteReport = {
  id: string;
  site_id: string;
  report_date: string;
  notes: string | null;
  created_by: string | null;
};

const today = new Date().toISOString().slice(0, 10);
const isSiteAdministrator = (employee: Employee) =>
  /ادار|إدار|site\s*admin|administrator/i.test(employee.position ?? "");

function TeamFollowUpPage() {
  const { isAdmin, isHR, roles } = useAuth();
  const [date, setDate] = useState(today);
  const [departmentId, setDepartmentId] = useState("all");
  const canSeeAll = isAdmin || isHR || roles.includes("supervisor");

  const departmentsQuery = useQuery({
    queryKey: ["team-follow-up-departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("id, name").order("name");
      if (error) throw error;
      return (data ?? []) as Department[];
    },
  });
  const departments = departmentsQuery.data ?? [];
  const allowedDepartmentIds = canSeeAll ? departments.map((department) => department.id) : [];
  const effectiveDepartmentId =
    departmentId !== "all" && allowedDepartmentIds.includes(departmentId) ? departmentId : "all";

  const employeesQuery = useQuery({
    queryKey: ["team-follow-up-employees", allowedDepartmentIds],
    enabled: allowedDepartmentIds.length > 0,
    queryFn: async () => {
      const query = supabase
        .from("employees")
        .select("id, employee_no, full_name, position, department_id, site_id, status")
        .eq("status", "active");
      const { data, error } = await (canSeeAll
        ? query
        : query.in("department_id", allowedDepartmentIds));
      if (error) throw error;
      return (data ?? []) as Employee[];
    },
  });
  const employees = employeesQuery.data ?? [];
  const visibleEmployees =
    effectiveDepartmentId === "all"
      ? employees
      : employees.filter((employee) => employee.department_id === effectiveDepartmentId);
  const siteIds = [
    ...new Set(visibleEmployees.map((employee) => employee.site_id).filter(Boolean)),
  ] as string[];

  const sitesQuery = useQuery({
    queryKey: ["team-follow-up-sites", siteIds],
    enabled: siteIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sites")
        .select("id, name, ctr_code")
        .in("id", siteIds);
      if (error) throw error;
      return (data ?? []) as Site[];
    },
  });
  const reportsQuery = useQuery({
    queryKey: ["team-follow-up-reports", siteIds, date],
    enabled: siteIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_daily_reports")
        .select("id, site_id, report_date, notes, created_by")
        .in("site_id", siteIds)
        .eq("report_date", date);
      if (error) throw error;
      return (data ?? []) as SiteReport[];
    },
  });
  const reports = reportsQuery.data ?? [];
  const sites = sitesQuery.data ?? [];
  const siteById = new Map(sites.map((site) => [site.id, site]));
  const reportBySite = new Map(reports.map((report) => [report.site_id, report]));
  const departmentById = new Map(departments.map((department) => [department.id, department]));
  const siteAdminCount = visibleEmployees.filter(isSiteAdministrator).length;
  const coveredSites = siteIds.filter((siteId) => reportBySite.has(siteId)).length;
  const notesCount = reports.filter((report) => report.notes?.trim()).length;
  const reportCoverage = siteIds.length ? Math.round((coveredSites / siteIds.length) * 100) : 0;

  const siteRows = siteIds
    .map((siteId) => {
      const team = visibleEmployees.filter((employee) => employee.site_id === siteId);
      const administrators = team.filter(isSiteAdministrator);
      return { site: siteById.get(siteId), team, administrators, report: reportBySite.get(siteId) };
    })
    .sort((a, b) => (a.site?.name ?? "").localeCompare(b.site?.name ?? "", "ar"));

  if (!canSeeAll && !allowedDepartmentIds.length) {
    return (
      <div className="space-y-6">
        <Card className="border-warning/40">
          <CardContent className="p-6 flex items-start gap-3">
            <AlertTriangle className="text-warning mt-1" />
            <div>
              <h1 className="text-2xl font-bold">متابعة الفريق</h1>
              <p className="text-muted-foreground mt-2">
                لم يتم تعيينك كرئيس لأي قسم بعد. اطلب من مدير النظام تعيين حسابك في حقل رئيس القسم
                من صفحة الأقسام.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">متابعة الفريق</h1>
          <p className="text-muted-foreground mt-1">
            لوحة متابعة الموظفين الإداريين وتقارير المواقع والملاحظات اليومية
          </p>
        </div>
        <Badge variant="outline">
          الصلاحية:{" "}
          {canSeeAll
            ? "مدير النظام / الموارد البشرية"
            : roles.includes("supervisor")
              ? "رئيس قسم"
              : "مشاهدة محدودة"}
        </Badge>
      </div>
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-4">
          <div className="w-full sm:w-64">
            <Label>القسم</Label>
            <Select value={effectiveDepartmentId} onValueChange={setDepartmentId}>
              <SelectTrigger>
                <SelectValue placeholder="كل الأقسام المسموحة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأقسام المسموحة</SelectItem>
                {departments
                  .filter((department) => allowedDepartmentIds.includes(department.id))
                  .map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full sm:w-48">
            <Label>تاريخ التقارير</Label>
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setDate(today);
              setDepartmentId("all");
            }}
          >
            اليوم
          </Button>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        <Stat icon={Users} label="موظفو الفريق" value={visibleEmployees.length} />
        <Stat icon={Users} label="إداريو المواقع" value={siteAdminCount} tone="blue" />
        <Stat icon={ClipboardList} label="المواقع" value={siteIds.length} tone="purple" />
        <Stat
          icon={CheckCircle2}
          label="تقارير مرفوعة"
          value={`${coveredSites} / ${siteIds.length}`}
          tone="green"
        />
        <Stat icon={MessageSquare} label="تقارير بها ملاحظات" value={notesCount} tone="orange" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            تغطية تقارير المواقع — {date} ({reportCoverage}%)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-3 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${reportCoverage}%` }}
            />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>حالة المواقع والفرق الإدارية</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الموقع</TableHead>
                <TableHead>القسم</TableHead>
                <TableHead>إداريو الموقع</TableHead>
                <TableHead>إجمالي الفريق</TableHead>
                <TableHead>التقرير اليومي</TableHead>
                <TableHead>الملاحظات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {siteRows.map(({ site, team, administrators, report }) => (
                <TableRow key={site?.id}>
                  <TableCell className="font-medium">
                    {site?.name ?? "موقع غير محدد"}
                    <div className="text-xs text-muted-foreground">{site?.ctr_code ?? ""}</div>
                  </TableCell>
                  <TableCell>
                    {[
                      ...new Set(
                        team
                          .map((employee) => departmentById.get(employee.department_id ?? "")?.name)
                          .filter(Boolean),
                      ),
                    ].join("، ") || "-"}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {administrators.length ? (
                        administrators.map((employee) => (
                          <div key={employee.id}>
                            {employee.full_name}
                            <span className="text-xs text-muted-foreground mr-2">
                              {employee.position}
                            </span>
                          </div>
                        ))
                      ) : (
                        <span className="text-warning">لم يُصنف إداري موقع</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{team.length}</TableCell>
                  <TableCell>
                    {report ? (
                      <Badge>
                        <CheckCircle2 className="w-3 h-3 ml-1" /> مرفوع
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        <XCircle className="w-3 h-3 ml-1" /> لم يرفع
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs">
                    {report?.notes?.trim() ? (
                      <span className="inline-flex items-center gap-1">
                        <FileText className="w-4 h-4 text-primary" />
                        {report.notes}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">لا توجد ملاحظات</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!siteRows.length && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                    لا توجد مواقع أو موظفون تابعون للنطاق المحدد
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>الموظفون التابعون للقسم</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الرقم</TableHead>
                <TableHead>الموظف</TableHead>
                <TableHead>التخصص</TableHead>
                <TableHead>الموقع</TableHead>
                <TableHead>حالة تقرير الموقع</TableHead>
                <TableHead>دور المتابعة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleEmployees.map((employee) => {
                const report = employee.site_id ? reportBySite.get(employee.site_id) : undefined;
                return (
                  <TableRow key={employee.id}>
                    <TableCell>{employee.employee_no}</TableCell>
                    <TableCell className="font-medium">{employee.full_name}</TableCell>
                    <TableCell>{employee.position ?? "-"}</TableCell>
                    <TableCell>
                      {siteById.get(employee.site_id ?? "")?.name ?? "غير محدد"}
                    </TableCell>
                    <TableCell>
                      {report ? (
                        <Badge>
                          <CheckCircle2 className="w-3 h-3 ml-1" /> مرفوع
                        </Badge>
                      ) : (
                        <Badge variant="destructive">
                          <XCircle className="w-3 h-3 ml-1" /> لم يرفع
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {isSiteAdministrator(employee) ? (
                        <Badge variant="outline">رافع تقرير الموقع</Badge>
                      ) : (
                        <span className="text-muted-foreground">عضو فريق</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone = "green",
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
  tone?: string;
}) {
  const toneClass =
    {
      green: "bg-green-600",
      blue: "bg-blue-600",
      purple: "bg-purple-600",
      orange: "bg-orange-600",
    }[tone] ?? "bg-green-600";
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`rounded-xl p-3 ${toneClass}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
