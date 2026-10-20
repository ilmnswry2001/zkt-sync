import { formatErrorMessage } from "@/lib/error-message";
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, FileDown, Plus, Search, Send, SlidersHorizontal, X } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { todayInBaghdad } from "@/lib/date-time";
import { escapeHtml } from "@/lib/report-print";
import {
  defaultStockAllocation,
  validatePurchaseQuantity,
  validateStockAllocation,
} from "@/lib/material-requests-domain";
import {
  cancelMaterialRequest,
  closeMaterialRequest,
  createMaterialPurchaseBatch,
  createMaterialRequest,
  editMaterialRequest,
  getMaterialRequestOptions,
  getMaterialRequests,
  receiveMaterialPurchaseBatch,
  reopenMaterialRequest,
  reviewMaterialRequestPlanning,
  reviewMaterialRequestWarehouse,
  sendMaterialPurchaseBatch,
  type MaterialRequest,
  type MaterialRequestItem,
  type MaterialRequestOptions,
} from "@/lib/material-requests.functions";

type Stage = "planning" | "warehouse" | "procurement";
type RequestType = "material" | "equipment";
type LineDraft = { id?: string; item_name: string; unit: string; quantity: string; specifications: string };
type AllocationDraft = {
  warehouse_item_id: string;
  warehouse_id: string;
  issue_qty: string;
  purchase_qty: string;
  reason: string;
  is_new_item: boolean;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "مسودة",
  pending_planning: "بانتظار التخطيط",
  returned: "معاد لمقدم الطلب",
  rejected: "مرفوض",
  pending_warehouse: "بانتظار المخازن",
  pending_procurement: "بانتظار المشتريات",
  purchasing: "قيد الشراء",
  pending_receipt: "بانتظار الاستلام",
  partially_received: "مستلم جزئياً",
  received: "مكتمل الاستلام",
  closed: "مغلق",
  cancelled: "ملغى",
};
const UNITS = ["علبة", "صندوق", "قطعة", "زوج", "سيت", "حجر", "متر", "كيس", "رول", "لتر", "كغم"];
const EMPTY_REQUESTS: MaterialRequest[] = [];

function canAct(actor: MaterialRequestOptions["actor"], role: string) {
  return actor.company_manager || actor.roles.includes("admin") || actor.roles.includes(role);
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString("ar-IQ") : "—";
}

function RequestState({ status }: { status: string }) {
  const variant = ["rejected", "cancelled", "closed"].includes(status)
    ? "destructive"
    : ["received", "pending_receipt"].includes(status)
      ? "default"
      : "secondary";
  return <Badge variant={variant}>{STATUS_LABELS[status] ?? status}</Badge>;
}

