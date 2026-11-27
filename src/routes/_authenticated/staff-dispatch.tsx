import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Copy, Plus, Printer, UsersRound, X } from "lucide-react";
import { toast } from "sonner";
import { MetricCard } from "@/components/MetricCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useDirectorySearch } from "@/hooks/use-directory-search";
import { supabase } from "@/integrations/supabase/client";
import { todayInBaghdad } from "@/lib/date-time";
import { direction, ui } from "@/lib/ui-language";
import {
  canUseStaffDispatch, dispatchMessage, dispatchStatuses, dispatchStatusLabel, groupDispatchEmployees,
  printStaffDispatch, tomorrowInBaghdad, type DispatchEmployee, type DispatchStatus,
} from "@/lib/staff-dispatch";

export const Route = createFileRoute("/_authenticated/staff-dispatch")({
  head: () => {
    const title = ui("نشر الكوادر الميدانية");
    const description = ui("تنسيق نشر الكوادر الميدانية ومتابعة وجهات التكليف.");
    return { meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ] };
  },
  component: StaffDispatchPage,
});

type Destination = { kind: "site" | "workshop" | "custom"; id: string; label: string };
type SavedDispatch = { id: string; title: string; status: DispatchStatus; destination: string; updated_at: string };
type DispatchDetails = SavedDispatch & {
  dispatch_date: string; site_id: string | null; workshop_id: string | null;
  notes: string; employees: DispatchEmployee[];
};
const batch = 20;

async function dispatchRpc<T>(
  name: "search_staff_dispatch" | "read_staff_dispatch" | "save_staff_dispatch",
  args: Record<string, string | number | null | string[]>,
  signal?: AbortSignal,
): Promise<T> {
  const request = supabase.rpc(name as never, args as never);
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw error;
  return data as T;
}

function SearchState({ waiting, failed, empty, retry }: {
  waiting: boolean; failed: boolean; empty: boolean; retry: () => void;
}) {
  if (waiting) return <p role="status" className="text-sm text-muted-foreground">{ui("جارٍ البحث…")}</p>;
  if (failed) return <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
    {ui("تعذر تحميل النتائج.")}<Button variant="outline" size="sm" onClick={retry}>{ui("إعادة المحاولة")}</Button>
  </div>;
  return empty ? <p className="text-sm text-muted-foreground">{ui("لا توجد نتائج مطابقة.")}</p> : null;
}

function Paging({ page, setPage, more }: { page: number; setPage: (page: number) => void; more: boolean }) {
  if (!page && !more) return null;
  return <div className="flex gap-2">
    <Button size="sm" variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>{ui("السابق")}</Button>
    <Button size="sm" variant="outline" disabled={!more} onClick={() => setPage(page + 1)}>{ui("التالي")}</Button>
  </div>;
}

function StaffDispatchPage() {
  const { roles, loading, permissionsLoading, canAccessSection, user } = useAuth();
  if (loading || permissionsLoading) return <p role="status">{ui("جارٍ التحميل")}</p>;
  if (!user || !canUseStaffDispatch(roles) || !canAccessSection("/staff-dispatch")) {
    return <p role="alert">{ui("ليس لديك صلاحية الوصول إلى هذا القسم.")}</p>;
  }
  return <StaffDispatchEditor key={user.id} userId={user.id} />;
}

