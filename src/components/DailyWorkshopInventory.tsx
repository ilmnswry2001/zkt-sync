import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { todayInBaghdad } from "@/lib/date-time";
import { escapeHtml, printReport } from "@/lib/report-print";
import { formatErrorMessage } from "@/lib/error-message";
import { getDefaultWage } from "@/lib/wage-defaults";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Check,
  ChevronsUpDown,
  ClipboardCheck,
  HardHat,
  Plus,
  Printer,
  Save,
  Trash2,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

type Workshop = { id: string; name: string; is_active: boolean };
type Employee = { id: string; employee_no: string; full_name: string; position: string | null };
type Member = {
  id: string;
  workshop_id: string;
  employee_id: string;
  role_label: string | null;
  is_active: boolean;
};
type DailyReport = { id: string; workshop_id: string; report_date: string; notes: string | null };
type AttendanceLine = {
  id: string;
  report_id: string;
  employee_id: string;
  employee_no_snapshot: string;
  employee_name_snapshot: string;
  role_label: string | null;
  attended: boolean;
  site_id: string | null;
};
type WorkSite = { id: string; name: string; ctr_code: string };
type WageRate = { title: string; daily_rate: number; monthly_rate: number };
const supa = supabase as any;
const inputClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
const noWorkshops: Workshop[] = [];
const noEmployees: Employee[] = [];
const noMembers: Member[] = [];