export function MaterialRequestWorkflow({ stage, requestType }: { stage: Stage; requestType?: RequestType }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<RequestType>(requestType ?? "material");
  const [activeView, setActiveView] = useState("work");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [responsibleFilter, setResponsibleFilter] = useState("all");
  const [siteFilter, setSiteFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState<MaterialRequest | null>(null);
  const [planningScope, setPlanningScope] = useState<"mine" | "incoming" | "all">("all");

  const optionsQuery = useQuery({
    queryKey: ["material-request-options"],
    queryFn: () => getMaterialRequestOptions(),
    staleTime: 60_000,
  });
  const requestQuery = useQuery({
    queryKey: ["material-requests", kind, search],
    queryFn: () => getMaterialRequests({ data: { requestType: kind, search } }),
    refetchOnWindowFocus: true,
  });
  const options = optionsQuery.data as MaterialRequestOptions | undefined;
  const requests = requestQuery.data?.requests ?? EMPTY_REQUESTS;
  const actor = options?.actor;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["material-requests"] });
    void queryClient.invalidateQueries({ queryKey: ["material-request-options"] });
  };

  const counts = useMemo(() => ({
    planning: requests.filter((request) => request.status === "pending_planning").length,
    warehouse: requests.filter((request) => ["pending_warehouse", "pending_receipt", "partially_received"].includes(request.status)).length,
    procurement: requests.filter((request) => ["pending_procurement", "purchasing"].includes(request.status) ||
      (request.status === "partially_received" && request.items.some((item) => item.purchase_qty > item.purchased_qty && !item.not_purchased_reason))).length,
  }), [requests]);

  const filteredRequests = useMemo(() => requests.filter((request) =>
    (statusFilter === "all" || request.status === statusFilter) &&
    (responsibleFilter === "all" || requestResponsibleStage(request.status) === responsibleFilter) &&
    (departmentFilter === "all" || request.department_id === departmentFilter) &&
    (siteFilter === "all" || request.site_id === siteFilter) &&
    (!fromDate || request.created_at.slice(0, 10) >= fromDate) &&
    (!toDate || request.created_at.slice(0, 10) <= toDate),
  ), [requests, statusFilter, responsibleFilter, departmentFilter, siteFilter, fromDate, toDate]);
  const planningRequests = stage === "planning"
    ? filteredRequests.filter((request) =>
        planningScope === "mine"
          ? request.created_by === actor?.user_id
          : planningScope === "incoming"
            ? request.status === "pending_planning"
            : true,
      )
    : filteredRequests;
  const overdueCount = requests.filter((request) => request.need_by_date && request.need_by_date < todayInBaghdad() && !["received", "closed", "rejected", "cancelled"].includes(request.status)).length;
  const missingCount = requests.filter((request) => (request.receipts as RequestReceipt[]).some((receipt) => receipt.items.some((item) => item.did_not_arrive))).length;

  const canCreate = !!actor && (actor.company_manager || actor.roles.some((role) =>
    ["engineer", "department_manager", "supervisor", "site_admin"].includes(role),
  ));
  const canPlan = actor ? canAct(actor, "planning_officer") : false;
  const canWarehouse = actor ? canAct(actor, "warehouse_keeper") : false;
  const canProcure = actor ? canAct(actor, "procurement_officer") : false;
  const canManage = !!actor && actor.company_manager;
  const isLedger = activeView === "ledger";

  const exportReport = () => {
    const rows = filteredRequests.flatMap((request) => request.items.map((item) => ({
      "رقم الطلب": request.request_number,
      "الحالة": STATUS_LABELS[request.status] ?? request.status,
      "النوع": request.request_type === "equipment" ? "معدات" : "مواد",
      "القسم": request.department_name,
      "الموقع": request.site_name,
      "مقدم الطلب": request.created_by_name ?? "",
      "البند": item.item_name,
      "الوحدة": item.unit,
      "المطلوب": Number(item.original_qty),
      "المعتمد": Number(item.planning_approved_qty ?? 0),
      "المصروف": Number(item.issue_qty),
      "المشترى": Number(item.purchased_qty),
      "المستلم": Number(item.received_qty),
      "المتبقي": Math.max(0, Number((item.planning_approved_qty ?? item.requested_qty) - item.issue_qty - item.received_qty)),
      "موعد الحاجة": request.need_by_date ?? "",
      "لم يصل": request.receipts.some((receipt) =>
        Array.isArray(receipt.items) && (receipt.items as Array<Record<string, unknown>>).some((line) =>
          line.request_item_id === item.id && line.did_not_arrive === true,
        ),
      ) ? "نعم" : "لا",
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "طلبات المواد والمعدات");
    XLSX.writeFile(workbook, `سجل-الطلبات-${todayInBaghdad()}.xlsx`);
  };

  const title = stage === "planning" ? "طلبات المواد والمعدات" : stage === "warehouse" ? "الطلبات الواردة" : "طلبات الشراء";

  return (
    <section dir="rtl" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          <p className="text-sm text-muted-foreground">سجل موحد مع مراحل الطلب والتدقيق والاستلامات.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportReport}>
            <FileDown className="ml-2 h-4 w-4" /> Excel
          </Button>
          {stage === "planning" && canCreate && (
            <Button size="sm" onClick={() => { setEditingRequest(null); setFormOpen(true); }}>
              <Plus className="ml-2 h-4 w-4" /> طلب جديد
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Count label="بانتظار التخطيط" value={counts.planning} active={stage === "planning"} />
        <Count label="بانتظار المخازن والاستلام" value={counts.warehouse} active={stage === "warehouse"} />
        <Count label="بانتظار المشتريات" value={counts.procurement} active={stage === "procurement"} />
      </div>

      {!requestType && (
        <Tabs value={kind} onValueChange={(value) => setKind(value as RequestType)} dir="rtl">
          <TabsList>
            <TabsTrigger value="material">طلبات المواد</TabsTrigger>
            <TabsTrigger value="equipment">طلبات المعدات</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      <Tabs value={activeView} onValueChange={setActiveView} dir="rtl">
        <TabsList>
          <TabsTrigger value="work">الطلبات حسب المرحلة</TabsTrigger>
          <TabsTrigger value="ledger">سجل الطلبات</TabsTrigger>
        </TabsList>
        <TabsContent value="work" className="space-y-3">
          <RequestFilters
            search={search}
            onSearch={setSearch}
            status={statusFilter}
            onStatus={setStatusFilter}
            responsible={responsibleFilter}
            onResponsible={setResponsibleFilter}
            department={departmentFilter}
            onDepartment={setDepartmentFilter}
            site={siteFilter}
            onSite={setSiteFilter}
            fromDate={fromDate}
            onFromDate={setFromDate}
            toDate={toDate}
            onToDate={setToDate}
            options={options}
          />
          {stage === "planning" && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="نطاق طلبات التخطيط">
              {canCreate && <Button size="sm" variant={planningScope === "mine" ? "default" : "outline"} onClick={() => setPlanningScope("mine")}>طلباتي</Button>}
              {canPlan && <Button size="sm" variant={planningScope === "incoming" ? "default" : "outline"} onClick={() => setPlanningScope("incoming")}>الواردة للتخطيط</Button>}
              {canPlan && <Button size="sm" variant={planningScope === "all" ? "default" : "outline"} onClick={() => setPlanningScope("all")}>كل الطلبات</Button>}
            </div>
          )}
          {requestQuery.error || optionsQuery.error ? (
            <MigrationNotice message={(requestQuery.error ?? optionsQuery.error as Error).message} />
          ) : requestQuery.isLoading || optionsQuery.isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">جارٍ تحميل الطلبات...</p>
          ) : (
            <RequestList
              stage={stage}
              requests={planningRequests}
              options={options}
              actor={actor}
              canCreate={canCreate}
              canPlan={canPlan}
              canWarehouse={canWarehouse}
              canProcure={canProcure}
              canManage={canManage}
              onEdit={(request) => { setEditingRequest(request); setFormOpen(true); }}
              onRefresh={invalidate}
            />
          )}
        </TabsContent>
        <TabsContent value="ledger" className="space-y-3">
          <RequestFilters
            search={search}
            onSearch={setSearch}
            status={statusFilter}
            onStatus={setStatusFilter}
            responsible={responsibleFilter}
            onResponsible={setResponsibleFilter}
            department={departmentFilter}
            onDepartment={setDepartmentFilter}
            site={siteFilter}
            onSite={setSiteFilter}
            fromDate={fromDate}
            onFromDate={setFromDate}
            toDate={toDate}
            onToDate={setToDate}
            options={options}
          />
          {requestQuery.error || optionsQuery.error ? (
            <MigrationNotice message={(requestQuery.error ?? optionsQuery.error as Error).message} />
          ) : requestQuery.isLoading || optionsQuery.isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">جارٍ تحميل سجل الطلبات...</p>
          ) : (
            <RequestList
              stage="ledger"
              requests={filteredRequests}
              options={options}
              actor={actor}
              canCreate={canCreate}
              canPlan={false}
              canWarehouse={false}
              canProcure={false}
              canManage={canManage}
              onEdit={(request) => { setEditingRequest(request); setFormOpen(true); }}
              onRefresh={invalidate}
            />
          )}
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
        <span>متأخرة عن موعد الحاجة: <b className="text-foreground">{overdueCount}</b></span>
        <span>تتضمن بنداً لم يصل: <b className="text-foreground">{missingCount}</b></span>
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent dir="rtl" className="max-h-[92dvh] max-w-4xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editingRequest ? "تعديل الطلب" : "طلب مواد أو معدات جديد"}</DialogTitle></DialogHeader>
          {options && (
            <RequestForm
              requestType={kind}
              existing={editingRequest}
              options={options}
              onCancel={() => setFormOpen(false)}
              onSaved={() => { setFormOpen(false); setEditingRequest(null); invalidate(); }}
            />
          )}
        </DialogContent>
      </Dialog>
      {isLedger && <span className="sr-only">السجل يعرض {filteredRequests.length} من الطلبات المتاحة.</span>}
    </section>
  );
}

function Count({ label, value, active }: { label: string; value: number; active: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 ${active ? "border-primary/30 bg-primary/[0.06]" : "border-border/70 bg-card/70"}`}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <strong className="text-lg tabular-nums">{value}</strong>
    </div>
  );
}

function MigrationNotice({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
      {message.includes("migration") ? message : `تعذر تحميل الطلبات: ${message}`}
    </div>
  );
}

function RequestFilters({
  search, onSearch, status, onStatus, responsible, onResponsible, department, onDepartment, site, onSite,
  fromDate, onFromDate, toDate, onToDate, options,
}: {
  search: string; onSearch: (value: string) => void;
  status: string; onStatus: (value: string) => void;
  responsible: string; onResponsible: (value: string) => void;
  department: string; onDepartment: (value: string) => void;
  site: string; onSite: (value: string) => void;
  fromDate: string; onFromDate: (value: string) => void;
  toDate: string; onToDate: (value: string) => void;
  options?: MaterialRequestOptions;
}) {
  const activeFilters = [status, responsible, department, site].filter((value) => value !== "all").length +
    Number(!!fromDate) + Number(!!toDate);
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input className="h-11 rounded-xl border-border/70 bg-card/80 pr-10 shadow-sm" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="ابحث برقم الطلب أو المادة أو الموقع" aria-label="بحث في طلبات المواد والمعدات" />
      </div>
      <details className="group rounded-xl border border-border/70 bg-card/55">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2 font-medium"><SlidersHorizontal className="h-4 w-4 text-muted-foreground" /> التصفية المتقدمة{activeFilters > 0 && <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5">{activeFilters}</Badge>}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="grid gap-2 border-t border-border/60 p-3 sm:grid-cols-2 lg:grid-cols-3">
          <select className="h-10 min-w-0 rounded-lg border bg-background px-3 text-sm" value={status} onChange={(event) => onStatus(event.target.value)} aria-label="تصفية الحالة">
            <option value="all">كل الحالات</option>
            {Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <select className="h-10 min-w-0 rounded-lg border bg-background px-3 text-sm" value={responsible} onChange={(event) => onResponsible(event.target.value)} aria-label="تصفية القسم المسؤول حالياً">
            <option value="all">كل الأقسام المسؤولة</option>
            <option value="planning">التخطيط</option>
            <option value="warehouse">المخازن</option>
            <option value="procurement">المشتريات</option>
            <option value="applicant">مقدم الطلب</option>
            <option value="done">مكتمل أو مغلق</option>
          </select>
          <select className="h-10 min-w-0 rounded-lg border bg-background px-3 text-sm" value={department} onChange={(event) => onDepartment(event.target.value)} aria-label="تصفية القسم">
            <option value="all">كل الأقسام</option>
            {(options?.departments ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select className="h-10 min-w-0 rounded-lg border bg-background px-3 text-sm" value={site} onChange={(event) => onSite(event.target.value)} aria-label="تصفية الموقع">
            <option value="all">كل المواقع</option>
            {(options?.sites ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <Input type="date" aria-label="من تاريخ" value={fromDate} onChange={(event) => onFromDate(event.target.value)} />
          <Input type="date" aria-label="إلى تاريخ" value={toDate} onChange={(event) => onToDate(event.target.value)} />
        </div>
      </details>
    </div>
  );
}

function RequestForm({ requestType, existing, options, onCancel, onSaved }: {
  requestType: RequestType; existing: MaterialRequest | null; options: MaterialRequestOptions;
  onCancel: () => void; onSaved: () => void;
}) {
  const actor = options.actor;
  const editableLines = existing?.items ?? [];
  const [siteId, setSiteId] = useState(existing?.site_id ?? options.sites[0]?.id ?? "");
  const [departmentId, setDepartmentId] = useState(existing?.department_id ?? actor.employee_department_id ?? actor.department_ids[0] ?? "");
  const [reason, setReason] = useState(existing?.reason ?? "");
  const [needByDate, setNeedByDate] = useState(existing?.need_by_date ?? "");
  const [lines, setLines] = useState<LineDraft[]>(editableLines.length
    ? editableLines.map((item) => ({ id: item.id, item_name: item.item_name, unit: item.unit, quantity: String(item.requested_qty), specifications: item.specifications ?? "" }))
    : [{ item_name: "", unit: "قطعة", quantity: "", specifications: "" }]);
  const [busy, setBusy] = useState(false);
  const datalistId = `request-items-${requestType}`;
  const editableDepartments = actor.company_manager || actor.roles.includes("admin")
    ? options.departments
    : options.departments.filter((item) => actor.department_ids.includes(item.id) || actor.employee_department_id === item.id);
  const canSelectDepartment = actor.company_manager || actor.roles.includes("admin");

  const save = async (submit: boolean) => {
    if (!siteId || !departmentId) return toast.error("اختر الموقع والقسم");
    if (submit && !lines.some((line) => line.item_name.trim() && Number(line.quantity) > 0)) return toast.error("أضف بنداً واحداً على الأقل بكمية صحيحة");
    const items = lines.filter((line) => line.item_name.trim()).map((line) => ({
      ...(line.id ? { id: line.id } : {}),
      item_name: line.item_name.trim(),
      unit: line.unit.trim(),
      quantity: Number(line.quantity),
      specifications: line.specifications.trim(),
    }));
    if (items.some((line) => !line.unit || !(line.quantity > 0))) return toast.error("تحقق من اسم البند والوحدة والكمية الأكبر من صفر");
    setBusy(true);
    try {
      if (existing) {
        await editMaterialRequest({ data: { request_id: existing.id, request_type: requestType, site_id: siteId, department_id: departmentId, reason, need_by_date: needByDate || null, items, submit } });
      } else {
        const result = await createMaterialRequest({ data: { request_type: requestType, site_id: siteId, department_id: departmentId, reason, need_by_date: needByDate || null, items, submit } });
        const record = result as { request_number?: string };
        toast.success(submit ? `تم إرسال الطلب ${record.request_number ?? ""} إلى التخطيط` : `حُفظت المسودة ${record.request_number ?? ""}`);
        onSaved();
        return;
      }
      toast.success(submit ? "تم إرسال الطلب إلى التخطيط" : "تم حفظ التعديلات");
      onSaved();
    } catch (error) {
      toast.error(formatErrorMessage(error, "تعذر حفظ الطلب"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {existing && <p className="text-sm font-semibold">{existing.request_number} · {STATUS_LABELS[existing.status]}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="الموقع الطالب"><select className="h-10 w-full rounded-md border bg-background px-2 text-sm" value={siteId} onChange={(event) => setSiteId(event.target.value)}><option value="">اختر الموقع</option>{options.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></Field>
        <Field label="القسم"><select className="h-10 w-full rounded-md border bg-background px-2 text-sm" value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} disabled={!canSelectDepartment || editableDepartments.length === 1}><option value="">اختر القسم</option>{editableDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></Field>
        <Field label="تاريخ الحاجة (اختياري)"><Input type="date" value={needByDate} onChange={(event) => setNeedByDate(event.target.value)} /></Field>
        <Field label="سبب الطلب أو الملاحظات"><Input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} /></Field>
      </div>
      <datalist id={datalistId}>{options.items.filter((item) => item.kind === (requestType === "equipment" ? "tool" : "material")).map((item) => <option key={item.id} value={item.name} />)}</datalist>
      <datalist id={`request-units-${requestType}`}>{UNITS.map((unit) => <option key={unit} value={unit} />)}</datalist>
      <div className="space-y-2">
        <div className="flex items-center justify-between"><h3 className="font-semibold">بنود الطلب</h3><Button type="button" variant="outline" size="sm" onClick={() => setLines((current) => [...current, { item_name: "", unit: "قطعة", quantity: "", specifications: "" }])}><Plus className="ml-1 h-4 w-4" /> إضافة بند</Button></div>
        {lines.map((line, index) => (
          <div key={line.id ?? index} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1.3fr_0.7fr_0.6fr_1.2fr_auto]">
            <Field label="اسم المادة أو المعدة"><Input list={datalistId} value={line.item_name} onChange={(event) => setLines((current) => current.map((item, row) => row === index ? { ...item, item_name: event.target.value } : item))} /></Field>
            <Field label="الوحدة"><Input list={`request-units-${requestType}`} value={line.unit} onChange={(event) => setLines((current) => current.map((item, row) => row === index ? { ...item, unit: event.target.value } : item))} /></Field>
            <Field label="الكمية"><Input type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => setLines((current) => current.map((item, row) => row === index ? { ...item, quantity: event.target.value } : item))} /></Field>
            <Field label="المواصفات أو الملاحظات"><Input value={line.specifications} onChange={(event) => setLines((current) => current.map((item, row) => row === index ? { ...item, specifications: event.target.value } : item))} /></Field>
            <Button type="button" variant="ghost" size="icon" className="self-end" aria-label="حذف البند" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, row) => row !== index))}><X className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
        <Button type="button" variant="outline" onClick={onCancel}>إلغاء</Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void save(false)}>حفظ كمسودة</Button>
        <Button type="button" disabled={busy || !lines.some((line) => line.item_name.trim() && Number(line.quantity) > 0)} onClick={() => void save(true)}><Send className="ml-2 h-4 w-4" /> إرسال إلى التخطيط</Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0 space-y-1"><Label className="text-xs">{label}</Label>{children}</div>;
}

type PurchaseBatch = {
  id: string;
  supplier: string;
  document_number: string | null;
  purchase_date: string;
  notes: string | null;
  status: "draft" | "sent_to_warehouse";
  sent_at: string | null;
  items: Array<{ id: string; request_item_id: string; purchased_qty: number; not_purchased_reason: string | null }>;
};

type RequestReceipt = {
  id: string;
  batch_id: string;
  warehouse_id: string;
  received_by: string;
  received_at: string;
  notes: string | null;
  items: Array<{ id: string; request_item_id: string; batch_item_id: string; received_qty: number; serial_notes: string | null; did_not_arrive: boolean; exclusion_reason: string | null; shortage_reason?: string | null }>;
};

function hasOutstandingReceipt(request: MaterialRequest) {
  const receipts = request.receipts as RequestReceipt[];
  return (request.batches as PurchaseBatch[]).some((batch) =>
    batch.status === "sent_to_warehouse" && batch.items.some((item) => {
      const received = receipts.flatMap((receipt) => receipt.items)
        .filter((line) => line.batch_item_id === item.id)
        .reduce((sum, line) => sum + Number(line.received_qty), 0);
      return item.purchased_qty > received;
    }),
  );
}

function RequestList({ stage, requests, options, actor, canCreate, canPlan, canWarehouse, canProcure, canManage, onEdit, onRefresh }: {
  stage: Stage | "ledger";
  requests: MaterialRequest[];
  options?: MaterialRequestOptions;
  actor?: MaterialRequestOptions["actor"];
  canCreate: boolean;
  canPlan: boolean;
  canWarehouse: boolean;
  canProcure: boolean;
  canManage: boolean;
  onEdit: (request: MaterialRequest) => void;
  onRefresh: () => void;
}) {
  const visible = requests.filter((request) => {
    if (stage === "ledger") return true;
    if (stage === "planning") return request.status !== "cancelled";
    if (stage === "warehouse") return ["pending_warehouse", "pending_receipt", "partially_received"].includes(request.status) || hasOutstandingReceipt(request);
    return ["pending_procurement", "purchasing", "pending_receipt", "partially_received", "received", "closed"].includes(request.status);
  });

  if (!visible.length) return <EmptyRequests text="لا توجد طلبات مطابقة حالياً." />;
  return (
    <div className="space-y-3">
      {visible.map((request) => (
        <Card key={request.id} className="overflow-hidden rounded-2xl border-border/70 bg-card/90 shadow-sm transition-shadow hover:shadow-md">
          <div className={`h-1 w-full ${["rejected", "cancelled"].includes(request.status) ? "bg-destructive/70" : ["received", "closed"].includes(request.status) ? "bg-emerald-500/70" : "bg-gradient-to-l from-primary/80 via-primary/40 to-transparent"}`} />
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 p-4 sm:px-5">
            <div className="min-w-0">
              <CardTitle className="flex flex-wrap items-center gap-2 text-[15px]">
                <span dir="ltr" className="font-mono tracking-wide">{request.request_number}</span>
                <RequestState status={request.status} />
                <Badge variant="outline" className="rounded-full">{request.request_type === "equipment" ? "معدات" : "مواد"}</Badge>
                {request.need_by_date && request.need_by_date < todayInBaghdad() && !["received", "closed", "rejected", "cancelled"].includes(request.status) && <Badge variant="destructive" className="rounded-full">متأخر</Badge>}
              </CardTitle>
              <p className="mt-2 truncate text-xs text-muted-foreground">
                {request.created_by_name || "مقدم الطلب"} <span className="mx-1 text-border">•</span> {request.department_name} <span className="mx-1 text-border">•</span> {request.site_name}
              </p>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-center">
              {canCreate && actor?.user_id === request.created_by && ["draft", "returned"].includes(request.status) && (
                <Button size="sm" variant="outline" onClick={() => onEdit(request)}>تعديل</Button>
              )}
              {canCreate && actor?.user_id === request.created_by && request.status === "pending_planning" && (
                <CancelRequest request={request} onDone={onRefresh} />
              )}
              {canManage && !["draft", "pending_planning", "returned", "closed"].includes(request.status) && (
                <CloseRequest request={request} onDone={onRefresh} />
              )}
              {actor?.roles.includes("admin") && request.status === "closed" && (
                <ReopenRequest request={request} onDone={onRefresh} />
              )}
            </div>
          </CardHeader>
          <details className="group/request border-t border-border/60">
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/35 sm:px-5 [&::-webkit-details-marker]:hidden">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                <span><b className="text-foreground">{request.items.length}</b> بنود</span>
                <span><b className="text-foreground tabular-nums">{request.items.reduce((sum, item) => sum + Number(item.original_qty), 0)}</b> وحدة مطلوبة</span>
                <span>{formatDate(request.created_at)}{request.need_by_date ? ` · الحاجة ${formatDate(request.need_by_date)}` : ""}</span>
              </div>
              <span className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                التفاصيل والإجراءات
                <ChevronDown className="h-4 w-4 transition-transform group-open/request:rotate-180" />
              </span>
            </summary>
          <CardContent className="space-y-4 border-t border-border/50 bg-muted/[0.12] px-4 pb-4 pt-4 sm:px-5">
            <div className="grid gap-2 sm:grid-cols-3">
              <MiniStat label="مطلوب أصلاً" value={request.items.reduce((sum, item) => sum + Number(item.original_qty), 0)} />
              <MiniStat label="مصروف من المخزن" value={request.items.reduce((sum, item) => sum + Number(item.issue_qty), 0)} />
              <MiniStat label="مستلم فعلياً" value={request.items.reduce((sum, item) => sum + Number(item.received_qty), 0)} />
            </div>
            <div className="space-y-2">
              {request.items.map((item) => (
                <RequestLine key={item.id} request={request} item={item} receipts={request.receipts as RequestReceipt[]} />
              ))}
            </div>
            {request.reason && <p className="rounded-md bg-muted/40 p-3 text-sm">{request.reason}</p>}
            {stage === "planning" && canPlan && request.status === "pending_planning" && (
              <PlanningReview request={request} onDone={onRefresh} />
            )}
            {stage === "warehouse" && canWarehouse && request.status === "pending_warehouse" && options && (
              <WarehouseReview request={request} options={options} onDone={onRefresh} />
            )}
            {stage === "procurement" && canProcure && ["pending_procurement", "purchasing", "partially_received"].includes(request.status) && (
              <ProcurementPanel request={request} onDone={onRefresh} />
            )}
            {stage === "warehouse" && canWarehouse && options && (
              <ReceiptPanels request={request} options={options} onDone={onRefresh} />
            )}
            {request.batches.length > 0 && <BatchHistory batches={request.batches as PurchaseBatch[]} canSend={stage === "procurement" && canProcure} onDone={onRefresh} />}
            {request.receipts.length > 0 && (
              <ReceiptHistory
                request={request}
                receipts={request.receipts as RequestReceipt[]}
                batches={request.batches as PurchaseBatch[]}
                warehouses={options?.warehouses ?? []}
              />
            )}
            <AuditTimeline events={request.events} />
          </CardContent>
          </details>
        </Card>
      ))}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return <div className="flex justify-between gap-2 border-b py-1.5 text-xs"><span className="text-muted-foreground">{label}</span><b className="tabular-nums">{value}</b></div>;
}

function RequestLine({ request, item, receipts }: { request: MaterialRequest; item: MaterialRequestItem; receipts: RequestReceipt[] }) {
  const notArrived = receipts.flatMap((receipt) => receipt.items).some((line) => line.request_item_id === item.id && line.did_not_arrive);
  const expected = Number(item.issue_qty) + Number(item.purchase_qty);
  const remaining = Math.max(0, Number(item.planning_approved_qty ?? item.requested_qty) - Number(item.issue_qty) - Number(item.received_qty));
  return (
    <div className={`grid gap-2 rounded-md border p-3 sm:grid-cols-[1.4fr_repeat(5,0.7fr)] ${notArrived ? "border-destructive/50 bg-destructive/5" : ""}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 font-medium">
          <span>{item.item_name}</span>
          {notArrived && <Badge variant="destructive">لم يصل</Badge>}
          {item.status === "excluded" && <Badge variant="outline">مستبعد</Badge>}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{item.specifications || "بدون مواصفات"} · {item.unit}</p>
        {item.allocation_reason && <p className="mt-1 text-xs text-amber-700">سبب الكمية غير المغطاة: {item.allocation_reason}</p>}
        {item.not_purchased_reason && <p className="mt-1 text-xs text-destructive">سبب عدم الشراء/الاستبعاد: {item.not_purchased_reason}</p>}
      </div>
      <QuantityValue label="الأصلي" value={item.original_qty} />
      <QuantityValue label="المعتمد" value={item.planning_approved_qty ?? 0} />
      <QuantityValue label="المصروف" value={item.issue_qty} />
      <QuantityValue label="المشترى" value={item.purchased_qty} />
      <QuantityValue label="المستلم / المتبقي" value={`${item.received_qty} / ${remaining}`} />
      {request.status === "closed" && notArrived && <span className="text-xs font-medium text-destructive">تاريخ تسجيل عدم الوصول محفوظ في سجل الاستلام.</span>}
    </div>
  );
}

function QuantityValue({ label, value }: { label: string; value: number | string }) {
  return <div className="text-xs"><span className="block text-muted-foreground">{label}</span><b className="tabular-nums">{value}</b></div>;
}

function AuditTimeline({ events }: { events: MaterialRequest["events"] }) {
  if (!events.length) return null;
  return (
    <details className="rounded-md border px-3 py-2">
      <summary className="cursor-pointer text-sm font-semibold">سجل التدقيق والخط الزمني ({events.length})</summary>
      <ol className="mt-3 space-y-2 border-r pr-4">
        {events.map((event) => (
          <li key={event.id} className="relative text-xs before:absolute before:-right-[1.35rem] before:top-1 before:h-2 before:w-2 before:rounded-full before:bg-primary">
            <p className="font-medium">{actionLabel(event.action)}</p>
            <p className="mt-0.5 text-muted-foreground">{event.actor_name || event.actor_id} · {new Date(event.created_at).toLocaleString("ar-IQ")}</p>
            {event.note && <p className="mt-1">{event.note}</p>}
            {Boolean(event.old_value || event.new_value) && <details className="mt-1"><summary className="cursor-pointer text-muted-foreground">القيم السابقة والجديدة</summary><pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap rounded bg-muted p-2">{JSON.stringify({ old: event.old_value, new: event.new_value }, null, 2)}</pre></details>}
          </li>
        ))}
      </ol>
    </details>
  );
}

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    submitted: "إرسال إلى التخطيط", draft_created: "حفظ مسودة", resubmitted: "إعادة إرسال",
    edited: "تعديل الطلب", applicant_edited_item: "تعديل بند", applicant_added_item: "إضافة بند",
    applicant_removed_item: "استبعاد بند مقدم الطلب", planning_quantity: "اعتماد كمية التخطيط",
    planning_approve: "اعتماد التخطيط", planning_return: "إعادة لمقدم الطلب", planning_reject: "رفض التخطيط",
    warehouse_review_confirmed: "تأكيد مراجعة المخازن", purchase_batch_created: "تسجيل دفعة شراء",
    purchase_batch_sent_to_warehouse: "إرسال دفعة للاستلام", receipt_confirmed: "تأكيد استلام فعلي",
    closed: "إغلاق الطلب", reopened: "إعادة فتح الطلب", cancelled: "إلغاء الطلب",
  };
  return labels[action] ?? action;
}

function PlanningReview({ request, onDone }: { request: MaterialRequest; onDone: () => void }) {
  const [quantities, setQuantities] = useState(() => Object.fromEntries(request.items.map((item) => [item.id, String(item.requested_qty)])));
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (action: "approve" | "return" | "reject") => {
    setBusy(true);
    try {
      await reviewMaterialRequestPlanning({ data: {
        request_id: request.id, action, note,
        items: request.items.map((item) => ({ id: item.id, approved_qty: Number(quantities[item.id]), note: notes[item.id] ?? "" })),
      } });
      toast.success(action === "approve" ? "تم اعتماد الطلب وإرساله للمخازن" : action === "return" ? "أعيد الطلب لمقدمه" : "تم رفض الطلب");
      onDone();
    } catch (error) { toast.error(formatErrorMessage(error, "تعذر تنفيذ مراجعة التخطيط")); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-3 rounded-md border border-primary/25 bg-primary/5 p-3">
      <h3 className="font-semibold">مراجعة التخطيط</h3>
      {request.items.map((item) => (
        <div key={item.id} className="grid gap-2 sm:grid-cols-[1fr_9rem_1fr]">
          <p className="self-center text-sm">{item.item_name} · مطلوب {item.requested_qty} {item.unit}</p>
          <Field label="الكمية المعتمدة"><Input type="number" min="0" max={item.requested_qty} step="0.001" value={quantities[item.id] ?? ""} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} /></Field>
          <Field label="ملاحظة التخطيط عند التخفيض"><Input value={notes[item.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} /></Field>
        </div>
      ))}
      <Field label="ملاحظة الإعادة أو سبب الرفض"><Input value={note} onChange={(event) => setNote(event.target.value)} /></Field>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void act("approve")}>اعتماد وإرسال للمخازن</Button>
        <Button disabled={busy || note.trim().length < 3} variant="outline" onClick={() => void act("return")}>إعادة لمقدم الطلب</Button>
        <Button disabled={busy || note.trim().length < 3} variant="destructive" onClick={() => void act("reject")}>رفض الطلب</Button>
      </div>
    </div>
  );
}

function WarehouseReview({ request, options, onDone }: { request: MaterialRequest; options: MaterialRequestOptions; onDone: () => void }) {
  const stockItems = options.items.filter((item) => item.kind === (request.request_type === "equipment" ? "tool" : "material"));
  const mainWarehouse = options.warehouses.find((warehouse) => warehouse.is_main) ?? options.warehouses[0];
  const [allocations, setAllocations] = useState<Record<string, AllocationDraft>>(() => Object.fromEntries(request.items.map((line) => {
    const matched = stockItems.find((item) => item.name.trim().toLocaleLowerCase("ar") === line.item_name.trim().toLocaleLowerCase("ar"));
    const warehouseId = mainWarehouse?.id ?? "";
    const available = matched ? getAvailable(options, warehouseId, matched.id) : 0;
    const allocation = defaultStockAllocation(Number(line.planning_approved_qty ?? 0), available);
    return [line.id, { warehouse_item_id: matched?.id ?? "", warehouse_id: warehouseId, issue_qty: String(allocation.issue), purchase_qty: String(allocation.purchase), reason: "", is_new_item: !matched }];
  })));
  const [busy, setBusy] = useState(false);
  const updateAllocation = (line: MaterialRequestItem, field: keyof AllocationDraft, value: string | boolean) => {
    setAllocations((current) => ({ ...current, [line.id]: { ...current[line.id], [field]: value } }));
  };
  const submit = async () => {
    setBusy(true);
    try {
      const items = request.items.map((line) => {
        const allocation = allocations[line.id];
        const issue = Number(allocation.issue_qty);
        const purchase = Number(allocation.purchase_qty);
        validateStockAllocation(Number(line.planning_approved_qty ?? 0), issue, purchase, allocation.reason);
        const available = allocation.warehouse_item_id ? getAvailable(options, allocation.warehouse_id, allocation.warehouse_item_id) : 0;
        if (issue > available) throw new Error(`الرصيد لا يكفي للصرف من ${line.item_name}`);
        return { id: line.id, warehouse_item_id: allocation.warehouse_item_id || null, warehouse_id: allocation.warehouse_id || null, is_new_item: allocation.is_new_item, issue_qty: issue, purchase_qty: purchase, reason: allocation.reason };
      });
      await reviewMaterialRequestWarehouse({ data: { request_id: request.id, items } });
      toast.success("تم تأكيد المراجعة وتسجيل الصرف المخزني");
      onDone();
    } catch (error) { toast.error(formatErrorMessage(error, "تعذر تأكيد مراجعة المخازن")); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-3 rounded-md border border-primary/25 bg-primary/5 p-3">
      <h3 className="font-semibold">مراجعة المخازن قبل الشراء</h3>
      {request.items.map((line) => {
        const allocation = allocations[line.id];
        const selected = stockItems.find((item) => item.id === allocation?.warehouse_item_id);
        const available = selected ? getAvailable(options, allocation.warehouse_id, selected.id) : 0;
        return (
          <div key={line.id} className="grid gap-2 rounded-md border bg-background p-3 sm:grid-cols-2 lg:grid-cols-6">
            <div className="self-end text-sm font-semibold">{line.item_name}<p className="text-xs font-normal text-muted-foreground">أصلي {line.original_qty} · معتمد {line.planning_approved_qty} {line.unit}</p></div>
            <Field label="ربط بكتالوج المخزون"><select className="h-10 w-full rounded-md border bg-background px-2 text-sm" value={allocation?.warehouse_item_id ?? ""} onChange={(event) => {
              const itemId = event.target.value;
              const warehouseId = allocation?.warehouse_id || mainWarehouse?.id || "";
              const stockItem = stockItems.find((item) => item.id === itemId);
              const quantity = stockItem ? getAvailable(options, warehouseId, stockItem.id) : 0;
              const next = defaultStockAllocation(Number(line.planning_approved_qty ?? 0), quantity);
              setAllocations((current) => ({ ...current, [line.id]: { warehouse_item_id: itemId, warehouse_id: warehouseId, issue_qty: String(next.issue), purchase_qty: String(next.purchase), reason: "", is_new_item: !itemId } }));
            }}><option value="">مادة جديدة / غير موجودة</option>{stockItems.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.unit}</option>)}</select></Field>
            <Field label="مخزن الصرف"><select className="h-10 w-full rounded-md border bg-background px-2 text-sm" value={allocation?.warehouse_id ?? ""} onChange={(event) => {
              const warehouseId = event.target.value;
              const quantity = selected ? getAvailable(options, warehouseId, selected.id) : 0;
              const next = defaultStockAllocation(Number(line.planning_approved_qty ?? 0), quantity);
              setAllocations((current) => ({ ...current, [line.id]: { ...current[line.id], warehouse_id: warehouseId, issue_qty: String(next.issue), purchase_qty: String(next.purchase) } }));
            }}><option value="">اختر المخزن</option>{options.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}{warehouse.is_main ? " · رئيسي" : ""}</option>)}</select><p className="text-xs text-muted-foreground">المتوفر: {available} {line.unit}</p></Field>
            <Field label="سيُصرف من المخزون"><Input type="number" min="0" step="0.001" value={allocation?.issue_qty ?? "0"} onChange={(event) => updateAllocation(line, "issue_qty", event.target.value)} /></Field>
            <Field label="الكمية المطلوب شراؤها"><Input type="number" min="0" step="0.001" value={allocation?.purchase_qty ?? "0"} onChange={(event) => updateAllocation(line, "purchase_qty", event.target.value)} /></Field>
            <Field label="سبب النقص إن وجد"><Input value={allocation?.reason ?? ""} onChange={(event) => updateAllocation(line, "reason", event.target.value)} /></Field>
          </div>
        );
      })}
      <Button disabled={busy} onClick={() => void submit()}>تأكيد المراجعة</Button>
    </div>
  );
}

