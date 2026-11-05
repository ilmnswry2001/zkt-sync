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
const noDevices: Device[] = [];
const noAttendancePunches: AttendancePunch[] = [];

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

export function DailyWorkshopInventory() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("inventory");
  const [date, setDate] = useState(todayInBaghdad());
  const [deviceId, setDeviceId] = useState("all");
  const [workshopId, setWorkshopId] = useState("");
  const [workshopName, setWorkshopName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [employeePickerOpen, setEmployeePickerOpen] = useState(false);
  const [roleLabel, setRoleLabel] = useState("");
  const [drafts, setDrafts] = useState<
    Record<string, { attended: Record<string, boolean>; notes: string }>
  >({});
  const [saving, setSaving] = useState(false);
  const [dismissedPunchEmployees, setDismissedPunchEmployees] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedWorkshopByPunch, setSelectedWorkshopByPunch] = useState<Record<string, string>>(
    {},
  );
  useEffect(() => setDrafts({}), [date]);
  useEffect(() => {
    setDismissedPunchEmployees(new Set());
    setSelectedWorkshopByPunch({});
  }, [date, deviceId]);

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
        .order("name")
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
  const attendancePunchesQuery = useQuery<AttendancePunch[]>({
    queryKey: ["daily-workshop-attendance-punches", date, deviceId],
    queryFn: async () => {
      const start = new Date(`${date}T00:00:00+03:00`);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      const punches: AttendancePunch[] = [];
      for (let from = 0; ; from += 1000) {
        let request = supa
          .from("attendance_logs")
          .select(
            "id, employee_id, employee_no, verify_time, device_id, status, verify_type, self_event_type, is_suspicious",
          )
          .gte("verify_time", start.toISOString())
          .lt("verify_time", end.toISOString())
          .order("verify_time")
          .range(from, from + 999);
        if (deviceId !== "all") request = request.eq("device_id", deviceId);
        const { data, error } = await request;
        if (error) throw error;
        punches.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return punches.filter(
        (punch) =>
          !punch.is_suspicious &&
          (punch.self_event_type === "check_in" ||
            (punch.self_event_type == null &&
              (punch.status === 0 || (punch.status == null && punch.verify_type === 0)))),
      );
    },
  });
  const activeWorkshopMembersQuery = useQuery<Array<{ employee_id: string }>>({
    queryKey: ["daily-workshop-all-active-members"],
    queryFn: async () => {
      const rows: Array<{ employee_id: string }> = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supa
          .from("daily_workshop_members")
          .select("employee_id")
          .eq("is_active", true)
          .range(from, from + 999);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < 1000) return rows;
      }
    },
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
  const devices = devicesQuery.data ?? noDevices;
  const attendancePunches = attendancePunchesQuery.data ?? noAttendancePunches;
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
  const activeWorkshopEmployeeIds = useMemo(
    () => new Set((activeWorkshopMembersQuery.data ?? []).map((member) => member.employee_id)),
    [activeWorkshopMembersQuery.data],
  );
  const unmatchedPunches = useMemo(() => {
    if (
      attendancePunchesQuery.isError ||
      activeWorkshopMembersQuery.isLoading ||
      activeWorkshopMembersQuery.isError
    ) {
      return [];
    }
    const seen = new Set<string>();
    return attendancePunches.flatMap((punch) => {
      const employee =
        (punch.employee_id ? employeeById.get(punch.employee_id) : undefined) ??
        employeeByNumber.get(punch.employee_no);
      if (
        !employee ||
        activeWorkshopEmployeeIds.has(employee.id) ||
        dismissedPunchEmployees.has(employee.id) ||
        seen.has(employee.id)
      ) {
        return [];
      }
      seen.add(employee.id);
      return [{ employee, punch }];
    });
  }, [
    attendancePunches,
    employeeById,
    employeeByNumber,
    activeWorkshopEmployeeIds,
    dismissedPunchEmployees,
    attendancePunchesQuery.isError,
    activeWorkshopMembersQuery.isLoading,
    activeWorkshopMembersQuery.isError,
  ]);
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
    if (!workshopId && workshops[0]) setWorkshopId(workshops[0].id);
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

  const markRosterFromBiometrics = async () => {
    const result = await attendancePunchesQuery.refetch();
    if (result.error) {
      toast.error(formatErrorMessage(result.error, "تعذر جلب حركات البصمة"));
      return;
    }
    const punches = result.data ?? [];
    const punchEmployeeIds = new Set(punches.map((punch) => punch.employee_id).filter(Boolean));
    const punchEmployeeNumbers = new Set(punches.map((punch) => punch.employee_no));
    const matched = activeRoster.filter(
      ({ employee }) =>
        punchEmployeeIds.has(employee!.id) || punchEmployeeNumbers.has(employee!.employee_no),
    );
    setAttendedByEmployee({
      ...attendedByEmployee,
      ...Object.fromEntries(matched.map(({ employee }) => [employee!.id, true])),
    });
    toast.success(`تم تأشير ${matched.length} موظفاً حاضراً بالبصمة من أصل ${activeRoster.length}`);
  };

  const assignUnmatchedPunch = async (employee: Employee, targetWorkshopId: string) => {
    if (!targetWorkshopId) return toast.error("اختر الورشة أولاً");
    setSaving(true);
    try {
      const { data, error } = await supa
        .from("daily_workshop_members")
        .upsert(
          {
            workshop_id: targetWorkshopId,
            employee_id: employee.id,
            role_label: employee.position,
            is_active: true,
          },
          { onConflict: "workshop_id,employee_id" },
        )
        .select("id, workshop_id, employee_id, role_label, is_active")
        .single();
      if (error) throw error;
      queryClient.setQueryData<Member[]>(
        ["daily-workshop-members", targetWorkshopId],
        (current = []) => [...current.filter((member) => member.employee_id !== employee.id), data],
      );
      if (targetWorkshopId === workshopId) {
        setAttendedByEmployee({ ...attendedByEmployee, [employee.id]: true });
      }
      setSelectedWorkshopByPunch((current) => ({ ...current, [employee.id]: "" }));
      setDismissedPunchEmployees((current) => new Set(current).add(employee.id));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["daily-workshop-members"] }),
        queryClient.invalidateQueries({ queryKey: ["daily-workshop-all-active-members"] }),
      ]);
      toast.success(
        targetWorkshopId === workshopId
          ? `تمت إضافة ${employee.full_name} إلى الورشة وتأشيره حاضراً`
          : `تمت إضافة ${employee.full_name} إلى الورشة`,
      );
    } catch (error) {
      toast.error(formatErrorMessage(error, "تعذر إضافة الموظف إلى الورشة"));
    } finally {
      setSaving(false);
    }
  };

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
    const ids = Object.keys(drafts).filter(Boolean);
    if (workshopId && !ids.includes(workshopId)) ids.push(workshopId);
    if (!ids.length) return toast.error("أضف ورشة أو اخترها أولاً");
    setSaving(true);
    try {
      // Rosters for every edited workshop (cached query for the current one, fetch the rest).
      let allMembers: Member[] = members;
      const others = ids.filter((id) => id !== workshopId);
      if (others.length && navigator.onLine) {
        const { data, error } = await supa
          .from("daily_workshop_members")
          .select("id, workshop_id, employee_id, role_label, is_active")
          .in("workshop_id", others)
          .eq("is_active", true);
        if (error) throw error;
        allMembers = [...members, ...(data ?? [])];
      } else {
        for (const id of others) {
          const cached = queryClient.getQueryData<Member[]>(["daily-workshop-members", id]);
          if (cached) allMembers = [...allMembers, ...cached];
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
          .map((m) => ({ ...m, employee: employees.find((e) => e.id === m.employee_id) }))
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
    toast.success("تم تحديث مركز تكلفة الموظف لهذا اليوم");
  };

  const printDailyReport = () => {
    const savedReports = reportQuery.data?.reports ?? [];
    const allLines = reportQuery.data?.lines ?? [];
    if (!savedReports.length) return toast.error("لا توجد تقارير محفوظة لهذا التاريخ");
    const countRoles = (items: AttendanceLine[]) => {
      const counts = new Map<string, number>();
      for (const line of items) {
        const role = line.role_label?.trim() || "بدون صفة";
        counts.set(role, (counts.get(role) ?? 0) + 1);
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1]);
    };
    const content = savedReports
      .map((report) => {
        const workshop = workshops.find((item) => item.id === report.workshop_id);
        const lines = allLines.filter((line) => line.report_id === report.id);
        const attended = lines.filter((line) => line.attended);
        const absent = lines.filter((line) => !line.attended);
        const rate = lines.length ? Math.round((attended.length / lines.length) * 100) : 0;
        const assigned = countRoles(lines);
        const present = new Map(countRoles(attended));
        const roleRows = assigned
          .map(
            ([role, total]) =>
              `<tr><td>${escapeHtml(role)}</td><td class="num">${total}</td><td class="num">${present.get(role) ?? 0}</td><td class="num">${total - (present.get(role) ?? 0)}</td></tr>`,
          )
          .join("");
        const makeTable = (title: string, items: AttendanceLine[]) =>
          items.length
            ? `<h3>${title} (${items.length})</h3><table><thead><tr><th>#</th><th>الرقم الوظيفي</th><th>الاسم</th><th>الصفة</th></tr></thead><tbody>${items.map((line, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(line.employee_no_snapshot)}</td><td>${escapeHtml(line.employee_name_snapshot)}</td><td>${escapeHtml(line.role_label ?? "—")}</td></tr>`).join("")}</tbody></table>`
            : "";
        return `<section class="workshop-sheet"><h2>${escapeHtml(workshop?.name ?? "ورشة")}</h2><p>التاريخ: ${escapeHtml(date)}</p><div class="meta"><span>إجمالي الكادر: <b>${lines.length}</b></span><span>الحاضرون: <b>${attended.length}</b></span><span>الغائبون: <b>${absent.length}</b></span><span>نسبة الحضور: <b>${rate}%</b></span><span>التخصصات الحاضرة: <b>${present.size}</b></span></div><h3>إحصائية التخصصات</h3><table><thead><tr><th>التخصص / الصفة</th><th>المنسبون</th><th>الحاضرون</th><th>الغائبون</th></tr></thead><tbody>${roleRows}<tr class="total"><td>المجموع</td><td class="num">${lines.length}</td><td class="num">${attended.length}</td><td class="num">${absent.length}</td></tr></tbody></table>${makeTable("الحاضرون", attended)}${report.notes ? `<p class="note"><b>ملاحظات:</b> ${escapeHtml(report.notes)}</p>` : ""}</section>`;
      })
      .join("");
    const pageStyle = `<style>.workshop-sheet{break-before:page;page-break-before:always}.workshop-sheet:first-of-type{break-before:auto;page-break-before:auto}.workshop-sheet h3{font-size:15px;margin:12px 0 4px}.workshop-sheet thead{display:table-header-group}.workshop-sheet tr{break-inside:avoid}td.num{text-align:center;font-weight:700}body>h1{display:none}</style>`;
    if (!printReport(`الجرد اليومي للورش — ${date}`, `${pageStyle}${content}`)) {
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
                  <Label htmlFor="workshop-inventory-device">جهاز البصمة</Label>
                  <select
                    id="workshop-inventory-device"
                    className={inputClass}
                    value={deviceId}
                    onChange={(event) => setDeviceId(event.target.value)}
                  >
                    <option value="all">كل الأجهزة المضافة</option>
                    {devices.map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.name}
                        {device.serial_number ? ` · ${device.serial_number}` : ""}
                      </option>
                    ))}
                  </select>
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
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void markRosterFromBiometrics()}
                      disabled={attendancePunchesQuery.isFetching || !activeRoster.length}
                    >
                      <Fingerprint className="ml-2 h-4 w-4" />
                      {attendancePunchesQuery.isFetching
                        ? "جارٍ فحص البصمات..."
                        : "تأشير الحاضرين بالبصمة"}
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
              {unmatchedPunches.length > 0 && (
                <section className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                  <div>
                    <h3 className="font-semibold">حاضرون بالبصمة غير مسجلين في الورش</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      حركات دخول بتاريخ {date} ومن{" "}
                      {deviceId === "all" ? "كل الأجهزة" : "الجهاز المحدد"}.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {unmatchedPunches.map(({ employee, punch }) => {
                      const device = punch.device_id ? deviceById.get(punch.device_id) : undefined;
                      return (
                        <article
                          key={employee.id}
                          className="flex flex-col gap-3 rounded-lg border bg-background/70 p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
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
                                  employee,
                                  selectedWorkshopByPunch[employee.id] ?? "",
                                )
                              }
                              disabled={
                                saving ||
                                !selectedWorkshopByPunch[employee.id] ||
                                activeWorkshopMembersQuery.isLoading ||
                                activeWorkshopMembersQuery.isError
                              }
                            >
                              <Plus className="ml-1 h-4 w-4" />
                              إضافة إلى ورشة
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setDismissedPunchEmployees((current) =>
                                  new Set(current).add(employee.id),
                                )
                              }
                            >
                              إهمال
                            </Button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
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
                      {!online ? " · وضع عدم الاتصال" : ""}
                      {pendingCount ? ` · ${pendingCount} جرد بانتظار المزامنة` : ""}
                    </p>
                    <Button onClick={() => void saveDailyReport()} disabled={saving}>
                      <Save className="ml-2 h-4 w-4" />
                      {saving
                        ? "جارٍ الإرسال..."
                        : draftCount > 1
                          ? `إرسال جرد كل الورش (${draftCount})`
                          : "إرسال الجرد"}
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
