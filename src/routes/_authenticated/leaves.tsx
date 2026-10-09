import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { actOnForm, createForm, getMyFormPowers } from "@/lib/forms.functions";
import { todayInBaghdad } from "@/lib/date-time";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  CalendarCheck2,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Eye,
  FileClock,
  Loader2,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/leaves")({
  head: () => ({ meta: [{ title: "إدارة الإجازات" }] }),
  component: LeavesPage,
});

type LeaveType = {
  id: string;
  code: string;
  name: string;
  is_paid: boolean;
  annual_allowance_days: number | null;
  carryover_cap_days: number;
  count_non_working_days: boolean;
  is_active: boolean;
  sort_order: number;
};
type LeaveRow = {
  id: string;
  form_no: number;
  employee_id: string;
  created_by: string;
  department_id: string | null;
  work_date: string;
  leave_end_date: string | null;
  leave_days: number;
  reason: string;
  status: string;
  rejection_reason: string | null;
  created_at: string;
  manager_approved_at: string | null;
  ceo_approved_at: string | null;
  executed_at: string | null;
  rejected_at: string | null;
  employees: { employee_no: string; full_name: string; department_id: string | null } | null;
  leave_types: LeaveType | null;
  department: { name: string } | null;
};
type Employee = {
  id: string;
  employee_no: string;
  full_name: string;
  department_id: string | null;
};
type BalanceRow = {
  employee_id: string;
  employee_no: string;
  full_name: string;
  department_id: string | null;
  department_name: string | null;
  leave_type_id: string;
  leave_type_code: string;
  leave_type_name: string;
  is_paid: boolean;
  allowance_days: number | null;
  carryover_days: number;
  used_days: number;
  reserved_days: number;
  adjustment_days: number;
  available_days: number | null;
};
type CalendarRow = {
  work_date: string;
  form_id: string;
  form_no: number;
  employee_id: string;
  employee_no: string;
  full_name: string;
  department_name: string | null;
  leave_type_id: string;
  leave_type_name: string;
  is_paid: boolean;
  status: string;
};
type FormEvent = {
  id: string;
  action: string;
  note: string | null;
  actor: string | null;
  created_at: string;
};

const STATUS_LABEL: Record<string, string> = {
  pending_manager: "بانتظار مدير القسم",
  pending_ceo: "بانتظار مدير الشركة",
  pending_execution: "بانتظار التنفيذ",
  executed: "منفذة",
  rejected: "مرفوضة",
};
const STATUS_STYLE: Record<string, string> = {
  pending_manager: "border-amber-200 bg-amber-50 text-amber-800",
  pending_ceo: "border-violet-200 bg-violet-50 text-violet-800",
  pending_execution: "border-sky-200 bg-sky-50 text-sky-800",
  executed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  rejected: "border-red-200 bg-red-50 text-red-800",
};
const WITHDRAWN_REASON = "تم سحب الطلب من مقدم الطلب";
const getStatusLabel = (row: Pick<LeaveRow, "status" | "rejection_reason">) =>
  row.status === "rejected" && row.rejection_reason === WITHDRAWN_REASON
    ? "مسحوب من الموظف"
    : (STATUS_LABEL[row.status] ?? row.status);
const FILTERS = [
  "all",
  "pending_manager",
  "pending_ceo",
  "pending_execution",
  "executed",
  "rejected",
];
const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

const fmtDate = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("ar-IQ", {
    dateStyle: "medium",
    timeZone: "Asia/Baghdad",
  });
const fmtStamp = (value: string) =>
  new Date(value).toLocaleString("ar-IQ", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Baghdad",
  });
const fmtNumber = (value: number | null | undefined) =>
  value == null ? "غير محدود" : Number(value).toLocaleString("ar-IQ", { maximumFractionDigits: 2 });
const dateOverlapYear = (row: LeaveRow, year: number) =>
  row.work_date <= `${year}-12-31` && (row.leave_end_date ?? row.work_date) >= `${year}-01-01`;