function getAvailable(options: MaterialRequestOptions, warehouseId: string, itemId: string) {
  const stock = options.stock;
  return Number(stock.find((row) => row.warehouse_id === warehouseId && row.item_id === itemId)?.quantity ?? 0);
}

function ProcurementPanel({ request, onDone }: { request: MaterialRequest; onDone: () => void }) {
  const [supplier, setSupplier] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayInBaghdad());
  const [notes, setNotes] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries(request.items.map((item) => [item.id, String(Math.max(0, item.purchase_qty - item.purchased_qty))])));
  const [notPurchased, setNotPurchased] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const pendingItems = request.items.filter((item) => item.purchase_qty > item.purchased_qty && !item.not_purchased_reason);
  if (!pendingItems.length) return <p className="rounded-md border p-3 text-sm text-muted-foreground">لا توجد كميات شراء متبقية غير محسومة.</p>;
  const saveBatch = async () => {
    if (!supplier.trim()) return toast.error("أدخل اسم المورد");
    setBusy(true);
    try {
      const items = pendingItems.map((item) => {
        const quantity = Number(quantities[item.id] ?? 0);
        validatePurchaseQuantity(Number(item.purchase_qty), Number(item.purchased_qty), quantity);
        const reason = notPurchased[item.id] ?? "";
        if (quantity === 0 && reason.trim() && reason.trim().length < 3) throw new Error(`اكتب سبباً واضحاً لعدم شراء ${item.item_name}`);
        return { id: item.id, quantity, not_purchased_reason: reason };
      });
      const result = await createMaterialPurchaseBatch({ data: {
        request_id: request.id,
        supplier,
        document_number: documentNumber,
        purchase_date: purchaseDate,
        notes,
        items,
      } });
      const record = result as { id?: string };
      toast.success("تم تسجيل دفعة الشراء دون تغيير المخزون");
      onDone();
      if (record.id) toast.info("أرسل الدفعة إلى المخزن عند اكتمال مستندات الشراء.");
    } catch (error) { toast.error(formatErrorMessage(error, "تعذر تسجيل الشراء")); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-3 rounded-md border border-primary/25 bg-primary/5 p-3">
      <h3 className="font-semibold">تسجيل دفعة شراء</h3>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="المورد"><Input value={supplier} onChange={(event) => setSupplier(event.target.value)} /></Field>
        <Field label="رقم أمر الشراء / المستند"><Input value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value)} /></Field>
        <Field label="التاريخ"><Input type="date" value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} /></Field>
        <Field label="ملاحظات"><Input value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
      </div>
      {pendingItems.map((item) => (
        <div key={item.id} className="grid gap-2 border-t pt-2 sm:grid-cols-[1fr_10rem_1fr]">
          <div className="self-end text-sm">{item.item_name}<p className="text-xs text-muted-foreground">المطلوب شراؤه {item.purchase_qty} · تم شراء {item.purchased_qty} · المتبقي {item.purchase_qty - item.purchased_qty}</p></div>
          <Field label="الكمية في هذه الدفعة"><Input type="number" min="0" max={item.purchase_qty - item.purchased_qty} step="0.001" value={quantities[item.id] ?? "0"} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} /></Field>
          <Field label="سبب عدم الشراء (اتركه فارغاً للدفعة اللاحقة)"><Input value={notPurchased[item.id] ?? ""} onChange={(event) => setNotPurchased((current) => ({ ...current, [item.id]: event.target.value }))} /></Field>
        </div>
      ))}
      <Button disabled={busy} onClick={() => void saveBatch()}><Plus className="ml-2 h-4 w-4" /> حفظ دفعة الشراء</Button>
    </div>
  );
}