async function loadActiveEmployees(): Promise<Employee[]> {
  const rows: Employee[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supa
      .from("employees")
      .select("id, employee_no, full_name, position")
      .eq("status", "active")
      .order("full_name")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

export function DailyWorkshopInventory() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("inventory");
  const [date, setDate] = useState(todayInBaghdad());
  const [workshopId, setWorkshopId] = useState("");
  const [workshopName, setWorkshopName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [employeePickerOpen, setEmployeePickerOpen] = useState(false);
  const [roleLabel, setRoleLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [attendedByEmployee, setAttendedByEmployee] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const sitesQuery = useQuery<WorkSite[]>({
    queryKey: ["daily-work-allocation-sites"],
    queryFn: async () => {
      const { data, error } = await supa.from("sites").select("id, name, ctr_code").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const wagesQuery = useQuery<WageRate[]>({
    queryKey: ["daily-work-allocation-wages"],
    queryFn: async () => {
      const { data, error } = await supa.from("wage_rates").select("title, daily_rate, monthly_rate");
      if (error) throw error;
      return data ?? [];
    },
  });

  const workshopsQuery = useQuery<Workshop[]>({
    queryKey: ["daily-workshops"],
    queryFn: () =>
      supa
        .from("daily_workshops")
        .select("id, name, is_active")
        .eq("is_active", true)
        .order("name")
        .then(({ data, error }: any) => {
          if (error) throw error;
          return data ?? [];
        }),
  });
  const employeesQuery = useQuery<Employee[]>({
    queryKey: ["daily-workshop-employees"],
    queryFn: loadActiveEmployees,
  });
  const membersQuery = useQuery<Member[]>({
    queryKey: ["daily-workshop-members", workshopId],
    enabled: !!workshopId,
    queryFn: async () => {
      const { data, error } = await supa
        .from("daily_workshop_members")
        .select("id, workshop_id, employee_id, role_label, is_active")
        .eq("workshop_id", workshopId)
        .eq("is_active", true)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
  const reportQuery = useQuery({
    queryKey: ["daily-workshop-reports", date],
    queryFn: async () => {
      const { data: reports, error } = await supa
        .from("daily_workshop_reports")
        .select("id, workshop_id, report_date, notes")
        .eq("report_date", date)
        .order("created_at");
      if (error) throw error;
      const ids = (reports ?? []).map((report: DailyReport) => report.id);
      if (!ids.length) return { reports: [] as DailyReport[], lines: [] as AttendanceLine[] };
      const { data: lines, error: linesError } = await supa
        .from("daily_workshop_report_lines")
        .select(
          "id, report_id, employee_id, employee_no_snapshot, employee_name_snapshot, role_label, attended, site_id",
        )
        .in("report_id", ids)
        .order("employee_name_snapshot");
      if (linesError) throw linesError;
      return { reports: reports as DailyReport[], lines: (lines ?? []) as AttendanceLine[] };
    },
  });

  const workshops = workshopsQuery.data ?? noWorkshops;
  const employees = employeesQuery.data ?? noEmployees;
  const members = membersQuery.data ?? noMembers;
  const selectedWorkshop = workshops.find((workshop) => workshop.id === workshopId);
  const activeRoster = useMemo(
    () =>
      members
        .map((member) => ({
          ...member,
          employee: employees.find((employee) => employee.id === member.employee_id),
        }))
        .filter((member) => member.employee),
    [members, employees],
  );
  const savedReport = reportQuery.data?.reports.find((report) => report.workshop_id === workshopId);
  const savedLines = useMemo(
    () => reportQuery.data?.lines.filter((line) => line.report_id === savedReport?.id) ?? [],
    [reportQuery.data?.lines, savedReport?.id],
  );
  const selectedEmployee = employees.find((employee) => employee.id === employeeId);
  const sites = sitesQuery.data ?? [];
  const presentLines = (reportQuery.data?.lines ?? []).filter((line) => line.attended);
  const wageByTitle = new Map((wagesQuery.data ?? []).map((wage) => [wage.title.trim(), wage]));
  const dailyCost = (line: AttendanceLine) => {
    const title = line.role_label?.trim() || "";
    const wage = wageByTitle.get(title);
    const fallback = getDefaultWage(title);
    return Number(wage?.daily_rate) > 0
      ? Number(wage?.daily_rate)
      : Number(wage?.monthly_rate) > 0
        ? Number(wage?.monthly_rate) / 26
        : fallback.daily_rate;
  };

  useEffect(() => {
    if (!workshopId && workshops[0]) setWorkshopId(workshops[0].id);
  }, [workshopId, workshops]);
  useEffect(() => {
    if (reportQuery.isLoading) return;
    setNotes(savedReport?.notes ?? "");
    setAttendedByEmployee(
      Object.fromEntries(savedLines.map((line) => [line.employee_id, line.attended])),
    );
  }, [date, workshopId, reportQuery.isLoading, savedReport, savedLines]);

  const refreshData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["daily-workshops"] }),
      queryClient.invalidateQueries({ queryKey: ["daily-workshop-members"] }),
      queryClient.invalidateQueries({ queryKey: ["daily-workshop-reports"] }),
    ]);
  };

  const createWorkshop = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = workshopName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const { data, error } = await supa
        .from("daily_workshops")
        .insert({ name })
        .select("id")
        .single();
      if (error) throw error;
      setWorkshopName("");
      setWorkshopId(data.id);
      await refreshData();
      toast.success("تمت إضافة الورشة");
    } catch (error) {
      toast.error(formatErrorMessage(error, "تعذر إضافة الورشة"));
    } finally {
      setSaving(false);
    }
  };

  const addMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const employee = employees.find((item) => item.id === employeeId);
    if (!workshopId || !employee) return toast.error("اختر الورشة والموظف");
    setSaving(true);
    try {
      const { error } = await supa.from("daily_workshop_members").upsert(
        {
          workshop_id: workshopId,
          employee_id: employee.id,
          role_label: roleLabel.trim() || employee.position || null,
          is_active: true,
        },
        { onConflict: "workshop_id,employee_id" },
      );
      if (error) throw error;
      setEmployeeId("");
      setRoleLabel("");
      await refreshData();
      toast.success("تم إسناد الموظف إلى الورشة");
    } catch (error) {
      toast.error(formatErrorMessage(error, "تعذر إضافة الموظف"));
    } finally {
      setSaving(false);
    }
  };

  const removeMember = async (member: Member) => {
    const { error } = await supa
      .from("daily_workshop_members")
      .update({ is_active: false })
      .eq("id", member.id);
    if (error) return toast.error(formatErrorMessage(error, "تعذر إزالة الموظف من الورشة"));
    await refreshData();
    toast.success("تمت إزالة الموظف من قائمة الورشة مع الاحتفاظ بالسجلات السابقة");
  };

  const saveDailyReport = async () => {
    if (!workshopId) return toast.error("أضف ورشة أو اخترها أولاً");
    if (!activeRoster.length) return toast.error("أضف الموظفين إلى الورشة أولاً");
    setSaving(true);
    try {
      const { data: header, error: headerError } = await supa
        .from("daily_workshop_reports")
        .upsert(
          {
            workshop_id: workshopId,
            report_date: date,
            notes: notes.trim() || null,
            recorded_by: (await supabase.auth.getUser()).data.user?.id ?? null,
          },
          { onConflict: "workshop_id,report_date" },
        )
        .select("id")
        .single();
      if (headerError || !header) throw headerError ?? new Error("تعذر إنشاء سجل الجرد");
      const reportLines = activeRoster.map(({ employee, role_label }) => ({
        report_id: header.id,
        employee_id: employee!.id,
        employee_no_snapshot: employee!.employee_no,
        employee_name_snapshot: employee!.full_name,
        role_label: role_label?.trim() || employee!.position || null,
        attended: attendedByEmployee[employee!.id] === true,
      }));
      const { error: linesError } = await supa
        .from("daily_workshop_report_lines")
        .upsert(reportLines, {
          onConflict: "report_id,employee_id",
        });
      if (linesError) throw linesError;
      await refreshData();
      toast.success("تم حفظ جرد الورشة لهذا اليوم");
    } catch (error) {
      toast.error(formatErrorMessage(error, "تعذر حفظ الجرد اليومي"));
    } finally {
      setSaving(false);
    }
  };

  const assignSite = async (line: AttendanceLine, siteId: string) => {
    const otherAssignment = presentLines.find(
      (item) => item.employee_id === line.employee_id && item.id !== line.id && item.site_id,
    );
    if (siteId && otherAssignment) {
      return toast.error("هذا الموظف مسند بالفعل إلى مركز تكلفة آخر اليوم؛ ألغِ إسناده السابق أولاً");
    }
    const { error } = await supa
      .from("daily_workshop_report_lines")
      .update({ site_id: siteId || null })
      .eq("id", line.id);
    if (error) return toast.error(formatErrorMessage(error, "تعذر إسناد الموظف إلى مركز التكلفة"));
    await queryClient.invalidateQueries({ queryKey: ["daily-workshop-reports", date] });
    await queryClient.invalidateQueries({ queryKey: ["daily-crew-assignments", date] });
    await queryClient.invalidateQueries({ queryKey: ["projects-dashboard", date] });
    await queryClient.invalidateQueries({ queryKey: ["site-finalized-plan-follow-up"] });
    toast.success("تم تحديث مركز تكلفة الموظف لهذا اليوم");
  };

  const printDailyReport = () => {
    const savedReports = reportQuery.data?.reports ?? [];
    const allLines = reportQuery.data?.lines ?? [];
    if (!savedReports.length) return toast.error("لا توجد تقارير محفوظة لهذا التاريخ");
    const content = savedReports
      .map((report) => {
        const workshop = workshops.find((item) => item.id === report.workshop_id);
        const lines = allLines.filter((line) => line.report_id === report.id);
        const attended = lines.filter((line) => line.attended);
        const absent = lines.filter((line) => !line.attended);
        const makeTable = (title: string, items: AttendanceLine[]) =>
          `<h3>${title} (${items.length})</h3><table><thead><tr><th>الرقم الوظيفي</th><th>الاسم</th><th>الصفة</th></tr></thead><tbody>${items.map((line) => `<tr><td>${escapeHtml(line.employee_no_snapshot)}</td><td>${escapeHtml(line.employee_name_snapshot)}</td><td>${escapeHtml(line.role_label ?? "—")}</td></tr>`).join("")}</tbody></table>`;
        return `<section><h2>${escapeHtml(workshop?.name ?? "ورشة")}</h2><p>إجمالي الكادر: ${lines.length} · حضروا البصمة: ${attended.length} · لم يسجل حضورهم: ${absent.length}</p>${makeTable("الحاضرون", attended)}${makeTable("غير الحاضرين", absent)}${report.notes ? `<p><b>ملاحظات:</b> ${escapeHtml(report.notes)}</p>` : ""}</section>`;
      })
      .join("");
    if (
      !printReport(`الجرد اليومي للورش — ${date}`, `<p>التاريخ: ${escapeHtml(date)}</p>${content}`)
    ) {
      toast.error("اسمح بالنوافذ المنبثقة لطباعة التقرير");
    }
  };

  const allReportLines = reportQuery.data?.lines ?? [];
  const totalPresent = allReportLines.filter((line) => line.attended).length;
  const totalRostered = allReportLines.length;

  return (
    <div className="space-y-4">
      {(workshopsQuery.error ||
        employeesQuery.error ||
        membersQuery.error ||
        reportQuery.error) && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          تعذر تحميل بيانات الجرد:{" "}
          {formatErrorMessage(
            workshopsQuery.error ?? employeesQuery.error ?? membersQuery.error ?? reportQuery.error,
          )}
        </p>
      )}
      <Tabs value={tab} onValueChange={setTab} dir="rtl" className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-4 gap-2 bg-transparent p-0">
          <TabsTrigger value="inventory" className="min-h-11 rounded-xl border bg-card">
            <ClipboardCheck className="ml-2 h-4 w-4" /> تسجيل الجرد
          </TabsTrigger>
          <TabsTrigger value="workshops" className="min-h-11 rounded-xl border bg-card">
            <HardHat className="ml-2 h-4 w-4" /> إعداد الورش
          </TabsTrigger>
          <TabsTrigger value="reports" className="min-h-11 rounded-xl border bg-card">
            <Printer className="ml-2 h-4 w-4" /> سجل وتقارير اليوم
          </TabsTrigger>
          <TabsTrigger value="allocation" className="min-h-11 rounded-xl border bg-card">
            <UsersRound className="ml-2 h-4 w-4" /> تقسيم الكادر
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inventory" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5 text-primary" /> تسجيل حضور البصمة
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="workshop-inventory-date">التاريخ</Label>
                  <Input
                    id="workshop-inventory-date"
                    type="date"
                    max={todayInBaghdad()}
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="workshop-inventory-select">الورشة</Label>
                  <select
                    id="workshop-inventory-select"
                    className={inputClass}
                    value={workshopId}
                    onChange={(event) => setWorkshopId(event.target.value)}
                  >
                    <option value="">اختر الورشة</option>
                    {workshops.map((workshop) => (
                      <option key={workshop.id} value={workshop.id}>
                        {workshop.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {selectedWorkshop && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/20 p-3">
                  <div>
                    <p className="font-semibold">{selectedWorkshop.name}</p>
                    <p className="text-xs text-muted-foreground">
                      علّم الموظفين الذين حضروا لتسجيل البصمة
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setAttendedByEmployee(
                          Object.fromEntries(
                            activeRoster.map(({ employee }) => [employee!.id, true]),
                          ),
                        )
                      }
                    >
                      تحديد الكل حاضر
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setAttendedByEmployee({})}>
                      إلغاء التحديد
                    </Button>
                  </div>
                </div>
              )}
              {!workshopId ? (
                <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
                  اختر ورشة، أو أضف ورشة من تبويب إعداد الورش.
                </p>
              ) : membersQuery.isLoading ? (
                <p className="p-8 text-center text-muted-foreground">جارٍ تحميل كادر الورشة...</p>
              ) : !activeRoster.length ? (
                <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
                  لا يوجد موظفون في هذه الورشة. أضف الكادر من تبويب إعداد الورش.
                </p>
              ) : (
                <div className="space-y-2">
                  {activeRoster.map(({ id, employee, role_label }) => (
                    <label
                      key={id}
                      className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 transition ${attendedByEmployee[employee!.id] ? "border-emerald-500/50 bg-emerald-500/5" : "hover:bg-muted/30"}`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-emerald-600"
                          checked={attendedByEmployee[employee!.id] === true}
                          onChange={(event) =>
                            setAttendedByEmployee((current) => ({
                              ...current,
                              [employee!.id]: event.target.checked,
                            }))
                          }
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{employee!.full_name}</p>
                          <p className="text-xs text-muted-foreground">{employee!.employee_no}</p>
                        </div>
                      </div>
                      <Badge variant="secondary">
                        {role_label?.trim() || employee!.position || "بدون صفة"}
                      </Badge>
                    </label>
                  ))}
                </div>
              )}
              {workshopId && activeRoster.length > 0 && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="workshop-report-notes">ملاحظات (اختياري)</Label>
                    <Textarea
                      id="workshop-report-notes"
                      value={notes}
                      maxLength={2000}
                      onChange={(event) => setNotes(event.target.value)}
                      placeholder="ملاحظات تخص حضور الورشة اليوم..."
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">
                      الحاضرون:{" "}
                      {
                        activeRoster.filter(({ employee }) => attendedByEmployee[employee!.id])
                          .length
                      }{" "}
                      من {activeRoster.length}
                      {savedReport ? " · يوجد سجل محفوظ لهذا اليوم" : ""}
                    </p>
                    <Button onClick={() => void saveDailyReport()} disabled={saving}>
                      <Save className="ml-2 h-4 w-4" />
                      {saving ? "جارٍ الحفظ..." : "حفظ جرد الورشة"}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="workshops" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>إضافة ورشة</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(event) => void createWorkshop(event)}
                className="flex flex-col gap-3 sm:flex-row"
              >
                <Input
                  value={workshopName}
                  maxLength={120}
                  onChange={(event) => setWorkshopName(event.target.value)}
                  placeholder="مثال: ورشة عبدالجبار"
                  required
                />
                <Button type="submit" disabled={saving || workshopName.trim().length < 2}>
                  <Plus className="ml-2 h-4 w-4" />
                  إضافة الورشة
                </Button>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UsersRound className="h-5 w-5 text-primary" /> إدارة كادر الورشة
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="manage-workshop-select">الورشة</Label>
                <select
                  id="manage-workshop-select"
                  className={inputClass}
                  value={workshopId}
                  onChange={(event) => setWorkshopId(event.target.value)}
                >
                  <option value="">اختر الورشة</option>
                  {workshops.map((workshop) => (
                    <option key={workshop.id} value={workshop.id}>
                      {workshop.name}
                    </option>
                  ))}
                </select>
              </div>
              {workshopId && (
                <form
                  onSubmit={(event) => void addMember(event)}
                  className="grid gap-3 rounded-xl border bg-muted/20 p-3 sm:grid-cols-[1fr_1fr_auto]"
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="roster-employee">الموظف</Label>
                    <Popover open={employeePickerOpen} onOpenChange={setEmployeePickerOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          id="roster-employee"
                          type="button"
                          variant="outline"
                          role="combobox"
                          aria-expanded={employeePickerOpen}
                          aria-required="true"
                          className="h-10 w-full justify-between font-normal"
                        >
                          <span className="truncate">
                            {selectedEmployee
                              ? `${selectedEmployee.employee_no} — ${selectedEmployee.full_name}`
                              : "ابحث بالاسم أو الرقم الوظيفي..."}
                          </span>
                          <ChevronsUpDown className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        className="w-[--radix-popover-trigger-width] p-0"
                        align="start"
                      >
                        <Command>
                          <CommandInput placeholder="اكتب اسم الموظف أو رقمه الوظيفي..." />
                          <CommandList>
                            <CommandEmpty>لا يوجد موظف مطابق للبحث.</CommandEmpty>
                            <CommandGroup>
                              {employees.map((employee) => (
                                <CommandItem
                                  key={employee.id}
                                  value={`${employee.employee_no} ${employee.full_name}`}
                                  onSelect={() => {
                                    setEmployeeId(employee.id);
                                    setRoleLabel(employee.position ?? "");
                                    setEmployeePickerOpen(false);
                                  }}
                                >
                                  <Check
                                    className={`h-4 w-4 ${employeeId === employee.id ? "opacity-100" : "opacity-0"}`}
                                  />
                                  <span>
                                    {employee.employee_no} — {employee.full_name}
                                  </span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="roster-role">الصفة في الورشة</Label>
                    <Input
                      id="roster-role"
                      value={roleLabel}
                      maxLength={120}
                      onChange={(event) => setRoleLabel(event.target.value)}
                      placeholder="عامل، كوسرجي..."
                    />
                  </div>
                  <Button type="submit" disabled={saving || !employeeId} className="self-end">
                    <Plus className="ml-2 h-4 w-4" />
                    إضافة للكادر
                  </Button>
                </form>
              )}
              {!workshopId ? (
                <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
                  اختر ورشة لإدارة كادرها.
                </p>
              ) : (
                <div className="space-y-2">
                  {activeRoster.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between gap-3 rounded-xl border p-3"
                    >
                      <div>
                        <p className="font-medium">{member.employee?.full_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {member.employee?.employee_no} ·{" "}
                          {member.role_label || member.employee?.position || "بدون صفة"}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`إزالة ${member.employee?.full_name} من الورشة`}
                        onClick={() => void removeMember(member)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  {!activeRoster.length && (
                    <p className="py-8 text-center text-muted-foreground">
                      لم تتم إضافة موظفين لهذه الورشة.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>الجرد اليومي للورش</CardTitle>
                <div className="flex items-center gap-2">
                  <Label htmlFor="workshop-archive-date">التاريخ</Label>
                  <Input
                    id="workshop-archive-date"
                    className="w-auto"
                    type="date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                  />
                  <Button
                    variant="outline"
                    onClick={printDailyReport}
                    disabled={!reportQuery.data?.reports.length}
                  >
                    <Printer className="ml-2 h-4 w-4" />
                    طباعة التقرير
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border p-3">
                  <p className="text-xs text-muted-foreground">ورش سجلت اليوم</p>
                  <p className="mt-1 text-2xl font-bold">{reportQuery.data?.reports.length ?? 0}</p>
                </div>
                <div className="rounded-xl border p-3">
                  <p className="text-xs text-muted-foreground">إجمالي الكادر المسجل</p>
                  <p className="mt-1 text-2xl font-bold">{totalRostered}</p>
                </div>
                <div className="rounded-xl border p-3">
                  <p className="text-xs text-muted-foreground">الحاضرون</p>
                  <p className="mt-1 text-2xl font-bold text-emerald-600">{totalPresent}</p>
                </div>
              </div>
              {(reportQuery.data?.reports ?? []).map((report) => {
                const workshop = workshops.find((item) => item.id === report.workshop_id);
                const lines = (reportQuery.data?.lines ?? []).filter(
                  (line) => line.report_id === report.id,
                );
                const present = lines.filter((line) => line.attended);
                const absent = lines.length - present.length;
                return (
                  <section key={report.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="font-bold">{workshop?.name ?? "ورشة"}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          حضر: {present.length} · لم يحضر: {absent} · الإجمالي: {lines.length}
                        </p>
                        {report.notes && <p className="mt-2 text-sm">{report.notes}</p>}
                      </div>
                      <Badge variant="secondary">{date}</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {present.map((line) => (
                        <Badge key={line.id} className="bg-emerald-600">
                          {line.employee_name_snapshot} · {line.role_label || "بدون صفة"}
                        </Badge>
                      ))}
                      {!present.length && (
                        <span className="text-sm text-muted-foreground">
                          لم يتم تسجيل حضور أي موظف.
                        </span>
                      )}
                    </div>
                  </section>
                );
              })}
              {!reportQuery.isLoading && !reportQuery.data?.reports.length && (
                <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
                  لا توجد جردات محفوظة لهذا التاريخ.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="allocation" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>تقسيم الكادر الحاضر على مراكز التكلفة</CardTitle>
              <p className="text-sm text-muted-foreground">يعرض الموظفين المسجل حضورهم في جرد هذا اليوم فقط. اختر CTR لحساب كلفة العامل ضمن متابعة نشر الموقع.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/30 p-3 text-sm">
                <span>التاريخ: <b>{date}</b> · الحاضرون: <b>{presentLines.length}</b></span>
                <span>إجمالي الكلفة المسندة: <b>{presentLines.reduce((sum, line) => sum + (line.site_id ? dailyCost(line) : 0), 0).toLocaleString("ar-IQ")} د.ع</b></span>
              </div>
              {presentLines.map((line) => {
                const report = reportQuery.data?.reports.find((item) => item.id === line.report_id);
                const workshop = workshops.find((item) => item.id === report?.workshop_id);
                return (
                  <div key={line.id} className="grid gap-3 rounded-xl border p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
                    <div>
                      <p className="font-medium">{line.employee_name_snapshot}</p>
                      <p className="text-xs text-muted-foreground">{workshop?.name ?? "ورشة"} · {line.role_label || "بدون صفة"}</p>
                    </div>
                    <select className={inputClass} aria-label={`مركز تكلفة ${line.employee_name_snapshot}`} value={line.site_id ?? "unassigned"} onChange={(event) => void assignSite(line, event.target.value === "unassigned" ? "" : event.target.value)}>
                      <option value="unassigned">اختر مركز التكلفة CTR</option>
                      {sites.map((site) => <option key={site.id} value={site.id}>{site.ctr_code} — {site.name}</option>)}
                    </select>
                    <Badge variant={line.site_id ? "default" : "secondary"}>{line.site_id ? `${dailyCost(line).toLocaleString("ar-IQ")} د.ع / يوم` : "غير مسند"}</Badge>
                  </div>
                );
              })}
              {!presentLines.length && <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">احفظ جرد الحضور أولاً ليظهر الكادر الحاضر هنا.</p>}
              {sitesQuery.error && <p role="alert" className="text-sm text-destructive">تعذر تحميل مراكز التكلفة: {formatErrorMessage(sitesQuery.error)}</p>}
              {wagesQuery.error && <p role="alert" className="text-sm text-destructive">تعذر تحميل أجور التخصصات: {formatErrorMessage(wagesQuery.error)}</p>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