function LeavesPage() {
  const { user, isAdmin, isHR, isCompanyManager, roles } = useAuth();
  const qc = useQueryClient();
  const createFn = useServerFn(createForm);
  const actFn = useServerFn(actOnForm);
  const powersFn = useServerFn(getMyFormPowers);
  const canManage = isAdmin || isHR;
  const canCreateForOthers = canManage || roles.includes("data_entry");
  const [year, setYear] = useState(Number(todayInBaghdad().slice(0, 4)));
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = todayInBaghdad();
    return { year: Number(now.slice(0, 4)), month: Number(now.slice(5, 7)) };
  });
  const [requestFilter, setRequestFilter] = useState("all");
  const [requestSearch, setRequestSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [balanceSearch, setBalanceSearch] = useState("");
  const [balanceTypeFilter, setBalanceTypeFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("overview");
  const [requestOpen, setRequestOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [startDate, setStartDate] = useState(todayInBaghdad());
  const [endDate, setEndDate] = useState(todayInBaghdad());
  const [reason, setReason] = useState("");
  const [selectedForm, setSelectedForm] = useState<LeaveRow | null>(null);
  const [rejectingForm, setRejectingForm] = useState<LeaveRow | null>(null);
  const [withdrawingForm, setWithdrawingForm] = useState<LeaveRow | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [policyOpen, setPolicyOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<LeaveType | null>(null);
  const [policyName, setPolicyName] = useState("");
  const [policyAllowance, setPolicyAllowance] = useState("");
  const [policyCarryoverCap, setPolicyCarryoverCap] = useState("0");
  const [policyPaid, setPolicyPaid] = useState(true);
  const [policyCountsRestDays, setPolicyCountsRestDays] = useState(true);
  const [policyActive, setPolicyActive] = useState(true);
  const [adjustmentRow, setAdjustmentRow] = useState<BalanceRow | null>(null);
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [historyRow, setHistoryRow] = useState<BalanceRow | null>(null);

  const powersQuery = useQuery({ queryKey: ["leave-powers"], queryFn: () => powersFn() });
  const powers = powersQuery.data;
  const selfEmployeeQuery = useQuery({
    queryKey: ["leaves", "self-employee", user?.id, user?.email?.toLowerCase()],
    enabled: Boolean(user?.email),
    queryFn: async () => {
      const email = user!.email!.replace(/[\\%_]/g, "\\$&");
      const { data, error } = await supabase
        .from("employees")
        .select("id, employee_no, full_name, department_id, email")
        .eq("status", "active")
        .ilike("email", email)
        .limit(2);
      if (error) throw error;
      const matches = (data ?? []).filter(
        (employee) => employee.email?.toLowerCase() === user!.email!.toLowerCase(),
      );
      return matches.length === 1 ? (matches[0] as Employee) : null;
    },
  });
  const hasWorkflowAccess = Boolean(
    canManage ||
    isCompanyManager ||
    roles.includes("department_manager") ||
    roles.includes("data_entry") ||
    powers?.manager ||
    powers?.ceo ||
    powers?.executor,
  );
  const isSelfService = !hasWorkflowAccess && Boolean(selfEmployeeQuery.data);
  const canView = Boolean(
    canManage ||
    isCompanyManager ||
    roles.includes("department_manager") ||
    roles.includes("data_entry") ||
    powers?.manager ||
    powers?.ceo ||
    powers?.executor ||
    isSelfService,
  );
  const canCreate = canCreateForOthers || Boolean(selfEmployeeQuery.data);
  const canSeeAllRequests = Boolean(
    canManage ||
    isCompanyManager ||
    powers?.globalManager ||
    powers?.ceo ||
    roles.includes("data_entry"),
  );

  const typesQuery = useQuery({
    queryKey: ["leaves", "types"],
    enabled: canView,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("leave_types")
        .select(
          "id, code, name, is_paid, annual_allowance_days, carryover_cap_days, count_non_working_days, is_active, sort_order",
        )
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return (data ?? []) as LeaveType[];
    },
  });
  const types = typesQuery.data ?? [];
  const activeTypes = types.filter((type) => type.is_active);

  const employeesQuery = useQuery({
    queryKey: ["leaves", "employees"],
    enabled: canCreateForOthers,
    queryFn: async () => {
      const output: Employee[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("employees")
          .select("id, employee_no, full_name, department_id")
          .eq("status", "active")
          .order("employee_no")
          .range(from, from + 999);
        if (error) throw error;
        output.push(...((data ?? []) as Employee[]));
        if ((data ?? []).length < 1000) break;
      }
      return output;
    },
  });

  const formsQuery = useQuery({
    queryKey: ["leaves", "forms"],
    enabled: canView,
    queryFn: async () => {
      const output: LeaveRow[] = [];
      for (let from = 0; ; from += 1000) {
        let query = (supabase as any)
          .from("forms")
          .select(
            "id, form_no, employee_id, created_by, department_id, work_date, leave_end_date, leave_days, reason, status, rejection_reason, created_at, manager_approved_at, ceo_approved_at, executed_at, rejected_at, employees(employee_no, full_name, department_id), leave_types(id, code, name, is_paid, annual_allowance_days, carryover_cap_days, count_non_working_days, is_active, sort_order), department:departments!forms_department_id_fkey(name)",
          )
          .eq("kind", "leave")
          .order("created_at", { ascending: false })
          .range(from, from + 999);
        if (!canSeeAllRequests && powers?.managerDepartmentIds?.length) {
          query = query.in("department_id", powers.managerDepartmentIds);
        }
        const { data, error } = await query;
        if (error) throw error;
        output.push(...((data ?? []) as LeaveRow[]));
        if ((data ?? []).length < 1000) break;
      }
      return output;
    },
  });
  const rows = formsQuery.data ?? [];
  const employees = canCreateForOthers
    ? (employeesQuery.data ?? [])
    : selfEmployeeQuery.data
      ? [selfEmployeeQuery.data]
      : [];

  const balanceQuery = useQuery({
    queryKey: ["leaves", "balances", year],
    enabled: canView,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("leave_balance_summary", { _year: year });
      if (error) throw error;
      return (data ?? []) as BalanceRow[];
    },
  });
  const balances = balanceQuery.data ?? [];
  const calendarQuery = useQuery({
    queryKey: ["leaves", "calendar", calendarMonth.year, calendarMonth.month],
    enabled: canView,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("leave_calendar_month", {
        _year: calendarMonth.year,
        _month: calendarMonth.month,
      });
      if (error) throw error;
      return (data ?? []) as CalendarRow[];
    },
  });
  const calendarRows = calendarQuery.data ?? [];

  const previewQuery = useQuery({
    queryKey: ["leaves", "preview", employeeId, leaveTypeId, startDate, endDate],
    enabled:
      requestOpen &&
      Boolean(employeeId && leaveTypeId && startDate && endDate && endDate >= startDate),
    queryFn: async () => {
      const type = activeTypes.find((item) => item.id === leaveTypeId);
      const { data, error } = await (supabase as any).rpc("leave_work_dates", {
        _employee_id: employeeId,
        _start_date: startDate,
        _end_date: endDate,
        _count_non_working_days: type?.count_non_working_days ?? true,
      });
      if (error) throw error;
      return (data ?? []).length as number;
    },
  });

  const eventsQuery = useQuery({
    queryKey: ["leaves", "events", selectedForm?.id],
    enabled: Boolean(selectedForm?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("form_events")
        .select("id, action, note, actor, created_at")
        .eq("form_id", selectedForm!.id)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as FormEvent[];
    },
  });
  const actors = [
    ...new Set((eventsQuery.data ?? []).map((event) => event.actor).filter(Boolean)),
  ] as string[];
  const actorNamesQuery = useQuery({
    queryKey: ["leaves", "event-actors", actors.join(",")],
    enabled: actors.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", actors);
      if (error) throw error;
      return new Map(
        (data ?? []).map((profile) => [profile.id, profile.full_name ?? "مستخدم النظام"]),
      );
    },
  });
  const balanceHistoryQuery = useQuery({
    queryKey: [
      "leaves",
      "balance-history",
      historyRow?.employee_id,
      historyRow?.leave_type_id,
      year,
    ],
    enabled: Boolean(historyRow && canManage),
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("leave_balance_transactions")
        .select("id, effective_year, amount, reason, created_at, created_by")
        .eq("employee_id", historyRow!.employee_id)
        .eq("leave_type_id", historyRow!.leave_type_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as {
        id: string;
        effective_year: number;
        amount: number;
        reason: string;
        created_at: string;
        created_by: string;
      }[];
    },
  });

  const yearRows = useMemo(() => rows.filter((row) => dateOverlapYear(row, year)), [rows, year]);
  const yearOptions = useMemo(() => {
    const result = new Set([Number(todayInBaghdad().slice(0, 4))]);
    for (const row of rows) {
      const first = Number(row.work_date.slice(0, 4));
      const last = Number((row.leave_end_date ?? row.work_date).slice(0, 4));
      for (let value = first; value <= last; value += 1) result.add(value);
    }
    return [...result].sort((left, right) => right - left);
  }, [rows]);
  const stats = useMemo(
    () => ({
      requests: yearRows.length,
      pending: yearRows.filter((row) => row.status.startsWith("pending_")).length,
      executed: yearRows.filter((row) => row.status === "executed").length,
      paidDays: balances
        .filter((row) => row.is_paid)
        .reduce((sum, row) => sum + Number(row.used_days), 0),
      atRisk: balances.filter((row) => row.available_days != null && row.available_days < 0).length,
    }),
    [yearRows, balances],
  );

  const departments = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows)
      if (row.department_id && row.department?.name)
        map.set(row.department_id, row.department.name);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "ar"));
  }, [rows]);
  const visibleRequests = useMemo(() => {
    const term = requestSearch.trim().toLocaleLowerCase("ar");
    return yearRows.filter((row) => {
      if (requestFilter !== "all" && row.status !== requestFilter) return false;
      if (departmentFilter !== "all" && row.department_id !== departmentFilter) return false;
      if (!term) return true;
      return `${row.employees?.employee_no ?? ""} ${row.employees?.full_name ?? ""} ${row.reason} ${row.form_no}`
        .toLocaleLowerCase("ar")
        .includes(term);
    });
  }, [yearRows, requestFilter, departmentFilter, requestSearch]);
  const visibleBalances = useMemo(() => {
    const term = balanceSearch.trim().toLocaleLowerCase("ar");
    return balances.filter((row) => {
      if (balanceTypeFilter !== "all" && row.leave_type_id !== balanceTypeFilter) return false;
      return (
        !term ||
        `${row.employee_no} ${row.full_name} ${row.department_name ?? ""}`
          .toLocaleLowerCase("ar")
          .includes(term)
      );
    });
  }, [balances, balanceSearch, balanceTypeFilter]);

  const createMutation = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          employee_id: employeeId,
          work_date: startDate,
          leave_end_date: endDate,
          leave_type_id: leaveTypeId,
          kind: "leave",
          day_status: "leave",
          overtime_hours: 0,
          check_in: null,
          check_out: null,
          target_department_id: null,
          reason,
        } as never,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["leaves"] });
      setRequestOpen(false);
      setReason("");
      setEmployeeId("");
      toast.success("أُرسل طلب الإجازة إلى مسار الاعتماد");
    },
    onError: (error: Error) => toast.error(error.message || "تعذر إرسال طلب الإجازة"),
  });
  const actionMutation = useMutation({
    mutationFn: (payload: {
      form_id: string;
      action: "approve" | "reject" | "execute" | "withdraw";
      note?: string | null;
    }) => actFn({ data: payload }),
    onSuccess: async (_, payload) => {
      await qc.invalidateQueries({ queryKey: ["leaves"] });
      setRejectingForm(null);
      setRejectionReason("");
      if (payload.action === "withdraw") {
        setSelectedForm(null);
        setWithdrawingForm(null);
      }
      toast.success("تم تحديث الطلب وسجل الإجراء");
    },
    onError: (error: Error) => toast.error(error.message || "تعذر تنفيذ الإجراء"),
  });

  const openNewPolicy = () => {
    setEditingPolicy(null);
    setPolicyName("");
    setPolicyAllowance("");
    setPolicyCarryoverCap("0");
    setPolicyPaid(true);
    setPolicyCountsRestDays(true);
    setPolicyActive(true);
    setPolicyOpen(true);
  };
  const openEditPolicy = (type: LeaveType) => {
    setEditingPolicy(type);
    setPolicyName(type.name);
    setPolicyAllowance(
      type.annual_allowance_days == null ? "" : String(type.annual_allowance_days),
    );
    setPolicyCarryoverCap(String(type.carryover_cap_days ?? 0));
    setPolicyPaid(type.is_paid);
    setPolicyCountsRestDays(type.count_non_working_days);
    setPolicyActive(type.is_active);
    setPolicyOpen(true);
  };
  const savePolicy = async () => {
    const name = policyName.trim();
    const allowance = policyAllowance.trim() === "" ? null : Number(policyAllowance);
    const carryoverCap = Number(policyCarryoverCap);
    if (name.length < 2) return toast.error("اكتب اسماً واضحاً لنوع الإجازة");
    if (allowance != null && (!Number.isInteger(allowance) || allowance < 0 || allowance > 365))
      return toast.error("أدخل سقفاً صحيحاً من 0 إلى 365 يوماً أو اتركه فارغاً دون سقف");
    if (!Number.isInteger(carryoverCap) || carryoverCap < 0 || carryoverCap > 365)
      return toast.error("أدخل سقف ترحيل صحيحاً من 0 إلى 365 يوماً");
    const payload = {
      name,
      is_paid: policyPaid,
      annual_allowance_days: allowance,
      carryover_cap_days: carryoverCap,
      count_non_working_days: policyCountsRestDays,
      is_active: policyActive,
    };
    const result = editingPolicy
      ? await (supabase as any).from("leave_types").update(payload).eq("id", editingPolicy.id)
      : await (supabase as any).from("leave_types").insert({
          ...payload,
          code: `custom_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
          sort_order: 100,
        });
    if (result.error) return toast.error(`تعذر حفظ السياسة: ${result.error.message}`);
    await qc.invalidateQueries({ queryKey: ["leaves"] });
    setPolicyOpen(false);
    toast.success(editingPolicy ? "تم تحديث سياسة الإجازة" : "أُضيف نوع الإجازة");
  };

  const saveAdjustment = async () => {
    if (!adjustmentRow) return;
    const amount = Number(adjustmentAmount);
    const note = adjustmentReason.trim();
    if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 365)
      return toast.error("أدخل حركة رصيد صحيحة بين -365 و365 ولا تساوي صفراً");
    if (note.length < 3) return toast.error("سبب تعديل الرصيد مطلوب للتدقيق");
    const { error } = await (supabase as any).from("leave_balance_transactions").insert({
      employee_id: adjustmentRow.employee_id,
      leave_type_id: adjustmentRow.leave_type_id,
      effective_year: year,
      amount,
      reason: note,
    });
    if (error) return toast.error(`تعذر تسجيل الحركة: ${error.message}`);
    await qc.invalidateQueries({ queryKey: ["leaves"] });
    setAdjustmentRow(null);
    setAdjustmentAmount("");
    setAdjustmentReason("");
    toast.success("سُجل تعديل الرصيد في دفتر الحركات");
  };

  const getAction = (row: LeaveRow) => {
    if (
      row.status === "pending_manager" &&
      (canManage ||
        powers?.globalManager ||
        powers?.managerDepartmentIds?.includes(row.department_id ?? ""))
    )
      return "approve" as const;
    if (row.status === "pending_ceo" && (isAdmin || isCompanyManager || powers?.ceo))
      return "approve" as const;
    if (row.status === "pending_execution" && (canManage || powers?.executor))
      return "execute" as const;
    return null;
  };
  const rejectAllowed = (row: LeaveRow) =>
    (row.status === "pending_manager" &&
      (canManage ||
        powers?.globalManager ||
        powers?.managerDepartmentIds?.includes(row.department_id ?? ""))) ||
    (row.status === "pending_ceo" && (isAdmin || isCompanyManager || powers?.ceo)) ||
    (row.status === "pending_execution" && (canManage || powers?.executor));
  const canWithdraw = (row: LeaveRow) =>
    Boolean(
      selfEmployeeQuery.data &&
      user?.id &&
      row.employee_id === selfEmployeeQuery.data.id &&
      row.created_by === user.id &&
      ["pending_manager", "pending_ceo", "pending_execution"].includes(row.status),
    );

  const exportRequests = () => {
    const data = visibleRequests.map((row) => ({
      "رقم الطلب": row.form_no,
      "رقم الموظف": row.employees?.employee_no ?? "",
      "اسم الموظف": row.employees?.full_name ?? "",
      القسم: row.department?.name ?? "",
      "نوع الإجازة": row.leave_types?.name ?? "سنوية",
      مدفوعة: row.leave_types?.is_paid === false ? "لا" : "نعم",
      "من تاريخ": row.work_date,
      "إلى تاريخ": row.leave_end_date ?? row.work_date,
      "أيام الرصيد": row.leave_days,
      الحالة: getStatusLabel(row),
      السبب: row.reason,
      "سبب الرفض": row.rejection_reason ?? "",
    }));
    const sheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "طلبات الإجازة");
    XLSX.writeFile(workbook, `طلبات_الإجازة_${year}.xlsx`);
  };
  const exportBalances = () => {
    const data = visibleBalances.map((row) => ({
      "رقم الموظف": row.employee_no,
      "اسم الموظف": row.full_name,
      القسم: row.department_name ?? "",
      "نوع الإجازة": row.leave_type_name,
      المدفوع: row.is_paid ? "نعم" : "لا",
      "الرصيد السنوي": row.allowance_days == null ? "دون سقف" : row.allowance_days,
      "المرحّل من السنة السابقة": row.carryover_days,
      المستهلك: row.used_days,
      "محجوز للطلبات": row.reserved_days,
      "تسويات الرصيد": row.adjustment_days,
      المتبقي: row.available_days == null ? "دون سقف" : row.available_days,
      السنة: year,
    }));
    const sheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "أرصدة الإجازات");
    XLSX.writeFile(workbook, `أرصدة_الإجازات_${year}.xlsx`);
  };

  if (!canView && !powersQuery.isLoading && !selfEmployeeQuery.isLoading) {
    return (
      <div dir="rtl" className="rounded-2xl border bg-card p-8 text-center text-muted-foreground">
        لا تملك صلاحية الوصول إلى إدارة الإجازات.
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-6 pb-10">
      <section className="overflow-hidden rounded-3xl bg-gradient-to-l from-slate-950 via-slate-900 to-teal-950 p-6 text-white shadow-xl md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm text-teal-200">
              <ShieldCheck className="h-4 w-4" />{" "}
              {isSelfService
                ? "خدمة الموظف الذاتية · الطلب والرصيد"
                : "الموارد البشرية · دورة كاملة قابلة للتدقيق"}
            </div>
            <h1 className="text-3xl font-black tracking-tight md:text-4xl">إدارة الإجازات</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              {isSelfService
                ? "قدّم طلبك، وتابع مراحل الاعتماد ورصيدك السنوي وسجل إجازاتك من مكان واحد."
                : "الطلبات والموافقات والأرصدة والسياسات في مساحة واحدة، مرتبطة بجداول الدوام وكشف الحضور والراتب."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}>
              <SelectTrigger className="w-32 border-white/20 bg-white/10 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canCreate && (
              <Button
                onClick={() => {
                  setEmployeeId(!canCreateForOthers ? (selfEmployeeQuery.data?.id ?? "") : "");
                  setLeaveTypeId(
                    activeTypes.find((type) => type.code === "annual")?.id ??
                      activeTypes[0]?.id ??
                      "",
                  );
                  setRequestOpen(true);
                }}
                className="bg-teal-400 font-bold text-slate-950 hover:bg-teal-300"
              >
                <Plus className="ml-2 h-4 w-4" /> طلب إجازة
              </Button>
            )}
          </div>
        </div>
      </section>

      {(formsQuery.error || balanceQuery.error || calendarQuery.error || typesQuery.error) && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          تعذر تحميل بعض بيانات الإجازات:{" "}
          {String(
            formsQuery.error?.message ??
              balanceQuery.error?.message ??
              calendarQuery.error?.message ??
              typesQuery.error?.message,
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Kpi
          label={`الطلبات في ${year}`}
          value={stats.requests}
          icon={CalendarCheck2}
          tone="teal"
        />
        <Kpi label="بانتظار إجراء" value={stats.pending} icon={Clock3} tone="amber" />
        <Kpi label="طلبات منفذة" value={stats.executed} icon={Check} tone="green" />
        <Kpi label="أيام مدفوعة مستهلكة" value={stats.paidDays} icon={Wallet} tone="blue" />
        <Kpi
          label="أرصدة تحتاج مراجعة"
          value={stats.atRisk}
          icon={AlertTriangle}
          tone={stats.atRisk ? "red" : "slate"}
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} dir="rtl">
        <TabsList
          className={`grid h-auto w-full grid-cols-2 gap-1 rounded-2xl bg-muted p-1 md:w-fit ${canManage ? "md:grid-cols-4" : "md:grid-cols-3"}`}
        >
          <TabsTrigger className="min-h-10 rounded-xl" value="overview">
            <CalendarDays className="ml-2 h-4 w-4" />
            نظرة عامة
          </TabsTrigger>
          <TabsTrigger className="min-h-10 rounded-xl" value="requests">
            <FileClock className="ml-2 h-4 w-4" />
            الطلبات والموافقات
          </TabsTrigger>
          <TabsTrigger className="min-h-10 rounded-xl" value="balances">
            <Wallet className="ml-2 h-4 w-4" />
            الأرصدة
          </TabsTrigger>
          {canManage && (
            <TabsTrigger className="min-h-10 rounded-xl" value="policies">
              <Settings2 className="ml-2 h-4 w-4" />
              السياسات والأنواع
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
            <Card className="overflow-hidden rounded-2xl border-0 shadow-sm ring-1 ring-border/70">
              <CardHeader className="flex flex-row items-center justify-between gap-2 border-b bg-muted/20">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <CalendarDays className="h-5 w-5 text-primary" />
                    تقويم الإجازات
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    الأيام محسوبة وفق سياسة النوع وجداول دوام الموظفين.
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label="الشهر السابق"
                    onClick={() =>
                      setCalendarMonth((current) => {
                        const date = new Date(current.year, current.month - 2, 1);
                        return { year: date.getFullYear(), month: date.getMonth() + 1 };
                      })
                    }
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <span className="min-w-32 text-center text-sm font-bold">
                    {new Date(calendarMonth.year, calendarMonth.month - 1, 1).toLocaleDateString(
                      "ar-IQ",
                      { month: "long", year: "numeric" },
                    )}
                  </span>
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label="الشهر التالي"
                    onClick={() =>
                      setCalendarMonth((current) => {
                        const date = new Date(current.year, current.month, 1);
                        return { year: date.getFullYear(), month: date.getMonth() + 1 };
                      })
                    }
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-3 sm:p-5">
                <LeaveCalendar
                  year={calendarMonth.year}
                  month={calendarMonth.month}
                  rows={calendarRows}
                  onSelect={(row) =>
                    setSelectedForm(rows.find((item) => item.id === row.form_id) ?? null)
                  }
                />
                <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <Legend color="bg-amber-400" label="بانتظار الموافقة" />
                  <Legend color="bg-sky-500" label="بانتظار التنفيذ" />
                  <Legend color="bg-emerald-500" label="منفذة" />
                  <Legend color="bg-violet-500" label="غير مدفوعة" />
                </div>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border-0 shadow-sm ring-1 ring-border/70">
              <CardHeader className="border-b bg-muted/20">
                <CardTitle className="flex items-center gap-2">
                  <Clock3 className="h-5 w-5 text-amber-600" />
                  {isSelfService ? "حالة طلباتك" : "قائمة الإجراءات"}
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isSelfService
                    ? "تابع حالة طلباتك ومراحل اعتمادها."
                    : "طلبات السنة التي تحتاج مراجعة في مرحلة الاعتماد المتاحة لك."}
                </p>
              </CardHeader>
              <CardContent className="space-y-3 p-4">
                {yearRows
                  .filter((row) => isSelfService || Boolean(getAction(row)) || rejectAllowed(row))
                  .slice(0, 7)
                  .map((row) => (
                    <div
                      key={row.id}
                      className="flex items-start justify-between gap-3 rounded-xl border p-3"
                    >
                      <button
                        className="min-w-0 flex-1 text-right"
                        onClick={() => setSelectedForm(row)}
                      >
                        <span className="block truncate font-bold">
                          {isSelfService
                            ? `طلب #${row.form_no}`
                            : (row.employees?.full_name ?? "موظف")}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {row.work_date} · {row.leave_days} يوم ·{" "}
                          {row.leave_types?.name ?? "سنوية"}
                        </span>
                        <Badge
                          className={`mt-2 border ${STATUS_STYLE[row.status] ?? ""}`}
                          variant="outline"
                        >
                          {getStatusLabel(row)}
                        </Badge>
                      </button>
                      {!isSelfService && getAction(row) === "approve" && (
                        <Button
                          size="sm"
                          onClick={() =>
                            actionMutation.mutate({ form_id: row.id, action: "approve" })
                          }
                          disabled={actionMutation.isPending}
                        >
                          اعتماد
                        </Button>
                      )}
                      {!isSelfService && getAction(row) === "execute" && (
                        <Button
                          size="sm"
                          onClick={() =>
                            actionMutation.mutate({ form_id: row.id, action: "execute" })
                          }
                          disabled={actionMutation.isPending}
                        >
                          تنفيذ
                        </Button>
                      )}
                    </div>
                  ))}
                {!yearRows.some(
                  (row) => isSelfService || Boolean(getAction(row)) || rejectAllowed(row),
                ) && (
                  <EmptyState
                    text={
                      isSelfService
                        ? "لا توجد طلبات إجازة في هذه السنة."
                        : "لا توجد طلبات بانتظار إجراء منك."
                    }
                  />
                )}
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setActiveTab("requests");
                    setRequestFilter("all");
                  }}
                >
                  عرض جميع الطلبات
                </Button>
              </CardContent>
            </Card>
          </div>
          <Card className="rounded-2xl border-0 shadow-sm ring-1 ring-border/70">
            <CardHeader className="border-b bg-muted/20">
              <CardTitle>ملخص أنواع الإجازات</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {types
                .filter((type) => type.is_active)
                .map((type) => {
                  const balancesOfType = balances.filter(
                    (balance) => balance.leave_type_id === type.id,
                  );
                  const used = balancesOfType.reduce(
                    (sum, balance) => sum + Number(balance.used_days),
                    0,
                  );
                  const reserved = balancesOfType.reduce(
                    (sum, balance) => sum + Number(balance.reserved_days),
                    0,
                  );
                  return (
                    <div key={type.id} className="rounded-xl border bg-background p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-bold">{type.name}</p>
                        <Badge variant="outline">{type.is_paid ? "مدفوعة" : "غير مدفوعة"}</Badge>
                      </div>
                      <p className="mt-3 text-sm text-muted-foreground">
                        مستهلك {fmtNumber(used)} يوم · محجوز {fmtNumber(reserved)} يوم
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        السقف {fmtNumber(type.annual_allowance_days)} يوم سنوياً · ترحيل حتى{" "}
                        {fmtNumber(type.carryover_cap_days)} يوم
                      </p>
                    </div>
                  );
                })}
              {!types.some((type) => type.is_active) && (
                <EmptyState text="أضف سياسة إجازة لتفعيل تقديم الطلبات." />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="requests" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3">
            <div className="relative min-w-56 flex-1">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pr-9"
                value={requestSearch}
                onChange={(event) => setRequestSearch(event.target.value)}
                placeholder="ابحث بالموظف أو رقم الطلب أو السبب"
              />
            </div>
            <Select value={requestFilter} onValueChange={setRequestFilter}>
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILTERS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value === "all"
                      ? "كل الحالات"
                      : value === "rejected"
                        ? "مرفوضة أو مسحوبة"
                        : STATUS_LABEL[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {departments.length > 0 && (
              <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="القسم" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الأقسام</SelectItem>
                  {departments.map(([id, name]) => (
                    <SelectItem key={id} value={id}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" onClick={exportRequests}>
              <Download className="ml-2 h-4 w-4" />
              تصدير Excel
            </Button>
          </div>
          <Card className="overflow-hidden rounded-2xl border-0 shadow-sm ring-1 ring-border/70">
            <CardHeader className="border-b bg-muted/20">
              <CardTitle>
                طلبات {year}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  ({visibleRequests.length} من {yearRows.length})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30 text-right text-xs text-muted-foreground">
                      <th className="p-3">الطلب والموظف</th>
                      <th className="p-3">النوع</th>
                      <th className="p-3">الفترة</th>
                      <th className="p-3">أيام الرصيد</th>
                      <th className="p-3">الحالة</th>
                      <th className="p-3">الإجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRequests.map((row) => (
                      <tr key={row.id} className="border-b last:border-0 hover:bg-muted/20">
                        <td className="p-3">
                          <button className="text-right" onClick={() => setSelectedForm(row)}>
                            <span className="block font-bold">
                              {row.employees?.full_name ?? "—"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              #{row.form_no} · {row.employees?.employee_no ?? "—"} ·{" "}
                              {row.department?.name ?? "دون قسم"}
                            </span>
                          </button>
                        </td>
                        <td className="p-3">
                          <span className="block font-medium">
                            {row.leave_types?.name ?? "إجازة سنوية"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {row.leave_types?.is_paid === false ? "غير مدفوعة" : "مدفوعة"}
                          </span>
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          {fmtDate(row.work_date)}
                          {row.leave_end_date && row.leave_end_date !== row.work_date
                            ? ` — ${fmtDate(row.leave_end_date)}`
                            : ""}
                        </td>
                        <td className="p-3 font-bold">{fmtNumber(row.leave_days)}</td>
                        <td className="p-3">
                          <Badge
                            className={`border ${STATUS_STYLE[row.status] ?? ""}`}
                            variant="outline"
                          >
                            {getStatusLabel(row)}
                          </Badge>
                          {row.rejection_reason && (
                            <p
                              className="mt-1 max-w-48 truncate text-xs text-red-600"
                              title={row.rejection_reason}
                            >
                              {row.rejection_reason}
                            </p>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label="تفاصيل الطلب"
                              onClick={() => setSelectedForm(row)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {getAction(row) === "approve" && (
                              <Button
                                size="sm"
                                onClick={() =>
                                  actionMutation.mutate({ form_id: row.id, action: "approve" })
                                }
                                disabled={actionMutation.isPending}
                              >
                                <Check className="ml-1 h-3 w-3" />
                                اعتماد
                              </Button>
                            )}
                            {getAction(row) === "execute" && (
                              <Button
                                size="sm"
                                onClick={() =>
                                  actionMutation.mutate({ form_id: row.id, action: "execute" })
                                }
                                disabled={actionMutation.isPending}
                              >
                                تنفيذ
                              </Button>
                            )}
                            {rejectAllowed(row) && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-destructive"
                                onClick={() => setRejectingForm(row)}
                              >
                                <X className="ml-1 h-3 w-3" />
                                رفض
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!visibleRequests.length && (
                      <tr>
                        <td colSpan={6} className="p-12 text-center text-muted-foreground">
                          لا توجد طلبات مطابقة للفلاتر في {year}.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="balances" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3">
            <div className="relative min-w-56 flex-1">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pr-9"
                value={balanceSearch}
                onChange={(event) => setBalanceSearch(event.target.value)}
                placeholder="ابحث عن الموظف أو القسم"
              />
            </div>
            <Select value={balanceTypeFilter} onValueChange={setBalanceTypeFilter}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="نوع الإجازة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل أنواع الإجازات</SelectItem>
                {types.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={exportBalances}>
              <Download className="ml-2 h-4 w-4" />
              تصدير Excel
            </Button>
          </div>
          <Card className="overflow-hidden rounded-2xl border-0 shadow-sm ring-1 ring-border/70">
            <CardHeader className="border-b bg-muted/20">
              <CardTitle>أرصدة الموظفين · {year}</CardTitle>
              <p className="text-xs text-muted-foreground">
                المستهلك والمنفذ والمحجوز للطلبات المعلقة والتسويات اليدوية تظهر كلٌ على حدة.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1120px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30 text-right text-xs text-muted-foreground">
                      <th className="p-3">الموظف</th>
                      <th className="p-3">نوع الإجازة</th>
                      <th className="p-3">الرصيد الأساسي</th>
                      <th className="p-3">الترحيل من العام السابق</th>
                      <th className="p-3">المستهلك</th>
                      <th className="p-3">محجوز</th>
                      <th className="p-3">التسويات</th>
                      <th className="p-3">المتبقي</th>
                      <th className="p-3">إدارة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleBalances.map((row) => (
                      <tr
                        key={`${row.employee_id}-${row.leave_type_id}`}
                        className="border-b last:border-0 hover:bg-muted/20"
                      >
                        <td className="p-3">
                          <span className="block font-bold">{row.full_name}</span>
                          <span className="text-xs text-muted-foreground">
                            {row.employee_no} · {row.department_name ?? "دون قسم"}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className="block">{row.leave_type_name}</span>
                          <Badge variant="outline" className="mt-1">
                            {row.is_paid ? "مدفوعة" : "غير مدفوعة"}
                          </Badge>
                        </td>
                        <td className="p-3">
                          {fmtNumber(
                            row.allowance_days == null
                              ? null
                              : row.allowance_days - row.carryover_days,
                          )}
                        </td>
                        <td className="p-3">{fmtNumber(row.carryover_days)}</td>
                        <td className="p-3">{fmtNumber(row.used_days)}</td>
                        <td className="p-3">{fmtNumber(row.reserved_days)}</td>
                        <td className="p-3">
                          {Number(row.adjustment_days) > 0 ? "+" : ""}
                          {fmtNumber(row.adjustment_days)}
                        </td>
                        <td
                          className={`p-3 font-black ${row.available_days != null && row.available_days < 0 ? "text-red-600" : "text-teal-700"}`}
                        >
                          {fmtNumber(row.available_days)}
                        </td>
                        <td className="p-3">
                          <div className="flex gap-1">
                            {canManage && row.allowance_days != null && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setAdjustmentRow(row)}
                              >
                                <Plus className="ml-1 h-3 w-3" />
                                تسوية
                              </Button>
                            )}
                            {canManage && (
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label="سجل الرصيد"
                                onClick={() => setHistoryRow(row)}
                              >
                                <FileClock className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!visibleBalances.length && (
                      <tr>
                        <td colSpan={9} className="p-12 text-center text-muted-foreground">
                          لا توجد أرصدة مطابقة.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {canManage && (
          <TabsContent value="policies" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4">
              <div>
                <h2 className="font-bold">سياسات وأنواع الإجازات</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  اضبط الرصيد السنوي والترحيل وحالة الدفع وطريقة احتساب أيام الراحة وفق سياسة
                  المنشأة.
                </p>
              </div>
              <Button onClick={openNewPolicy}>
                <Plus className="ml-2 h-4 w-4" />
                نوع جديد
              </Button>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {types.map((type) => (
                <Card key={type.id} className={`rounded-2xl ${type.is_active ? "" : "opacity-65"}`}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-black">{type.name}</h3>
                          <Badge variant={type.is_active ? "default" : "secondary"}>
                            {type.is_active ? "فعالة" : "متوقفة"}
                          </Badge>
                          <Badge variant="outline">{type.is_paid ? "مدفوعة" : "غير مدفوعة"}</Badge>
                        </div>
                        <p className="mt-3 text-sm text-muted-foreground">
                          السقف السنوي:{" "}
                          <strong className="text-foreground">
                            {fmtNumber(type.annual_allowance_days)} يوم
                          </strong>
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          حد الترحيل:{" "}
                          <strong className="text-foreground">
                            {fmtNumber(type.carryover_cap_days)} يوم
                          </strong>
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {type.count_non_working_days
                            ? "تُحتسب كل أيام التقويم"
                            : "تُحتسب أيام دوام الموظف حسب جدول الورديات"}
                        </p>
                      </div>
                      <Button variant="outline" onClick={() => openEditPolicy(type)}>
                        <Settings2 className="ml-2 h-4 w-4" />
                        تعديل
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarCheck2 className="h-5 w-5 text-primary" />
              تقديم طلب إجازة
            </DialogTitle>
            <DialogDescription>
              يُحجز الرصيد عند إرسال الطلب ثم يخصم عند التنفيذ، ويُعاد تلقائياً عند الرفض.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              {isSelfService ? (
                <>
                  <Label>الموظف</Label>
                  <div className="mt-1 rounded-lg border bg-muted/30 px-3 py-2 text-sm font-medium">
                    {selfEmployeeQuery.data?.employee_no} — {selfEmployeeQuery.data?.full_name}
                  </div>
                </>
              ) : (
                <>
                  <Label>الموظف</Label>
                  <Select value={employeeId} onValueChange={setEmployeeId}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="اختر الموظف" />
                    </SelectTrigger>
                    <SelectContent>
                      {employees.map((employee) => (
                        <SelectItem key={employee.id} value={employee.id}>
                          {employee.employee_no} — {employee.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>
            <div className="sm:col-span-2">
              <Label>نوع الإجازة</Label>
              <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="اختر نوع الإجازة" />
                </SelectTrigger>
                <SelectContent>
                  {activeTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.name} · {type.is_paid ? "مدفوعة" : "بدون راتب"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                {activeTypes.find((type) => type.id === leaveTypeId)?.count_non_working_days
                  ? "تُحسب أيام التقويم كاملة."
                  : "تُحسب أيام الدوام وفق جدول الموظف."}
              </p>
            </div>
            <div>
              <Label>من تاريخ</Label>
              <Input
                className="mt-1"
                type="date"
                value={startDate}
                onChange={(event) => {
                  setStartDate(event.target.value);
                  if (event.target.value > endDate) setEndDate(event.target.value);
                }}
              />
            </div>
            <div>
              <Label>إلى تاريخ</Label>
              <Input
                className="mt-1"
                type="date"
                min={startDate}
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
            <div className="sm:col-span-2 rounded-xl border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-bold">أيام الرصيد المحتسبة</p>
                  <p className="text-xs text-muted-foreground">
                    المعاينة تتبع جدول الدوام والسياسة المختارة.
                  </p>
                </div>
                <span className="min-w-16 text-center text-2xl font-black text-primary">
                  {previewQuery.isLoading ? "…" : fmtNumber(previewQuery.data)}
                </span>
              </div>
            </div>
            <div className="sm:col-span-2">
              <Label>سبب الإجازة وملاحظات المدير</Label>
              <Textarea
                className="mt-1"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={1000}
                rows={4}
                placeholder="اكتب سبب الطلب أو المعلومات التي يحتاجها المعتمدون"
              />
              <p className="mt-1 text-left text-xs text-muted-foreground">{reason.length}/1000</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRequestOpen(false)}>
              إلغاء
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={
                createMutation.isPending ||
                !employeeId ||
                !leaveTypeId ||
                !reason.trim() ||
                !previewQuery.data
              }
            >
              <Loader2
                className={`ml-2 h-4 w-4 animate-spin ${createMutation.isPending ? "" : "hidden"}`}
              />
              إرسال للموافقة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedForm)} onOpenChange={(open) => !open && setSelectedForm(null)}>
        <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {selectedForm && (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle>تفاصيل طلب الإجازة #{selectedForm.form_no}</DialogTitle>
                  <Badge variant="outline" className={STATUS_STYLE[selectedForm.status]}>
                    {getStatusLabel(selectedForm)}
                  </Badge>
                </div>
                <DialogDescription>
                  {selectedForm.employees?.employee_no} — {selectedForm.employees?.full_name} ·{" "}
                  {selectedForm.department?.name ?? "دون قسم"}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                <Detail
                  label="نوع الإجازة"
                  value={`${selectedForm.leave_types?.name ?? "سنوية"} · ${selectedForm.leave_types?.is_paid === false ? "غير مدفوعة" : "مدفوعة"}`}
                />
                <Detail
                  label="الفترة"
                  value={`${fmtDate(selectedForm.work_date)} — ${fmtDate(selectedForm.leave_end_date ?? selectedForm.work_date)}`}
                />
                <Detail
                  label="الأيام المحتسبة"
                  value={`${fmtNumber(selectedForm.leave_days)} يوم`}
                />
                <Detail label="تاريخ الطلب" value={fmtStamp(selectedForm.created_at)} />
              </div>
              <div className="rounded-xl border p-4">
                <p className="mb-2 text-xs font-bold text-muted-foreground">سبب الطلب</p>
                <p className="whitespace-pre-wrap text-sm leading-6">{selectedForm.reason}</p>
              </div>
              {selectedForm.rejection_reason && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  <strong>
                    {selectedForm.rejection_reason === WITHDRAWN_REASON
                      ? "سبب السحب:"
                      : "سبب الرفض:"}
                  </strong>{" "}
                  {selectedForm.rejection_reason}
                </div>
              )}
              <div>
                <h3 className="mb-3 flex items-center gap-2 font-bold">
                  <FileClock className="h-4 w-4" />
                  سجل الاعتمادات والإجراءات
                </h3>
                <div className="space-y-2">
                  {(eventsQuery.data ?? []).map((event) => (
                    <div key={event.id} className="flex gap-3 rounded-lg border p-3">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">
                          {eventLabel(event.action)}{" "}
                          <span className="font-normal text-muted-foreground">
                            · {actorNamesQuery.data?.get(event.actor ?? "") ?? "مستخدم النظام"}
                          </span>
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {fmtStamp(event.created_at)}
                        </p>
                        {event.note && <p className="mt-1 break-words text-sm">{event.note}</p>}
                      </div>
                    </div>
                  ))}
                  {!eventsQuery.data?.length && (
                    <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                      لا يوجد سجل إجراءات إضافي لهذا الطلب.
                    </p>
                  )}
                </div>
              </div>
              <DialogFooter className="flex-wrap sm:justify-start">
                {getAction(selectedForm) === "approve" && (
                  <Button
                    onClick={() =>
                      actionMutation.mutate({ form_id: selectedForm.id, action: "approve" })
                    }
                    disabled={actionMutation.isPending}
                  >
                    <Check className="ml-2 h-4 w-4" />
                    اعتماد
                  </Button>
                )}
                {getAction(selectedForm) === "execute" && (
                  <Button
                    onClick={() =>
                      actionMutation.mutate({ form_id: selectedForm.id, action: "execute" })
                    }
                    disabled={actionMutation.isPending}
                  >
                    تنفيذ وربط بالحضور
                  </Button>
                )}
                {rejectAllowed(selectedForm) && (
                  <Button
                    variant="outline"
                    className="text-destructive"
                    onClick={() => setRejectingForm(selectedForm)}
                  >
                    <X className="ml-2 h-4 w-4" />
                    رفض مع توضيح السبب
                  </Button>
                )}
                {canWithdraw(selectedForm) && (
                  <Button
                    variant="outline"
                    className="text-destructive"
                    onClick={() => setWithdrawingForm(selectedForm)}
                  >
                    <X className="ml-2 h-4 w-4" />
                    سحب الطلب
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(withdrawingForm)}
        onOpenChange={(open) => !open && setWithdrawingForm(null)}
      >
        <DialogContent dir="rtl" className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>سحب طلب الإجازة؟</DialogTitle>
            <DialogDescription>
              سيُغلق الطلب ويُعاد حجز أيامه إلى رصيدك. سيبقى الطلب وسجل السحب محفوظين للمراجعة.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWithdrawingForm(null)}>
              رجوع
            </Button>
            <Button
              variant="destructive"
              disabled={actionMutation.isPending}
              onClick={() =>
                withdrawingForm &&
                actionMutation.mutate({ form_id: withdrawingForm.id, action: "withdraw" })
              }
            >
              تأكيد السحب
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(rejectingForm)}
        onOpenChange={(open) => !open && setRejectingForm(null)}
      >
        <DialogContent dir="rtl" className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>رفض طلب الإجازة</DialogTitle>
            <DialogDescription>سجّل سبب الرفض ليظهر لصاحب القرار في سجل الطلب.</DialogDescription>
          </DialogHeader>
          <div>
            <Label>سبب الرفض</Label>
            <Textarea
              className="mt-1"
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="اكتب سبباً واضحاً"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectingForm(null)}>
              رجوع
            </Button>
            <Button
              variant="destructive"
              disabled={actionMutation.isPending || rejectionReason.trim().length < 3}
              onClick={() =>
                rejectingForm &&
                actionMutation.mutate({
                  form_id: rejectingForm.id,
                  action: "reject",
                  note: rejectionReason.trim(),
                })
              }
            >
              تأكيد الرفض
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={policyOpen} onOpenChange={setPolicyOpen}>
        <DialogContent dir="rtl" className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingPolicy ? "تعديل سياسة الإجازة" : "إضافة نوع إجازة"}</DialogTitle>
            <DialogDescription>
              تؤثر حالة الدفع على احتساب الراتب، ويُطبّق السقف لكل موظف ولكل سنة.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>اسم النوع</Label>
              <Input
                className="mt-1"
                value={policyName}
                onChange={(event) => setPolicyName(event.target.value)}
                maxLength={80}
                placeholder="مثال: إجازة اضطرارية"
              />
            </div>
            <div>
              <Label>السقف السنوي بالأيام</Label>
              <Input
                className="mt-1"
                type="number"
                min="0"
                max="365"
                step="1"
                value={policyAllowance}
                onChange={(event) => setPolicyAllowance(event.target.value)}
                placeholder="اتركه فارغاً إذا لم تحدد سقفاً"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                التسويات الإدارية الموثقة تُضاف إلى هذا السقف عند حساب المتاح.
              </p>
            </div>
            <div>
              <Label>حد ترحيل الرصيد من السنة السابقة بالأيام</Label>
              <Input
                className="mt-1"
                type="number"
                min="0"
                max="365"
                step="1"
                value={policyCarryoverCap}
                onChange={(event) => setPolicyCarryoverCap(event.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                يُحسب من المتبقي الفعلي بعد إجازات وتسويات السنة السابقة. الصفر يعطّل الترحيل.
              </p>
            </div>
            <div className="flex items-center justify-between rounded-xl border p-3">
              <div>
                <Label>إجازة مدفوعة</Label>
                <p className="text-xs text-muted-foreground">
                  تُضاف أيامها إلى الأيام المدفوعة في مسير الرواتب.
                </p>
              </div>
              <Switch checked={policyPaid} onCheckedChange={setPolicyPaid} />
            </div>
            <div className="flex items-center justify-between rounded-xl border p-3">
              <div>
                <Label>احتساب أيام الراحة</Label>
                <p className="text-xs text-muted-foreground">
                  عند التعطيل تُحسب أيام الدوام فقط حسب جدول الموظف.
                </p>
              </div>
              <Switch checked={policyCountsRestDays} onCheckedChange={setPolicyCountsRestDays} />
            </div>
            {editingPolicy && (
              <div className="flex items-center justify-between rounded-xl border p-3">
                <div>
                  <Label>السماح بطلبات جديدة</Label>
                  <p className="text-xs text-muted-foreground">
                    إيقاف النوع لا يحذف الطلبات أو الأرصدة السابقة.
                  </p>
                </div>
                <Switch checked={policyActive} onCheckedChange={setPolicyActive} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPolicyOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={() => void savePolicy()}>حفظ السياسة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(adjustmentRow)}
        onOpenChange={(open) => !open && setAdjustmentRow(null)}
      >
        <DialogContent dir="rtl" className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>تسوية رصيد إجازة</DialogTitle>
            <DialogDescription>
              {adjustmentRow?.full_name} · {adjustmentRow?.leave_type_name} · {year}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>قيمة الحركة بالأيام</Label>
              <Input
                className="mt-1"
                type="number"
                step="1"
                min="-365"
                max="365"
                value={adjustmentAmount}
                onChange={(event) => setAdjustmentAmount(event.target.value)}
                placeholder="مثال: 2 أو -1"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                القيمة الموجبة تضيف أياماً، والسالبة تخصمها. الحركة لا يمكن حذفها بعد حفظها.
              </p>
            </div>
            <div>
              <Label>السبب والمستند المرجعي</Label>
              <Textarea
                className="mt-1"
                value={adjustmentReason}
                onChange={(event) => setAdjustmentReason(event.target.value)}
                rows={3}
                maxLength={500}
                placeholder="اكتب سبب التسوية"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustmentRow(null)}>
              إلغاء
            </Button>
            <Button onClick={() => void saveAdjustment()}>تسجيل الحركة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(historyRow)} onOpenChange={(open) => !open && setHistoryRow(null)}>
        <DialogContent dir="rtl" className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>دفتر حركات الرصيد</DialogTitle>
            <DialogDescription>
              {historyRow?.full_name} · {historyRow?.leave_type_name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {(balanceHistoryQuery.data ?? []).map((entry) => (
              <div
                key={entry.id}
                className="flex items-start justify-between gap-3 rounded-xl border p-3"
              >
                <div>
                  <Badge variant="outline">{entry.effective_year}</Badge>
                  <p className="mt-2 text-sm">{entry.reason}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{fmtStamp(entry.created_at)}</p>
                </div>
                <strong className={entry.amount > 0 ? "text-emerald-700" : "text-red-600"}>
                  {entry.amount > 0 ? "+" : ""}
                  {fmtNumber(entry.amount)} يوم
                </strong>
              </div>
            ))}
            {balanceHistoryQuery.isLoading && (
              <p className="p-4 text-center text-muted-foreground">جارٍ تحميل سجل الحركات…</p>
            )}
            {!balanceHistoryQuery.isLoading && !balanceHistoryQuery.data?.length && (
              <EmptyState text="لا توجد تسويات مسجلة لهذا الموظف ونوع الإجازة." />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof CalendarCheck2;
  tone: "teal" | "amber" | "green" | "blue" | "red" | "slate";
}) {
  const colors = {
    teal: "bg-teal-50 text-teal-700",
    amber: "bg-amber-50 text-amber-700",
    green: "bg-emerald-50 text-emerald-700",
    blue: "bg-sky-50 text-sky-700",
    red: "bg-red-50 text-red-700",
    slate: "bg-slate-100 text-slate-700",
  };
  return (
    <Card className="rounded-2xl border-0 shadow-sm ring-1 ring-border/70">
      <CardContent className="flex items-center gap-3 p-4">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${colors[tone]}`}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-black tabular-nums">{value.toLocaleString("ar-IQ")}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function LeaveCalendar({
  year,
  month,
  rows,
  onSelect,
}: {
  year: number;
  month: number;
  rows: CalendarRow[];
  onSelect: (row: CalendarRow) => void;
}) {
  const totalDays = new Date(year, month, 0).getDate();
  const firstDay = new Date(year, month - 1, 1).getDay();
  const byDate = useMemo(() => {
    const map = new Map<string, CalendarRow[]>();
    for (const row of rows) map.set(row.work_date, [...(map.get(row.work_date) ?? []), row]);
    return map;
  }, [rows]);
  const cells: (number | null)[] = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: totalDays }, (_, index) => index + 1),
  ];
  while (cells.length % 7) cells.push(null);
  return (
    <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
      {WEEKDAYS.map((day) => (
        <div
          key={day}
          className="py-2 text-center text-[10px] font-bold text-muted-foreground sm:text-xs"
        >
          {day}
        </div>
      ))}
      {cells.map((day, index) => {
        if (!day) return <div key={`empty-${index}`} />;
        const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const list = byDate.get(date) ?? [];
        return (
          <div
            key={date}
            className={`min-h-20 rounded-xl border p-1.5 sm:min-h-24 sm:p-2 ${list.length ? "border-teal-200 bg-teal-50/50" : "bg-background"}`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`text-xs font-bold ${date === todayInBaghdad() ? "flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                {day}
              </span>
              {list.length > 0 && (
                <span className="text-[10px] font-bold text-primary">{list.length}</span>
              )}
            </div>
            <div className="mt-1 space-y-1">
              {list.slice(0, 2).map((row) => (
                <button
                  key={row.form_id}
                  title={`${row.full_name} · ${row.leave_type_name}`}
                  onClick={() => onSelect(row)}
                  className={`block w-full truncate rounded px-1 py-0.5 text-right text-[9px] leading-4 sm:text-[10px] ${row.status === "executed" ? "bg-emerald-100 text-emerald-800" : row.status === "pending_execution" ? "bg-sky-100 text-sky-800" : "bg-amber-100 text-amber-800"}`}
                >
                  {row.is_paid ? "" : "◇ "}
                  {row.full_name}
                </button>
              ))}
              {list.length > 2 && (
                <span className="block text-[9px] text-muted-foreground">
                  +{list.length - 2} أخرى
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/15 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}
function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
function eventLabel(action: string) {
  const labels: Record<string, string> = {
    created: "تم تقديم الطلب",
    approve: "تم الاعتماد",
    reject: "تم الرفض",
    execute: "تم التنفيذ",
    withdrawn: "سحب الموظف الطلب",
  };
  return labels[action] ?? action;
}