function ReceiptPanels({ request, options, onDone }: { request: MaterialRequest; options: MaterialRequestOptions; onDone: () => void }) {
  const batches = request.batches as PurchaseBatch[];
  const receipts = request.receipts as RequestReceipt[];
  const readyBatches = batches.filter((batch) => batch.status === "sent_to_warehouse" && batch.items.some((item) =>
    item.purchased_qty > receipts.flatMap((receipt) => receipt.items)
      .filter((receiptItem) => receiptItem.batch_item_id === item.id)
      .reduce((sum, receiptItem) => sum + Number(receiptItem.received_qty), 0),
  ));
  if (!readyBatches.length) return null;
  return (
    <div className="space-y-3">
      <h3 className="font-semibold">دفعات بانتظار الاستلام الفعلي</h3>
      {readyBatches.map((batch) => (
        <ReceiptForm key={batch.id} request={request} batch={batch} receipts={receipts} options={options} onDone={onDone} />
      ))}
    </div>
  );
}

function ReceiptForm({ request, batch, receipts, options, onDone }: {
  request: MaterialRequest; batch: PurchaseBatch; receipts: RequestReceipt[];
  options: MaterialRequestOptions; onDone: () => void;
}) {
  const receiptItems = batch.items.filter((item) => item.purchased_qty > 0 && item.purchased_qty > receipts.flatMap((receipt) => receipt.items)
    .filter((receiptItem) => receiptItem.batch_item_id === item.id)
    .reduce((sum, receiptItem) => sum + Number(receiptItem.received_qty), 0));
  const mainWarehouses = options.warehouses.filter((warehouse) => warehouse.is_main);
  const [warehouseId, setWarehouseId] = useState(mainWarehouses[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useRef("");
  if (!idempotencyKey.current && typeof window !== "undefined") {
    const storageKey = `material-request-receipt:${batch.id}`;
    idempotencyKey.current = window.sessionStorage.getItem(storageKey) ?? window.crypto.randomUUID();
    window.sessionStorage.setItem(storageKey, idempotencyKey.current);
  }
  const [lines, setLines] = useState(() => Object.fromEntries(receiptItems.map((batchItem) => {
    const requestItem = request.items.find((item) => item.id === batchItem.request_item_id);
    const receivedBefore = receipts.flatMap((receipt) => receipt.items)
      .filter((line) => line.batch_item_id === batchItem.id)
      .reduce((sum, line) => sum + Number(line.received_qty), 0);
    const existing = options.items.find((item) => item.id === requestItem?.warehouse_item_id) ??
      options.items.find((item) => item.name.trim().toLocaleLowerCase("ar") === requestItem?.item_name.trim().toLocaleLowerCase("ar") && item.kind === (request.request_type === "equipment" ? "tool" : "material"));
    return [batchItem.id, {
      received_qty: String(Math.max(0, batchItem.purchased_qty - receivedBefore)),
      did_not_arrive: false,
      exclusion_reason: "",
      approved_by: "",
      warehouse_item_id: existing?.id ?? "",
      new_item_name: existing ? "" : requestItem?.item_name ?? "",
      new_item_unit: requestItem?.unit ?? "قطعة",
      serial_notes: "",
      shortage_reason: "",
    }];
  })));
  const approvers = options.approvers;
  const typeItems = options.items.filter((item) => item.kind === (request.request_type === "equipment" ? "tool" : "material"));
  const setLine = (id: string, field: string, value: string | boolean) =>
    setLines((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));
  const receive = async () => {
    if (!warehouseId) return toast.error("حدد المخزن الرئيسي الذي سيستقبل الكمية");
    setBusy(true);
    try {
      const payload = receiptItems.map((batchItem) => {
        const line = lines[batchItem.id];
        const receiptValue = Number(line.received_qty);
        const excluded = line.exclusion_reason.trim();
        if (excluded && !line.approved_by) throw new Error(`حدد المعتمد لاستبعاد ${request.items.find((item) => item.id === batchItem.request_item_id)?.item_name}`);
        if (!line.did_not_arrive && receiptValue === 0 && !excluded && !line.shortage_reason.trim()) throw new Error("سجل سبب عدم الوصول أو سبب الكمية غير المستلمة");
        return {
          batch_item_id: batchItem.id,
          received_qty: line.did_not_arrive ? 0 : receiptValue,
          did_not_arrive: line.did_not_arrive,
          shortage_reason: line.shortage_reason,
          exclusion_reason: excluded,
          approved_by: line.approved_by || null,
          warehouse_item_id: line.warehouse_item_id || null,
          new_item_name: line.new_item_name,
          new_item_unit: line.new_item_unit,
          serial_notes: line.serial_notes,
        };
      });
      await receiveMaterialPurchaseBatch({ data: {
        batch_id: batch.id,
        warehouse_id: warehouseId,
        idempotency_key: idempotencyKey.current,
        notes,
        items: payload,
      } });
      window.sessionStorage.removeItem(`material-request-receipt:${batch.id}`);
      idempotencyKey.current = "";
      toast.success("تم تسجيل الاستلام الفعلي وتحديث المخزون بالكميات المستلمة فقط");
      onDone();
    } catch (error) { toast.error(formatErrorMessage(error, "تعذر تأكيد الاستلام")); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="font-semibold">{batch.supplier} · {batch.document_number || "دون رقم مستند"}</p><p className="text-xs text-muted-foreground">تاريخ الشراء {formatDate(batch.purchase_date)}</p></div>
        <Field label="المخزن الرئيسي"><select className="h-10 rounded-md border bg-background px-2 text-sm" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">اختر المخزن</option>{mainWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></Field>
      </div>
      {!mainWarehouses.length && <p role="alert" className="text-sm text-destructive">لا يوجد مخزن رئيسي نشط؛ عيّن مخزناً رئيسياً قبل تأكيد الاستلام.</p>}
      {receiptItems.map((batchItem) => {
        const requestItem = request.items.find((item) => item.id === batchItem.request_item_id)!;
        const line = lines[batchItem.id];
        const normalizedNewName = line.new_item_name.trim().toLocaleLowerCase("ar");
        const duplicateName = normalizedNewName.length > 2 && typeItems.some((item) => {
          const normalizedItemName = item.name.trim().toLocaleLowerCase("ar");
          return normalizedItemName === normalizedNewName ||
            normalizedItemName.includes(normalizedNewName) || normalizedNewName.includes(normalizedItemName);
        });
        const remaining = Math.max(0, Number(batchItem.purchased_qty) - receipts.flatMap((receipt) => receipt.items).filter((entry) => entry.batch_item_id === batchItem.id).reduce((sum, entry) => sum + Number(entry.received_qty), 0));
        return (
          <div key={batchItem.id} className={`grid gap-2 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-5 ${line.did_not_arrive ? "border-destructive bg-destructive/5" : "bg-background"}`}>
            <div className="self-end text-sm font-semibold">{requestItem.item_name}<p className="text-xs font-normal text-muted-foreground">مطلوب أصلاً {requestItem.original_qty} · مشترى {batchItem.purchased_qty} · سبق استلامه {batchItem.purchased_qty - remaining} · متبقي {remaining}</p></div>
            <Field label="المستلم فعلياً"><Input type="number" min="0" max={remaining} step="0.001" value={line.did_not_arrive ? "0" : line.received_qty} disabled={line.did_not_arrive} onChange={(event) => setLine(batchItem.id, "received_qty", event.target.value)} /></Field>
            <label className="flex min-h-10 items-center gap-2 self-end text-sm"><input type="checkbox" checked={line.did_not_arrive} onChange={(event) => setLine(batchItem.id, "did_not_arrive", event.target.checked)} /> لم يصل</label>
            <Field label="الصنف المخزني"><select className="h-10 w-full rounded-md border bg-background px-2 text-sm" value={line.warehouse_item_id} onChange={(event) => { setLine(batchItem.id, "warehouse_item_id", event.target.value); if (event.target.value) setLine(batchItem.id, "new_item_name", ""); }}><option value="">إنشاء صنف عند الاستلام</option>{typeItems.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.unit}</option>)}</select></Field>
            <Field label="الاسم عند إنشاء صنف جديد"><Input value={line.new_item_name} disabled={!!line.warehouse_item_id} onChange={(event) => setLine(batchItem.id, "new_item_name", event.target.value)} /></Field>
            {!line.warehouse_item_id && duplicateName && <p className="text-xs font-semibold text-amber-700 lg:col-span-5">يوجد اسم مطابق في الكتالوج؛ اختر الصنف الموجود لتجنب التكرار.</p>}
            <Field label="الوحدة عند الإنشاء"><Input value={line.new_item_unit} disabled={!!line.warehouse_item_id} onChange={(event) => setLine(batchItem.id, "new_item_unit", event.target.value)} /></Field>
            <Field label="ملاحظات الرقم التسلسلي"><Input value={line.serial_notes} onChange={(event) => setLine(batchItem.id, "serial_notes", event.target.value)} /></Field>
            <Field label="سبب عدم الوصول أو النقص"><Input value={line.shortage_reason} onChange={(event) => setLine(batchItem.id, "shortage_reason", event.target.value)} /></Field>
            <Field label="سبب الاستبعاد المعتمد"><Input value={line.exclusion_reason} onChange={(event) => setLine(batchItem.id, "exclusion_reason", event.target.value)} /></Field>
            <Field label="المعتمد"><select className="h-10 w-full rounded-md border bg-background px-2 text-sm" value={line.approved_by} onChange={(event) => setLine(batchItem.id, "approved_by", event.target.value)}><option value="">اختر المعتمد</option>{approvers.map((approver) => <option key={approver.id} value={approver.id}>{approver.name}</option>)}</select></Field>
          </div>
        );
      })}
      <Field label="ملاحظات الاستلام"><Input value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
      <Button disabled={busy || !mainWarehouses.length} onClick={() => void receive()}>تأكيد الاستلام الفعلي</Button>
    </div>
  );
}

function BatchHistory({ batches, canSend, onDone }: { batches: PurchaseBatch[]; canSend: boolean; onDone: () => void }) {
  return (
    <details className="rounded-md border px-3 py-2">
      <summary className="cursor-pointer text-sm font-semibold">دفعات الشراء ({batches.length})</summary>
      <div className="mt-3 space-y-2">
        {batches.map((batch) => <div key={batch.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 p-3 text-sm">
          <div><b>{batch.supplier}</b> · {batch.document_number || "دون رقم مستند"} · {formatDate(batch.purchase_date)}<p className="text-xs text-muted-foreground">{batch.status === "sent_to_warehouse" ? "أرسلت للاستلام" : "مسودة شراء"}</p></div>
          {canSend && batch.status === "draft" && <SendBatchAction batch={batch} onDone={onDone} />}
        </div>)}
      </div>
    </details>
  );
}

function SendBatchAction({ batch, onDone }: { batch: PurchaseBatch; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try { await sendMaterialPurchaseBatch({ data: { batch_id: batch.id } }); toast.success("أرسلت الدفعة إلى المخزن للاستلام"); onDone(); }
    catch (error) { toast.error(formatErrorMessage(error, "تعذر إرسال الدفعة")); }
    finally { setBusy(false); }
  };
  return <Button size="sm" disabled={busy} onClick={() => void send()}><Send className="ml-2 h-4 w-4" /> إرسال للاستلام</Button>;
}

function ReceiptHistory({
  request,
  receipts,
  batches,
  warehouses,
}: {
  request: MaterialRequest;
  receipts: RequestReceipt[];
  batches: PurchaseBatch[];
  warehouses: MaterialRequestOptions["warehouses"];
}) {
  const downloadReceipt = (receipt: RequestReceipt) => {
    const batch = batches.find((item) => item.id === receipt.batch_id);
    const itemRows = receipt.items.map((line) => {
      const requestItem = request.items.find((item) => item.id === line.request_item_id);
      const batchItem = batch?.items.find((item) => item.id === line.batch_item_id);
      const status = line.did_not_arrive
        ? `لم يصل${line.shortage_reason ? `: ${line.shortage_reason}` : ""}`
        : line.exclusion_reason
          ? `مستبعد: ${line.exclusion_reason}`
          : `تم الاستلام${line.shortage_reason ? ` · سبب النقص: ${line.shortage_reason}` : ""}`;
      return `<tr><td>${escapeHtml(requestItem?.item_name ?? "صنف غير معروف")}</td><td>${escapeHtml(requestItem?.unit ?? "—")}</td><td>${Number(batchItem?.purchased_qty ?? 0).toLocaleString("ar-IQ")}</td><td>${Number(line.received_qty).toLocaleString("ar-IQ")}</td><td>${escapeHtml(status)}</td><td>${escapeHtml(line.serial_notes ?? "—")}</td></tr>`;
    }).join("");
    const warehouse = warehouses.find((item) => item.id === receipt.warehouse_id)?.name ?? "المخزن";
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>وصل استلام ${escapeHtml(request.request_number)}</title><style>@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,Tahoma,sans-serif;color:#162c39;margin:0;line-height:1.6}.header{border-bottom:3px solid #087d78;padding:0 0 14px;display:flex;justify-content:space-between;align-items:center}.header h1{font-size:23px;color:#087d78;margin:0}.header p{margin:3px 0 0;color:#647782;font-size:12px}.ref{border:1px solid #c6d8dc;border-radius:8px;padding:8px 12px;font-weight:bold}.meta{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:18px 0}.box{border:1px solid #d5e1e4;border-radius:8px;padding:9px 11px}.box span{display:block;color:#6b7c84;font-size:10px}.box b{display:block;margin-top:3px;font-size:13px}table{width:100%;border-collapse:collapse;font-size:11px}th{background:#e8f3f2;color:#145a5a}th,td{padding:9px 7px;border:1px solid #cbd8dc;text-align:right}tr:nth-child(even){background:#f7fafb}.note{margin-top:14px;padding:10px;border-right:3px solid #087d78;background:#f2f8f8}.signatures{display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px;margin-top:48px}.signatures div{border-top:1px solid #74858c;padding-top:8px;text-align:center;font-size:11px;color:#52636a}</style></head><body><header class="header"><div><h1>وصل استلام مخزني</h1><p>سجل استلام طلب شراء ومطابقة الكميات</p></div><div class="ref">رقم الوصل: ${escapeHtml(receipt.id)}</div></header><section class="meta"><div class="box"><span>رقم الطلب</span><b>${escapeHtml(request.request_number)}</b></div><div class="box"><span>المخزن المستلم</span><b>${escapeHtml(warehouse)}</b></div><div class="box"><span>المجهز / المورد</span><b>${escapeHtml(batch?.supplier ?? "—")}</b></div><div class="box"><span>رقم مستند الشراء</span><b>${escapeHtml(batch?.document_number || "—")}</b></div><div class="box"><span>تاريخ ووقت الاستلام</span><b>${escapeHtml(new Date(receipt.received_at).toLocaleString("ar-IQ"))}</b></div><div class="box"><span>معرّف مستلم المخزن</span><b dir="ltr">${escapeHtml(receipt.received_by)}</b></div></section><table><thead><tr><th>الصنف</th><th>الوحدة</th><th>المشتراة</th><th>المستلمة فعلياً</th><th>الحالة</th><th>الرقم التسلسلي / ملاحظات</th></tr></thead><tbody>${itemRows}</tbody></table>${receipt.notes ? `<div class="note"><b>ملاحظات الاستلام:</b> ${escapeHtml(receipt.notes)}</div>` : ""}<footer class="signatures"><div>أمين المخزن</div><div>ممثل المشتريات</div><div>المستلم / المستفيد</div></footer></body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `وصل-استلام-${request.request_number}-${receipt.id.slice(0, 8)}.html`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <details className="rounded-md border px-3 py-2">
      <summary className="cursor-pointer text-sm font-semibold">سجل الاستلامات ({receipts.length})</summary>
      <div className="mt-3 space-y-2">
        {receipts.map((receipt) => <div key={receipt.id} className="rounded-md border p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">استلام {receipt.id} · {new Date(receipt.received_at).toLocaleString("ar-IQ")}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => downloadReceipt(receipt)}>
              <FileDown className="ml-2 h-4 w-4" /> تنزيل وصل الاستلام
            </Button>
          </div>
          {receipt.items.map((line) => <p key={line.id} className={line.did_not_arrive ? "mt-1 font-semibold text-destructive" : "mt-1"}>{line.did_not_arrive ? "لم يصل" : `استلم ${line.received_qty}`} {line.exclusion_reason ? `· مستبعد: ${line.exclusion_reason}` : ""} {line.serial_notes ? `· الرقم التسلسلي: ${line.serial_notes}` : ""}</p>)}
        </div>)}
      </div>
    </details>
  );
}

function CloseRequest({ request, onDone }: { request: MaterialRequest; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await closeMaterialRequest({ data: { request_id: request.id, reason } }); toast.success("تم إغلاق الطلب وحفظ سجل النقص"); setOpen(false); onDone(); }
    catch (error) { toast.error(formatErrorMessage(error, "تعذر إغلاق الطلب")); }
    finally { setBusy(false); }
  };
  return <><Button size="sm" variant="outline" onClick={() => setOpen(true)}>إغلاق</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent dir="rtl"><DialogHeader><DialogTitle>إغلاق {request.request_number}</DialogTitle></DialogHeader><Field label="سبب الإغلاق"><Input value={reason} onChange={(event) => setReason(event.target.value)} /></Field><Button disabled={busy || reason.trim().length < 3} onClick={() => void submit()}>تأكيد الإغلاق</Button></DialogContent></Dialog></>;
}

