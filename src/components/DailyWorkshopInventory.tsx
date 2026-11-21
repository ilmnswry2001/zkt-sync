import { useDirectorySearch } from "@/hooks/use-directory-search";
import { loadAllRows } from "@/lib/monthly-report";
import { WorkshopManagement } from "@/components/WorkshopManagement";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { todayInBaghdad } from "@/lib/date-time";
import { printReport } from "@/lib/report-print";
import { workshopReportMarkup } from "@/lib/operational-report-markup";
import { formatErrorMessage } from "@/lib/error-message";
import { getDefaultWage } from "@/lib/wage-defaults";
import { matchWorkshopPunches } from "@/lib/workshop-management";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Check,
  ChevronsUpDown,
  ClipboardCheck,
  Fingerprint,
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
type Device = {
  id: string;
  name: string;
  serial_number: string | null;
  status: string;
};
type AttendancePunch = {
  id: string;
  employee_id: string | null;
  employee_no: string;
  verify_time: string;
  device_id: string | null;
  status: number | null;
  verify_type: number | null;
  self_event_type: string | null;
  is_suspicious: boolean;
};
type Member = {
  id: string;
  workshop_id: string;
  employee_id: string;
  role_label: string | null;
  is_active: boolean;
  employee: Employee | null;
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
const noMembers: Member[] = [];
const noDevices: Device[] = [];
const noAttendancePunches: AttendancePunch[] = [];

const rosterFields = "id, workshop_id, employee_id, role_label, is_active, employee:employees(id, employee_no, full_name, position, status)";
type RosterRow = Member & { employee: (Employee & { status: string }) | null };
type WorkshopPunchMember = { workshop_id: string; employee_id: string; employee: { employee_no: string } };
type UnassignedPunchPage = {
  rows: { employee: Employee; punch: Pick<AttendancePunch, "id" | "device_id" | "verify_time"> }[];
  totalCount: number;
};
const unassignedPageSize = 20;

function activeRosterMembers(rows: RosterRow[]): Member[] {
  return rows.map((member) => ({
    ...member,
    employee: member.employee?.status === "active" ? member.employee : null,
  }));
}

async function loadAttendancePunches(date: string, column: "device_id" | "employee_no", scopeIds: readonly string[]) {
  const start = new Date(`${date}T00:00:00+03:00`);
  const end = new Date(start.getTime() + 86400000);
  const punches: AttendancePunch[] = [];
  const ids = [...new Set(scopeIds)];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    punches.push(...await loadAllRows<AttendancePunch>((from, to) => supabase
      .from("attendance_logs")
      .select("id, employee_id, employee_no, verify_time, device_id, status, verify_type, self_event_type, is_suspicious")
      .in(column, batch)
      .gte("verify_time", start.toISOString()).lt("verify_time", end.toISOString())
      .eq("is_suspicious", false)
      .or("self_event_type.eq.check_in,and(self_event_type.is.null,or(status.eq.0,and(status.is.null,verify_type.eq.0)))")
      .order("verify_time").order("id").range(from, to)));
  }
  return punches.sort((a, b) => a.verify_time.localeCompare(b.verify_time) || a.id.localeCompare(b.id));
}

