import { direction, localizedDateFormat, localizedNumberFormat, ui } from "@/lib/ui-language";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Coins, Download, RefreshCw, Users, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { MetricCard, type MetricTone } from "@/components/MetricCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { calculateProjectFinancials } from "@/lib/project-financials";
import {
  readAllProjectMaterialIssues,
  readProjectFinancials,
  readProjectMaterialIssues,
  updateSiteBudget,
} from "@/lib/project-financials-api";
import { calculateSiteMaterialCosts } from "@/lib/site-material-costs";
import { formatErrorMessage } from "@/lib/error-message";

const money = localizedNumberFormat({
  style: "currency",
  currency: "IQD",
  maximumFractionDigits: 2,
});
const numbers = localizedNumberFormat({ maximumFractionDigits: 3 });
const percent = localizedNumberFormat({ style: "percent", maximumFractionDigits: 1 });
const time = localizedDateFormat({
  timeZone: "Asia/Baghdad",
  dateStyle: "short",
  timeStyle: "medium",
});
const statusStyles: Record<string, { title: string; tone: MetricTone }> = {
  unbudgeted: { title: "موازنة غير محددة", tone: "info" },
  safe: { title: "ضمن الموازنة", tone: "success" },
  warning: { title: "تحذير موازنة", tone: "warning" },
  over: { title: "تجاوز مالي", tone: "destructive" },
};
const pageSize = 20;