function ReopenRequest({ request, onDone }: { request: MaterialRequest; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const reason = window.prompt("سبب إعادة فتح الطلب:")?.trim() ?? "";
    if (reason.length < 3) return;
    setBusy(true);
    try { await reopenMaterialRequest({ data: { request_id: request.id, reason } }); toast.success("أعيد فتح الطلب وسُجل السبب"); onDone(); }
    catch (error) { toast.error(formatErrorMessage(error, "تعذر إعادة فتح الطلب")); }
    finally { setBusy(false); }
  };
  return <Button size="sm" variant="outline" disabled={busy} onClick={() => void submit()}>إعادة فتح</Button>;
}

function CancelRequest({ request, onDone }: { request: MaterialRequest; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await cancelMaterialRequest({ data: { request_id: request.id } }); toast.success("تم إلغاء الطلب"); onDone(); }
    catch (error) { toast.error(formatErrorMessage(error, "تعذر إلغاء الطلب")); }
    finally { setBusy(false); }
  };
  return <Button size="sm" variant="outline" disabled={busy} onClick={() => void submit()}>إلغاء</Button>;
}

function EmptyRequests({ text }: { text: string }) {
  return <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{text}</div>;
}

function requestResponsibleStage(status: string) {
  if (status === "pending_planning") return "planning";
  if (["pending_warehouse", "pending_receipt", "partially_received"].includes(status)) return "warehouse";
  if (["pending_procurement", "purchasing"].includes(status)) return "procurement";
  if (["received", "closed"].includes(status)) return "done";
  return "applicant";
}