function StaffDispatchEditor({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(tomorrowInBaghdad);
  const [title, setTitle] = useState(() => ui("نشرة الكوادر الميدانية"));
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<DispatchStatus>("draft");
  const [saved, setSaved] = useState<Pick<SavedDispatch, "id" | "updated_at"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [employees, setEmployees] = useState<DispatchEmployee[]>([]);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [destinationKind, setDestinationKind] = useState<Destination["kind"]>("site");
  const [destinationSearch, setDestinationSearch] = useState("");
  const [category, setCategory] = useState("");
  const [rosterSearch, setRosterSearch] = useState("");
  const [rosterPage, setRosterPage] = useState(0);
  const [savedPage, setSavedPage] = useState(0);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [directorySearch, setDirectorySearch] = useState("");
  const directory = useDirectorySearch(directorySearch);
  const roster = useDirectorySearch(rosterSearch);
  const location = useDirectorySearch(destinationSearch);
  const groups = groupDispatchEmployees(employees);
  const selectedIds = new Set(employees.map((employee) => employee.id));

  const categories = useQuery({
    queryKey: ["staff-dispatch", userId, "categories"],
    queryFn: ({ signal }) => dispatchRpc<string[]>("search_staff_dispatch", { p_mode: "categories" }, signal),
  });
  const defaultCategory = categories.data?.[0] ?? "";
  const currentCategory = category || defaultCategory;
  const quickCategories = (categories.data ?? []).filter((value) =>
    /^(كوسرجي|فيتر|لحام|كهربائي|عامل|ريكر)$/.test(value),
  );
  const rosterReady = !!currentCategory && !roster.waiting && (!rosterSearch.trim() || roster.valid);
  const rosterQuery = useQuery({
    queryKey: ["staff-dispatch", userId, "roster", currentCategory, roster.term, rosterPage],
    enabled: rosterReady,
    queryFn: ({ signal }) => dispatchRpc<DispatchEmployee[]>("search_staff_dispatch", {
      p_mode: "roster", p_category: currentCategory, p_term: roster.term, p_offset: rosterPage * batch,
    }, signal),
  });
  const directoryReady = directoryOpen && directory.valid && !directory.waiting;
  const directoryQuery = useQuery({
    queryKey: ["staff-dispatch", userId, "directory", directory.term],
    enabled: directoryReady,
    queryFn: ({ signal }) => dispatchRpc<DispatchEmployee[]>("search_staff_dispatch", {
      p_mode: "directory", p_term: directory.term,
    }, signal),
  });
  const locationReady = !destination && destinationKind !== "custom" && location.valid && !location.waiting;
  const destinationQuery = useQuery({
    queryKey: ["staff-dispatch", userId, "destination", destinationKind, location.term],
    enabled: locationReady,
    queryFn: async ({ signal }): Promise<Destination[]> => {
      const tokens = location.term.split(" ");
      if (destinationKind === "workshop") {
        let request = supabase.from("daily_workshops").select("id,name").eq("is_active", true);
        for (const token of tokens) request = request.ilike("name", `%${token}%`);
        const { data, error } = await request.order("name").order("id").limit(batch).abortSignal(signal);
        if (error) throw error;
        return data.map(({ id, name }) => ({ kind: "workshop", id, label: name }));
      }
      let request = supabase.from("sites").select("id,name,ctr_code").eq("status", "active");
      for (const token of tokens) request = request.or(`name.ilike.%${token}%,ctr_code.ilike.%${token}%`);
      const { data, error } = await request.order("name").order("id").limit(batch).abortSignal(signal);
      if (error) throw error;
      return data.map(({ id, name, ctr_code }) => ({ kind: "site", id, label: [ctr_code, name].filter(Boolean).join(" · ") }));
    },
  });
  const records = useQuery({
    queryKey: ["staff-dispatch", userId, "saved", date, savedPage],
    enabled: !!date,
    queryFn: ({ signal }) => dispatchRpc<SavedDispatch[]>("read_staff_dispatch", {
      p_date: date, p_offset: savedPage * 10,
    }, signal),
  });
  const changeDate = (value: string) => { setDate(value); setSavedPage(0); };
  const toggleEmployee = (employee: DispatchEmployee, selected: boolean) => setEmployees((current) =>
    selected ? current.some(({ id }) => id === employee.id) ? current : [...current, employee]
      : current.filter(({ id }) => id !== employee.id),
  );
  const changeDestination = (kind: Destination["kind"]) => {
    setDestinationKind(kind); setDestination(null); setDestinationSearch("");
  };
  const newDispatch = () => {
    setSaved(null); setTitle(ui("نشرة الكوادر الميدانية")); setNotes(""); setStatus("draft"); setEmployees([]);
    changeDestination("site");
  };

  const openDispatch = async (id: string) => {
    setBusy(true);
    try {
      const record = await dispatchRpc<DispatchDetails | null>("read_staff_dispatch", { p_date: date, p_id: id });
      if (!record) throw new Error("Dispatch unavailable");
      const kind = record.site_id ? "site" : record.workshop_id ? "workshop" : "custom";
      setSaved({ id: record.id, updated_at: record.updated_at });
      changeDate(record.dispatch_date); setTitle(record.title); setNotes(record.notes); setStatus(record.status);
      setDestinationKind(kind); setDestinationSearch("");
      setDestination({ kind, id: record.site_id ?? record.workshop_id ?? "", label: record.destination });
      setEmployees(record.employees);
    } catch {
      toast.error(ui("تعذر فتح النشرة."));
    } finally {
      setBusy(false);
    }
  };

  const validHeader = Boolean(date && title.trim() && destination?.label.trim());
  const exportReady = validHeader && employees.length > 0;
  const saveDispatch = async () => {
    if (busy || !validHeader || !destination || (status !== "draft" && !employees.length)) return;
    setBusy(true);
    try {
      const record = await dispatchRpc<Pick<SavedDispatch, "id" | "updated_at">>("save_staff_dispatch", {
        p_id: saved?.id ?? null, p_expected_updated_at: saved?.updated_at ?? null, p_date: date,
        p_site: destination.kind === "site" ? destination.id : null,
        p_workshop: destination.kind === "workshop" ? destination.id : null,
        p_location: destination.kind === "custom" ? destination.label.trim() : null,
        p_title: title.trim(), p_notes: notes, p_status: status, p_employees: employees.map(({ id }) => id),
      });
      setSaved(record);
      await queryClient.invalidateQueries({ queryKey: ["staff-dispatch", userId, "saved"] });
      toast.success(ui("تم حفظ نشرة الكوادر."));
    } catch (error) {
      toast.error(ui((error as { code?: string })?.code === "40001"
        ? "عُدّلت النشرة. افتحها من جديد قبل الحفظ." : "تعذر حفظ نشرة الكوادر."));
    } finally {
      setBusy(false);
    }
  };
  const exportData = { date, destination: destination?.label.trim() ?? "", title: title.trim(), notes: notes.trim(), employees };
  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(dispatchMessage(exportData));
      toast.success(ui("تم نسخ الرسالة."));
    } catch {
      toast.error(ui("تعذر نسخ الرسالة."));
    }
  };

  return <main dir={direction()} className="mx-auto max-w-7xl space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{ui("تنسيق الكوادر")}</h1>
        <p className="text-sm text-muted-foreground">{ui("جهّز قائمة الكادر المطلوب نشره في الموقع أو الورشة.")}</p>
      </div>
      <Button variant="outline" disabled={busy || !saved} onClick={newDispatch}><Plus className="size-4" />{ui("نشرة جديدة")}</Button>
    </header>

    <fieldset disabled={busy} className="min-w-0 space-y-5">
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader><CardTitle>{ui("بيانات النشر")}</CardTitle></CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-3">
              <Label htmlFor="dispatch-date">{ui("تاريخ النشر")}</Label>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={date === todayInBaghdad() ? "secondary" : "outline"} onClick={() => changeDate(todayInBaghdad())}>{ui("اليوم")}</Button>
                <Button size="sm" variant={date === tomorrowInBaghdad() ? "secondary" : "outline"} onClick={() => changeDate(tomorrowInBaghdad())}>{ui("الغد")}</Button>
                <Button size="sm" variant="outline" onClick={() => {
                  const field = document.getElementById("dispatch-date") as HTMLInputElement | null;
                  field?.focus();
                  try { field?.showPicker?.(); } catch { /* Keyboard date input remains available. */ }
                }}>{ui("مخصص")}</Button>
              </div>
              <Input id="dispatch-date" dir="ltr" type="date" value={date} onChange={(event) => changeDate(event.target.value)} />
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <Label htmlFor="dispatch-destination">{ui("الموقع / الورشة")}</Label>
              <div className="flex flex-wrap gap-2">
                {([["site", "موقع"], ["workshop", "ورشة"], ["custom", "اسم مخصص"]] as const).map(([kind, label]) =>
                  <Button key={kind} size="sm" variant={destinationKind === kind ? "secondary" : "outline"}
                    onClick={() => changeDestination(kind)}>{ui(label)}</Button>,
                )}
              </div>
              {destinationKind === "custom" ? <Input id="dispatch-destination" maxLength={180} value={destination?.label ?? ""}
                onChange={(event) => setDestination({ kind: "custom", id: "", label: event.target.value })} />
                : destination ? <div id="dispatch-destination" className="flex items-center justify-between gap-2 rounded-md border p-2">
                  <span className="break-words text-sm">{destination.label}</span>
                  <Button size="icon" variant="ghost" aria-label={ui("تغيير الوجهة")} onClick={() => changeDestination(destinationKind)}><X /></Button>
                </div> : <Input id="dispatch-destination" type="search" maxLength={100} value={destinationSearch}
                  placeholder={ui("ابحث بحرفين على الأقل")} onChange={(event) => setDestinationSearch(event.target.value)} />}
              {locationReady && <>
                <SearchState waiting={destinationQuery.isPending} failed={destinationQuery.isError} empty={!destinationQuery.data?.length} retry={() => void destinationQuery.refetch()} />
                <div className="max-h-44 space-y-1 overflow-auto">
                  {destinationQuery.data?.map((item) => <Button key={item.id} variant="ghost"
                    className="h-auto w-full justify-start whitespace-normal text-start" onClick={() => setDestination(item)}>{item.label}</Button>)}
                </div>
              </>}
            </div>
            <div className="flex flex-col gap-3">
              <Label htmlFor="dispatch-title">{ui("عنوان النشرة")}</Label>
              <Input id="dispatch-title" maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div className="flex flex-col gap-3">
              <Label htmlFor="dispatch-status">{ui("الحالة")}</Label>
              <select id="dispatch-status" className="min-h-9 rounded-md border bg-background px-3 text-sm"
                value={status} onChange={(event) => setStatus(event.target.value as DispatchStatus)}>
                {dispatchStatuses.map((value) => <option key={value} value={value}>{ui(dispatchStatusLabel[value])}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-3 sm:col-span-2">
              <Label htmlFor="dispatch-notes">{ui("ملاحظات")}</Label>
              <Textarea id="dispatch-notes" maxLength={3000} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </div>
          </CardContent>
        </Card>
        <MetricCard title={ui("إجمالي الكادر المحدد")} value={employees.length} icon={UsersRound}
          detail={<div className="flex flex-wrap gap-2">{groups.map(([label, list]) =>
            <span key={label} className="rounded-md border px-2 py-1">{ui(label)} · {list.length}</span>)}</div>} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader className="gap-3"><CardTitle>{ui("اختيار الكوادر")}</CardTitle>
            <Button className="w-fit max-w-full whitespace-normal" variant="outline" onClick={() => { setDirectorySearch(""); setDirectoryOpen(true); }}>
              <Plus className="size-4" />{ui("إضافة موظف من قاعدة البيانات")}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <SearchState waiting={categories.isPending} failed={categories.isError} empty={!categories.data?.length} retry={() => void categories.refetch()} />
            <div className="flex flex-wrap gap-2">
              {quickCategories.map((value) => <Button key={value} size="sm" variant={currentCategory === value ? "default" : "outline"}
                onClick={() => { setCategory(value); setRosterPage(0); }}>{ui(value)}</Button>)}
              <select aria-label={ui("التخصص")} className="min-h-8 max-w-full rounded-md border bg-background px-2 text-sm"
                value={currentCategory} onChange={(event) => { setCategory(event.target.value); setRosterPage(0); }}>
                <option value="" disabled>{ui("اختر التخصص")}</option>
                {categories.data?.map((value) => <option key={value} value={value}>{ui(value)}</option>)}
              </select>
            </div>
            <Input type="search" aria-label={ui("البحث في القائمة الأساسية")} placeholder={ui("ابحث بالاسم أو الرقم الوظيفي")}
              value={rosterSearch} onChange={(event) => { setRosterSearch(event.target.value); setRosterPage(0); }} />
            {!rosterReady && rosterSearch.trim() && <SearchState waiting={roster.waiting} failed={false} empty={false} retry={() => {}} />}
            {rosterReady && <>
              <SearchState waiting={rosterQuery.isPending} failed={rosterQuery.isError} empty={!rosterQuery.data?.length} retry={() => void rosterQuery.refetch()} />
              <div className="max-h-96 divide-y overflow-y-auto">
                {rosterQuery.data?.slice(0, batch).map((employee) => <label key={employee.id} className="flex min-h-12 items-center gap-3 px-1 py-2">
                  <Checkbox checked={selectedIds.has(employee.id)} onCheckedChange={(checked) => toggleEmployee(employee, checked === true)} />
                  <span className="min-w-0 break-words text-sm"><b className="block">{employee.full_name}</b>
                    <span className="text-muted-foreground">{[employee.position, employee.employee_no].filter(Boolean).join(" · ")}</span></span>
                </label>)}
              </div>
              <Paging page={rosterPage} setPage={setRosterPage} more={(rosterQuery.data?.length ?? 0) > batch} />
            </>}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader><CardTitle>{ui("قائمة النشر")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!groups.length && <p className="text-sm text-muted-foreground">{ui("لم تختر أي موظف للنشر بعد.")}</p>}
            <div className="max-h-[32rem] space-y-4 overflow-y-auto">
              {groups.map(([label, list]) => <section key={label} className="rounded-lg border">
                <h2 className="bg-muted/40 px-3 py-2 text-sm font-semibold">{ui(label)} · {list.length}</h2>
                <ul className="divide-y">{list.map((employee) => <li key={employee.id} className="flex items-start justify-between gap-2 px-3 py-2">
                  <div className="min-w-0 break-words text-sm"><b>{employee.full_name}</b>
                    <p className="text-muted-foreground">{employee.position || "—"}{employee.phone1 && <> · <bdi>{employee.phone1}</bdi></>}</p>
                    {employee.id_no && <p className="text-xs text-muted-foreground">{ui("رقم الهوية")} · <bdi>{employee.id_no}</bdi></p>}
                  </div>
                  <Button size="icon" variant="ghost" className="shrink-0" aria-label={ui("حذف") + " " + employee.full_name}
                    onClick={() => toggleEmployee(employee, false)}><X /></Button>
                </li>)}</ul>
              </section>)}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!validHeader || (status !== "draft" && !employees.length)} onClick={() => void saveDispatch()}>{ui("حفظ النشرة")}</Button>
              <Button variant="outline" disabled={!exportReady} onClick={() => void copyMessage()}><Copy />{ui("نسخ رسالة واتساب")}</Button>
              <Button variant="outline" disabled={!exportReady} onClick={() => {
                if (!printStaffDispatch(exportData)) toast.error(ui("اسمح بالنوافذ المنبثقة لطباعة التقرير"));
              }}><Printer />{ui("تصدير PDF")}</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>{ui("النشرات المحفوظة للتاريخ المحدد")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {date && <SearchState waiting={records.isPending} failed={records.isError} empty={!records.data?.length} retry={() => void records.refetch()} />}
          <div className="grid gap-2 sm:grid-cols-2">{records.data?.slice(0, 10).map((record) => <Button key={record.id}
            variant={saved?.id === record.id ? "secondary" : "outline"} className="h-auto flex-col items-start whitespace-normal text-start"
            onClick={() => void openDispatch(record.id)}>
            <strong className="break-words">{record.title}</strong>
            <span className="break-words text-muted-foreground">{record.destination} · {ui(dispatchStatusLabel[record.status])}</span>
          </Button>)}</div>
          <Paging page={savedPage} setPage={setSavedPage} more={(records.data?.length ?? 0) > 10} />
        </CardContent>
      </Card>
    </fieldset>

    <Dialog open={directoryOpen} onOpenChange={setDirectoryOpen}>
      <DialogContent dir={direction()} className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{ui("إضافة موظف من قاعدة البيانات")}</DialogTitle></DialogHeader>
        <Label htmlFor="dispatch-directory">{ui("الاسم أو الرقم الوظيفي")}</Label>
        <Input id="dispatch-directory" type="search" maxLength={100} placeholder={ui("ابحث بحرفين على الأقل")}
          value={directorySearch} onChange={(event) => setDirectorySearch(event.target.value)} />
        <SearchState waiting={directory.waiting || directoryReady && directoryQuery.isPending}
          failed={directoryReady && directoryQuery.isError} empty={directoryReady && !directoryQuery.data?.length}
          retry={() => void directoryQuery.refetch()} />
        <div className="max-h-[52vh] overflow-y-auto">
          {directoryReady && directoryQuery.data?.slice(0, batch).map((employee) => <Button key={employee.id} variant="ghost"
            disabled={selectedIds.has(employee.id)} className="flex h-auto min-h-12 w-full flex-col items-start whitespace-normal text-start"
            onClick={() => { toggleEmployee(employee, true); setDirectoryOpen(false); }}>
            <b>{employee.full_name}</b>
            <span className="text-muted-foreground">{[employee.position, employee.employee_no].filter(Boolean).join(" · ")}</span>
          </Button>)}
          {directoryReady && (directoryQuery.data?.length ?? 0) > batch && <p className="px-3 text-sm text-muted-foreground">{ui("اكتب اسمًا أدق لعرض نتائج أقل.")}</p>}
        </div>
      </DialogContent>
    </Dialog>
  </main>;
}
