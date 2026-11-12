import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { loadAllRows } from "@/lib/monthly-report";
import { todayInBaghdad } from "@/lib/date-time";
import { formatErrorMessage } from "@/lib/error-message";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MetricCard } from "@/components/MetricCard";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
} from "@/components/ui/command";
import { toast } from "sonner";
type Vehicle = {
  id: string;
  name: string;
  vehicle_no: string;
  passenger_capacity: number | null;
  current_driver_id: string | null;
  is_active: boolean;
};
type Employee = { id: string; full_name: string; employee_no: string };
type Passenger = {
  vehicle_id: string;
  employee_id: string;
  full_name: string;
  employee_no: string;
  active_assignment_id: string | null;
  assigned: boolean;
  week_days: number;
  month_days: number;
  present_today: boolean;
};
function EmployeePicker({
  employees,
  value,
  onChange,
  label,
}: {
  employees: Employee[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = employees.find((e) => e.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-11 w-full whitespace-normal text-right"
          aria-label={label}
          role="combobox"
          aria-expanded={open}
        >
          {selected
            ? `${selected.employee_no} — ${selected.full_name}`
            : value
              ? "موظف غير نشط / غير متاح"
              : "اختر الموظف"}
        </Button>
      </PopoverTrigger>
      <PopoverContent dir="rtl" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder="ابحث بالاسم أو رقم الموظف" />
          <CommandList>
            <CommandEmpty>لا توجد نتائج</CommandEmpty>
            <CommandItem
              value="دون تعيين"
              onSelect={() => {
                onChange("");
                setOpen(false);
              }}
            >
              دون تعيين
            </CommandItem>
            {employees.map((e) => (
              <CommandItem
                key={e.id}
                value={`${e.employee_no} ${e.full_name}`}
                onSelect={() => {
                  onChange(e.id);
                  setOpen(false);
                }}
              >
                {e.employee_no} — {e.full_name}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
export function VehiclePassengerUtilization() {
  const [day, setDay] = useState(todayInBaghdad());
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const qc = useQueryClient();
  const permission = useQuery({
    queryKey: ["vehicle-passenger-permission"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return false;
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", auth.user.id);
      if (error) throw error;
      return data?.some((r) => r.role === "admin" || r.role === "hr") ?? false;
    },
  });
  const query = useQuery({
    queryKey: ["vehicle-passengers", day],
    refetchInterval: 30_000,
    queryFn: async () => {
      const [vehicles, employees, passengers] = await Promise.all([
        loadAllRows((a, b) =>
          supabase
            .from("vehicles")
            .select("id,name,vehicle_no,passenger_capacity,current_driver_id,is_active")
            .eq("vehicle_class", "light")
            .order("id")
            .range(a, b),
        ),
        loadAllRows((a, b) =>
          supabase
            .from("employees")
            .select("id,full_name,employee_no")
            .eq("status", "active")
            .order("id")
            .range(a, b),
        ),
        loadAllRows((a, b) => supabase.rpc("vehicle_passenger_attendance", { p_day: day }).range(a, b)),
      ]);
      return {
        vehicles: vehicles as Vehicle[],
        employees: employees as Employee[],
        passengers: passengers as Passenger[],
      };
    },
  });
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["vehicle-passengers"] }),
      qc.invalidateQueries({ queryKey: ["vehicles"] }),
    ]);
  };
  const vehicle = query.data?.vehicles.find((v) => v.id === selected);
  return (
    <section dir="rtl" className="space-y-5">
      <header className="operations-banner flex flex-wrap items-end justify-between gap-4 rounded-2xl border bg-card p-6">
        <div>
          <p className="text-xs text-muted-foreground">المركبات الخفيفة / تنسيب الكادر</p>
          <h2 className="mt-2 text-2xl font-bold">إشغال المركبات وجدوى استخدامها</h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
            نسبة الإشغال حسب الركاب المنسبين، والسائق مستقل. تُحتسب أيام الشخص من بصماته الصالحة
            خلال مدة تنسيبه، باعتباره مستخدماً للمركبة أثناء حضور العمل.
          </p>
        </div>
        <label className="flex flex-col gap-3 text-sm">
          حتى تاريخ
          <Input
            type="date"
            max={todayInBaghdad()}
            value={day}
            onChange={(e) => {
              if (e.target.value) setDay(e.target.value);
            }}
          />
        </label>
      </header>
      <Input
        aria-label="البحث عن مركبة"
        className="max-w-sm"
        placeholder="اسم المركبة أو رقمها"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {query.isPending ? (
        <p className="p-6 text-muted-foreground">جارٍ تحميل التنسيبات والحضور...</p>
      ) : query.isError ? (
        <div
          role="alert"
          className="space-y-3 rounded-xl border border-destructive p-4 text-destructive"
        >
          <p>تعذر تحميل التنسيبات. تأكد من تطبيق SQL الخاص بمقاعد المركبات وتنسيب الركاب.</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            إعادة المحاولة
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {query.data?.vehicles
            .filter((v) => `${v.name} ${v.vehicle_no}`.includes(search))
            .map((v) => {
              const roster = query.data.passengers.filter(
                (p) => p.vehicle_id === v.id && p.assigned,
              );
              const percent = v.passenger_capacity
                ? Math.round((roster.length / v.passenger_capacity) * 100)
                : null;
              const driver = query.data.employees.find((e) => e.id === v.current_driver_id);
              return (
                <Card
                  key={v.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`فتح بطاقة ${v.name}`}
                  onClick={() => setSelected(v.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelected(v.id);
                    }
                  }}
                  className="min-w-0 cursor-pointer transition-colors hover:border-primary/50"
                >
                  <CardContent className="space-y-4 p-5">
                    <div className="flex justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium text-primary">{v.vehicle_no}</p>
                        <h3 className="mt-2 text-lg font-bold">{v.name}</h3>
                      </div>
                      <Badge variant="outline">{v.is_active ? "نشطة" : "غير نشطة"}</Badge>
                    </div>
                    <div className="flex items-baseline justify-between border-y py-4">
                      <span className="text-3xl font-bold tabular-nums">
                        {percent === null ? "—" : `${percent}%`}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {roster.length} راكب / {v.passenger_capacity ?? "سعة غير محددة"}
                      </span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={`إشغال ${v.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent ?? undefined}
                      className="h-2 overflow-hidden rounded-full bg-muted"
                    >
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.min(100, percent ?? 0)}%` }}
                      />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      السائق:{" "}
                      {driver?.full_name ??
                        (v.current_driver_id ? "غير نشط / غير متاح" : "لم يُعين")}
                    </p>
                    <p className="rounded-lg border p-2 text-center text-sm font-semibold text-primary">
                      فتح بطاقة المركبة والكادر
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          {!query.data?.vehicles.length && (
            <p className="p-6 text-muted-foreground">لا توجد مركبات خفيفة مسجلة.</p>
          )}
        </div>
      )}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent dir="rtl" className="max-h-[90dvh] overflow-y-auto gap-6 sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {vehicle?.vehicle_no} — {vehicle?.name}
            </DialogTitle>
          </DialogHeader>
          {vehicle && query.data && (
            <PassengerDetails
              key={vehicle.id}
              vehicle={vehicle}
              employees={query.data.employees}
              passengers={query.data.passengers.filter((p) => p.vehicle_id === vehicle.id)}
              day={day}
              canManage={!!permission.data}
              refresh={refresh}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
function PassengerDetails({
  vehicle,
  employees,
  passengers,
  day,
  canManage,
  refresh,
}: {
  vehicle: Vehicle;
  employees: Employee[];
  passengers: Passenger[];
  day: string;
  canManage: boolean;
  refresh: () => Promise<void>;
}) {
  const [capacity, setCapacity] = useState(String(vehicle.passenger_capacity ?? ""));
  const [driver, setDriver] = useState(vehicle.current_driver_id ?? "");
  const [employee, setEmployee] = useState("");
  const [end, setEnd] = useState("");
  const [start, setStart] = useState(day);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(25);
  const run = async (action: () => Promise<void>, message: string) => {
    setBusy(true);
    try {
      await action();
      await refresh();
      toast.success(message);
    } catch (error) {
      toast.error(formatErrorMessage(error, "تعذر حفظ التنسيب"));
    } finally {
      setBusy(false);
    }
  };
  const active = passengers.filter((p) => p.assigned);
  const rows = passengers.filter((p) => `${p.full_name} ${p.employee_no}`.includes(search));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MetricCard title="الركاب المنسبون" value={active.length} tone="info" />
        <MetricCard
          title="مقاعد الركاب دون السائق"
          value={vehicle.passenger_capacity ?? "غير محددة"}
        />
        <MetricCard
          title="حاضرون بالبصمة في التاريخ المحدد"
          value={active.filter((p) => p.present_today).length}
          tone="success"
        />
      </div>
      {canManage && (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer font-semibold">
            إعداد المقاعد والسائق · إعدادات المركبة الحالية
          </summary>
          <form
            className="mt-5 grid gap-5 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const { error } = await supabase
                  .from("vehicles")
                  .update({
                    passenger_capacity: Number(capacity),
                    current_driver_id: driver || null,
                  })
                  .eq("id", vehicle.id);
                if (error) throw error;
              }, "تم حفظ السعة والسائق");
            }}
          >
            <label className="flex flex-col gap-3 text-sm">
              عدد مقاعد الركاب (لا يشمل السائق)
              <Input
                type="number"
                min={1}
                max={100}
                required
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
            </label>
            <div className="space-y-3">
              <p className="text-sm">السائق</p>
              <EmployeePicker
                employees={employees}
                value={driver}
                onChange={setDriver}
                label="تعيين السائق"
              />
            </div>
            <Button disabled={busy} type="submit">
              حفظ الإعدادات
            </Button>
          </form>
        </details>
      )}
      {canManage && vehicle.is_active && (
        <form
          className="grid gap-5 rounded-xl border bg-muted/20 p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const { error } = await supabase.from("vehicle_passenger_assignments").insert({
                vehicle_id: vehicle.id,
                employee_id: employee,
                starts_on: start,
                ends_on: end || null,
              });
              if (error) throw error;
              setEmployee("");
              setEnd("");
            }, "تم تنسيب الموظف إلى المركبة");
          }}
        >
          <div className="space-y-3">
            <p className="text-sm">تنسيب راكب</p>
            <EmployeePicker
              employees={employees.filter(
                (e) =>
                  e.id !== vehicle.current_driver_id && !active.some((p) => p.employee_id === e.id),
              )}
              value={employee}
              onChange={setEmployee}
              label="الموظف المنسب"
            />
          </div>
          <label className="flex flex-col gap-3 text-sm">
            تاريخ نهاية التنسيب (اختياري)
            <Input type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
          <label className="flex flex-col gap-3 text-sm">
            بداية التنسيب
            <Input
              type="date"
              required
              max={day}
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <p className="text-xs leading-6 text-muted-foreground">
            دون تاريخ نهاية، يبقى التنسيب مستمراً. تعديل المركبة يتم بإنهاء التنسيب القديم ثم بدء
            الجديد من اليوم التالي لتجنب تداخل الفترات.
          </p>
          <Button type="submit" disabled={busy || !employee || !vehicle.passenger_capacity}>
            تنسيب الموظف
          </Button>
        </form>
      )}
      <div className="space-y-4">
        <h3 className="font-semibold">الكادر المنسب وأيامه</h3>
        <p className="text-xs leading-6 text-muted-foreground">
          آخر 7 أيام وآخر 30 يوماً تشمل التاريخ المحدد، وتحتسب أيام البصمة خلال التنسيب فقط، مرة
          واحدة لليوم. تظهر التنسيبات السابقة ذات الصلة أيضاً، ولا تدخل في الإشغال الحالي.
        </p>
        <Input
          aria-label="البحث في ركاب المركبة"
          placeholder="ابحث بالاسم أو الرقم"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setLimit(25);
          }}
        />
        <div className="max-h-80 overflow-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="p-3">الموظف</th>
                <th className="p-3">آخر 7 أيام</th>
                <th className="p-3">آخر 30 يوماً</th>
                <th className="p-3">حالة التنسيب</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((p) => (
                <tr key={p.employee_id} className="border-t">
                  <td className="p-3">
                    <b>{p.full_name}</b>
                    <p className="text-xs text-muted-foreground">{p.employee_no}</p>
                  </td>
                  <td className="p-3">{p.week_days}</td>
                  <td className="p-3">{p.month_days}</td>
                  <td className="p-3">
                    <Badge variant={p.assigned ? "default" : "secondary"}>
                      {p.assigned ? "منسب" : "تنسيب سابق"}
                    </Badge>
                    {canManage && p.active_assignment_id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const { error } = await supabase
                              .from("vehicle_passenger_assignments")
                              .update({ ends_on: day })
                              .eq("id", p.active_assignment_id!);
                            if (error) throw error;
                          }, "ينتهي التنسيب بنهاية التاريخ المحدد؛ يبقى السجل محفوظاً")
                        }
                      >
                        إنهاء بنهاية اليوم
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <p className="p-6 text-center text-muted-foreground">لا توجد تنسيبات ضمن الفترة.</p>
          )}
        </div>
        {rows.length > limit && (
          <Button variant="outline" onClick={() => setLimit(limit + 25)}>
            عرض المزيد
          </Button>
        )}
      </div>
    </div>
  );
}