type QueuedInventory = {
  key: string;
  workshopId: string;
  date: string;
  notes: string | null;
  lines: Omit<AttendanceLine, "id" | "report_id" | "site_id">[];
};
class OfflineError extends Error {}
const QUEUE_KEY = "workshop-inventory-offline-queue";
function readInventoryQueue(): QueuedInventory[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function queueInventory(item: QueuedInventory) {
  const rest = readInventoryQueue().filter((entry) => entry.key !== item.key);
  localStorage.setItem(QUEUE_KEY, JSON.stringify([...rest, item]));
}
function removeQueuedInventory(key: string) {
  localStorage.setItem(
    QUEUE_KEY,
    JSON.stringify(readInventoryQueue().filter((e) => e.key !== key)),
  );
}
async function submitInventory(item: QueuedInventory) {
  const { data: header, error: headerError } = await supa
    .from("daily_workshop_reports")
    .upsert(
      {
        workshop_id: item.workshopId,
        report_date: item.date,
        notes: item.notes,
        recorded_by: (await supabase.auth.getUser()).data.user?.id ?? null,
      },
      { onConflict: "workshop_id,report_date" },
    )
    .select("id")
    .single();
  if (headerError || !header) throw headerError ?? new Error("تعذر إنشاء سجل الجرد");
  const { error } = await supa.from("daily_workshop_report_lines").upsert(
    item.lines.map((line) => ({ ...line, report_id: header.id })),
    { onConflict: "report_id,employee_id" },
  );
  if (error) throw error;
}

export function DailyWorkshopInventory({initialWorkshopId=""}:{initialWorkshopId?:string}={}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("inventory");
  const [date, setInventoryDate] = useState(todayInBaghdad());
  const dateRef = useRef(date);
  const setDate = (value: string) => {
    dateRef.current = value;
    setInventoryDate(value);
  };
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>(["all"]);
  const [workshopId, setWorkshopId] = useState(initialWorkshopId);
  const [additionalWorkshopId, setAdditionalWorkshopId] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const employeeLookup = useDirectorySearch(employeeSearch);
  const [employeePickerOpen, setEmployeePickerOpen] = useState(false);
  const [roleLabel, setRoleLabel] = useState("");
  const [drafts, setDrafts] = useState<
    Record<string, { attended: Record<string, boolean>; notes: string }>
  >({});
  const [printOpen, setPrintOpen] = useState(false);
  const [printIds, setPrintIds] = useState<string[]>([]);
  const [selectedUnmatchedEmployeeIds, setSelectedUnmatchedEmployeeIds] = useState<string[]>([]);
  const [unassignedPage, setUnassignedPage] = useState(0);
  const [bulkTargetWorkshopId, setBulkTargetWorkshopId] = useState("");
  const [saving, setSaving] = useState(false);
  const [markingBiometrics, setMarkingBiometrics] = useState(false);
  const [dismissedPunchEmployees, setDismissedPunchEmployees] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedWorkshopByPunch, setSelectedWorkshopByPunch] = useState<Record<string, string>>(
    {},
  );
  useEffect(() => setDrafts({}), [date]);
  useEffect(() => {
    setUnassignedPage(0);
    setSelectedUnmatchedEmployeeIds([]);
    setDismissedPunchEmployees(new Set());
    setSelectedWorkshopByPunch({});
  }, [date, selectedDeviceIds]);

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
      const { data, error } = await supa
        .from("wage_rates")
        .select("title, daily_rate, monthly_rate");
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
        .order("sort_order").order("name")
        .then(({ data, error }: any) => {
          if (error) throw error;
          return data ?? [];
        }),
  });
  const devicesQuery = useQuery<Device[]>({
    queryKey: ["daily-workshop-attendance-devices"],
    queryFn: async () => {
      const { data, error } = await supa
        .from("devices")
        .select("id, name, serial_number, status")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const membersQuery = useQuery<Member[]>({
    queryKey: ["daily-workshop-members", workshopId],
    enabled: !!workshopId,
    queryFn: async () => {
      const rows = await loadAllRows<RosterRow>((from, to) => supa
        .from("daily_workshop_members").select(rosterFields)
        .eq("workshop_id", workshopId).eq("is_active", true)
        .order("created_at").order("id").range(from, to));
      return activeRosterMembers(rows);
    },
  });
  const members = membersQuery.data ?? noMembers;
  const bySelectedDevices = !selectedDeviceIds.includes("all");
  const scopeIds = bySelectedDevices ? selectedDeviceIds : members.flatMap(({ employee }) => employee?.employee_no ?? []);
  const attendancePunchesQuery = useQuery<AttendancePunch[]>({
    queryKey: ["daily-workshop-attendance-punches", date, bySelectedDevices, scopeIds],
    enabled: tab === "inventory" && !!date && scopeIds.length > 0,
    queryFn: () => loadAttendancePunches(date, bySelectedDevices ? "device_id" : "employee_no", scopeIds),
  });
  const activeWorkshopMembersQuery = useQuery({
    queryKey: ["daily-workshop-all-active-members"],
    enabled: tab === "inventory" && bySelectedDevices,
    queryFn: () => loadAllRows<WorkshopPunchMember>((from, to) => supabase
      .from("daily_workshop_members")
      .select("workshop_id, employee_id, workshop:daily_workshops!inner(is_active), employee:employees!inner(employee_no)")
      .eq("is_active", true).eq("workshop.is_active", true).eq("employee.status", "active")
      .order("id").range(from, to)),
  });
  const attendancePunches = attendancePunchesQuery.data ?? noAttendancePunches;
  const excludedEmployees = [...dismissedPunchEmployees];
  const unassignedPunchesQuery = useQuery<UnassignedPunchPage>({
    queryKey: ["daily-workshop-unassigned-punches", date, selectedDeviceIds, unassignedPage, excludedEmployees],
    enabled: tab === "inventory" && !!date,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.rpc("list_unassigned_workshop_punches", {
        p_date: date,
        p_device_ids: bySelectedDevices ? selectedDeviceIds : undefined,
        p_excluded_employee_ids: excludedEmployees,
        p_page: unassignedPage,
      }).abortSignal(signal);
      if (error) throw error;
      return data as UnassignedPunchPage;
    },
  });
  const unmatchedPunches = unassignedPunchesQuery.data?.rows ?? [];
  const unassignedCount = unassignedPunchesQuery.data?.totalCount ?? 0;
  const unassignedPages = Math.max(1, Math.ceil(unassignedCount / unassignedPageSize));
  useEffect(() => {
    if (unassignedPunchesQuery.isSuccess && unassignedPage >= unassignedPages) {
      setSelectedUnmatchedEmployeeIds([]);
      setUnassignedPage(unassignedPages - 1);
    }
  }, [unassignedPage, unassignedPages, unassignedPunchesQuery.isSuccess]);
  const changeUnassignedPage = (page: number) => {
    setSelectedUnmatchedEmployeeIds([]);
    setUnassignedPage(page);
  };
  const dismissUnassigned = (ids: string[]) => {
    setDismissedPunchEmployees((current) => new Set([...current, ...ids]));
    changeUnassignedPage(0);
  };
  const employeeSearchQuery = useQuery({
    queryKey: ["daily-workshop-employee-search", employeeLookup.term],
    enabled: employeePickerOpen && employeeLookup.valid && !employeeLookup.waiting,
    queryFn: async ({ signal }) => {
      let query = supabase.from("employees").select("id, employee_no, full_name, position")
        .eq("status", "active");
      for (const term of employeeLookup.term.split(" ")) {
        query = query.or(`full_name.ilike.%${term}%,employee_no.ilike.%${term}%`);
      }
      const { data, error } = await query.order("full_name").order("id").limit(50).abortSignal(signal);
      if (error) throw error;
      return data;
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
      const lines = await loadAllRows<AttendanceLine>((from, to) => supa
        .from("daily_workshop_report_lines")
        .select(
          "id, report_id, employee_id, employee_no_snapshot, employee_name_snapshot, role_label, attended, site_id",
        )
        .in("report_id", ids)
        .order("employee_name_snapshot").order("id").range(from, to));
      return { reports: reports as DailyReport[], lines };
    },
  });

  const workshops = workshopsQuery.data ?? noWorkshops;
  const employees = useMemo(() => members.flatMap(({ employee }) => employee ?? []), [members]);
  const devices = devicesQuery.data ?? noDevices;
  const selectedWorkshop = workshops.find((workshop) => workshop.id === workshopId);
  const activeRoster = useMemo(() => members.filter((member) => member.employee), [members]);
  const savedReport = reportQuery.data?.reports.find((report) => report.workshop_id === workshopId);
  const savedLines = useMemo(
    () => reportQuery.data?.lines.filter((line) => line.report_id === savedReport?.id) ?? [],
    [reportQuery.data?.lines, savedReport?.id],
  );
  const employeeById = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee])),
    [employees],
  );
  const employeeByNumber = useMemo(
    () => new Map(employees.map((employee) => [employee.employee_no, employee])),
    [employees],
  );
  const deviceById = useMemo(
    () => new Map(devices.map((device) => [device.id, device])),
    [devices],
  );
  const punchByEmployeeId = useMemo(() => {
    const punchesByEmployee = new Map<string, { deviceName: string; time: string }>();
    for (const punch of attendancePunches) {
      const employee =
        (punch.employee_id ? employeeById.get(punch.employee_id) : undefined) ??
        employeeByNumber.get(punch.employee_no);
      if (!employee || punchesByEmployee.has(employee.id)) continue;
      const time = new Date(punch.verify_time).toLocaleTimeString("en-US", {
        timeZone: "Asia/Baghdad",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
      punchesByEmployee.set(employee.id, {
        deviceName: punch.device_id
          ? (deviceById.get(punch.device_id)?.name ?? "جهاز غير محدد")
          : "جهاز غير محدد",
        time,
      });
    }
    return punchesByEmployee;
  }, [attendancePunches, deviceById, employeeById, employeeByNumber]);
  const sites = sitesQuery.data ?? [];
  const presentLines = (reportQuery.data?.lines ?? []).filter((line) => line.attended);
  const presentGroups = useMemo(() => {
    const groups = new Map<string, { name: string; lines: AttendanceLine[] }>();
    for (const line of presentLines) {
      const report = reportQuery.data?.reports.find((item) => item.id === line.report_id);
      const workshop = workshops.find((item) => item.id === report?.workshop_id);
      const key = report?.workshop_id ?? line.report_id;
      const group = groups.get(key) ?? { name: workshop?.name ?? "ورشة", lines: [] };
      group.lines.push(line);
      groups.set(key, group);
    }
    return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [presentLines, reportQuery.data?.reports, workshops]);
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
    if (!workshops.some(w => w.id === workshopId)) setWorkshopId(workshops[0]?.id ?? "");
  }, [workshopId, workshops]);
  const savedAttended = useMemo(
    () => Object.fromEntries(savedLines.map((line) => [line.employee_id, line.attended])),
    [savedLines],
  );
  const attendedByEmployee: Record<string, boolean> = drafts[workshopId]?.attended ?? savedAttended;
  const notes = drafts[workshopId]?.notes ?? savedReport?.notes ?? "";
  const updateDraft = (patch: { attended?: Record<string, boolean>; notes?: string }) =>
    setDrafts((current) => ({
      ...current,
      [workshopId]: {
        attended: current[workshopId]?.attended ?? savedAttended,
        notes: current[workshopId]?.notes ?? savedReport?.notes ?? "",
        ...patch,
      },
    }));
  const setNotes = (value: string) => updateDraft({ notes: value });
  const setAttendedByEmployee = (
    value: Record<string, boolean> | ((c: Record<string, boolean>) => Record<string, boolean>),
  ) => updateDraft({ attended: typeof value === "function" ? value(attendedByEmployee) : value });
  const draftCount = Object.keys(drafts).filter(Boolean).length;

  const toggleDeviceSelection = (id: string, checked: boolean) => {
    if (id === "all") {
      setSelectedDeviceIds(["all"]);
      return;
    }
    setSelectedDeviceIds((current) => {
      const selected = current.filter((value) => value !== "all");
      const next = checked
        ? [...new Set([...selected, id])]
        : selected.filter((value) => value !== id);
      return next.length ? next : ["all"];
    });
  };

  const markEmployeePresentInWorkshop = (targetWorkshopId: string, ids: string[]) => {
    const saved = reportQuery.data?.reports.find(
      (report) => report.workshop_id === targetWorkshopId,
    );
    const savedAttendance = Object.fromEntries(
      (reportQuery.data?.lines ?? [])
        .filter((line) => line.report_id === saved?.id)
        .map((line) => [line.employee_id, line.attended]),
    );
    setDrafts((current) => ({
      ...current,
      [targetWorkshopId]: {
        attended: {
          ...(current[targetWorkshopId]?.attended ?? savedAttendance),
          ...Object.fromEntries(ids.map((id) => [id, true])),
        },
        notes: current[targetWorkshopId]?.notes ?? saved?.notes ?? "",
      },
    }));
  };

  const markRosterFromBiometrics = async () => {
    if (!date || markingBiometrics || saving) return;
    setMarkingBiometrics(true);
    void unassignedPunchesQuery.refetch();
    try {
      const [membersResult, reportsResult, devicePunches] = await Promise.all([
        activeWorkshopMembersQuery.refetch({ throwOnError: true }),
        reportQuery.refetch({ throwOnError: true }),
        bySelectedDevices ? attendancePunchesQuery.refetch({ throwOnError: true }) : null,
      ]);
      const allMembers = membersResult.data ?? [];
      if (date !== dateRef.current) return;
      const punches = devicePunches?.data ?? await loadAttendancePunches(
        date, "employee_no", allMembers.map((member) => member.employee.employee_no),
      );
      if (date !== dateRef.current) return;
      const { byWorkshop, employeeCount } = matchWorkshopPunches(allMembers, punches);
      if (!byWorkshop.size) {
        toast.info("لا توجد حركات بصمة مطابقة لكادر الورش في التاريخ المحدد.");
        return;
      }
      const reports = reportsResult.data?.reports ?? [];
      const lines = reportsResult.data?.lines ?? [];
      setDrafts((current) => {
        const next = { ...current };
        for (const [targetWorkshopId, employeeIds] of byWorkshop) {
          const savedReport = reports.find((report) => report.workshop_id === targetWorkshopId);
          const savedAttendance = Object.fromEntries(
            lines.filter((line) => line.report_id === savedReport?.id)
              .map((line) => [line.employee_id, line.attended]),
          );
          const attended = { ...(current[targetWorkshopId]?.attended ?? savedAttendance) };
          for (const id of employeeIds) attended[id] = true;
          next[targetWorkshopId] = {
            attended,
            notes: current[targetWorkshopId]?.notes ?? savedReport?.notes ?? "",
          };
        }
        return next;
      });
      toast.success(`تم تأشير ${employeeCount} موظفاً في ${byWorkshop.size} ورشة بالبصمة`);
    } catch (error) {
      toast.error(formatErrorMessage(error, "تعذر مطابقة حركات البصمة مع الورش"));
    } finally {
      setMarkingBiometrics(false);
    }
  };

  const assignUnmatchedPunch = async (employees: Employee[], targetWorkshopId: string) => {
    if (!targetWorkshopId) return toast.error("اختر الورشة أولاً");
    setSaving(true);
    try {
      const { data, error } = await supa
        .from("daily_workshop_members")
        .upsert(
          employees.map((employee) => ({
            workshop_id: targetWorkshopId,
            employee_id: employee.id,
            role_label: employee.position,
            is_active: true,
          })),
          { onConflict: "workshop_id,employee_id" },
        )
        .select("id, workshop_id, employee_id, role_label, is_active");
      if (error) throw error;
      const ids = employees.map((employee) => employee.id);
      queryClient.setQueryData<Member[]>(
        ["daily-workshop-members", targetWorkshopId],
        (current = []) => [
          ...current.filter((member) => !ids.includes(member.employee_id)),
          ...(data as Omit<Member, "employee">[]).map((member) => ({
            ...member,
            employee: employees.find((employee) => employee.id === member.employee_id) ?? null,
          })),
        ],
      );
      if (date === dateRef.current) {
        markEmployeePresentInWorkshop(targetWorkshopId, ids);
        changeUnassignedPage(0);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["daily-workshop-members"] }),
        queryClient.invalidateQueries({ queryKey: ["daily-workshop-all-active-members"] }),
        queryClient.invalidateQueries({ queryKey: ["daily-workshop-unassigned-punches"] }),
      ]);
      toast.success(
        `تمت إضافة ${employees.length === 1 ? employees[0].full_name : employees.length + " موظفين"} إلى الورشة وتسجيل الحضور`,
      );
    } catch (error) {
      toast.error(formatErrorMessage(error, "تعذر إضافة الموظف إلى الورشة"));
    } finally {
      setSaving(false);
    }
  };

  const refreshData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["project-execution"] }),
      queryClient.invalidateQueries({ queryKey: ["projects-dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["workshop-management"] }),
      queryClient.invalidateQueries({ queryKey: ["daily-workshops"] }),
      queryClient.invalidateQueries({ queryKey: ["daily-workshop-members"] }),
      queryClient.invalidateQueries({ queryKey: ["daily-workshop-reports"] }),
      queryClient.invalidateQueries({ queryKey: ["daily-workshop-unassigned-punches"] }),
    ]);
  };

  const addMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const employee = selectedEmployee;
    if (!workshopId || !employee) return toast.error("اختر الورشة والموظف");
    setSaving(true);
    try {
      const { error } = await supa.from("daily_workshop_members").upsert(
        [...new Set([workshopId, additionalWorkshopId].filter(Boolean))].map(id => ({
          workshop_id: id,
          employee_id: employee.id,
          role_label: roleLabel.trim() || employee.position || null,
          is_active: true,
        })),
        { onConflict: "workshop_id,employee_id" },
      );
      if (error) throw error;
      setSelectedEmployee(null);
      setEmployeeSearch("");
      setRoleLabel("");
      setAdditionalWorkshopId("");
      await queryClient.invalidateQueries({ queryKey: ["daily-workshop-all-active-members"] });
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
    const ids = Object.keys(drafts).filter(Boolean);
    if (workshopId && !ids.includes(workshopId)) ids.push(workshopId);
    if (!ids.length) return toast.error("أضف ورشة أو اخترها أولاً");
    setSaving(true);
    try {
      // Rosters for every edited workshop (cached query for the current one, fetch the rest).
      let allMembers: Member[] = members;
      const others = ids.filter((id) => id !== workshopId);
      if (others.length && navigator.onLine) {
        const otherMembers = await loadAllRows<RosterRow>((from, to) => supa
          .from("daily_workshop_members").select(rosterFields)
          .in("workshop_id", others).eq("is_active", true).order("id").range(from, to));
        allMembers = [...members, ...activeRosterMembers(otherMembers)];
      } else {
        for (const id of others) {
          const cached = queryClient.getQueryData<Member[]>(["daily-workshop-members", id]);
          if (!cached) throw new Error("اتصل بالإنترنت لتحميل كادر الورش وإرسال الجرد.");
          allMembers = [...allMembers, ...cached];
        }
      }
      const reports = reportQuery.data?.reports ?? [];
      const lines = reportQuery.data?.lines ?? [];
      const payloads: QueuedInventory[] = [];
      for (const id of ids) {
        const report = reports.find((r) => r.workshop_id === id);
        const saved = Object.fromEntries(
          lines.filter((l) => l.report_id === report?.id).map((l) => [l.employee_id, l.attended]),
        );
        const attended = drafts[id]?.attended ?? saved;
        const roster = allMembers
          .filter((m) => m.workshop_id === id)
          .filter((m) => m.employee);
        if (!roster.length) continue;
        payloads.push({
          key: `${id}:${date}`,
          workshopId: id,
          date,
          notes: (drafts[id]?.notes ?? report?.notes ?? "").trim() || null,
          lines: roster.map(({ employee, role_label }) => ({
            employee_id: employee!.id,
            employee_no_snapshot: employee!.employee_no,
            employee_name_snapshot: employee!.full_name,
            role_label: role_label?.trim() || employee!.position || null,
            attended: attended[employee!.id] === true,
          })),
        });
      }
      if (!payloads.length) return toast.error("لا يوجد كادر في الورش المحددة");
      let queued = 0;
      for (const payload of payloads) {
        try {
          if (!navigator.onLine) throw new OfflineError();
          await submitInventory(payload);
        } catch (error) {
          if (error instanceof OfflineError || !navigator.onLine || error instanceof TypeError) {
            queueInventory(payload);
            queued += 1;
          } else throw error;
        }
      }
      setDrafts({});
      setPendingCount(readInventoryQueue().length);
      if (queued) toast.success(`لا يوجد اتصال — حُفظ ${queued} جرد على الهاتف وسيُرسل تلقائياً`);
      if (payloads.length - queued) {
        await refreshData();
        toast.success(`تم إرسال جرد ${payloads.length - queued} ورشة`);
      }
    } catch (error) {
      toast.error(formatErrorMessage(error, "تعذر حفظ الجرد اليومي"));
    } finally {
      setSaving(false);
    }
  };

  const [pendingCount, setPendingCount] = useState(0);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let busy = false;
    const flush = async () => {
      setOnline(navigator.onLine);
      setPendingCount(readInventoryQueue().length);
      if (busy || !navigator.onLine) return;
      busy = true;
      let sent = 0;
      for (const item of readInventoryQueue()) {
        try {
          await submitInventory(item);
          removeQueuedInventory(item.key);
          sent += 1;
        } catch {
          break;
        }
      }
      busy = false;
      setPendingCount(readInventoryQueue().length);
      if (sent) {
        toast.success(`تمت مزامنة ${sent} جرد محفوظ دون اتصال`);
        await queryClient.invalidateQueries({ queryKey: ["daily-workshop-reports"] });
        await queryClient.invalidateQueries({ queryKey: ["project-execution"] });
        await queryClient.invalidateQueries({ queryKey: ["projects-dashboard"] });
      }
    };
    void flush();
    const offline = () => setOnline(false);
    window.addEventListener("online", flush);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", flush);
      window.removeEventListener("offline", offline);
    };
  }, [queryClient]);

  const assignSite = async (line: AttendanceLine, siteId: string) => {
    const otherAssignment = presentLines.find(
      (item) => item.employee_id === line.employee_id && item.id !== line.id && item.site_id,
    );
    if (siteId && otherAssignment) {
      return toast.error(
        "هذا الموظف مسند بالفعل إلى مركز تكلفة آخر اليوم؛ ألغِ إسناده السابق أولاً",
      );
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
    await queryClient.invalidateQueries({ queryKey: ["workshop-management"] });
    await queryClient.invalidateQueries({ queryKey: ["project-execution"] });
    toast.success("تم تحديث مركز تكلفة الموظف لهذا اليوم");
  };

  const selectedEmployees = unmatchedPunches
    .map((row) => row.employee)
    .filter((e) => selectedUnmatchedEmployeeIds.includes(e.id));
  const reports = reportQuery.data?.reports ?? [];
  const printDailyReport = () => {
    const savedReports = reports.filter((report) => printIds.includes(report.id));
    const allLines = reportQuery.data?.lines ?? [];
    if (!savedReports.length) return toast.error("يرجى اختيار ورشة واحدة على الأقل");
    const content = savedReports
      .map((report) => {
        const workshop = workshops.find((item) => item.id === report.workshop_id);
        const lines = allLines.filter((line) => line.report_id === report.id);
        return workshopReportMarkup({
          name: workshop?.name ?? "ورشة",
          date,
          notes: report.notes,
          lines,
        });
      })
      .join("");
    if (!printReport(`الجرد اليومي للورش — ${date}`, content)) {
      toast.error("اسمح بالنوافذ المنبثقة لطباعة التقرير");
    } else setPrintOpen(false);
  };

  const allReportLines = reportQuery.data?.lines ?? [];
  const totalPresent = allReportLines.filter((line) => line.attended).length;
  const totalRostered = allReportLines.length;

  return (
    <div className="space-y-4">
      {(workshopsQuery.error ||
        membersQuery.error ||
        reportQuery.error) && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          تعذر تحميل بيانات الجرد:{" "}
          {formatErrorMessage(
            workshopsQuery.error ?? membersQuery.error ?? reportQuery.error,
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
              <div className="grid gap-3 sm:grid-cols-3">
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
                  <Label>أجهزة البصمة</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        disabled={markingBiometrics}
                        className={`${inputClass} justify-between font-normal`}
                      >
                        {selectedDeviceIds.includes("all")
                          ? "بصمات أعضاء الورشة"
                          : `${selectedDeviceIds.length} أجهزة محددة`}
                        <ChevronsUpDown className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent dir="rtl" className="w-72 p-2" align="start">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 rounded-md p-2 text-sm hover:bg-muted">
                          <Checkbox
                            id="all-attendance-devices"
                            checked={selectedDeviceIds.includes("all")}
                            onCheckedChange={(checked) =>
                              toggleDeviceSelection("all", checked === true)
                            }
                          />
                          <label htmlFor="all-attendance-devices" className="flex-1 cursor-pointer">
                            أعضاء الورشة من كل الأجهزة
                          </label>
                        </div>
                        {devices.map((device) => (
                          <div
                            key={device.id}
                            className="flex items-center gap-2 rounded-md p-2 text-sm hover:bg-muted"
                          >
                            <Checkbox
                              id={`attendance-device-${device.id}`}
                              checked={selectedDeviceIds.includes(device.id)}
                              onCheckedChange={(checked) =>
                                toggleDeviceSelection(device.id, checked === true)
                              }
                            />
                            <label
                              htmlFor={`attendance-device-${device.id}`}
                              className="min-w-0 flex-1 cursor-pointer truncate"
                            >
                              {device.name}
                              {device.serial_number ? ` · ${device.serial_number}` : ""}
                            </label>
                          </div>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
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
              {devicesQuery.isError && (
                <p role="alert" className="text-sm text-destructive">
                  تعذر تحميل أجهزة البصمة: {formatErrorMessage(devicesQuery.error)}
                </p>
              )}
              {attendancePunchesQuery.isError && (
                <p role="alert" className="text-sm text-destructive">
                  تعذر تحميل حركات البصمة: {formatErrorMessage(attendancePunchesQuery.error)}
                </p>
              )}
              {activeWorkshopMembersQuery.isError && (
                <p role="alert" className="text-sm text-destructive">
                  تعذر التحقق من عضويات الورش النشطة:{" "}
                  {formatErrorMessage(activeWorkshopMembersQuery.error)}
                </p>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void markRosterFromBiometrics()}
                disabled={!date || !workshops.length || markingBiometrics || saving}
              >
                <Fingerprint className="size-4" />
                {markingBiometrics ? "جارٍ فحص بصمات الورش…" : "تأشير جميع الورش بالبصمة"}
              </Button>
              {selectedWorkshop && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/20 p-3">
                  <div>
                    <p className="font-semibold">{selectedWorkshop.name}</p>
                    <p className="text-xs text-muted-foreground">
                      علّم الموظفين الذين حضروا لتسجيل البصمة
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
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
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate font-medium">{employee!.full_name}</p>
                            {attendedByEmployee[employee!.id] === true &&
                              punchByEmployeeId.get(employee!.id) && (
                                <Badge
                                  variant="outline"
                                  className="inline-flex gap-1 border-cyan-500/40 bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-medium text-cyan-700 dark:text-cyan-300"
                                >
                                  <Fingerprint className="h-3 w-3" />
                                  <span>
                                    {punchByEmployeeId.get(employee!.id)!.deviceName} ·{" "}
                                    {punchByEmployeeId.get(employee!.id)!.time}
                                  </span>
                                </Badge>
                              )}
                          </div>
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
              {date && (
                <section className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                  <div>
                    <h3 className="font-semibold">حاضرون بالبصمة غير مسجلين في الورش</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      حركات دخول بتاريخ {date} ومن{" "}
                      {selectedDeviceIds.includes("all")
                        ? "كل الأجهزة"
                        : `${selectedDeviceIds.length} أجهزة محددة`}
                      .
                    </p>
                  </div>
                  {unassignedPunchesQuery.isPending ? (
                    <p role="status" className="text-sm text-muted-foreground">جارٍ تحميل الحاضرين غير المنسّبين…</p>
                  ) : unassignedPunchesQuery.isError ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <p role="alert" className="text-sm text-destructive">تعذر تحميل الحاضرين غير المنسّبين.</p>
                      <Button size="sm" variant="outline" onClick={() => void unassignedPunchesQuery.refetch()}>إعادة المحاولة</Button>
                    </div>
                  ) : unassignedCount === 0 ? (
                    <p className="text-sm text-muted-foreground">لا يوجد حاضرون غير منسّبين ضمن التاريخ والأجهزة المختارة.</p>
                  ) : null}
                  {unmatchedPunches.length > 0 && <>
                  <div className="flex flex-wrap gap-2 items-center">
                    <label className="flex gap-2 items-center">
                      <Checkbox
                        checked={
                          selectedEmployees.length === unmatchedPunches.length
                            ? true
                            : selectedEmployees.length
                              ? "indeterminate"
                              : false
                        }
                        onCheckedChange={(checked) =>
                          setSelectedUnmatchedEmployeeIds(
                            checked ? unmatchedPunches.map((row) => row.employee.id) : [],
                          )
                        }
                      />
                      {selectedEmployees.length === unmatchedPunches.length
                        ? "إلغاء التحديد"
                        : "تحديد الصفحة"}{" "}
                      ({unmatchedPunches.length})
                    </label>
                    <Badge variant="secondary">المحددون: {selectedEmployees.length}</Badge>
                    <select
                      className={inputClass}
                      aria-label="الورشة المستهدفة"
                      value={bulkTargetWorkshopId}
                      onChange={(e) => setBulkTargetWorkshopId(e.target.value)}
                    >
                      <option value="">اختر الورشة المستهدفة</option>
                      {workshops.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      disabled={saving || !selectedEmployees.length || !bulkTargetWorkshopId}
                      onClick={() =>
                        void assignUnmatchedPunch(selectedEmployees, bulkTargetWorkshopId)
                      }
                    >
                      {saving ? "جارٍ الحفظ…" : "إضافة المحددين إلى الورشة"}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={saving || !selectedEmployees.length}
                      onClick={() => {
                        dismissUnassigned(selectedEmployees.map((employee) => employee.id));
                        toast.success("تم إهمال الموظفين المحددين");
                      }}
                    >
                      إهمال المحددين
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {unmatchedPunches.map(({ employee, punch }) => {
                      const device = punch.device_id ? deviceById.get(punch.device_id) : undefined;
                      return (
                        <article
                          key={employee.id}
                          className="flex flex-col gap-3 rounded-lg border bg-background/70 p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <Checkbox
                            aria-label={`تحديد ${employee.full_name}`}
                            checked={selectedUnmatchedEmployeeIds.includes(employee.id)}
                            onCheckedChange={(checked) =>
                              setSelectedUnmatchedEmployeeIds((ids) =>
                                checked
                                  ? [...ids, employee.id]
                                  : ids.filter((id) => id !== employee.id),
                              )
                            }
                          />
                          <div className="min-w-0">
                            <p className="font-medium">{employee.full_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {employee.employee_no} · {employee.position || "بدون مسمى"}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {new Date(punch.verify_time).toLocaleTimeString("ar-IQ", {
                                timeZone: "Asia/Baghdad",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                              {" · "}
                              {device
                                ? `${device.name}${device.serial_number ? ` (${device.serial_number})` : ""}`
                                : "جهاز غير محدد"}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              className={`${inputClass} w-auto min-w-40`}
                              aria-label={`اختر ورشة لإضافة ${employee.full_name}`}
                              value={selectedWorkshopByPunch[employee.id] ?? ""}
                              onChange={(event) =>
                                setSelectedWorkshopByPunch((current) => ({
                                  ...current,
                                  [employee.id]: event.target.value,
                                }))
                              }
                            >
                              <option value="">اختر ورشة</option>
                              {workshops.map((workshop) => (
                                <option key={workshop.id} value={workshop.id}>
                                  {workshop.name}
                                </option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              onClick={() =>
                                void assignUnmatchedPunch(
                                  [employee],
                                  selectedWorkshopByPunch[employee.id] ?? "",
                                )
                              }
                              disabled={saving || !selectedWorkshopByPunch[employee.id]}
                            >
                              <Plus className="ml-1 h-4 w-4" />
                              إضافة إلى ورشة
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => dismissUnassigned([employee.id])}
                            >
                              إهمال
                            </Button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  </>}
                  {unassignedPages > 1 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="text-muted-foreground">صفحة {unassignedPage + 1} من {unassignedPages} · {unassignedCount} موظف</span>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" disabled={saving || unassignedPage === 0} onClick={() => changeUnassignedPage(unassignedPage - 1)}>السابق</Button>
                        <Button size="sm" variant="outline" disabled={saving || unassignedPage + 1 >= unassignedPages} onClick={() => changeUnassignedPage(unassignedPage + 1)}>التالي</Button>
                      </div>
                    </div>
                  )}
                </section>
              )}
              {activeRoster.length > 0 && (
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
              )}
              {(activeRoster.length > 0 || draftCount > 0) && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    {activeRoster.length > 0
                      ? `الحاضرون: ${activeRoster.filter(({ employee }) => attendedByEmployee[employee!.id]).length} من ${activeRoster.length}`
                      : `مسودات الجرد: ${draftCount}`}
                    {activeRoster.length > 0 && savedReport ? " · يوجد سجل محفوظ لهذا اليوم" : ""}
                    {!online ? " · وضع عدم الاتصال" : ""}
                    {pendingCount ? ` · ${pendingCount} جرد بانتظار المزامنة` : ""}
                  </p>
                  <Button onClick={() => void saveDailyReport()} disabled={saving || markingBiometrics}>
                    <Save className="ml-2 h-4 w-4" />
                    {saving
                      ? "جارٍ الإرسال..."
                      : draftCount > 1
                        ? `إرسال جرد كل الورش (${draftCount})`
                        : "إرسال الجرد"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="workshops" className="space-y-6">
          <WorkshopManagement date={date} onDateChange={setDate} onSelect={id => { setWorkshopId(id); document.getElementById("workshop-roster-management")?.scrollIntoView({ behavior: "smooth" }); }} />
          <div id="workshop-roster-management" />
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
                        dir="rtl"
                        className="w-[--radix-popover-trigger-width] p-0"
                        align="start"
                      >
                        <Command shouldFilter={false}>
                          <CommandInput value={employeeSearch} onValueChange={setEmployeeSearch} maxLength={100}
                            placeholder="اكتب اسم الموظف أو رقمه الوظيفي..." />
                          <CommandList>
                            <CommandEmpty>{!employeeLookup.valid ? "اكتب حرفين أو رقمين على الأقل." :
                              employeeLookup.waiting || employeeSearchQuery.isFetching ? "جارٍ البحث…" :
                              employeeSearchQuery.isError ? "تعذر البحث عن الموظفين." : "لا يوجد موظف مطابق للبحث."}</CommandEmpty>
                            <CommandGroup>
                              {(!employeeLookup.waiting && employeeLookup.valid ? employeeSearchQuery.data ?? [] : []).map((employee) => (
                                <CommandItem
                                  key={employee.id}
                                  value={employee.id}
                                  onSelect={() => {
                                    setSelectedEmployee(employee);
                                    setEmployeeSearch("");
                                    setRoleLabel(employee.position ?? "");
                                    setEmployeePickerOpen(false);
                                  }}
                                >
                                  <Check
                                    className={`h-4 w-4 ${selectedEmployee?.id === employee.id ? "opacity-100" : "opacity-0"}`}
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
                  <label className="space-y-1.5">ورشة ثانية (اختياري)
                    <select className={inputClass} value={additionalWorkshopId === workshopId ? "" : additionalWorkshopId} onChange={event => setAdditionalWorkshopId(event.target.value)}>
                      <option value="">بدون ورشة ثانية</option>
                      {workshops.filter(w => w.id !== workshopId).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </label>
                  <Button type="submit" disabled={saving || !selectedEmployee} className="self-end">
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
                    onClick={() => {
                      setPrintIds(reports.map((r) => r.id));
                      setPrintOpen(true);
                    }}
                    disabled={!reportQuery.data?.reports.length}
                  >
                    <Printer className="ml-2 h-4 w-4" />
                    طباعة التقرير
                  </Button>
                  <Dialog open={printOpen} onOpenChange={setPrintOpen}>
                    <DialogContent dir="rtl">
                      <DialogHeader>
                        <DialogTitle>تحديد الورش للطباعة</DialogTitle>
                      </DialogHeader>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={() => setPrintIds(reports.map((r) => r.id))}
                        >
                          تحديد الكل
                        </Button>
                        <Button variant="outline" onClick={() => setPrintIds([])}>
                          إلغاء التحديد
                        </Button>
                      </div>
                      <div className="max-h-[50vh] overflow-y-auto space-y-2">
                        {reports.map((report) => {
                          const lines = allReportLines.filter((l) => l.report_id === report.id);
                          return (
                            <label key={report.id} className="flex gap-2 items-center">
                              <Checkbox
                                checked={printIds.includes(report.id)}
                                onCheckedChange={(checked) =>
                                  setPrintIds((ids) =>
                                    checked
                                      ? [...ids, report.id]
                                      : ids.filter((id) => id !== report.id),
                                  )
                                }
                              />
                              {workshops.find((w) => w.id === report.workshop_id)?.name ?? "ورشة"}{" "}
                              (حضور: {lines.filter((l) => l.attended).length} من {lines.length})
                            </label>
                          );
                        })}
                      </div>
                      <DialogFooter>
                        <Button onClick={printDailyReport}>
                          تأكيد وطباعة ({printIds.length} ورش)
                        </Button>
                        <Button variant="outline" onClick={() => setPrintOpen(false)}>
                          إلغاء
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
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
              <p className="text-sm text-muted-foreground">
                يعرض الموظفين المسجل حضورهم في جرد هذا اليوم فقط. اختر CTR لحساب كلفة العامل ضمن
                متابعة نشر الموقع.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/30 p-3 text-sm">
                <span>
                  التاريخ: <b>{date}</b> · الحاضرون: <b>{presentLines.length}</b>
                </span>
                <span>
                  إجمالي الكلفة المسندة:{" "}
                  <b>
                    {presentLines
                      .reduce((sum, line) => sum + (line.site_id ? dailyCost(line) : 0), 0)
                      .toLocaleString("ar-IQ")}{" "}
                    د.ع
                  </b>
                </span>
              </div>
              {presentGroups.map((group) => (
                <section key={group.name} className="space-y-2 rounded-xl border p-3">
                  <h3 className="font-semibold">
                    {group.name} <Badge variant="secondary">{group.lines.length} حاضر</Badge>
                  </h3>
                  {group.lines.map((line) => (
                    <div
                      key={line.id}
                      className="grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-center"
                    >
                      <div>
                        <p className="font-medium">{line.employee_name_snapshot}</p>
                        <p className="text-xs text-muted-foreground">
                          {line.role_label || "بدون صفة"}
                        </p>
                      </div>
                      <select
                        className={inputClass}
                        aria-label={`مركز تكلفة ${line.employee_name_snapshot}`}
                        value={line.site_id ?? "unassigned"}
                        onChange={(event) =>
                          void assignSite(
                            line,
                            event.target.value === "unassigned" ? "" : event.target.value,
                          )
                        }
                      >
                        <option value="unassigned">اختر مركز التكلفة CTR</option>
                        {sites.map((site) => (
                          <option key={site.id} value={site.id}>
                            {site.ctr_code} — {site.name}
                          </option>
                        ))}
                      </select>
                      <Badge variant={line.site_id ? "default" : "secondary"}>
                        {line.site_id
                          ? `${dailyCost(line).toLocaleString("ar-IQ")} د.ع / يوم`
                          : "غير مسند"}
                      </Badge>
                    </div>
                  ))}
                </section>
              ))}
              {!presentLines.length && (
                <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
                  احفظ جرد الحضور أولاً ليظهر الكادر الحاضر هنا.
                </p>
              )}
              {sitesQuery.error && (
                <p role="alert" className="text-sm text-destructive">
                  تعذر تحميل مراكز التكلفة: {formatErrorMessage(sitesQuery.error)}
                </p>
              )}
              {wagesQuery.error && (
                <p role="alert" className="text-sm text-destructive">
                  تعذر تحميل أجور التخصصات: {formatErrorMessage(wagesQuery.error)}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