export function ProjectFinancialsPanel({
  project,
  end,
  wages,
  refreshWages,
}: {
  project: { id: string; name: string; ctr_code: string };
  end: string;
  wages: Parameters<typeof calculateProjectFinancials>[1];
  refreshWages: () => Promise<boolean>;
}) {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState("day");
  const [start, setStart] = useState("");
  const [tab, setTab] = useState("summary");
  const [page, setPage] = useState(0);
  const [budgetInput, setBudgetInput] = useState<string | null>(null);
  const from = period === "day" ? end : period === "range" ? start : null;
  const validPeriod = Boolean(end && (period !== "range" || (from && from <= end)));
  const scope = { p_site_id: project.id, p_start: from, p_end: end };
  const key = ["projects-dashboard", "financials", scope] as const;
  const summary = useQuery({
    queryKey: key,
    enabled: validPeriod,
    refetchInterval: 30_000,
    queryFn: ({ signal }) => readProjectFinancials(scope, signal),
  });
  const details = useQuery({
    queryKey: [...key, "materials", page],
    enabled: validPeriod && tab === "materials",
    refetchInterval: 30_000,
    queryFn: ({ signal }) =>
      readProjectMaterialIssues(scope, page * pageSize, pageSize + 1, signal),
  });
  const saveBudget = useMutation({
    mutationFn: (amount: number) => updateSiteBudget(project.id, amount),
    onSuccess: async () => {
      setBudgetInput(null);
      await queryClient.invalidateQueries({ queryKey: ["projects-dashboard", "financials"] });
      toast.success(ui("تم حفظ موازنة العقد"));
    },
    onError: (error) => toast.error(ui(formatErrorMessage(error, "تعذر حفظ الموازنة"))),
  });
  const exportCost = useMutation({
    mutationFn: async () => {
      if (!summary.data) return;
      const snapshot = summary.data;
      const issues = await readAllProjectMaterialIssues(scope);
      const materialExport = calculateSiteMaterialCosts(issues);
      if (
        materialExport.total !== snapshot.materials.period_cost ||
        materialExport.unpriced !== snapshot.materials.period_unpriced
      ) {
        throw new Error("تغيرت حركات الصرف أثناء تجهيز الكشف. حدّث التكلفة وأعد التصدير.");
      }
      const { downloadProjectFinancials } = await import("@/lib/project-financials-export");
      await downloadProjectFinancials(
        {
          site: project.name,
          ctr: project.ctr_code,
          start: from,
          end,
          syncedAt: snapshot.syncedAt,
          unpriced: snapshot.materials.cumulative_unpriced,
        },
        calculateProjectFinancials(snapshot, wages),
        issues,
      );
    },
    onError: (error) => toast.error(ui(formatErrorMessage(error, "تعذر تصدير كشف التكلفة"))),
  });
  const refresh = async () => {
    const [costs, rates, movements] = await Promise.all([
      summary.refetch(),
      refreshWages(),
      tab === "materials" ? details.refetch() : undefined,
    ]);
    if (costs.isSuccess && rates && (!movements || movements.isSuccess))
      toast.success(ui("تم تحديث التكلفة المالية"));
  };
  const snapshot = summary.data;
  const finance = snapshot && calculateProjectFinancials(snapshot, wages);
  const materialRows = calculateSiteMaterialCosts((details.data ?? []).slice(0, pageSize)).items;
  const usage = finance?.budget ? finance.cumulativeActual / finance.budget : null;

  return (
    <Card dir={direction()}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 space-y-0">
        <div className="space-y-2">
          <CardTitle className="text-lg">{ui("التكلفة المالية للمشروع")}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {project.ctr_code} · {project.name}
          </p>
          {snapshot && (
            <p className="text-xs text-muted-foreground">{ui("آخر مزامنة بتوقيت بغداد · ")}{time.format(new Date(snapshot.syncedAt))}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void refresh()}
            disabled={!validPeriod || summary.isFetching || details.isFetching}
          >
            <RefreshCw className="size-4" />{ui(" تحديث حي")}</Button>
          <Button
            variant="outline"
            onClick={() => exportCost.mutate()}
            disabled={!finance || summary.isError || exportCost.isPending}
          >
            <Download className="size-4" />{" "}
            {exportCost.isPending ? ui("جارٍ تجهيز الملف…") : ui("تصدير Excel")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 rounded-xl border bg-muted/25 p-4 sm:grid-cols-2">
          <div className="flex flex-col gap-3">
            <Label htmlFor="finance-period">{ui("فترة التكلفة حتى ")}{end}</Label>
            <select
              id="finance-period"
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={period}
              onChange={(event) => {
                setPeriod(event.target.value);
                setPage(0);
              }}
            >
              <option value="day">{ui("اليوم المحدد")}</option>
              <option value="range">{ui("نطاق زمني")}</option>
              <option value="total">{ui("تراكمي منذ بداية المشروع")}</option>
            </select>
          </div>
          {period === "range" && (
            <div className="flex flex-col gap-3">
              <Label htmlFor="finance-start">{ui("تاريخ البداية")}</Label>
              <Input
                id="finance-start"
                type="date"
                value={start}
                max={end}
                onChange={(event) => {
                  setStart(event.target.value);
                  setPage(0);
                }}
              />
            </div>
          )}
        </div>
        {!validPeriod ? (
          <p role="status" className="text-sm text-muted-foreground">{ui("حدد تاريخ بداية لا يتجاوز تاريخ النهاية.")}</p>
        ) : summary.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {ui(formatErrorMessage(summary.error, "تعذر تحميل التكلفة المالية"))}
          </p>
        ) : !finance || !snapshot ? (
          <p role="status" className="text-sm text-muted-foreground">{ui("جارٍ احتساب التكاليف…")}</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                title={ui("موازنة العقد")}
                value={finance.budget === null ? "غير محددة" : money.format(finance.budget)}
                icon={WalletCards}
              />
              <MetricCard
                title={ui("العمالة المعتمدة للفترة")}
                value={money.format(finance.labor)}
                icon={Users}
                tone="info"
              />
              <MetricCard
                title={ui("المواد المسعّرة للفترة")}
                value={money.format(finance.material)}
                icon={Boxes}
                tone="info"
              />
              <MetricCard
                title={ui("التكلفة الفعلية للفترة")}
                value={money.format(finance.actual)}
                icon={Coins}
                tone={statusStyles[finance.status].tone}
                detail={
                  finance.variancePercent === null
                    ? "الانحراف يحتاج موازنة معتمدة"
                    : `الانحراف التراكمي ${percent.format(finance.variancePercent / 100)}`
                }
              />
            </div>
            {snapshot.materials.cumulative_unpriced > 0 && (
              <p
                role="status"
                className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm"
              >{ui("هناك ")}{numbers.format(snapshot.materials.cumulative_unpriced)}{ui(" حركة صرف غير مسعّرة حتى تاريخ النهاية. الإجمالي المعروض يشمل المواد المسعّرة فقط.")}</p>
            )}
            <Tabs dir={direction()} value={tab} onValueChange={setTab}>
              <TabsList className="grid h-auto w-full grid-cols-3">
                <TabsTrigger className="whitespace-normal" value="summary">{ui("الملخص والموازنة")}</TabsTrigger>
                <TabsTrigger className="whitespace-normal" value="crew">{ui("كادر البصمة المعتمد")}</TabsTrigger>
                <TabsTrigger className="whitespace-normal" value="materials">{ui("المواد والمستهلكات")}</TabsTrigger>
              </TabsList>
              <TabsContent value="summary" className="space-y-4 rounded-xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{ui("التكلفة التراكمية حتى ")}{end} · {money.format(finance.cumulativeActual)}
                  </p>
                  <Badge variant={finance.status === "over" ? "destructive" : "secondary"}>
                    {statusStyles[finance.status].title}
                  </Badge>
                </div>
                {usage !== null && (
                  <p className="text-sm text-muted-foreground">{ui("استُهلك ")}{percent.format(usage)}{ui(" من الموازنة. الفرق")}{" "}
                    {money.format(finance.varianceAmount ?? 0)}.
                  </p>
                )}
                {[
                  {
                    title: "العمالة المعتمدة",
                    amount: finance.cumulativeLabor,
                    color: "bg-primary",
                  },
                  {
                    title: "المواد المسعّرة",
                    amount: finance.cumulativeMaterial,
                    color: "bg-sky-500",
                  },
                ].map((entry) => {
                  const base = finance.budget ?? finance.cumulativeActual;
                  const share = base > 0 ? entry.amount / base : 0;
                  return (
                    <div key={entry.title} className="space-y-2">
                      <div className="flex flex-wrap justify-between gap-2 text-sm">
                        <span>{entry.title}</span>
                        <span>
                          {money.format(entry.amount)} · {percent.format(share)}
                        </span>
                      </div>
                      <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full ${entry.color}`}
                          style={{ width: `${Math.min(100, share * 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                <p className="text-xs leading-6 text-muted-foreground">{ui("الأشرطة تقيس نسبة كل بند إلى")}{" "}
                  {finance.budget ? ui("موازنة العقد") : ui("التكلفة التراكمية")}{ui(". التسعير يعتمد أجور التخصصات وأسعار الوحدات الحالية.")}</p>
                {snapshot.canEditBudget &&
                  (budgetInput === null ? (
                    <Button
                      variant="outline"
                      onClick={() => setBudgetInput(finance.budget?.toFixed(2) ?? "")}
                    >
                      {finance.budget ? ui("تعديل الموازنة") : ui("تحديد موازنة العقد")}
                    </Button>
                  ) : (
                    <form
                      className="space-y-3 border-t pt-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (
                          !/^\d{1,14}(\.\d{1,2})?$/.test(budgetInput) ||
                          Number(budgetInput) <= 0
                        ) {
                          toast.error(ui("أدخل مبلغاً موجباً بالدينار العراقي حتى منزلتين عشريتين"));
                          return;
                        }
                        saveBudget.mutate(Number(budgetInput));
                      }}
                    >
                      <Label htmlFor="project-budget">{ui("موازنة العقد بالدينار العراقي")}</Label>
                      <div className="flex flex-wrap gap-2">
                        <Input
                          id="project-budget"
                          className="max-w-56"
                          inputMode="decimal"
                          dir="ltr"
                          value={budgetInput}
                          onChange={(event) =>
                            setBudgetInput(
                              event.target.value
                                .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
                                .replace(/[٬,]/g, "")
                                .replace(/٫/g, "."),
                            )
                          }
                          required
                        />
                        <Button disabled={saveBudget.isPending}>{ui("حفظ الموازنة")}</Button>
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={saveBudget.isPending}
                          onClick={() => setBudgetInput(null)}
                        >{ui("إلغاء")}</Button>
                      </div>
                    </form>
                  ))}
              </TabsContent>
              <TabsContent value="crew">
                {finance.crew.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {[
                          "التخصص",
                          period === "day" ? "الحاضرون" : "أيام عمل الأفراد",
                          "الأجر اليومي",
                          "التكلفة",
                        ].map((label) => (
                          <TableHead className="text-start" key={label}>
                            {ui(label)}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {finance.crew.map((item) => (
                        <TableRow key={item.name}>
                          <TableCell>{item.name}</TableCell>
                          <TableCell>{numbers.format(item.count)}</TableCell>
                          <TableCell>
                            {money.format(item.dailyRate)}{" "}
                            {item.usedDefault && <Badge variant="outline">{ui("افتراضي")}</Badge>}
                          </TableCell>
                          <TableCell>{money.format(item.cost)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="p-4 text-sm text-muted-foreground">
                    {snapshot.approvedReports
                      ? ui("لا يوجد كادر حاضر في التقارير المعتمدة للفترة.")
                      : ui("لا توجد تقارير بصمة معتمدة للفترة.")}
                  </p>
                )}
              </TabsContent>
              <TabsContent value="materials">
                {details.isError ? (
                  <p role="alert" className="p-4 text-sm text-destructive">
                    {ui(formatErrorMessage(details.error, "تعذر تحميل حركات الصرف"))}
                  </p>
                ) : details.isPending ? (
                  <p role="status" className="p-4 text-sm text-muted-foreground">{ui("جارٍ تحميل حركات الصرف…")}</p>
                ) : !materialRows.length ? (
                  <p className="p-4 text-sm text-muted-foreground">{ui("لا توجد حركات صرف في هذه الصفحة.")}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {[
                          "التاريخ",
                          "المادة والكود",
                          "الكمية",
                          "كلفة الوحدة",
                          "التكلفة",
                          "المخزن",
                          "الملاحظات",
                        ].map((label) => (
                          <TableHead className="text-start" key={label}>
                            {ui(label)}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {materialRows.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>{item.movement_date}</TableCell>
                          <TableCell>
                            {item.item_name}
                            <span className="block text-xs text-muted-foreground">
                              {item.item_code}
                            </span>
                          </TableCell>
                          <TableCell>
                            {numbers.format(item.quantity)} {item.unit}
                          </TableCell>
                          <TableCell>
                            {item.unit_cost === null ? ui("غير مسعّر") : money.format(item.unit_cost)}
                          </TableCell>
                          <TableCell>
                            {item.cost === null ? "—" : money.format(item.cost)}
                          </TableCell>
                          <TableCell>{item.warehouse_name}</TableCell>
                          <TableCell className="min-w-32 whitespace-normal">
                            {item.notes ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                <div className="mt-3 flex items-center gap-3">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!page}
                    onClick={() => setPage(page - 1)}
                  >{ui("السابق")}</Button>
                  <span className="text-xs text-muted-foreground">{ui("صفحة ")}{numbers.format(page + 1)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={(details.data?.length ?? 0) <= pageSize}
                    onClick={() => setPage(page + 1)}
                  >{ui("التالي")}</Button>
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </CardContent>
    </Card>
  );
}
