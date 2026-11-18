import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { requireFinanceRouteAccess } from "@/lib/finance-route-access";
import { formatErrorMessage } from "@/lib/error-message";
import { currentMonthInBaghdad } from "@/lib/date-time";
import { useDirectorySearch } from "@/hooks/use-directory-search";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/advances")({
  head: () => ({ meta: [{ title: "السلف" }] }),
  beforeLoad: requireFinanceRouteAccess,
  component: AdvancesPage,
});

type EmployeeOption = { id: string; employee_no: string; full_name: string };
const pageSize = 20;
const money = (amount: number) => `${Number(amount).toLocaleString("ar-IQ")} د.ع`;

function AdvancesPage() {
  const { financeUserId, canManageAdvances } = Route.useRouteContext();
  const qc = useQueryClient();
  const [month, setMonth] = useState(currentMonthInBaghdad);
  const [firstMonth, setFirstMonth] = useState(currentMonthInBaghdad);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [employee, setEmployee] = useState<EmployeeOption | null>(null);
  const lookup = useDirectorySearch(search);

  const employees = useQuery({
    queryKey: ["advances", financeUserId, "employee-search", lookup.term],
    enabled: canManageAdvances && lookup.valid && !lookup.waiting,
    queryFn: async ({ signal }) => {
      let query = supabase.rpc("payroll_employee_directory").select("id, employee_no, full_name");
      for (const term of lookup.term.split(" ")) {
        query = query.or(`full_name.ilike.%${term}%,employee_no.ilike.%${term}%`);
      }
      const { data, error } = await query
        .order("employee_no")
        .order("id")
        .limit(20)
        .abortSignal(signal);
      if (error) throw error;
      return data;
    },
  });
  const installments = useQuery({
    queryKey: ["advances", financeUserId, "installments", month, page],
    queryFn: async ({ signal }) => {
      const { data, count, error } = await supabase
        .from("employee_advance_installments")
        .select("id, amount, status, deducted_amount, employee_advances(employee_id)", {
          count: "exact",
        })
        .eq("month", `${month}-01`)
        .order("id")
        .range(page * pageSize, (page + 1) * pageSize - 1)
        .abortSignal(signal);
      if (error) throw error;
      const ids = [...new Set(data.flatMap((item) => item.employee_advances?.employee_id ?? []))];
      const names = new Map<string, string>();
      if (ids.length) {
        const { data: people, error: peopleError } = await supabase
          .rpc("payroll_employee_directory")
          .select("id, employee_no, full_name")
          .in("id", ids)
          .abortSignal(signal);
        if (peopleError) throw peopleError;
        for (const person of people)
          names.set(person.id, `${person.employee_no} — ${person.full_name}`);
      }
      return {
        count: count ?? 0,
        rows: data.map((item) => ({
          ...item,
          employeeName: names.get(item.employee_advances?.employee_id ?? "") ?? "—",
        })),
      };
    },
  });

  const createAdvance = useMutation({
    mutationFn: async (form: FormData) => {
      if (!canManageAdvances || !employee)
        throw new Error("اختر الموظف وتحقق من صلاحية تسجيل السلف");
      const amount = Math.round(Number(form.get("amount")) * 100);
      const installment = Math.round(Number(form.get("installment_amount")) * 100);
      const count = Math.ceil(amount / installment);
      if (
        !Number.isSafeInteger(amount) ||
        !Number.isSafeInteger(installment) ||
        amount <= 0 ||
        installment <= 0 ||
        count > 120 ||
        !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(firstMonth) ||
        firstMonth < currentMonthInBaghdad()
      ) {
        throw new Error("تحقق من المبلغ والقسط وشهر بدء الخصم. الحد الأقصى 120 قسطًا.");
      }
      const { data: run, error: runError } = await supabase
        .from("payroll_runs")
        .select("status")
        .eq("month", `${firstMonth}-01`)
        .maybeSingle();
      if (runError) throw runError;
      if (run && run.status !== "draft")
        throw new Error("بدأت مراجعة مسير شهر الخصم. اختر شهرًا لاحقًا.");

      const { data: advance, error } = await supabase
        .from("employee_advances")
        .insert({
          employee_id: employee.id,
          amount: amount / 100,
          installment_amount: installment / 100,
          installments_count: count,
          first_deduction_month: `${firstMonth}-01`,
          purpose: String(form.get("purpose") ?? "").trim() || null,
          created_by: financeUserId,
        })
        .select("id")
        .single();
      if (error) throw error;
      const [year, startMonth] = firstMonth.split("-").map(Number);
      const schedule = Array.from({ length: count }, (_, index) => ({
        advance_id: advance.id,
        month: new Date(Date.UTC(year, startMonth - 1 + index, 1)).toISOString().slice(0, 10),
        amount: Math.min(installment, amount - installment * index) / 100,
      }));
      const { error: scheduleError } = await supabase
        .from("employee_advance_installments")
        .insert(schedule);
      if (scheduleError) {
        // The foreign key prevents cleanup if the installment insert reached the database.
        const { data: removed, error: cleanupError } = await supabase
          .from("employee_advances")
          .delete()
          .eq("id", advance.id)
          .select("id")
          .maybeSingle();
        if (cleanupError || !removed)
          throw new Error("تعذر تأكيد جدول الأقساط. تحقق من السلفة قبل إعادة التسجيل.");
        throw scheduleError;
      }
      return firstMonth;
    },
    onSuccess: (savedMonth) => {
      setMonth(savedMonth);
      setPage(0);
      setEmployee(null);
      setSearch("");
      void qc.invalidateQueries({ queryKey: ["advances", financeUserId, "installments"] });
      void qc.invalidateQueries({ queryKey: ["payroll"] });
      toast.success("تم تسجيل السلفة وجدولة أقساطها");
    },
    onError: (error) => toast.error(formatErrorMessage(error, "تعذر تسجيل السلفة")),
  });
  const results = lookup.valid && !lookup.waiting ? (employees.data ?? []) : [];
  const options =
    employee && !results.some(({ id }) => id === employee.id) ? [employee, ...results] : results;
  const rows = installments.data?.rows ?? [];

  return (
    <div dir="rtl" className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold">السلف</h1>
        <p className="mt-1 text-muted-foreground">تسجيل سلف الموظفين ومتابعة أقساطها حسب الشهر.</p>
      </header>
      {canManageAdvances && (
        <Card>
          <CardHeader>
            <CardTitle>تسجيل سلفة</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-5 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                createAdvance.mutate(new FormData(form), { onSuccess: () => form.reset() });
              }}
            >
              <div className="flex flex-col gap-3 sm:col-span-2">
                <Label htmlFor="advance-search">بحث عن الموظف</Label>
                <Input
                  id="advance-search"
                  value={search}
                  maxLength={100}
                  placeholder="ابحث بالاسم أو الرقم الوظيفي"
                  onChange={(event) => setSearch(event.target.value)}
                />
                <Label htmlFor="advance-employee">الموظف</Label>
                <select
                  id="advance-employee"
                  required
                  className="min-h-11 rounded-md border bg-background px-3 text-sm"
                  value={employee?.id ?? ""}
                  onChange={(event) =>
                    setEmployee(options.find(({ id }) => id === event.target.value) ?? null)
                  }
                >
                  <option value="">اختر الموظف</option>
                  {options.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.employee_no} — {person.full_name}
                    </option>
                  ))}
                </select>
                <p className="text-sm text-muted-foreground" role="status">
                  {!lookup.valid
                    ? "اكتب حرفين أو رقمين على الأقل."
                    : lookup.waiting || employees.isFetching
                      ? "جارٍ البحث…"
                      : employees.isError
                        ? "تعذر البحث عن الموظفين."
                        : !results.length
                          ? "لا يوجد موظف مطابق."
                          : ""}
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <Label htmlFor="advance-amount">مبلغ السلفة بالدينار</Label>
                <Input
                  id="advance-amount"
                  name="amount"
                  type="number"
                  min="1"
                  step="0.01"
                  required
                />
              </div>
              <div className="flex flex-col gap-3">
                <Label htmlFor="advance-installment">القسط الشهري بالدينار</Label>
                <Input
                  id="advance-installment"
                  name="installment_amount"
                  type="number"
                  min="1"
                  step="0.01"
                  required
                />
              </div>
              <div className="flex flex-col gap-3">
                <Label htmlFor="advance-start">شهر بدء الخصم</Label>
                <Input
                  id="advance-start"
                  type="month"
                  min={currentMonthInBaghdad()}
                  value={firstMonth}
                  onChange={(event) => setFirstMonth(event.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-3">
                <Label htmlFor="advance-purpose">السبب (اختياري)</Label>
                <Input id="advance-purpose" name="purpose" />
              </div>
              <Button
                type="submit"
                disabled={!employee || createAdvance.isPending}
                className="w-fit"
              >
                {createAdvance.isPending ? "جارٍ تسجيل السلفة…" : "تسجيل السلفة"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-end sm:justify-between">
          <CardTitle>أقساط السلف</CardTitle>
          <div className="flex flex-col gap-3">
            <Label htmlFor="advance-report-month">شهر الأقساط</Label>
            <Input
              id="advance-report-month"
              type="month"
              value={month}
              onChange={(event) => {
                if (event.target.value) {
                  setMonth(event.target.value);
                  setPage(0);
                }
              }}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {installments.isPending ? (
            <p role="status">جارٍ تحميل الأقساط…</p>
          ) : installments.isError ? (
            <p role="alert" className="text-destructive">
              تعذر تحميل الأقساط. {formatErrorMessage(installments.error)}
            </p>
          ) : !rows.length ? (
            <p className="text-muted-foreground">لا توجد أقساط لهذا الشهر.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[32rem] text-sm">
                <thead className="border-b bg-muted/40 text-right">
                  <tr>
                    {["الموظف", "مبلغ القسط", "المخصوم", "الحالة"].map((heading) => (
                      <th key={heading} scope="col" className="p-3">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="p-3">{row.employeeName}</td>
                      <td className="p-3">{money(row.amount)}</td>
                      <td className="p-3">{money(row.deducted_amount)}</td>
                      <td className="p-3">
                        {{ scheduled: "مجدول", deducted: "مخصوم", waived: "معفى" }[row.status] ??
                          row.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(page > 0 || (installments.data?.count ?? 0) > pageSize) && (
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                disabled={page === 0 || installments.isFetching}
                onClick={() => setPage(page - 1)}
              >
                السابق
              </Button>
              <span>صفحة {page + 1}</span>
              <Button
                variant="outline"
                disabled={
                  (page + 1) * pageSize >= (installments.data?.count ?? 0) ||
                  installments.isFetching
                }
                onClick={() => setPage(page + 1)}
              >
                التالي
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
