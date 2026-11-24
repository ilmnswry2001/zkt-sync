import { direction, displayLocale, ui } from "@/lib/ui-language";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { MetricCard } from "@/components/MetricCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { COMPANY_TIME_ZONE } from "@/lib/date-time";
import { formatErrorMessage } from "@/lib/error-message";
import {
  advanceClosuresDb,
  advanceInstallmentStatus,
  type AdvanceClosureAction,
} from "@/lib/advance-closures-client";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  advanceId: string;
  employeeName: string;
  financeUserId: string;
  canManage: boolean;
  onClose: () => void;
};

const money = (amount: number) => `${amount.toLocaleString(displayLocale())} د.ع`;
const timestamp = (value: string) =>
  new Date(value).toLocaleString(displayLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: COMPANY_TIME_ZONE,
  });
const closureLabels = { waive: "التنازل عن الرصيد", complete: "إتمام السلفة" };
const advanceStatus: Record<string, string> = {
  active: "نشطة",
  settled: "مكتملة",
  cancelled: "ملغاة",
};

export function AdvanceDetailsDialog({
  advanceId,
  employeeName,
  financeUserId,
  canManage,
  onClose,
}: Props) {
  const qc = useQueryClient();
  const [action, setAction] = useState<AdvanceClosureAction | null>(null);
  const [reason, setReason] = useState("");
  const details = useQuery({
    queryKey: ["advances", financeUserId, "details", advanceId],
    queryFn: async ({ signal }) => {
      const [advance, installments] = await Promise.all([
        supabase
          .from("employee_advances")
          .select(
            "amount, installment_amount, installments_count, first_deduction_month, purpose, status, created_at, updated_at",
          )
          .eq("id", advanceId)
          .abortSignal(signal)
          .single(),
        supabase
          .from("employee_advance_installments")
          .select(
            "id, month, amount, status, deducted_amount, payroll_runs(paid_at, payment_reference)",
          )
          .eq("advance_id", advanceId)
          .order("month")
          .abortSignal(signal),
      ]);
      if (advance.error) throw advance.error;
      if (installments.error) throw installments.error;
      return { advance: advance.data, installments: installments.data };
    },
  });
  const closureQuery = useQuery({
    queryKey: ["advances", financeUserId, "closure", advanceId],
    queryFn: async ({ signal }) => {
      const { data, error } = await advanceClosuresDb
        .from("employee_advance_closures")
        .select("action, reason, amount, closed_at")
        .eq("advance_id", advanceId)
        .abortSignal(signal)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const closeAdvance = useMutation({
    mutationFn: async (operation: AdvanceClosureAction) => {
      const { error } = await advanceClosuresDb.rpc("close_employee_advance", {
        p_advance_id: advanceId,
        p_action: operation,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setAction(null);
      setReason("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["advances", financeUserId] }),
        qc.invalidateQueries({ queryKey: ["payroll"] }),
      ]);
      toast.success(ui("تم إغلاق السلفة وتوثيق السبب"));
    },
    onError: (error) => toast.error(ui(formatErrorMessage(error, "تعذر إغلاق السلفة"))),
  });

  const advance = details.data?.advance;
  const installments = details.data?.installments ?? [];
  const closure = closureQuery.data;
  const deducted = installments.reduce((sum, item) => sum + Number(item.deducted_amount), 0);
  const balance = installments.reduce(
    (sum, item) =>
      sum +
      (item.status === "scheduled"
        ? Math.max(0, Number(item.amount) - Number(item.deducted_amount))
        : 0),
    0,
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !closeAdvance.isPending) onClose();
      }}
    >
      <DialogContent dir={direction()} className="max-h-[90dvh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ui("تفاصيل السلفة")}</DialogTitle>
          <DialogDescription>{employeeName}</DialogDescription>
        </DialogHeader>
        {details.isPending ? (
          <p role="status">{ui("جارٍ تحميل تفاصيل السلفة…")}</p>
        ) : details.isError ? (
          <div className="space-y-3" role="alert">
            <p className="text-destructive">
              {ui(formatErrorMessage(details.error, "تعذر تحميل تفاصيل السلفة"))}
            </p>
            <Button variant="outline" onClick={() => void details.refetch()}>{ui("إعادة المحاولة")}</Button>
          </div>
        ) : (
          advance && (
            <div className="space-y-6">
              <div className="grid gap-3 sm:grid-cols-3">
                <MetricCard title={ui("أصل السلفة")} value={money(Number(advance.amount))} />
                <MetricCard title={ui("المخصوم من الرواتب")} value={money(deducted)} tone="success" />
                <MetricCard title={ui("الرصيد المجدول")} value={money(balance)} tone="warning" />
              </div>
              <dl className="grid grid-cols-1 gap-4 rounded-lg border p-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">{ui("تاريخ الإنشاء")}</dt>
                  <dd>{timestamp(advance.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{ui("الحالة")}</dt>
                  <dd>
                    <Badge variant="secondary">
                      {closure
                        ? ui(closureLabels[closure.action])
                        : (advanceStatus[advance.status] ?? advance.status)}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{ui("شهر بدء الخصم")}</dt>
                  <dd dir="ltr" className="text-right">
                    {advance.first_deduction_month.slice(0, 7)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{ui("القسط الشهري وعدد الأقساط")}</dt>
                  <dd>
                    {money(Number(advance.installment_amount))} · {advance.installments_count}{ui(" قسط")}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">{ui("سبب تسجيل السلفة")}</dt>
                  <dd className="whitespace-pre-wrap break-words">{advance.purpose || "—"}</dd>
                </div>
              </dl>
              {closure ? (
                <section className="space-y-2 rounded-lg border bg-muted/30 p-4 text-sm">
                  <h3 className="font-semibold">{ui(closureLabels[closure.action])}</h3>
                  <p>
                    {timestamp(closure.closed_at)} · {money(Number(closure.amount))}
                  </p>
                  <p className="whitespace-pre-wrap break-words">{closure.reason}</p>
                </section>
              ) : (
                advance.status === "settled" && (
                  <p className="text-sm text-muted-foreground">{ui("تاريخ آخر تحديث للسلفة المكتملة: ")}{timestamp(advance.updated_at)}
                  </p>
                )
              )}
              <section className="space-y-3">
                <h3 className="font-semibold">{ui("جدول الأقساط وسجل الاستقطاعات")}</h3>
                {installments.length ? (
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full min-w-[36rem] text-sm">
                      <thead className="border-b bg-muted/40 text-right">
                        <tr>
                          {["الشهر", "القسط", "المخصوم", "تاريخ الخصم", "مرجع الصرف", "الحالة"].map(
                            (name) => (
                              <th scope="col" className="p-3" key={name}>
                                {name}
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {installments.map((item) => (
                          <tr key={item.id} className="border-b last:border-0">
                            <td className="p-3" dir="ltr">
                              {item.month.slice(0, 7)}
                            </td>
                            <td className="p-3">{money(Number(item.amount))}</td>
                            <td className="p-3">{money(Number(item.deducted_amount))}</td>
                            <td className="p-3">
                              {item.payroll_runs?.paid_at && Number(item.deducted_amount) > 0
                                ? timestamp(item.payroll_runs.paid_at)
                                : Number(item.deducted_amount) > 0
                                  ? ui("غير موثق")
                                  : "—"}
                            </td>
                            <td className="p-3">{item.payroll_runs?.payment_reference || "—"}</td>
                            <td className="p-3">
                              {advanceInstallmentStatus[item.status] ?? item.status}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{ui("لا توجد أقساط مسجلة لهذه السلفة.")}</p>
                )}
              </section>
              {closureQuery.isError && (
                <div role="alert" className="space-y-2 text-sm text-destructive">
                  <p>{ui("تعذر تحميل سجل الإغلاق. ")}{ui(formatErrorMessage(closureQuery.error))}</p>
                  <Button variant="outline" onClick={() => void closureQuery.refetch()}>{ui("إعادة المحاولة")}</Button>
                </div>
              )}
              {canManage &&
                closureQuery.isSuccess &&
                !closure &&
                advance.status === "active" &&
                balance > 0 && (
                  <div className="space-y-4 rounded-lg border p-4">
                    {!action ? (
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" onClick={() => setAction("complete")}>{ui("إتمام السلفة")}</Button>
                        <Button variant="destructive" onClick={() => setAction("waive")}>{ui("التنازل عن الرصيد")}</Button>
                      </div>
                    ) : (
                      <form
                        className="flex flex-col gap-3"
                        onSubmit={(event) => {
                          event.preventDefault();
                          closeAdvance.mutate(action);
                        }}
                      >
                        <h3 className="font-semibold">
                          {ui(closureLabels[action])} · {money(balance)}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {action === "waive"
                            ? ui("سيُعفى الموظف من الرصيد المتبقي وتُغلق أقساطه المجدولة.")
                            : ui("يُسجل هذا الإجراء تسوية الرصيد خارج الرواتب ويُغلق الأقساط المجدولة.")}
                        </p>
                        <Label htmlFor="advance-closure-reason">{ui("السبب أو التوجيه (إلزامي)")}</Label>
                        <Textarea
                          id="advance-closure-reason"
                          value={reason}
                          minLength={2}
                          maxLength={2000}
                          required
                          disabled={closeAdvance.isPending}
                          onChange={(event) => setReason(event.target.value)}
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="submit"
                            variant={action === "waive" ? "destructive" : "default"}
                            disabled={reason.trim().length < 2 || closeAdvance.isPending}
                          >
                            {closeAdvance.isPending ? ui("جارٍ الحفظ…") : ui("تأكيد الإجراء")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={closeAdvance.isPending}
                            onClick={() => {
                              setAction(null);
                              setReason("");
                            }}
                          >{ui("إلغاء")}</Button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
