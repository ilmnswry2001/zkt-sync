import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Boxes, Package, Warehouse as WarehouseIcon, Wrench } from "lucide-react";
import { toast } from "sonner";
import { todayInBaghdad } from "@/lib/date-time";
import * as XLSX from "xlsx";
import { FileDown, Printer } from "lucide-react";
import { MaterialRequestWorkflow } from "@/components/material-requests/MaterialRequestWorkflow";

export const Route = createFileRoute("/_authenticated/warehouses")({
  head: () => ({
    meta: [
      { title: "المخازن | منظومة زِكت" },
      { name: "description", content: "إدارة المخازن والمواد والعدد والصرف للمواقع والجرد الدوري" },
      { property: "og:title", content: "المخازن | منظومة زِكت" },
      {
        property: "og:description",
        content: "إدارة المخازن والمواد والعدد والصرف للمواقع والجرد الدوري",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WarehousesPage,
});

const MOVE_LABELS: Record<string, string> = {
  in: "إدخال",
  issue: "صرف لموقع",
  return: "مرتجع",
  transfer_out: "تحويل صادر",
  transfer_in: "تحويل وارد",
  adjust: "تسوية جرد",
  tool_out: "تسليم عدة",
  tool_back: "إرجاع عدة",
};
const OUT_TYPES = ["issue", "transfer_out", "tool_out"];

const sel = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

function WarehousesPage() {
  const { user, roles, isAdmin, isHR } = useAuth();
  const canEdit = isAdmin || isHR || roles.some((r) => r === "data_entry" || r === "site_admin");
  const qc = useQueryClient();
  const today = todayInBaghdad();

  const whQ = useQuery({
    queryKey: ["wh-warehouses"],
    queryFn: async () =>
      (
        await supabase
          .from("warehouses")
          .select("*")
          .order("is_main", { ascending: false })
          .order("name")
      ).data ?? [],
  });
  const itemsQ = useQuery({
    queryKey: ["wh-items"],
    queryFn: async () =>
      (await supabase.from("warehouse_items").select("*").order("name")).data ?? [],
  });
  const movesQ = useQuery({
    queryKey: ["wh-moves"],
    queryFn: async () =>
      (
        await supabase
          .from("stock_movements")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(5000)
      ).data ?? [],
  });
  const sitesQ = useQuery({
    queryKey: ["wh-sites"],
    queryFn: async () => (await supabase.from("sites").select("id, name").order("name")).data ?? [],
  });
  const empsQ = useQuery({
    queryKey: ["wh-emps"],
    queryFn: async () =>
      (
        await supabase
          .from("employees")
          .select("id, full_name")
          .eq("status", "active")
          .order("full_name")
      ).data ?? [],
  });

  const warehouses = whQ.data ?? [];
  const items = itemsQ.data ?? [];
  const moves = movesQ.data ?? [];
  const sites = sitesQ.data ?? [];
  const emps = empsQ.data ?? [];
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);
  const siteById = useMemo(() => new Map(sites.map((s) => [s.id, s.name])), [sites]);
  const empById = useMemo(() => new Map(emps.map((e) => [e.id, e.full_name])), [emps]);

  const stock = useMemo(() => {
    const m = new Map<string, number>();
    for (const mv of moves)
      m.set(
        `${mv.warehouse_id}|${mv.item_id}`,
        (m.get(`${mv.warehouse_id}|${mv.item_id}`) ?? 0) + Number(mv.qty_delta),
      );
    return m;
  }, [moves]);
  const qtyOf = (w: string, i: string) => stock.get(`${w}|${i}`) ?? 0;
  const exportSheet = (name: string, rows: Record<string, string | number>[]) => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name.slice(0, 31));
    XLSX.writeFile(workbook, `${name}-${today}.xlsx`);
  };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["wh-moves"] });
    qc.invalidateQueries({ queryKey: ["wh-items"] });
    qc.invalidateQueries({ queryKey: ["wh-warehouses"] });
  };

  const [whFilter, setWhFilter] = useState("all");
  const lowStock = items.filter(
    (i) =>
      i.kind === "material" &&
      Number(i.min_qty) > 0 &&
      warehouses.reduce((s, w) => s + qtyOf(w.id, i.id), 0) < Number(i.min_qty),
  );
  const toolsOut = moves.filter(
    (m) => m.movement_type === "tool_out" || m.movement_type === "tool_back",
  );
  const toolsWithEmps = useMemo(() => {
    const m = new Map<string, number>();
    for (const mv of toolsOut)
      if (mv.employee_id)
        m.set(
          `${mv.employee_id}|${mv.item_id}`,
          (m.get(`${mv.employee_id}|${mv.item_id}`) ?? 0) - Number(mv.qty_delta),
        );
    return [...m.entries()]
      .filter(([, q]) => q > 0)
      .map(([k, q]) => ({ emp: k.split("|")[0], item: k.split("|")[1], q }));
  }, [toolsOut]);

  // Movement form
  const [mv, setMv] = useState({
    type: "in",
    warehouse_id: "",
    item_id: "",
    qty: "",
    date: today,
    site_id: "",
    employee_id: "",
    to_wh: "",
    notes: "",
  });
  const saveMove = async () => {
    const qty = Number(mv.qty);
    if (!mv.warehouse_id || !mv.item_id || !(qty > 0))
      return toast.error("اختر المخزن والصنف وأدخل كمية صحيحة");
    if (mv.type === "issue" && !mv.site_id) return toast.error("اختر الموقع المصروف له");
    if (mv.type.startsWith("tool") && !mv.employee_id) return toast.error("اختر الموظف");
    if (mv.type === "transfer" && (!mv.to_wh || mv.to_wh === mv.warehouse_id))
      return toast.error("اختر مخزن الوجهة");
    if (
      (OUT_TYPES.includes(mv.type) || mv.type === "transfer") &&
      qtyOf(mv.warehouse_id, mv.item_id) < qty
    )
      return toast.error(`الرصيد غير كافٍ (المتوفر ${qtyOf(mv.warehouse_id, mv.item_id)})`);
    const base = {
      item_id: mv.item_id,
      movement_date: mv.date,
      notes: mv.notes || null,
      created_by: user?.id,
    };
    const rows =
      mv.type === "transfer"
        ? [
            {
              ...base,
              warehouse_id: mv.warehouse_id,
              movement_type: "transfer_out",
              qty_delta: -qty,
              related_warehouse_id: mv.to_wh,
            },
            {
              ...base,
              warehouse_id: mv.to_wh,
              movement_type: "transfer_in",
              qty_delta: qty,
              related_warehouse_id: mv.warehouse_id,
            },
          ]
        : [
            {
              ...base,
              warehouse_id: mv.warehouse_id,
              movement_type: mv.type,
              qty_delta: OUT_TYPES.includes(mv.type) ? -qty : qty,
              site_id: mv.site_id || null,
              employee_id: mv.employee_id || null,
            },
          ];
    const { error } = await supabase.from("stock_movements").insert(rows as never);
    if (error) return toast.error(error.message);
    toast.success("تم تسجيل الحركة");
    setMv({ ...mv, qty: "", notes: "" });
    refresh();
  };

  // Item / warehouse forms
  const [it, setIt] = useState({
    name: "",
    code: "",
    kind: "material",
    unit: "قطعة",
    min_qty: "",
    unit_cost: "",
  });
  const saveItem = async () => {
    if (!it.name.trim()) return toast.error("أدخل اسم الصنف");
    const { error } = await supabase.from("warehouse_items").insert({
      name: it.name.trim(),
      code: it.code || null,
      kind: it.kind,
      unit: it.unit || "قطعة",
      min_qty: Number(it.min_qty) || 0,
      unit_cost: Number(it.unit_cost) || 0,
    });
    if (error) return toast.error(error.message);
    toast.success("تمت إضافة الصنف");
    setIt({ name: "", code: "", kind: "material", unit: "قطعة", min_qty: "", unit_cost: "" });
    refresh();
  };
  const [wh, setWh] = useState({ name: "", site_id: "", is_main: false });
  const saveWh = async () => {
    if (!wh.name.trim()) return toast.error("أدخل اسم المخزن");
    const { error } = await supabase
      .from("warehouses")
      .insert({ name: wh.name.trim(), site_id: wh.site_id || null, is_main: wh.is_main });
    if (error) return toast.error(error.message);
    toast.success("تمت إضافة المخزن");
    setWh({ name: "", site_id: "", is_main: false });
    refresh();
  };

  // Daily report
  const [day, setDay] = useState(today);
  const dayMoves = moves.filter((m) => m.movement_date === day);
  const issuesBySite = useMemo(() => {
    const m = new Map<string, { qty: number; cost: number; lines: string[] }>();
    for (const x of dayMoves.filter((d) => d.movement_type === "issue")) {
      const key = x.site_id ?? "";
      const item = itemById.get(x.item_id);
      const q = -Number(x.qty_delta);
      const cur = m.get(key) ?? { qty: 0, cost: 0, lines: [] };
      cur.qty += q;
      cur.cost += q * Number(item?.unit_cost ?? 0);
      cur.lines.push(`${item?.name ?? "؟"} × ${q} ${item?.unit ?? ""}`);
      m.set(key, cur);
    }
    return [...m.entries()];
  }, [dayMoves, itemById]);

  // Stock count
  const [countWh, setCountWh] = useState("");
  const [counted, setCounted] = useState<Record<string, string>>({});
  const saveCount = async () => {
    if (!countWh) return toast.error("اختر المخزن");
    const lines = items
      .filter((i) => counted[i.id] !== undefined && counted[i.id] !== "")
      .map((i) => ({
        item_id: i.id,
        system_qty: qtyOf(countWh, i.id),
        counted_qty: Number(counted[i.id]),
      }));
    if (!lines.length) return toast.error("أدخل العدد الفعلي لصنف واحد على الأقل");
    const { data: c, error } = await supabase
      .from("stock_counts")
      .insert({ warehouse_id: countWh, count_date: today, created_by: user?.id })
      .select("id")
      .single();
    if (error || !c) return toast.error(error?.message ?? "تعذر حفظ الجرد");
    const { error: e2 } = await supabase
      .from("stock_count_lines")
      .insert(lines.map((l) => ({ ...l, count_id: c.id })));
    if (e2) return toast.error(e2.message);
    const adjust = lines
      .filter((l) => l.counted_qty !== l.system_qty)
      .map((l) => ({
        warehouse_id: countWh,
        item_id: l.item_id,
        movement_type: "adjust",
        qty_delta: l.counted_qty - l.system_qty,
        movement_date: today,
        count_id: c.id,
        notes: "تسوية جرد",
        created_by: user?.id,
      }));
    if (adjust.length) {
      const { error: e3 } = await supabase.from("stock_movements").insert(adjust);
      if (e3) return toast.error(e3.message);
    }
    toast.success(`تم حفظ الجرد — ${adjust.length} فروقات سُوّيت`);
    setCounted({});
    refresh();
  };

  const shownWh = whFilter === "all" ? warehouses : warehouses.filter((w) => w.id === whFilter);
  const moveLine = (m: (typeof moves)[number]) => {
    const target = m.site_id
      ? siteById.get(m.site_id)
      : m.employee_id
        ? empById.get(m.employee_id)
        : m.related_warehouse_id
          ? whById.get(m.related_warehouse_id)?.name
          : "";
    return target ?? "";
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat icon={WarehouseIcon} label="المخازن" value={warehouses.length} />
        <Stat icon={Package} label="الأصناف" value={items.length} />
        <Stat
          icon={AlertTriangle}
          label="تحت الحد الأدنى"
          value={lowStock.length}
          warn={lowStock.length > 0}
        />
        <Stat
          icon={Wrench}
          label="عدد لدى الموظفين"
          value={toolsWithEmps.reduce((s, t) => s + t.q, 0)}
        />
      </div>

      <Tabs defaultValue="stock" dir="rtl">
        <TabsList className="flex-wrap">
          <TabsTrigger value="stock">الرصيد</TabsTrigger>
          {canEdit && <TabsTrigger value="move">تسجيل حركة</TabsTrigger>}
          <TabsTrigger value="daily">التقرير اليومي</TabsTrigger>
          <TabsTrigger value="tools">العدد والأدوات</TabsTrigger>
          {canEdit && <TabsTrigger value="count">الجرد</TabsTrigger>}
          {canEdit && <TabsTrigger value="setup">الأصناف والمخازن</TabsTrigger>}
          <TabsTrigger value="requests">الطلبات الواردة</TabsTrigger>
        </TabsList>

        <TabsContent value="stock">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2"><CardTitle className="text-base">رصيد المخازن</CardTitle><Button size="sm" variant="outline" onClick={() => exportSheet("الجرد", items.map((item) => ({ الصنف: item.name, النوع: item.kind === "tool" ? "عدة" : "مادة", ...Object.fromEntries(shownWh.map((warehouse) => [warehouse.name, qtyOf(warehouse.id, item.id)])), الإجمالي: shownWh.reduce((sum, warehouse) => sum + qtyOf(warehouse.id, item.id), 0), الوحدة: item.unit })))}><FileDown className="ml-2 h-4 w-4"/> Excel</Button></div>
              <select
                className={sel + " max-w-60"}
                value={whFilter}
                onChange={(e) => setWhFilter(e.target.value)}
              >
                <option value="all">كل المخازن</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {!items.length ? (
                <Empty text="لا توجد أصناف بعد. أضفها من تبويب «الأصناف والمخازن»." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الصنف</TableHead>
                      <TableHead>النوع</TableHead>
                      {shownWh.map((w) => (
                        <TableHead key={w.id}>{w.name}</TableHead>
                      ))}
                      <TableHead>الإجمالي</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((i) => {
                      const total = shownWh.reduce((s, w) => s + qtyOf(w.id, i.id), 0);
                      const low =
                        i.kind === "material" && Number(i.min_qty) > 0 && total < Number(i.min_qty);
                      return (
                        <TableRow key={i.id}>
                          <TableCell className="font-medium">
                            {i.name} <span className="text-xs text-muted-foreground">{i.code}</span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{i.kind === "tool" ? "عدة" : "مادة"}</Badge>
                          </TableCell>
                          {shownWh.map((w) => (
                            <TableCell key={w.id}>{qtyOf(w.id, i.id)}</TableCell>
                          ))}
                          <TableCell className={low ? "font-bold text-destructive" : "font-bold"}>
                            {total} {i.unit}
                            {low && " ⚠"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {canEdit && (
          <TabsContent value="move">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">تسجيل حركة مخزنية</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3">
                <F label="نوع الحركة">
                  <select
                    className={sel}
                    value={mv.type}
                    onChange={(e) => setMv({ ...mv, type: e.target.value })}
                  >
                    <option value="in">إدخال (شراء/توريد)</option>
                    <option value="issue">صرف لموقع</option>
                    <option value="return">مرتجع من موقع</option>
                    <option value="transfer">تحويل بين مخازن</option>
                    <option value="tool_out">تسليم عدة لموظف</option>
                    <option value="tool_back">إرجاع عدة من موظف</option>
                  </select>
                </F>
                <F label={mv.type === "transfer" ? "من مخزن" : "المخزن"}>
                  <select
                    className={sel}
                    value={mv.warehouse_id}
                    onChange={(e) => setMv({ ...mv, warehouse_id: e.target.value })}
                  >
                    <option value="">— اختر —</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </F>
                <F label="الصنف">
                  <select
                    className={sel}
                    value={mv.item_id}
                    onChange={(e) => setMv({ ...mv, item_id: e.target.value })}
                  >
                    <option value="">— اختر —</option>
                    {items
                      .filter((i) => (mv.type.startsWith("tool") ? i.kind === "tool" : true))
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name} ({i.unit})
                        </option>
                      ))}
                  </select>
                  {mv.warehouse_id && mv.item_id && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      المتوفر: {qtyOf(mv.warehouse_id, mv.item_id)}
                    </p>
                  )}
                </F>
                <F label="الكمية">
                  <Input
                    type="number"
                    min="0"
                    value={mv.qty}
                    onChange={(e) => setMv({ ...mv, qty: e.target.value })}
                  />
                </F>
                <F label="التاريخ">
                  <Input
                    type="date"
                    value={mv.date}
                    onChange={(e) => setMv({ ...mv, date: e.target.value })}
                  />
                </F>
                {(mv.type === "issue" || mv.type === "return") && (
                  <F label="الموقع">
                    <select
                      className={sel}
                      value={mv.site_id}
                      onChange={(e) => setMv({ ...mv, site_id: e.target.value })}
                    >
                      <option value="">— اختر —</option>
                      {sites.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </F>
                )}
                {mv.type.startsWith("tool") && (
                  <F label="الموظف">
                    <select
                      className={sel}
                      value={mv.employee_id}
                      onChange={(e) => setMv({ ...mv, employee_id: e.target.value })}
                    >
                      <option value="">— اختر —</option>
                      {emps.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.full_name}
                        </option>
                      ))}
                    </select>
                  </F>
                )}
                {mv.type === "transfer" && (
                  <F label="إلى مخزن">
                    <select
                      className={sel}
                      value={mv.to_wh}
                      onChange={(e) => setMv({ ...mv, to_wh: e.target.value })}
                    >
                      <option value="">— اختر —</option>
                      {warehouses
                        .filter((w) => w.id !== mv.warehouse_id)
                        .map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                    </select>
                  </F>
                )}
                <F label="ملاحظات">
                  <Input
                    value={mv.notes}
                    onChange={(e) => setMv({ ...mv, notes: e.target.value })}
                  />
                </F>
                <div className="sm:col-span-3">
                  <Button onClick={saveMove}>حفظ الحركة</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="daily" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Label>اليوم</Label>
            <Input
              type="date"
              className="w-44"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
            <Button variant="outline" onClick={() => exportSheet("حركات-يومية", dayMoves.map((move) => ({ التاريخ: move.movement_date, النوع: MOVE_LABELS[move.movement_type] ?? move.movement_type, المخزن: whById.get(move.warehouse_id)?.name ?? "", الصنف: itemById.get(move.item_id)?.name ?? "", الكمية: Number(move.qty_delta), الجهة: moveLine(move), ملاحظات: move.notes ?? "" })))}><FileDown className="ml-2 h-4 w-4"/> تصدير اليوم</Button>
            <Button variant="outline" onClick={() => window.print()}><Printer className="ml-2 h-4 w-4"/> طباعة</Button>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">المصروف للمواقع</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {!issuesBySite.length ? (
                <Empty text="لا يوجد صرف للمواقع في هذا اليوم." />
              ) : (
                issuesBySite.map(([sid, v]) => (
                  <div key={sid} className="rounded-xl border p-3">
                    <div className="flex justify-between font-semibold">
                      <span>{siteById.get(sid) ?? "بدون موقع"}</span>
                      <span className="text-primary">{v.cost.toLocaleString()} د.ع</span>
                    </div>
                    <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                      {v.lines.map((l, i) => (
                        <li key={i}>{l}</li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">كل حركات اليوم ({dayMoves.length})</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>النوع</TableHead>
                    <TableHead>المخزن</TableHead>
                    <TableHead>الصنف</TableHead>
                    <TableHead>الكمية</TableHead>
                    <TableHead>الجهة</TableHead>
                    <TableHead>ملاحظات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dayMoves.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        <Badge variant={Number(m.qty_delta) < 0 ? "destructive" : "secondary"}>
                          {MOVE_LABELS[m.movement_type] ?? m.movement_type}
                        </Badge>
                      </TableCell>
                      <TableCell>{whById.get(m.warehouse_id)?.name}</TableCell>
                      <TableCell>{itemById.get(m.item_id)?.name}</TableCell>
                      <TableCell dir="ltr" className="text-right">
                        {Number(m.qty_delta)}
                      </TableCell>
                      <TableCell>{moveLine(m)}</TableCell>
                      <TableCell className="text-xs">{m.notes}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tools">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">العدد المسلّمة للموظفين حالياً</CardTitle>
            </CardHeader>
            <CardContent>
              {!toolsWithEmps.length ? (
                <Empty text="لا توجد عدد مسلّمة حالياً." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الموظف</TableHead>
                      <TableHead>العدة</TableHead>
                      <TableHead>الكمية</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {toolsWithEmps.map((t) => (
                      <TableRow key={t.emp + t.item}>
                        <TableCell>{empById.get(t.emp)}</TableCell>
                        <TableCell>{itemById.get(t.item)?.name}</TableCell>
                        <TableCell>{t.q}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {canEdit && (
          <TabsContent value="count">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  جرد دوري — أدخل العدد الفعلي وسيُسوّى الفرق تلقائياً
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <select
                  className={sel + " max-w-72"}
                  value={countWh}
                  onChange={(e) => {
                    setCountWh(e.target.value);
                    setCounted({});
                  }}
                >
                  <option value="">— اختر المخزن —</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
                {countWh && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الصنف</TableHead>
                        <TableHead>رصيد النظام</TableHead>
                        <TableHead>العدد الفعلي</TableHead>
                        <TableHead>الفرق</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((i) => {
                        const sys = qtyOf(countWh, i.id);
                        const c = counted[i.id];
                        const diff = c === undefined || c === "" ? null : Number(c) - sys;
                        return (
                          <TableRow key={i.id}>
                            <TableCell>{i.name}</TableCell>
                            <TableCell>{sys}</TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                className="w-28"
                                value={c ?? ""}
                                onChange={(e) => setCounted({ ...counted, [i.id]: e.target.value })}
                              />
                            </TableCell>
                            <TableCell className={diff ? "font-bold text-destructive" : ""}>
                              {diff ?? "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
                <Button onClick={saveCount} disabled={!countWh}>
                  اعتماد الجرد
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {canEdit && (
          <TabsContent value="setup" className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">إضافة صنف</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <F label="الاسم">
                  <Input value={it.name} onChange={(e) => setIt({ ...it, name: e.target.value })} />
                </F>
                <F label="الرمز">
                  <Input value={it.code} onChange={(e) => setIt({ ...it, code: e.target.value })} />
                </F>
                <F label="النوع">
                  <select
                    className={sel}
                    value={it.kind}
                    onChange={(e) => setIt({ ...it, kind: e.target.value })}
                  >
                    <option value="material">مادة / مستهلك</option>
                    <option value="tool">عدة / أداة</option>
                  </select>
                </F>
                <F label="الوحدة">
                  <Input value={it.unit} onChange={(e) => setIt({ ...it, unit: e.target.value })} />
                </F>
                <F label="الحد الأدنى">
                  <Input
                    type="number"
                    value={it.min_qty}
                    onChange={(e) => setIt({ ...it, min_qty: e.target.value })}
                  />
                </F>
                <F label="سعر الوحدة (د.ع)">
                  <Input
                    type="number"
                    value={it.unit_cost}
                    onChange={(e) => setIt({ ...it, unit_cost: e.target.value })}
                  />
                </F>
                <div className="sm:col-span-2">
                  <Button onClick={saveItem}>إضافة الصنف</Button>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">إضافة مخزن</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <F label="اسم المخزن">
                  <Input value={wh.name} onChange={(e) => setWh({ ...wh, name: e.target.value })} />
                </F>
                <F label="الموقع المرتبط (اختياري)">
                  <select
                    className={sel}
                    value={wh.site_id}
                    onChange={(e) => setWh({ ...wh, site_id: e.target.value })}
                  >
                    <option value="">— بدون —</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </F>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={wh.is_main}
                    onChange={(e) => setWh({ ...wh, is_main: e.target.checked })}
                  />{" "}
                  مخزن رئيسي
                </label>
                <Button onClick={saveWh}>إضافة المخزن</Button>
                <div className="flex flex-wrap gap-2 pt-2">
                  {warehouses.map((w) => (
                    <Badge key={w.id} variant={w.is_main ? "default" : "outline"}>
                      <Boxes className="ml-1 h-3 w-3" />
                      {w.name}
                      {w.site_id ? ` — ${siteById.get(w.site_id) ?? ""}` : ""}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="requests">
          <MaterialRequestWorkflow stage="warehouse" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <p className="col-span-full py-6 text-center text-sm text-muted-foreground">{text}</p>;
}
function Stat({
  icon: Icon,
  label,
  value,
  warn,
}: {
  icon: typeof Package;
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={
            "rounded-xl p-2.5 " +
            (warn ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")
          }
        >
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
